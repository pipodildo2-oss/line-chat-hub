const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

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

// Every image gets normalized to JPEG regardless of source format (PNG/GIF/WebP
// all get flattened/converted) for two reasons: (1) LINE's Messaging API only
// accepts JPEG or PNG for image messages — some source formats it wouldn't even
// accept otherwise, and (2) JPEG at a reasonable quality is dramatically smaller
// than PNG for photos, which is most of what gets sent in a support chat.
// A phone photo (3–10MB) typically compresses down to 100–400KB at these settings.
const FULL_MAX_DIMENSION = 1600; // px, longest side
const FULL_QUALITY = 82;
// LINE requires previewImageUrl to be under 1MB — separately from the 10MB cap
// on originalContentUrl. Reusing the full image as both (as this app used to)
// silently breaks previews for any image over 1MB. A small dedicated thumbnail
// fixes that and costs almost nothing in storage.
const THUMB_MAX_DIMENSION = 480;
const THUMB_QUALITY = 70;

// Decodes a `data:image/...;base64,...` string, compresses + resizes it, and
// writes both a full-size and thumbnail JPEG to disk. Returns the full image's
// public path (e.g. "/uploads/<id>.jpg") to store in the DB — the thumbnail
// path is always derivable from it via thumbPathFor() below, so no extra DB
// column is needed. Returns null if the input isn't a recognizable data URL.
async function saveBase64Image(dataUrl) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl || '');
  if (!match) return null;
  const [, , base64] = match;
  const buffer = Buffer.from(base64, 'base64');
  const id = crypto.randomBytes(16).toString('hex');
  const fullPath = path.join(UPLOAD_DIR, `${id}.jpg`);
  const thumbPath = path.join(UPLOAD_DIR, `${id}_thumb.jpg`);

  try {
    await sharp(buffer)
      .rotate() // respect EXIF orientation before resizing (phone photos especially)
      .resize({ width: FULL_MAX_DIMENSION, height: FULL_MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }) // drop alpha (e.g. transparent PNG) onto white — JPEG has no alpha channel
      .jpeg({ quality: FULL_QUALITY, mozjpeg: true })
      .toFile(fullPath);
    await sharp(buffer)
      .rotate()
      .resize({ width: THUMB_MAX_DIMENSION, height: THUMB_MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: THUMB_QUALITY, mozjpeg: true })
      .toFile(thumbPath);
  } catch (err) {
    // Malformed/unsupported image data — clean up any partial output and bail
    // so the caller can fall back to storing the raw data URL instead.
    fs.rmSync(fullPath, { force: true });
    fs.rmSync(thumbPath, { force: true });
    console.warn('saveBase64Image: sharp processing failed, falling back:', err.message);
    return null;
  }

  return `/uploads/${id}.jpg`;
}

// Given a stored full-image path (e.g. "/uploads/<id>.jpg"), returns the
// matching thumbnail's public path — used when pushing previewImageUrl to LINE.
function thumbPathFor(storedPath) {
  if (!isStoredPath(storedPath)) return storedPath;
  return storedPath.replace(/\.jpg$/, '_thumb.jpg');
}

// True for the new-style stored value (a short "/uploads/..." path) as opposed
// to the legacy value (a full "data:image/...;base64,..." blob still sitting in
// old rows from before this change).
function isStoredPath(value) {
  return typeof value === 'string' && value.startsWith('/uploads/');
}

// Deletes the full image + its thumbnail for a stored path. Used to clean up
// orphaned files when a quick reply's image is replaced/removed or a channel
// (and its message history) is deleted — without this, disk usage would only
// ever grow, even as rows get deleted from Postgres. Safe to call on legacy
// base64 values or anything already missing; errors are swallowed since a
// missing file is not a failure case here.
function deleteStoredImage(storedPath) {
  if (!isStoredPath(storedPath)) return;
  const filename = storedPath.replace('/uploads/', '');
  fs.rm(path.join(UPLOAD_DIR, filename), { force: true }, () => {});
  const thumbFilename = filename.replace(/\.jpg$/, '_thumb.jpg');
  fs.rm(path.join(UPLOAD_DIR, thumbFilename), { force: true }, () => {});
}

module.exports = { UPLOAD_DIR, saveBase64Image, thumbPathFor, isStoredPath, deleteStoredImage };
