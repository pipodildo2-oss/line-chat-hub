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
const { sendOpsAlert } = require('./opsAlert');

const prisma = new PrismaClient();
// Uploading and deleting are two different jobs on two different clocks, and
// conflating them was a real weakness in the original design: while the only
// copy of an image lived on the volume until it turned 90 days old, that volume
// was a single point of failure for every recent piece of evidence in the
// system — the newest and most-used images were exactly the ones with no second
// copy anywhere. Losing it would have meant losing months of proof, and the
// archive would have been no help at all.
//
// So the copy goes up almost immediately, and deletion still waits the full
// retention period. Storage in R2 is about $0.015/GB/month and reads cost
// nothing, so a permanent second copy of everything is a rounding error against
// what it protects.
const BACKUP_AFTER_HOURS = Number(process.env.BACKUP_AFTER_HOURS || 1);
const RETENTION_DAYS = Number(process.env.ARCHIVE_AFTER_DAYS || 90);
// Opt-in third phase. Until this is set, nothing is ever deleted from the
// volume — the R2 copy simply accumulates alongside it.
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

// Frees the local copies of a row that is already in R2, once it is past
// retention. Split out because backing up and freeing are now on separate
// clocks: a row backed up weeks ago comes back through here later purely to
// have its local copy reclaimed, and without this it would return "already" and
// keep both copies forever — the volume would never actually shrink.
async function freeLocalCopy(storedPath, r2Key) {
  const fullLocal = localPathFor(storedPath);
  const thumbStored = thumbPathFor(storedPath);
  if (!fs.existsSync(fullLocal)) return 'already'; // nothing left to reclaim
  // Re-checked against R2 rather than trusted from the database. The recorded
  // key is evidence that an upload once succeeded; this is the last moment
  // before the local file stops existing, and the whole reason ~47,000 images
  // were lost is that something assumed a copy existed elsewhere without
  // asking. A missing object here is a real fault and is reported, not skipped
  // over.
  if (!(await r2.objectExists(r2Key))) {
    console.error(`Refusing to free ${storedPath}: its archived copy ${r2Key} is not in R2.`);
    return 'failed';
  }
  fs.rmSync(fullLocal, { force: true });
  if (thumbStored !== storedPath) fs.rmSync(localPathFor(thumbStored), { force: true });
  return 'archivedAndFreed';
}

async function archiveOne(message, deleteBefore) {
  const { meta, storedPath } = locate(message);
  if (!isStoredPath(storedPath)) return 'skipped';
  if (meta.r2Key) {
    if (!DELETE_LOCAL || message.createdAt >= deleteBefore) return 'already';
    return freeLocalCopy(storedPath, meta.r2Key);
  }

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

  // Freeing the local copy is a separate decision from having backed it up,
  // and only happens once the message is genuinely past the retention window.
  // Anything newer keeps both copies: the volume serves it fast, R2 holds the
  // insurance.
  const pastRetention = message.createdAt < deleteBefore;
  if (DELETE_LOCAL && pastRetention) {
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

  // Everything that isn't in R2 yet is a candidate, not just the old rows. The
  // short delay only avoids racing the ingestion path that is still writing the
  // file (line.service.js stores it moments after the message arrives).
  const backupBefore = new Date(Date.now() - BACKUP_AFTER_HOURS * 60 * 60 * 1000);
  const deleteBefore = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
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
        createdAt: { lt: backupBefore },
        AND: [
          // Has a file of ours at all. Narrowed here rather than filtered in
          // code because the first production run showed the cost: all 500 of
          // its batch were ancient rows whose content LINE deleted long before
          // this app kept copies, so it skipped every one, and it would have
          // spent dozens of passes walking past ~47,000 of those before
          // reaching a single real file.
          { OR: [
            { imageData: { startsWith: '/uploads/' } },    // agent-sent
            { metadata: { contains: '"storedPath"' } },    // customer-sent
          ] },
          // Either not backed up yet, or backed up and now old enough that its
          // local copy can be reclaimed. The second case only matters once
          // deletion is switched on — including it otherwise would just load
          // rows that have nothing left to do.
          { OR: DELETE_LOCAL
            ? [
              { NOT: { metadata: { contains: '"r2Key"' } } },
              { createdAt: { lt: deleteBefore } },
            ]
            : [
              { NOT: { metadata: { contains: '"r2Key"' } } },
            ] },
        ],
      },
      select: { id: true, sender: true, metadata: true, imageData: true, createdAt: true },
      // Newest first: the recent files are the ones an outage would hurt most,
      // since they are the only ones nobody has a second copy of yet.
      orderBy: { id: 'desc' },
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
      // Captured at claim time, not read back at the end. Several workers run
      // at once, so a shared counter read after the await can hold the same
      // value for all of them — which is why the first run under concurrency
      // printed "200/1000" five times in a row. The point of these lines is to
      // be trustworthy at a glance; duplicated ones are noise.
      //
      // Each milestone is now reported exactly once, though two of them can
      // still arrive out of order when the worker that claimed the earlier row
      // finishes after one that claimed a later row. That is inherent to doing
      // several at a time and costs nothing: every line is still a true
      // statement about a position that was reached.
      const position = ++stats.considered;
      try {
        const outcome = await archiveOne(m, deleteBefore);
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
      if (position % PROGRESS_EVERY === 0) {
        console.log(`Image archive: ${position}/${BATCH_PER_RUN} considered after ${Math.round((Date.now() - startedAt) / 1000)}s — uploaded ${stats.archived + stats.archivedAndFreed}, failed ${stats.failed}`);
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, page.length) }, worker));
  }

  // Always logged, even when it found nothing to do. "Ran and there was
  // nothing older than the window with a local file" and "never ran at all"
  // are completely different situations that a silent no-op renders
  // identical — a distinction that has already cost hours twice in this
  // codebase, once for the recovery sweep and once for its progress output.
  console.log(`Image archive finished in ${Math.round((Date.now() - startedAt) / 1000)}s: backing up anything older than ${BACKUP_AFTER_HOURS}h, freeing local copies after ${RETENTION_DAYS} days, considered ${stats.considered}, uploaded+verified ${stats.archived + stats.archivedAndFreed}`
    + `, local copies freed ${stats.archivedAndFreed}${DELETE_LOCAL ? '' : ' (deletion disabled — set ARCHIVE_DELETE_LOCAL=true once verified)'}`
    + `, already archived ${stats.already}, no local file ${stats.nolocal}, nothing to archive ${stats.skipped}, failed ${stats.failed}`);
  // Failures here are not cosmetic: a row that can't reach R2 is a file with
  // no second copy, and once deletion is switched on it is also a file that
  // will never be reclaimed. Worth interrupting someone for, but only once a
  // run and only when it's actually happening.
  if (stats.failed > 0) {
    sendOpsAlert(
      'archive-failures',
      'สำรองรูปขึ้น Cloudflare ไม่สำเร็จ',
      `รอบล่าสุดมี <b>${stats.failed}</b> รายการที่อัปโหลดหรือตรวจสอบไม่ผ่าน `
      + `(สำเร็จ ${stats.archived + stats.archivedAndFreed} รายการ)\n\n`
      + 'ไฟล์ในเครื่องยังอยู่ครบ ไม่มีอะไรถูกลบ ระบบจะลองใหม่ในรอบถัดไป '
      + 'แต่ถ้ายังไม่หายควรตรวจการตั้งค่า R2',
    );
  }
  return stats;
}

module.exports = { archiveOldImages, keyFor, locate, RETENTION_DAYS, DELETE_LOCAL };
