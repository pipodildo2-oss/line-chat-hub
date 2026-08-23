const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const rateLimit = require('express-rate-limit');
const auth = require('../middleware/auth');
const { emitToConversation, emitToAll } = require('../services/socket.service');
const { sendMessage, sendImageMessage } = require('../services/line.service');
const { saveBase64Image, thumbPathFor, isValidImageDataUrl } = require('../lib/imageStorage');
const { getVisibleChannelIds, buildConversationWhere } = require('../lib/conversationQuery');

const prisma = new PrismaClient();

const MAX_IMAGES = 3;
// Caps how many recipients get pushed to at once — keeps a large broadcast
// from hammering the LINE API (and this process) with hundreds of concurrent
// requests in one burst.
const CONCURRENCY = 4;

function requireAdmin(req, res, next) {
  if (req.agent.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// A single broadcast can already push to up to 5000 conversations — nothing
// else in the app sends at that scale, so this exists purely to bound how
// many of those an admin (or a compromised admin token) can fire off back
// to back, not to police normal usage.
const broadcastLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.agent.id,
  message: { error: 'ส่ง Broadcast บ่อยเกินไป กรุณาลองใหม่ในอีกสักครู่' },
});

const CONV_INCLUDE = {
  channel: { select: { id: true, name: true, active: true } },
  agent: { select: { id: true, name: true } },
  tags: { include: { tag: true } },
};

// Runs `worker` over `items` with at most `limit` running at once.
async function runWithConcurrency(items, limit, worker) {
  let cursor = 0;
  async function next() {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
}

// Pushes one broadcast's content (images then text — same order/convention as
// quickReplies.js's POST /:id/send, which is the only other place in this
// codebase that sends both) to every target conversation, records the
// per-recipient outcome, and rolls the campaign row's counters up at the end.
// Runs AFTER the POST handler below has already responded — a large broadcast
// can take a while and there's no reason to hold the HTTP request open for it
// (this is a long-lived Node process per the Procfile, not a serverless
// function, so there's no timeout pressure either).
async function processCampaign(campaignId, targets, text, imageUrls, senderAgent) {
  let successCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  await runWithConcurrency(targets, CONCURRENCY, async (conv) => {
    if (conv.blocked) {
      await prisma.broadcastRecipient.create({ data: { campaignId, conversationId: conv.id, status: 'skipped_blocked' } });
      skippedCount++;
      return;
    }
    if (!conv.channel.active) {
      await prisma.broadcastRecipient.create({ data: { campaignId, conversationId: conv.id, status: 'skipped_channel_inactive' } });
      skippedCount++;
      return;
    }

    try {
      const created = [];
      for (const { full, thumb } of imageUrls) {
        await sendImageMessage(conv.channel, conv.lineUserId, full, thumb);
        created.push(await prisma.message.create({
          data: {
            conversationId: conv.id, sender: 'agent', senderName: senderAgent.name, senderId: senderAgent.id,
            type: 'image', content: '[Image]', metadata: JSON.stringify({ url: full }), read: true,
          },
        }));
      }
      if (text) {
        await sendMessage(conv.channel, conv.lineUserId, text);
        created.push(await prisma.message.create({
          data: {
            conversationId: conv.id, sender: 'agent', senderName: senderAgent.name, senderId: senderAgent.id,
            type: 'text', content: text, read: true,
          },
        }));
      }

      const now = new Date();
      const updatedConv = await prisma.conversation.update({
        where: { id: conv.id },
        data: { lastMessageAt: now },
        include: CONV_INCLUDE,
      });
      for (const message of created) emitToConversation(conv.id, 'new_message', { message, conversation: updatedConv });
      emitToAll('conversation_updated', { ...updatedConv, lastMessage: created[created.length - 1] });

      await prisma.broadcastRecipient.create({ data: { campaignId, conversationId: conv.id, status: 'sent', sentAt: now } });
      successCount++;
    } catch (err) {
      await prisma.broadcastRecipient.create({ data: { campaignId, conversationId: conv.id, status: 'failed', error: err.message } });
      failedCount++;
    }
  });

  const campaign = await prisma.broadcastCampaign.update({
    where: { id: campaignId },
    data: { successCount, failedCount, skippedCount, status: 'completed', completedAt: new Date() },
  });
  // Curated payload rather than the raw row — `images`/`filters` are stored as
  // JSON strings on the model, but the frontend's campaign list already holds
  // them parsed (see GET / below); emitting the raw row would clobber that
  // with an unparsed string on the live-update merge.
  emitToAll('broadcast_progress', {
    id: campaign.id,
    status: campaign.status,
    successCount: campaign.successCount,
    failedCount: campaign.failedCount,
    skippedCount: campaign.skippedCount,
    completedAt: campaign.completedAt,
  });
}

// A customer replying counts as 1 responder no matter how many messages they
// send back — so this takes each "sent" recipient's earliest reply (if any)
// and checks it landed at/after that recipient's own send time, rather than
// counting messages. Computed on read (not a stored column) so it's always
// accurate against live conversation history instead of going stale.
async function computeRepliedCount(campaignId, campaignCreatedAt) {
  const sent = await prisma.broadcastRecipient.findMany({
    where: { campaignId, status: 'sent' },
    select: { conversationId: true, sentAt: true },
  });
  if (sent.length === 0) return 0;
  const sentAtByConv = new Map(sent.map(r => [r.conversationId, r.sentAt]));
  const replies = await prisma.message.findMany({
    where: { conversationId: { in: [...sentAtByConv.keys()] }, sender: 'user', createdAt: { gt: campaignCreatedAt } },
    select: { conversationId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  const earliestReplyByConv = new Map();
  for (const r of replies) {
    if (!earliestReplyByConv.has(r.conversationId)) earliestReplyByConv.set(r.conversationId, r.createdAt);
  }
  let count = 0;
  for (const [convId, earliest] of earliestReplyByConv) {
    if (earliest >= sentAtByConv.get(convId)) count++;
  }
  return count;
}

// POST /api/broadcasts — admin only. body: { message?, images?: [dataUrl,...],
// mode: 'filter'|'manual', filters?: {...same shape as GET /api/conversations
// query params}, conversationIds?: [...] }. 'filter' mode broadcasts to every
// conversation currently matching those filters (recomputed here, not a list
// of ids the frontend enumerated); 'manual' mode broadcasts to an explicit
// hand-picked list.
router.post('/', auth, requireAdmin, broadcastLimiter, async (req, res) => {
  try {
    const { message, images, mode, filters, conversationIds } = req.body;
    if (mode !== 'filter' && mode !== 'manual') {
      return res.status(400).json({ error: "mode ต้องเป็น 'filter' หรือ 'manual'" });
    }
    const text = message?.trim() || '';
    const imageList = Array.isArray(images) ? images : [];
    if (!text && imageList.length === 0) {
      return res.status(400).json({ error: 'ต้องมีข้อความหรือรูปภาพอย่างน้อย 1 อย่าง' });
    }
    if (imageList.length > MAX_IMAGES) {
      return res.status(400).json({ error: `แนบรูปได้สูงสุด ${MAX_IMAGES} รูป` });
    }
    for (const img of imageList) {
      if (!isValidImageDataUrl(img)) {
        return res.status(400).json({ error: 'ไฟล์ที่แนบต้องเป็นรูปภาพ (JPEG/PNG/GIF/WebP) ขนาดไม่เกิน 15MB' });
      }
    }

    let targets;
    if (mode === 'manual') {
      if (!Array.isArray(conversationIds) || conversationIds.length === 0) {
        return res.status(400).json({ error: 'ต้องเลือกลูกค้าอย่างน้อย 1 คน' });
      }
      targets = await prisma.conversation.findMany({
        where: { id: { in: conversationIds } },
        select: { id: true, lineUserId: true, blocked: true, channel: { select: { active: true, accessToken: true } } },
      });
    } else {
      const visibleChannelIds = await getVisibleChannelIds(req.agent);
      const { where, selectedChannelIds } = buildConversationWhere(filters || {}, req.agent.id);
      if (visibleChannelIds) {
        where.channelId = { in: selectedChannelIds.length > 0 ? selectedChannelIds.filter(id => visibleChannelIds.includes(id)) : visibleChannelIds };
      }
      targets = await prisma.conversation.findMany({
        where,
        select: { id: true, lineUserId: true, blocked: true, channel: { select: { active: true, accessToken: true } } },
        take: 5000,
      });
    }

    if (targets.length === 0) {
      return res.status(400).json({ error: 'ไม่พบลูกค้าที่ตรงกับเงื่อนไข' });
    }

    // Save each attached image to disk ONCE — every recipient's push reuses
    // the same public URL rather than re-saving per recipient (see
    // imageStorage.js; same helper messages.js/quickReplies.js already use).
    const savedImages = [];
    for (const img of imageList) {
      const storedPath = await saveBase64Image(img);
      if (storedPath) savedImages.push(storedPath);
    }
    const origin = `${req.protocol}://${req.get('host')}`;
    const imageUrls = savedImages.map(p => ({ full: `${origin}${p}`, thumb: `${origin}${thumbPathFor(p)}` }));

    const campaign = await prisma.broadcastCampaign.create({
      data: {
        createdById: req.agent.id,
        message: text || null,
        images: savedImages.length > 0 ? JSON.stringify(savedImages) : null,
        filters: mode === 'manual' ? null : JSON.stringify(filters || {}),
        totalRecipients: targets.length,
      },
    });

    res.status(201).json({ ...campaign, images: savedImages, filters: mode === 'manual' ? null : (filters || {}) });

    processCampaign(campaign.id, targets, text, imageUrls, { id: req.agent.id, name: req.agent.name })
      .catch(err => console.error('Broadcast processing failed:', err));
  } catch (err) {
    console.error('Create broadcast failed:', err.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

// GET /api/broadcasts?page=&limit= — paginated campaign history, admin only.
router.get('/', auth, requireAdmin, async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const [total, campaigns] = await Promise.all([
    prisma.broadcastCampaign.count(),
    prisma.broadcastCampaign.findMany({
      orderBy: { createdAt: 'desc' },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
      include: { createdBy: { select: { id: true, name: true } } },
    }),
  ]);

  const withReplies = await Promise.all(campaigns.map(async (c) => ({
    ...c,
    images: c.images ? JSON.parse(c.images) : [],
    filters: c.filters ? JSON.parse(c.filters) : null,
    repliedCount: await computeRepliedCount(c.id, c.createdAt),
  })));

  res.json({ campaigns: withReplies, total, page: Number(page), limit: Number(limit) });
});

// GET /api/broadcasts/:id — full detail incl. every recipient + whether they
// replied, admin only.
router.get('/:id', auth, requireAdmin, async (req, res) => {
  const campaign = await prisma.broadcastCampaign.findUnique({
    where: { id: req.params.id },
    include: {
      createdBy: { select: { id: true, name: true } },
      recipients: {
        include: {
          conversation: {
            select: { id: true, displayName: true, lineUserId: true, pictureUrl: true, channel: { select: { id: true, name: true } } },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!campaign) return res.status(404).json({ error: 'Not found' });

  const sentRecipients = campaign.recipients.filter(r => r.status === 'sent');
  const convIds = sentRecipients.map(r => r.conversationId);
  const replies = convIds.length > 0 ? await prisma.message.findMany({
    where: { conversationId: { in: convIds }, sender: 'user', createdAt: { gt: campaign.createdAt } },
    select: { conversationId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  }) : [];
  const earliestReplyByConv = new Map();
  for (const r of replies) {
    if (!earliestReplyByConv.has(r.conversationId)) earliestReplyByConv.set(r.conversationId, r.createdAt);
  }

  const recipients = campaign.recipients.map(r => ({
    ...r,
    replied: r.status === 'sent' && r.sentAt && earliestReplyByConv.has(r.conversationId) && earliestReplyByConv.get(r.conversationId) >= r.sentAt,
  }));

  res.json({
    ...campaign,
    images: campaign.images ? JSON.parse(campaign.images) : [],
    filters: campaign.filters ? JSON.parse(campaign.filters) : null,
    recipients,
  });
});

module.exports = router;
