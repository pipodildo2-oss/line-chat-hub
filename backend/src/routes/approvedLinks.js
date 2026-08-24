// Admin-managed whitelist of domains agents are allowed to send customers —
// see schema.prisma's ApprovedLink and backend/src/lib/linkGuard.js, which
// actually does the matching against messages.js's outgoing-message check.
const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const auth = require('../middleware/auth');
const { reconcileFlaggedLinks } = require('../lib/linkGuard');

const prisma = new PrismaClient();

function requireAdmin(req, res, next) {
  if (req.agent.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// Strips a protocol/www prefix and any path/query, so admins can paste a
// full link ("https://www.mysite.com/promo") or just a bare domain
// ("mysite.com") and both end up stored the same normalized way — matching
// what linkGuard.js expects to compare against.
function normalizeDomain(input) {
  return (input || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#]/)[0];
}

router.get('/', auth, requireAdmin, async (req, res) => {
  const links = await prisma.approvedLink.findMany({ orderBy: { createdAt: 'asc' } });
  res.json(links);
});

router.post('/', auth, requireAdmin, async (req, res) => {
  const domain = normalizeDomain(req.body.domain);
  const label = req.body.label?.trim() || null;
  if (!domain || !domain.includes('.')) {
    return res.status(400).json({ error: 'กรุณาระบุโดเมนที่ถูกต้อง เช่น mysite.com' });
  }
  try {
    const link = await prisma.approvedLink.create({ data: { domain, label } });
    // A message flagged before this domain was approved (or before this
    // exact TLD/subdomain variant of it counted, see linkGuard.js's
    // registrable-name matching) shouldn't keep sitting in the ตรวจสอบ
    // report as if it were still a violation — clear it right away instead
    // of waiting for the next server restart's reconciliation.
    reconcileFlaggedLinks(prisma).catch(e => console.error('reconcileFlaggedLinks failed:', e.message));
    res.status(201).json(link);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'มีโดเมนนี้อยู่ในรายการแล้ว' });
    console.error('Create approved link failed:', err.message);
    res.status(500).json({ error: 'ไม่สามารถเพิ่มโดเมนได้' });
  }
});

router.delete('/:id', auth, requireAdmin, async (req, res) => {
  await prisma.approvedLink.delete({ where: { id: req.params.id } }).catch(() => {});
  res.json({ success: true });
});

module.exports = router;
