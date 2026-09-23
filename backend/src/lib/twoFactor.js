// TOTP two-factor auth (RFC 6238) — a shared secret per agent, verified
// against the 6-digit code their authenticator app (Google Authenticator,
// Authy, 1Password, etc.) generates from it. Deliberately not SMS/email OTP:
// no delivery provider to configure or pay for, and it still works even if
// this server can't reach the outside world at the exact moment someone is
// trying to log in.
const { authenticator } = require('otplib');
const qrcode = require('qrcode');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// ±1 step (30s) of clock drift tolerance either side — otplib's default.
// Set explicitly so it can't silently change out from under this file if
// the library's own default ever does.
authenticator.options = { window: 1 };

const ISSUER = 'Alpha Chat';

function generateSecret() {
  return authenticator.generateSecret();
}

// The label an authenticator app shows under the issuer name — the agent's
// own email, so someone managing several accounts in one app can tell them
// apart.
function buildOtpauthUrl(secret, accountLabel) {
  return authenticator.keyuri(accountLabel, ISSUER, secret);
}

function buildQrCodeDataUrl(otpauthUrl) {
  return qrcode.toDataURL(otpauthUrl);
}

function verifyCode(secret, code) {
  if (!code || !secret) return false;
  try {
    return authenticator.check(String(code).trim().replace(/\s+/g, ''), secret);
  } catch {
    // otplib throws on a malformed token (wrong length/non-numeric) rather
    // than just returning false — same outcome either way as far as the
    // caller is concerned.
    return false;
  }
}

// Backup/recovery codes — the only way back in if an agent's phone is lost,
// wiped, or just not on hand. Ten single-use codes, formatted like a short
// license key (XXXXX-XXXXX) so they read cleanly off a printed sheet.
const BACKUP_CODE_COUNT = 10;

function generateBackupCodes() {
  return Array.from({ length: BACKUP_CODE_COUNT }, () => {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase(); // 10 hex chars
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

// Hashed with bcrypt before storage — same convention as Agent.password —
// so a database leak alone can't be replayed as a working backup code.
function hashBackupCodes(codes) {
  return Promise.all(codes.map(c => bcrypt.hash(c, 10)));
}

// Checks `code` against the stored hashed list and returns the index of the
// first match, or -1 if none matched. The caller is responsible for
// removing that index from storage so the code can't be used a second time.
// Case/whitespace-insensitive since these get typed by hand off paper.
async function matchBackupCode(code, hashedCodes) {
  if (!code || !hashedCodes?.length) return -1;
  const normalized = code.trim().toUpperCase();
  for (let i = 0; i < hashedCodes.length; i++) {
    // Sequential, not Promise.all — bcrypt.compare is deliberately slow and
    // there are at most 10 of these, so running them one at a time costs
    // nothing worth avoiding while keeping this simple to read.
    if (await bcrypt.compare(normalized, hashedCodes[i])) return i;
  }
  return -1;
}

module.exports = {
  generateSecret,
  buildOtpauthUrl,
  buildQrCodeDataUrl,
  verifyCode,
  generateBackupCodes,
  hashBackupCodes,
  matchBackupCode,
};
