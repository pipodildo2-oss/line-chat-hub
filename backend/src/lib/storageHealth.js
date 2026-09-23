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
const GROWTH_WINDOW_DAYS = 7;

const GB = 1024 ** 3;
const gb = (bytes) => (bytes / GB).toFixed(2);

// Measures the uploads directory itself: how many files, and how many bytes
// they actually occupy.
//
// Two earlier versions got this wrong in opposite directions and both would
// have raised false alarms. Sampling 300 files ran 68% high, because stored
// images come in two very different sizes — a full image and a much smaller
// thumbnail (imageStorage.js) — and no stride through the directory draws them
// in the ratio they exist in. Dividing the filesystem's used bytes by the file
// count fixed that but quietly assumed the volume holds nothing except this
// directory; the moment that stops being true the average is nonsense and the
// "days left" figure with it.
//
// Summing the files directly is the only version that can't be wrong either
// way, and it needs no assumption about what else shares the disk. It costs one
// stat per file — a second or two at the current ~121,000 — on a job that runs
// every six hours.
function measureUploadDir() {
  let entries;
  try { entries = fs.readdirSync(UPLOAD_DIR); } catch { return null; }
  let bytes = 0;
  let fileCount = 0;
  for (const name of entries) {
    try {
      const s = fs.statSync(path.join(UPLOAD_DIR, name));
      if (s.isFile()) { bytes += s.size; fileCount++; }
    } catch { /* deleted between readdir and stat — skip it */ }
  }
  return { fileCount, bytes };
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

  const dir = measureUploadDir();
  const fileCount = dir ? dir.fileCount : 0;
  const avgFileBytes = fileCount > 0 ? dir.bytes / fileCount : null;
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

  // Reported alongside the volume because the two are constantly confused, and
  // the difference decides where things belong: the database holds only what
  // has to be searched, filtered and reported on (message text, who sent what,
  // amounts, timestamps), while the volume holds the bytes of the images. Seeing
  // both numbers side by side shows at a glance how lopsided that is, and is the
  // fastest way to answer "should this go in Postgres or on disk?" with
  // evidence rather than intuition.
  try {
    const [{ bytes }] = await prisma.$queryRaw`SELECT pg_database_size(current_database())::bigint AS bytes`;
    console.log(`Database size: ${gb(Number(bytes))}GB (text only — image bytes live on the volume above, not in here)`);
  } catch (err) {
    console.warn(`Could not read database size: ${err.message}`);
  }

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
