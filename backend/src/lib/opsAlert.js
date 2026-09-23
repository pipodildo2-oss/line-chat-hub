// Sends operational alerts to the same Telegram chat the monthly upsell report
// already goes to.
//
// Everything this app warns about — the uploads volume running out, images
// failing to reach the archive, a customer's video too large to store — is
// written to the deploy log, which nobody reads and which Railway rotates away.
// A warning nobody sees is not a warning: the disk filling up silently is
// exactly the failure mode that cost ~47,000 images, and the whole point of
// detecting it early is that someone acts before it happens.
//
// Deliberately reuses the existing Telegram credentials and chat rather than
// adding another channel to configure. If Telegram isn't set up, this does
// nothing at all and the log line still stands on its own.
const { getTelegramCredentials } = require('./systemSettings');
const { sendTelegramMessage } = require('../services/telegram.service');

// How long the same alert stays quiet after being sent once. These checks run
// every six hours and a condition like "the volume is nearly full" stays true
// for days — without this, the one alert that matters would arrive four times a
// day until it was actively ignored, which is how people learn to ignore
// alerts.
const REPEAT_AFTER_MS = Number(process.env.ALERT_REPEAT_HOURS || 24) * 60 * 60 * 1000;
const lastSentAt = new Map();

// In-memory on purpose: a restart resending one alert is harmless, and the
// alternative is a database table and a migration for what is only a
// rate limiter. The process runs for days at a time, which is the timescale
// that matters here.
function shouldSend(key) {
  const previous = lastSentAt.get(key);
  if (previous && Date.now() - previous < REPEAT_AFTER_MS) return false;
  lastSentAt.set(key, Date.now());
  return true;
}

// `key` identifies the CONDITION, not the message — "storage-critical" rather
// than the text with today's numbers in it — so a slowly worsening situation
// doesn't defeat the rate limit by looking like a new alert each time.
async function sendOpsAlert(key, title, body) {
  try {
    if (!shouldSend(key)) return false;
    const { botToken, chatId } = await getTelegramCredentials();
    if (!botToken || !chatId) return false;
    await sendTelegramMessage(botToken, chatId, `⚠️ <b>${title}</b>\n\n${body}`);
    return true;
  } catch (err) {
    // An alert that fails to send must never take down the job that raised it.
    // The condition it describes is already in the log either way.
    console.error(`Could not send ops alert "${key}":`, err.message);
    return false;
  }
}

module.exports = { sendOpsAlert };
