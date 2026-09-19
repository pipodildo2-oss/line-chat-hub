// Shared by GET /api/upsells/agents (upsells.js) and the monthly Telegram
// report (telegramReport.js) — both need the exact same "one row per agent,
// with pending/approved/rejected counts + approved amount for a date range"
// summary, so it lives here once instead of drifting apart in two places.
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Bangkok-local day boundaries — same pattern duplicated in
// upsells.js/reports.js (see those files' own copies for why: a plain UTC
// comparison would silently shift by whatever timezone the DB session
// happens to be in on a given deploy).
function dayStart(dateStr) { return new Date(`${dateStr}T00:00:00.000+07:00`); }
function dayEnd(dateStr) { return new Date(`${dateStr}T23:59:59.999+07:00`); }

// Same computation as GET /api/upsells/agents in upsells.js — one row per
// agent with total/pending/approved/rejected submission counts, approved
// amount, and activity (messages sent / conversations handled), all scoped
// to [from, to] (either or both omitted = unbounded on that side). Pass
// includeAll to get every agent regardless of whether they've submitted
// anything (see upsells.js's own doc comment on that flag).
async function getAgentUpsellSummary({ from, to, includeAll } = {}) {
  const dateWhere = {};
  if (from || to) {
    dateWhere.createdAt = {};
    if (from) dateWhere.createdAt.gte = dayStart(from);
    if (to) dateWhere.createdAt.lte = dayEnd(to);
  }

  const msgParams = [];
  let msgDateSql = '';
  if (from) { msgParams.push(dayStart(from)); msgDateSql += ` AND ("createdAt" AT TIME ZONE 'UTC') >= $${msgParams.length}`; }
  if (to) { msgParams.push(dayEnd(to)); msgDateSql += ` AND ("createdAt" AT TIME ZONE 'UTC') <= $${msgParams.length}`; }

  const [agents, statusGroups, amountGroups, activityRows] = await Promise.all([
    prisma.agent.findMany({
      where: { role: 'agent' },
      select: { id: true, name: true, email: true, categoryId: true, category: { select: { id: true, name: true } } },
    }),
    prisma.upsellSubmission.groupBy({ by: ['agentId', 'status'], where: dateWhere, _count: { _all: true } }),
    prisma.upsellSubmission.groupBy({ by: ['agentId'], where: { ...dateWhere, status: 'approved' }, _sum: { amount: true } }),
    prisma.$queryRawUnsafe(
      `SELECT "senderId" as "agentId", COUNT(DISTINCT "conversationId")::int as "conversationsHandled", COUNT(*)::int as "messagesSent"
       FROM "Message" WHERE sender = 'agent' AND "senderId" IS NOT NULL ${msgDateSql}
       GROUP BY "senderId"`,
      ...msgParams,
    ),
  ]);

  const byAgent = {};
  for (const g of statusGroups) {
    const bucket = (byAgent[g.agentId] ||= { total: 0, pending: 0, approved: 0, rejected: 0 });
    bucket.total += g._count._all;
    if (g.status === 'pending') bucket.pending += g._count._all;
    if (g.status === 'approved') bucket.approved += g._count._all;
    if (g.status === 'rejected') bucket.rejected += g._count._all;
  }
  const amountByAgent = {};
  for (const g of amountGroups) amountByAgent[g.agentId] = g._sum.amount || 0;
  const activityByAgent = {};
  for (const r of activityRows) activityByAgent[r.agentId] = r;

  return agents
    .filter(a => includeAll || byAgent[a.id])
    .map(a => ({
      id: a.id,
      name: a.name,
      email: a.email,
      categoryId: a.categoryId,
      categoryName: a.category?.name || null,
      total: byAgent[a.id]?.total || 0,
      pending: byAgent[a.id]?.pending || 0,
      approved: byAgent[a.id]?.approved || 0,
      rejected: byAgent[a.id]?.rejected || 0,
      approvedAmount: amountByAgent[a.id] || 0,
      messagesSent: activityByAgent[a.id]?.messagesSent || 0,
      conversationsHandled: activityByAgent[a.id]?.conversationsHandled || 0,
    }))
    .sort((x, y) => (y.pending - x.pending) || (y.total - x.total));
}

// Ports the exact grouping/ranking Upsell.jsx's UpsellScorePage computes
// client-side (its `teams` useMemo) so the Telegram report shows the same
// per-team leaderboard order a supervisor sees on the คะแนน page — only
// agents with at least one approved upsell are included (matching
// `overallRanked` there), grouped by team, teams ordered by total approved
// amount descending, and each team's agents ranked by approved amount desc
// (approved count as tiebreak).
function groupAndRankByTeam(agents) {
  const ranked = agents.filter(a => a.approved > 0);
  if (!ranked.length) return [];
  const byTeam = {};
  for (const a of ranked) {
    const key = a.categoryId || '__none__';
    (byTeam[key] ||= { id: a.categoryId, name: a.categoryName || 'ไม่มีทีม', agents: [] }).agents.push(a);
  }
  const groups = Object.values(byTeam).map(g => ({
    ...g,
    approved: g.agents.reduce((s, a) => s + a.approved, 0),
    approvedAmount: g.agents.reduce((s, a) => s + a.approvedAmount, 0),
  }));
  groups.sort((x, y) => y.approvedAmount - x.approvedAmount);
  for (const g of groups) {
    g.agents = [...g.agents].sort((a, b) => b.approvedAmount - a.approvedAmount || b.approved - a.approved);
  }
  return groups;
}

module.exports = { dayStart, dayEnd, getAgentUpsellSummary, groupAndRankByTeam };
