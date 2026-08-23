const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const auth = require('../middleware/auth');
const { canAccessChannel } = require('../lib/conversationQuery');

const prisma = new PrismaClient();

// GET /api/tags
router.get('/', auth, async (req, res) => {
  const tags = await prisma.tag.findMany({ orderBy: { name: 'asc' } });
  res.json(tags);
});

// POST /api/tags
router.post('/', auth, async (req, res) => {
  if (req.agent.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    const { name, color } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
    const tag = await prisma.tag.create({ data: { name: name.trim(), color: color || '#6366f1' } });
    res.status(201).json(tag);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Tag already exists' });
    console.error('Create tag failed:', err.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

// DELETE /api/tags/:id — admin only (deletes the tag globally, not just one assignment)
router.delete('/:id', auth, async (req, res) => {
  if (req.agent.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    await prisma.tag.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch {
    res.status(404).json({ error: 'Tag not found' });
  }
});

// POST /api/tags/:tagId/conversations/:conversationId — assign tag
router.post('/:tagId/conversations/:conversationId', auth, async (req, res) => {
  try {
    const conversation = await prisma.conversation.findUnique({ where: { id: req.params.conversationId }, select: { channelId: true } });
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    // Without this, a channel-restricted agent could tag any conversation
    // outside their assigned channels just by knowing/guessing its id — see
    // canAccessChannel's doc comment.
    if (!(await canAccessChannel(req.agent, conversation.channelId))) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    const link = await prisma.conversationTag.upsert({
      where: { conversationId_tagId: { conversationId: req.params.conversationId, tagId: req.params.tagId } },
      update: {},
      create: { conversationId: req.params.conversationId, tagId: req.params.tagId },
    });
    res.status(201).json(link);
  } catch (err) {
    console.error('Assign tag failed:', err.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

// DELETE /api/tags/:tagId/conversations/:conversationId — unassign tag
router.delete('/:tagId/conversations/:conversationId', auth, async (req, res) => {
  try {
    const conversation = await prisma.conversation.findUnique({ where: { id: req.params.conversationId }, select: { channelId: true } });
    if (!conversation) return res.status(404).json({ error: 'Not found' });
    if (!(await canAccessChannel(req.agent, conversation.channelId))) {
      return res.status(404).json({ error: 'Not found' });
    }
    await prisma.conversationTag.delete({
      where: { conversationId_tagId: { conversationId: req.params.conversationId, tagId: req.params.tagId } },
    });
    res.json({ success: true });
  } catch {
    res.status(404).json({ error: 'Not found' });
  }
});

module.exports = router;
