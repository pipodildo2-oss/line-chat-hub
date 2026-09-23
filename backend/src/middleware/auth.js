const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Verifies a raw JWT and re-fetches the agent from the DB — shared by the
// Express middleware below and the Socket.io handshake check in index.js, so
// both transports enforce the exact same rules (explicit algorithm allowlist,
// re-checking the agent still exists on every use) instead of two separate
// implementations that could silently drift apart. Returns the agent record
// ({ id, name, email, role }), or null if the token is missing/invalid/expired
// or no longer matches a real agent (deleted, or the JWT itself is bogus).
async function verifyAgentToken(token) {
  if (!token) return null;
  let payload;
  try {
    // Explicit algorithm allowlist — jwt.verify with no `algorithms` option
    // accepts whatever alg the token itself claims, which is the classic
    // opening for an algorithm-confusion attack if the verification key type
    // ever changes. Pinning it here means that risk can't silently reappear.
    payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    return null;
  }
  // A 2FA login is a TWO-step exchange (see routes/auth.js POST /login and
  // routes/twoFactor.js): the short-lived token issued after password-only
  // verification carries a `purpose` of 'verify2fa' or 'setup2fa' and is
  // NOT a real session — it only authorizes finishing that specific
  // exchange. Without this check it would otherwise pass every check below
  // (valid signature, a real agent id) and work as a full 7-day session on
  // ANY route, which would let a password alone bypass 2FA entirely the
  // moment login returned it. A real session token never carries this
  // claim (routes/auth.js only sets `purpose: 'session'` on the one it
  // hands out after 2FA, if required, is satisfied) — tokens issued before
  // this field existed have no `purpose` at all and stay valid, since they
  // were always full sessions.
  if (payload.purpose && payload.purpose !== 'session') return null;
  // Re-fetch from the DB on every use instead of trusting the token's claims
  // for its full 7-day lifetime. Without this, deleting an agent or demoting
  // them from admin had no actual effect until their existing token happened
  // to expire on its own — a deleted agent's session (and an ex-admin's
  // elevated access) both stayed live for up to a week.
  return prisma.agent.findUnique({
    where: { id: payload.id },
    select: { id: true, name: true, email: true, role: true },
  });
}

// The other half of the 2FA exchange this file's `purpose` check protects
// against: verifies a SHORT-LIVED pending token (issued by routes/auth.js
// POST /login once the password alone has checked out) and confirms it
// carries one of the purposes routes/twoFactor.js actually expects at the
// call site using it — a 'setup2fa' token can't be replayed against the
// login-code-verify endpoint, and vice versa. Returns the still-existing
// agent row (full, not the trimmed shape verifyAgentToken returns — callers
// need twoFactorSecret/twoFactorBackupCodes, which a real session token
// must never expose a route to reach for) plus the purpose, or null.
async function verifyPendingTwoFactorToken(token, expectedPurposes) {
  if (!token) return null;
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    return null;
  }
  if (!expectedPurposes.includes(payload.purpose)) return null;
  const agent = await prisma.agent.findUnique({ where: { id: payload.id } });
  if (!agent) return null;
  return { agent, purpose: payload.purpose };
}

async function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const agent = await verifyAgentToken(token);
    if (!agent) return res.status(401).json({ error: 'Invalid token' });
    req.agent = agent;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = authMiddleware;
module.exports.verifyAgentToken = verifyAgentToken;
module.exports.verifyPendingTwoFactorToken = verifyPendingTwoFactorToken;
