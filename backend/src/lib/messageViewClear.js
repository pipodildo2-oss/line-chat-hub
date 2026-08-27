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
// too depends on timing: if this reply landed within the configured grace
// window of whatever customer message triggered the still-open MessageView
// rows, the customer was genuinely served in time by the TEAM as a whole —
// multiple agents having the same chat open when only one needs to answer
// is normal, not misconduct — so every viewer is cleared. A reply that
// lands AFTER the grace window only clears the replier; everyone else's
// rows are left for the Agent Conduct report (reports.js) to correctly
// flag once it runs, since the customer genuinely waited too long before
// anyone stepped in.
async function clearMessageViewsAfterReply({ conversationId, agentId, repliedAt }) {
  const graceMs = (await getAgentConductGraceSeconds()) * 1000;
  const views = await prisma.messageView.findMany({
    where: { message: { conversationId } },
    select: { agentId: true, message: { select: { createdAt: true } } },
  });
  if (views.length === 0) return;

  const repliedInTime = views.some(v => repliedAt - v.message.createdAt <= graceMs);
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
