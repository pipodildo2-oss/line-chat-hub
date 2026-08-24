const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const auth = require('../middleware/auth');
const { emitToConversation, emitToAll } = require('../services/socket.service');
const { sendMessage, sendImageMessage } = require('../services/line.service');
const { saveBase64Image, isStoredPath, thumbPathFor, deleteStoredImage, isValidImageDataUrl } = require('../lib/imageStorage');
const { canAccessChannel } = require('../lib/conversationQuery');

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
    console.error('Create quick-reply category failed:', err.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
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
    console.error('Reorder quick replies failed:', err.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
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
    if (imageData && !isValidImageDataUrl(imageData)) {
      return res.status(400).json({ error: 'ไฟล์ที่แนบต้องเป็นรูปภาพ (JPEG/PNG/GIF/WebP) ขนาดไม่เกิน 15MB' });
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
    console.error('Create quick reply failed:', err.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

// PATCH /api/quick-replies/:id — admin only
router.patch('/:id', auth, requireAdmin, async (req, res) => {
  try {
    const { name, content, imageData, categoryId, kind } = req.body;
    if (kind && !KINDS.includes(kind)) return res.status(400).json({ error: 'kind ต้องเป็น reply หรือ promotion' });
    if (imageData && !isValidImageDataUrl(imageData)) {
      return res.status(400).json({ error: 'ไฟล์ที่แนบต้องเป็นรูปภาพ (JPEG/PNG/GIF/WebP) ขนาดไม่เกิน 15MB' });
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

// ---------- Quick Reply Requests ("คำขอเพิ่มข้อความลัด") ----------
// A non-admin agent can't create a QuickReply directly (POST / above is
// requireAdmin) — they submit a request here instead, which sits pending
// until an admin reviews it (อนุมัติ/แก้ไข/ไม่อนุมัติ). Only approval
// actually creates a live QuickReply; "แก้ไข" sends it back to the
// ORIGINAL REQUESTER to fix and resubmit, it doesn't mean the admin edits
// it themselves — see PATCH /requests/:id below.

const REQUEST_INCLUDE = {
  category: { select: { id: true, name: true } },
  requestedBy: { select: { id: true, name: true } },
  reviewedBy: { select: { id: true, name: true } },
};

// Never ships the raw base64/stored-path value — same "hasImage flag, fetch
// via a dedicated image route" convention as the live QuickReply list above.
function safeRequest(r) {
  const { imageData, ...rest } = r;
  return { ...rest, hasImage: !!imageData };
}

// GET /api/quick-replies/requests?status=
// Agents only ever see their OWN requests — server-enforced (not just
// hidden in the UI), same reasoning as canAccessChannel elsewhere: an agent
// has no business browsing a teammate's pending/rejected drafts. Admins see
// everyone's.
router.get('/requests', auth, async (req, res) => {
  const { status } = req.query;
  const where = {};
  if (status) where.status = status;
  if (req.agent.role !== 'admin') where.requestedById = req.agent.id;
  const requests = await prisma.quickReplyRequest.findMany({
    where,
    include: REQUEST_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });
  res.json(requests.map(safeRequest));
});

// POST /api/quick-replies/requests — any authenticated agent.
router.post('/requests', auth, async (req, res) => {
  try {
    const { categoryId, kind, name, content, imageData } = req.body;
    if (!categoryId || !name?.trim() || !content?.trim()) {
      return res.status(400).json({ error: 'กรุณาเลือกหมวดหมู่และกรอกชื่อ/รายละเอียดข้อความ' });
    }
    if (kind && !KINDS.includes(kind)) return res.status(400).json({ error: 'kind ต้องเป็น reply หรือ promotion' });
    if (imageData && !isValidImageDataUrl(imageData)) {
      return res.status(400).json({ error: 'ไฟล์ที่แนบต้องเป็นรูปภาพ (JPEG/PNG/GIF/WebP) ขนาดไม่เกิน 15MB' });
    }
    const storedImage = imageData ? ((await saveBase64Image(imageData)) || imageData) : null;
    const request = await prisma.quickReplyRequest.create({
      data: {
        categoryId, kind: kind || 'reply', name: name.trim(), content: content.trim(),
        imageData: storedImage, requestedById: req.agent.id,
      },
      include: REQUEST_INCLUDE,
    });
    emitToAll('quick_reply_request_created', { id: request.id, requestedById: req.agent.id, requestedByName: req.agent.name });
    res.status(201).json(safeRequest(request));
  } catch (err) {
    console.error('Create quick reply request failed:', err.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

// PATCH /api/quick-replies/requests/:id — the ORIGINAL REQUESTER edits and
// resubmits a request an admin sent back for revision. Only allowed while
// status is exactly 'needs_revision', and only by whoever created it —
// resets status back to 'pending' for another review pass.
router.patch('/requests/:id', auth, async (req, res) => {
  try {
    const existing = await prisma.quickReplyRequest.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'ไม่พบคำขอนี้' });
    if (existing.requestedById !== req.agent.id) return res.status(403).json({ error: 'แก้ไขได้เฉพาะคำขอของตัวเอง' });
    if (existing.status !== 'needs_revision') {
      return res.status(409).json({ error: 'แก้ไขได้เฉพาะคำขอที่แอดมินส่งกลับมาให้แก้ไขเท่านั้น' });
    }

    const { categoryId, kind, name, content, imageData } = req.body;
    if (kind && !KINDS.includes(kind)) return res.status(400).json({ error: 'kind ต้องเป็น reply หรือ promotion' });
    if (imageData && !isValidImageDataUrl(imageData)) {
      return res.status(400).json({ error: 'ไฟล์ที่แนบต้องเป็นรูปภาพ (JPEG/PNG/GIF/WebP) ขนาดไม่เกิน 15MB' });
    }
    const data = { status: 'pending', reviewedById: null, reviewedAt: null, reviewNote: null };
    if (categoryId) data.categoryId = categoryId;
    if (kind) data.kind = kind;
    if (name?.trim()) data.name = name.trim();
    if (content?.trim()) data.content = content.trim();
    // Same "fetch the old file before overwriting, clean it up after" pattern
    // as PATCH /:id above — otherwise every re-upload on resubmit leaves an
    // orphaned file behind.
    let previousImage = null;
    if (imageData !== undefined) {
      previousImage = existing.imageData;
      data.imageData = imageData ? ((await saveBase64Image(imageData)) || imageData) : null;
    }
    const updated = await prisma.quickReplyRequest.update({ where: { id: req.params.id }, data, include: REQUEST_INCLUDE });
    if (previousImage && previousImage !== updated.imageData) deleteStoredImage(previousImage);
    emitToAll('quick_reply_request_created', { id: updated.id, requestedById: req.agent.id, requestedByName: req.agent.name });
    res.json(safeRequest(updated));
  } catch (err) {
    console.error('Resubmit quick reply request failed:', err.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

// PATCH /api/quick-replies/requests/:id/review — admin only: อนุมัติ / แก้ไข / ไม่อนุมัติ.
// Approving is the only path that actually creates a live QuickReply —
// everything else just updates the request's own status.
router.patch('/requests/:id/review', auth, requireAdmin, async (req, res) => {
  try {
    const { status, reviewNote } = req.body;
    if (!['approved', 'needs_revision', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'สถานะไม่ถูกต้อง' });
    }
    const existing = await prisma.quickReplyRequest.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'ไม่พบคำขอนี้' });
    if (existing.status === 'approved') return res.status(409).json({ error: 'คำขอนี้อนุมัติไปแล้ว' });

    let request;
    if (status === 'approved') {
      request = await prisma.$transaction(async (tx) => {
        const count = await tx.quickReply.count({ where: { categoryId: existing.categoryId } });
        await tx.quickReply.create({
          data: {
            categoryId: existing.categoryId, kind: existing.kind, name: existing.name,
            content: existing.content, imageData: existing.imageData, order: count,
          },
        });
        return tx.quickReplyRequest.update({
          where: { id: req.params.id },
          data: { status, reviewNote: reviewNote?.trim() || null, reviewedById: req.agent.id, reviewedAt: new Date() },
          include: REQUEST_INCLUDE,
        });
      });
    } else {
      request = await prisma.quickReplyRequest.update({
        where: { id: req.params.id },
        data: { status, reviewNote: reviewNote?.trim() || null, reviewedById: req.agent.id, reviewedAt: new Date() },
        include: REQUEST_INCLUDE,
      });
      // ไม่อนุมัติ is terminal for this image — it will never become a live
      // QuickReply, so the stored file can be cleaned up now instead of
      // sitting orphaned forever. "แก้ไข" (needs_revision) keeps it — the
      // requester's resubmit form still needs it as the current value.
      if (status === 'rejected' && existing.imageData) deleteStoredImage(existing.imageData);
    }

    emitToAll('quick_reply_request_reviewed', { id: request.id, status, requestedById: existing.requestedById });
    res.json(safeRequest(request));
  } catch (err) {
    console.error('Review quick reply request failed:', err.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

// DELETE /api/quick-replies/requests/:id — the requester withdraws their own
// not-yet-approved request (or an admin cleans one up).
router.delete('/requests/:id', auth, async (req, res) => {
  const existing = await prisma.quickReplyRequest.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'ไม่พบคำขอนี้' });
  if (existing.requestedById !== req.agent.id && req.agent.role !== 'admin') {
    return res.status(403).json({ error: 'ยกเลิกได้เฉพาะคำขอของตัวเอง' });
  }
  if (existing.status === 'approved') return res.status(409).json({ error: 'คำขอนี้อนุมัติไปแล้ว ไม่สามารถยกเลิกได้' });
  await prisma.quickReplyRequest.delete({ where: { id: req.params.id } });
  if (existing.imageData) deleteStoredImage(existing.imageData);
  res.status(204).end();
});

// GET /api/quick-replies/requests/:id/image — same public/unauthenticated
// pattern as /:id/image below; the review queue loads this directly as an
// <img src>.
router.get('/requests/:id/image', async (req, res) => {
  const request = await prisma.quickReplyRequest.findUnique({ where: { id: req.params.id }, select: { imageData: true } });
  if (!request?.imageData) return res.status(404).end();
  if (isStoredPath(request.imageData)) {
    const target = req.query.preview ? thumbPathFor(request.imageData) : request.imageData;
    return res.redirect(target);
  }
  const match = /^data:image\/(jpeg|jpg|png|gif|webp);base64,(.+)$/.exec(request.imageData);
  if (!match) return res.status(404).end();
  const [, ext, base64] = match;
  res.set('Content-Type', `image/${ext}`);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Cache-Control', 'private, max-age=3600');
  res.send(Buffer.from(base64, 'base64'));
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
  // Restricted to the same safe raster-image allowlist as new uploads (see
  // imageStorage.js) — this path only still exists for legacy rows written
  // before that allowlist existed. nosniff is extra defense-in-depth on top
  // of that even for an allowed type.
  const match = /^data:image\/(jpeg|jpg|png|gif|webp);base64,(.+)$/.exec(quickReply.imageData);
  if (!match) return res.status(404).end();
  const [, ext, base64] = match;
  res.set('Content-Type', `image/${ext}`);
  res.set('X-Content-Type-Options', 'nosniff');
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
    // Without this, a channel-restricted agent could push a real LINE
    // message into any conversation outside their assigned channels just by
    // knowing/guessing its id — see canAccessChannel's doc comment.
    if (!(await canAccessChannel(req.agent, conversation.channelId))) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
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
    // `conversation` was fetched with the FULL LineChannel row (channel:
    // true, needed above for sendMessage/sendImageMessage's accessToken) —
    // broadcasting it as-is would push channelSecret/accessToken to every
    // connected agent's browser. Redact before it reaches a socket emit.
    const safeConversation = { ...conversation, channel: { id: conversation.channel.id, name: conversation.channel.name, active: conversation.channel.active } };

    for (const message of created) {
      emitToConversation(conversation.id, 'new_message', { message, conversation: safeConversation });
    }
    emitToAll('conversation_updated', { ...safeConversation, lastMessage: created[created.length - 1] });

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
    console.error('Send quick reply failed:', err.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

module.exports = router;
