const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const auth = require('../middleware/auth');
const { emitToConversation, emitToAll } = require('../services/socket.service');
const { sendMessage, sendImageMessage, getMessageContent } = require('../services/line.service');
const { suggestReply } = require('../services/claude.service');
const { checkMessage } = require('../services/moderation.service');
const { saveBase64Image, isStoredPath, thumbPathFor, deleteStoredImage, isValidImageDataUrl } = require('../lib/imageStorage');
const { canAccessChannel } = require('../lib/conversationQuery');

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
    // A channel-restricted agent has no business proxying media from a
    // conversation outside their assigned channels just by knowing/guessing
    // a LINE message id — see canAccessChannel's doc comment.
    if (!(await canAccessChannel(req.agent, message.conversation.channelId))) {
      return res.status(404).end();
    }
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
// New rows store a short "/uploads/..." path (see imageStorage.js) and redirect
// there — pass ?preview=1 to redirect to the smaller thumbnail instead (used
// for previewImageUrl, which LINE caps at 1MB separately from the 10MB cap on
// the full image). Rows created before this change still have the full base64
// blob in imageData (no thumbnail exists), so those are decoded and streamed
// inline as before regardless of ?preview.
router.get('/image/:id', async (req, res) => {
  const message = await prisma.message.findUnique({ where: { id: req.params.id }, select: { imageData: true } });
  if (!message?.imageData) return res.status(404).end();
  if (isStoredPath(message.imageData)) {
    const target = req.query.preview ? thumbPathFor(message.imageData) : message.imageData;
    return res.redirect(target);
  }
  // Restricted to the same safe raster-image allowlist as new uploads (see
  // imageStorage.js) rather than the original permissive `image/[a-zA-Z0-9.+-]+`
  // pattern — this path only still exists for legacy rows written before that
  // allowlist existed, some of which could carry an unsafe declared type like
  // `image/svg+xml`. nosniff is extra defense-in-depth on top of that: even
  // for an allowed type, it stops a browser from second-guessing the header
  // and rendering the body as something else.
  const match = /^data:image\/(jpeg|jpg|png|gif|webp);base64,(.+)$/.exec(message.imageData);
  if (!match) return res.status(404).end();
  const [, ext, base64] = match;
  res.set('Content-Type', `image/${ext}`);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(Buffer.from(base64, 'base64'));
});

// GET /api/messages/:conversationId
router.get('/:conversationId', auth, async (req, res) => {
  const conversation = await prisma.conversation.findUnique({
    where: { id: req.params.conversationId },
    select: { channelId: true },
  });
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
  // Same channel-restriction gap as the other routes in this file — reading a
  // conversation's message history (and marking it read / writing an audit
  // row below) shouldn't be reachable outside an agent's assigned channels
  // just because they know/guess the conversation id.
  if (!(await canAccessChannel(req.agent, conversation.channelId))) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

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
    if (imageData && !isValidImageDataUrl(imageData)) {
      return res.status(400).json({ error: 'ไฟล์ที่แนบต้องเป็นรูปภาพ (JPEG/PNG/GIF/WebP) ขนาดไม่เกิน 15MB' });
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.conversationId },
      include: { channel: true },
    });
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    // Without this, a channel-restricted agent could push a real LINE message
    // into any conversation outside their assigned channels just by knowing/
    // guessing its id — see canAccessChannel's doc comment.
    if (!(await canAccessChannel(req.agent, conversation.channelId))) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    // LINE returns 200 OK with no error when pushing to a blocked user — the
    // message just silently never arrives. Refuse it here instead, since the
    // frontend composer is also disabled for a blocked conversation; this is
    // the server-side backstop for any client that's out of sync.
    if (conversation.blocked) {
      return res.status(409).json({ error: 'ลูกค้าคนนี้บล็อคเราอยู่ ไม่สามารถส่งข้อความได้' });
    }
    // Channel soft-disabled ("ปิดใช้งาน") from Settings — same server-side
    // backstop pattern as the blocked check above.
    if (!conversation.channel.active) {
      return res.status(409).json({ error: 'ช่องทางนี้ถูกปิดใช้งานอยู่ ไม่สามารถส่งข้อความได้' });
    }

    let message;
    if (imageData) {
      // Write the attached image to disk (compressed + resized, with a separate
      // small thumbnail) instead of storing the base64 blob in Postgres — see
      // imageStorage.js. Falls back to the raw data URL only if it couldn't be
      // decoded, so a send never silently fails.
      const storedPath = (await saveBase64Image(imageData)) || imageData;
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
          imageData: storedPath,
          read: true,
        },
      });
      const imageUrl = `${req.protocol}://${req.get('host')}/api/messages/image/${message.id}`;
      // /image/:id redirects to the thumbnail's own static path when one exists
      // (see the route above), so this still resolves to the right file — it
      // just goes through one extra redirect hop instead of a direct static URL.
      const previewUrl = `${req.protocol}://${req.get('host')}/api/messages/image/${message.id}?preview=1`;
      try {
        await sendImageMessage(conversation.channel, conversation.lineUserId, imageUrl, previewUrl);
      } catch (err) {
        // A CONFIRMED failure (LINE rejected it outright — bad token, user
        // blocked, etc.) means nothing was delivered, so the row above (which
        // only exists to give LINE something to fetch) would otherwise show a
        // "sent" image bubble in OUR OWN UI for something the customer never
        // received — roll it back so this has the same all-or-nothing
        // semantics as a failed text send below.
        //
        // An AMBIGUOUS failure (isSendTimeout — see line.service.js) is
        // different: we don't know if LINE already accepted the push and
        // will fetch imageUrl shortly after. Deleting the file here would
        // turn "maybe it's fine" into "definitely broken" — if the push did
        // land, LINE's fetch would 404 and the customer would see a
        // permanently broken image. So on a timeout specifically, leave the
        // row and file in place; the agent's "check the chat before
        // resending" (see the uncertain-flag response below) will show it
        // there if a reload reveals the send actually went through.
        if (!err.isSendTimeout) {
          await prisma.message.delete({ where: { id: message.id } }).catch(() => {});
          deleteStoredImage(storedPath);
        }
        throw err;
      }
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

    // From here on, the message is confirmed sent (real row exists, LINE push
    // already succeeded) — emit + respond to the agent IMMEDIATELY, before
    // touching anything else. Everything below this point is bookkeeping
    // (updating lastMessageAt, clearing this agent's own audit-trail tags)
    // that's useful but not required for the agent to see their message went
    // through; if any of it fails, the agent shouldn't be told the send
    // itself failed (that used to trigger the exact double-send this
    // reordering closes — see line.service.js's comment on SendTimeoutError
    // for the other half of this fix). It runs fire-and-forget after the
    // response instead of being awaited inline.
    // `conversation` was fetched before any of this, so lastMessageAt is
    // stale on it — patch it locally (not yet persisted) so the broadcast
    // below reflects the new value immediately instead of the old one.
    const now = new Date();
    conversation.lastMessageAt = now;
    // `conversation` was fetched with the FULL LineChannel row (channel:
    // true, needed above for sendMessage/sendImageMessage's accessToken) —
    // broadcasting it as-is would push channelSecret/accessToken to every
    // connected agent's browser on every single message sent. Redact before
    // it goes anywhere near a socket emit or API response.
    const safeConversation = { ...conversation, channel: { id: conversation.channel.id, name: conversation.channel.name, active: conversation.channel.active } };

    emitToConversation(conversation.id, 'new_message', { message, conversation: safeConversation });
    emitToAll('conversation_updated', { ...safeConversation, lastMessage: message });

    res.status(201).json(message);

    prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: now } })
      .catch(e => console.error('lastMessageAt update failed (message already sent+recorded):', e.message));
    prisma.messageView.deleteMany({ where: { agentId: req.agent.id, message: { conversationId: conversation.id } } })
      .then(cleared => {
        if (cleared.count > 0) emitToConversation(conversation.id, 'message_view_cleared', { agentId: req.agent.id });
      })
      .catch(e => console.error('messageView cleanup failed (message already sent+recorded):', e.message));

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
    // A timeout waiting on LINE (see line.service.js) means we genuinely
    // don't know whether the message went through — `uncertain: true` tells
    // the frontend not to offer its normal "failed, try again" messaging,
    // since blindly retrying here is exactly what causes a real duplicate
    // send if the original push actually did land.
    if (err.isSendTimeout) return res.status(504).json({ error: err.message, uncertain: true });
    res.status(500).json({ error: err.message });
  }
});

// GET /api/messages/:conversationId/suggest
router.get('/:conversationId/suggest', auth, async (req, res) => {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.conversationId },
      select: { channelId: true, channel: { select: { name: true } } },
    });
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    // Without this, a channel-restricted agent could pull an AI-generated
    // reply suggestion (which reflects recent message content) for any
    // conversation outside their assigned channels — see canAccessChannel's
    // doc comment.
    if (!(await canAccessChannel(req.agent, conversation.channelId))) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const messages = await prisma.message.findMany({
      where: { conversationId: req.params.conversationId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    const suggestion = await suggestReply(messages.reverse(), conversation?.channel?.name || 'Support');
    res.json({ suggestion });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
