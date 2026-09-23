// Global app-level settings — Settings > "ระบบ" in the frontend. Admin-only
// both to view and to change (there's only ever one system-wide value here
// so far, no reason for a regular agent to see or need it) — EXCEPT
// afk-minutes below, which every agent's own browser needs to know its own
// idle timeout, so that one route is deliberately not admin-gated.
const router = require('express').Router();
const auth = require('../middleware/auth');
const { getSystemSettings, setAgentConductGraceSeconds, setResponseRateThresholdPercent, getAfkMinutes, setAfkMinutes, setTwoFactorRequired } = require('../lib/systemSettings');

function requireAdmin(req, res, next) {
  if (req.agent.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

router.get('/system', auth, requireAdmin, async (req, res) => {
  res.json(await getSystemSettings());
});

// Accepts any of the three fields independently (only what the caller's
// form actually changed) so each Settings > "ระบบ" field can be saved on
// its own without needing to resend the others' current values.
router.patch('/system', auth, requireAdmin, async (req, res) => {
  const { agentConductGraceSeconds, responseRateThresholdPercent, afkMinutes, twoFactorRequired } = req.body;

  if (agentConductGraceSeconds !== undefined) {
    const seconds = Number(agentConductGraceSeconds);
    if (!Number.isInteger(seconds) || seconds < 0 || seconds > 86400) {
      return res.status(400).json({ error: 'grace window ต้องเป็นจำนวนเต็มวินาที ระหว่าง 0-86400' });
    }
    await setAgentConductGraceSeconds(seconds);
  }

  if (responseRateThresholdPercent !== undefined) {
    const percent = Number(responseRateThresholdPercent);
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
      return res.status(400).json({ error: 'เกณฑ์อัตราตอบขั้นต่ำต้องเป็นจำนวนเต็ม ระหว่าง 0-100' });
    }
    await setResponseRateThresholdPercent(percent);
  }

  if (afkMinutes !== undefined) {
    const minutes = Number(afkMinutes);
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) {
      return res.status(400).json({ error: 'เวลา AFK ต้องเป็นจำนวนเต็มนาที ระหว่าง 0-1440 (0 = ปิดใช้งาน)' });
    }
    await setAfkMinutes(minutes);
  }

  if (twoFactorRequired !== undefined) {
    await setTwoFactorRequired(!!twoFactorRequired);
  }

  res.json(await getSystemSettings());
});

// GET /api/settings/afk-minutes — every logged-in agent's own browser needs
// this to run its own idle timer (see AfkTracker.jsx), not just admins, so
// this one deliberately skips requireAdmin. Nothing sensitive in the value
// itself (just a number of minutes), unlike everything else in this file.
router.get('/afk-minutes', auth, async (req, res) => {
  res.json({ afkMinutes: await getAfkMinutes() });
});

module.exports = router;
