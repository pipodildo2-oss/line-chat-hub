const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const auth = require('../middleware/auth');

const prisma = new PrismaClient();

function requireAdmin(req, res, next) {
  if (req.agent.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// GET /api/reports/flagged-messages?from=&to=&severity=&agentId=
// Admin-only — powers the KPI review Report page. Only ever contains messages
// flagged by the AI moderation check going forward from when that feature
// shipped (see moderation.service.js) — no historical backfill.
router.get('/flagged-messages', auth, requireAdmin, async (req, res) => {
  const { from, to, severity, agentId } = req.query;

  // baseWhere excludes the severity tab filter, so the severity summary counts
  // below always reflect the true totals for the selected date/agent regardless
  // of which severity tab is currently active — otherwise switching to the
  // "minor" tab would make the "severe" stat card show 0.
  const baseWhere = { flagged: true };
  if (agentId) baseWhere.senderId = agentId;
  if (from || to) {
    baseWhere.createdAt = {};
    if (from) baseWhere.createdAt.gte = new Date(`${from}T00:00:00.000`);
    if (to) baseWhere.createdAt.lte = new Date(`${to}T23:59:59.999`);
  }
  const where = severity ? { ...baseWhere, flagSeverity: severity } : baseWhere;

  const [messages, totalFlagged, severeCount, minorCount] = await Promise.all([
    prisma.message.findMany({
      where,
      select: {
        id: true, content: true, flagSeverity: true, flagReason: true, createdAt: true,
        senderName: true, senderId: true,
        senderAgent: { select: { id: true, name: true } },
        conversation: {
          select: { id: true, displayName: true, lineUserId: true, channel: { select: { id: true, name: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
    }),
    prisma.message.count({ where: baseWhere }),
    prisma.message.count({ where: { ...baseWhere, flagSeverity: 'severe' } }),
    prisma.message.count({ where: { ...baseWhere, flagSeverity: 'minor' } }),
  ]);

  res.json({ messages, totalFlagged, severeCount, minorCount });
});

module.exports = router;
