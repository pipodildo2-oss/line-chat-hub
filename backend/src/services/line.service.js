const line = require('@line/bot-sdk');
const { PrismaClient } = require('@prisma/client');
const { emitToConversation, emitToAll } = require('./socket.service');

const prisma = new PrismaClient();

function getClient(accessToken) {
  return new line.messagingApi.MessagingApiClient({ channelAccessToken: accessToken });
}

// Processes a single LINE event (used by the queue worker, one job = one event).
async function processLineEvent(channel, event) {
    if (event.type !== 'message') return;

    // LINE's webhook delivery is "at least once" — it can redeliver the same event
    // (e.g. after a network blip). Skip if we've already recorded this exact message.
    const lineMessageId = event.message?.id || null;
    if (lineMessageId) {
      const existing = await prisma.message.findUnique({ where: { lineMessageId } });
      if (existing) {
        console.log('Duplicate LINE message skipped:', lineMessageId);
        return;
      }
    }

    const lineUserId = event.source.userId;
    let displayName = lineUserId;
    let pictureUrl = null;

    // Use the time LINE says the customer actually sent the message, not the time
    // we happen to process it. This matters when a message arrives late (e.g. via
    // LINE's webhook redelivery after downtime) — without this, a message sent an
    // hour ago could jump in front of newer ones once it's finally processed.
    const sentAt = event.timestamp ? new Date(event.timestamp) : new Date();

    // Fetch user profile
    try {
      const client = getClient(channel.accessToken);
      const profile = await client.getProfile(lineUserId);
      displayName = profile.displayName;
      pictureUrl = profile.pictureUrl;
    } catch (e) {
      console.warn('Could not fetch profile:', e.message);
    }

    // Only bump lastMessageAt if this message is actually newer than what we have —
    // a late-arriving old message (from redelivery) shouldn't make a conversation
    // jump to the top of the inbox as if it just happened.
    const existingConv = await prisma.conversation.findUnique({
      where: { lineUserId_channelId: { lineUserId, channelId: channel.id } },
      select: { lastMessageAt: true, displayNameCustomized: true },
    });
    const bumpLastMessageAt = !existingConv?.lastMessageAt || sentAt > existingConv.lastMessageAt;

    // Upsert conversation
    const conversation = await prisma.conversation.upsert({
      where: { lineUserId_channelId: { lineUserId, channelId: channel.id } },
      update: {
        // Don't clobber a name an agent set by hand — only sync LINE's profile
        // name in if nobody has customized it for this conversation yet.
        ...(existingConv?.displayNameCustomized ? {} : { displayName }),
        pictureUrl,
        status: 'open',
        ...(bumpLastMessageAt ? { lastMessageAt: sentAt } : {}),
      },
      create: {
        lineUserId,
        displayName,
        pictureUrl,
        channelId: channel.id,
        status: 'open',
        lastMessageAt: sentAt,
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

    let message;
    try {
      message = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          sender: 'user',
          senderName: displayName,
          type,
          content,
          metadata: metadata ? JSON.stringify(metadata) : null,
          lineMessageId,
          createdAt: sentAt,
        },
      });
    } catch (err) {
      // Race-condition safety net: two workers processed a redelivered event
      // at nearly the same time and both passed the earlier check.
      if (err.code === 'P2002') {
        console.log('Duplicate LINE message skipped (race):', lineMessageId);
        return;
      }
      throw err;
    }

    // Emit real-time events
    emitToConversation(conversation.id, 'new_message', { message, conversation });
    emitToAll('conversation_updated', { ...conversation, lastMessage: message });
}

async function sendMessage(channel, lineUserId, text) {
  const client = getClient(channel.accessToken);
  await client.pushMessage({ to: lineUserId, messages: [{ type: 'text', text }] });
}

// Downloads image/video/audio content a customer sent us. LINE requires the
// Channel Access Token to fetch this (no public URL exists), so the frontend
// can't hit it directly — this streams the bytes through our own backend.
async function getMessageContent(channel, messageId) {
  const blobClient = new line.messagingApi.MessagingApiBlobClient({ channelAccessToken: channel.accessToken });
  const { httpResponse, body } = await blobClient.getMessageContentWithHttpInfo(messageId);
  return { stream: body, contentType: httpResponse.headers.get('content-type') || 'application/octet-stream' };
}

module.exports = { processLineEvent, sendMessage, getMessageContent };
