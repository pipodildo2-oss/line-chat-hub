const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const auth = require('../middleware/auth');
const { deleteStoredImage } = require('../lib/imageStorage');

const prisma = new PrismaClient();

function requireAdmin(req, res, next) {
  if (req.agent.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// Never send channelSecret/accessToken back to the browser — these are live
// credentials that let anyone holding them push messages as the OA or read
// its webhook traffic. `select` (not `include`) so the omission is explicit
// and doesn't silently start leaking again if a scalar field is added to the
// model later — an `include`-based query would have picked that up for free.
const CHANNEL_SELECT = {
  id: true, name: true, channelId: true, lineId: true, pictureUrl: true,
  webhookRedeliveryConfirmed: true, active: true, createdAt: true, categoryId: true,
  _count: { select: { conversations: true } },
  // groupId/group included so the Inbox channel filter can nest channels
  // under their category's parent "หมวดหมู่ใหญ่" group without a separate call.
  category: { select: { id: true, name: true, groupId: true, group: { select: { id: true, name: true } } } },
};

// GET /api/channels
router.get('/', auth, async (req, res) => {
  let where = {};
  if (req.agent.role !== 'admin') {
    const rows = await prisma.agentChannel.findMany({ where: { agentId: req.agent.id }, select: { channelId: true } });
    if (rows.length > 0) where = { id: { in: rows.map(r => r.channelId) } };
  }
  const channels = await prisma.lineChannel.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    select: CHANNEL_SELECT,
  });
  res.json(channels);
});

// POST /api/channels — admin only: creating a channel means supplying its
// live channelSecret/accessToken, which only an admin should be trusted with.
router.post('/', auth, requireAdmin, async (req, res) => {
  try {
    const { name, channelId, channelSecret, accessToken, lineId, categoryId } = req.body;
    if (!name || !channelId || !channelSecret || !accessToken) {
      return res.status(400).json({ error: 'All fields required' });
    }
    const channel = await prisma.lineChannel.create({
      data: { name, channelId, channelSecret, accessToken, lineId: lineId || null, categoryId: categoryId || null },
      select: CHANNEL_SELECT,
    });
    res.status(201).json(channel);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Channel ID already exists' });
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/channels/:id — admin only: can rewrite a channel's live credentials.
router.put('/:id', auth, requireAdmin, async (req, res) => {
  try {
    const { name, channelSecret, accessToken, lineId, webhookRedeliveryConfirmed, categoryId, active } = req.body;
    const channel = await prisma.lineChannel.update({
      where: { id: req.params.id },
      data: {
        name, lineId, webhookRedeliveryConfirmed,
        // channelSecret/accessToken are no longer sent back to the browser
        // (see CHANNEL_SELECT above), so the edit form can't pre-fill and
        // resubmit the existing value — it leaves these blank unless the
        // admin is deliberately rotating one, in which case the field is a
        // non-empty string. `undefined` (checkbox left blank) is left out of
        // `data` entirely by Prisma, which leaves the stored value untouched
        // — the same pattern this form already used for accessToken before
        // this change, now applied consistently to both fields.
        ...(channelSecret ? { channelSecret } : {}),
        ...(accessToken ? { accessToken } : {}),
        // categoryId can be explicitly cleared back to "uncategorized" (null),
        // so it needs its own undefined-vs-null check rather than falling
        // through with the other fields above.
        ...(categoryId !== undefined ? { categoryId: categoryId || null } : {}),
        // "ปิดใช้งาน" toggle — see schema.prisma for why this exists separately
        // from DELETE below.
        ...(active !== undefined ? { active: !!active } : {}),
      },
      select: CHANNEL_SELECT,
    });
    res.json(channel);
  } catch {
    res.status(404).json({ error: 'Channel not found' });
  }
});

// DELETE /api/channels/:id — admin only. Hard delete, cascades to all this
// channel's conversations/messages in Postgres. That cascade does NOT touch
// the actual image files those messages point to on disk (see
// imageStorage.js) — without this cleanup, deleting a channel would silently
// leak its images forever, which defeats the whole point of having moved
// them off Postgres to save space.
router.delete('/:id', auth, requireAdmin, async (req, res) => {
  try {
    const messagesWithImages = await prisma.message.findMany({
      where: { conversation: { channelId: req.params.id }, imageData: { not: null } },
      select: { imageData: true },
    });
    await prisma.lineChannel.delete({ where: { id: req.params.id } });
    messagesWithImages.forEach(m => deleteStoredImage(m.imageData));
    res.json({ success: true });
  } catch {
    res.status(404).json({ error: 'Channel not found' });
  }
});

module.exports = router;
