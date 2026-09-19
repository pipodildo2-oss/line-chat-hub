// Settings > "ระบบ" > Telegram — admin-only config for the monthly
// "คะแนนอัพเซลล์" notification (see lib/telegramReport.js for what actually
// gets sent, lib/telegramScheduler.js for when).
const router = require('express').Router();
const auth = require('../middleware/auth');
const { getTelegramSettings, setTelegramSettings, getTelegramCredentials } = require('../lib/systemSettings');
const { sendUpsellScoreReport, bangkokNowFields, previousMonth } = require('../lib/telegramReport');
const { sendTelegramMessage } = require('../services/telegram.service');

function requireAdmin(req, res, next) {
  if (req.agent.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

router.get('/', auth, requireAdmin, async (req, res) => {
  res.json(await getTelegramSettings());
});

// Each field saves independently — same convention as PATCH
// /api/settings/system. botToken is write-only and only touched when a
// non-empty value is actually sent (same "blank = leave unchanged"
// convention channels.js uses for accessToken/channelSecret, since the
// frontend never gets the real token back to pre-fill the field with).
router.patch('/', auth, requireAdmin, async (req, res) => {
  const { botToken, chatId, enabled, day, hour, minute } = req.body;
  const patch = {};

  if (botToken) patch.botToken = botToken.trim();
  if (chatId !== undefined) {
    if (typeof chatId !== 'string' || !chatId.trim()) {
      return res.status(400).json({ error: 'Chat ID ห้ามเว้นว่าง' });
    }
    patch.chatId = chatId.trim();
  }
  if (enabled !== undefined) patch.enabled = !!enabled;
  if (day !== undefined) {
    const d = Number(day);
    if (!Number.isInteger(d) || d < 1 || d > 28) return res.status(400).json({ error: 'วันที่ต้องเป็นจำนวนเต็ม ระหว่าง 1-28' });
    patch.day = d;
  }
  if (hour !== undefined) {
    const h = Number(hour);
    if (!Number.isInteger(h) || h < 0 || h > 23) return res.status(400).json({ error: 'ชั่วโมงต้องเป็นจำนวนเต็ม ระหว่าง 0-23' });
    patch.hour = h;
  }
  if (minute !== undefined) {
    const m = Number(minute);
    if (!Number.isInteger(m) || m < 0 || m > 59) return res.status(400).json({ error: 'นาทีต้องเป็นจำนวนเต็ม ระหว่าง 0-59' });
    patch.minute = m;
  }

  await setTelegramSettings(patch);
  res.json(await getTelegramSettings());
});

// POST /api/settings/telegram/test — sends a short test message using
// whatever's CURRENTLY SAVED (not the draft form value — the admin has to
// hit บันทึก first) so they can confirm the bot token/chat id actually work
// before waiting for the scheduled day to find out.
router.post('/test', auth, requireAdmin, async (req, res) => {
  try {
    const { botToken, chatId } = await getTelegramCredentials();
    if (!botToken || !chatId) {
      return res.status(400).json({ error: 'กรุณาบันทึก Bot Token และ Chat ID ก่อนทดสอบส่ง' });
    }
    await sendTelegramMessage(botToken, chatId, '✅ ทดสอบการเชื่อมต่อ Telegram จาก Alpha Chat สำเร็จ');
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/settings/telegram/send-now — manually sends the upsell-score
// report right now instead of waiting for the scheduled day/time. Defaults
// to last calendar month (what the scheduler itself would send); optional
// {year, month} in the body lets an admin re-send an older month's numbers
// (e.g. to resend after a correction) without needing to change the
// schedule to do it.
router.post('/send-now', auth, requireAdmin, async (req, res) => {
  try {
    const { year, month } = req.body || {};
    const period = (year && month) ? { year: Number(year), month: Number(month) } : previousMonth(bangkokNowFields());
    const result = await sendUpsellScoreReport(period);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
