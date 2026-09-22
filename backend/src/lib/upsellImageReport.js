// Walks every upsell submission and reports, per submitting agent, how many
// still show a broken thumbnail on the ตรวจสอบ page and why — the same answer
// as opening each agent in that page one at a time, except complete rather
// than sampled, and it says which of the two very different causes each one is.
//
// The distinction is the whole point, because only one of them is a bug:
//
//   expired  — a customer's image whose content LINE deleted from its own
//              servers before this app ever kept a copy (it only stored a LINE
//              message id and re-fetched on demand). Nothing to recover; the
//              bytes do not exist anywhere. See imageBackfill.js.
//   orphaned — an agent's image sent from a quick reply that was later edited
//              or deleted, which took the underlying file with it. These were
//              recoverable and 11,269 of them have been (see
//              quickReplyImageOwnership.js); what remains is the handful whose
//              file was already gone before that repair ran.
//   broken   — a file that is present but isn't decodable image data. None are
//              expected; any at all means something is still wrong with how
//              files get written, so it is called out separately.
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { isStoredPath, UPLOAD_DIR } = require('./imageStorage');
const { inspectFile } = require('./storageAudit');

const prisma = new PrismaClient();
const PAGE_SIZE = 200;
const MAX_AGENTS_LOGGED = 25;

function classify(message) {
  let meta = {};
  try { meta = JSON.parse(message.metadata || '{}'); } catch { /* treated as absent */ }

  if (message.sender === 'agent') {
    if (!isStoredPath(message.imageData)) return 'orphaned';
    return inspectFile(path.join(UPLOAD_DIR, message.imageData.replace('/uploads/', ''))).state === 'ok' ? 'ok' : 'broken';
  }
  if (meta.storageUnrecoverable) return 'expired';
  // No local copy and not yet marked: the live LINE fetch may still work, so
  // this isn't counted against anyone — it resolves itself either way once
  // that fetch is tried (messages.js marks it on a 404).
  if (!isStoredPath(meta.storedPath)) return 'unknown';
  return inspectFile(path.join(UPLOAD_DIR, meta.storedPath.replace('/uploads/', ''))).state === 'ok' ? 'ok' : 'broken';
}

async function reportUpsellImageHealth() {
  const totals = { ok: 0, expired: 0, orphaned: 0, broken: 0, unknown: 0 };
  const byAgent = new Map();
  let cursor = null;

  for (;;) {
    const page = await prisma.upsellSubmission.findMany({
      select: {
        id: true,
        agent: { select: { name: true } },
        items: { select: { message: { select: { sender: true, type: true, metadata: true, imageData: true } } } },
      },
      orderBy: { id: 'desc' },
      take: PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (page.length === 0) break;
    cursor = page[page.length - 1].id;

    for (const sub of page) {
      const name = sub.agent?.name || '(ไม่ทราบชื่อ)';
      const row = byAgent.get(name) || { submissions: 0, affected: 0, ok: 0, expired: 0, orphaned: 0, broken: 0 };
      row.submissions++;
      let affected = false;
      for (const item of sub.items) {
        if (item.message?.type !== 'image') continue;
        const state = classify(item.message);
        totals[state]++;
        if (state === 'unknown') continue;
        row[state]++;
        if (state !== 'ok') affected = true;
      }
      if (affected) row.affected++;
      byAgent.set(name, row);
    }
  }

  console.log(`Upsell image report — images: ${totals.ok} ok, ${totals.expired} expired on LINE (unrecoverable), ${totals.orphaned} orphaned by a deleted quick reply, ${totals.broken} present but unreadable, ${totals.unknown} not yet resolved`);
  const ranked = [...byAgent.entries()]
    .filter(([, r]) => r.affected > 0)
    .sort((a, b) => (b[1].expired + b[1].orphaned + b[1].broken) - (a[1].expired + a[1].orphaned + a[1].broken));
  if (ranked.length === 0) {
    console.log('Upsell image report — every submission renders all of its images');
  }
  for (const [name, r] of ranked.slice(0, MAX_AGENTS_LOGGED)) {
    console.log(`Upsell image report — ${name}: ${r.affected}/${r.submissions} submission(s) affected | expired ${r.expired}, orphaned ${r.orphaned}, unreadable ${r.broken}, ok ${r.ok}`);
  }
  if (ranked.length > MAX_AGENTS_LOGGED) {
    console.log(`Upsell image report — …and ${ranked.length - MAX_AGENTS_LOGGED} more agent(s)`);
  }
  return { totals, byAgent };
}

module.exports = { reportUpsellImageHealth };
