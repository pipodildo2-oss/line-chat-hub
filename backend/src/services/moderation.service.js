const Wordcut = require('wordcut');
const badWords = require('../config/badWords.json');
const { getModerationMode } = require('../lib/systemSettings');
const { getAnthropicClient } = require('../lib/anthropicClient');

// AI is the primary check again (was keyword-only for a while — see below).
// The keyword list from that period is kept as a fallback for whenever the
// AI call itself isn't available (no API key configured, or the request
// errors — rate limit, timeout, or the Anthropic Console credit balance
// running out again, which is exactly what took the ORIGINAL AI version
// down and led to the keyword-only period this codebase went through).
// Losing tone/context judgment during an outage is an acceptable
// degradation; silently flagging nothing at all is not.

// Checks tone/intent via Claude — catches profanity AND things a word list
// never can, like sarcasm or condescension toward the customer with no
// individual "bad word" in the sentence at all. Returns:
//   undefined  — AI unavailable/failed; caller should fall back to keywords
//   null       — AI ran and the message reads clean
//   { severity, reason, category: 'moderation' } — AI flagged it
async function checkWithAI(text) {
  const c = await getAnthropicClient();
  if (!c) return undefined;
  try {
    const response = await c.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: `You are a content-moderation classifier for a Thai customer-service LINE chat.
Read the EMPLOYEE's outgoing message to a customer and decide if it contains profanity, insults, threats, condescension, sarcasm, or passive-aggressive/sassy remarks directed at the customer — in Thai or English, including disguised or spaced-out swearing. Judge based on tone and intent, not just individual words — a message can be inappropriate even with no profanity in it at all (e.g. a mocking or sarcastic remark).
Respond with ONLY compact JSON, nothing else, no markdown fences:
{"flagged": boolean, "severity": "minor" | "severe" | null, "reason": string | null}
Rules:
- Normal, professional, or merely blunt/curt-but-clean messages: {"flagged": false, "severity": null, "reason": null}
- "minor": mildly rude, dismissive, sarcastic, or unprofessional tone, but not profanity or a direct insult.
- "severe": profanity, direct insults, threats, or clearly abusive/mocking language directed at or about the customer.
- "reason" (when flagged) must be a short explanation in Thai, e.g. "มีคำหยาบ", "พูดจาเสียดสี/แดกดันลูกค้า", "พูดจาไม่สุภาพกับลูกค้า".`,
      messages: [{ role: 'user', content: text }],
    });
    const raw = response.content[0].text.trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return undefined; // unparseable response — treat like a failure, fall back
    const parsed = JSON.parse(match[0]);
    if (!parsed.flagged) return null;
    return {
      severity: parsed.severity === 'severe' ? 'severe' : 'minor',
      reason: parsed.reason || 'ข้อความไม่เหมาะสม (ตรวจโดย AI)',
      category: 'moderation',
    };
  } catch (e) {
    console.warn('AI moderation check failed, falling back to keyword list:', e.message);
    return undefined;
  }
}

// Keyword-list fallback — kept from the keyword-only period of this file so
// moderation degrades gracefully (rather than silently doing nothing) when
// the AI check above is unavailable. Zero external calls, zero cost, works
// offline. Trade-off: it can only catch words that are actually in
// badWords.json (edit that file to tune it) and can't judge tone/context
// the way the AI check can.

// Strips whitespace/punctuation and lowercases so spaced-out or
// punctuated evasion ("เ ห ี ้ ย", "f.u.c.k") still matches a plain
// substring check, and collapses any run of 3+ of the same character down
// to 1 so chat-style elongation for emphasis ("เหี้ยยยย", "มึงงงง",
// "fuuuuck") still matches too — without the collapse, Wordcut has no
// dictionary entry for the elongated blob, so it comes back as one long
// unrecognized token and the boundary check below (correctly) refuses to
// treat a badword sitting in the MIDDLE of that token as a hit, silently
// missing it. Standard Thai spelling essentially never triples the same
// character in a real word (only 7 words in Wordcut's ~24k-word dictionary
// do, e.g. "งงงวย" confused/dazed — collapsing those to "งงวย" is a
// harmless, borderline-imperceptible loss since none of them contain a
// badword substring anyway), so this is a safe, high-value trade. Word-list
// entries are normalized the same way at load time below (moot for them in
// practice — none contain a repeated-3+ run — but keeps the pipeline
// consistent).
function normalize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[\s.\-_*!?,()[\]{}'"๊๋์ฯๆ]+/g, '')
    .replace(/(.)\1{2,}/gu, '$1');
}

const THAI_RE = /[฀-๿]/;

// Thai script has no spaces between words, so a plain substring check (the
// old approach) can't tell "บ้า" (crazy/rude) the word apart from "บ้า" the
// first two characters of "บ้าง" (some/somewhat) or "บ้าน" (house) — see
// the false-positive audit in backend/scripts/test-moderation.js for the
// full list this used to catch wrongly. Wordcut (a dictionary-based Thai
// segmenter, offline/no API — same zero-cost constraint as the rest of this
// file) breaks the message into real words; a badword only counts as a hit
// if its span in the text starts AND ends exactly on a token boundary, i.e.
// it isn't sitting in the middle of some longer legitimate word. This
// generalizes cleanly to the multi-syllable entries in the list too (e.g.
// "ไอ้สัส") — a match spanning several consecutive tokens is still boundary-
// aligned at both ends, even if Wordcut's own dictionary doesn't know that
// specific slang phrase as a single word.
//
// English entries skip all of this and keep the old plain substring check:
// English already delimits words with spaces (which normalize() strips
// specifically to defeat spaced-out evasion like "f u c k"), and none of
// the English entries here are short/common enough to plausibly nest inside
// an innocent English word in this app's Thai-primary chat context.
Wordcut.init();

function buildEntry(raw) {
  const normalized = normalize(raw);
  return { raw, normalized, isThai: THAI_RE.test(normalized) };
}

const SEVERE_WORDS = (badWords.severe || []).map(buildEntry).filter(w => w.normalized);
const MINOR_WORDS = (badWords.minor || []).map(buildEntry).filter(w => w.normalized);

// The set of character offsets in `normalizedText` where a Wordcut token
// starts (0 and the full length count as boundaries too, so a match spanning
// the whole string or ending exactly at the end still qualifies).
function tokenBoundaries(normalizedText) {
  const boundaries = new Set([0]);
  let pos = 0;
  for (const token of Wordcut.cut(normalizedText).split('|')) {
    pos += token.length;
    boundaries.add(pos);
  }
  return boundaries;
}

function findAllIndices(haystack, needle) {
  const indices = [];
  let from = 0;
  for (let idx; (idx = haystack.indexOf(needle, from)) !== -1; from = idx + 1) {
    indices.push(idx);
  }
  return indices;
}

function matchesEntry(normalizedText, boundaries, entry) {
  if (!entry.isThai) return normalizedText.includes(entry.normalized);
  return findAllIndices(normalizedText, entry.normalized)
    .some(i => boundaries.has(i) && boundaries.has(i + entry.normalized.length));
}

function findMatch(normalizedText, boundaries, wordList) {
  const hit = wordList.find(w => matchesEntry(normalizedText, boundaries, w));
  return hit ? hit.raw : null;
}

// The keyword-only check this file used to run unconditionally — now only
// reached when checkWithAI() above returns undefined (AI unavailable/failed).
function checkWithKeywords(text) {
  const normalized = normalize(text);
  const boundaries = tokenBoundaries(normalized);

  const severeHit = findMatch(normalized, boundaries, SEVERE_WORDS);
  if (severeHit) return { severity: 'severe', reason: 'พบคำหยาบ/ไม่เหมาะสมในข้อความ', category: 'moderation' };

  const minorHit = findMatch(normalized, boundaries, MINOR_WORDS);
  if (minorHit) return { severity: 'minor', reason: 'พบคำพูดไม่สุภาพ/ก้าวร้าวเล็กน้อยในข้อความ', category: 'moderation' };

  return null;
}

/**
 * Checks a single outgoing agent message (freely typed, not a canned quick
 * reply) for profanity/inappropriate tone via AI (falling back to the
 * badWords.json keyword list if the AI check is unavailable), plus a simple
 * repeated-message spam check against recent history. `history` is the last
 * few messages in the conversation (oldest first, [{sender, content}]).
 * Returns null if clean; otherwise
 * { severity: 'minor' | 'severe', reason: string, category: 'moderation' | 'spam' }
 * — category maps directly onto Message.flagCategory (see reports.js), so
 * callers can pass it straight through without re-deriving which check hit.
 */
async function checkMessage(text, history = []) {
  if (!text?.trim()) return null;

  // Settings > "ระบบ" picks which check runs first. "keyword" skips the AI
  // call entirely (an admin's deliberate cost/offline-safety choice); "ai"
  // (default) tries AI first and only drops to keywords if that call itself
  // fails — an automatic outage fallback, not the mode the admin picked.
  const mode = await getModerationMode();
  if (mode === 'keyword') {
    const keywordHit = checkWithKeywords(text);
    if (keywordHit) return keywordHit;
  } else {
    const aiResult = await checkWithAI(text);
    if (aiResult !== undefined) {
      if (aiResult) return aiResult;
    } else {
      const keywordHit = checkWithKeywords(text);
      if (keywordHit) return keywordHit;
    }
  }

  // Spam check: the SAME message sent back-to-back 3+ times in a row.
  // "history" is oldest-first, so walk backward from the most recent entry
  // and count matches — stop at the first message that breaks the streak
  // (wrong sender or different content). This deliberately does NOT count
  // the same message reused at different, non-consecutive points in the
  // conversation (e.g. the same canned "please wait" line sent hours apart)
  // as spam — only an actual uninterrupted burst of repeats counts.
  const normalized = normalize(text);
  let consecutiveRepeats = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.sender === 'agent' && normalize(m.content) === normalized) consecutiveRepeats++;
    else break;
  }
  if (normalized.length >= 3 && consecutiveRepeats + 1 >= 3) {
    return { severity: 'minor', reason: 'ส่งข้อความเดิมซ้ำติดกันตั้งแต่ 3 ครั้งขึ้นไป (สแปม)', category: 'spam' };
  }

  return null;
}

module.exports = { checkMessage };
