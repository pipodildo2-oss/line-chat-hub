const Anthropic = require('@anthropic-ai/sdk');

let client = null;

function getClient() {
  if (!client && process.env.ANTHROPIC_API_KEY) {
    client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

/**
 * Checks a single outgoing agent message (freely typed, not a canned quick
 * reply) for profanity or language inappropriate for an employee to send a
 * customer — Thai or English, including disguised/spaced-out swearing.
 * Returns null if the service is unavailable or the message reads clean;
 * otherwise { severity: 'minor' | 'severe', reason: string }.
 *
 * Deliberately called fire-and-forget AFTER the send response goes back to
 * the agent — this is a background compliance check for the admin Report
 * page, not something that should add latency to sending a message.
 */
async function checkMessage(text) {
  const c = getClient();
  if (!c || !text?.trim()) return null;

  try {
    const response = await c.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: `You are a content-moderation classifier for a Thai customer-service LINE chat.
Read the EMPLOYEE's outgoing message to a customer and decide if it contains profanity, insults, threats, or language inappropriate for a customer-facing employee to send — in Thai or English, including disguised or spaced-out swearing.
Respond with ONLY compact JSON, nothing else, no markdown fences:
{"flagged": boolean, "severity": "minor" | "severe" | null, "reason": string | null}
Rules:
- Normal, professional, or merely blunt/curt-but-clean messages: {"flagged": false, "severity": null, "reason": null}
- "minor": mildly rude, dismissive, or unprofessional tone, but not profanity or a direct insult.
- "severe": profanity, insults, threats, or clearly abusive language directed at or in front of the customer.
- "reason" (when flagged) must be a short explanation in Thai, e.g. "มีคำหยาบ" or "พูดจาไม่สุภาพกับลูกค้า".`,
      messages: [{ role: 'user', content: text }],
    });
    const raw = response.content[0].text.trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (!parsed.flagged) return null;
    return {
      severity: parsed.severity === 'severe' ? 'severe' : 'minor',
      reason: parsed.reason || null,
    };
  } catch (e) {
    console.warn('Moderation check failed:', e.message);
    return null;
  }
}

module.exports = { checkMessage };
