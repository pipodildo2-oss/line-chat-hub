const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const auth = require('../middleware/auth');

const prisma = new PrismaClient();

function requireAdmin(req, res, next) {
  if (req.agent.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// GET /api/reports/flagged-messages?from=&to=&severity=&agentId=
// Admin-only — powers the KPI review Report page. Only ever contains messages
// flagged by the AI moderation check going forward from when that feature
// shipped (see moderation.service.js) — no historical backfill.
router.get('/flagged-messages', auth, requireAdmin, async (req, res) => {
  const { from, to, severity, agentId } = req.query;

  // baseWhere excludes the severity tab filter, so the severity summary counts
  // below always reflect the true totals for the selected date/agent regardless
  // of which severity tab is currently active — otherwise switching to the
  // "minor" tab would make the "severe" stat card show 0.
  const baseWhere = { flagged: true };
  if (agentId) baseWhere.senderId = agentId;
  if (from || to) {
    baseWhere.createdAt = {};
    if (from) baseWhere.createdAt.gte = new Date(`${from}T00:00:00.000`);
    if (to) baseWhere.createdAt.lte = new Date(`${to}T23:59:59.999`);
  }
  const where = severity ? { ...baseWhere, flagSeverity: severity } : baseWhere;

  const [messages, totalFlagged, severeCount, minorCount] = await Promise.all([
    prisma.message.findMany({
      where,
      select: {
        id: true, content: true, flagSeverity: true, flagReason: true, createdAt: true,
        senderName: true, senderId: true,
        senderAgent: { select: { id: true, name: true } },
        conversation: {
          select: { id: true, displayName: true, lineUserId: true, channel: { select: { id: true, name: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
    }),
    prisma.message.count({ where: baseWhere }),
    prisma.message.count({ where: { ...baseWhere, flagSeverity: 'severe' } }),
    prisma.message.count({ where: { ...baseWhere, flagSeverity: 'minor' } }),
  ]);

  res.json({ messages, totalFlagged, severeCount, minorCount });
});

const UNANSWERED_GRACE_MS = 10 * 60 * 1000; // 10 minutes — don't flag a customer message the team hasn't had a fair chance to answer yet

// GET /api/reports/unanswered?channelId=&agentId=
// Admin-only — a live worklist, not a historical report. The team's rule is
// that an agent should always send the last message in any conversation, so
// this lists every open/closed conversation whose most recent message is
// instead from the customer AND has been sitting unanswered for at least 10
// minutes (a customer message from 30 seconds ago isn't "slipped through"
// yet, it just hasn't been gotten to). "Pending" is deliberately excluded —
// that bucket is for chats intentionally on hold, not ones that slipped
// through, so it shouldn't show up on this worklist.
// In practice, matching "closed" conversations should be rare-to-never: an
// incoming LINE message always flips status back to 'open' (see
// line.service.js), so a closed conversation can only end up here if that
// didn't happen — kept in the filter as a safety net rather than assumed away.
router.get('/unanswered', auth, requireAdmin, async (req, res) => {
  const { channelId, agentId, channelActive } = req.query;
  const where = { status: { in: ['open', 'closed'] } };
  if (channelId) where.channelId = channelId;
  if (agentId === 'unassigned') where.agentId = null;
  else if (agentId) where.agentId = agentId;
  // Filters on the related LineChannel's soft-disable flag (see channels.js /
  // schema.prisma) — lets an admin isolate unanswered chats on channels that
  // are still actively taking messages vs. ones currently paused.
  if (channelActive !== undefined) where.channel = { active: channelActive === 'true' };

  // Prisma can't filter on "the last item of a relation" at the DB level, so
  // fetch each conversation's single latest message (cheap — same take:1
  // pattern already used by GET /api/conversations) and filter by sender in
  // JS afterward. Capped at 1000 open/pending conversations, which is far
  // more headroom than this kind of single-team inbox should ever carry at once.
  const conversations = await prisma.conversation.findMany({
    where,
    include: {
      channel: { select: { id: true, name: true } },
      agent: { select: { id: true, name: true } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { sender: true, content: true, type: true, createdAt: true } },
    },
    orderBy: { lastMessageAt: 'asc' }, // oldest-waiting first — most urgent on top
    take: 1000,
  });

  const cutoff = new Date(Date.now() - UNANSWERED_GRACE_MS);
  const unanswered = conversations
    .filter(c => c.messages[0]?.sender === 'user' && c.messages[0].createdAt <= cutoff)
    .map(c => ({
      id: c.id,
      displayName: c.displayName,
      lineUserId: c.lineUserId,
      pictureUrl: c.pictureUrl,
      status: c.status,
      channel: c.channel,
      agent: c.agent,
      lastMessage: c.messages[0],
      waitingSince: c.messages[0].createdAt,
    }));

  res.json({ conversations: unanswered, total: unanswered.length });
});

module.exports = router;
