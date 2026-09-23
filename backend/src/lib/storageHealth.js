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
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { UPLOAD_DIR } = require('./imageStorage');

const prisma = new PrismaClient();
// Days of remaining headroom below which this starts complaining. Growing a
// volume is not instant and needs a person, so "weeks of notice" is the point.
const WARN_DAYS = 60;
const CRITICAL_DAYS = 21;
const WARN_FREE_PERCENT = 20;
const CRITICAL_FREE_PERCENT = 8;
const SAMPLE_FILES = 300;
const GROWTH_WINDOW_DAYS = 7;

const GB = 1024 ** 3;
const gb = (bytes) => (bytes / GB).toFixed(2);

// Measured rather than assumed: file sizes depend entirely on what customers
// happen to send, and guessing at an average is how the earlier "full in 3-4
// months" estimate ended up wrong by a factor of two.
function averageStoredFileBytes() {
  let entries;
  try { entries = fs.readdirSync(UPLOAD_DIR); } catch { return null; }
  if (entries.length === 0) return null;
  // Spread the sample across the directory instead of taking the first N,
  // which on most filesystems would be biased towards one era of files.
  const step = Math.max(1, Math.floor(entries.length / SAMPLE_FILES));
  let bytes = 0;
  let counted = 0;
  for (let i = 0; i < entries.length && counted < SAMPLE_FILES; i += step) {
    try {
      const s = fs.statSync(path.join(UPLOAD_DIR, entries[i]));
      if (s.isFile()) { bytes += s.size; counted++; }
    } catch { /* file vanished between readdir and stat — skip it */ }
  }
  return counted === 0 ? null : { avgBytes: bytes / counted, fileCount: entries.length };
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

  const sample = averageStoredFileBytes();
  const since = new Date(Date.now() - GROWTH_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const recentImages = await prisma.message.count({ where: { type: 'image', createdAt: { gte: since } } });
  const imagesPerDay = recentImages / GROWTH_WINDOW_DAYS;
  // Each stored image is two files (full + thumbnail, see imageStorage.js) and
  // the directory sample already averages across both, so the per-image cost is
  // two average files.
  const bytesPerDay = sample ? imagesPerDay * sample.avgBytes * 2 : null;
  const daysLeft = bytesPerDay > 0 ? freeBytes / bytesPerDay : null;

  const summary = `Storage health: ${gb(usedBytes)}GB used of ${gb(totalBytes)}GB (${freePercent.toFixed(1)}% free)`
    + (sample ? `, ${sample.fileCount} files averaging ${(sample.avgBytes / 1024).toFixed(0)}KB` : '')
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
