const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const auth = require('../middleware/auth');
const { emitToAll } = require('../services/socket.service');
const { getVisibleChannelIds, canAccessChannel, buildConversationWhere, daysInactive } = require('../lib/conversationQuery');

const prisma = new PrismaClient();

const CONV_INCLUDE = {
  channel: { select: { id: true, name: true, active: true } },
  agent: { select: { id: true, name: true, categoryId: true, category: { select: { id: true, name: true } } } },
  tags: { include: { tag: true } },
};

// Adds the computed daysInactive field to every row in a conversation list —
// used by the "ตามลูกค้า" follow-up report to sort/label how stale a customer
// is without the frontend having to redo the date math.
function withDaysInactive(list) {
  return list.map(c => ({ ...c, daysInactive: daysInactive(c.lastMessageAt) }));
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
  const { unansweredMinutes, sort = 'newest', page = 1, limit = 30 } = req.query;

  const { where, selectedChannelIds } = buildConversationWhere(req.query, req.agent.id);

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
    const conversations = withDaysInactive(sorted.slice(start, start + Number(limit)));
    return res.json({ conversations, total: filtered.length, page: Number(page), limit: Number(limit) });
  }

  // sort=oldest ("หายไปนานสุดก่อน" on the follow-up report) puts never-messaged
  // customers first — they're at least as stale as any real timestamp. newest
  // (default) puts them last, behind every conversation that has activity.
  let orderBy;
  if (sort === 'name') orderBy = { displayName: 'asc' };
  else if (sort === 'oldest') orderBy = { lastMessageAt: { sort: 'asc', nulls: 'first' } };
  else orderBy = { lastMessageAt: { sort: 'desc', nulls: 'last' } };

  const [total, conversations] = await Promise.all([
    prisma.conversation.count({ where }),
    prisma.conversation.findMany({
      where,
      include: includeOpts,
      orderBy,
      skip: (page - 1) * limit,
      take: Number(limit),
    }),
  ]);

  res.json({ conversations: withDaysInactive(conversations), total, page: Number(page), limit: Number(limit) });
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

  // Inactivity buckets for the "ตามลูกค้า" follow-up report's clickable summary
  // cards — cheap since lastMessageAt is indexed (schema.prisma). Each count is
  // "at least N days inactive OR never messaged," same rule as minDaysInactive
  // in conversationQuery.js, so clicking a card and seeing that count match up
  // with the filtered list underneath it — separate query per bucket rather
  // than a single groupBy since the buckets overlap (open-ended >=N, not bins).
  const inactiveDaysCutoff = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const inactiveWhere = (days) => ({
    ...baseWhere,
    OR: [{ lastMessageAt: { lte: inactiveDaysCutoff(days) } }, { lastMessageAt: null }],
  });

  const [
    total, open, pending, closed, blockedCount, unansweredCandidates,
    inactive3, inactive7, inactive14, inactive30, inactive60, neverMessaged,
  ] = await Promise.all([
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
    prisma.conversation.count({ where: inactiveWhere(3) }),
    prisma.conversation.count({ where: inactiveWhere(7) }),
    prisma.conversation.count({ where: inactiveWhere(14) }),
    prisma.conversation.count({ where: inactiveWhere(30) }),
    prisma.conversation.count({ where: inactiveWhere(60) }),
    prisma.conversation.count({ where: { ...baseWhere, lastMessageAt: null } }),
  ]);

  const cutoff = new Date(Date.now() - 10 * 60 * 1000);
  const unanswered = unansweredCandidates.filter(
    c => c.messages[0]?.sender === 'user' && new Date(c.messages[0].createdAt) <= cutoff
  ).length;

  res.json({
    total, open, pending, closed, blocked: blockedCount, unanswered,
    inactive3, inactive7, inactive14, inactive30, inactive60, neverMessaged,
  });
});

// GET /api/conversations/:id
router.get('/:id', auth, async (req, res) => {
  const conversation = await prisma.conversation.findUnique({
    where: { id: req.params.id },
    // Scoped `channel` select (not `channel: true`) — the full LineChannel
    // row includes channelSecret/accessToken, which has no reason to ever
    // reach an agent's browser just because they opened a chat.
    include: CONV_INCLUDE,
  });
  if (!conversation) return res.status(404).json({ error: 'Not found' });
  // A channel-restricted agent has no reason to reach a conversation outside
  // their assigned channels just by knowing/guessing its id — the list view
  // (GET /) already hides it from them; this closes the same gap for direct
  // access. Admins and unrestricted agents are unaffected (canAccessChannel
  // returns true for them regardless of channelId).
  if (!(await canAccessChannel(req.agent, conversation.channelId))) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.json(conversation);
});

// PATCH /api/conversations/:id
router.patch('/:id', auth, async (req, res) => {
  try {
    const existing = await prisma.conversation.findUnique({ where: { id: req.params.id }, select: { channelId: true } });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (!(await canAccessChannel(req.agent, existing.channelId))) {
      return res.status(404).json({ error: 'Not found' });
    }

    const { status, agentId, displayName, notes, lifecycleStage, blocked, caution, cautionReason } = req.body;
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
    // "ระวังลูกค้าคนนี้ไว้" — a manual, no-role-restriction warning flag (see
    // schema.prisma) so any agent can leave a heads-up for whoever handles
    // this customer next, e.g. a history of rudeness or chargebacks.
    // Toggling this off deliberately does NOT clear cautionReason — the
    // explanation is meant to persist (so re-flagging the same customer
    // later doesn't require re-typing it) until someone clears the text
    // themselves via cautionReason below.
    if (caution !== undefined) data.caution = !!caution;
    if (cautionReason !== undefined) data.cautionReason = cautionReason?.trim() || null;

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

// GET /api/conversations/:id/notes — timestamped note log for the customer
// panel (replaces the old single Conversation.notes free-text field, see
// schema.prisma). Newest first, so the latest context is what an agent sees
// without scrolling.
router.get('/:id/notes', auth, async (req, res) => {
  const existing = await prisma.conversation.findUnique({ where: { id: req.params.id }, select: { channelId: true } });
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (!(await canAccessChannel(req.agent, existing.channelId))) {
    return res.status(404).json({ error: 'Not found' });
  }
  const notes = await prisma.conversationNote.findMany({
    where: { conversationId: req.params.id },
    select: { id: true, content: true, createdAt: true, updatedAt: true, agent: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(notes);
});

// POST /api/conversations/:id/notes — append a new note.
router.post('/:id/notes', auth, async (req, res) => {
  const content = req.body.content?.trim();
  if (!content) return res.status(400).json({ error: 'กรุณากรอกข้อความ' });

  const existing = await prisma.conversation.findUnique({ where: { id: req.params.id }, select: { channelId: true } });
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (!(await canAccessChannel(req.agent, existing.channelId))) {
    return res.status(404).json({ error: 'Not found' });
  }

  const note = await prisma.conversationNote.create({
    data: { conversationId: req.params.id, content, agentId: req.agent.id },
    select: { id: true, content: true, createdAt: true, updatedAt: true, agent: { select: { id: true, name: true } } },
  });
  emitToAll('conversation_note_added', { conversationId: req.params.id, note });
  res.status(201).json(note);
});

// PATCH /api/conversations/:id/notes/:noteId — edit an existing note's text.
// Any agent with access to the conversation can edit any note (same
// permission shape as the rest of the customer panel — tags/name/notes have
// never been restricted to whoever originally set them).
router.patch('/:id/notes/:noteId', auth, async (req, res) => {
  const content = req.body.content?.trim();
  if (!content) return res.status(400).json({ error: 'กรุณากรอกข้อความ' });

  const existing = await prisma.conversation.findUnique({ where: { id: req.params.id }, select: { channelId: true } });
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (!(await canAccessChannel(req.agent, existing.channelId))) {
    return res.status(404).json({ error: 'Not found' });
  }

  const note = await prisma.conversationNote.update({
    where: { id: req.params.noteId, conversationId: req.params.id },
    data: { content },
    select: { id: true, content: true, createdAt: true, updatedAt: true, agent: { select: { id: true, name: true } } },
  }).catch(() => null);
  if (!note) return res.status(404).json({ error: 'Not found' });

  emitToAll('conversation_note_updated', { conversationId: req.params.id, note });
  res.json(note);
});

// DELETE /api/conversations/:id/notes/:noteId — remove a note.
router.delete('/:id/notes/:noteId', auth, async (req, res) => {
  const existing = await prisma.conversation.findUnique({ where: { id: req.params.id }, select: { channelId: true } });
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (!(await canAccessChannel(req.agent, existing.channelId))) {
    return res.status(404).json({ error: 'Not found' });
  }

  const result = await prisma.conversationNote.deleteMany({ where: { id: req.params.noteId, conversationId: req.params.id } });
  if (result.count === 0) return res.status(404).json({ error: 'Not found' });

  emitToAll('conversation_note_deleted', { conversationId: req.params.id, noteId: req.params.noteId });
  res.json({ success: true });
});

module.exports = router;
