const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const SINGLETON_ID = 'singleton';
const DEFAULT_AGENT_CONDUCT_GRACE_SECONDS = 60;
const DEFAULT_RESPONSE_RATE_THRESHOLD_PERCENT = 50;
const DEFAULT_AFK_MINUTES = 0; // 0 = feature off
const DEFAULT_TWO_FACTOR_REQUIRED_SCOPE = 'off';
const TWO_FACTOR_REQUIRED_SCOPES = ['off', 'all', 'admin', 'agent'];
const DEFAULT_TELEGRAM_REPORT_DAY = 1;
const DEFAULT_TELEGRAM_REPORT_HOUR = 9;
const DEFAULT_TELEGRAM_REPORT_MINUTE = 0;

// Always the same one row (id is fixed, see schema.prisma) — falls back to
// the hardcoded defaults if that row doesn't exist yet (e.g. a fresh DB that
// hasn't had an admin save Settings > "ระบบ" at all), so callers never have
// to special-case "not configured yet".
async function getSystemSettings() {
  const row = await prisma.systemSetting.findUnique({ where: { id: SINGLETON_ID } });
  return {
    agentConductGraceSeconds: row?.agentConductGraceSeconds ?? DEFAULT_AGENT_CONDUCT_GRACE_SECONDS,
    responseRateThresholdPercent: row?.responseRateThresholdPercent ?? DEFAULT_RESPONSE_RATE_THRESHOLD_PERCENT,
    afkMinutes: row?.afkMinutes ?? DEFAULT_AFK_MINUTES,
    twoFactorRequiredScope: row?.twoFactorRequiredScope ?? DEFAULT_TWO_FACTOR_REQUIRED_SCOPE,
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

async function getAfkMinutes() {
  const { afkMinutes } = await getSystemSettings();
  return afkMinutes;
}

async function setAfkMinutes(minutes) {
  return prisma.systemSetting.upsert({
    where: { id: SINGLETON_ID },
    update: { afkMinutes: minutes },
    create: { id: SINGLETON_ID, afkMinutes: minutes },
  });
}

async function getTwoFactorRequiredScope() {
  const { twoFactorRequiredScope } = await getSystemSettings();
  return twoFactorRequiredScope;
}

function setTwoFactorRequiredScope(scope) {
  if (!TWO_FACTOR_REQUIRED_SCOPES.includes(scope)) {
    throw new Error(`twoFactorRequiredScope ต้องเป็นหนึ่งใน ${TWO_FACTOR_REQUIRED_SCOPES.join(', ')}`);
  }
  return prisma.systemSetting.upsert({
    where: { id: SINGLETON_ID },
    update: { twoFactorRequiredScope: scope },
    create: { id: SINGLETON_ID, twoFactorRequiredScope: scope },
  });
}

// Whether `role` currently falls inside the required scope — the one place
// this decision is made, shared by routes/auth.js's login check and
// anywhere else that ever needs the same answer.
function roleIsInTwoFactorScope(role, scope) {
  return scope === 'all' || scope === role;
}

// Safe-to-return-to-the-frontend view of the Telegram config — everything
// except the bot token itself (exposed only as a boolean so the Settings UI
// can show "ตั้งค่าไว้แล้ว" without ever re-sending the real token back to
// the browser, same write-only pattern as LineChannel.accessToken).
async function getTelegramSettings() {
  const row = await prisma.systemSetting.findUnique({ where: { id: SINGLETON_ID } });
  return {
    enabled: row?.telegramReportEnabled ?? false,
    chatId: row?.telegramChatId ?? null,
    hasToken: !!row?.telegramBotToken,
    day: row?.telegramReportDay ?? DEFAULT_TELEGRAM_REPORT_DAY,
    hour: row?.telegramReportHour ?? DEFAULT_TELEGRAM_REPORT_HOUR,
    minute: row?.telegramReportMinute ?? DEFAULT_TELEGRAM_REPORT_MINUTE,
    lastSentPeriod: row?.telegramLastSentPeriod ?? null,
  };
}

// Internal only (the scheduler + test-send route) — the one place the raw
// bot token is ever read back out of the DB. Never expose this to a route
// response.
async function getTelegramCredentials() {
  const row = await prisma.systemSetting.findUnique({ where: { id: SINGLETON_ID } });
  return { botToken: row?.telegramBotToken ?? null, chatId: row?.telegramChatId ?? null };
}

// Partial update — only the fields actually present in `patch` are touched,
// same "each field saves independently" convention as
// setAgentConductGraceSeconds/setResponseRateThresholdPercent above (so the
// Settings form can save the token separately from the schedule, etc.).
async function setTelegramSettings(patch) {
  const data = {};
  if (patch.botToken !== undefined) data.telegramBotToken = patch.botToken;
  if (patch.chatId !== undefined) data.telegramChatId = patch.chatId;
  if (patch.enabled !== undefined) data.telegramReportEnabled = patch.enabled;
  if (patch.day !== undefined) data.telegramReportDay = patch.day;
  if (patch.hour !== undefined) data.telegramReportHour = patch.hour;
  if (patch.minute !== undefined) data.telegramReportMinute = patch.minute;
  return prisma.systemSetting.upsert({
    where: { id: SINGLETON_ID },
    update: data,
    create: { id: SINGLETON_ID, ...data },
  });
}

async function setTelegramLastSentPeriod(period) {
  return prisma.systemSetting.upsert({
    where: { id: SINGLETON_ID },
    update: { telegramLastSentPeriod: period },
    create: { id: SINGLETON_ID, telegramLastSentPeriod: period },
  });
}

module.exports = {
  getSystemSettings,
  getAgentConductGraceSeconds,
  setAgentConductGraceSeconds,
  getResponseRateThresholdPercent,
  setResponseRateThresholdPercent,
  getAfkMinutes,
  setAfkMinutes,
  getTwoFactorRequiredScope,
  setTwoFactorRequiredScope,
  roleIsInTwoFactorScope,
  getTelegramSettings,
  getTelegramCredentials,
  setTelegramSettings,
  setTelegramLastSentPeriod,
  DEFAULT_AGENT_CONDUCT_GRACE_SECONDS,
  DEFAULT_RESPONSE_RATE_THRESHOLD_PERCENT,
  DEFAULT_AFK_MINUTES,
  DEFAULT_TWO_FACTOR_REQUIRED_SCOPE,
  TWO_FACTOR_REQUIRED_SCOPES,
};
