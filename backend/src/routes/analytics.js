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
  const { from, to } = req.query;
  const toDate = to ? new Date(`${to}T23:59:59.999`) : new Date();
  const fromDate = from ? new Date(`${from}T00:00:00.000`) : new Date(toDate.getTime() - 6 * 24 * 60 * 60 * 1000);

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
