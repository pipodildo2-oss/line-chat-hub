// Moves images past the local retention window to Cloudflare R2, so the volume
// holds a fixed ~3 months of recent history instead of growing forever, while
// nothing is ever actually thrown away.
//
// The order of operations is the whole design, and it is deliberately the
// reverse of how this codebase previously lost data. Quick-reply cleanup used
// to delete an image file and only then discover that sent messages still
// pointed at it; ~47,000 customer images were lost because the app assumed a
// copy existed somewhere else without ever checking. So here, deletion is the
// last step and is gated on proof:
//
//   upload -> read back from R2 and compare hashes -> record the key on the row
//   -> (only if explicitly enabled) delete the local file
//
// Every one of those steps has to succeed for the next to run. If anything is
// off — upload throws, the hash doesn't match, the database write fails — the
// local file is left exactly where it is and the message is retried on the next
// pass. The worst case is a wasted upload, never a missing image.
//
// Deleting is also off by default (ARCHIVE_DELETE_LOCAL), so the first runs
// only ever ADD a second copy in R2. That way the archive can be proven against
// real traffic — old images still opening normally, now served from R2 — before
// anything becomes irreversible.
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { isStoredPath, thumbPathFor, UPLOAD_DIR } = require('./imageStorage');
const r2 = require('./r2');

const prisma = new PrismaClient();
const RETENTION_DAYS = Number(process.env.ARCHIVE_AFTER_DAYS || 90);
// Opt-in second phase. Until this is set, archiving only ever adds a copy to
// R2 — the local file stays, so a mistake costs disk space rather than data.
const DELETE_LOCAL = process.env.ARCHIVE_DELETE_LOCAL === 'true';
const PAGE_SIZE = 200;
// Deliberately modest: this runs alongside live traffic on the same volume and
// there is no deadline. A backlog simply takes a few more passes.
const BATCH_PER_RUN = Number(process.env.ARCHIVE_BATCH || 500);

const localPathFor = (storedPath) => path.join(UPLOAD_DIR, storedPath.replace('/uploads/', ''));

// Keyed by date so the bucket stays navigable by hand years from now, when the
// reason anyone opens it is likely to be an audit or an incident.
function keyFor(storedPath, createdAt) {
  const d = new Date(createdAt);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `images/${yyyy}/${mm}/${storedPath.replace('/uploads/', '')}`;
}

function readIfPresent(filePath) {
  try { return fs.readFileSync(filePath); } catch { return null; }
}

// Where this message's image bytes live. Customer images record it under
// metadata.storedPath; agent images use the imageData column. Both may also
// carry an r2Key once archived.
function locate(message) {
  let meta = {};
  try { meta = JSON.parse(message.metadata || '{}'); } catch { /* treated as absent */ }
  const storedPath = message.sender === 'agent' ? message.imageData : meta.storedPath;
  return { meta, storedPath };
}

async function archiveOne(message) {
  const { meta, storedPath } = locate(message);
  if (!isStoredPath(storedPath)) return 'skipped';
  if (meta.r2Key) return 'already';

  const fullLocal = localPathFor(storedPath);
  const buffer = readIfPresent(fullLocal);
  // Nothing on disk to archive. Either it was archived by an earlier run whose
  // database write didn't land, or it went missing some other way — both are
  // for the storage audit to report, not for this to paper over.
  if (!buffer) return 'nolocal';

  const key = keyFor(storedPath, message.createdAt);
  if (!(await r2.putVerified(key, buffer, 'image/jpeg'))) return 'failed';

  // The thumbnail is a separate file and is archived too, so the message keeps
  // everything it had rather than a reduced version of it. Its absence is not
  // a failure — plenty of older rows never had one.
  const thumbStored = thumbPathFor(storedPath);
  const thumbBuffer = thumbStored === storedPath ? null : readIfPresent(localPathFor(thumbStored));
  let thumbKey = null;
  if (thumbBuffer) {
    const candidate = keyFor(thumbStored, message.createdAt);
    if (await r2.putVerified(candidate, thumbBuffer, 'image/jpeg')) thumbKey = candidate;
    else return 'failed'; // don't record a partial archive
  }

  // Recorded BEFORE any deletion, and the deletion below only runs because
  // this succeeded. If the process dies between the two, the row points at a
  // verified R2 copy and the local file is still there — harmless overlap.
  await prisma.message.update({
    where: { id: message.id },
    data: { metadata: JSON.stringify({ ...meta, r2Key: key, ...(thumbKey ? { r2ThumbKey: thumbKey } : {}) }) },
  });

  if (DELETE_LOCAL) {
    fs.rmSync(fullLocal, { force: true });
    if (thumbBuffer) fs.rmSync(localPathFor(thumbStored), { force: true });
    return 'archivedAndFreed';
  }
  return 'archived';
}

async function archiveOldImages() {
  if (!r2.isConfigured()) {
    console.log('Image archive: skipped — R2 is not configured (needs R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)');
    return { skipped: 'R2 not configured' };
  }

  const before = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const stats = { considered: 0, archived: 0, archivedAndFreed: 0, already: 0, nolocal: 0, failed: 0, skipped: 0 };
  let cursor = null;

  while (stats.considered < BATCH_PER_RUN) {
    const page = await prisma.message.findMany({
      where: { type: 'image', createdAt: { lt: before } },
      select: { id: true, sender: true, metadata: true, imageData: true, createdAt: true },
      orderBy: { id: 'asc' }, // oldest first — the least likely to be opened
      take: Math.min(PAGE_SIZE, BATCH_PER_RUN - stats.considered),
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (page.length === 0) break;
    cursor = page[page.length - 1].id;

    for (const m of page) {
      stats.considered++;
      try {
        stats[await archiveOne(m)]++;
      } catch (err) {
        stats.failed++;
        console.error(`Archive failed for message ${m.id}: ${err.message}`);
      }
    }
  }

  // Always logged, even when it found nothing to do. "Ran and there was
  // nothing older than the window with a local file" and "never ran at all"
  // are completely different situations that a silent no-op renders
  // identical — a distinction that has already cost hours twice in this
  // codebase, once for the recovery sweep and once for its progress output.
  console.log(`Image archive: cutoff ${RETENTION_DAYS} days, considered ${stats.considered}, uploaded+verified ${stats.archived + stats.archivedAndFreed}`
    + `, local copies freed ${stats.archivedAndFreed}${DELETE_LOCAL ? '' : ' (deletion disabled — set ARCHIVE_DELETE_LOCAL=true once verified)'}`
    + `, already archived ${stats.already}, no local file ${stats.nolocal}, failed ${stats.failed}`);
  return stats;
}

module.exports = { archiveOldImages, keyFor, locate, RETENTION_DAYS, DELETE_LOCAL };
