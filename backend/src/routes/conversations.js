const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const auth = require('../middleware/auth');
const { emitToAll } = require('../services/socket.service');

const prisma = new PrismaClient();

const CONV_INCLUDE = {
  channel: { select: { id: true, name: true, active: true } },
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

// Applies the `sort` query param the same way whether the list came from a DB
// query (sort=name/newest/oldest already possible via orderBy) or from the
// in-memory unanswered-filter path below (which can't use orderBy since it
// runs after a JS filter) — keeps both code paths behaving identically.
function sortConversationsInMemory(list, sort) {
  const sorted = [...list];
  if (sort === 'name') {
    sorted.sort((a, b) => (a.displayName || a.lineUserId).localeCompare(b.displayName || b.lineUserId, 'th'));
  } else {
    sorted.sort((a, b) => {
      const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return sort === 'oldest' ? aTime - bTime : bTime - aTime;
    });
  }
  return sorted;
}

// GET /api/conversations
router.get('/', auth, async (req, res) => {
  const {
    status, channelId, channelIds, agentId, search, tagId, lifecycleStage, blocked,
    unansweredMinutes, sort = 'newest', page = 1, limit = 30,
  } = req.query;

  // Support both a single channelId (legacy) and a multi-select channelIds list (comma-separated).
  let selectedChannelIds = [];
  if (channelIds) selectedChannelIds = String(channelIds).split(',').filter(Boolean);
  else if (channelId) selectedChannelIds = [channelId];

  const where = {};
  if (status) where.status = status;
  else if (unansweredMinutes) {
    // Business rule (see reports.js /unanswered): a conversation on "pending"
    // isn't actionable — nobody's expected to reply while it's on hold. Only
    // apply this default when the caller hasn't explicitly picked a status
    // themselves (handled by the `if (status)` branch above taking priority).
    where.status = { in: ['open', 'closed'] };
  }
  if (lifecycleStage) where.lifecycleStage = lifecycleStage;
  if (selectedChannelIds.length > 0) where.channelId = { in: selectedChannelIds };
  if (agentId === 'me') where.agentId = req.agent.id;
  else if (agentId === 'unassigned') where.agentId = null;
  else if (agentId) where.agentId = agentId;
  if (tagId) where.tags = { some: { tagId } };
  if (blocked !== undefined) where.blocked = blocked === 'true';
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

  const includeOpts = {
    ...CONV_INCLUDE,
    messages: {
      orderBy: { createdAt: 'desc' },
      take: 1,
      select: { content: true, sender: true, createdAt: true, type: true },
    },
    _count: { select: { messages: { where: { read: false, sender: 'user' } } } },
  };

  // The "unanswered for at least X minutes" filter depends on each
  // conversation's latest message, which isn't something a plain Prisma
  // `where` can express — so this path fetches a capped batch matching every
  // OTHER filter, does the unanswered check + sort + pagination in JS. Same
  // approach as reports.js's /unanswered endpoint, generalized to a
  // caller-supplied threshold instead of a fixed 10 minutes.
  if (unansweredMinutes) {
    const all = await prisma.conversation.findMany({ where, include: includeOpts, take: 3000 });
    const cutoff = new Date(Date.now() - Number(unansweredMinutes) * 60 * 1000);
    const filtered = all.filter(c => c.messages[0]?.sender === 'user' && new Date(c.messages[0].createdAt) <= cutoff);
    const sorted = sortConversationsInMemory(filtered, sort);
    const start = (Number(page) - 1) * Number(limit);
    const conversations = sorted.slice(start, start + Number(limit));
    return res.json({ conversations, total: filtered.length, page: Number(page), limit: Number(limit) });
  }

  const [total, conversations] = await Promise.all([
    prisma.conversation.count({ where }),
    prisma.conversation.findMany({
      where,
      include: includeOpts,
      orderBy: sort === 'name' ? { displayName: 'asc' } : { lastMessageAt: sort === 'oldest' ? 'asc' : 'desc' },
      skip: (page - 1) * limit,
      take: Number(limit),
    }),
  ]);

  res.json({ conversations, total, page: Number(page), limit: Number(limit) });
});

// GET /api/conversations/summary — aggregate counts for the Customers directory
// overview cards. Respects the same channel-visibility restriction as the list
// above. "unanswered" uses a fixed 10-minute threshold as a quick at-a-glance
// figure — the list itself lets the caller pick a different threshold to
// actually filter by (see unansweredMinutes above). Declared before GET /:id
// so "summary" isn't swallowed as an :id value.
router.get('/summary', auth, async (req, res) => {
  const visibleChannelIds = await getVisibleChannelIds(req.agent);
  const baseWhere = visibleChannelIds ? { channelId: { in: visibleChannelIds } } : {};

  const [total, open, pending, closed, blockedCount, unansweredCandidates] = await Promise.all([
    prisma.conversation.count({ where: baseWhere }),
    prisma.conversation.count({ where: { ...baseWhere, status: 'open' } }),
    prisma.conversation.count({ where: { ...baseWhere, status: 'pending' } }),
    prisma.conversation.count({ where: { ...baseWhere, status: 'closed' } }),
    prisma.conversation.count({ where: { ...baseWhere, blocked: true } }),
    prisma.conversation.findMany({
      where: { ...baseWhere, status: { in: ['open', 'closed'] } },
      select: { messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { sender: true, createdAt: true } } },
      take: 3000,
    }),
  ]);

  const cutoff = new Date(Date.now() - 10 * 60 * 1000);
  const unanswered = unansweredCandidates.filter(
    c => c.messages[0]?.sender === 'user' && new Date(c.messages[0].createdAt) <= cutoff
  ).length;

  res.json({ total, open, pending, closed, blocked: blockedCount, unanswered });
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
    const { status, agentId, displayName, notes, lifecycleStage, blocked } = req.body;
    const data = {};
    if (status) data.status = status;
    if (agentId !== undefined) data.agentId = agentId || null;
    if (displayName !== undefined) {
      data.displayName = displayName;
      // Once an agent sets this by hand, stop letting incoming LINE messages
      // silently revert it back to the customer's LINE profile name.
      data.displayNameCustomized = true;
    }
    if (notes !== undefined) data.notes = notes;
    if (lifecycleStage) data.lifecycleStage = lifecycleStage;
    // Manual override for the "customer blocked us" flag — needed because a
    // block that happened before this feature existed (or if a webhook event
    // was somehow missed) can't be detected after the fact; there's no LINE
    // API to query current block status, only the 'unfollow'/'follow' webhook
    // events going forward (see line.service.js).
    if (blocked !== undefined) {
      data.blocked = !!blocked;
      data.blockedAt = blocked ? new Date() : null;
    }

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
