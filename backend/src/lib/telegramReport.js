// Builds and sends the monthly "คะแนนอัพเซลล์" report to Telegram — one
// short header message with the org-wide totals, then one message PER TEAM
// (per explicit admin request: not one giant wall of text), using the exact
// same team grouping/ranking Upsell.jsx's UpsellScorePage shows on-screen
// (see groupAndRankByTeam in upsellScore.js) so the numbers in Telegram
// always match what's on the คะแนน page for the same period.
const { getAgentUpsellSummary, groupAndRankByTeam } = require('./upsellScore');
const { getTelegramCredentials, setTelegramLastSentPeriod } = require('./systemSettings');
const { sendTelegramMessage } = require('../services/telegram.service');

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];
// Gregorian year, matching how the rest of the app already formats dates
// (date-fns's `th` locale — see Upsell.jsx/Report.jsx's `format(..., {
// locale: th })` calls) — no + 543 Buddhist-era conversion anywhere in this
// codebase, so this stays consistent with that rather than introducing a
// one-off convention just for Telegram.
function periodLabel({ year, month }) { return `${THAI_MONTHS[month - 1]} ${year}`; }

function pad(n) { return String(n).padStart(2, '0'); }
function periodKey({ year, month }) { return `${year}-${pad(month)}`; }

// Bangkok wall-clock {year, month, day, hour, minute} for `date` (default
// now) — used both to decide "what is last month" and, by the scheduler, to
// know what time it is right now — deliberately NOT the server's own local
// time (UTC on Railway; see upsellScore.js's dayStart/dayEnd comment for the
// same concern elsewhere), so an admin picking "9 โมงเช้า" gets 9am Bangkok
// time regardless of where this happens to be hosted.
function bangkokNowFields(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const get = t => Number(parts.find(p => p.type === t).value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') };
}

function previousMonth({ year, month }) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

// [from, to] YYYY-MM-DD strings for the whole calendar month — passed
// straight into getAgentUpsellSummary, which parses them as Bangkok-local
// day boundaries (see upsellScore.js's dayStart/dayEnd).
function monthRangeStrings(year, month) {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate(); // day 0 of next month = last day of this one
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(lastDay)}` };
}

const MEDALS = ['🥇', '🥈', '🥉'];

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildHeaderMessage(period, { totalApproved, totalAmount, teamCount }) {
  return [
    `🏆 <b>คะแนนอัพเซลล์ประจำเดือน ${escapeHtml(periodLabel(period))}</b>`,
    '',
    `✅ รายการที่ผ่านทั้งหมด: <b>${totalApproved.toLocaleString()}</b> รายการ`,
    `💰 ยอดอัพเซลล์รวม: <b>${totalAmount.toLocaleString()} บาท</b>`,
    `👥 ทีมที่มีรายการผ่าน: ${teamCount} ทีม`,
  ].join('\n');
}

// Telegram's HTML parse_mode has no bordered-box element — this fakes a
// "frame" with a plain-character divider line + bold/emoji, which is the
// idiomatic way bot messages get this look (an actual image would be
// overkill for a text leaderboard, and Telegram strips most other markup).
function buildTeamMessage(team) {
  const lines = [`👥 <b>${escapeHtml(team.name)}</b>`, '━━━━━━━━━━━━━━━'];
  team.agents.forEach((a, i) => {
    const rankMark = MEDALS[i] || `${i + 1}.`;
    lines.push(`${rankMark} ${escapeHtml(a.name)} — ${a.approved} รายการ — ${a.approvedAmount.toLocaleString()} บาท`);
  });
  lines.push('━━━━━━━━━━━━━━━');
  lines.push(`รวมทีม: ${team.approved} รายการ · <b>${team.approvedAmount.toLocaleString()} บาท</b>`);
  return lines.join('\n');
}

// Sends the report for `period` ({year, month}, both 1-indexed) — defaults
// to last calendar month relative to right now (Bangkok time) when omitted,
// which is what both the scheduler and the admin's "ส่งตอนนี้" button want.
// Records telegramLastSentPeriod on success so the scheduler (see
// telegramScheduler.js) never re-sends the same month's numbers twice.
async function sendUpsellScoreReport(period) {
  const { botToken, chatId } = await getTelegramCredentials();
  if (!botToken || !chatId) {
    throw new Error('ยังไม่ได้ตั้งค่า Telegram bot token หรือ chat id');
  }
  const target = (period && period.year && period.month) ? period : previousMonth(bangkokNowFields());
  const { from, to } = monthRangeStrings(target.year, target.month);

  const agents = await getAgentUpsellSummary({ from, to });
  const teams = groupAndRankByTeam(agents);
  const totalApproved = teams.reduce((s, t) => s + t.approved, 0);
  const totalAmount = teams.reduce((s, t) => s + t.approvedAmount, 0);

  await sendTelegramMessage(botToken, chatId, buildHeaderMessage(target, { totalApproved, totalAmount, teamCount: teams.length }));

  if (teams.length === 0) {
    await sendTelegramMessage(botToken, chatId, 'ไม่มีรายการอัพเซลล์ที่ผ่านการตรวจสอบในเดือนนี้');
  } else {
    for (const team of teams) {
      // Small gap between messages — polite toward Telegram's per-chat rate
      // limit rather than firing every team's message at once.
      await new Promise(r => setTimeout(r, 400));
      await sendTelegramMessage(botToken, chatId, buildTeamMessage(team));
    }
  }

  await setTelegramLastSentPeriod(periodKey(target));
  return { period: periodKey(target), periodLabel: periodLabel(target), teamCount: teams.length, totalApproved, totalAmount };
}

module.exports = {
  sendUpsellScoreReport,
  bangkokNowFields,
  previousMonth,
  periodKey,
  periodLabel,
};
