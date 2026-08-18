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
// substring check. Word-list entries are normalized the same way at
// load time below.
function normalize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[\s.\-_*!?,()[\]{}'"๊๋์ฯๆ]+/g, '');
}

const SEVERE_WORDS = (badWords.severe || []).map(normalize).filter(Boolean);
const MINOR_WORDS = (badWords.minor || []).map(normalize).filter(Boolean);

function findMatch(normalizedText, wordList) {
  return wordList.find(w => normalizedText.includes(w)) || null;
}

/**
 * Checks a single outgoing agent message (freely typed, not a canned quick
 * reply) against the word list in badWords.json, plus a simple repeated-
 * message spam check against recent history. `history` is the last few
 * messages in the conversation (oldest first, [{sender, content}]).
 * Returns null if clean; otherwise { severity: 'minor' | 'severe', reason: string }.
 *
 * Kept synchronous-looking (still returns a Promise) so the call site in
 * messages.js — which does `.then(history => checkMessage(...)).then(...)` —
 * didn't need to change at all when this was swapped out from the old
 * AI-based version.
 */
async function checkMessage(text, history = []) {
  if (!text?.trim()) return null;
  const normalized = normalize(text);

  const severeHit = findMatch(normalized, SEVERE_WORDS);
  if (severeHit) return { severity: 'severe', reason: 'พบคำหยาบ/ไม่เหมาะสมในข้อความ' };

  const minorHit = findMatch(normalized, MINOR_WORDS);
  if (minorHit) return { severity: 'minor', reason: 'พบคำพูดไม่สุภาพ/ก้าวร้าวเล็กน้อยในข้อความ' };

  // Simple spam check: this exact message (normalized) already appears among
  // the employee's own recent messages in this conversation — no AI needed
  // to catch "sent the identical thing 2+ times in a row".
  const repeatCount = history.filter(m => m.sender === 'agent' && normalize(m.content) === normalized).length;
  if (normalized.length >= 3 && repeatCount >= 1) {
    return { severity: 'minor', reason: 'ส่งข้อความซ้ำ/สแปม' };
  }

  return null;
}

module.exports = { checkMessage };
