const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const auth = require('../middleware/auth');
const { getAgentConductGraceSeconds } = require('../lib/systemSettings');

const prisma = new PrismaClient();

function requireAdmin(req, res, next) {
  if (req.agent.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// `from`/`to` query params are plain "YYYY-MM-DD" strings computed in the
// BROWSER's local timezone (Thailand, UTC+7) — e.g. the date-range pickers on
// the Report page. Parsing them with no offset makes JS interpret them in the
// SERVER's local timezone instead, which on Railway is UTC — silently
// shifting the intended day boundary 7 hours later than the browser meant
// (a report for "today" would miss anything before 7am Bangkok time, and in
// the worst case — checking a report in the early Bangkok morning — the
// window's start is still in the future, so it reads empty even though
// matching rows already exist). The explicit +07:00 makes the boundary
// unambiguous regardless of what timezone the server process itself runs in.
function dayStart(dateStr) { return new Date(`${dateStr}T00:00:00.000+07:00`); }
function dayEnd(dateStr) { return new Date(`${dateStr}T23:59:59.999+07:00`); }

// GET /api/reports/flagged-messages?from=&to=&severity=&category=&agentId=
// Admin-only — powers the KPI review Report page. Only ever contains messages
// flagged by a check going forward from when that check shipped — no
// historical backfill. Three categories share this list: "moderation" (bad
// words, moderation.service.js), "spam" (repeated-message check, same
// service — split out from "moderation" as its own category so it doesn't
// get counted as profanity), and "link" (unauthorized link, linkGuard.js) —
// rows flagged before flagCategory existed are null, treated as
// "moderation" everywhere below since that was the only category then
// (spam didn't have its own value yet either, so old spam-flagged rows stay
// bucketed under "moderation" too — no retroactive reclassification).
router.get('/flagged-messages', auth, requireAdmin, async (req, res) => {
  const { from, to, severity, category, agentId } = req.query;

  // baseWhere excludes the severity/category tab filters, so the summary
  // counts below always reflect the true totals for the selected date/agent
  // regardless of which tab is currently active — otherwise switching to the
  // "minor" tab would make the "severe" stat card show 0.
  const baseWhere = { flagged: true };
  if (agentId) baseWhere.senderId = agentId;
  if (from || to) {
    baseWhere.createdAt = {};
    if (from) baseWhere.createdAt.gte = dayStart(from);
    if (to) baseWhere.createdAt.lte = dayEnd(to);
  }
  const where = { ...baseWhere };
  if (severity) where.flagSeverity = severity;
  if (category === 'link') where.flagCategory = 'link';
  else if (category === 'spam') where.flagCategory = 'spam';
  else if (category === 'moderation') where.OR = [{ flagCategory: 'moderation' }, { flagCategory: null }];

  const [messages, totalFlagged, severeCount, minorCount, linkCount, spamCount] = await Promise.all([
    prisma.message.findMany({
      where,
      select: {
        id: true, content: true, flagSeverity: true, flagReason: true, flagCategory: true, createdAt: true,
        senderName: true, senderId: true,
        senderAgent: { select: { id: true, name: true } },
        conversation: {
          select: { id: true, displayName: true, lineUserId: true, channel: { select: { id: true, name: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    }),
    prisma.message.count({ where: baseWhere }),
    prisma.message.count({ where: { ...baseWhere, flagSeverity: 'severe' } }),
    prisma.message.count({ where: { ...baseWhere, flagSeverity: 'minor' } }),
    prisma.message.count({ where: { ...baseWhere, flagCategory: 'link' } }),
    prisma.message.count({ where: { ...baseWhere, flagCategory: 'spam' } }),
  ]);

  res.json({
    messages, totalFlagged, severeCount, minorCount, linkCount, spamCount,
    moderationCount: totalFlagged - linkCount - spamCount,
  });
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
  const { channelId, channelIds, agentId, channelActive } = req.query;
  const where = { status: { in: ['open', 'closed'] } };
  // Supports both a single channelId (legacy) and a multi-select channelIds
  // list (comma-separated) — same pattern as conversations.js's GET /.
  if (channelIds) {
    const ids = String(channelIds).split(',').filter(Boolean);
    if (ids.length > 0) where.channelId = { in: ids };
  } else if (channelId) {
    where.channelId = channelId;
  }
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

// ---------- Employee conduct ("พนักงาน") ----------
// Rolls up two existing signals into one per-agent view instead of leaving
// them scattered: (1) flagged messages (moderation.service.js result on
// content this agent typed — see /flagged-messages above) and (2) the
// "viewed a customer message but didn't reply" audit trail (MessageView —
// see schema.prisma). Both are bounded by the same from/to range as the rest
// of this report, filtered on MessageView.viewedAt (when the agent opened
// it) — note a row only exists at all while still unanswered, so this reads
// as "still-unresolved items that were first opened during this date
// range," not a full historical log of every view that ever happened.
//
// A row disappears (never counted here) as soon as EITHER that agent
// personally replies, OR anyone else does within the configured grace
// window of the customer message that triggered it — see
// clearMessageViewsAfterReply (lib/messageViewClear.js), called from both
// messages.js and quickReplies.js after a send succeeds. Multiple agents
// having the same still-unanswered chat open at once is normal, not
// misconduct on its own; only the ones still sitting unanswered past the
// grace window (Settings > "ระบบ", default 60s) actually get flagged below —
// a row that's SURVIVED to this point but hasn't hit that age yet is still
// within its grace period and deliberately excluded, not yet a verdict.
function agentConductViewCutoff(graceSeconds) {
  return new Date(Date.now() - graceSeconds * 1000);
}

// GET /api/reports/agent-conduct?from=&to= — overview, one row per agent.
router.get('/agent-conduct', auth, requireAdmin, async (req, res) => {
  const { from, to } = req.query;
  const graceSeconds = await getAgentConductGraceSeconds();
  const flaggedWhere = { flagged: true, senderId: { not: null } };
  const viewWhere = { message: { createdAt: { lte: agentConductViewCutoff(graceSeconds) } } };
  if (from || to) {
    flaggedWhere.createdAt = {};
    viewWhere.viewedAt = {};
    if (from) { flaggedWhere.createdAt.gte = dayStart(from); viewWhere.viewedAt.gte = dayStart(from); }
    if (to) { flaggedWhere.createdAt.lte = dayEnd(to); viewWhere.viewedAt.lte = dayEnd(to); }
  }

  const [agents, flaggedGroups, viewGroups] = await Promise.all([
    // categoryId/category included so the frontend can group this same data
    // by team ("รายทีม") without a second round-trip — see "หมวดหมู่ทีมงาน" in
    // Settings (AgentCategory) for what this grouping is.
    prisma.agent.findMany({
      select: { id: true, name: true, email: true, role: true, categoryId: true, category: { select: { id: true, name: true } } },
    }),
    prisma.message.groupBy({ by: ['senderId', 'flagSeverity'], where: flaggedWhere, _count: { _all: true } }),
    prisma.messageView.groupBy({ by: ['agentId'], where: viewWhere, _count: { _all: true } }),
  ]);

  const flaggedByAgent = {}; // agentId -> { total, severe, minor }
  for (const g of flaggedGroups) {
    const bucket = (flaggedByAgent[g.senderId] ||= { total: 0, severe: 0, minor: 0 });
    bucket.total += g._count._all;
    if (g.flagSeverity === 'severe') bucket.severe += g._count._all;
    if (g.flagSeverity === 'minor') bucket.minor += g._count._all;
  }
  const viewedByAgent = {}; // agentId -> count
  for (const g of viewGroups) viewedByAgent[g.agentId] = g._count._all;

  const summary = agents
    .map(a => ({
      id: a.id,
      name: a.name,
      email: a.email,
      role: a.role,
      categoryId: a.categoryId,
      categoryName: a.category?.name || null,
      flaggedTotal: flaggedByAgent[a.id]?.total || 0,
      flaggedSevere: flaggedByAgent[a.id]?.severe || 0,
      flaggedMinor: flaggedByAgent[a.id]?.minor || 0,
      viewedNoReplyCount: viewedByAgent[a.id] || 0,
    }))
    // Worst-first: whoever currently has the most open "viewed but didn't
    // reply" items floats to the top, tie-broken by flagged message count —
    // this is meant as a triage list, not an alphabetical directory.
    .sort((x, y) => (y.viewedNoReplyCount - x.viewedNoReplyCount) || (y.flaggedTotal - x.flaggedTotal));

  res.json({
    agents: summary,
    totalViewedNoReply: summary.reduce((s, a) => s + a.viewedNoReplyCount, 0),
  });
});

// GET /api/reports/agent-conduct/:agentId?from=&to= — drill-down for one agent.
router.get('/agent-conduct/:agentId', auth, requireAdmin, async (req, res) => {
  const { agentId } = req.params;
  const { from, to } = req.query;
  const graceSeconds = await getAgentConductGraceSeconds();

  const flaggedWhere = { flagged: true, senderId: agentId };
  const viewWhere = { agentId, message: { createdAt: { lte: agentConductViewCutoff(graceSeconds) } } };
  if (from || to) {
    flaggedWhere.createdAt = {};
    viewWhere.viewedAt = {};
    if (from) { flaggedWhere.createdAt.gte = dayStart(from); viewWhere.viewedAt.gte = dayStart(from); }
    if (to) { flaggedWhere.createdAt.lte = dayEnd(to); viewWhere.viewedAt.lte = dayEnd(to); }
  }

  const [agent, flaggedMessages, viewedNoReply] = await Promise.all([
    prisma.agent.findUnique({ where: { id: agentId }, select: { id: true, name: true, email: true, role: true } }),
    prisma.message.findMany({
      where: flaggedWhere,
      select: {
        id: true, content: true, flagSeverity: true, flagReason: true, createdAt: true,
        conversation: { select: { id: true, displayName: true, lineUserId: true, channel: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    prisma.messageView.findMany({
      where: viewWhere,
      select: {
        id: true, viewedAt: true,
        message: {
          select: {
            id: true, content: true, type: true, createdAt: true,
            conversation: { select: { id: true, displayName: true, lineUserId: true, channel: { select: { id: true, name: true } } } },
          },
        },
      },
      orderBy: { viewedAt: 'desc' },
      take: 200,
    }),
  ]);

  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  res.json({ agent, flaggedMessages, viewedNoReply });
});

module.exports = router;
