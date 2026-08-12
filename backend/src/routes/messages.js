const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const auth = require('../middleware/auth');
const { emitToConversation, emitToAll } = require('../services/socket.service');
const { sendMessage, getMessageContent } = require('../services/line.service');
const { suggestReply } = require('../services/claude.service');

const prisma = new PrismaClient();

// GET /api/messages/content/:messageId — proxy image/video/audio a customer sent us.
// Placed before the /:conversationId route below since "content" would otherwise be
// swallowed as a conversationId value.
router.get('/content/:messageId', auth, async (req, res) => {
  try {
    const message = await prisma.message.findFirst({
      where: { lineMessageId: req.params.messageId },
      include: { conversation: { include: { channel: true } } },
    });
    if (!message) return res.status(404).end();
    const { stream, contentType } = await getMessageContent(message.conversation.channel, req.params.messageId);
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'private, max-age=86400');
    stream.pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/messages/:conversationId
router.get('/:conversationId', auth, async (req, res) => {
  const { cursor, limit = 50 } = req.query;
  const where = { conversationId: req.params.conversationId };
  if (cursor) where.createdAt = { lt: new Date(cursor) };

  const messages = await prisma.message.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Number(limit),
  });

  // Mark as read
  await prisma.message.updateMany({
    where: { conversationId: req.params.conversationId, sender: 'user', read: false },
    data: { read: true },
  });

  res.json(messages.reverse());
});

// POST /api/messages/:conversationId — send message
router.post('/:conversationId', auth, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'Content required' });

    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.conversationId },
      include: { channel: true },
    });
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

    // Send via LINE
    await sendMessage(conversation.channel, conversation.lineUserId, content);

    // Save to DB
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        sender: 'agent',
        senderName: req.agent.name,
        type: 'text',
        content,
        read: true,
      },
    });

    // Update conversation lastMessageAt
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    });

    emitToConversation(conversation.id, 'new_message', { message, conversation });
    emitToAll('conversation_updated', { ...conversation, lastMessage: message });

    res.status(201).json(message);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/messages/:conversationId/suggest
router.get('/:conversationId/suggest', auth, async (req, res) => {
  try {
    const messages = await prisma.message.findMany({
      where: { conversationId: req.params.conversationId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.conversationId },
      include: { channel: true },
    });
    const suggestion = await suggestReply(messages.reverse(), conversation?.channel?.name || 'Support');
    res.json({ suggestion });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
