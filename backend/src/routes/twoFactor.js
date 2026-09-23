// The rest of the 2FA exchange that routes/auth.js's POST /login starts —
// mounted at /api/auth/2fa. Two different callers hit these endpoints:
//   - an agent already fully logged in, turning 2FA on for themselves from
//     ProfileModal.jsx (normal Authorization header, no pendingToken), and
//   - someone mid-login, holding only the short-lived pendingToken login
//     handed back instead of a real session (see middleware/auth.js for why
//     that token can't be used as one) — either to enter a code
//     ('verify2fa') or, if the org requires 2FA and they've never set one
//     up, to finish setup on the spot ('setup2fa') before landing in the app.
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { PrismaClient } = require('@prisma/client');
const { verifyAgentToken, verifyPendingTwoFactorToken } = require('../middleware/auth');
const { issueSession } = require('./auth');
const twoFactor = require('../lib/twoFactor');

const prisma = new PrismaClient();

// Same shape as auth.js's loginLimiter — these endpoints are exactly as
// brute-forceable (a 6-digit code, or one of 10 backup codes) as the
// password check itself, so they get the same guard.
const twoFactorLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'พยายามยืนยันบ่อยเกินไป กรุณาลองใหม่ในอีกสักครู่' },
});

// Identifies who setup-init/setup-confirm are acting on, from whichever of
// the two callers described above this request is. Returns the FULL agent
// row (setup needs twoFactorSecret, unlike the trimmed shape a normal
// session's req.agent carries) plus whether this came from a pendingToken —
// setup-confirm uses that to decide whether finishing setup should also
// complete the login it was blocking (see below).
//
// pendingToken checked FIRST, and authoritative whenever the caller sent
// one — Login.jsx always sends one for the forced-at-login path and NEVER
// sends one for ProfileModal's voluntary path, so the two call sites are
// unambiguous from the request shape alone.
//
// INCIDENT: this used to check the Authorization header first and only fall
// back to pendingToken if that was missing. A browser that still carried
// ANY other agent's still-valid session token (a shared workstation, a
// second tab, one agent's session simply not yet expired) attached that
// token to every axios request by default — including this one, made from
// the LOGIN SCREEN by someone who had not yet finished logging in as
// themselves. Setup silently ran against the WRONG agent's account instead
// of the one actually typing at the login screen: a real account mix-up,
// and setup-confirm then had no session to hand back to the frontend since
// it was never the pendingToken path, which was mistaken by Login.jsx for a
// successful login with no token — corrupting localStorage and crashing the
// app on every subsequent page load for that browser. Checking pendingToken
// first, and failing outright if it's present but invalid, closes both
// holes at once.
async function resolveSetupSubject(req) {
  if (req.body?.pendingToken) {
    const result = await verifyPendingTwoFactorToken(req.body.pendingToken, ['setup2fa']);
    return result ? { agent: result.agent, viaPendingToken: true } : null;
  }
  const authHeader = req.headers.authorization?.split(' ')[1];
  if (authHeader) {
    const session = await verifyAgentToken(authHeader);
    if (session) {
      const agent = await prisma.agent.findUnique({ where: { id: session.id } });
      if (agent) return { agent, viaPendingToken: false };
    }
  }
  return null;
}

// POST /api/auth/2fa/setup-init — generates a fresh secret and returns a QR
// code for it. Doesn't activate anything yet: twoFactorEnabledAt stays null
// until setup-confirm below proves the agent actually captured this secret
// in a real authenticator app, not just that this endpoint ran.
router.post('/setup-init', twoFactorLimiter, async (req, res) => {
  const subject = await resolveSetupSubject(req);
  if (!subject) return res.status(401).json({ error: 'Unauthorized' });

  const secret = twoFactor.generateSecret();
  await prisma.agent.update({ where: { id: subject.agent.id }, data: { twoFactorSecret: secret } });

  const otpauthUrl = twoFactor.buildOtpauthUrl(secret, subject.agent.email);
  const qrCodeDataUrl = await twoFactor.buildQrCodeDataUrl(otpauthUrl);
  res.json({ secret, qrCodeDataUrl });
});

// POST /api/auth/2fa/setup-confirm — { code, pendingToken? } — proves the
// agent's authenticator app actually has the secret setup-init just issued,
// by checking a live code from it. On success: activates 2FA and hands back
// backup codes ONE TIME ONLY (see schema.prisma — only their bcrypt hash is
// ever stored, so this is the sole moment they exist in plaintext anywhere).
// If this was the forced-at-login path (pendingToken, 'setup2fa'), the
// password was already verified back in routes/auth.js's POST /login before
// this ever started, so finishing setup here also completes that login —
// there's no reason to make the agent type their password a second time.
router.post('/setup-confirm', twoFactorLimiter, async (req, res) => {
  const subject = await resolveSetupSubject(req);
  if (!subject) return res.status(401).json({ error: 'Unauthorized' });
  if (!subject.agent.twoFactorSecret) {
    return res.status(400).json({ error: 'กรุณาเริ่มตั้งค่าใหม่อีกครั้ง' });
  }
  if (!twoFactor.verifyCode(subject.agent.twoFactorSecret, req.body?.code)) {
    return res.status(401).json({ error: 'รหัสไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง' });
  }

  const backupCodes = twoFactor.generateBackupCodes();
  const hashed = await twoFactor.hashBackupCodes(backupCodes);
  const agent = await prisma.agent.update({
    where: { id: subject.agent.id },
    data: { twoFactorEnabledAt: new Date(), twoFactorBackupCodes: hashed },
  });

  if (subject.viaPendingToken) {
    return res.json({ enabled: true, backupCodes, ...(await issueSession(agent)) });
  }
  res.json({ enabled: true, backupCodes });
});

// POST /api/auth/2fa/verify-login — { pendingToken, code } — the code-entry
// step for an agent who already has 2FA on (routes/auth.js's POST /login
// returned requires2FA without setupRequired). `code` may be a live 6-digit
// TOTP code OR one of the agent's backup codes — tried in that order since
// a TOTP code can never collide with a backup code's format, so there's no
// ambiguity in trying both.
router.post('/verify-login', twoFactorLimiter, async (req, res) => {
  const result = await verifyPendingTwoFactorToken(req.body?.pendingToken, ['verify2fa']);
  if (!result) return res.status(401).json({ error: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่อีกครั้ง' });
  const { agent } = result;

  if (twoFactor.verifyCode(agent.twoFactorSecret, req.body?.code)) {
    return res.json(await issueSession(agent));
  }

  const backupIndex = await twoFactor.matchBackupCode(req.body?.code, agent.twoFactorBackupCodes);
  if (backupIndex === -1) {
    return res.status(401).json({ error: 'รหัสไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง' });
  }
  // Single-use — removed the moment it's spent so a backup code sheet that
  // leaks later can't be replayed for codes already redeemed.
  const remaining = agent.twoFactorBackupCodes.filter((_, i) => i !== backupIndex);
  const updated = await prisma.agent.update({
    where: { id: agent.id },
    data: { twoFactorBackupCodes: remaining },
  });
  res.json({ ...(await issueSession(updated)), backupCodeUsed: true, backupCodesRemaining: remaining.length });
});

module.exports = router;
