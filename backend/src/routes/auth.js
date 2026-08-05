const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const agent = await prisma.agent.findUnique({ where: { email } });
    if (!agent) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, agent.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: agent.id, email: agent.email, name: agent.name, role: agent.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token, agent: { id: agent.id, name: agent.name, email: agent.email, role: agent.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me
router.get('/me', require('../middleware/auth'), async (req, res) => {
  const agent = await prisma.agent.findUnique({
    where: { id: req.agent.id },
    select: { id: true, name: true, email: true, role: true },
  });
  res.json(agent);
});

module.exports = router;
