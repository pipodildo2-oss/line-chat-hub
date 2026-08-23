const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Returns the list of channelIds this agent is restricted to, or null if
// unrestricted (admin, or an agent with zero AgentChannel rows — see
// schema.prisma). Shared by conversations.js and broadcasts.js so both
// respect the same per-agent channel visibility rule.
async function getVisibleChannelIds(agent) {
  if (agent.role === 'admin') return null;
  const rows = await prisma.agentChannel.findMany({ where: { agentId: agent.id }, select: { channelId: true } });
  if (rows.length === 0) return null;
  return rows.map(r => r.channelId);
}

// Whether `agent` is allowed to see/act on a conversation on `channelId` —
// the single-record counterpart to getVisibleChannelIds(), which only ever
// got applied to LIST endpoints (GET /api/conversations, broadcast
// targeting). Every route that fetches or mutates ONE conversation/message
// by id must call this too, or a channel-restricted agent can bypass the
// restriction entirely just by knowing/guessing that record's id — the list
// view hiding it from them was never actually enforced anywhere else.
async function canAccessChannel(agent, channelId) {
  const visible = await getVisibleChannelIds(agent);
  return visible === null || visible.includes(channelId);
}

// Builds one comparison against a conversation's daysInactive() (see below —
// a floored day count, matching exactly what the frontend displays, e.g.
// "10 วัน") for the given N and operator:
//   gte (default, used by every preset chip/summary card — "N+" labels) —
//     daysInactive >= N. A customer who never got a single message is at
//     least as "gone quiet" as any finite N, so null counts as a match too.
//   lt  — daysInactive < N. Never-messaged customers are excluded (their
//     inactivity isn't "less than" anything finite).
//   gt  — daysInactive > N. Never-messaged customers are included (their
//     inactivity is greater than any finite N).
//   eq  — daysInactive === N exactly. Never-messaged customers are
//     excluded (they don't have a finite day count to equal N).
// cutoffAtLeastN = the boundary where daysInactive >= N; cutoffAtLeastNPlus1
// = the boundary where daysInactive >= N+1 (equivalently daysInactive > N).
function daysInactiveCondition(nRaw, op) {
  const msPerDay = 24 * 60 * 60 * 1000;
  const n = Number(nRaw);
  const cutoffAtLeastN = new Date(Date.now() - n * msPerDay);
  const cutoffAtLeastNPlus1 = new Date(Date.now() - (n + 1) * msPerDay);
  if (op === 'lt') return { lastMessageAt: { gt: cutoffAtLeastN } };
  if (op === 'gt') return { OR: [{ lastMessageAt: { lte: cutoffAtLeastNPlus1 } }, { lastMessageAt: null }] };
  if (op === 'eq') return { lastMessageAt: { lte: cutoffAtLeastN, gt: cutoffAtLeastNPlus1 } };
  return { OR: [{ lastMessageAt: { lte: cutoffAtLeastN } }, { lastMessageAt: null }] }; // gte
}

// Builds the shared Prisma `where` clause for filtering conversations —
// one filter vocabulary reused by the Customers directory (GET
// /api/conversations), the "ตามลูกค้า" follow-up report (same endpoint, wider
// filter set), and broadcast targeting (broadcasts.js, mode: 'filter').
// Deliberately does NOT apply the per-agent channel-visibility restriction —
// that needs to interact with `channelIds`/`selectedChannelIds` differently
// per caller (e.g. conversations.js narrows to the intersection and short-
// circuits to an empty result if none match; broadcasts.js is admin-only so
// visibility is always unrestricted there). Callers combine this `where` with
// getVisibleChannelIds() themselves.
//
// Returns { where, selectedChannelIds } — selectedChannelIds is handed back
// so callers can do that intersection without re-parsing channelId/channelIds.
function buildConversationWhere(query, meAgentId) {
  const {
    status, channelId, channelIds, agentId, search, tagId, tagIds, lifecycleStage,
    blocked, agentCategoryId, unansweredMinutes, minDaysInactive, daysInactiveOp,
    minDaysInactive2, daysInactiveOp2, daysInactiveCombine,
  } = query;

  let selectedChannelIds = [];
  if (channelIds) selectedChannelIds = String(channelIds).split(',').filter(Boolean);
  else if (channelId) selectedChannelIds = [channelId];

  const where = {};
  if (status) where.status = status;
  else if (unansweredMinutes) {
    // Business rule (see reports.js /unanswered): a conversation on "pending"
    // isn't actionable — nobody's expected to reply while it's on hold.
    where.status = { in: ['open', 'closed'] };
  }
  if (lifecycleStage) where.lifecycleStage = lifecycleStage;
  if (selectedChannelIds.length > 0) where.channelId = { in: selectedChannelIds };
  if (agentId === 'me') where.agentId = meAgentId;
  else if (agentId === 'unassigned') where.agentId = null;
  else if (agentId) where.agentId = agentId;
  // "ทีมงาน" (AgentCategory) filter — narrows to conversations whose assigned
  // agent belongs to this team. 'none' = assigned to an agent with no team.
  if (agentCategoryId === 'none') where.agent = { categoryId: null };
  else if (agentCategoryId) where.agent = { categoryId: agentCategoryId };
  if (tagIds) {
    const ids = String(tagIds).split(',').filter(Boolean);
    if (ids.length > 0) where.tags = { some: { tagId: { in: ids } } };
  } else if (tagId) {
    where.tags = { some: { tagId } };
  }
  if (blocked !== undefined) where.blocked = blocked === 'true';

  // search and minDaysInactive each need their own OR clause — combined via
  // AND so they don't clobber each other on Prisma's single `where.OR` key.
  const andConds = [];
  if (search) {
    andConds.push({
      OR: [
        { displayName: { contains: search, mode: 'insensitive' } },
        { lineUserId: { contains: search } },
      ],
    });
  }
  if (minDaysInactive) {
    const cond1 = daysInactiveCondition(minDaysInactive, daysInactiveOp || 'gte');
    // A second condition (from the follow-up report's "+ เพิ่มเงื่อนไข" toggle)
    // combined with the first via AND (e.g. "มากกว่า 5 AND น้อยกว่า 10" — a
    // range) or OR (e.g. "น้อยกว่า 3 OR มากกว่า 30" — new-ish or long-abandoned
    // customers, excluding the middle). Only ever a flat pair, not a general
    // condition tree — good enough for "narrow to a range" / "either end,"
    // which covers what a custom day filter like this actually needs.
    if (minDaysInactive2) {
      const cond2 = daysInactiveCondition(minDaysInactive2, daysInactiveOp2 || 'gte');
      andConds.push(daysInactiveCombine === 'or' ? { OR: [cond1, cond2] } : { AND: [cond1, cond2] });
    } else {
      andConds.push(cond1);
    }
  }
  if (andConds.length > 0) where.AND = andConds;

  return { where, selectedChannelIds };
}

// Whole days since lastMessageAt, or null for a conversation that never had a
// message at all (rather than reporting it as "0 days inactive").
function daysInactive(lastMessageAt) {
  if (!lastMessageAt) return null;
  return Math.floor((Date.now() - new Date(lastMessageAt).getTime()) / (24 * 60 * 60 * 1000));
}

module.exports = { getVisibleChannelIds, canAccessChannel, buildConversationWhere, daysInactive };
