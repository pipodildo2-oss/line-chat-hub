const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const auth = require('../middleware/auth');

const prisma = new PrismaClient();

// GET /api/channels
router.get('/', auth, async (req, res) => {
  let where = {};
  if (req.agent.role !== 'admin') {
    const rows = await prisma.agentChannel.findMany({ where: { agentId: req.agent.id }, select: { channelId: true } });
    if (rows.length > 0) where = { id: { in: rows.map(r => r.channelId) } };
  }
  const channels = await prisma.lineChannel.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    include: {
      _count: { select: { conversations: true } },
      category: { select: { id: true, name: true } },
    },
  });
  res.json(channels);
});

// POST /api/channels
router.post('/', auth, async (req, res) => {
  try {
    const { name, channelId, channelSecret, accessToken, lineId, categoryId } = req.body;
    if (!name || !channelId || !channelSecret || !accessToken) {
      return res.status(400).json({ error: 'All fields required' });
    }
    const channel = await prisma.lineChannel.create({
      data: { name, channelId, channelSecret, accessToken, lineId: lineId || null, categoryId: categoryId || null },
      include: { category: { select: { id: true, name: true } } },
    });
    res.status(201).json(channel);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Channel ID already exists' });
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/channels/:id
router.put('/:id', auth, async (req, res) => {
  try {
    const { name, channelSecret, accessToken, lineId, webhookRedeliveryConfirmed, categoryId } = req.body;
    const channel = await prisma.lineChannel.update({
      where: { id: req.params.id },
      data: {
        name, channelSecret, accessToken, lineId, webhookRedeliveryConfirmed,
        // categoryId can be explicitly cleared back to "uncategorized" (null),
        // so it needs its own undefined-vs-null check rather than falling
        // through with the other fields above.
        ...(categoryId !== undefined ? { categoryId: categoryId || null } : {}),
      },
      include: { category: { select: { id: true, name: true } } },
    });
    res.json(channel);
  } catch {
    res.status(404).json({ error: 'Channel not found' });
  }
});

// DELETE /api/channels/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    await prisma.lineChannel.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch {
    res.status(404).json({ error: 'Channel not found' });
  }
});

module.exports = router;
