const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const auth = require('../middleware/auth');
const { emitToConversation, emitToAll } = require('../services/socket.service');
const { sendMessage, sendImageMessage, getMessageContent } = require('../services/line.service');
const { suggestReply } = require('../services/claude.service');

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

  const messages = await prisma.message.findMany({
    where,
    select: MESSAGE_SELECT,
    orderBy: { createdAt: 'desc' },
    take: Number(limit),
  });

  // Mark as read
  await prisma.message.updateMany({
    where: { conversationId: req.params.conversationId, sender: 'user', read: false },
    data: { read: true },
  });

  // "First to open wins" — claim the first-viewer slot if nobody has since the
  // customer's last message. updateMany's WHERE clause makes this an atomic
  // compare-and-set at the DB level: if two agents open this conversation at
  // nearly the same moment, only the request whose UPDATE actually matches a
  // row (count > 0, because firstViewedByAgentId was still null) is the real
  // first viewer — the loser's WHERE clause silently matches nothing.
  const claim = await prisma.conversation.updateMany({
    where: { id: req.params.conversationId, firstViewedByAgentId: null },
    data: { firstViewedByAgentId: req.agent.id, firstViewedAt: new Date() },
  });
  if (claim.count > 0) {
    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.conversationId },
      include: {
        channel: { select: { id: true, name: true } },
        agent: { select: { id: true, name: true } },
        firstViewedByAgent: { select: { id: true, name: true } },
      },
    });
    if (conversation) emitToAll('conversation_updated', conversation);
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

    let message;
    if (imageData) {
      // Create the row first so we have an id to build the public image URL from,
      // push it to LINE, then patch metadata.url in — mirrors the quick-reply image flow.
      message = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          sender: 'agent',
          senderName: req.agent.name,
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
          type: 'text',
          content,
          read: true,
        },
        select: MESSAGE_SELECT,
      });
    }

    // Update conversation lastMessageAt. An outgoing message from us is also the
    // signal that clears the "first viewed by" claim — it means the customer has
    // actually been replied to, so the badge should stop pointing at whoever
    // opened the chat earlier and go back to unclaimed for next time.
    const now = new Date();
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: now, firstViewedByAgentId: null, firstViewedAt: null },
    });
    // `conversation` was fetched before the update above, so these fields are
    // stale on it. Patch them locally before broadcasting — otherwise the inbox
    // list briefly shows the old values until the next full refetch.
    conversation.lastMessageAt = now;
    conversation.firstViewedByAgentId = null;
    conversation.firstViewedByAgent = null;
    conversation.firstViewedAt = null;

    emitToConversation(conversation.id, 'new_message', { message, conversation });
    emitToAll('conversation_updated', { ...conversation, lastMessage: message });

    res.status(201).json(message);
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
