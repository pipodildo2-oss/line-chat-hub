const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const auth = require('../middleware/auth');
const { emitToConversation, emitToAll } = require('../services/socket.service');
const { sendMessage, sendImageMessage } = require('../services/line.service');
const { saveBase64Image, isStoredPath, thumbPathFor, deleteStoredImage, isValidImageDataUrl } = require('../lib/imageStorage');
const { canAccessChannel } = require('../lib/conversationQuery');
const { clearMessageViewsAfterReply } = require('../lib/messageViewClear');

const prisma = new PrismaClient();

const KINDS = ['reply', 'howto', 'promotion'];
const KIND_ERROR = 'kind ต้องเป็น reply, howto หรือ promotion';
const MAX_IMAGES = 5;
const TOO_MANY_IMAGES_ERROR = `แนบรูปได้สูงสุด ${MAX_IMAGES} รูป`;
const REVIEW_AUDIT_ACTION = { approved: 'request_approved', needs_revision: 'request_needs_revision', rejected: 'request_rejected' };

function requireAdmin(req, res, next) {
  if (req.agent.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// Saves each fresh base64 data URL to disk (see imageStorage.js) — used by
// both the CREATE routes (whole array is new) and the edit/resubmit routes'
// incremental `addImages`. Caller is responsible for validating each entry
// with isValidImageDataUrl first; this only does the actual write.
async function saveImages(dataUrls) {
  const saved = [];
  for (const url of (dataUrls || [])) saved.push((await saveBase64Image(url)) || url);
  return saved;
}

// Splits an existing images[] array into what survives a `removeImageIndexes`
// edit vs. what's now orphaned and needs deleting off disk. Kept as a plain
// helper (not throwing/validating) so each route can decide its own error
// messages around it.
function splitImageEdits(currentImages, removeImageIndexes) {
  const toRemove = new Set(Array.isArray(removeImageIndexes) ? removeImageIndexes.map(Number) : []);
  const kept = currentImages.filter((_, i) => !toRemove.has(i));
  const removed = currentImages.filter((_, i) => toRemove.has(i));
  return { kept, removed };
}

// Never ships raw stored paths/base64 to the client — just how many images
// exist, so the frontend can request each one by index (GET .../image/:index).
// Falls back to the legacy single `imageData` column for rows written before
// the `images` array existed.
function imageMeta(row) {
  const { imageData, images, ...rest } = row;
  const imageCount = images && images.length > 0 ? images.length : (imageData ? 1 : 0);
  return { ...rest, imageCount };
}

// Shared by every image-serving route below (live QuickReply and request,
// legacy bare route and new indexed route alike) — redirects to the stored
// file (or its thumbnail, ?preview=1) for new-style rows, or decodes+streams
// inline for legacy rows that still hold the raw base64 blob.
function respondWithImage(res, storedValueOrDataUrl, preview) {
  if (!storedValueOrDataUrl) return res.status(404).end();
  if (isStoredPath(storedValueOrDataUrl)) {
    return res.redirect(preview ? thumbPathFor(storedValueOrDataUrl) : storedValueOrDataUrl);
  }
  const match = /^data:image\/(jpeg|jpg|png|gif|webp);base64,(.+)$/.exec(storedValueOrDataUrl);
  if (!match) return res.status(404).end();
  const [, ext, base64] = match;
  res.set('Content-Type', `image/${ext}`);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(Buffer.from(base64, 'base64'));
}

// Resolves the image at `index` for a row that may have a populated `images[]`
// array, or (for rows written before it existed) only the legacy single
// `imageData` column — index 0 falls back to that so old rows keep working
// through the same indexed URL the frontend now always uses.
function imageAt(row, index) {
  if (row.images && row.images.length > 0) return row.images[index] ?? null;
  return index === 0 ? row.imageData : null;
}

// Writes one row to the "ประวัติ" audit trail (see schema.prisma's doc
// comment on QuickReplyAuditLog for why this exists separately from
// QuickReplyRequest's own status field). Never lets a logging failure break
// the actual mutation it's describing — awaited inline since these are
// low-volume admin/agent actions, not a hot path, but errors are swallowed.
async function logAudit(action, agent, { itemName, categoryName, detail } = {}) {
  try {
    await prisma.quickReplyAuditLog.create({
      data: {
        action, itemName: itemName || null, categoryName: categoryName || null, detail: detail || null,
        actorId: agent.id, actorName: agent.name,
      },
    });
  } catch (err) {
    console.error('Quick reply audit log failed:', err.message);
  }
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
    await logAudit('category_created', req.agent, { categoryName: category.name });
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
    await logAudit('category_updated', req.agent, { categoryName: category.name });
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
    const existing = await prisma.quickReplyCategory.findUnique({
      where: { id: req.params.id },
      select: { name: true, quickReplies: { select: { imageData: true, images: true } } },
    });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    await prisma.quickReplyCategory.delete({ where: { id: req.params.id } });
    existing.quickReplies.forEach(qr => {
      if (qr.imageData) deleteStoredImage(qr.imageData);
      qr.images.forEach(deleteStoredImage);
    });
    await logAudit('category_deleted', req.agent, {
      categoryName: existing.name,
      detail: existing.quickReplies.length > 0 ? `รวมข้อความลัดในหมวดนี้ที่ถูกลบไปด้วย ${existing.quickReplies.length} รายการ` : null,
    });
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
  const { categoryId, kind, channelId, activeOnly } = req.query;
  const where = {};
  if (categoryId) where.categoryId = categoryId;
  if (kind) where.kind = kind;
  if (channelId) {
    where.category = { channels: { some: { id: channelId } } };
  }
  // Opt-in — the admin catalog view (QuickReplies.jsx) still wants disabled
  // items back so it can show them dimmed with a toggle to re-enable; only
  // the agent-facing Inbox picker asks for this, so it never offers one.
  if (activeOnly === '1') where.active = true;
  const quickReplies = await prisma.quickReply.findMany({
    where,
    include: { category: { select: { id: true, name: true } } },
    orderBy: [{ order: 'asc' }, { name: 'asc' }],
  });
  // Don't ship the full stored paths in list views — just how many images
  // exist. The frontend fetches each one by index via GET /:id/image/:index.
  res.json(quickReplies.map(qr => imageMeta(qr)));
});

// PATCH /api/quick-replies/reorder — any authenticated agent (not admin-only,
// unlike create/edit/delete/toggle below) — reordering doesn't change content,
// so agents are trusted to organize the picker order for their own workflow.
// Body: { categoryId, ids: [...] } (ids listed in the desired display order).
// Sets each item's `order` to its index — this is what controls the order
// agents see them in the Inbox quick-reply picker.
router.patch('/reorder', auth, async (req, res) => {
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
    const { categoryId, kind, name, content, images } = req.body;
    if (!categoryId || !name?.trim() || !content?.trim()) {
      return res.status(400).json({ error: 'categoryId, name and content required' });
    }
    if (kind && !KINDS.includes(kind)) return res.status(400).json({ error: KIND_ERROR });
    if (images !== undefined) {
      if (!Array.isArray(images) || images.length > MAX_IMAGES) return res.status(400).json({ error: TOO_MANY_IMAGES_ERROR });
      for (const img of images) {
        if (!isValidImageDataUrl(img)) return res.status(400).json({ error: 'ไฟล์ที่แนบต้องเป็นรูปภาพ (JPEG/PNG/GIF/WebP) ขนาดไม่เกิน 15MB' });
      }
    }
    // New items go to the end of their category's list by default.
    const [count, category] = await Promise.all([
      prisma.quickReply.count({ where: { categoryId } }),
      prisma.quickReplyCategory.findUnique({ where: { id: categoryId }, select: { name: true } }),
    ]);
    // Write each image to disk instead of storing the base64 blob in Postgres
    // (see imageStorage.js).
    const storedImages = await saveImages(images);
    const quickReply = await prisma.quickReply.create({
      data: { categoryId, kind: kind || 'reply', name: name.trim(), content: content.trim(), images: storedImages, order: count },
    });
    await logAudit('created', req.agent, { itemName: quickReply.name, categoryName: category?.name });
    res.status(201).json(imageMeta(quickReply));
  } catch (err) {
    console.error('Create quick reply failed:', err.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

// PATCH /api/quick-replies/:id — admin only
// Images are edited incrementally, not by resending the whole set: body may
// include `removeImageIndexes` (indexes into the item's CURRENT images[] to
// drop) and/or `addImages` (new base64 data URLs to append). Omitting both
// leaves the images untouched — same "not present = don't touch" convention
// the rest of this route already uses for name/content/etc. This sidesteps
// ever needing to hand the client a real stored path to echo back.
router.patch('/:id', auth, requireAdmin, async (req, res) => {
  try {
    const { name, content, categoryId, kind, active, removeImageIndexes, addImages } = req.body;
    if (kind && !KINDS.includes(kind)) return res.status(400).json({ error: KIND_ERROR });
    if (addImages !== undefined) {
      if (!Array.isArray(addImages)) return res.status(400).json({ error: 'ข้อมูลรูปภาพไม่ถูกต้อง' });
      for (const img of addImages) {
        if (!isValidImageDataUrl(img)) return res.status(400).json({ error: 'ไฟล์ที่แนบต้องเป็นรูปภาพ (JPEG/PNG/GIF/WebP) ขนาดไม่เกิน 15MB' });
      }
    }

    const data = {};
    if (categoryId) data.categoryId = categoryId;
    if (kind) data.kind = kind;
    if (name?.trim()) data.name = name.trim();
    if (content?.trim()) data.content = content.trim();
    // Explicit !== undefined (not truthiness) — `false` is a legitimate value here.
    if (active !== undefined) data.active = !!active;

    let removedFiles = [];
    let legacyImageToClean = null;
    if (removeImageIndexes !== undefined || addImages !== undefined) {
      const existing = await prisma.quickReply.findUnique({ where: { id: req.params.id }, select: { images: true, imageData: true } });
      if (!existing) return res.status(404).json({ error: 'Not found' });
      const { kept, removed } = splitImageEdits(existing.images, removeImageIndexes);
      if (kept.length + (addImages?.length || 0) > MAX_IMAGES) return res.status(400).json({ error: TOO_MANY_IMAGES_ERROR });
      data.images = [...kept, ...(await saveImages(addImages))];
      removedFiles = removed;
      // This row is being actively edited now — fully migrate off the legacy
      // single-image column instead of leaving it dangling alongside `images`.
      if (existing.imageData) { data.imageData = null; legacyImageToClean = existing.imageData; }
    }

    const quickReply = await prisma.quickReply.update({ where: { id: req.params.id }, data });
    removedFiles.forEach(deleteStoredImage);
    if (legacyImageToClean) deleteStoredImage(legacyImageToClean);

    const changedFields = [];
    if (data.name) changedFields.push('ชื่อ');
    if (data.content) changedFields.push('เนื้อหา');
    if (data.kind) changedFields.push('ประเภท');
    if (data.categoryId) changedFields.push('หมวดหมู่');
    if (data.active !== undefined) changedFields.push(data.active ? 'เปิดใช้งาน' : 'ปิดใช้งาน');
    if (removeImageIndexes !== undefined || addImages !== undefined) changedFields.push('รูปภาพ');
    const category = await prisma.quickReplyCategory.findUnique({ where: { id: quickReply.categoryId }, select: { name: true } });
    await logAudit('updated', req.agent, {
      itemName: quickReply.name, categoryName: category?.name,
      detail: changedFields.length > 0 ? `แก้ไข: ${changedFields.join(', ')}` : null,
    });
    res.json(imageMeta(quickReply));
  } catch {
    res.status(404).json({ error: 'Not found' });
  }
});

// DELETE /api/quick-replies/:id — admin only
router.delete('/:id', auth, requireAdmin, async (req, res) => {
  try {
    const quickReply = await prisma.quickReply.delete({
      where: { id: req.params.id },
      include: { category: { select: { name: true } } },
    });
    // Clean up the associated image files off disk — Prisma only removes the DB
    // row, so without this the files would sit orphaned in the uploads volume forever.
    if (quickReply.imageData) deleteStoredImage(quickReply.imageData);
    quickReply.images.forEach(deleteStoredImage);
    await logAudit('deleted', req.agent, { itemName: quickReply.name, categoryName: quickReply.category?.name });
    res.status(204).end();
  } catch {
    res.status(404).json({ error: 'Not found' });
  }
});

// ---------- Quick Reply Requests ("คำขอเพิ่ม/ลบข้อความลัด") ----------
// A non-admin agent can't create OR delete a QuickReply directly (POST / and
// DELETE /:id above are both requireAdmin) — they submit a request here
// instead, which sits pending until an admin reviews it
// (อนุมัติ/แก้ไข/ไม่อนุมัติ). Only approval actually changes anything live
// (creates a QuickReply for a "create" request, deletes one for a "delete"
// request); "แก้ไข" sends it back to the ORIGINAL REQUESTER to fix and
// resubmit, it doesn't mean the admin edits it themselves — see PATCH
// /requests/:id below. "แก้ไข" doesn't apply to delete requests (see POST
// /:id/delete-request and the review route below).

const REQUEST_INCLUDE = {
  category: { select: { id: true, name: true } },
  requestedBy: { select: { id: true, name: true } },
  reviewedBy: { select: { id: true, name: true } },
};

// Same imageCount convention as the live QuickReply list above.
function safeRequest(r) {
  return imageMeta(r);
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
    const { categoryId, kind, name, content, images } = req.body;
    if (!categoryId || !name?.trim() || !content?.trim()) {
      return res.status(400).json({ error: 'กรุณาเลือกหมวดหมู่และกรอกชื่อ/รายละเอียดข้อความ' });
    }
    if (kind && !KINDS.includes(kind)) return res.status(400).json({ error: KIND_ERROR });
    if (images !== undefined) {
      if (!Array.isArray(images) || images.length > MAX_IMAGES) return res.status(400).json({ error: TOO_MANY_IMAGES_ERROR });
      for (const img of images) {
        if (!isValidImageDataUrl(img)) return res.status(400).json({ error: 'ไฟล์ที่แนบต้องเป็นรูปภาพ (JPEG/PNG/GIF/WebP) ขนาดไม่เกิน 15MB' });
      }
    }
    const storedImages = await saveImages(images);
    const request = await prisma.quickReplyRequest.create({
      data: {
        categoryId, kind: kind || 'reply', name: name.trim(), content: content.trim(),
        images: storedImages, requestedById: req.agent.id,
      },
      include: REQUEST_INCLUDE,
    });
    await logAudit('request_submitted', req.agent, { itemName: request.name, categoryName: request.category.name });
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

    const { categoryId, kind, name, content, removeImageIndexes, addImages } = req.body;
    if (kind && !KINDS.includes(kind)) return res.status(400).json({ error: KIND_ERROR });
    if (addImages !== undefined) {
      if (!Array.isArray(addImages)) return res.status(400).json({ error: 'ข้อมูลรูปภาพไม่ถูกต้อง' });
      for (const img of addImages) {
        if (!isValidImageDataUrl(img)) return res.status(400).json({ error: 'ไฟล์ที่แนบต้องเป็นรูปภาพ (JPEG/PNG/GIF/WebP) ขนาดไม่เกิน 15MB' });
      }
    }
    const data = { status: 'pending', reviewedById: null, reviewedAt: null, reviewNote: null };
    if (categoryId) data.categoryId = categoryId;
    if (kind) data.kind = kind;
    if (name?.trim()) data.name = name.trim();
    if (content?.trim()) data.content = content.trim();
    // Same "diff against the current set, clean up what falls out" pattern as
    // PATCH /:id above — otherwise every resubmit leaves orphaned files behind.
    let removedFiles = [];
    let legacyImageToClean = null;
    if (removeImageIndexes !== undefined || addImages !== undefined) {
      const { kept, removed } = splitImageEdits(existing.images, removeImageIndexes);
      if (kept.length + (addImages?.length || 0) > MAX_IMAGES) return res.status(400).json({ error: TOO_MANY_IMAGES_ERROR });
      data.images = [...kept, ...(await saveImages(addImages))];
      removedFiles = removed;
      if (existing.imageData) { data.imageData = null; legacyImageToClean = existing.imageData; }
    }
    const updated = await prisma.quickReplyRequest.update({ where: { id: req.params.id }, data, include: REQUEST_INCLUDE });
    removedFiles.forEach(deleteStoredImage);
    if (legacyImageToClean) deleteStoredImage(legacyImageToClean);
    await logAudit('request_resubmitted', req.agent, { itemName: updated.name, categoryName: updated.category.name });
    emitToAll('quick_reply_request_created', { id: updated.id, requestedById: req.agent.id, requestedByName: req.agent.name });
    res.json(safeRequest(updated));
  } catch (err) {
    console.error('Resubmit quick reply request failed:', err.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

// POST /api/quick-replies/:id/delete-request — any authenticated agent,
// requests deletion of an existing, LIVE QuickReply (agents have no other way
// to remove one — DELETE /:id above is requireAdmin). Snapshots the item's
// current fields onto the request row (so the review card can render it
// without a join) but does NOT copy its image files — images/imageData just
// reference the same stored paths the live item still owns, since approval
// deletes that live item directly rather than creating a new one from the copy.
router.post('/:id/delete-request', auth, async (req, res) => {
  try {
    const quickReply = await prisma.quickReply.findUnique({
      where: { id: req.params.id },
      include: { category: { select: { name: true } } },
    });
    if (!quickReply) return res.status(404).json({ error: 'ไม่พบข้อความลัดนี้' });

    const duplicate = await prisma.quickReplyRequest.findFirst({
      where: { targetQuickReplyId: quickReply.id, type: 'delete', status: { in: ['pending', 'needs_revision'] } },
    });
    if (duplicate) return res.status(409).json({ error: 'มีคำขอลบข้อความลัดนี้อยู่แล้ว รอแอดมินตรวจสอบ' });

    const request = await prisma.quickReplyRequest.create({
      data: {
        type: 'delete',
        targetQuickReplyId: quickReply.id,
        categoryId: quickReply.categoryId,
        kind: quickReply.kind,
        name: quickReply.name,
        content: quickReply.content,
        imageData: quickReply.imageData,
        images: quickReply.images,
        requestedById: req.agent.id,
      },
      include: REQUEST_INCLUDE,
    });
    await logAudit('request_submitted', req.agent, {
      itemName: request.name, categoryName: quickReply.category?.name, detail: 'คำขอลบข้อความลัด',
    });
    emitToAll('quick_reply_request_created', { id: request.id, requestedById: req.agent.id, requestedByName: req.agent.name });
    res.status(201).json(safeRequest(request));
  } catch (err) {
    console.error('Create quick reply delete request failed:', err.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

// PATCH /api/quick-replies/requests/:id/review — admin only: อนุมัติ / แก้ไข / ไม่อนุมัติ.
// Approving is the only path that actually changes something live —
// creating a QuickReply for a "create" request, deleting one for a "delete"
// request — everything else just updates the request's own status. "แก้ไข"
// doesn't make sense for a delete request (there's nothing to revise), so
// it's rejected below.
router.patch('/requests/:id/review', auth, requireAdmin, async (req, res) => {
  try {
    const { status, reviewNote } = req.body;
    if (!['approved', 'needs_revision', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'สถานะไม่ถูกต้อง' });
    }
    const existing = await prisma.quickReplyRequest.findUnique({ where: { id: req.params.id }, include: REQUEST_INCLUDE });
    if (!existing) return res.status(404).json({ error: 'ไม่พบคำขอนี้' });
    if (existing.status === 'approved') return res.status(409).json({ error: 'คำขอนี้อนุมัติไปแล้ว' });
    if (existing.type === 'delete' && status === 'needs_revision') {
      return res.status(400).json({ error: 'คำขอลบไม่สามารถส่งกลับให้แก้ไขได้ กรุณาอนุมัติหรือไม่อนุมัติ' });
    }

    let request;
    let deletedTarget = null; // set only when a "delete" request is approved — cleaned up after the transaction below
    if (status === 'approved') {
      if (existing.type === 'delete') {
        deletedTarget = await prisma.quickReply.findUnique({ where: { id: existing.targetQuickReplyId } });
        request = await prisma.$transaction(async (tx) => {
          if (deletedTarget) await tx.quickReply.delete({ where: { id: deletedTarget.id } });
          return tx.quickReplyRequest.update({
            where: { id: req.params.id },
            data: { status, reviewNote: reviewNote?.trim() || null, reviewedById: req.agent.id, reviewedAt: new Date() },
            include: REQUEST_INCLUDE,
          });
        });
      } else {
        request = await prisma.$transaction(async (tx) => {
          const count = await tx.quickReply.count({ where: { categoryId: existing.categoryId } });
          await tx.quickReply.create({
            data: {
              categoryId: existing.categoryId, kind: existing.kind, name: existing.name,
              content: existing.content, imageData: existing.imageData, images: existing.images, order: count,
            },
          });
          return tx.quickReplyRequest.update({
            where: { id: req.params.id },
            data: { status, reviewNote: reviewNote?.trim() || null, reviewedById: req.agent.id, reviewedAt: new Date() },
            include: REQUEST_INCLUDE,
          });
        });
      }
    } else {
      request = await prisma.quickReplyRequest.update({
        where: { id: req.params.id },
        data: { status, reviewNote: reviewNote?.trim() || null, reviewedById: req.agent.id, reviewedAt: new Date() },
        include: REQUEST_INCLUDE,
      });
      // ไม่อนุมัติ is terminal for this image — it will never become a live
      // QuickReply, so the stored file can be cleaned up now instead of
      // sitting orphaned forever. "แก้ไข" (needs_revision) keeps it — the
      // requester's resubmit form still needs it as the current value. Never
      // for a "delete" request, though — its images/imageData are the same
      // stored files the live QuickReply still owns, not a private copy.
      if (status === 'rejected' && existing.type !== 'delete') {
        if (existing.imageData) deleteStoredImage(existing.imageData);
        existing.images.forEach(deleteStoredImage);
      }
    }

    // The real cleanup for an approved delete request — the live QuickReply's
    // own image files — happens here, once the delete itself has committed.
    if (deletedTarget) {
      if (deletedTarget.imageData) deleteStoredImage(deletedTarget.imageData);
      deletedTarget.images.forEach(deleteStoredImage);
    }

    await logAudit(REVIEW_AUDIT_ACTION[status], req.agent, {
      itemName: existing.name,
      categoryName: existing.category.name,
      detail: `${existing.type === 'delete' ? 'คำขอลบข้อความลัด — ' : ''}คำขอของ ${existing.requestedBy.name}${reviewNote?.trim() ? ` — เหตุผล: ${reviewNote.trim()}` : ''}`,
    });
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
  const existing = await prisma.quickReplyRequest.findUnique({ where: { id: req.params.id }, include: REQUEST_INCLUDE });
  if (!existing) return res.status(404).json({ error: 'ไม่พบคำขอนี้' });
  const isOwner = existing.requestedById === req.agent.id;
  if (!isOwner && req.agent.role !== 'admin') {
    return res.status(403).json({ error: 'ยกเลิกได้เฉพาะคำขอของตัวเอง' });
  }
  if (existing.status === 'approved') return res.status(409).json({ error: 'คำขอนี้อนุมัติไปแล้ว ไม่สามารถยกเลิกได้' });
  await prisma.quickReplyRequest.delete({ where: { id: req.params.id } });
  // Same reasoning as the rejected-cleanup branch in the review route above —
  // a "delete" request's images are the live QuickReply's own files, not a
  // private copy, so withdrawing it must leave them alone.
  if (existing.type !== 'delete') {
    if (existing.imageData) deleteStoredImage(existing.imageData);
    existing.images.forEach(deleteStoredImage);
  }
  await logAudit('request_withdrawn', req.agent, {
    itemName: existing.name,
    categoryName: existing.category.name,
    detail: isOwner ? null : `ยกเลิกโดยแอดมิน (เจ้าของคำขอ: ${existing.requestedBy.name})`,
  });
  res.status(204).end();
});

// ---------- "ประวัติ" audit log ----------

// GET /api/quick-replies/audit-log?action= — admin only. Every recorded
// action across the whole Quick Replies feature (catalog CRUD + request
// lifecycle), newest first — see QuickReplyAuditLog's doc comment in
// schema.prisma for why this is a separate append-only table rather than
// reading QuickReplyRequest's current status.
router.get('/audit-log', auth, requireAdmin, async (req, res) => {
  const { action } = req.query;
  const where = {};
  if (action) where.action = action;
  const logs = await prisma.quickReplyAuditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  res.json(logs);
});

// GET /api/quick-replies/requests/:id/image — legacy bare route, kept
// unchanged for backward compatibility. New code (the review queue, the
// resubmit form) uses the indexed route below instead.
router.get('/requests/:id/image', async (req, res) => {
  const request = await prisma.quickReplyRequest.findUnique({ where: { id: req.params.id }, select: { imageData: true } });
  respondWithImage(res, request?.imageData, !!req.query.preview);
});

// GET /api/quick-replies/requests/:id/image/:index — up to MAX_IMAGES per
// request, same public/unauthenticated pattern as the live-QuickReply route
// below (the review queue loads these directly as <img src>).
router.get('/requests/:id/image/:index', async (req, res) => {
  const request = await prisma.quickReplyRequest.findUnique({ where: { id: req.params.id }, select: { imageData: true, images: true } });
  if (!request) return res.status(404).end();
  respondWithImage(res, imageAt(request, Number(req.params.index)), !!req.query.preview);
});

// GET /api/quick-replies/:id/image — intentionally NOT behind `auth`.
// LINE's own servers fetch this URL directly (as originalContentUrl/previewImageUrl)
// when we push a quick reply's FIRST image, so it must stay publicly reachable
// exactly as-is — legacy bare route, kept unchanged for backward compatibility
// with anything already baked into a previously-sent LINE message. New code
// uses the indexed route below instead.
router.get('/:id/image', async (req, res) => {
  const quickReply = await prisma.quickReply.findUnique({ where: { id: req.params.id }, select: { imageData: true } });
  respondWithImage(res, quickReply?.imageData, !!req.query.preview);
});

// GET /api/quick-replies/:id/image/:index — up to MAX_IMAGES per item. `index`
// 0 falls back to the legacy `imageData` column for rows written before
// `images` existed, so this one URL shape covers both old and new rows —
// the frontend never needs to special-case which route a given item needs.
router.get('/:id/image/:index', async (req, res) => {
  const quickReply = await prisma.quickReply.findUnique({ where: { id: req.params.id }, select: { imageData: true, images: true } });
  if (!quickReply) return res.status(404).end();
  respondWithImage(res, imageAt(quickReply, Number(req.params.index)), !!req.query.preview);
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
    if (quickReply.active === false) {
      return res.status(409).json({ error: 'ข้อความลัดนี้ถูกปิดใช้งานอยู่' });
    }
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
    // Each image (up to MAX_IMAGES) and the text are separate LINE pushes —
    // sent one at a time, stopping at the first failure. sendErr tracks
    // whichever push failed so the response below can tell the agent exactly
    // what did and didn't go out, instead of either (a) throwing away images
    // that legitimately DID send because a later push errored, or (b) silently
    // treating "partially sent" the same as "fully sent."
    let sendErr = null;
    const imageCount = quickReply.images.length > 0 ? quickReply.images.length : (quickReply.imageData ? 1 : 0);

    for (let i = 0; i < imageCount && !sendErr; i++) {
      const imageUrl = `${req.protocol}://${req.get('host')}/api/quick-replies/${quickReply.id}/image/${i}`;
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
        sendErr = err; // this image push failed — earlier ones (if any) already sent and are recorded above
      }
    }

    // Only attempt the text half if every image (when there are any) actually
    // went out — if one failed, stop here rather than sending the text alone,
    // which would leave a caption with missing images and confuse the customer.
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
      if (sendErr.isQuotaExceeded) return res.status(429).json({ error: sendErr.message, quotaExceeded: true });
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
      res.status(207).json({ messages: created, partial: true, error: sendErr.message, uncertain: !!sendErr.isSendTimeout, quotaExceeded: !!sendErr.isQuotaExceeded });
    } else {
      res.status(201).json({ messages: created });
    }

    // An outgoing message (even a canned quick reply) clears this agent's own
    // audit-trail tags across the WHOLE conversation — same rule as a normal
    // typed reply. Fire-and-forget after the response: this is bookkeeping,
    // not confirmation the agent needs before seeing their message went through.
    prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: now } })
      .catch(e => console.error('lastMessageAt update failed (message already sent+recorded):', e.message));
    clearMessageViewsAfterReply({ conversationId: conversation.id, agentId: req.agent.id, repliedAt: now })
      .catch(e => console.error('messageView cleanup failed (message already sent+recorded):', e.message));
  } catch (err) {
    console.error('Send quick reply failed:', err.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
  }
});

module.exports = router;
