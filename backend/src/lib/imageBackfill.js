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

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

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
    try {
      const meta = JSON.parse(m.metadata || '{}');
      return !meta.storedPath && !meta.storageUnrecoverable;
    } catch { return true; }
  });
  if (missing.length === 0) return { recovered: 0, stillMissing: 0 };

  let recovered = 0;
  let stillMissing = 0;
  let cursor = 0;
  async function worker() {
    while (cursor < missing.length) {
      const m = missing[cursor++];
      try {
        const { stream, contentType } = await withTimeout(getMessageContent(m.conversation.channel, m.lineMessageId), REQUEST_TIMEOUT_MS);
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
      } catch (err) {
        // A genuine 404 means LINE has confirmed this message's content is
        // truly gone — permanently mark it so future runs stop re-attempting
        // a fetch that can never succeed (see the file-level comment on why
        // that matters). A timeout or any other error might just be an
        // unlucky one-off, not necessarily permanent, so those stay eligible
        // for a retry on the next run instead.
        if (/^404\b/.test(err?.message || '')) {
          try {
            const meta = { ...JSON.parse(m.metadata || '{}'), storageUnrecoverable: true };
            await prisma.message.update({ where: { id: m.id }, data: { metadata: JSON.stringify(meta) } });
          } catch { /* best effort — worst case this one just gets retried next time too */ }
        }
        stillMissing++;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, missing.length) }, worker));
  return { recovered, stillMissing };
}

module.exports = { backfillMissingImageStorage };
