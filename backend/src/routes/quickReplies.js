const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const auth = require('../middleware/auth');
const { emitToConversation, emitToAll } = require('../services/socket.service');
const { sendMessage, sendImageMessage } = require('../services/line.service');
const { saveBase64Image, isStoredPath, thumbPathFor, deleteStoredImage } = require('../lib/imageStorage');

const prisma = new PrismaClient();

const KINDS = ['reply', 'promotion'];

function requireAdmin(req, res, next) {
  if (req.agent.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// ---------- Quick Reply Categories ("หมวดหมู่") ----------
// Free-form, admin-created by typing a name. Not tied to any specific LINE OA —
// an admin picks which conversation to send a quick reply into at send time.

const CATEGORY_INCLUDE = {
  _count: { select: { quickReplies: true } },
  channels: { select: { id: true, name: true } },
};

// GET /api/quick-replies/categories
router.get('/categories', auth, async (req, res) => {
  const categories = await prisma.quickReplyCategory.findMany({
    include: CATEGORY_INCLUDE,
    orderBy: { name: 'asc' },
  });
  res.json(categories);
});

// POST /api/quick-replies/categories — admin only
// channelIds is optional: which LINE OAs this category (and its quick replies)
// should show up for. Empty/omitted = shows for NO channel yet — a freshly
// created category stays hidden from every Inbox picker until at least one
// channel is explicitly selected for it (see GET / above).
router.post('/categories', auth, requireAdmin, async (req, res) => {
  try {
    const { name, channelIds } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name required' });
    const category = await prisma.quickReplyCategory.create({
      data: {
        name: name.trim(),
        ...(Array.isArray(channelIds) && channelIds.length > 0
          ? { channels: { connect: channelIds.map(id => ({ id })) } }
          : {}),
      },
      include: CATEGORY_INCLUDE,
    });
    res.status(201).json(category);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'มีหมวดหมู่นี้อยู่แล้ว' });
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/quick-replies/categories/:id — admin only
router.patch('/categories/:id', auth, requireAdmin, async (req, res) => {
  try {
    const { name, channelIds } = req.body;
    const category = await prisma.quickReplyCategory.update({
      where: { id: req.params.id },
      data: {
        ...(name?.trim() ? { name: name.trim() } : {}),
        // `set` fully replaces the linked channels with this list — right semantics
        // for a checkbox picker (including clearing it back to "all channels").
        ...(Array.isArray(channelIds) ? { channels: { set: channelIds.map(id => ({ id })) } } : {}),
      },
      include: CATEGORY_INCLUDE,
    });
    res.json(category);
  } catch {
    res.status(404).json({ error: 'Not found' });
  }
});

// DELETE /api/quick-replies/categories/:id — admin only (cascades to its quick replies)
router.delete('/categories/:id', auth, requireAdmin, async (req, res) => {
  try {
    // The cascade delete below removes the QuickReply rows, but not their image
    // files on disk — grab those first so they can be cleaned up afterward.
    const withImages = await prisma.quickReply.findMany({
      where: { categoryId: req.params.id, imageData: { not: null } },
      select: { imageData: true },
    });
    await prisma.quickReplyCategory.delete({ where: { id: req.params.id } });
    withImages.forEach(qr => deleteStoredImage(qr.imageData));
    res.status(204).end();
  } catch {
    res.status(404).json({ error: 'Not found' });
  }
});

// ---------- Quick Replies ----------

// GET /api/quick-replies?categoryId=...&kind=...&channelId=...
// channelId filters to categories that explicitly include that channel — used
// by the Inbox picker so agents only see quick replies relevant to the LINE
// OA of the conversation they're replying in. A category with NO channels
// selected yet is hidden everywhere (not shown on every OA) until an admin
// explicitly picks at least one channel for it in Settings — see
// CATEGORY_INCLUDE / POST/PATCH /categories below for where that's set.
router.get('/', auth, async (req, res) => {
  const { categoryId, kind, channelId } = req.query;
  const where = {};
  if (categoryId) where.categoryId = categoryId;
  if (kind) where.kind = kind;
  if (channelId) {
    where.category = { channels: { some: { id: channelId } } };
  }
  const quickReplies = await prisma.quickReply.findMany({
    where,
    include: { category: { select: { id: true, name: true } } },
    orderBy: [{ order: 'asc' }, { name: 'asc' }],
  });
  // Don't ship the full base64 blob in list views — just whether an image exists.
  res.json(quickReplies.map(({ imageData, ...qr }) => ({ ...qr, hasImage: !!imageData })));
});

// PATCH /api/quick-replies/reorder — admin only. Body: { categoryId, ids: [...] }
// (ids listed in the desired display order). Sets each item's `order` to its index —
// this is what controls the order agents see them in the Inbox quick-reply picker.
router.patch('/reorder', auth, requireAdmin, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids required' });
    await Promise.all(ids.map((id, index) => prisma.quickReply.update({ where: { id }, data: { order: index } })));
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/quick-replies — admin only
router.post('/', auth, requireAdmin, async (req, res) => {
  try {
    const { categoryId, kind, name, content, imageData } = req.body;
    if (!categoryId || !name?.trim() || !content?.trim()) {
      return res.status(400).json({ error: 'categoryId, name and content required' });
    }
    if (kind && !KINDS.includes(kind)) return res.status(400).json({ error: 'kind ต้องเป็น reply หรือ promotion' });
    if (imageData && !/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(imageData)) {
      return res.status(400).json({ error: 'ไฟล์ที่แนบต้องเป็นรูปภาพเท่านั้น' });
    }
    // New items go to the end of their category's list by default.
    const count = await prisma.quickReply.count({ where: { categoryId } });
    // Write the image to disk instead of storing the base64 blob in Postgres
    // (see imageStorage.js).
    const storedImage = imageData ? ((await saveBase64Image(imageData)) || imageData) : null;
    const quickReply = await prisma.quickReply.create({
      data: { categoryId, kind: kind || 'reply', name: name.trim(), content: content.trim(), imageData: storedImage, order: count },
    });
    const { imageData: _omit, ...safe } = quickReply;
    res.status(201).json({ ...safe, hasImage: !!quickReply.imageData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/quick-replies/:id — admin only
router.patch('/:id', auth, requireAdmin, async (req, res) => {
  try {
    const { name, content, imageData, categoryId, kind } = req.body;
    if (kind && !KINDS.includes(kind)) return res.status(400).json({ error: 'kind ต้องเป็น reply หรือ promotion' });
    if (imageData && !/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(imageData)) {
      return res.status(400).json({ error: 'ไฟล์ที่แนบต้องเป็นรูปภาพเท่านั้น' });
    }
    const data = {};
    if (categoryId) data.categoryId = categoryId;
    if (kind) data.kind = kind;
    if (name?.trim()) data.name = name.trim();
    if (content?.trim()) data.content = content.trim();
    // Allow explicit removal with "". New images get written to disk instead of
    // stored as a base64 blob (see imageStorage.js).
    let previousImage = null;
    if (imageData !== undefined) {
      // Fetch the current file (if any) BEFORE overwriting, so it can be cleaned
      // up off disk after the update succeeds — otherwise every re-upload leaves
      // an orphaned file behind, permanently wasting space.
      previousImage = (await prisma.quickReply.findUnique({ where: { id: req.params.id }, select: { imageData: true } }))?.imageData;
      data.imageData = imageData ? ((await saveBase64Image(imageData)) || imageData) : null;
    }
    const quickReply = await prisma.quickReply.update({ where: { id: req.params.id }, data });
    if (previousImage && previousImage !== quickReply.imageData) deleteStoredImage(previousImage);
    const { imageData: _omit, ...safe } = quickReply;
    res.json({ ...safe, hasImage: !!quickReply.imageData });
  } catch {
    res.status(404).json({ error: 'Not found' });
  }
});

// DELETE /api/quick-replies/:id — admin only
router.delete('/:id', auth, requireAdmin, async (req, res) => {
  try {
    const quickReply = await prisma.quickReply.delete({ where: { id: req.params.id } });
    // Clean up the associated image file off disk — Prisma only removes the DB
    // row, so without this the file would sit orphaned in the uploads volume forever.
    if (quickReply.imageData) deleteStoredImage(quickReply.imageData);
    res.status(204).end();
  } catch {
    res.status(404).json({ error: 'Not found' });
  }
});

// GET /api/quick-replies/:id/image — intentionally NOT behind `auth`.
// LINE's own servers fetch this URL directly (as originalContentUrl/previewImageUrl)
// when we push an image quick-reply, so it must be publicly reachable.
// New rows store a short "/uploads/..." path (see imageStorage.js) and redirect
// there — pass ?preview=1 to redirect to the smaller thumbnail instead (see
// messages.js's /image/:id for why: LINE caps previewImageUrl at 1MB
// separately from the 10MB cap on the full image). Rows created before this
// change still have the full base64 blob (no thumbnail exists), so those are
// decoded and streamed inline as before regardless of ?preview.
router.get('/:id/image', async (req, res) => {
  const quickReply = await prisma.quickReply.findUnique({ where: { id: req.params.id }, select: { imageData: true } });
  if (!quickReply?.imageData) return res.status(404).end();
  if (isStoredPath(quickReply.imageData)) {
    const target = req.query.preview ? thumbPathFor(quickReply.imageData) : quickReply.imageData;
    return res.redirect(target);
  }
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(quickReply.imageData);
  if (!match) return res.status(404).end();
  const [, contentType, base64] = match;
  res.set('Content-Type', contentType);
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(Buffer.from(base64, 'base64'));
});

// POST /api/quick-replies/:id/send — any agent, sends this quick reply into a conversation.
// The quick reply itself isn't tied to a channel — the conversation being viewed
// decides which LINE OA (and access token) it actually goes out through.
router.post('/:id/send', auth, async (req, res) => {
  try {
    const { conversationId } = req.body;
    if (!conversationId) return res.status(400).json({ error: 'conversationId required' });

    const [quickReply, conversation] = await Promise.all([
      prisma.quickReply.findUnique({ where: { id: req.params.id } }),
      prisma.conversation.findUnique({ where: { id: conversationId }, include: { channel: true } }),
    ]);
    if (!quickReply) return res.status(404).json({ error: 'Quick reply not found' });
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    if (conversation.blocked) {
      return res.status(409).json({ error: 'ลูกค้าคนนี้บล็อคเราอยู่ ไม่สามารถส่งข้อความได้' });
    }
    if (!conversation.channel.active) {
      return res.status(409).json({ error: 'ช่องทางนี้ถูกปิดใช้งานอยู่ ไม่สามารถส่งข้อความได้' });
    }

    const created = [];
    // A quick reply's image and text are two separate LINE pushes — if the
    // first (image) succeeds but the second (text) fails, the image really
    // was delivered and its row is real, not an orphan. sendErr tracks
    // whichever push failed so the response below can tell the agent exactly
    // what did and didn't go out, instead of either (a) throwing away a
    // legitimately-sent image because the unrelated text push errored, or
    // (b) silently treating "half sent" the same as "fully sent."
    let sendErr = null;

    if (quickReply.imageData) {
      const imageUrl = `${req.protocol}://${req.get('host')}/api/quick-replies/${quickReply.id}/image`;
      const previewUrl = `${imageUrl}?preview=1`;
      try {
        await sendImageMessage(conversation.channel, conversation.lineUserId, imageUrl, previewUrl);
        created.push(await prisma.message.create({
          data: {
            conversationId: conversation.id,
            sender: 'agent',
            senderName: req.agent.name,
            senderId: req.agent.id,
            type: 'image',
            content: '[Image]',
            metadata: JSON.stringify({ url: imageUrl }),
            read: true,
          },
        }));
      } catch (err) {
        sendErr = err; // image push itself failed — nothing created, nothing to roll back
      }
    }

    // Only attempt the text half if the image (when there is one) actually
    // went out — if it failed, stop here rather than sending the text alone,
    // which would leave a caption with no image and confuse the customer.
    if (!sendErr) {
      try {
        await sendMessage(conversation.channel, conversation.lineUserId, quickReply.content);
        created.push(await prisma.message.create({
          data: {
            conversationId: conversation.id,
            sender: 'agent',
            senderName: req.agent.name,
            senderId: req.agent.id,
            type: 'text',
            content: quickReply.content,
            read: true,
          },
        }));
      } catch (err) {
        sendErr = err;
      }
    }

    if (created.length === 0) {
      // Nothing went out at all — clean, safe-to-retry failure, same as
      // messages.js POST /:conversationId.
      if (sendErr.isSendTimeout) return res.status(504).json({ error: sendErr.message, uncertain: true });
      return res.status(500).json({ error: sendErr.message });
    }

    // At least one piece is confirmed sent + recorded — emit + respond right
    // away, same "tell the agent ASAP, do bookkeeping after" principle as
    // messages.js POST /:conversationId.
    const now = new Date();
    // `conversation` was fetched before any of this — patch this field
    // locally before broadcasting, otherwise the inbox list briefly shows a
    // stale value (jumping backward in sort order).
    conversation.lastMessageAt = now;

    for (const message of created) {
      emitToConversation(conversation.id, 'new_message', { message, conversation });
    }
    emitToAll('conversation_updated', { ...conversation, lastMessage: created[created.length - 1] });

    if (sendErr) {
      // 207 (not 201) — the frontend keys off this to warn the agent only the
      // failed piece needs resending, not the whole quick reply again.
      res.status(207).json({ messages: created, partial: true, error: sendErr.message, uncertain: !!sendErr.isSendTimeout });
    } else {
      res.status(201).json({ messages: created });
    }

    // An outgoing message (even a canned quick reply) clears this agent's own
    // audit-trail tags across the WHOLE conversation — same rule as a normal
    // typed reply. Fire-and-forget after the response: this is bookkeeping,
    // not confirmation the agent needs before seeing their message went through.
    prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: now } })
      .catch(e => console.error('lastMessageAt update failed (message already sent+recorded):', e.message));
    prisma.messageView.deleteMany({ where: { agentId: req.agent.id, message: { conversationId: conversation.id } } })
      .then(cleared => {
        if (cleared.count > 0) emitToConversation(conversation.id, 'message_view_cleared', { agentId: req.agent.id });
      })
      .catch(e => console.error('messageView cleanup failed (message already sent+recorded):', e.message));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
