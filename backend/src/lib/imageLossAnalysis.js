// Answers one specific question with data instead of argument: do images go
// missing BECAUSE a message was claimed for an upsell?
//
// It's a reasonable thing to suspect — the ตรวจสอบ page is where a missing
// image is most visible, so that's where it gets noticed, and noticing it there
// makes claiming look like the trigger. Anecdotes can't separate the two: the
// claimed messages are exactly the ones anyone looks at twice.
//
// So this cross-tabulates every image message over the window by whether it was
// ever claimed and whether its image still displays. If claiming were the
// cause, the missing rate among claimed images would be far higher than among
// unclaimed ones. If the real cause is time (LINE deletes a message's content
// about two weeks after it's sent, and this app only started keeping its own
// copy on 7 Sep 2026 — see imageBackfill.js), the two rates will be close and
// the split will fall on the DATE instead, which the per-day breakdown below
// shows directly.
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { isStoredPath, UPLOAD_DIR } = require('./imageStorage');

const prisma = new PrismaClient();
const LOOKBACK_DAYS = 45;
const PAGE_SIZE = 500;
const TOP_CONVERSATIONS = 15;

function fileIsThere(storedPath) {
  if (!isStoredPath(storedPath)) return false;
  try { return fs.statSync(path.join(UPLOAD_DIR, storedPath.replace('/uploads/', ''))).size > 0; } catch { return false; }
}

// "Missing" means an agent opening this message would not see the picture —
// deliberately judged the same way for a claimed and an unclaimed message, so
// the comparison below is fair.
function isMissing(m) {
  let meta = {};
  try { meta = JSON.parse(m.metadata || '{}'); } catch { /* treated as absent */ }
  if (m.sender === 'agent') return !fileIsThere(m.imageData);
  if (meta.storageUnrecoverable) return true;
  return !fileIsThere(meta.storedPath);
}

function rate(missing, total) {
  return total === 0 ? 'n/a' : `${((missing / total) * 100).toFixed(1)}%`;
}

async function analyseImageLoss() {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const tally = {
    claimed: { total: 0, missing: 0 },
    unclaimed: { total: 0, missing: 0 },
    agentClaimed: { total: 0, missing: 0 },
    agentUnclaimed: { total: 0, missing: 0 },
  };
  const byDay = new Map();
  const byConversation = new Map();
  let cursor = null;

  for (;;) {
    const page = await prisma.message.findMany({
      where: { type: 'image', createdAt: { gte: since } },
      select: {
        id: true, sender: true, metadata: true, imageData: true, createdAt: true,
        conversation: { select: { id: true, displayName: true } },
        upsellItems: { select: { id: true }, take: 1 },
      },
      orderBy: { id: 'desc' },
      take: PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (page.length === 0) break;
    cursor = page[page.length - 1].id;

    for (const m of page) {
      const claimed = m.upsellItems.length > 0;
      const missing = isMissing(m);
      const bucket = m.sender === 'agent'
        ? (claimed ? 'agentClaimed' : 'agentUnclaimed')
        : (claimed ? 'claimed' : 'unclaimed');
      tally[bucket].total++;
      if (missing) tally[bucket].missing++;

      if (m.sender !== 'agent') {
        const day = m.createdAt.toISOString().slice(0, 10);
        const d = byDay.get(day) || { total: 0, missing: 0, claimed: 0, claimedMissing: 0 };
        d.total++;
        if (missing) d.missing++;
        if (claimed) { d.claimed++; if (missing) d.claimedMissing++; }
        byDay.set(day, d);

        const key = m.conversation?.displayName || m.conversation?.id || '(ไม่ทราบ)';
        const c = byConversation.get(key) || { total: 0, missing: 0, claimedMissing: 0, unclaimedMissing: 0 };
        c.total++;
        if (missing) { c.missing++; if (claimed) c.claimedMissing++; else c.unclaimedMissing++; }
        byConversation.set(key, c);
      }
    }
  }

  console.log('=== Image loss analysis: is being claimed for an upsell what makes an image go missing? ===');
  console.log(`Window: last ${LOOKBACK_DAYS} days`);
  console.log(`Customer images CLAIMED for an upsell   : ${tally.claimed.missing}/${tally.claimed.total} missing (${rate(tally.claimed.missing, tally.claimed.total)})`);
  console.log(`Customer images NEVER claimed           : ${tally.unclaimed.missing}/${tally.unclaimed.total} missing (${rate(tally.unclaimed.missing, tally.unclaimed.total)})`);
  console.log(`Agent images CLAIMED for an upsell      : ${tally.agentClaimed.missing}/${tally.agentClaimed.total} missing (${rate(tally.agentClaimed.missing, tally.agentClaimed.total)})`);
  console.log(`Agent images NEVER claimed              : ${tally.agentUnclaimed.missing}/${tally.agentUnclaimed.total} missing (${rate(tally.agentUnclaimed.missing, tally.agentUnclaimed.total)})`);

  console.log('--- Customer images by day sent (missing / total, and the claimed subset) ---');
  for (const day of [...byDay.keys()].sort()) {
    const d = byDay.get(day);
    console.log(`  ${day}: ${d.missing}/${d.total} missing (${rate(d.missing, d.total)}) | claimed ${d.claimedMissing}/${d.claimed}`);
  }

  const worst = [...byConversation.entries()]
    .filter(([, c]) => c.missing > 0)
    .sort((a, b) => b[1].missing - a[1].missing)
    .slice(0, TOP_CONVERSATIONS);
  console.log(`--- Chats with the most missing customer images (top ${TOP_CONVERSATIONS}) ---`);
  for (const [name, c] of worst) {
    console.log(`  ${name}: ${c.missing}/${c.total} missing | of those, ${c.claimedMissing} were claimed for an upsell and ${c.unclaimedMissing} never were`);
  }
  return { tally, byDay, byConversation };
}

module.exports = { analyseImageLoss };
