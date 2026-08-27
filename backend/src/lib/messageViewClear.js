const { PrismaClient } = require('@prisma/client');
const { emitToConversation } = require('../services/socket.service');
const { getAgentConductGraceSeconds } = require('./systemSettings');

const prisma = new PrismaClient();

// Called after ANY agent reply succeeds (a typed message in messages.js, or
// a quick reply in quickReplies.js) to resolve "viewed but didn't reply"
// tracking (MessageView, see schema.prisma) for the conversation it landed
// in.
//
// Purely per-viewer, no group effect: the replying agent's own MessageView
// rows always clear outright — they took action, full stop, however late.
// Every OTHER agent who also had this conversation open only clears if
// THEIR OWN deadline (their viewedAt, when they personally opened the
// still-unanswered chat, plus the configured grace window) hasn't passed
// yet at the moment this reply lands — an agent who opened it late gets a
// later personal deadline than one who opened it right away, since they
// couldn't have answered before they'd even seen it, but a teammate's
// timely reply does NOT retroactively save someone whose own window had
// already run out before it arrived. A viewer left uncleared here is left
// for the Agent Conduct report (reports.js) to flag once it runs, using
// this exact same per-viewer deadline.
async function clearMessageViewsAfterReply({ conversationId, agentId, repliedAt }) {
  const graceMs = (await getAgentConductGraceSeconds()) * 1000;
  const views = await prisma.messageView.findMany({
    where: { message: { conversationId } },
    select: { id: true, agentId: true, viewedAt: true },
  });
  if (views.length === 0) return;

  const toClear = views.filter(v => v.agentId === agentId || repliedAt - v.viewedAt <= graceMs);
  if (toClear.length === 0) return;

  await prisma.messageView.deleteMany({ where: { id: { in: toClear.map(v => v.id) } } });
  for (const id of new Set(toClear.map(v => v.agentId))) {
    emitToConversation(conversationId, 'message_view_cleared', { agentId: id });
  }

  // "อัตราการตอบเทียบกับการเปิดดู" (reports.js) — the replying agent gets ONE
  // 'self_reply' log entry per reply that resolved their own outstanding
  // view(s) for this conversation, regardless of how many separate times
  // they'd opened this same still-unanswered chat (matches the "count
  // events, not resolve-one-view-at-a-time" spirit of the 'view' log in
  // messages.js — see AgentActivityLog in schema.prisma).
  if (toClear.some(v => v.agentId === agentId)) {
    await prisma.agentActivityLog.create({ data: { agentId, conversationId, kind: 'self_reply' } });
  }
}

module.exports = { clearMessageViewsAfterReply };
