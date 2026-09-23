const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { PrismaClient } = require('@prisma/client');
const { getTwoFactorRequired } = require('../lib/systemSettings');

const prisma = new PrismaClient();

// Issues the real 7-day session — the one and only place that happens,
// shared by the no-2FA login path below and routes/twoFactor.js's
// login-code-verify endpoint, so both end up with an identical token shape
// and response. `purpose: 'session'` is what tells authMiddleware
// (middleware/auth.js) this is a genuine, fully-authenticated session and
// not one of the short-lived pending tokens this same file also issues.
async function issueSession(agent) {
  const token = jwt.sign(
    { id: agent.id, email: agent.email, name: agent.name, role: agent.role, purpose: 'session' },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  // A fresh login always means "I'm active now" — most relevantly, clears
  // a stale 'away' status left over from AfkTracker.jsx auto-logging this
  // agent out for inactivity last time (see agents.js PATCH /me), so they
  // don't show as away to teammates the moment they're back.
  const status = agent.status === 'away' ? 'online' : agent.status;
  if (status !== agent.status) {
    await prisma.agent.update({ where: { id: agent.id }, data: { status } });
  }

  return {
    token,
    agent: {
      id: agent.id, name: agent.name, email: agent.email, role: agent.role,
      language: agent.language, status, avatarUrl: agent.avatarUrl,
      twoFactorEnabled: !!agent.twoFactorEnabledAt,
    },
  };
}

// Limit login attempts to slow down brute-force password guessing.
// Keyed by IP; 10 attempts per 15 minutes is generous for real users, painful for attackers.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'พยายามเข้าสู่ระบบบ่อยเกินไป กรุณาลองใหม่ในอีกสักครู่' },
});

// Fixed, arbitrary bcrypt hash with no corresponding real password — used
// below purely so the "email not found" path spends roughly the same time
// as the "email found, wrong password" path. Without this, an unknown email
// returns 401 immediately while a known one waits on a real bcrypt.compare
// (deliberately slow), so measuring response time lets an attacker enumerate
// which emails are registered even though both cases return an identical
// error message.
const DUMMY_PASSWORD_HASH = '$2a$10$RbzgkEiHzMw9u6j4W5rtguyJ6BKFj5bkn1mQBfR4BFKZgo9.bhGbG';

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    const agent = await prisma.agent.findUnique({ where: { email } });
    const valid = await bcrypt.compare(password || '', agent?.password || DUMMY_PASSWORD_HASH);
    if (!agent || !valid) return res.status(401).json({ error: 'Invalid credentials' });

    // Password alone is never enough for an agent who has 2FA turned on for
    // their own account (Agent.twoFactorEnabledAt) — that stays true
    // regardless of the org-wide setting below, see schema.prisma. An agent
    // WITHOUT 2FA only gets stopped here if the admin has switched on
    // "บังคับใช้ 2FA" (Settings > ระบบ) — otherwise login proceeds exactly as
    // it always has.
    const has2FA = !!agent.twoFactorEnabledAt;
    const mustSetUp = !has2FA && (await getTwoFactorRequired());
    if (has2FA || mustSetUp) {
      // Short-lived and single-purpose — see middleware/auth.js's `purpose`
      // check for why this can never be used as a real session token, and
      // routes/twoFactor.js for what it's actually redeemed for. 10 minutes
      // is enough to read a code off an app (or scan+confirm a fresh QR
      // code) without leaving a long-lived half-authenticated token sitting
      // in the browser.
      const pendingToken = jwt.sign(
        { id: agent.id, purpose: has2FA ? 'verify2fa' : 'setup2fa' },
        process.env.JWT_SECRET,
        { expiresIn: '10m' }
      );
      return res.json({ requires2FA: true, setupRequired: mustSetUp, pendingToken });
    }

    res.json(await issueSession(agent));
  } catch (err) {
    // Login is unauthenticated by nature — a raw error here (e.g. a DB
    // connection failure) would reach a caller who hasn't proven they're a
    // real agent yet, so it can't include any internal detail.
    console.error('Login failed:', err.message);
    res.status(500).json({ error: 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' });
  }
});

// GET /api/auth/me
router.get('/me', require('../middleware/auth'), async (req, res) => {
  const agent = await prisma.agent.findUnique({
    where: { id: req.agent.id },
    select: { id: true, name: true, email: true, role: true, language: true, status: true, avatarUrl: true, twoFactorEnabledAt: true },
  });
  if (!agent) return res.status(404).json({ error: 'Not found' });
  res.json({ ...agent, twoFactorEnabled: !!agent.twoFactorEnabledAt, twoFactorEnabledAt: undefined });
});

module.exports = router;
module.exports.issueSession = issueSession;
