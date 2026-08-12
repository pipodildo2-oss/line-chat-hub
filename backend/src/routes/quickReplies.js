const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const auth = require('../middleware/auth');
const { emitToConversation, emitToAll } = require('../services/socket.service');
const { sendMessage, sendImageMessage } = require('../services/line.service');

const prisma = new PrismaClient();

function requireAdmin(req, res, next) {
  if (req.agent.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// ---------- Quick Reply Types ("ประเภท") ----------
// A type always belongs to exactly one channel ("หมวดหมู่" = pick the channel first).

// GET /api/quick-reply-types?channelId=...
router.get('/types', auth, async (req, res) => {
  const { channelId } = req.query;
  const where = channelId ? { channelId } : {};
  const types = await prisma.quickReplyType.findMany({
    where,
    include: { _count: { select: { quickReplies: true } } },
    orderBy: { name: 'asc' },
  });
  res.json(types);
});

// POST /api/quick-reply-types — admin only
router.post('/types', auth, requireAdmin, async (req, res) => {
  try {
    const { channelId, name } = req.body;
    if (!channelId || !name?.trim()) return res.status(400).json({ error: 'channelId and name required' });
    const type = await prisma.quickReplyType.create({ data: { channelId, name: name.trim() } });
    res.status(201).json(type);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'มีประเภทนี้อยู่แล้วในช่องทางนี้' });
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/quick-reply-types/:id — admin only
router.patch('/types/:id', auth, requireAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    const type = await prisma.quickReplyType.update({
      where: { id: req.params.id },
      data: { ...(name?.trim() ? { name: name.trim() } : {}) },
    });
    res.json(type);
  } catch {
    res.status(404).json({ error: 'Not found' });
  }
});

// DELETE /api/quick-reply-types/:id — admin only (cascades to its quick replies)
router.delete('/types/:id', auth, requireAdmin, async (req, res) => {
  try {
    await prisma.quickReplyType.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch {
    res.status(404).json({ error: 'Not found' });
  }
});

// ---------- Quick Replies ----------

// GET /api/quick-replies?channelId=...&typeId=...
router.get('/', auth, async (req, res) => {
  const { channelId, typeId } = req.query;
  const where = {};
  if (typeId) where.typeId = typeId;
  if (channelId) where.type = { channelId };
  const quickReplies = await prisma.quickReply.findMany({
    where,
    include: { type: { select: { id: true, name: true, channelId: true } } },
    orderBy: { name: 'asc' },
  });
  // Don't ship the full base64 blob in list views — just whether an image exists.
  res.json(quickReplies.map(({ imageData, ...qr }) => ({ ...qr, hasImage: !!imageData })));
});

// POST /api/quick-replies — admin only
router.post('/', auth, requireAdmin, async (req, res) => {
  try {
    const { typeId, name, content, imageData } = req.body;
    if (!typeId || !name?.trim() || !content?.trim()) {
      return res.status(400).json({ error: 'typeId, name and content required' });
    }
    if (imageData && !/^data:image\/(png|jpe?g|gif|webp);base64,/.test(imageData)) {
      return res.status(400).json({ error: 'รูปภาพต้องเป็นไฟล์ png, jpg, gif หรือ webp' });
    }
    const quickReply = await prisma.quickReply.create({
      data: { typeId, name: name.trim(), content: content.trim(), imageData: imageData || null },
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
    const { name, content, imageData, typeId } = req.body;
    if (imageData && !/^data:image\/(png|jpe?g|gif|webp);base64,/.test(imageData)) {
      return res.status(400).json({ error: 'รูปภาพต้องเป็นไฟล์ png, jpg, gif หรือ webp' });
    }
    const data = {};
    if (typeId) data.typeId = typeId;
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
  const match = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(quickReply.imageData);
  if (!match) return res.status(404).end();
  const [, contentType, base64] = match;
  res.set('Content-Type', contentType);
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(Buffer.from(base64, 'base64'));
});

// POST /api/quick-replies/:id/send — any agent, sends this quick reply into a conversation
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

    await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });

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
