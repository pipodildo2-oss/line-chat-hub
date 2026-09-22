// Read-only audit of every image message's backing file, logged on startup.
//
// Added because the "โหลดรูปไม่ได้" placeholders could not be diagnosed from
// the outside: the server logs no error at all for them (no 404, no 500, no
// sendFile failure), so whatever is being served comes back 200 and the
// browser simply can't decode it. That rules out the whole class of causes the
// earlier fixes addressed (expired-on-LINE content, rows missing metadata.url)
// and points at the stored files themselves — but nothing in the app ever
// looked at a stored file's actual state, so there was no way to tell a healthy
// one from a zero-byte or truncated one.
//
// This just counts and reports; it changes nothing. Sample ids are logged for
// each failing category specifically so they can be checked by hand afterwards
// (an agent image's /api/messages/image/:id route needs no auth, so a sample id
// is enough to reproduce a bad response directly).
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { isStoredPath, UPLOAD_DIR } = require('./imageStorage');

const prisma = new PrismaClient();
const LOOKBACK_DAYS = 30;
const PAGE_SIZE = 500;
const SAMPLES = 5;

function resolveStored(storedPath) {
  return path.join(UPLOAD_DIR, storedPath.replace('/uploads/', ''));
}

// A JPEG always starts with FF D8 FF and a PNG with the 8-byte \x89PNG
// signature. Reading the first few bytes is enough to tell a real image from a
// file that exists but holds something else (an error body, a truncated write,
// nothing at all) — which is exactly the shape of failure a browser reports as
// a broken image while the server considers the response a success.
function inspectFile(filePath) {
  let fd;
  try {
    const size = fs.statSync(filePath).size;
    if (size === 0) return { state: 'empty', size };
    const head = Buffer.alloc(8);
    fd = fs.openSync(filePath, 'r');
    const read = fs.readSync(fd, head, 0, 8, 0);
    const isJpeg = read >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    const isPng = read >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    return { state: isJpeg || isPng ? 'ok' : 'not-an-image', size, head: head.subarray(0, read).toString('hex') };
  } catch (err) {
    return { state: err.code === 'ENOENT' ? 'missing' : 'unreadable', size: 0 };
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ }
  }
}

function bucket(tally, key, id) {
  const entry = tally[key] || (tally[key] = { count: 0, samples: [] });
  entry.count++;
  if (entry.samples.length < SAMPLES) entry.samples.push(id);
}

function report(label, tally) {
  const keys = Object.keys(tally).sort((a, b) => tally[b].count - tally[a].count);
  if (keys.length === 0) return console.log(`Storage audit — ${label}: nothing to report`);
  for (const k of keys) {
    console.log(`Storage audit — ${label} | ${k}: ${tally[k].count}${tally[k].samples.length ? ` | e.g. ${tally[k].samples.join(', ')}` : ''}`);
  }
}

async function auditImageStorage() {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const agent = {};
  const customer = {};
  let scanned = 0;
  let cursor = null;

  for (;;) {
    const page = await prisma.message.findMany({
      where: { type: 'image', createdAt: { gte: since } },
      select: { id: true, sender: true, metadata: true, imageData: true, lineMessageId: true },
      orderBy: { id: 'desc' },
      take: PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (page.length === 0) break;
    cursor = page[page.length - 1].id;
    scanned += page.length;

    for (const m of page) {
      let meta = {};
      try { meta = JSON.parse(m.metadata || '{}'); } catch { /* treated as absent below */ }

      if (m.sender === 'agent') {
        if (!meta.url) bucket(agent, 'no metadata.url', m.id);
        if (!m.imageData) { bucket(agent, 'no imageData at all', m.id); continue; }
        if (!isStoredPath(m.imageData)) { bucket(agent, 'legacy inline base64 (not a file)', m.id); continue; }
        bucket(agent, `file ${inspectFile(resolveStored(m.imageData)).state}`, m.id);
      } else {
        if (meta.storageUnrecoverable) { bucket(customer, 'marked expired on LINE', m.id); continue; }
        if (!meta.storedPath) { bucket(customer, 'no local copy (live LINE fetch)', m.id); continue; }
        if (!isStoredPath(meta.storedPath)) { bucket(customer, 'storedPath malformed', m.id); continue; }
        bucket(customer, `file ${inspectFile(resolveStored(meta.storedPath)).state}`, m.id);
      }
    }
  }

  console.log(`Storage audit — scanned ${scanned} image message(s) from the last ${LOOKBACK_DAYS} days`);
  report('agent-sent', agent);
  report('customer-sent', customer);
  return { scanned, agent, customer };
}

module.exports = { auditImageStorage, inspectFile, resolveStored };
