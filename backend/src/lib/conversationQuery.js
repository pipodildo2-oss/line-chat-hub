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
    blocked, agentCategoryId, unansweredMinutes, minDaysInactive,
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
    // A customer who never got a single message is at least as "gone quiet"
    // as one whose last message is N days old, so null counts as a match too.
    const cutoff = new Date(Date.now() - Number(minDaysInactive) * 24 * 60 * 60 * 1000);
    andConds.push({
      OR: [
        { lastMessageAt: { lte: cutoff } },
        { lastMessageAt: null },
      ],
    });
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

module.exports = { getVisibleChannelIds, buildConversationWhere, daysInactive };
