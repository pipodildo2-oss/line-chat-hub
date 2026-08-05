const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const auth = require('../middleware/auth');

const prisma = new PrismaClient();

// GET /api/analytics/summary
router.get('/summary', auth, async (req, res) => {
  const { days = 7 } = req.query;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

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
    prisma.conversation.count({ where: { createdAt: { gte: since } } }),
    prisma.conversation.groupBy({
      by: ['channelId'],
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    }),
    // Messages per day for the last N days (SQLite compatible)
    prisma.$queryRawUnsafe(
      `SELECT date(createdAt) as date, COUNT(*) as count FROM Message WHERE createdAt >= ? GROUP BY date(createdAt) ORDER BY date ASC`,
      since.toISOString()
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
