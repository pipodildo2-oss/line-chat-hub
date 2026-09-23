// Watches how much room is left on the uploads volume, and says how long that
// is likely to last at the current rate.
//
// This is the one remaining way the same data loss could happen again. Now that
// every customer image is copied to disk the moment it arrives, the volume
// fills steadily and forever. When it runs out, sharp's write in
// saveBase64Image throws, the caller logs a warning and records the message
// WITHOUT a local copy (line.service.js treats storing as best-effort so a
// failure can't stop a customer's message being recorded) — and from that point
// every new image is only recoverable for as long as LINE keeps it, about two
// weeks. That is precisely the situation that cost ~47,000 images before, and
// it would arrive silently: no error page, no failed request, just thumbnails
// quietly starting to expire again weeks later.
//
// So the free space gets checked out loud on a schedule, with enough warning to
// act (a Railway volume can be grown in place) rather than a single alarm once
// it's already full.
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const { UPLOAD_DIR } = require('./imageStorage');

const prisma = new PrismaClient();
// Days of remaining headroom below which this starts complaining. Growing a
// volume is not instant and needs a person, so "weeks of notice" is the point.
const WARN_DAYS = 60;
const CRITICAL_DAYS = 21;
const WARN_FREE_PERCENT = 20;
const CRITICAL_FREE_PERCENT = 8;
const GROWTH_WINDOW_DAYS = 7;

const GB = 1024 ** 3;
const gb = (bytes) => (bytes / GB).toFixed(2);

// Counts the files on the volume. Their average size is then derived from the
// bytes actually in use rather than sampled, because the volume is mounted
// exclusively for this directory: used bytes divided by file count is the true
// average, not an estimate of it.
//
// A sample was the obvious approach and it was wrong by 68% here — stored
// images come in two sizes (a full image and a much smaller thumbnail, see
// imageStorage.js), so any sample that doesn't happen to draw them in exactly
// the ratio they exist in skews the figure, and the whole point of this number
// is to say how many days are left. Guessing at an average is also how an
// earlier estimate of this came out wrong by a factor of two.
function countStoredFiles() {
  try { return fs.readdirSync(UPLOAD_DIR).length; } catch { return null; }
}

async function checkStorageHealth() {
  let stat;
  try {
    stat = await fs.promises.statfs(UPLOAD_DIR);
  } catch (err) {
    console.error(`Storage health: could not read free space for ${UPLOAD_DIR}: ${err.message}`);
    return null;
  }
  const totalBytes = stat.blocks * stat.bsize;
  const freeBytes = stat.bavail * stat.bsize;
  const usedBytes = totalBytes - freeBytes;
  const freePercent = totalBytes === 0 ? 0 : (freeBytes / totalBytes) * 100;

  const fileCount = countStoredFiles();
  const avgFileBytes = fileCount > 0 ? usedBytes / fileCount : null;
  const since = new Date(Date.now() - GROWTH_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const recentImages = await prisma.message.count({ where: { type: 'image', createdAt: { gte: since } } });
  const imagesPerDay = recentImages / GROWTH_WINDOW_DAYS;
  // Each stored image is two files on disk — the full image and its thumbnail
  // (imageStorage.js) — and avgFileBytes averages across both kinds, so one
  // image costs two average files.
  const bytesPerDay = avgFileBytes ? imagesPerDay * avgFileBytes * 2 : null;
  const daysLeft = bytesPerDay > 0 ? freeBytes / bytesPerDay : null;

  const summary = `Storage health: ${gb(usedBytes)}GB used of ${gb(totalBytes)}GB (${freePercent.toFixed(1)}% free)`
    + (fileCount ? `, ${fileCount} files averaging ${(avgFileBytes / 1024).toFixed(0)}KB` : '')
    + `, ${Math.round(imagesPerDay)} images/day`
    + (bytesPerDay ? `, ~${gb(bytesPerDay)}GB/day` : '')
    + (daysLeft ? `, about ${Math.round(daysLeft)} days of headroom left` : '');

  const critical = freePercent <= CRITICAL_FREE_PERCENT || (daysLeft !== null && daysLeft <= CRITICAL_DAYS);
  const warn = freePercent <= WARN_FREE_PERCENT || (daysLeft !== null && daysLeft <= WARN_DAYS);
  if (critical) {
    console.error(`${summary} — CRITICAL: grow the uploads volume now. When it fills, new customer images stop being stored and will be permanently lost once LINE expires them (~2 weeks later).`);
  } else if (warn) {
    console.warn(`${summary} — WARNING: plan to grow the uploads volume. Running out means new customer images silently stop being stored.`);
  } else {
    console.log(summary);
  }
  return { totalBytes, freeBytes, freePercent, imagesPerDay, bytesPerDay, daysLeft };
}

module.exports = { checkStorageHealth };
