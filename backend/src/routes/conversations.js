const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const auth = require('../middleware/auth');
const { emitToAll } = require('../services/socket.service');

const prisma = new PrismaClient();

const CONV_INCLUDE = {
  channel: { select: { id: true, name: true } },
  agent: { select: { id: true, name: true } },
  tags: { include: { tag: true } },
};

// Returns the list of channelIds this agent is restricted to, or null if unrestricted (admin or no restriction set).
async function getVisibleChannelIds(agent) {
  if (agent.role === 'admin') return null;
  const rows = await prisma.agentChannel.findMany({ where: { agentId: agent.id }, select: { channelId: true } });
  if (rows.length === 0) return null;
  return rows.map(r => r.channelId);
}

// GET /api/conversations
router.get('/', auth, async (req, res) => {
  const { status, channelId, channelIds, agentId, search, tagId, lifecycleStage, sort = 'newest', page = 1, limit = 30 } = req.query;

  // Support both a single channelId (legacy) and a multi-select channelIds list (comma-separated).
  let selectedChannelIds = [];
  if (channelIds) selectedChannelIds = String(channelIds).split(',').filter(Boolean);
  else if (channelId) selectedChannelIds = [channelId];

  const where = {};
  if (status) where.status = status;
  if (lifecycleStage) where.lifecycleStage = lifecycleStage;
  if (selectedChannelIds.length > 0) where.channelId = { in: selectedChannelIds };
  if (agentId === 'me') where.agentId = req.agent.id;
  else if (agentId === 'unassigned') where.agentId = null;
  else if (agentId) where.agentId = agentId;
  if (tagId) where.tags = { some: { tagId } };
  if (search) {
    where.OR = [
      { displayName: { contains: search, mode: 'insensitive' } },
      { lineUserId: { contains: search } },
    ];
  }

  const visibleChannelIds = await getVisibleChannelIds(req.agent);
  if (visibleChannelIds) {
    if (selectedChannelIds.length > 0) {
      const allowed = selectedChannelIds.filter(id => visibleChannelIds.includes(id));
      if (allowed.length === 0) {
        return res.json({ conversations: [], total: 0, page: Number(page), limit: Number(limit) });
      }
      where.channelId = { in: allowed };
    } else {
      where.channelId = { in: visibleChannelIds };
    }
  }

  const [total, conversations] = await Promise.all([
    prisma.conversation.count({ where }),
    prisma.conversation.findMany({
      where,
      include: {
        ...CONV_INCLUDE,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { content: true, sender: true, createdAt: true, type: true },
        },
        _count: { select: { messages: { where: { read: false, sender: 'user' } } } },
      },
      orderBy: { lastMessageAt: sort === 'oldest' ? 'asc' : 'desc' },
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
    include: { channel: true, agent: { select: { id: true, name: true } }, tags: { include: { tag: true } } },
  });
  if (!conversation) return res.status(404).json({ error: 'Not found' });
  res.json(conversation);
});

// PATCH /api/conversations/:id
router.patch('/:id', auth, async (req, res) => {
  try {
    const { status, agentId, displayName, notes, lifecycleStage } = req.body;
    const data = {};
    if (status) data.status = status;
    if (agentId !== undefined) data.agentId = agentId || null;
    if (displayName !== undefined) data.displayName = displayName;
    if (notes !== undefined) data.notes = notes;
    if (lifecycleStage) data.lifecycleStage = lifecycleStage;

    const conversation = await prisma.conversation.update({
      where: { id: req.params.id },
      data,
      include: CONV_INCLUDE,
    });
    emitToAll('conversation_updated', conversation);
    res.json(conversation);
  } catch {
    res.status(404).json({ error: 'Not found' });
  }
});

module.exports = router;
