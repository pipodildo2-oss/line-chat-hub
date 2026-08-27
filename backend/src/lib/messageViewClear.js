const { PrismaClient } = require('@prisma/client');
const { emitToConversation } = require('../services/socket.service');
const { getAgentConductGraceSeconds } = require('./systemSettings');

const prisma = new PrismaClient();

// Called after ANY agent reply succeeds (a typed message in messages.js, or
// a quick reply in quickReplies.js) to resolve "viewed but didn't reply"
// tracking (MessageView, see schema.prisma) for the conversation it landed
// in.
//
// The replying agent's own MessageView rows are always cleared outright —
// they took action, full stop. Whether anyone ELSE who also viewed this
// conversation (and didn't happen to be the one who replied) gets cleared
// too depends on timing, and the clock is PER VIEWER, not shared: each
// agent's own deadline is THEIR viewedAt (when they personally opened the
// still-unanswered chat) plus the configured grace window — an agent who
// opened it late gets a later personal deadline than one who opened it
// right away, since they couldn't have answered before they even saw it.
// If this reply landed before ANY currently-open viewer's own deadline —
// even one agent still being within their own window is enough — the
// customer was genuinely served in time by the TEAM as a whole, so EVERY
// viewer is cleared, including ones whose own deadline had already passed:
// multiple agents having the same chat open when only one needs to answer
// is normal, not misconduct. Only if EVERY viewer's own deadline has
// already passed by the time this reply lands does it fall back to
// clearing just the replier; everyone else's rows are left for the Agent
// Conduct report (reports.js) to correctly flag once it runs, since by
// then even the most recently arrived viewer waited too long.
async function clearMessageViewsAfterReply({ conversationId, agentId, repliedAt }) {
  const graceMs = (await getAgentConductGraceSeconds()) * 1000;
  const views = await prisma.messageView.findMany({
    where: { message: { conversationId } },
    select: { agentId: true, viewedAt: true },
  });
  if (views.length === 0) return;

  const repliedInTime = views.some(v => repliedAt - v.viewedAt <= graceMs);
  if (repliedInTime) {
    const distinctAgentIds = [...new Set(views.map(v => v.agentId))];
    await prisma.messageView.deleteMany({ where: { message: { conversationId } } });
    for (const id of distinctAgentIds) emitToConversation(conversationId, 'message_view_cleared', { agentId: id });
  } else {
    const cleared = await prisma.messageView.deleteMany({ where: { agentId, message: { conversationId } } });
    if (cleared.count > 0) emitToConversation(conversationId, 'message_view_cleared', { agentId });
  }
}

module.exports = { clearMessageViewsAfterReply };
