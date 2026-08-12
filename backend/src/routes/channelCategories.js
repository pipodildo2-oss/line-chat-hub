const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const auth = require('../middleware/auth');

const prisma = new PrismaClient();

function requireAdmin(req, res, next) {
  if (req.agent.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// ---------- LINE OA Channel Categories ----------
// Purely organizational — admin creates a category by typing a name, then assigns
// each LINE OA channel to at most one category. Used to group the channel list
// into horizontal rows on the Settings > channels page.

// GET /api/channel-categories
router.get('/', auth, async (req, res) => {
  const categories = await prisma.channelCategory.findMany({
    include: { _count: { select: { channels: true } } },
    orderBy: { createdAt: 'asc' },
  });
  res.json(categories);
});

// POST /api/channel-categories — admin only
router.post('/', auth, requireAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name required' });
    const category = await prisma.channelCategory.create({ data: { name: name.trim() } });
    res.status(201).json(category);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'มีหมวดหมู่นี้อยู่แล้ว' });
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/channel-categories/:id — admin only
router.patch('/:id', auth, requireAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name required' });
    const category = await prisma.channelCategory.update({
      where: { id: req.params.id },
      data: { name: name.trim() },
    });
    res.json(category);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'มีหมวดหมู่นี้อยู่แล้ว' });
    res.status(404).json({ error: 'Not found' });
  }
});

// DELETE /api/channel-categories/:id — admin only.
// Channels in this category aren't deleted — they just fall back to "uncategorized"
// (schema.prisma: LineChannel.categoryId has onDelete: SetNull).
router.delete('/:id', auth, requireAdmin, async (req, res) => {
  try {
    await prisma.channelCategory.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch {
    res.status(404).json({ error: 'Not found' });
  }
});

module.exports = router;
