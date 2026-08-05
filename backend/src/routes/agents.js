const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const auth = require('../middleware/auth');

const prisma = new PrismaClient();

// GET /api/agents
router.get('/', auth, async (req, res) => {
  const agents = await prisma.agent.findMany({
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });
  res.json(agents);
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

// DELETE /api/agents/:id
router.delete('/:id', auth, async (req, res) => {
  if (req.agent.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  await prisma.agent.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

module.exports = router;
