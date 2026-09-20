// One-time-per-startup recovery, run alongside the other backfills in
// prisma/seed.js: downloads and stores a permanent local copy for any
// recent customer-sent image message that doesn't have one yet — see
// line.service.js's own comment on why this exists in the first place
// (LINE's Content API only guarantees a message's content stays fetchable
// for a limited window, not indefinitely; an old customer image can 404
// there and show up as a blank "[รูป]" placeholder everywhere in the app —
// the Upsell ตรวจสอบ review page especially, since a submission is often
// reviewed well after the customer originally sent the proof image).
//
// Scoped to a recent lookback window rather than all of history: a message
// older than LINE's own retention window has already had its content
// permanently deleted on LINE's side by the time this ever runs — there's
// nothing left to download for those, reaching further back would just
// spend API calls confirming 404s that can never be recovered. The exact
// retention window isn't documented anywhere reliable enough to hard-code
// precisely, so this errs generous (14 days) rather than risk cutting off
// still-recoverable images. Safe to run on every startup: a message this
// already recovered has storedPath set and is excluded from the next pass.
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const LOOKBACK_DAYS = 14;
const CONCURRENCY = 3; // deliberately low — this can run against many channels' LINE tokens at once on startup, no reason to hammer LINE's API

async function backfillMissingImageStorage() {
  // Deferred require — line.service.js requires imageBackfill's sibling
  // (imageStorage.js), not this file, so there's no real cycle, but keeping
  // this import lazy avoids the two files' load order mattering at all.
  const { getMessageContent } = require('../services/line.service');
  const { saveBase64Image } = require('./imageStorage');

  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const candidates = await prisma.message.findMany({
    where: { type: 'image', sender: 'user', lineMessageId: { not: null }, createdAt: { gte: since } },
    select: { id: true, lineMessageId: true, metadata: true, conversation: { select: { channel: true } } },
  });
  const missing = candidates.filter((m) => {
    try { return !JSON.parse(m.metadata || '{}').storedPath; } catch { return true; }
  });
  if (missing.length === 0) return { recovered: 0, stillMissing: 0 };

  let recovered = 0;
  let stillMissing = 0;
  let cursor = 0;
  async function worker() {
    while (cursor < missing.length) {
      const m = missing[cursor++];
      try {
        const { stream, contentType } = await getMessageContent(m.conversation.channel, m.lineMessageId);
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        const storedPath = await saveBase64Image(`data:${contentType};base64,${Buffer.concat(chunks).toString('base64')}`);
        if (storedPath) {
          const meta = { ...JSON.parse(m.metadata || '{}'), storedPath };
          await prisma.message.update({ where: { id: m.id }, data: { metadata: JSON.stringify(meta) } });
          recovered++;
        } else {
          stillMissing++;
        }
      } catch {
        // LINE's content for this message is already gone (404), or some
        // other transient error — either way, nothing more to do for this
        // one right now; it'll simply be retried on the next startup within
        // the lookback window.
        stillMissing++;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, missing.length) }, worker));
  return { recovered, stillMissing };
}

module.exports = { backfillMissingImageStorage };
