const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const auth = require('../middleware/auth');

const prisma = new PrismaClient();

// GET /api/analytics/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
// `from`/`to` scope the period-based numbers (new conversations, messages-per-day
// chart, conversations-by-channel breakdown). totalConversations/open/closed stay
// as current all-time snapshot counts regardless of the selected range — "currently
// open" doesn't really mean anything scoped to a past date range.
router.get('/summary', auth, async (req, res) => {
  // Global, cross-channel figures (total conversations, channel breakdown,
  // etc.) — the frontend only ever calls this from the admin-only Dashboard
  // page, but the API itself had no matching check, so a channel-restricted
  // agent could call it directly and see names/counts for every channel in
  // the system, not just the ones they're assigned to.
  if (req.agent.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { from, to } = req.query;
  // `from`/`to` are plain "YYYY-MM-DD" strings computed in the BROWSER's local
  // timezone (Thailand, UTC+7) — e.g. the "วันนี้" preset. Interpolating them
  // into `new Date(...)` with no offset makes JS parse them in the SERVER's
  // local timezone instead, which on Railway is UTC. That silently shifts
  // "today" 7 hours later than intended: a customer who messaged at 2am
  // Bangkok time wouldn't count as "today" until the server's UTC clock also
  // reaches midnight, 7 hours later — in the worst case (checking the
  // dashboard in the early Bangkok morning) the window's start is still in
  // the future, so newConversations reads 0 even though real messages came
  // in hours ago. The explicit +07:00 makes this unambiguous regardless of
  // what timezone the server process itself happens to be running in.
  const toDate = to ? new Date(`${to}T23:59:59.999+07:00`) : new Date();
  const fromDate = from ? new Date(`${from}T00:00:00.000+07:00`) : new Date(toDate.getTime() - 6 * 24 * 60 * 60 * 1000);

  const [
    totalConversations,
    openConversations,
    closedConversations,
    totalMessages,
    newConversations,
    conversationsByChannel,
    recentActivity,
  ] = await Promise.all([
    prisma.conversation.count(),
    prisma.conversation.count({ where: { status: 'open' } }),
    prisma.conversation.count({ where: { status: 'closed' } }),
    prisma.message.count(),
    prisma.conversation.count({ where: { createdAt: { gte: fromDate, lte: toDate } } }),
    prisma.conversation.groupBy({
      by: ['channelId'],
      where: { createdAt: { gte: fromDate, lte: toDate } },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    }),
    // Messages per day within the selected range (PostgreSQL)
    prisma.$queryRawUnsafe(
      `SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') as date, COUNT(*)::int as count
       FROM "Message" WHERE "createdAt" >= $1 AND "createdAt" <= $2
       GROUP BY date_trunc('day', "createdAt") ORDER BY date_trunc('day', "createdAt") ASC`,
      fromDate, toDate
    ),
  ]);

  // Attach channel names to groupBy result
  const channelIds = conversationsByChannel.map((r) => r.channelId);
  const channels = await prisma.lineChannel.findMany({
    where: { id: { in: channelIds } },
    select: { id: true, name: true },
  });
  const channelMap = Object.fromEntries(channels.map((c) => [c.id, c.name]));

  res.json({
    totalConversations,
    openConversations,
    closedConversations,
    totalMessages,
    newConversations,
    conversationsByChannel: conversationsByChannel.map((r) => ({
      channelId: r.channelId,
      channelName: channelMap[r.channelId] || r.channelId,
      count: r._count.id,
    })),
    recentActivity,
  });
});

module.exports = router;
