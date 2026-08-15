const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const auth = require('../middleware/auth');
const { emitToConversation, emitToAll } = require('../services/socket.service');
const { sendMessage, sendImageMessage, getMessageContent } = require('../services/line.service');
const { suggestReply } = require('../services/claude.service');
const { checkMessage } = require('../services/moderation.service');

const prisma = new PrismaClient();

// Excludes the (potentially large) base64 imageData column from bulk queries —
// callers get metadata.url for agent-sent images instead, see /image/:id below.
const MESSAGE_SELECT = {
  id: true, conversationId: true, sender: true, senderName: true, type: true,
  content: true, metadata: true, read: true, lineMessageId: true, createdAt: true,
};

// GET /api/messages/content/:messageId — proxy image/video/audio a customer sent us.
// Placed before the /:conversationId route below since "content" would otherwise be
// swallowed as a conversationId value.
router.get('/content/:messageId', auth, async (req, res) => {
  try {
    const message = await prisma.message.findFirst({
      where: { lineMessageId: req.params.messageId },
      include: { conversation: { include: { channel: true } } },
    });
    if (!message) return res.status(404).end();
    const { stream, contentType } = await getMessageContent(message.conversation.channel, req.params.messageId);
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'private, max-age=86400');
    stream.pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/messages/image/:id — serves an image an AGENT attached and sent.
// Intentionally NOT behind `auth`: LINE's own servers fetch this URL directly
// (as originalContentUrl/previewImageUrl) when we push the image message.
router.get('/image/:id', async (req, res) => {
  const message = await prisma.message.findUnique({ where: { id: req.params.id }, select: { imageData: true } });
  if (!message?.imageData) return res.status(404).end();
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(message.imageData);
  if (!match) return res.status(404).end();
  const [, contentType, base64] = match;
  res.set('Content-Type', contentType);
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(Buffer.from(base64, 'base64'));
});

// GET /api/messages/:conversationId
router.get('/:conversationId', auth, async (req, res) => {
  const { cursor, limit = 50 } = req.query;
  const where = { conversationId: req.params.conversationId };
  if (cursor) where.createdAt = { lt: new Date(cursor) };

  // Admin-only audit data: which agents have opened this conversation while a
  // given customer message was the latest one, without replying. Agents never
  // get this in their API response at all — not just hidden in the UI — so
  // there's no way for an agent to discover who else has been avoiding a reply.
  const isAdmin = req.agent.role === 'admin';
  const select = isAdmin
    ? { ...MESSAGE_SELECT, views: { select: { agentId: true, agent: { select: { name: true } } } } }
    : MESSAGE_SELECT;

  const messages = await prisma.message.findMany({
    where,
    select,
    orderBy: { createdAt: 'desc' },
    take: Number(limit),
  });

  // Admins are reviewers checking on agents' work, not the ones handling the
  // conversation — so an admin opening a chat should NOT mark it read (the
  // unread badge should keep showing it as new for whoever actually owns it)
  // and should NOT get tagged in the "viewed but didn't reply" audit trail
  // below (that trail exists to catch AGENTS avoiding a reply, not admins
  // browsing to check on them).
  if (!isAdmin) {
    // Mark as read
    await prisma.message.updateMany({
      where: { conversationId: req.params.conversationId, sender: 'user', read: false },
      data: { read: true },
    });

    // Audit trail: if the newest message in this conversation is a customer
    // message (i.e. nobody's replied to it yet), record that this agent viewed
    // it. Tags accumulate per-message and are permanent — they're only ever
    // removed when THIS agent goes on to send a reply (see POST below), never
    // by simply viewing a newer message. upsert avoids duplicate rows if the
    // same agent reopens the same still-unanswered conversation more than once.
    const latestMessage = await prisma.message.findFirst({
      where: { conversationId: req.params.conversationId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, sender: true },
    });
    if (latestMessage && latestMessage.sender === 'user') {
      await prisma.messageView.upsert({
        where: { messageId_agentId: { messageId: latestMessage.id, agentId: req.agent.id } },
        create: { messageId: latestMessage.id, agentId: req.agent.id },
        update: {},
      });
      emitToConversation(req.params.conversationId, 'message_view', {
        messageId: latestMessage.id,
        agentId: req.agent.id,
        agentName: req.agent.name,
      });
    }
  }

  res.json(messages.reverse());
});

// POST /api/messages/:conversationId — send a text message, or an image (imageData
// as a base64 data URL) attached from the composer.
router.post('/:conversationId', auth, async (req, res) => {
  try {
    const { content, imageData } = req.body;
    if (!content?.trim() && !imageData) return res.status(400).json({ error: 'Content required' });
    if (imageData && !/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(imageData)) {
      return res.status(400).json({ error: 'ไฟล์ที่แนบต้องเป็นรูปภาพเท่านั้น' });
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.conversationId },
      include: { channel: true },
    });
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    // LINE returns 200 OK with no error when pushing to a blocked user — the
    // message just silently never arrives. Refuse it here instead, since the
    // frontend composer is also disabled for a blocked conversation; this is
    // the server-side backstop for any client that's out of sync.
    if (conversation.blocked) {
      return res.status(409).json({ error: 'ลูกค้าคนนี้บล็อคเราอยู่ ไม่สามารถส่งข้อความได้' });
    }

    let message;
    if (imageData) {
      // Create the row first so we have an id to build the public image URL from,
      // push it to LINE, then patch metadata.url in — mirrors the quick-reply image flow.
      message = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          sender: 'agent',
          senderName: req.agent.name,
          senderId: req.agent.id,
          type: 'image',
          content: '[Image]',
          imageData,
          read: true,
        },
      });
      const imageUrl = `${req.protocol}://${req.get('host')}/api/messages/image/${message.id}`;
      await sendImageMessage(conversation.channel, conversation.lineUserId, imageUrl);
      message = await prisma.message.update({
        where: { id: message.id },
        data: { metadata: JSON.stringify({ url: imageUrl }) },
        select: MESSAGE_SELECT,
      });
    } else {
      await sendMessage(conversation.channel, conversation.lineUserId, content);
      message = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          sender: 'agent',
          senderName: req.agent.name,
          senderId: req.agent.id,
          type: 'text',
          content,
          read: true,
        },
        select: MESSAGE_SELECT,
      });
    }

    // Update conversation lastMessageAt. Sending a reply also clears THIS agent's
    // own audit-trail tags on EVERY customer message in this conversation, not
    // just the newest one — if this agent ends up being the one who actually
    // replies, they didn't "view it and leave it for someone else," even if a
    // newer customer message had already arrived between their view and their
    // reply. Other agents' tags are untouched, since they still haven't replied.
    const now = new Date();
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: now },
    });
    const cleared = await prisma.messageView.deleteMany({
      where: { agentId: req.agent.id, message: { conversationId: conversation.id } },
    });
    if (cleared.count > 0) {
      emitToConversation(conversation.id, 'message_view_cleared', { agentId: req.agent.id });
    }
    // `conversation` was fetched before the update above, so lastMessageAt is
    // stale on it. Patch it locally before broadcasting — otherwise the inbox
    // list briefly shows the old value until the next full refetch.
    conversation.lastMessageAt = now;

    emitToConversation(conversation.id, 'new_message', { message, conversation });
    emitToAll('conversation_updated', { ...conversation, lastMessage: message });

    res.status(201).json(message);

    // AI moderation check — freely-typed text only (not images, not canned quick
    // replies, which go through a separate route and are pre-approved by an
    // admin). Deliberately fired AFTER the response above so the agent's send
    // isn't held up waiting on an AI call; the Report page picks it up a moment
    // later via the 'message_flagged' event or its next fetch. Recent history is
    // passed along so the AI can judge tone (arguing with the customer) and
    // repetition (spam), not just this one message in isolation.
    if (!imageData && content) {
      prisma.message.findMany({
        where: { conversationId: conversation.id, id: { not: message.id } },
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: { sender: true, content: true },
      })
        .then(history => checkMessage(content, history.reverse()))
        .then(async (result) => {
          if (!result) return;
          await prisma.message.update({
            where: { id: message.id },
            data: { flagged: true, flagSeverity: result.severity, flagReason: result.reason },
          });
          emitToAll('message_flagged', {
            messageId: message.id,
            conversationId: conversation.id,
            severity: result.severity,
            reason: result.reason,
            agentId: req.agent.id,
            agentName: req.agent.name,
            content,
            createdAt: message.createdAt,
          });
        })
        .catch((e) => console.warn('Moderation follow-up failed:', e.message));
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/messages/:conversationId/suggest
router.get('/:conversationId/suggest', auth, async (req, res) => {
  try {
    const messages = await prisma.message.findMany({
      where: { conversationId: req.params.conversationId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.conversationId },
      include: { channel: true },
    });
    const suggestion = await suggestReply(messages.reverse(), conversation?.channel?.name || 'Support');
    res.json({ suggestion });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
