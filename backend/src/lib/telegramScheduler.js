// In-process cron-alike (setInterval, not BullMQ) for the monthly Telegram
// upsell-score report — deliberately NOT built on BullMQ's repeatable jobs
// even though this app already depends on it (queue.service.js), because
// that dependency is OPTIONAL here: index.js logs "REDIS_URL not set —
// processing events immediately" and keeps running fine without Redis. A
// BullMQ repeatable job would just silently never fire on a deploy with no
// Redis configured — a setInterval always runs.
const { getTelegramSettings } = require('./systemSettings');
const { sendUpsellScoreReport, bangkokNowFields, previousMonth, periodKey } = require('./telegramReport');

const CHECK_INTERVAL_MS = 60 * 1000;

function startTelegramReportScheduler() {
  setInterval(async () => {
    try {
      const settings = await getTelegramSettings();
      if (!settings.enabled || !settings.hasToken || !settings.chatId) return;
      const now = bangkokNowFields();
      if (now.day !== settings.day || now.hour !== settings.hour || now.minute !== settings.minute) return;

      const target = previousMonth({ year: now.year, month: now.month });
      // Already sent this exact period — guards against firing twice if this
      // same minute is checked more than once (e.g. a restart) or the admin
      // already sent it manually via "ส่งตอนนี้" earlier today.
      if (settings.lastSentPeriod === periodKey(target)) return;

      console.log(`Telegram upsell report: sending ${periodKey(target)}...`);
      const result = await sendUpsellScoreReport(target);
      console.log(`Telegram upsell report sent: ${result.period} (${result.teamCount} team(s), ${result.totalApproved} รายการ, ${result.totalAmount} บาท)`);
    } catch (err) {
      console.error('Telegram upsell report scheduler failed:', err.message);
    }
  }, CHECK_INTERVAL_MS);
}

module.exports = { startTelegramReportScheduler };
