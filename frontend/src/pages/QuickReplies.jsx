import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Plus, Trash2, Pencil, X, ImagePlus, ChevronUp, ChevronDown, Zap, ClipboardList } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';

const MAX_IMAGES = 5;

// Handles both a brand-new item (existingUrls=[]) and editing one (existing
// images shown for reference, individually removable via onToggleRemove).
// New picks are read as base64 data URLs into `newImages` — the parent
// decides how to turn removedIndexes/newImages into a payload (a plain
// `images` array on create, `removeImageIndexes`/`addImages` on edit).
function MultiImagePicker({ existingUrls = [], removedIndexes = new Set(), onToggleRemove, newImages, setNewImages }) {
  const keptCount = existingUrls.length - removedIndexes.size;
  const total = keptCount + newImages.length;

  function handleFiles(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    const remaining = MAX_IMAGES - total;
    files.slice(0, remaining).forEach(file => {
      const reader = new FileReader();
      reader.onload = () => setNewImages(prev => prev.length >= MAX_IMAGES ? prev : [...prev, reader.result].slice(0, MAX_IMAGES));
      reader.readAsDataURL(file);
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {existingUrls.map((url, i) => !removedIndexes.has(i) && (
        <div key={`existing-${i}`} className="relative">
          <img src={url} alt="" className="w-16 h-16 rounded-lg object-cover border border-slate-700" />
          <button
            type="button"
            onClick={() => onToggleRemove(i)}
            className="absolute -top-1.5 -right-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-full w-4 h-4 flex items-center justify-center"
          >
            <X size={10} />
          </button>
        </div>
      ))}
      {newImages.map((url, i) => (
        <div key={`new-${i}`} className="relative">
          <img src={url} alt="" className="w-16 h-16 rounded-lg object-cover border border-slate-700" />
          <button
            type="button"
            onClick={() => setNewImages(prev => prev.filter((_, idx) => idx !== i))}
            className="absolute -top-1.5 -right-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-full w-4 h-4 flex items-center justify-center"
          >
            <X size={10} />
          </button>
        </div>
      ))}
      {total < MAX_IMAGES && (
        <label className="w-16 h-16 flex flex-col items-center justify-center gap-0.5 border border-dashed border-slate-700 rounded-lg cursor-pointer hover:border-aurora-teal text-slate-500 hover:text-aurora-teal transition-colors">
          <ImagePlus size={16} />
          <span className="text-[9px]">{total}/{MAX_IMAGES}</span>
          <input type="file" accept="image/*" multiple className="hidden" onChange={handleFiles} />
        </label>
      )}
    </div>
  );
}

const QR_KIND_OPTIONS = [
  { key: 'reply', label: 'ตอบกลับ' },
  { key: 'howto', label: 'วิธีการ' },
  { key: 'promotion', label: 'โปรโมชั่น' },
];
const qrKindLabel = (kind) => QR_KIND_OPTIONS.find(k => k.key === kind)?.label || kind;

// Small "+N" badge overlaid on a thumbnail when an item has more than one
// image attached, so the catalog/request lists hint at the extra images
// without needing to open the item.
function ExtraImagesBadge({ count }) {
  if (count <= 1) return null;
  return (
    <span className="absolute -bottom-1 -right-1 bg-slate-950 text-slate-200 text-[9px] font-semibold rounded-full px-1 min-w-[16px] text-center border border-slate-700">
      +{count - 1}
    </span>
  );
}

function QuickReplyEditModal({ item, onSave, onClose }) {
  const [name, setName] = useState(item.name);
  const [kind, setKind] = useState(item.kind || 'reply');
  const [content, setContent] = useState(item.content);
  const existingUrls = Array.from({ length: item.imageCount || 0 }, (_, i) => `/api/quick-replies/${item.id}/image/${i}`);
  const [removedIndexes, setRemovedIndexes] = useState(new Set());
  const [newImages, setNewImages] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fieldCls = 'w-full border border-slate-700 bg-slate-800 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-aurora-teal placeholder:text-slate-500';
  const labelCls = 'text-xs font-medium text-slate-400 mb-1.5 block';

  function toggleRemove(i) {
    setRemovedIndexes(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

  async function handleSave() {
    if (!name.trim() || !content.trim()) { setError('กรอกชื่อและรายละเอียดข้อความให้ครบ'); return; }
    setSaving(true); setError('');
    try {
      const payload = { name, content, kind };
      // Only sent if the user actually touched images (removed and/or added) —
      // matches the "not present = don't touch" convention the backend uses.
      if (removedIndexes.size > 0 || newImages.length > 0) {
        payload.removeImageIndexes = Array.from(removedIndexes);
        payload.addImages = newImages;
      }
      await onSave(item.id, payload);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'เกิดข้อผิดพลาด');
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-slate-100">แก้ไขข้อความลัด</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300"><X size={18} /></button>
        </div>
        {error && <div className="bg-rose-500/10 text-rose-400 text-sm px-3 py-2 rounded-lg mb-3">{error}</div>}
        <div className="space-y-3">
          <div>
            <label className={labelCls}>ประเภท</label>
            <div className="flex gap-2">
              {QR_KIND_OPTIONS.map(opt => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setKind(opt.key)}
                  className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${kind === opt.key ? 'bg-aurora-teal/15 border-aurora-teal text-aurora-teal' : 'border-slate-700 text-slate-300 hover:border-slate-500'}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className={labelCls}>ชื่อข้อความ</label>
            <input className={fieldCls} value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>รายละเอียดข้อความ</label>
            <textarea className={fieldCls} rows={4} value={content} onChange={e => setContent(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>รูปภาพ (สูงสุด {MAX_IMAGES} รูป)</label>
            <MultiImagePicker
              existingUrls={existingUrls}
              removedIndexes={removedIndexes}
              onToggleRemove={toggleRemove}
              newImages={newImages}
              setNewImages={setNewImages}
            />
          </div>
        </div>
        <div className="flex items-center gap-3 mt-5">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-gradient-to-r from-aurora-teal to-aurora-purple text-white rounded-lg px-4 py-2 text-sm font-medium hover:brightness-110 disabled:opacity-50 transition-all"
          >
            บันทึก
          </button>
          <button onClick={onClose} className="text-sm text-slate-400 hover:text-slate-200 px-4 py-2">ยกเลิก</button>
        </div>
      </div>
    </div>
  );
}

// 1. เลือกหมวดหมู่ = หมวดที่แอดมินพิมพ์สร้างเอง แล้วเลือกได้ว่าจะให้แสดงกับไลน์ OA ไหนบ้าง
//    (ไม่เลือกไลน์เลย = แสดงกับทุกไลน์)
// 2. เลือกประเภท = ตอบกลับ / วิธีการ / โปรโมชั่น
// 3-5. ตั้งชื่อ/รายละเอียด/รูปภาพของข้อความลัดแต่ละอัน
// Category CRUD and existing-item reorder/edit/delete stay isAdmin-only, but any
// authenticated agent can browse categories and submit a NEW quick reply — for a
// non-admin that submission goes through /requests instead of landing live, see
// addQuickReply below.
function QuickReplyCatalog({ isAdmin, channels }) {
  const [categories, setCategories] = useState([]);
  const [categoryId, setCategoryId] = useState('');
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [quickReplies, setQuickReplies] = useState([]);
  const [loadingReplies, setLoadingReplies] = useState(false);
  const [categoryForm, setCategoryForm] = useState(null); // { id: null|string, name, channelIds }
  const [savingCategory, setSavingCategory] = useState(false);
  const [showAddQr, setShowAddQr] = useState(false);
  const [qrForm, setQrForm] = useState({ kind: 'reply', name: '', content: '' });
  const [qrImages, setQrImages] = useState([]);
  const [savingQr, setSavingQr] = useState(false);
  const [requestSubmitted, setRequestSubmitted] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [error, setError] = useState('');

  function loadCategories() {
    setLoadingCategories(true);
    return axios.get('/api/quick-replies/categories')
      .then(r => {
        setCategories(r.data);
        if (r.data.length > 0) setCategoryId(prev => prev || r.data[0].id);
        return r.data;
      })
      .finally(() => setLoadingCategories(false));
  }

  useEffect(() => { loadCategories(); }, []);

  useEffect(() => {
    if (!categoryId) { setQuickReplies([]); return; }
    setLoadingReplies(true);
    axios.get('/api/quick-replies', { params: { categoryId } })
      .then(r => setQuickReplies(r.data))
      .finally(() => setLoadingReplies(false));
  }, [categoryId]);

  function openAddCategory() {
    setCategoryForm({ id: null, name: '', channelIds: [] });
  }

  function openEditCategory(cat) {
    setCategoryForm({ id: cat.id, name: cat.name, channelIds: (cat.channels || []).map(c => c.id) });
  }

  function toggleFormChannel(id) {
    setCategoryForm(f => ({
      ...f,
      channelIds: f.channelIds.includes(id) ? f.channelIds.filter(x => x !== id) : [...f.channelIds, id],
    }));
  }

  async function submitCategoryForm(e) {
    e.preventDefault();
    if (!categoryForm.name.trim()) return;
    setSavingCategory(true); setError('');
    try {
      if (categoryForm.id) {
        await axios.patch(`/api/quick-replies/categories/${categoryForm.id}`, {
          name: categoryForm.name.trim(),
          channelIds: categoryForm.channelIds,
        });
      } else {
        const { data } = await axios.post('/api/quick-replies/categories', {
          name: categoryForm.name.trim(),
          channelIds: categoryForm.channelIds,
        });
        setCategoryId(data.id);
      }
      await loadCategories();
      setCategoryForm(null);
    } catch (err) {
      setError(err.response?.data?.error || 'เกิดข้อผิดพลาด');
    } finally { setSavingCategory(false); }
  }

  async function deleteCategory(id) {
    if (!confirm('ลบหมวดหมู่นี้? ข้อความลัดทั้งหมดในหมวดนี้จะถูกลบไปด้วย')) return;
    await axios.delete(`/api/quick-replies/categories/${id}`);
    setCategories(prev => prev.filter(c => c.id !== id));
    if (categoryId === id) setCategoryId('');
  }

  async function addQuickReply(e) {
    e.preventDefault();
    if (!qrForm.name.trim() || !qrForm.content.trim()) return;
    setSavingQr(true); setError('');
    try {
      if (isAdmin) {
        const { data } = await axios.post('/api/quick-replies', { categoryId, ...qrForm, images: qrImages });
        setQuickReplies(prev => [...prev, data]);
        setCategories(prev => prev.map(c => c.id === categoryId ? { ...c, _count: { quickReplies: (c._count?.quickReplies || 0) + 1 } } : c));
      } else {
        await axios.post('/api/quick-replies/requests', { categoryId, ...qrForm, images: qrImages });
        setRequestSubmitted(true);
        setTimeout(() => setRequestSubmitted(false), 5000);
      }
      setQrForm({ kind: 'reply', name: '', content: '' });
      setQrImages([]);
      setShowAddQr(false);
    } catch (err) {
      setError(err.response?.data?.error || 'เกิดข้อผิดพลาด');
    } finally { setSavingQr(false); }
  }

  async function saveQuickReplyEdit(id, fields) {
    const { data } = await axios.patch(`/api/quick-replies/${id}`, fields);
    setQuickReplies(prev => prev.map(q => q.id === id ? data : q));
  }

  async function deleteQuickReply(id) {
    if (!confirm('ลบข้อความลัดนี้?')) return;
    await axios.delete(`/api/quick-replies/${id}`);
    setQuickReplies(prev => prev.filter(q => q.id !== id));
    setCategories(prev => prev.map(c => c.id === categoryId ? { ...c, _count: { quickReplies: Math.max(0, (c._count?.quickReplies || 1) - 1) } } : c));
  }

  // Swaps qr with its neighbor above/below, updates the list order shown here,
  // and persists the new order so it's what agents see in the Inbox picker too.
  async function moveQuickReply(id, direction) {
    const index = quickReplies.findIndex(q => q.id === id);
    const swapWith = direction === 'up' ? index - 1 : index + 1;
    if (index === -1 || swapWith < 0 || swapWith >= quickReplies.length) return;
    const next = [...quickReplies];
    [next[index], next[swapWith]] = [next[swapWith], next[index]];
    setQuickReplies(next);
    try {
      await axios.patch('/api/quick-replies/reorder', { ids: next.map(q => q.id) });
    } catch {
      setQuickReplies(quickReplies); // revert on failure
    }
  }

  const inputCls = 'w-full border border-slate-700 bg-slate-800 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-aurora-teal placeholder:text-slate-500';
  const cardCls = 'bg-slate-900 border border-slate-800 rounded-xl p-4';

  return (
    <div className="max-w-3xl space-y-5">
      {error && <div className="bg-rose-500/10 text-rose-400 text-sm px-4 py-2 rounded-lg">{error}</div>}

      {/* 1. เลือกหมวดหมู่ (สร้างเองโดยพิมพ์ + เลือกไลน์ OA ที่จะแสดง) */}
      <div>
        <label className="text-xs font-medium text-slate-400 mb-1.5 block">1. เลือกหมวดหมู่</label>
        <div className="flex flex-wrap gap-2 items-center">
          {loadingCategories && <span className="text-sm text-slate-500">กำลังโหลด...</span>}
          {!loadingCategories && categories.map(c => (
            <button
              key={c.id}
              onClick={() => setCategoryId(c.id)}
              className={`group flex items-center gap-1.5 rounded-full pl-3 pr-2 py-1.5 text-sm font-medium border transition-colors ${
                categoryId === c.id
                  ? 'bg-aurora-teal/15 border-aurora-teal text-aurora-teal'
                  : 'border-slate-700 text-slate-300 hover:border-slate-500'
              }`}
            >
              {c.name}
              <span className="text-xs opacity-60">({c._count?.quickReplies ?? 0})</span>
              {c.channels?.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-400">{c.channels.length} ไลน์</span>
              )}
              {isAdmin && (
                <>
                  <span
                    role="button"
                    onClick={(e) => { e.stopPropagation(); openEditCategory(c); }}
                    className="opacity-0 group-hover:opacity-100 hover:text-slate-100 w-4 h-4 flex items-center justify-center"
                  >
                    <Pencil size={11} />
                  </span>
                  <span
                    role="button"
                    onClick={(e) => { e.stopPropagation(); deleteCategory(c.id); }}
                    className="opacity-0 group-hover:opacity-100 hover:text-rose-400 w-4 h-4 flex items-center justify-center"
                  >
                    <X size={12} />
                  </span>
                </>
              )}
            </button>
          ))}
          {!loadingCategories && categories.length === 0 && <span className="text-sm text-slate-500">ยังไม่มีหมวดหมู่</span>}
          {isAdmin && !categoryForm && (
            <button onClick={openAddCategory} className="flex items-center gap-1 text-sm text-aurora-teal hover:brightness-110 font-medium">
              <Plus size={14} /> เพิ่มหมวดหมู่
            </button>
          )}
        </div>

        {isAdmin && categoryForm && (
          <form onSubmit={submitCategoryForm} className={`${cardCls} space-y-3 mt-3 max-w-sm`}>
            <h3 className="font-medium text-slate-100 text-sm">{categoryForm.id ? 'แก้ไขหมวดหมู่' : 'เพิ่มหมวดหมู่'}</h3>
            <div>
              <label className="text-xs font-medium text-slate-400 mb-1.5 block">ชื่อหมวดหมู่</label>
              <input
                autoFocus
                className={inputCls}
                placeholder="เช่น ทักทายลูกค้า"
                value={categoryForm.name}
                onChange={e => setCategoryForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 mb-1.5 block">เลือกไลน์ OA ที่จะแสดงหมวดหมู่นี้</label>
              <div className="border border-slate-700 rounded-lg p-2 space-y-1 max-h-36 overflow-y-auto">
                {channels.map(ch => (
                  <label key={ch.id} className="flex items-center gap-2 text-sm px-1.5 py-1 rounded hover:bg-slate-800 cursor-pointer text-slate-200">
                    <input
                      type="checkbox"
                      className="accent-aurora-teal"
                      checked={categoryForm.channelIds.includes(ch.id)}
                      onChange={() => toggleFormChannel(ch.id)}
                    />
                    {ch.name}
                  </label>
                ))}
                {channels.length === 0 && <p className="text-xs text-slate-500 px-1.5 py-1">ยังไม่มีช่องทาง</p>}
              </div>
              <p className="text-[11px] text-slate-500 mt-1">ไม่เลือก = ยังไม่แสดงกับไลน์ไหนเลย (ต้องเลือกอย่างน้อย 1 ไลน์ก่อนถึงจะขึ้น)</p>
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={savingCategory} className="bg-gradient-to-r from-aurora-teal to-aurora-purple text-white rounded-lg px-4 py-2 text-sm hover:brightness-110 disabled:opacity-50">บันทึก</button>
              <button type="button" onClick={() => setCategoryForm(null)} className="text-sm text-slate-400 hover:text-slate-200 px-4 py-2">ยกเลิก</button>
            </div>
          </form>
        )}
      </div>

      {/* 2-5. รายการข้อความลัดในหมวดหมู่ที่เลือก */}
      {categoryId && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs font-medium text-slate-400">ข้อความลัดในหมวดหมู่นี้</label>
            {!showAddQr && (
              <button
                onClick={() => setShowAddQr(true)}
                className="flex items-center gap-1.5 text-sm text-aurora-teal font-medium border border-aurora-teal/40 rounded-lg px-3 py-1.5 hover:bg-aurora-teal/10 transition-colors"
              >
                <Plus size={14} /> {isAdmin ? 'เพิ่มข้อความลัด' : 'ขอเพิ่มข้อความลัด'}
              </button>
            )}
          </div>

          {showAddQr && (
            <form onSubmit={addQuickReply} className={`${cardCls} space-y-3`}>
              <h3 className="font-medium text-slate-100">{isAdmin ? 'เพิ่มข้อความลัด' : 'ขอเพิ่มข้อความลัด'}</h3>
              {!isAdmin && (
                <p className="text-xs text-slate-400 bg-slate-800/60 rounded-lg px-3 py-2">
                  ข้อความที่คุณเพิ่มจะถูกส่งเป็นคำขอ รอแอดมินตรวจสอบและอนุมัติก่อน ถึงจะใช้งานได้จริง — ดูสถานะได้ที่แท็บ "คำขอ"
                </p>
              )}
              <div>
                <label className="text-xs font-medium text-slate-400 mb-1.5 block">เลือกประเภท</label>
                <div className="flex gap-2">
                  {QR_KIND_OPTIONS.map(opt => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setQrForm(f => ({ ...f, kind: opt.key }))}
                      className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${qrForm.kind === opt.key ? 'bg-aurora-teal/15 border-aurora-teal text-aurora-teal' : 'border-slate-700 text-slate-300 hover:border-slate-500'}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-400 mb-1.5 block">ตั้งชื่อข้อความ</label>
                <input className={inputCls} placeholder="เช่น ทักทายลูกค้าใหม่" value={qrForm.name} onChange={e => setQrForm(f => ({ ...f, name: e.target.value }))} required />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-400 mb-1.5 block">รายละเอียดข้อความ</label>
                <textarea className={inputCls} rows={3} placeholder="ข้อความที่จะส่งให้ลูกค้า" value={qrForm.content} onChange={e => setQrForm(f => ({ ...f, content: e.target.value }))} required />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-400 mb-1.5 block">แนบรูปภาพ (สูงสุด {MAX_IMAGES} รูป)</label>
                <MultiImagePicker newImages={qrImages} setNewImages={setQrImages} />
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={savingQr} className="bg-gradient-to-r from-aurora-teal to-aurora-purple text-white rounded-lg px-4 py-2 text-sm hover:brightness-110 disabled:opacity-50">
                  {isAdmin ? 'บันทึก' : 'ส่งคำขอ'}
                </button>
                <button type="button" onClick={() => setShowAddQr(false)} className="text-sm text-slate-400 hover:text-slate-200 px-4 py-2">ยกเลิก</button>
              </div>
            </form>
          )}
          {requestSubmitted && (
            <div className="bg-emerald-500/10 text-emerald-400 text-sm px-3 py-2 rounded-lg">ส่งคำขอแล้ว รอแอดมินอนุมัติ</div>
          )}

          {loadingReplies && <p className="text-sm text-slate-500">กำลังโหลด...</p>}
          {!loadingReplies && quickReplies.map((qr, i) => (
            <div key={qr.id} className={`${cardCls} flex items-start gap-3`}>
              {isAdmin && (
                <div className="flex flex-col flex-shrink-0 -my-1">
                  <button
                    onClick={() => moveQuickReply(qr.id, 'up')}
                    disabled={i === 0}
                    className="text-slate-500 hover:text-slate-200 disabled:opacity-20 disabled:hover:text-slate-500 p-0.5"
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    onClick={() => moveQuickReply(qr.id, 'down')}
                    disabled={i === quickReplies.length - 1}
                    className="text-slate-500 hover:text-slate-200 disabled:opacity-20 disabled:hover:text-slate-500 p-0.5"
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>
              )}
              {qr.imageCount > 0 && (
                <div className="relative flex-shrink-0">
                  <img src={`/api/quick-replies/${qr.id}/image/0`} alt="" className="w-14 h-14 rounded-lg object-cover border border-slate-800" />
                  <ExtraImagesBadge count={qr.imageCount} />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-slate-100 text-sm">{qr.name}</p>
                  <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-400 flex-shrink-0">{qrKindLabel(qr.kind)}</span>
                </div>
                <p className="text-sm text-slate-400 mt-0.5 whitespace-pre-wrap line-clamp-3">{qr.content}</p>
              </div>
              {isAdmin && (
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => setEditTarget(qr)} className="text-slate-500 hover:text-slate-200 p-1.5"><Pencil size={14} /></button>
                  <button onClick={() => deleteQuickReply(qr.id)} className="text-slate-500 hover:text-rose-400 p-1.5"><Trash2 size={14} /></button>
                </div>
              )}
            </div>
          ))}
          {!loadingReplies && quickReplies.length === 0 && <p className="text-sm text-slate-500">ยังไม่มีข้อความลัดในหมวดหมู่นี้</p>}
        </div>
      )}

      {editTarget && (
        <QuickReplyEditModal item={editTarget} onSave={saveQuickReplyEdit} onClose={() => setEditTarget(null)} />
      )}
    </div>
  );
}

// ---------- คำขอเพิ่มข้อความลัด ----------

const REQUEST_STATUS_META = {
  pending: { label: 'รอตรวจสอบ', cls: 'bg-sky-500/15 text-sky-400' },
  needs_revision: { label: 'ส่งกลับให้แก้ไข', cls: 'bg-amber-500/15 text-amber-400' },
  approved: { label: 'อนุมัติแล้ว', cls: 'bg-emerald-500/15 text-emerald-400' },
  rejected: { label: 'ไม่อนุมัติ', cls: 'bg-rose-500/15 text-rose-400' },
};

const ADMIN_STATUS_FILTERS = [
  { key: 'pending', label: 'รอตรวจสอบ' },
  { key: 'needs_revision', label: 'ให้แก้ไข' },
  { key: 'approved', label: 'อนุมัติแล้ว' },
  { key: 'rejected', label: 'ไม่อนุมัติ' },
  { key: '', label: 'ทั้งหมด' },
];

// Buttons per spec: อนุมัติ (green), แก้ไข (yellow), ไม่อนุมัติ (red). แก้ไข/ไม่อนุมัติ
// need a reason attached before submitting, อนุมัติ doesn't — approving is a
// direct action once the admin's checked the text/image are correct.
function AdminReviewControls({ requestId, onReview }) {
  const [expanded, setExpanded] = useState(null); // 'needs_revision' | 'rejected' | null
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(status, needsNote) {
    if (needsNote && !note.trim()) return;
    setBusy(true);
    try {
      await onReview(requestId, status, note.trim());
    } finally { setBusy(false); }
  }

  if (expanded) {
    return (
      <div className="mt-3 space-y-2">
        <textarea
          autoFocus
          className="w-full border border-slate-700 bg-slate-800 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-aurora-teal placeholder:text-slate-500"
          rows={2}
          placeholder={expanded === 'needs_revision' ? 'บอกเหตุผลที่ต้องแก้ไข เช่น พิมพ์ตกหล่น / รูปไม่ตรงกับข้อความ' : 'บอกเหตุผลที่ไม่อนุมัติ'}
          value={note}
          onChange={e => setNote(e.target.value)}
        />
        <div className="flex gap-2">
          <button
            disabled={busy || !note.trim()}
            onClick={() => submit(expanded, true)}
            className={`text-sm px-3 py-1.5 rounded-lg font-medium disabled:opacity-50 ${
              expanded === 'needs_revision' ? 'bg-amber-500 hover:bg-amber-400 text-slate-900' : 'bg-rose-600 hover:bg-rose-500 text-white'
            }`}
          >
            ยืนยัน
          </button>
          <button onClick={() => { setExpanded(null); setNote(''); }} className="text-sm text-slate-400 hover:text-slate-200 px-3 py-1.5">ยกเลิก</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2 mt-3">
      <button disabled={busy} onClick={() => submit('approved', false)} className="text-sm px-3 py-1.5 rounded-lg font-medium bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50">
        อนุมัติ
      </button>
      <button disabled={busy} onClick={() => setExpanded('needs_revision')} className="text-sm px-3 py-1.5 rounded-lg font-medium bg-amber-500 hover:bg-amber-400 text-slate-900 disabled:opacity-50">
        แก้ไข
      </button>
      <button disabled={busy} onClick={() => setExpanded('rejected')} className="text-sm px-3 py-1.5 rounded-lg font-medium bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-50">
        ไม่อนุมัติ
      </button>
    </div>
  );
}

function ResubmitForm({ req, onSubmit, onCancel }) {
  const [kind, setKind] = useState(req.kind);
  const [name, setName] = useState(req.name);
  const [content, setContent] = useState(req.content);
  const existingUrls = Array.from({ length: req.imageCount || 0 }, (_, i) => `/api/quick-replies/requests/${req.id}/image/${i}`);
  const [removedIndexes, setRemovedIndexes] = useState(new Set());
  const [newImages, setNewImages] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function toggleRemove(i) {
    setRemovedIndexes(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim() || !content.trim()) return;
    setSaving(true); setError('');
    try {
      const payload = { kind, name: name.trim(), content: content.trim() };
      if (removedIndexes.size > 0 || newImages.length > 0) {
        payload.removeImageIndexes = Array.from(removedIndexes);
        payload.addImages = newImages;
      }
      await onSubmit(payload);
    } catch (err) {
      setError(err.response?.data?.error || 'เกิดข้อผิดพลาด');
    } finally { setSaving(false); }
  }

  const inputCls = 'w-full border border-slate-700 bg-slate-800 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-aurora-teal placeholder:text-slate-500';

  return (
    <form onSubmit={handleSubmit} className="mt-3 space-y-3 border-t border-slate-800 pt-3">
      {error && <div className="bg-rose-500/10 text-rose-400 text-sm px-3 py-2 rounded-lg">{error}</div>}
      <div className="flex gap-2">
        {QR_KIND_OPTIONS.map(opt => (
          <button
            key={opt.key}
            type="button"
            onClick={() => setKind(opt.key)}
            className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${kind === opt.key ? 'bg-aurora-teal/15 border-aurora-teal text-aurora-teal' : 'border-slate-700 text-slate-300 hover:border-slate-500'}`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="ชื่อข้อความ" />
      <textarea className={inputCls} rows={3} value={content} onChange={e => setContent(e.target.value)} placeholder="รายละเอียดข้อความ" />
      <MultiImagePicker
        existingUrls={existingUrls}
        removedIndexes={removedIndexes}
        onToggleRemove={toggleRemove}
        newImages={newImages}
        setNewImages={setNewImages}
      />
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="bg-gradient-to-r from-aurora-teal to-aurora-purple text-white rounded-lg px-4 py-2 text-sm hover:brightness-110 disabled:opacity-50">ส่งใหม่</button>
        <button type="button" onClick={onCancel} className="text-sm text-slate-400 hover:text-slate-200 px-4 py-2">ยกเลิก</button>
      </div>
    </form>
  );
}

function QuickReplyRequestCard({ req, isAdmin, myId, onReview, onWithdraw, onResubmit }) {
  const [resubmitting, setResubmitting] = useState(false);
  const meta = REQUEST_STATUS_META[req.status] || REQUEST_STATUS_META.pending;
  const isMine = req.requestedById === myId;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <div className="flex items-start gap-3">
        {req.imageCount > 0 && (
          <div className="relative flex-shrink-0">
            <img src={`/api/quick-replies/requests/${req.id}/image/0`} alt="" className="w-14 h-14 rounded-lg object-cover border border-slate-800" />
            <ExtraImagesBadge count={req.imageCount} />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium text-slate-100 text-sm">{req.name}</p>
            <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-400">{qrKindLabel(req.kind)}</span>
            <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium ${meta.cls}`}>{meta.label}</span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            {req.category?.name}
            {isAdmin && req.requestedBy?.name ? ` • โดย ${req.requestedBy.name}` : ''}
          </p>
          <p className="text-sm text-slate-400 mt-1.5 whitespace-pre-wrap line-clamp-4">{req.content}</p>
          {req.reviewNote && (req.status === 'needs_revision' || req.status === 'rejected') && (
            <p className="text-xs text-amber-400 mt-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-1.5">
              หมายเหตุจากแอดมิน: {req.reviewNote}
            </p>
          )}
        </div>
        {!isAdmin && isMine && (req.status === 'pending' || req.status === 'needs_revision') && (
          <button onClick={() => onWithdraw(req.id)} className="text-slate-500 hover:text-rose-400 p-1.5 flex-shrink-0" title="ยกเลิกคำขอ">
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {isAdmin && req.status === 'pending' && (
        <AdminReviewControls requestId={req.id} onReview={onReview} />
      )}

      {!isAdmin && isMine && req.status === 'needs_revision' && !resubmitting && (
        <button onClick={() => setResubmitting(true)} className="mt-3 flex items-center gap-1.5 text-sm text-aurora-teal hover:brightness-110 font-medium">
          <Pencil size={13} /> แก้ไขและส่งใหม่
        </button>
      )}
      {!isAdmin && isMine && resubmitting && (
        <ResubmitForm
          req={req}
          onCancel={() => setResubmitting(false)}
          onSubmit={async (fields) => { await onResubmit(req.id, fields); setResubmitting(false); }}
        />
      )}
    </div>
  );
}

function QuickReplyRequests({ isAdmin, myId }) {
  const [statusFilter, setStatusFilter] = useState(isAdmin ? 'pending' : '');
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  function load() {
    setLoading(true);
    const params = statusFilter ? { status: statusFilter } : {};
    return axios.get('/api/quick-replies/requests', { params })
      .then(r => setRequests(r.data))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleReview(id, status, reviewNote) {
    setError('');
    try {
      await axios.patch(`/api/quick-replies/requests/${id}/review`, { status, reviewNote });
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'เกิดข้อผิดพลาด');
    }
  }

  async function handleResubmit(id, fields) {
    setError('');
    await axios.patch(`/api/quick-replies/requests/${id}`, fields);
    await load();
  }

  async function handleWithdraw(id) {
    if (!confirm('ยกเลิกคำขอนี้?')) return;
    await axios.delete(`/api/quick-replies/requests/${id}`);
    await load();
  }

  return (
    <div className="max-w-3xl space-y-4">
      {error && <div className="bg-rose-500/10 text-rose-400 text-sm px-4 py-2 rounded-lg">{error}</div>}
      {isAdmin && (
        <div className="flex flex-wrap gap-2">
          {ADMIN_STATUS_FILTERS.map(f => (
            <button
              key={f.key || 'all'}
              onClick={() => setStatusFilter(f.key)}
              className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
                statusFilter === f.key ? 'bg-aurora-teal/15 border-aurora-teal text-aurora-teal' : 'border-slate-700 text-slate-300 hover:border-slate-500'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}
      {loading && <p className="text-sm text-slate-500">กำลังโหลด...</p>}
      {!loading && requests.length === 0 && <p className="text-sm text-slate-500">ไม่มีคำขอ</p>}
      {!loading && requests.map(req => (
        <QuickReplyRequestCard
          key={req.id}
          req={req}
          isAdmin={isAdmin}
          myId={myId}
          onReview={handleReview}
          onWithdraw={handleWithdraw}
          onResubmit={handleResubmit}
        />
      ))}
    </div>
  );
}

const TABS = [
  { key: 'catalog', label: 'รายการ', icon: Zap },
  { key: 'requests', label: 'คำขอ', icon: ClipboardList },
];

export default function QuickReplies() {
  const { tab } = useParams();
  const navigate = useNavigate();
  const { agent } = useAuth();
  const { socket } = useSocket();
  const isAdmin = agent?.role === 'admin';
  const [channels, setChannels] = useState([]);
  // Same "things needing MY action" count as the sidebar badge (Sidebar.jsx) —
  // kept in sync here too so the "คำขอ" tab itself shows a live number, not
  // just the sidebar.
  const [actionableCount, setActionableCount] = useState(0);

  useEffect(() => {
    axios.get('/api/channels').then(r => setChannels(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    function loadCount() {
      const status = isAdmin ? 'pending' : 'needs_revision';
      axios.get('/api/quick-replies/requests', { params: { status } })
        .then(r => setActionableCount(r.data.length))
        .catch(() => {});
    }
    loadCount();
    if (!socket) return;
    socket.on('quick_reply_request_created', loadCount);
    socket.on('quick_reply_request_reviewed', loadCount);
    return () => {
      socket.off('quick_reply_request_created', loadCount);
      socket.off('quick_reply_request_reviewed', loadCount);
    };
  }, [socket, isAdmin]);

  const activeTab = tab === 'requests' ? 'requests' : 'catalog';

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex items-center gap-2 mb-5">
        <Zap size={18} className="text-slate-500" />
        <h2 className="text-base font-semibold text-slate-100">ข้อความลัด</h2>
      </div>

      <div className="flex gap-2 mb-6 border-b border-slate-800 pb-3">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => navigate(`/quick-replies/${key}`)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === key ? 'bg-aurora-teal/15 text-aurora-teal' : 'text-slate-400 hover:bg-slate-800'
            }`}
          >
            <Icon size={14} /> {label}
            {key === 'requests' && actionableCount > 0 && (
              <span className="bg-rose-500 text-white text-[10px] font-semibold rounded-full px-1.5 min-w-[18px] text-center">
                {actionableCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {activeTab === 'catalog' && <QuickReplyCatalog isAdmin={isAdmin} channels={channels} />}
      {activeTab === 'requests' && <QuickReplyRequests isAdmin={isAdmin} myId={agent?.id} />}
    </div>
  );
}
