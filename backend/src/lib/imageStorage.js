const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Where agent-attached images (chat composer + quick-reply images) get written
// as real files instead of being stored as base64 blobs inside Postgres rows.
// That base64-in-DB pattern was filling the Postgres volume fast even with light
// usage (a single 10MB image becomes ~13MB of base64 sitting permanently in a
// table row) — this moves new uploads onto disk so the DB only ever holds a
// short path string.
//
// IMPORTANT: point UPLOAD_DIR at a Railway Volume mounted on THIS service
// (the backend/app service — not the Postgres one) so files survive redeploys.
// Without a mounted volume, this falls back to the container's local disk,
// which Railway wipes on every deploy, so uploaded images would vanish.
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

// Decodes a `data:image/...;base64,...` string, writes it to disk, and returns
// a short public path (e.g. "/uploads/<random>.jpg") to store in the DB instead
// of the raw blob. Returns null if the input isn't a recognizable data URL.
function saveBase64Image(dataUrl) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl || '');
  if (!match) return null;
  const [, mime, base64] = match;
  const ext = EXT_BY_MIME[mime.toLowerCase()] || '';
  const filename = `${crypto.randomBytes(16).toString('hex')}${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), Buffer.from(base64, 'base64'));
  return `/uploads/${filename}`;
}

// True for the new-style stored value (a short "/uploads/..." path) as opposed
// to the legacy value (a full "data:image/...;base64,..." blob still sitting in
// old rows from before this change).
function isStoredPath(value) {
  return typeof value === 'string' && value.startsWith('/uploads/');
}

module.exports = { UPLOAD_DIR, saveBase64Image, isStoredPath };
