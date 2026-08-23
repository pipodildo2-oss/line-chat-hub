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
