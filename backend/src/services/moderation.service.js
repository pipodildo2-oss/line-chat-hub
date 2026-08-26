const Wordcut = require('wordcut');
const badWords = require('../config/badWords.json');

// No AI/API involved here on purpose — the previous version called the
// Claude API per message, which stopped working once the Anthropic Console
// credit balance ran out. This is a pure keyword-list checker instead: zero
// external calls, zero cost, works offline. Trade-off: it can only catch
// words that are actually in badWords.json (edit that file to tune it) and
// can't judge tone/context the way an AI could (e.g. "arguing with the
// customer" without any bad word in it won't be caught) — see the spam
// check below for the one piece of context-awareness kept from the old
// version.

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

/**
 * Checks a single outgoing agent message (freely typed, not a canned quick
 * reply) against the word list in badWords.json, plus a simple repeated-
 * message spam check against recent history. `history` is the last few
 * messages in the conversation (oldest first, [{sender, content}]).
 * Returns null if clean; otherwise
 * { severity: 'minor' | 'severe', reason: string, category: 'moderation' | 'spam' }
 * — category maps directly onto Message.flagCategory (see reports.js), so
 * callers can pass it straight through without re-deriving which check hit.
 *
 * Kept synchronous-looking (still returns a Promise) so the call site in
 * messages.js — which does `.then(history => checkMessage(...)).then(...)` —
 * didn't need to change at all when this was swapped out from the old
 * AI-based version.
 */
async function checkMessage(text, history = []) {
  if (!text?.trim()) return null;
  const normalized = normalize(text);
  const boundaries = tokenBoundaries(normalized);

  const severeHit = findMatch(normalized, boundaries, SEVERE_WORDS);
  if (severeHit) return { severity: 'severe', reason: 'พบคำหยาบ/ไม่เหมาะสมในข้อความ', category: 'moderation' };

  const minorHit = findMatch(normalized, boundaries, MINOR_WORDS);
  if (minorHit) return { severity: 'minor', reason: 'พบคำพูดไม่สุภาพ/ก้าวร้าวเล็กน้อยในข้อความ', category: 'moderation' };

  // Spam check: the SAME message sent back-to-back 3+ times in a row.
  // "history" is oldest-first, so walk backward from the most recent entry
  // and count matches — stop at the first message that breaks the streak
  // (wrong sender or different content). This deliberately does NOT count
  // the same message reused at different, non-consecutive points in the
  // conversation (e.g. the same canned "please wait" line sent hours apart)
  // as spam — only an actual uninterrupted burst of repeats counts.
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
