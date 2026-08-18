const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const auth = require('../middleware/auth');
const { saveBase64Image, deleteStoredImage } = require('../lib/imageStorage');

const prisma = new PrismaClient();

// GET /api/agents
router.get('/', auth, async (req, res) => {
  const agents = await prisma.agent.findMany({
    select: {
      id: true, name: true, email: true, role: true, status: true, createdAt: true, avatarUrl: true,
      channels: { select: { channelId: true } },
      categoryId: true,
      category: { select: { id: true, name: true } },
    },
  });
  res.json(agents.map(a => ({ ...a, channelIds: a.channels.map(c => c.channelId), channels: undefined })));
});

// POST /api/agents
router.post('/', auth, async (req, res) => {
  if (req.agent.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    const { name, email, password, role = 'agent' } = req.body;
    const hashed = await bcrypt.hash(password, 10);
    const agent = await prisma.agent.create({
      data: { name, email, password: hashed, role },
      select: { id: true, name: true, email: true, role: true },
    });
    res.status(201).json(agent);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Email already exists' });
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/agents/me — update own profile (name, language, status)
router.patch('/me', auth, async (req, res) => {
  try {
    const { name, language, status } = req.body;
    const data = {};
    if (name !== undefined && name.trim()) data.name = name.trim();
    if (language !== undefined) data.language = language;
    if (status !== undefined) {
      if (!['online', 'offline', 'break'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }
      data.status = status;
    }
    const updated = await prisma.agent.update({
      where: { id: req.agent.id },
      data,
      select: { id: true, name: true, email: true, role: true, language: true, status: true, avatarUrl: true },
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/agents/me/avatar — upload/replace own profile picture.
// Accepts a base64 data URL (same as message/quick-reply images), runs it
// through imageStorage.js (compressed + resized JPEG on disk), and deletes
// the old avatar file if one existed so replacing a picture doesn't leak
// files the same way plain Postgres blobs used to (see imageStorage.js).
router.patch('/me/avatar', auth, async (req, res) => {
  try {
    const { imageData } = req.body;
    if (!imageData) return res.status(400).json({ error: 'imageData required' });
    const stored = await saveBase64Image(imageData);
    if (!stored) return res.status(400).json({ error: 'ไม่สามารถประมวลผลรูปภาพนี้ได้' });

    const previous = await prisma.agent.findUnique({ where: { id: req.agent.id }, select: { avatarUrl: true } });
    const updated = await prisma.agent.update({
      where: { id: req.agent.id },
      data: { avatarUrl: stored },
      select: { id: true, name: true, email: true, role: true, language: true, status: true, avatarUrl: true },
    });
    if (previous?.avatarUrl) deleteStoredImage(previous.avatarUrl);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/agents/me/password — change own password
router.patch('/me/password', auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร' });
    }
    const agentRow = await prisma.agent.findUnique({ where: { id: req.agent.id } });
    const valid = await bcrypt.compare(currentPassword || '', agentRow.password);
    if (!valid) return res.status(401).json({ error: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' });
    const hashed = await bcrypt.hash(newPassword, 10);
    await prisma.agent.update({ where: { id: req.agent.id }, data: { password: hashed } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/agents/:id — admin updates another agent's role
router.patch('/:id', auth, async (req, res) => {
  if (req.agent.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    const { role, categoryId } = req.body;
    const data = {};
    if (role !== undefined) data.role = role;
    // categoryId can be explicitly cleared back to "uncategorized" (null) —
    // same undefined-vs-null pattern as LineChannel.categoryId in channels.js.
    if (categoryId !== undefined) data.categoryId = categoryId || null;
    const updated = await prisma.agent.update({
      where: { id: req.params.id },
      data,
      select: { id: true, name: true, email: true, role: true, categoryId: true, category: { select: { id: true, name: true } } },
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/agents/:id/password — admin resets another agent's password
router.patch('/:id/password', auth, async (req, res) => {
  if (req.agent.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร' });
    }
    const hashed = await bcrypt.hash(newPassword, 10);
    await prisma.agent.update({ where: { id: req.params.id }, data: { password: hashed } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/agents/:id
router.delete('/:id', auth, async (req, res) => {
  if (req.agent.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const agent = await prisma.agent.delete({ where: { id: req.params.id } });
  if (agent.avatarUrl) deleteStoredImage(agent.avatarUrl);
  res.json({ success: true });
});

// PUT /api/agents/:id/channels — set which LINE OA channels this agent can see.
// Empty array = no restriction (agent sees all channels).
router.put('/:id/channels', auth, async (req, res) => {
  if (req.agent.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    const { channelIds = [] } = req.body;
    await prisma.$transaction([
      prisma.agentChannel.deleteMany({ where: { agentId: req.params.id } }),
      ...channelIds.map(channelId =>
        prisma.agentChannel.create({ data: { agentId: req.params.id, channelId } })
      ),
    ]);
    res.json({ success: true, channelIds });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
