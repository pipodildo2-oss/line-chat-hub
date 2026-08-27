// Global app-level settings — Settings > "ระบบ" in the frontend. Admin-only
// both to view and to change (there's only ever one system-wide value here
// so far, no reason for a regular agent to see or need it).
const router = require('express').Router();
const auth = require('../middleware/auth');
const { getSystemSettings, setAgentConductGraceSeconds, setResponseRateThresholdPercent } = require('../lib/systemSettings');

function requireAdmin(req, res, next) {
  if (req.agent.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

router.get('/system', auth, requireAdmin, async (req, res) => {
  res.json(await getSystemSettings());
});

// Accepts either field independently (only what the caller's form actually
// changed) so the two Settings > "ระบบ" fields can each be saved on their
// own without needing to resend the other's current value.
router.patch('/system', auth, requireAdmin, async (req, res) => {
  const { agentConductGraceSeconds, responseRateThresholdPercent } = req.body;

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

  res.json(await getSystemSettings());
});

module.exports = router;
