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
  // A single selected day ("วันนี้"/"เมื่อวาน", or the same custom date picked
  // twice) only has one day-level bucket to plot — not a useful bar chart —
  // so the activity chart switches to hourly buckets for just that day
  // instead. `activityGranularity` in the response tells the frontend which
  // shape `recentActivity` is in so it labels the X-axis correctly.
  const isSingleDay = !!(from && to && from === to);

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
    // Messages per day (or per hour, for a single selected day) within the
    // selected range.
    //
    // "createdAt" is a `timestamp` column with NO time zone attached, but
    // Prisma always writes/reads it as raw UTC digits regardless of the
    // Postgres session's own timezone setting (confirmed against this app's
    // actual DB — the session defaults to Asia/Bangkok locally, yet the
    // stored literal for a message sent at 23:35 UTC is "23:35", not the
    // Bangkok wall-clock "06:35"). That mismatch matters here because a bind
    // parameter ($1/$2, always `timestamptz`) compared directly against a
    // naive column gets implicitly cast using the SESSION timezone, not UTC
    // — under a non-UTC session (as here) that silently shifts the WHERE
    // boundary by the session's offset. Wrapping the column in
    // `AT TIME ZONE 'UTC'` first (a single-step conversion, whose source
    // interpretation is always the explicitly named zone, never the session
    // default) turns it into a real instant, making the comparison correct
    // regardless of what timezone the session happens to be in.
    //
    // Separately, `date_trunc('day', ...)` on the naive column would bucket
    // by literal UTC calendar day — wrong for "what day was this in
    // Thailand," where a message sent at 1am Bangkok (6pm UTC the day
    // before) belongs to the NEXT calendar day locally. The day query below
    // converts to Bangkok wall-clock first for the same reason the hour
    // query already needs to.
    isSingleDay
      ? prisma.$queryRawUnsafe(
          `SELECT to_char(date_trunc('hour', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Bangkok'), 'HH24:00') as date, COUNT(*)::int as count
           FROM "Message" WHERE ("createdAt" AT TIME ZONE 'UTC') >= $1 AND ("createdAt" AT TIME ZONE 'UTC') <= $2
           GROUP BY date_trunc('hour', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Bangkok') ORDER BY date_trunc('hour', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Bangkok') ASC`,
          fromDate, toDate
        )
      : prisma.$queryRawUnsafe(
          `SELECT to_char(date_trunc('day', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Bangkok'), 'YYYY-MM-DD') as date, COUNT(*)::int as count
           FROM "Message" WHERE ("createdAt" AT TIME ZONE 'UTC') >= $1 AND ("createdAt" AT TIME ZONE 'UTC') <= $2
           GROUP BY date_trunc('day', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Bangkok') ORDER BY date_trunc('day', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Bangkok') ASC`,
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
    activityGranularity: isSingleDay ? 'hour' : 'day',
  });
});

module.exports = router;
