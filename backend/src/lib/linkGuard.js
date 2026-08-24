// Detects a link in an outgoing agent message that isn't on the admin's
// approved-domain list (see ApprovedLink in schema.prisma / the "ลิงค์ที่
// อนุญาต" Settings tab) — used to catch an agent quietly steering a customer
// toward an unauthorized site. No AI/API call, same "pure deterministic
// checker" spirit as moderation.service.js's keyword-list approach.
//
// Only matches Latin-script domain-like tokens (letters/digits/hyphens,
// dot-separated, ending in a 2+ letter TLD) — Thai script never matches this
// pattern at all, so ordinary Thai chat text has effectively zero false-
// positive risk. Deliberately does NOT require an http(s):// or www. prefix,
// since a bare "mysite123.com" is exactly the casual, unprefixed form an
// agent would actually paste — and LINE auto-linkifies it client-side too.
const LINK_REGEX = /\b(?:https?:\/\/)?(?:www\.)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s]*)?\b/gi;

function extractHost(rawMatch) {
  return rawMatch
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split(/[/?#]/)[0]
    .toLowerCase();
}

// Public suffixes that are two labels long ("co.th") rather than one
// ("com") — needed so registrableName (below) strips the WHOLE suffix, not
// just the last label, for these. A short, hand-picked list scoped to what's
// realistic in this app's Thai-business context rather than a full
// public-suffix-list dependency.
const TWO_LABEL_SUFFIXES = new Set([
  'co.th', 'or.th', 'ac.th', 'in.th', 'go.th', 'mi.th', 'net.th',
  'co.uk', 'co.jp', 'co.kr', 'co.nz', 'co.id', 'com.au', 'com.sg',
]);

// The name a domain is actually "sold under" — e.g. "sure87" for
// "sure87.com", "sure87.co.th", and "m.sure87.com" alike (a subdomain
// prefix or a different TLD/suffix don't change whose name it is). Used
// below to treat all of those as the same registered name, per an explicit
// admin request: a business that owns sure87.com but not every other
// TLD/subdomain of the same name doesn't want each variant separately
// whitelisted.
//
// Deliberately NOT just labels[0] — that would also match
// "sure87.fakesite.com" (where "sure87" is merely a subdomain of the
// unrelated domain "fakesite.com"), which is exactly the spoofing case this
// needs to keep rejecting. Taking the label immediately before the public
// suffix instead of the first label avoids that: for "m.sure87.com" that's
// "sure87" (correct), for "sure87.fakesite.com" that's "fakesite" (correctly
// NOT a match).
function registrableName(domain) {
  const labels = domain.split('.');
  if (labels.length < 2) return labels[0];
  const suffixLabelCount = TWO_LABEL_SUFFIXES.has(labels.slice(-2).join('.')) ? 2 : 1;
  const idx = labels.length - suffixLabelCount - 1;
  return idx >= 0 ? labels[idx] : labels[0];
}

// approvedDomains already lowercased, no protocol/www (see approvedLinks.js,
// which normalizes on save). A host matches an approved domain if they share
// the same registrable name — this alone covers exact matches, subdomains
// ("m.sure87.com"), different TLDs ("sure87.co.th"), and both combined
// ("m.sure87.co.th") for an approved "sure87.com".
function isApprovedHost(host, approvedDomains) {
  return approvedDomains.some(d => registrableName(host) === registrableName(d));
}

// Returns the first unauthorized link found in `text`, or null if every
// link in it (including "none at all") is fine.
function findUnauthorizedLink(text, approvedDomains) {
  if (!text) return null;
  const matches = text.match(LINK_REGEX);
  if (!matches) return null;
  for (const raw of matches) {
    const host = extractHost(raw);
    // A bare token like "3.5" or "v.1" can match the regex's shape but isn't
    // a real domain — require at least one alphabetic character in the TLD
    // segment is already enforced by the regex ([a-z]{2,}), so this is just
    // a defensive re-check against an empty/degenerate host.
    if (!host) continue;
    if (!isApprovedHost(host, approvedDomains)) return raw;
  }
  return null;
}

// Re-checks every currently-flagged "unauthorized link" message against the
// CURRENT approved-domain list and matching rules, and clears the flag on
// any that are no longer actually violations (e.g. a domain that got added
// to the whitelist afterward, or a matching-rule change like the
// registrable-name broadening above). The ตรวจสอบ report is meant to show
// what's actually wrong right now, not keep stale false-positives around as
// history — so this doesn't just hide them client-side, it clears the flag
// in the DB. Only ever clears, never re-flags (removing an approved domain
// doesn't retroactively make a message sent while it WAS approved into a
// violation) — see callers (seed.js on every startup, approvedLinks.js when
// a domain is added) for when this runs. Returns the cleared message ids.
async function reconcileFlaggedLinks(prisma) {
  const approvedLinks = await prisma.approvedLink.findMany({ select: { domain: true } });
  const domains = approvedLinks.map(l => l.domain);
  const flagged = await prisma.message.findMany({
    where: { flagged: true, flagCategory: 'link' },
    select: { id: true, content: true },
  });
  const clearIds = flagged.filter(m => !findUnauthorizedLink(m.content, domains)).map(m => m.id);
  if (clearIds.length > 0) {
    await prisma.message.updateMany({
      where: { id: { in: clearIds } },
      data: { flagged: false, flagSeverity: null, flagReason: null, flagCategory: null },
    });
  }
  return clearIds;
}

module.exports = { findUnauthorizedLink, reconcileFlaggedLinks };
