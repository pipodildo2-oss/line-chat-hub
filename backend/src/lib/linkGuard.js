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

// The label before the domain's first dot — e.g. "money87" for both
// "money87.com" and "money87.co.th". Used below to treat different
// TLD/suffix variants of the same registered name as equivalent, per an
// explicit admin request: a business that owns money87.com but not every
// other TLD of the same name (money87.co.th, .net, ...) doesn't want each
// variant separately whitelisted.
function firstLabel(domain) {
  return domain.split('.')[0];
}

// approvedDomains already lowercased, no protocol/www (see approvedLinks.js,
// which normalizes on save). A host matches an approved domain if any of:
//  - exactly equal, or
//  - a subdomain of it ("promo.mysite.com" when "mysite.com" is approved —
//    "notmysite.com", no dot boundary, still isn't), or
//  - same first label regardless of what follows the first dot
//    ("money87.co.th" when "money87.com" is approved).
function isApprovedHost(host, approvedDomains) {
  return approvedDomains.some(d => host === d || host.endsWith(`.${d}`) || firstLabel(host) === firstLabel(d));
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

module.exports = { findUnauthorizedLink };
