const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const SINGLETON_ID = 'singleton';
const DEFAULT_AGENT_CONDUCT_GRACE_SECONDS = 60;
const DEFAULT_RESPONSE_RATE_THRESHOLD_PERCENT = 50;

// Always the same one row (id is fixed, see schema.prisma) — falls back to
// the hardcoded defaults if that row doesn't exist yet (e.g. a fresh DB that
// hasn't had an admin save Settings > "ระบบ" at all), so callers never have
// to special-case "not configured yet".
async function getSystemSettings() {
  const row = await prisma.systemSetting.findUnique({ where: { id: SINGLETON_ID } });
  return {
    agentConductGraceSeconds: row?.agentConductGraceSeconds ?? DEFAULT_AGENT_CONDUCT_GRACE_SECONDS,
    responseRateThresholdPercent: row?.responseRateThresholdPercent ?? DEFAULT_RESPONSE_RATE_THRESHOLD_PERCENT,
  };
}

async function getAgentConductGraceSeconds() {
  const { agentConductGraceSeconds } = await getSystemSettings();
  return agentConductGraceSeconds;
}

async function setAgentConductGraceSeconds(seconds) {
  return prisma.systemSetting.upsert({
    where: { id: SINGLETON_ID },
    update: { agentConductGraceSeconds: seconds },
    create: { id: SINGLETON_ID, agentConductGraceSeconds: seconds },
  });
}

async function getResponseRateThresholdPercent() {
  const { responseRateThresholdPercent } = await getSystemSettings();
  return responseRateThresholdPercent;
}

async function setResponseRateThresholdPercent(percent) {
  return prisma.systemSetting.upsert({
    where: { id: SINGLETON_ID },
    update: { responseRateThresholdPercent: percent },
    create: { id: SINGLETON_ID, responseRateThresholdPercent: percent },
  });
}

module.exports = {
  getSystemSettings,
  getAgentConductGraceSeconds,
  setAgentConductGraceSeconds,
  getResponseRateThresholdPercent,
  setResponseRateThresholdPercent,
  DEFAULT_AGENT_CONDUCT_GRACE_SECONDS,
  DEFAULT_RESPONSE_RATE_THRESHOLD_PERCENT,
};
