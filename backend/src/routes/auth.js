const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Limit login attempts to slow down brute-force password guessing.
// Keyed by IP; 10 attempts per 15 minutes is generous for real users, painful for attackers.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'พยายามเข้าสู่ระบบบ่อยเกินไป กรุณาลองใหม่ในอีกสักครู่' },
});

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
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

    res.json({ token, agent: { id: agent.id, name: agent.name, email: agent.email, role: agent.role, language: agent.language, status: agent.status } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me
router.get('/me', require('../middleware/auth'), async (req, res) => {
  const agent = await prisma.agent.findUnique({
    where: { id: req.agent.id },
    select: { id: true, name: true, email: true, role: true, language: true, status: true },
  });
  res.json(agent);
});

module.exports = router;
