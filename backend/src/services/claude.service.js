const Anthropic = require('@anthropic-ai/sdk');

let client = null;

function getClient() {
  if (!client && process.env.ANTHROPIC_API_KEY) {
    client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

/**
 * Suggest a reply based on conversation history
 * @param {Array} messages - recent messages [{sender, content}]
 * @param {string} channelName - name of the LINE OA
 * @returns {Promise<string>}
 */
async function suggestReply(messages, channelName) {
  const c = getClient();
  if (!c) return null;

  const history = messages
    .slice(-10)
    .map((m) => `${m.sender === 'user' ? 'Customer' : 'Agent'}: ${m.content}`)
    .join('\n');

  const response = await c.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    system: `You are a customer service assistant for "${channelName}".
Suggest a short, helpful, and friendly reply in the same language as the customer.
Reply with only the suggested message text, nothing else.`,
    messages: [
      {
        role: 'user',
        content: `Conversation history:\n${history}\n\nSuggest a reply for the agent to send:`,
      },
    ],
  });

  return response.content[0].text.trim();
}

module.exports = { suggestReply };
