const crypto = require('crypto');
const line = require('@line/bot-sdk');
const { PrismaClient } = require('@prisma/client');
const { emitToConversation, emitToAll } = require('./socket.service');

const prisma = new PrismaClient();

function getClient(accessToken) {
  return new line.messagingApi.MessagingApiClient({ channelAccessToken: accessToken });
}

// How long we're willing to wait for LINE's push API before giving up on
// this HTTP request and telling the caller "we can't confirm" (see
// SendTimeoutError below) — LINE is occasionally slow/unreachable, and
// without this a hung request could block an agent's send indefinitely
// (nothing else in this SDK enforces a timeout; see http-fetch.js).
const SEND_TIMEOUT_MS = 20000;

// IMPORTANT LIMITATION: the LINE SDK (@line/bot-sdk) doesn't expose any way
// to pass an AbortSignal into pushMessage — so this timeout only bounds how
// long WE wait for a response; it can't actually cancel the underlying HTTP
// request to LINE. If it fires, the push may still be in flight and could
// still succeed a moment later, entirely outside our knowledge. That's why a
// timeout here is surfaced as SendTimeoutError ("we don't know") rather than
// a normal failure ("this definitely didn't go through") — callers must NOT
// treat a timeout as safe-to-retry the same way a normal rejection is.
class SendTimeoutError extends Error {
  constructor() {
    super('ไม่สามารถยืนยันได้ว่าข้อความนี้ส่งถึงลูกค้าหรือไม่ (LINE ตอบสนองช้าเกินไป) กรุณาตรวจสอบในแชทก่อนส่งซ้ำ');
    this.isSendTimeout = true;
  }
}

// LINE's own message when the OA's monthly free/paid message quota is used
// up ("You have reached your monthly limit.") — surfaced as-is by
// describeLineError below, which reads badly as a raw English string in an
// agent's UI. Tagged separately (mirroring isSendTimeout) so the route layer
// can turn it into a proper Thai "buy more messages" prompt instead of a
// generic failure. Matched on LINE's own wording rather than an error code,
// since the SDK's HTTPFetchError doesn't expose a stable machine-readable
// reason for this case — see describeLineError's comment on why the real
// reason is buried in a JSON string on err.body in the first place.
class QuotaExceededError extends Error {
  constructor() {
    super('ข้อความไลน์ของคุณไม่เพียงพอ โปรดซื้อข้อความไลน์ของคุณเผื่อไว้ด้วยนะคะ');
    this.isQuotaExceeded = true;
  }
}

function withSendTimeout(promise) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new SendTimeoutError()), SEND_TIMEOUT_MS);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

// The LINE SDK throws HTTPFetchError with a useless generic message (e.g.
// "403 - Forbidden") and buries the actual reason — things like "The user
// hasn't added the LINE Official Account as a friend." or a bad/expired
// access token — inside a raw JSON string on err.body. Unwrap it so agents
// see why a send actually failed instead of a silent/generic error.
function describeLineError(err) {
  if (err?.body) {
    try {
      const parsed = JSON.parse(err.body);
      if (parsed?.message) return parsed.message;
    } catch { /* body wasn't JSON — fall through to err.message */ }
  }
  return err?.message || 'ส่งข้อความไม่สำเร็จ';
}

// Turns a raw LINE push failure into the right thrown error: QuotaExceededError
// for the monthly-limit case (see its own comment), otherwise describeLineError's
// unwrapped text as a plain Error. Shared by sendMessage/sendImageMessage so both
// paths surface the quota case identically instead of it depending on which one
// happened to fail.
function toSendError(err) {
  if (err.isSendTimeout) return err;
  if (/monthly limit/i.test(describeLineError(err))) return new QuotaExceededError();
  return new Error(describeLineError(err));
}

// Flips the blocked flag on a conversation (if we have one for this user on
// this channel) and broadcasts the change so an open Inbox tab updates live.
// Used by both the 'unfollow' and 'follow' handlers below. A plain updateMany
// (not upsert) — if the customer blocked us before ever messaging us, there's
// no conversation row to flag yet, and that's fine, there's nothing to warn
// agents about since they were never in a chat with them anyway.
async function setBlockedFlag(channel, lineUserId, blocked) {
  const result = await prisma.conversation.updateMany({
    where: { lineUserId, channelId: channel.id },
    data: { blocked, blockedAt: blocked ? new Date() : null },
  });
  if (result.count > 0) {
    const conversation = await prisma.conversation.findUnique({
      where: { lineUserId_channelId: { lineUserId, channelId: channel.id } },
      include: { channel: true, agent: true },
    });
    if (conversation) emitToAll('conversation_updated', conversation);
  }
}

// Processes a single LINE event (used by the queue worker, one job = one event).
async function processLineEvent(channel, event) {
    // The customer just blocked our LINE OA. LINE's push-message API stays
    // silent about this (200 OK, message just never arrives) — this webhook
    // event is the only signal we ever get, so track it here.
    if (event.type === 'unfollow') {
      if (event.source?.userId) await setBlockedFlag(channel, event.source.userId, true);
      return;
    }
    // Re-added as a friend, or unblocked — LINE uses the same 'follow' event
    // type for both (see follow.isUnblocked, which the docs note isn't fully
    // reliable), so just clear the flag either way.
    if (event.type === 'follow') {
      if (event.source?.userId) await setBlockedFlag(channel, event.source.userId, false);
      return;
    }
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
      select: { lastMessageAt: true, displayNameCustomized: true, status: true },
    });
    const bumpLastMessageAt = !existingConv?.lastMessageAt || sentAt > existingConv.lastMessageAt;

    // Upsert conversation
    const conversation = await prisma.conversation.upsert({
      where: { lineUserId_channelId: { lineUserId, channelId: channel.id } },
      update: {
        // Don't clobber a name an agent set by hand — only sync LINE's profile
        // name into displayName if nobody has customized it for this
        // conversation yet. lineDisplayName, unlike displayName, always
        // tracks the real LINE profile name regardless of customization —
        // it exists specifically so the customer can still be found by
        // their original LINE name after being renamed (see schema.prisma).
        ...(existingConv?.displayNameCustomized ? {} : { displayName }),
        lineDisplayName: displayName,
        pictureUrl,
        // A closed conversation reopens on a new message — it was "done",
        // this is a fresh inquiry. "รอ" (pending) and "หยุด" (stopped) are
        // different: an agent put it there on purpose (waiting on something,
        // or deliberately pausing this customer), not because it's resolved,
        // so a follow-up message shouldn't yank it back to "เปิด" out from
        // under them — leave status untouched in either case.
        ...(['pending', 'stopped'].includes(existingConv?.status) ? {} : { status: 'open' }),
        // If they're messaging us, they're obviously not blocking us — covers
        // the edge case where an 'unfollow'-then-'follow' pair happened but a
        // 'follow' webhook delivery got lost somehow.
        blocked: false,
        blockedAt: null,
        ...(bumpLastMessageAt ? { lastMessageAt: sentAt } : {}),
      },
      create: {
        lineUserId,
        displayName,
        lineDisplayName: displayName,
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
  try {
    // xLineRetryKey: LINE de-dupes a push that reuses the same retry key, so
    // if our own request to LINE gets silently retried at a lower network
    // layer (e.g. a proxy or keep-alive connection reissuing it) LINE won't
    // deliver the message twice. Freshly generated per call — this protects
    // against that specific low-level retry case, not against an agent
    // manually clicking send again (that's a genuinely new request/key by
    // design, and is instead addressed by not treating an uncertain outcome
    // as "safe to retry" — see SendTimeoutError above).
    await withSendTimeout(client.pushMessage({ to: lineUserId, messages: [{ type: 'text', text }] }, crypto.randomUUID()));
  } catch (err) {
    throw toSendError(err);
  }
}

// Used by the composer's "attach an image" feature and quick-reply images.
// imageUrl/previewUrl must be public HTTPS URLs — LINE's own servers fetch
// them directly, so they can't be behind our auth. LINE caps previewImageUrl
// at 1MB separately from originalContentUrl's 10MB cap, so callers should pass
// a dedicated (smaller) thumbnail as previewUrl where one exists — reusing the
// full image for both silently breaks the preview for anything over 1MB.
// previewUrl defaults to imageUrl for backward compatibility with callers/rows
// that only have a single image (e.g. legacy base64 rows with no thumbnail).
async function sendImageMessage(channel, lineUserId, imageUrl, previewUrl = imageUrl) {
  const client = getClient(channel.accessToken);
  try {
    await withSendTimeout(client.pushMessage({
      to: lineUserId,
      messages: [{ type: 'image', originalContentUrl: imageUrl, previewImageUrl: previewUrl }],
    }, crypto.randomUUID()));
  } catch (err) {
    throw toSendError(err);
  }
}

// Downloads image/video/audio content a customer sent us. LINE requires the
// Channel Access Token to fetch this (no public URL exists), so the frontend
// can't hit it directly — this streams the bytes through our own backend.
async function getMessageContent(channel, messageId) {
  const blobClient = new line.messagingApi.MessagingApiBlobClient({ channelAccessToken: channel.accessToken });
  const { httpResponse, body } = await blobClient.getMessageContentWithHttpInfo(messageId);
  return { stream: body, contentType: httpResponse.headers.get('content-type') || 'application/octet-stream' };
}

module.exports = { processLineEvent, sendMessage, sendImageMessage, getMessageContent };
