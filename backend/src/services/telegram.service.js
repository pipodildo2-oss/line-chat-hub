// Thin wrapper around Telegram's Bot API — no SDK dependency needed since
// sendMessage is the only call this app makes (Node's built-in global fetch
// is available on the Node version this project runs, same as line.service.js
// relying on the LINE SDK's own fetch use).
async function sendTelegramMessage(botToken, chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    // Telegram's own `description` (e.g. "Unauthorized" for a bad token,
    // "chat not found" for a wrong chat id, "bot was kicked from the group
    // chat") is far more actionable than a bare HTTP status — surfaced as-is
    // to the admin via the ทดสอบส่ง button (see telegramReport.js).
    throw new Error(data?.description || `Telegram API error (HTTP ${res.status})`);
  }
  return data;
}

module.exports = { sendTelegramMessage };
