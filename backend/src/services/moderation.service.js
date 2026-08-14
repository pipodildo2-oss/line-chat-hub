const Anthropic = require('@anthropic-ai/sdk');

let client = null;

function getClient() {
  if (!client && process.env.ANTHROPIC_API_KEY) {
    client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

let warnedNoKey = false;

/**
 * Checks a single outgoing agent message (freely typed, not a canned quick
 * reply) for profanity, arguing with the customer, or spam — Thai or English,
 * including disguised/spaced-out swearing. `history` is the last few messages
 * in the conversation (oldest first, [{sender, content}]) so the model has
 * enough context to judge tone (arguing) and repetition (spam), not just the
 * single message in isolation.
 * Returns null if the service is unavailable or the message reads clean;
 * otherwise { severity: 'minor' | 'severe', reason: string }.
 *
 * Deliberately called fire-and-forget AFTER the send response goes back to
 * the agent — this is a background compliance check for the admin Report
 * page, not something that should add latency to sending a message.
 */
async function checkMessage(text, history = []) {
  const c = getClient();
  if (!c) {
    if (!process.env.ANTHROPIC_API_KEY && !warnedNoKey) {
      warnedNoKey = true;
      console.warn('Moderation check disabled: ANTHROPIC_API_KEY is not set.');
    }
    return null;
  }
  if (!text?.trim()) return null;

  const historyBlock = history.length
    ? `Recent conversation, oldest to newest (context only — do not classify these, only the message below):\n${history.map(m => `${m.sender === 'user' ? 'Customer' : 'Employee'}: ${m.content}`).join('\n')}\n\n`
    : '';

  try {
    const response = await c.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: `You are a content-moderation classifier for a Thai customer-service LINE chat.
Read the EMPLOYEE's latest outgoing message to a customer (with recent conversation history for context) and decide if it should be flagged for any of:
1. Profanity, insults, threats, or abusive language — Thai or English, including disguised/spaced-out swearing.
2. Arguing with, being confrontational, dismissive, or disrespectful toward the customer instead of helping them.
3. Spam — sending the same or near-identical message repeatedly (compare against the employee's recent messages in the history), or sending irrelevant/nonsensical text unrelated to the conversation.
Respond with ONLY compact JSON, nothing else, no markdown fences:
{"flagged": boolean, "severity": "minor" | "severe" | null, "reason": string | null}
Rules:
- Normal, professional, or merely blunt/curt-but-clean messages: {"flagged": false, "severity": null, "reason": null}
- "minor": mildly rude/dismissive tone, a single instance of pushing back on a customer, or a one-off repeated/odd message — not outright profanity or repeated abuse.
- "severe": profanity, insults, threats, clearly abusive language, sustained arguing, or clear repeated spam.
- "reason" (when flagged) must be a short Thai explanation, e.g. "มีคำหยาบ", "เถียงกับลูกค้า", or "ส่งข้อความซ้ำ/สแปม".`,
      messages: [{ role: 'user', content: `${historyBlock}Employee's latest message to classify:\n${text}` }],
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
