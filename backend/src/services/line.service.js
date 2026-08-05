const line = require('@line/bot-sdk');
const { PrismaClient } = require('@prisma/client');
const { emitToConversation, emitToAll } = require('./socket.service');

const prisma = new PrismaClient();

function getClient(accessToken) {
  return new line.messagingApi.MessagingApiClient({ channelAccessToken: accessToken });
}

async function handleLineWebhook(channel, events) {
  for (const event of events) {
    if (event.type !== 'message') continue;

    const lineUserId = event.source.userId;
    let displayName = lineUserId;
    let pictureUrl = null;

    // Fetch user profile
    try {
      const client = getClient(channel.accessToken);
      const profile = await client.getProfile(lineUserId);
      displayName = profile.displayName;
      pictureUrl = profile.pictureUrl;
    } catch (e) {
      console.warn('Could not fetch profile:', e.message);
    }

    // Upsert conversation
    const conversation = await prisma.conversation.upsert({
      where: { lineUserId_channelId: { lineUserId, channelId: channel.id } },
      update: { displayName, pictureUrl, status: 'open', lastMessageAt: new Date() },
      create: {
        lineUserId,
        displayName,
        pictureUrl,
        channelId: channel.id,
        status: 'open',
        lastMessageAt: new Date(),
      },
      include: { channel: true, agent: true },
    });

    // Save message
    let content = '';
    let type = event.message.type;
    let metadata = null;

    if (type === 'text') {
      content = event.message.text;
    } else if (type === 'image') {
      content = '[Image]';
      metadata = { messageId: event.message.id };
    } else if (type === 'sticker') {
      content = '[Sticker]';
      metadata = { packageId: event.message.packageId, stickerId: event.message.stickerId };
    } else if (type === 'audio') {
      content = '[Audio]';
    } else if (type === 'video') {
      content = '[Video]';
    } else if (type === 'location') {
      content = `[Location] ${event.message.address || ''}`;
      metadata = { lat: event.message.latitude, lng: event.message.longitude };
    } else {
      content = `[${type}]`;
    }

    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        sender: 'user',
        senderName: displayName,
        type,
        content,
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    });

    // Emit real-time events
    emitToConversation(conversation.id, 'new_message', { message, conversation });
    emitToAll('conversation_updated', { ...conversation, lastMessage: message });
  }
}

async function sendMessage(channel, lineUserId, text) {
  const client = getClient(channel.accessToken);
  await client.pushMessage({ to: lineUserId, messages: [{ type: 'text', text }] });
}

module.exports = { handleLineWebhook, sendMessage };
