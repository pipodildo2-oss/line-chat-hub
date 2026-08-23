const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const auth = require('../middleware/auth');

const prisma = new PrismaClient();

function requireAdmin(req, res, next) {
  if (req.agent.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// ---------- Team ("หมวดหมู่ทีมงาน") Categories ----------
// Purely organizational — admin creates a category by typing a name, then assigns
// each teammate to at most one category. Used to group the team list into
// horizontal rows on the Settings > Team page. Exact mirror of channelCategories.js.

// GET /api/agent-categories
router.get('/', auth, async (req, res) => {
  const categories = await prisma.agentCategory.findMany({
    include: { _count: { select: { agents: true } } },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  });
  res.json(categories);
});

// PATCH /api/agent-categories/reorder — admin only. Body: { ids: [...] } listed
// in the desired display order. Sets each category's `order` to its index —
// mirrors the quick-reply reorder pattern in quickReplies.js exactly. Declared
// before PATCH /:id so "reorder" isn't swallowed as an :id value.
router.patch('/reorder', auth, requireAdmin, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids required' });
    await Promise.all(ids.map((id, index) => prisma.agentCategory.update({ where: { id }, data: { order: index } })));
    res.status(204).end();
  } catch (err) {
    console.error('Reorder agent categories failed:', err.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

// POST /api/agent-categories — admin only
router.post('/', auth, requireAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name required' });
    const category = await prisma.agentCategory.create({ data: { name: name.trim() } });
    res.status(201).json(category);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'มีหมวดหมู่นี้อยู่แล้ว' });
    console.error('Create agent category failed:', err.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

// PATCH /api/agent-categories/:id — admin only
router.patch('/:id', auth, requireAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name required' });
    const category = await prisma.agentCategory.update({
      where: { id: req.params.id },
      data: { name: name.trim() },
    });
    res.json(category);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'มีหมวดหมู่นี้อยู่แล้ว' });
    res.status(404).json({ error: 'Not found' });
  }
});

// DELETE /api/agent-categories/:id — admin only.
// Teammates in this category aren't deleted — they just fall back to
// "uncategorized" (schema.prisma: Agent.categoryId has onDelete: SetNull).
router.delete('/:id', auth, requireAdmin, async (req, res) => {
  try {
    await prisma.agentCategory.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch {
    res.status(404).json({ error: 'Not found' });
  }
});

module.exports = router;
