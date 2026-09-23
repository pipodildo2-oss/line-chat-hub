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
const BATCH_PER_RUN = Number(process.env.ARCHIVE_BATCH || 1000);
const PROGRESS_EVERY = 25; // rows between progress lines
// Kept low on purpose: this shares the volume and the database with live
// traffic, and R2's own limits are nowhere near the constraint here — a few in
// flight is all it takes to turn the network wait from serial into parallel.
const CONCURRENCY = Number(process.env.ARCHIVE_CONCURRENCY || 5);

const localPathFor = (storedPath) => path.join(UPLOAD_DIR, storedPath.replace('/uploads/', ''));

// Keyed by date so the bucket stays navigable by hand years from now, when the
// reason anyone opens it is likely to be an audit or an incident.
function keyFor(storedPath, createdAt) {
  const d = new Date(createdAt);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `images/${yyyy}/${mm}/${storedPath.replace('/uploads/', '')}`;
}

// Whatever the file actually is. R2 stores the content type alongside the
// object and it is what the browser gets back on retrieval, so guessing wrong
// here would archive a perfectly good video that then refuses to play.
const CONTENT_TYPES = {
  jpg: 'image/jpeg', png: 'image/png',
  mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', '3gp': 'video/3gpp',
  m4a: 'audio/mp4', aac: 'audio/aac', mp3: 'audio/mpeg', amr: 'audio/amr', wav: 'audio/wav',
};
function contentTypeFor(storedPath) {
  return CONTENT_TYPES[String(storedPath).split('.').pop().toLowerCase()] || 'application/octet-stream';
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
  // Derived from the file rather than assumed to be a JPEG — video and audio
  // are archived through here too, and storing them under an image content
  // type would hand the browser something it refuses to play.
  if (!(await r2.putVerified(key, buffer, contentTypeFor(storedPath)))) return 'failed';

  // The thumbnail is a separate file and is archived too, so the message keeps
  // everything it had rather than a reduced version of it. Its absence is not
  // a failure — plenty of older rows never had one.
  const thumbStored = thumbPathFor(storedPath);
  const thumbBuffer = thumbStored === storedPath ? null : readIfPresent(localPathFor(thumbStored));
  let thumbKey = null;
  if (thumbBuffer) {
    const candidate = keyFor(thumbStored, message.createdAt);
    if (await r2.putVerified(candidate, thumbBuffer, contentTypeFor(thumbStored))) thumbKey = candidate;
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
  const startedAt = Date.now();
  let announcedFirst = false;
  let cursor = null;

  while (stats.considered < BATCH_PER_RUN) {
    const page = await prisma.message.findMany({
      // Narrowed to rows that could actually have something to archive, rather
      // than every old image message. The first production run showed why:
      // all 500 of its batch were ancient rows whose content LINE had already
      // deleted long before this app kept copies, so it skipped all 500 and
      // archived nothing — and at 500 a run it would have spent dozens of
      // passes walking past ~47,000 of those before reaching a single real
      // file. Matching on the stored-path markers costs nothing here and makes
      // every batch real work.
      where: {
        // Video and audio are archived on exactly the same terms as images —
        // they are stored the same way and cost the volume the same bytes.
        type: { in: ['image', 'video', 'audio'] },
        createdAt: { lt: before },
        NOT: { metadata: { contains: '"r2Key"' } },
        OR: [
          { imageData: { startsWith: '/uploads/' } },      // agent-sent
          { metadata: { contains: '"storedPath"' } },      // customer-sent
        ],
      },
      select: { id: true, sender: true, metadata: true, imageData: true, createdAt: true },
      orderBy: { id: 'asc' }, // oldest first — the least likely to be opened
      take: Math.min(PAGE_SIZE, BATCH_PER_RUN - stats.considered),
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (page.length === 0) break;
    cursor = page[page.length - 1].id;

    // Worked on several at a time rather than one after another. Measured on
    // the first real run: 4.9 seconds per image, because each one waits on
    // four sequential R2 round-trips. At that rate a single run manages 500
    // images and the four daily runs total 2,000 — against ~3,600 images a day
    // crossing the retention line. It would have fallen a permanent 1,600
    // images a day further behind, forever, which is a backlog that never
    // recovers and eventually means the volume never actually gets freed.
    // Concurrency is the whole fix: the time is spent waiting on the network,
    // not computing, so a handful in flight turns ~5 hours of work a day into
    // about one.
    let next = 0;
    const worker = async () => {
      while (next < page.length) {
        const m = page[next++];
        await processOne(m);
      }
    };
    async function processOne(m) {
      stats.considered++;
      try {
        const outcome = await archiveOne(m);
        stats[outcome]++;
        // The very first successful upload gets its own line, immediately.
        // "Can this service reach the bucket at all" is the one question worth
        // answering in seconds rather than at the end of a run — every earlier
        // attempt to verify this setup stalled on exactly that, watching a
        // silent log for minutes with no way to tell a slow upload from a
        // broken one.
        if (!announcedFirst && (outcome === 'archived' || outcome === 'archivedAndFreed')) {
          announcedFirst = true;
          console.log(`Image archive: first upload verified against R2 (bucket ${r2.BUCKET}) after ${Math.round((Date.now() - startedAt) / 1000)}s — connection works.`);
        }
      } catch (err) {
        stats.failed++;
        console.error(`Archive failed for message ${m.id}: ${err.message}`);
      }
      // Progress as it goes. Each image costs four R2 round-trips (upload and
      // read-back, for the full image and its thumbnail), so a 500-row batch
      // takes minutes — long enough that a run with no output is
      // indistinguishable from one that died, which is the same blind spot
      // that has now cost hours three separate times in this codebase.
      if (stats.considered % PROGRESS_EVERY === 0) {
        console.log(`Image archive: ${stats.considered}/${BATCH_PER_RUN} considered after ${Math.round((Date.now() - startedAt) / 1000)}s — uploaded ${stats.archived + stats.archivedAndFreed}, failed ${stats.failed}`);
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, page.length) }, worker));
  }

  // Always logged, even when it found nothing to do. "Ran and there was
  // nothing older than the window with a local file" and "never ran at all"
  // are completely different situations that a silent no-op renders
  // identical — a distinction that has already cost hours twice in this
  // codebase, once for the recovery sweep and once for its progress output.
  console.log(`Image archive finished in ${Math.round((Date.now() - startedAt) / 1000)}s: cutoff ${RETENTION_DAYS} days, considered ${stats.considered}, uploaded+verified ${stats.archived + stats.archivedAndFreed}`
    + `, local copies freed ${stats.archivedAndFreed}${DELETE_LOCAL ? '' : ' (deletion disabled — set ARCHIVE_DELETE_LOCAL=true once verified)'}`
    + `, already archived ${stats.already}, no local file ${stats.nolocal}, nothing to archive ${stats.skipped}, failed ${stats.failed}`);
  return stats;
}

module.exports = { archiveOldImages, keyFor, locate, RETENTION_DAYS, DELETE_LOCAL };
