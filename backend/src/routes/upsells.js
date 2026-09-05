const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const auth = require('../middleware/auth');
const { canAccessChannel } = require('../lib/conversationQuery');
const { emitToConversation, emitToAll } = require('../services/socket.service');

const prisma = new PrismaClient();

function requireAdmin(req, res, next) {
  if (req.agent.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// `from`/`to` are plain "YYYY-MM-DD" strings computed in the BROWSER's local
// timezone (Thailand, UTC+7) — same convention as reports.js/analytics.js.
// Parsing with no offset would interpret them in the SERVER's timezone
// (UTC on Railway), silently shifting the day boundary — see those files'
// comments for the full failure mode this avoids.
function dayStart(dateStr) { return new Date(`${dateStr}T00:00:00.000+07:00`); }
function dayEnd(dateStr) { return new Date(`${dateStr}T23:59:59.999+07:00`); }

const SUBMISSION_ITEM_SELECT = {
  id: true,
  message: {
    select: {
      // lineMessageId distinguishes a customer-sent image (fetched through the
      // authenticated /api/messages/content/:lineMessageId proxy, see
      // messages.js) from an agent-sent one (metadata.url is a direct,
      // unauthenticated link) — the frontend needs it to know which to use.
      id: true, type: true, content: true, metadata: true, lineMessageId: true, createdAt: true,
      conversation: { select: { id: true, displayName: true, lineUserId: true, channel: { select: { id: true, name: true } } } },
    },
  },
};

// POST /api/upsells — any authenticated agent claims one or more messages as
// proof of an upsell. All messages must belong to the same conversation.
router.post('/', auth, async (req, res) => {
  const { messageIds } = req.body;
  if (!Array.isArray(messageIds) || messageIds.length === 0) {
    return res.status(400).json({ error: 'ต้องเลือกอย่างน้อย 1 ข้อความ' });
  }

  const messages = await prisma.message.findMany({
    where: { id: { in: messageIds } },
    select: { id: true, conversationId: true },
  });
  if (messages.length !== messageIds.length) {
    return res.status(400).json({ error: 'ไม่พบข้อความบางรายการ' });
  }
  const conversationIds = [...new Set(messages.map(m => m.conversationId))];
  if (conversationIds.length > 1) {
    return res.status(400).json({ error: 'เลือกได้เฉพาะข้อความในแชทเดียวกัน' });
  }
  const conversationId = conversationIds[0];

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { channelId: true },
  });
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
  if (!(await canAccessChannel(req.agent, conversation.channelId))) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  try {
    const submission = await prisma.$transaction(async (tx) => {
      // The lock is "no other ACTIVE (pending/approved) claim on this
      // message" — not "no UpsellSubmissionItem row at all." A rejected
      // claim leaves its row in place as history (see schema.prisma), so an
      // agent who picked the wrong message can redo it once it's rejected.
      // Checked inside the transaction, right before the create below, to
      // keep the race window as tight as possible (same residual risk as the
      // unique-constraint approach this replaced: two agents claiming the
      // exact same message in the same instant is vanishingly rare here).
      const conflicts = await tx.upsellSubmissionItem.findFirst({
        where: { messageId: { in: messageIds }, submission: { status: { not: 'rejected' } } },
        select: { id: true },
      });
      if (conflicts) {
        const err = new Error('ข้อความบางรายการถูกเลือกไปแล้ว');
        err.isActiveClaimConflict = true;
        throw err;
      }

      const created = await tx.upsellSubmission.create({
        data: { conversationId, agentId: req.agent.id },
      });
      await tx.upsellSubmissionItem.createMany({
        data: messageIds.map(messageId => ({ submissionId: created.id, messageId })),
      });
      return tx.upsellSubmission.findUnique({
        where: { id: created.id },
        include: { items: { select: SUBMISSION_ITEM_SELECT } },
      });
    });

    emitToConversation(conversationId, 'upsell_claimed', {
      messageIds,
      submissionId: submission.id,
      agentId: req.agent.id,
      agentName: req.agent.name,
    });

    res.status(201).json(submission);
  } catch (err) {
    if (err.isActiveClaimConflict) {
      return res.status(409).json({ error: err.message });
    }
    console.error('Upsell submit failed:', err.message);
    res.status(500).json({ error: 'ไม่สามารถส่งรายการอัพเซลล์ได้' });
  }
});

// GET /api/upsells/agents?from=&to=&includeAll= — admin overview, one row
// per agent. from/to (optional) scope every count to submissions/messages
// CREATED in that range — i.e. "activity during this period," which is what
// a team target/leaderboard for a given day/month should reflect, regardless
// of when a submission happened to get reviewed.
//
// By default only agents who have submitted at least one upsell are
// returned (ตรวจสอบ/คะแนน — reviewing/scoring submitters). Pass
// includeAll=1 to get every non-admin agent instead, even ones with zero
// submissions — used by the "รายงาน" activity-vs-upsell comparison table,
// where an agent who's busy in chat but has submitted NOTHING is exactly
// the row a supervisor most needs to see, not one that should be hidden.
router.get('/agents', auth, requireAdmin, async (req, res) => {
  const { from, to, includeAll } = req.query;
  const dateWhere = {};
  if (from || to) {
    dateWhere.createdAt = {};
    if (from) dateWhere.createdAt.gte = dayStart(from);
    if (to) dateWhere.createdAt.lte = dayEnd(to);
  }

  // Messages sent + distinct conversations replied to in the same range —
  // one raw query (senderId isn't otherwise groupable together with a
  // distinct-conversation count via plain Prisma groupBy). Conditionally
  // date-bounded the same way dateWhere is above, so omitting from/to still
  // means "all time" for callers that rely on that (ตรวจสอบ's worklist).
  // "createdAt" AT TIME ZONE 'UTC' (rather than comparing the naive column
  // to the bind param directly) — see analytics.js's recentActivity query
  // for why: a plain comparison implicitly casts using the Postgres
  // SESSION's timezone, which isn't guaranteed to be UTC, and would then
  // silently shift this boundary by that session's offset.
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

  const byAgent = {}; // agentId -> { total, pending, approved, rejected }
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

  const summary = agents
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
    // Worklist-first: agents with unreviewed submissions float to the top.
    // (includeAll callers re-sort client-side, so this default doesn't matter to them.)
    .sort((x, y) => (y.pending - x.pending) || (y.total - x.total));

  res.json({ agents: summary });
});

// GET /api/upsells?from=&to=&status=&agentCategoryId= — admin flat log of
// every submission across every agent, for the detailed รายงาน page (the
// score/leaderboard page above is the rollup; this is what backs it).
router.get('/', auth, requireAdmin, async (req, res) => {
  const { from, to, status, agentCategoryId } = req.query;
  const where = {};
  if (status) where.status = status;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = dayStart(from);
    if (to) where.createdAt.lte = dayEnd(to);
  }
  if (agentCategoryId) {
    where.agent = agentCategoryId === 'none' ? { categoryId: null } : { categoryId: agentCategoryId };
  }

  const submissions = await prisma.upsellSubmission.findMany({
    where,
    select: {
      id: true, status: true, amount: true, createdAt: true, reviewedAt: true,
      agent: { select: { id: true, name: true, categoryId: true, category: { select: { id: true, name: true } } } },
      reviewedBy: { select: { id: true, name: true } },
      items: {
        select: {
          message: {
            select: {
              id: true, createdAt: true,
              conversation: { select: { id: true, displayName: true, lineUserId: true, channel: { select: { name: true } } } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 1000,
  });

  // Flatten each submission down to the one row this table needs — item
  // order isn't guaranteed by Prisma (same reason as GET /agents/:agentId
  // above), so pick the earliest-message item for the conversation/link.
  const rows = submissions.map(s => {
    const sortedItems = [...s.items].sort((a, b) => new Date(a.message.createdAt) - new Date(b.message.createdAt));
    const topMessage = sortedItems[0]?.message;
    return {
      id: s.id,
      status: s.status,
      amount: s.amount,
      createdAt: s.createdAt,
      reviewedAt: s.reviewedAt,
      agent: { id: s.agent.id, name: s.agent.name, categoryId: s.agent.categoryId, categoryName: s.agent.category?.name || null },
      reviewedBy: s.reviewedBy,
      itemCount: s.items.length,
      conversation: topMessage?.conversation || null,
      topMessageId: topMessage?.id || null,
    };
  });

  res.json({ submissions: rows });
});

// GET /api/upsells/agents/:agentId?status= — admin drill-down for one
// agent's submissions. status (optional) narrows to just that column of
// ตรวจสอบ's ทั้งหมด/รอตรวจ/ผ่าน/ไม่ผ่าน filter tabs; omitted means every status.
// from/to (optional) narrow to the same date range ตรวจสอบ's own list is
// filtered to (see GET /agents above) — so drilling into an agent from an
// already-date-filtered list shows the same window, not that agent's
// all-time history.
router.get('/agents/:agentId', auth, requireAdmin, async (req, res) => {
  const { status, from, to } = req.query;
  if (status && !['pending', 'approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'สถานะไม่ถูกต้อง' });
  }
  const agent = await prisma.agent.findUnique({ where: { id: req.params.agentId }, select: { id: true, name: true, email: true } });
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const dateWhere = {};
  if (from || to) {
    dateWhere.createdAt = {};
    if (from) dateWhere.createdAt.gte = dayStart(from);
    if (to) dateWhere.createdAt.lte = dayEnd(to);
  }

  const submissions = await prisma.upsellSubmission.findMany({
    where: { agentId: req.params.agentId, ...(status ? { status } : {}), ...dateWhere },
    include: {
      items: { select: SUBMISSION_ITEM_SELECT },
      reviewedBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Prisma doesn't guarantee item order here (no orderBy on a to-many
  // include), so a submission's items could come back in an arbitrary order
  // even though they were all createMany'd together — sort by the underlying
  // message's own createdAt so "the topmost claimed message" (oldest in the
  // chat) is always items[0], which the frontend uses as its "ไปที่แชท"
  // scroll target.
  for (const s of submissions) {
    s.items.sort((a, b) => new Date(a.message.createdAt) - new Date(b.message.createdAt));
  }

  res.json({ agent, submissions });
});

// PATCH /api/upsells/:id — admin review: set amount + ผ่าน/ไม่ผ่าน.
router.patch('/:id', auth, requireAdmin, async (req, res) => {
  const { status, amount } = req.body;
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'สถานะไม่ถูกต้อง' });
  }
  const existing = await prisma.upsellSubmission.findUnique({ where: { id: req.params.id }, select: { id: true, agentId: true, conversationId: true } });
  if (!existing) return res.status(404).json({ error: 'Submission not found' });

  const submission = await prisma.upsellSubmission.update({
    where: { id: req.params.id },
    data: {
      status,
      amount: status === 'approved' ? (amount != null ? Number(amount) : null) : null,
      reviewedById: req.agent.id,
      reviewedAt: new Date(),
    },
    include: { items: { select: SUBMISSION_ITEM_SELECT }, reviewedBy: { select: { id: true, name: true } } },
  });

  emitToAll('upsell_reviewed', { submissionId: submission.id, agentId: existing.agentId, status });
  // "ไม่ผ่าน" — clear the claimed badge in any open chat right away, same as
  // deleting a submission does (see DELETE below). The submission row itself
  // stays in the DB, so ตรวจสอบอัพเซลล์'s "ไปที่แชท" link (which navigates by
  // conversation/message id, not by this badge) keeps working either way.
  if (status === 'rejected') {
    emitToConversation(existing.conversationId, 'upsell_unclaimed', {
      messageIds: submission.items.map(i => i.message.id),
    });
  }

  res.json(submission);
});

// DELETE /api/upsells/:id — admin: remove a submission entirely (wrong
// message picked, duplicate, submitted by mistake, etc). Cascades to its
// UpsellSubmissionItem rows (see schema.prisma's onDelete: Cascade), which
// frees the claimed messages — they become selectable again in Inbox.
router.delete('/:id', auth, requireAdmin, async (req, res) => {
  const existing = await prisma.upsellSubmission.findUnique({
    where: { id: req.params.id },
    select: { id: true, agentId: true, conversationId: true, items: { select: { messageId: true } } },
  });
  if (!existing) return res.status(404).json({ error: 'Submission not found' });

  await prisma.upsellSubmission.delete({ where: { id: req.params.id } });

  emitToConversation(existing.conversationId, 'upsell_unclaimed', { messageIds: existing.items.map(i => i.messageId) });
  emitToAll('upsell_reviewed', { submissionId: existing.id, agentId: existing.agentId, status: 'deleted' });

  res.json({ success: true });
});

module.exports = router;
