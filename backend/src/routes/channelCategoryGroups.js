const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const auth = require('../middleware/auth');

const prisma = new PrismaClient();

function requireAdmin(req, res, next) {
  if (req.agent.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// ---------- LINE OA Channel Category GROUPS ("หมวดหมู่ใหญ่") ----------
// One level above ChannelCategory ("หมวดหมู่ย่อย") — purely organizational, admin
// creates a group by typing a name, then assigns existing categories into it via
// PATCH /api/channel-categories/:id { groupId }. A category belongs to at most
// one group (or none — stays in the flat "ยังไม่มีหมวดหมู่ใหญ่" section).

// GET /api/channel-category-groups
router.get('/', auth, async (req, res) => {
  const groups = await prisma.channelCategoryGroup.findMany({
    include: { _count: { select: { categories: true } } },
    orderBy: { createdAt: 'asc' },
  });
  res.json(groups);
});

// POST /api/channel-category-groups — admin only
router.post('/', auth, requireAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name required' });
    const group = await prisma.channelCategoryGroup.create({ data: { name: name.trim() } });
    res.status(201).json(group);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'มีหมวดหมู่ใหญ่นี้อยู่แล้ว' });
    console.error('Create channel category group failed:', err.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

// PATCH /api/channel-category-groups/:id — admin only
router.patch('/:id', auth, requireAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name required' });
    const group = await prisma.channelCategoryGroup.update({
      where: { id: req.params.id },
      data: { name: name.trim() },
    });
    res.json(group);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'มีหมวดหมู่ใหญ่นี้อยู่แล้ว' });
    res.status(404).json({ error: 'Not found' });
  }
});

// DELETE /api/channel-category-groups/:id — admin only.
// Categories in this group aren't deleted — they just fall back to ungrouped
// (schema.prisma: ChannelCategory.groupId has onDelete: SetNull).
router.delete('/:id', auth, requireAdmin, async (req, res) => {
  try {
    await prisma.channelCategoryGroup.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch {
    res.status(404).json({ error: 'Not found' });
  }
});

module.exports = router;
