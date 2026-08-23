const router = require('express').Router();
const { PrismaClient, Prisma } = require('@prisma/client');
const auth = require('../middleware/auth');
const { canAccessChannel } = require('../lib/conversationQuery');
const { emitToConversation, emitToAll } = require('../services/socket.service');

const prisma = new PrismaClient();

function requireAdmin(req, res, next) {
  if (req.agent.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

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
    // A unique-constraint violation on UpsellSubmissionItem.messageId means
    // someone else claimed one of these messages in the moment between the
    // findMany check above and this transaction — the whole transaction rolls
    // back automatically, so there's no orphan UpsellSubmission row to clean up.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return res.status(409).json({ error: 'ข้อความบางรายการถูกเลือกไปแล้ว' });
    }
    console.error('Upsell submit failed:', err.message);
    res.status(500).json({ error: 'ไม่สามารถส่งรายการอัพเซลล์ได้' });
  }
});

// GET /api/upsells/agents — admin overview, one row per agent who has submitted.
router.get('/agents', auth, requireAdmin, async (req, res) => {
  const [agents, statusGroups, amountGroups] = await Promise.all([
    prisma.agent.findMany({ select: { id: true, name: true, email: true } }),
    prisma.upsellSubmission.groupBy({ by: ['agentId', 'status'], _count: { _all: true } }),
    prisma.upsellSubmission.groupBy({ by: ['agentId'], where: { status: 'approved' }, _sum: { amount: true } }),
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

  const summary = agents
    .filter(a => byAgent[a.id])
    .map(a => ({
      id: a.id,
      name: a.name,
      email: a.email,
      total: byAgent[a.id].total,
      pending: byAgent[a.id].pending,
      approved: byAgent[a.id].approved,
      rejected: byAgent[a.id].rejected,
      approvedAmount: amountByAgent[a.id] || 0,
    }))
    // Worklist-first: agents with unreviewed submissions float to the top.
    .sort((x, y) => (y.pending - x.pending) || (y.total - x.total));

  res.json({ agents: summary });
});

// GET /api/upsells/agents/:agentId — admin drill-down for one agent's submissions.
router.get('/agents/:agentId', auth, requireAdmin, async (req, res) => {
  const agent = await prisma.agent.findUnique({ where: { id: req.params.agentId }, select: { id: true, name: true, email: true } });
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const submissions = await prisma.upsellSubmission.findMany({
    where: { agentId: req.params.agentId },
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
  const existing = await prisma.upsellSubmission.findUnique({ where: { id: req.params.id }, select: { id: true, agentId: true } });
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

  res.json(submission);
});

module.exports = router;
