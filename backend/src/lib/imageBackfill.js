// Background recovery task, kicked off from index.js AFTER the server is
// already listening (NOT part of the blocking prisma/seed.js startup chain
// — see the incident this comment is describing below): downloads and
// stores a permanent local copy for any recent customer-sent image message
// that doesn't have one yet — see line.service.js's own comment on why this
// exists in the first place (LINE's Content API only guarantees a message's
// content stays fetchable for a limited window, not indefinitely; an old
// customer image can 404 there and show up as a blank "[รูป]" placeholder
// everywhere in the app — the Upsell ตรวจสอบ review page especially, since a
// submission is often reviewed well after the customer originally sent the
// proof image).
//
// INCIDENT: this originally ran inline in prisma/seed.js like the app's
// other backfills, gated behind a plain try/catch with NO per-call timeout
// on getMessageContent (a live network call to LINE's API). seed.js runs
// BEFORE `node src/index.js` in package.json's start script — one slow or
// hanging LINE request stalled seed.js forever, which meant the actual
// server never started listening at all, taking the whole app down
// ("Application failed to respond" on every request, deploy logs silent
// after "prisma generate"). Fixed two ways: a hard per-call timeout below
// (REQUEST_TIMEOUT_MS) so a single stuck request can never hang longer than
// that, AND moved out of the startup-blocking chain entirely — this is only
// ever invoked fire-and-forget after the server is already up, so even a
// bug here again can't block the app from responding to real traffic.
//
// Scoped to a recent lookback window rather than all of history: a message
// older than LINE's own retention window has already had its content
// permanently deleted on LINE's side by the time this ever runs — there's
// nothing left to download for those, reaching further back would just
// spend API calls confirming 404s that can never be recovered. The exact
// retention window isn't documented anywhere reliable enough to hard-code
// precisely — the first real run of this (14-day window) still turned up
// live "Fetch message content failed: 404" errors for images being viewed
// in the Inbox/ตรวจสอบ, meaning some still-being-looked-at images were
// already outside that window — widened to 60 days so more of that recent
// history actually gets covered.
//
// A message doesn't get retried forever, though: on a genuine 404 (LINE
// confirming the content is truly gone, not a timeout/network blip — see the
// err.message check in the catch block below) this permanently marks it
// storageUnrecoverable so future runs skip it instead of re-attempting a
// doomed fetch. Without that,
// every single deploy would re-scan and re-attempt every already-expired
// image in the whole 60-day window from scratch, forever — the first run
// alone already had ~33,500 candidates to get through.
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const LOOKBACK_DAYS = 60;
const CONCURRENCY = 3; // deliberately low — this can run against many channels' LINE tokens at once on startup, no reason to hammer LINE's API
const REQUEST_TIMEOUT_MS = 15000;
const PAGE_SIZE = 500;
const LOG_EVERY = 5000; // rows scanned between progress lines
const LOG_EVERY_MS = 60000; // ...or this long since the last one, whichever comes first

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

// Records LINE's "this content is gone for good" verdict on a message row so
// nothing ever asks for it again (see the file-level comment above on why that
// matters). Shared with GET /api/messages/content/:messageId
// (routes/messages.js), which hits the same 404 live the first time an agent
// opens an old chat — whichever gets there first, the row ends up marked and
// the other stops trying. Takes the caller's prisma client so it works from
// either side without a second connection pool.
async function markContentUnrecoverable(client, where) {
  const row = await client.message.findFirst({ where, select: { id: true, metadata: true } });
  if (!row) return;
  let meta = {};
  try { meta = JSON.parse(row.metadata || '{}'); } catch { /* unparseable metadata gets replaced */ }
  await client.message.update({
    where: { id: row.id },
    data: { metadata: JSON.stringify({ ...meta, storageUnrecoverable: true }) },
  });
}

async function backfillMissingImageStorage() {
  // Deferred require — line.service.js requires imageBackfill's sibling
  // (imageStorage.js), not this file, so there's no real cycle, but keeping
  // this import lazy avoids the two files' load order mattering at all.
  const { getMessageContent } = require('../services/line.service');
  const { saveBase64Image, saveRawMedia } = require('./imageStorage');

  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const stats = { scanned: 0, recovered: 0, expired: 0, retryable: 0 };
  // Walked one page at a time instead of loading every candidate up front.
  // The all-at-once version held a row per image message in the whole window
  // — each one carrying its conversation's full LineChannel object — which
  // pushed this service past 6GB of memory on the 60-day sweep. Paging keeps
  // the footprint flat no matter how far back LOOKBACK_DAYS reaches.
  // Newest-first (cuid ids sort by creation time) so the images agents are
  // most likely to actually open — and the ones LINE might still have — get
  // done first rather than last.
  let pageCursor = null;
  let lastLoggedScanned = 0;
  let lastLoggedTime = Date.now();
  for (;;) {
    const page = await prisma.message.findMany({
      // Video and audio expire from LINE on the same ~2 week clock as images
      // and are stored the same way, so they are rescued on the same terms.
      // They were left out originally only because nothing downloaded them in
      // the first place — see line.service.js.
      where: { type: { in: ['image', 'video', 'audio'] }, sender: 'user', lineMessageId: { not: null }, createdAt: { gte: since } },
      select: { id: true, type: true, lineMessageId: true, metadata: true, createdAt: true, conversation: { select: { channel: true } } },
      orderBy: { id: 'desc' },
      take: PAGE_SIZE,
      ...(pageCursor ? { cursor: { id: pageCursor }, skip: 1 } : {}),
    });
    if (page.length === 0) break;
    pageCursor = page[page.length - 1].id;
    stats.scanned += page.length;

    const missing = page.filter((m) => {
      try {
        const meta = JSON.parse(m.metadata || '{}');
        return !meta.storedPath && !meta.storageUnrecoverable;
      } catch { return true; }
    });
    let next = 0;
    const worker = async () => {
      while (next < missing.length) {
        const m = missing[next++];
        try {
          const { stream, contentType } = await withTimeout(getMessageContent(m.conversation.channel, m.lineMessageId), REQUEST_TIMEOUT_MS);
          const chunks = [];
          for await (const chunk of stream) chunks.push(chunk);
          const bytes = Buffer.concat(chunks);
          // Images go through sharp's compression pipeline; video and audio are
          // written as they arrived, since sharp can't read them at all.
          const storedPath = m.type === 'image'
            ? await saveBase64Image(`data:${contentType};base64,${bytes.toString('base64')}`)
            : saveRawMedia(bytes, contentType).storedPath;
          if (storedPath) {
            const meta = { ...JSON.parse(m.metadata || '{}'), storedPath };
            await prisma.message.update({ where: { id: m.id }, data: { metadata: JSON.stringify(meta) } });
            stats.recovered++;
          } else {
            stats.retryable++;
          }
        } catch (err) {
          // A genuine 404 means LINE has confirmed this message's content is
          // truly gone — permanently mark it so future runs stop re-attempting
          // a fetch that can never succeed (see the file-level comment on why
          // that matters). A timeout or any other error might just be an
          // unlucky one-off, not necessarily permanent, so those stay eligible
          // for a retry on the next run instead.
          if (/^404\b/.test(err?.message || '')) {
            try {
              await markContentUnrecoverable(prisma, { id: m.id });
            } catch { /* best effort — worst case this one just gets retried next time too */ }
            stats.expired++;
          } else {
            stats.retryable++;
          }
        }
      }
    };
    if (missing.length > 0) {
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, missing.length) }, worker));
    }
    // Progress as it goes, not just a summary at the very end: this sweep runs
    // for hours on a large history, and without it there is no way to tell a
    // run that is working through a backlog apart from one that silently did
    // nothing at all — which is exactly the question that came up while
    // chasing the blank-placeholder reports.
    //
    // Two triggers, because either one alone leaves a blind spot. A row count
    // alone goes quiet for a very long time once it reaches the part of the
    // history that needs real work: pages of already-done rows fly past at
    // ~40k/second, but a page needing 500 live LINE round-trips can take many
    // minutes, so the next count-based line may be an hour away — which looks
    // identical to a stall. An elapsed-time heartbeat alone would spam a line
    // per page during the fast stretch. Whichever comes first.
    //
    // The date is the useful part of the line: it says how far back the sweep
    // has actually reached, which is what tells you whether it's nearly done.
    if (stats.scanned - lastLoggedScanned >= LOG_EVERY || Date.now() - lastLoggedTime >= LOG_EVERY_MS) {
      lastLoggedScanned = stats.scanned;
      lastLoggedTime = Date.now();
      const reachedDate = page[page.length - 1].createdAt.toISOString().slice(0, 10);
      console.log(`Image recovery in progress: scanned ${stats.scanned} (back to ${reachedDate}), recovered ${stats.recovered}, expired on LINE ${stats.expired}, will retry ${stats.retryable}`);
    }
  }
  return stats;
}

module.exports = { backfillMissingImageStorage, markContentUnrecoverable };
