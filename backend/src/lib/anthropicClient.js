const Anthropic = require('@anthropic-ai/sdk');
const { getAnthropicApiKeyRaw } = require('./systemSettings');

// Shared client for every Anthropic-backed feature (AI moderation, reply
// suggestions). Prefers the key an admin saved in Settings > "ระบบ" (DB) so
// it can be set/rotated without a Railway redeploy; falls back to the
// ANTHROPIC_API_KEY env var so deployments that only set that still work
// untouched. Re-creates the client only when the resolved key actually
// changes, so callers can await this on every request cheaply.
let cachedKey = null;
let cachedClient = null;

async function getAnthropicClient() {
  const key = (await getAnthropicApiKeyRaw()) || process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  if (key !== cachedKey) {
    cachedClient = new Anthropic.default({ apiKey: key });
    cachedKey = key;
  }
  return cachedClient;
}

module.exports = { getAnthropicClient };
