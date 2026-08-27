// Global app-level settings — Settings > "ระบบ" in the frontend. Admin-only
// both to view and to change (there's only ever one system-wide value here
// so far, no reason for a regular agent to see or need it).
const router = require('express').Router();
const auth = require('../middleware/auth');
const { getSystemSettings, setAgentConductGraceSeconds } = require('../lib/systemSettings');

function requireAdmin(req, res, next) {
  if (req.agent.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

router.get('/system', auth, requireAdmin, async (req, res) => {
  res.json(await getSystemSettings());
});

router.patch('/system', auth, requireAdmin, async (req, res) => {
  const { agentConductGraceSeconds } = req.body;
  const seconds = Number(agentConductGraceSeconds);
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > 86400) {
    return res.status(400).json({ error: 'grace window ต้องเป็นจำนวนเต็มวินาที ระหว่าง 0-86400' });
  }
  await setAgentConductGraceSeconds(seconds);
  res.json(await getSystemSettings());
});

module.exports = router;
