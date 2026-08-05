const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const auth = require('../middleware/auth');
const { emitToAll } = require('../services/socket.service');

const prisma = new PrismaClient();

// GET /api/conversations
router.get('/', auth, async (req, res) => {
  const { status, channelId, agentId, search, page = 1, limit = 30 } = req.query;

  const where = {};
  if (status) where.status = status;
  if (channelId) where.channelId = channelId;
  if (agentId === 'me') where.agentId = req.agent.id;
  else if (agentId) where.agentId = agentId;
  if (search) {
    where.OR = [
      { displayName: { contains: search, mode: 'insensitive' } },
      { lineUserId: { contains: search } },
    ];
  }

  const [total, conversations] = await Promise.all([
    prisma.conversation.count({ where }),
    prisma.conversation.findMany({
      where,
      include: {
        channel: { select: { id: true, name: true } },
        agent: { select: { id: true, name: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { content: true, sender: true, createdAt: true, type: true },
        },
        _count: { select: { messages: { where: { read: false, sender: 'user' } } } },
      },
      orderBy: { lastMessageAt: 'desc' },
      skip: (page - 1) * limit,
      take: Number(limit),
    }),
  ]);

  res.json({ conversations, total, page: Number(page), limit: Number(limit) });
});

// GET /api/conversations/:id
router.get('/:id', auth, async (req, res) => {
  const conversation = await prisma.conversation.findUnique({
    where: { id: req.params.id },
    include: {
      channel: true,
      agent: { select: { id: true, name: true } },
    },
  });
  if (!conversation) return res.status(404).json({ error: 'Not found' });
  res.json(conversation);
});

// PATCH /api/conversations/:id
router.patch('/:id', auth, async (req, res) => {
  try {
    const { status, agentId } = req.body;
    const data = {};
    if (status) data.status = status;
    if (agentId !== undefined) data.agentId = agentId || null;

    const conversation = await prisma.conversation.update({
      where: { id: req.params.id },
      data,
      include: {
        channel: { select: { id: true, name: true } },
        agent: { select: { id: true, name: true } },
      },
    });
    emitToAll('conversation_updated', conversation);
    res.json(conversation);
  } catch {
    res.status(404).json({ error: 'Not found' });
  }
});

module.exports = router;
