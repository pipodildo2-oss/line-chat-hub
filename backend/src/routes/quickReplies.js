const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const auth = require('../middleware/auth');
const { emitToConversation, emitToAll } = require('../services/socket.service');
const { sendMessage, sendImageMessage } = require('../services/line.service');

const prisma = new PrismaClient();

const KINDS = ['reply', 'promotion'];

function requireAdmin(req, res, next) {
  if (req.agent.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// ---------- Quick Reply Categories ("หมวดหมู่") ----------
// Free-form, admin-created by typing a name. Not tied to any specific LINE OA —
// an admin picks which conversation to send a quick reply into at send time.

const CATEGORY_INCLUDE = {
  _count: { select: { quickReplies: true } },
  channels: { select: { id: true, name: true } },
};

// GET /api/quick-replies/categories
router.get('/categories', auth, async (req, res) => {
  const categories = await prisma.quickReplyCategory.findMany({
    include: CATEGORY_INCLUDE,
    orderBy: { name: 'asc' },
  });
  res.json(categories);
});

// POST /api/quick-replies/categories — admin only
// channelIds is optional: which LINE OAs this category (and its quick replies)
// should show up for. Empty/omitted = unrestricted, shows for every OA.
router.post('/categories', auth, requireAdmin, async (req, res) => {
  try {
    const { name, channelIds } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name required' });
    const category = await prisma.quickReplyCategory.create({
      data: {
        name: name.trim(),
        ...(Array.isArray(channelIds) && channelIds.length > 0
          ? { channels: { connect: channelIds.map(id => ({ id })) } }
          : {}),
      },
      include: CATEGORY_INCLUDE,
    });
    res.status(201).json(category);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'มีหมวดหมู่นี้อยู่แล้ว' });
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/quick-replies/categories/:id — admin only
router.patch('/categories/:id', auth, requireAdmin, async (req, res) => {
  try {
    const { name, channelIds } = req.body;
    const category = await prisma.quickReplyCategory.update({
      where: { id: req.params.id },
      data: {
        ...(name?.trim() ? { name: name.trim() } : {}),
        // `set` fully replaces the linked channels with this list — right semantics
        // for a checkbox picker (including clearing it back to "all channels").
        ...(Array.isArray(channelIds) ? { channels: { set: channelIds.map(id => ({ id })) } } : {}),
      },
      include: CATEGORY_INCLUDE,
    });
    res.json(category);
  } catch {
    res.status(404).json({ error: 'Not found' });
  }
});

// DELETE /api/quick-replies/categories/:id — admin only (cascades to its quick replies)
router.delete('/categories/:id', auth, requireAdmin, async (req, res) => {
  try {
    await prisma.quickReplyCategory.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch {
    res.status(404).json({ error: 'Not found' });
  }
});

// ---------- Quick Replies ----------

// GET /api/quick-replies?categoryId=...&kind=...&channelId=...
// channelId filters to categories that are either unrestricted (no channels linked)
// or explicitly include that channel — used by the Inbox picker so agents only see
// quick replies relevant to the LINE OA of the conversation they're replying in.
router.get('/', auth, async (req, res) => {
  const { categoryId, kind, channelId } = req.query;
  const where = {};
  if (categoryId) where.categoryId = categoryId;
  if (kind) where.kind = kind;
  if (channelId) {
    where.category = {
      OR: [{ channels: { none: {} } }, { channels: { some: { id: channelId } } }],
    };
  }
  const quickReplies = await prisma.quickReply.findMany({
    where,
    include: { category: { select: { id: true, name: true } } },
    orderBy: [{ order: 'asc' }, { name: 'asc' }],
  });
  // Don't ship the full base64 blob in list views — just whether an image exists.
  res.json(quickReplies.map(({ imageData, ...qr }) => ({ ...qr, hasImage: !!imageData })));
});

// PATCH /api/quick-replies/reorder — admin only. Body: { categoryId, ids: [...] }
// (ids listed in the desired display order). Sets each item's `order` to its index —
// this is what controls the order agents see them in the Inbox quick-reply picker.
router.patch('/reorder', auth, requireAdmin, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids required' });
    await Promise.all(ids.map((id, index) => prisma.quickReply.update({ where: { id }, data: { order: index } })));
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/quick-replies — admin only
router.post('/', auth, requireAdmin, async (req, res) => {
  try {
    const { categoryId, kind, name, content, imageData } = req.body;
    if (!categoryId || !name?.trim() || !content?.trim()) {
      return res.status(400).json({ error: 'categoryId, name and content required' });
    }
    if (kind && !KINDS.includes(kind)) return res.status(400).json({ error: 'kind ต้องเป็น reply หรือ promotion' });
    if (imageData && !/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(imageData)) {
      return res.status(400).json({ error: 'ไฟล์ที่แนบต้องเป็นรูปภาพเท่านั้น' });
    }
    // New items go to the end of their category's list by default.
    const count = await prisma.quickReply.count({ where: { categoryId } });
    const quickReply = await prisma.quickReply.create({
      data: { categoryId, kind: kind || 'reply', name: name.trim(), content: content.trim(), imageData: imageData || null, order: count },
    });
    const { imageData: _omit, ...safe } = quickReply;
    res.status(201).json({ ...safe, hasImage: !!quickReply.imageData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/quick-replies/:id — admin only
router.patch('/:id', auth, requireAdmin, async (req, res) => {
  try {
    const { name, content, imageData, categoryId, kind } = req.body;
    if (kind && !KINDS.includes(kind)) return res.status(400).json({ error: 'kind ต้องเป็น reply หรือ promotion' });
    if (imageData && !/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(imageData)) {
      return res.status(400).json({ error: 'ไฟล์ที่แนบต้องเป็นรูปภาพเท่านั้น' });
    }
    const data = {};
    if (categoryId) data.categoryId = categoryId;
    if (kind) data.kind = kind;
    if (name?.trim()) data.name = name.trim();
    if (content?.trim()) data.content = content.trim();
    if (imageData !== undefined) data.imageData = imageData || null; // allow explicit removal with ""
    const quickReply = await prisma.quickReply.update({ where: { id: req.params.id }, data });
    const { imageData: _omit, ...safe } = quickReply;
    res.json({ ...safe, hasImage: !!quickReply.imageData });
  } catch {
    res.status(404).json({ error: 'Not found' });
  }
});

// DELETE /api/quick-replies/:id — admin only
router.delete('/:id', auth, requireAdmin, async (req, res) => {
  try {
    await prisma.quickReply.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch {
    res.status(404).json({ error: 'Not found' });
  }
});

// GET /api/quick-replies/:id/image — intentionally NOT behind `auth`.
// LINE's own servers fetch this URL directly (as originalContentUrl/previewImageUrl)
// when we push an image quick-reply, so it must be publicly reachable.
router.get('/:id/image', async (req, res) => {
  const quickReply = await prisma.quickReply.findUnique({ where: { id: req.params.id }, select: { imageData: true } });
  if (!quickReply?.imageData) return res.status(404).end();
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(quickReply.imageData);
  if (!match) return res.status(404).end();
  const [, contentType, base64] = match;
  res.set('Content-Type', contentType);
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(Buffer.from(base64, 'base64'));
});

// POST /api/quick-replies/:id/send — any agent, sends this quick reply into a conversation.
// The quick reply itself isn't tied to a channel — the conversation being viewed
// decides which LINE OA (and access token) it actually goes out through.
router.post('/:id/send', auth, async (req, res) => {
  try {
    const { conversationId } = req.body;
    if (!conversationId) return res.status(400).json({ error: 'conversationId required' });

    const [quickReply, conversation] = await Promise.all([
      prisma.quickReply.findUnique({ where: { id: req.params.id } }),
      prisma.conversation.findUnique({ where: { id: conversationId }, include: { channel: true } }),
    ]);
    if (!quickReply) return res.status(404).json({ error: 'Quick reply not found' });
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

    const created = [];

    if (quickReply.imageData) {
      const imageUrl = `${req.protocol}://${req.get('host')}/api/quick-replies/${quickReply.id}/image`;
      await sendImageMessage(conversation.channel, conversation.lineUserId, imageUrl);
      const imgMessage = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          sender: 'agent',
          senderName: req.agent.name,
          type: 'image',
          content: '[Image]',
          metadata: JSON.stringify({ url: imageUrl }),
          read: true,
        },
      });
      created.push(imgMessage);
    }

    await sendMessage(conversation.channel, conversation.lineUserId, quickReply.content);
    const textMessage = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        sender: 'agent',
        senderName: req.agent.name,
        type: 'text',
        content: quickReply.content,
        read: true,
      },
    });
    created.push(textMessage);

    // An outgoing message (even a canned quick reply) clears this agent's own
    // audit-trail tag on the latest customer message, if any — same rule as a
    // normal typed reply (see messages.js POST /:conversationId).
    const now = new Date();
    const latestUserMessage = await prisma.message.findFirst({
      where: { conversationId: conversation.id, sender: 'user' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: now },
    });
    if (latestUserMessage) {
      const cleared = await prisma.messageView.deleteMany({
        where: { messageId: latestUserMessage.id, agentId: req.agent.id },
      });
      if (cleared.count > 0) {
        emitToConversation(conversation.id, 'message_view_cleared', {
          messageId: latestUserMessage.id,
          agentId: req.agent.id,
        });
      }
    }
    // `conversation` was fetched before the update above — patch this field
    // locally before broadcasting, otherwise the inbox list briefly shows a
    // stale value (jumping backward in sort order).
    conversation.lastMessageAt = now;

    for (const message of created) {
      emitToConversation(conversation.id, 'new_message', { message, conversation });
    }
    emitToAll('conversation_updated', { ...conversation, lastMessage: created[created.length - 1] });

    res.status(201).json({ messages: created });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
