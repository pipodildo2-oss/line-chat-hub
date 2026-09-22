// One-time (idempotent) repair: give every already-sent quick-reply image
// message its own reference to its image file.
//
// A message sent from a quick reply used to store nothing but the url
// /api/quick-replies/<quickReplyId>/image/<index>, which resolves by reading
// the LIVE QuickReply row. That makes sent history depend on a mutable
// template: editing a quick reply's images, or deleting a retired one, shifts
// or removes what that index points at and deletes the underlying file — so
// messages sent weeks earlier lose their image retroactively, with no error
// logged anywhere (the route simply 404s or serves a different picture). The
// storage audit found 11,327 such messages carrying no image reference of
// their own at all.
//
// This resolves each one through its quick reply ONCE, while that still works,
// and copies the resulting path onto the message itself (imageData) — the same
// column a composer-sent image has always used — plus rewrites metadata.url to
// the message's own /api/messages/image/:id. From then on the message is
// independent of the template it came from, and quickReplies.js's cleanup can
// see it as a reference and refuse to delete the file.
//
// Nothing is deleted or overwritten destructively: a message that already has
// imageData is skipped, and one whose quick reply (or file) is already gone is
// just counted — that image was lost before this existed and cannot be
// recovered here.
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { isStoredPath, UPLOAD_DIR } = require('./imageStorage');

const prisma = new PrismaClient();
const PAGE_SIZE = 500;
const QUICK_REPLY_URL = /\/api\/quick-replies\/([^/]+)\/image\/(\d+)/;

// Mirrors quickReplies.js's imageAt(): rows predating the images[] array keep
// their single image in the legacy imageData column, reachable at index 0.
function imageAt(row, index) {
  if (row.images && row.images.length > 0) return row.images[index] ?? null;
  return index === 0 ? row.imageData : null;
}

async function giveQuickReplyImagesToTheirMessages() {
  const stats = { scanned: 0, adopted: 0, quickReplyGone: 0, imageGone: 0, fileMissing: 0 };
  let cursor = null;

  for (;;) {
    const page = await prisma.message.findMany({
      where: { type: 'image', sender: 'agent', imageData: null, metadata: { contains: '/api/quick-replies/' } },
      select: { id: true, metadata: true },
      orderBy: { id: 'desc' },
      take: PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (page.length === 0) break;
    cursor = page[page.length - 1].id;

    // Parse first, then load every quick reply this page needs in one query
    // rather than one lookup per message — the same template is typically
    // behind hundreds of these.
    const parsed = [];
    for (const m of page) {
      let url = null;
      try { url = JSON.parse(m.metadata || '{}').url; } catch { /* unparseable — nothing to resolve */ }
      const match = QUICK_REPLY_URL.exec(url || '');
      if (match) parsed.push({ id: m.id, url, quickReplyId: match[1], index: Number(match[2]) });
    }
    stats.scanned += parsed.length;
    if (parsed.length === 0) continue;

    const quickReplies = await prisma.quickReply.findMany({
      where: { id: { in: [...new Set(parsed.map(p => p.quickReplyId))] } },
      select: { id: true, imageData: true, images: true },
    });
    const byId = new Map(quickReplies.map(q => [q.id, q]));

    for (const p of parsed) {
      const qr = byId.get(p.quickReplyId);
      if (!qr) { stats.quickReplyGone++; continue; }
      const storedPath = imageAt(qr, p.index);
      if (!isStoredPath(storedPath)) { stats.imageGone++; continue; }
      if (!fs.existsSync(path.join(UPLOAD_DIR, storedPath.replace('/uploads/', '')))) { stats.fileMissing++; continue; }

      // Keep the origin the agent originally sent through — this app is
      // reachable on both its custom domain and its railway.app one, and an
      // absolute url built from the wrong one would still work but would look
      // inconsistent with every other message in the same conversation.
      let origin = '';
      try { origin = new URL(p.url).origin; } catch { /* relative url is fine too */ }
      await prisma.message.update({
        where: { id: p.id },
        data: {
          imageData: storedPath,
          metadata: JSON.stringify({ url: `${origin}/api/messages/image/${p.id}` }),
        },
      });
      stats.adopted++;
    }
  }

  return stats;
}

module.exports = { giveQuickReplyImagesToTheirMessages };
