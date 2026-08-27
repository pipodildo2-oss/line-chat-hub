import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { Plus, Trash2, Copy, Check, Users, MessageSquare, Tag as TagIcon, AlertTriangle, ArrowLeft, QrCode, MessageCircle, Eye, EyeOff, Pencil, X, ExternalLink, Search, Link2, ChevronUp, ChevronDown, Cog } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { TAG_COLOR_PRESETS } from '../lib/constants';

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  function copy(e) {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button type="button" onClick={copy} className="text-slate-500 hover:text-slate-300 flex-shrink-0">
      {copied ? <Check size={14} className="text-aurora-teal" /> : <Copy size={14} />}
    </button>
  );
}

function ChannelListCard({ channel, onManage }) {
  const isActive = channel.active !== false;
  return (
    <div className={`relative rounded-xl border border-slate-800 bg-slate-900 p-5 min-h-[168px] flex flex-col gap-4 ${!isActive ? 'opacity-60' : ''}`}>
      {!channel.webhookRedeliveryConfirmed && (
        <span
          title='อย่าลืมเปิด "Use webhook redelivery" ในหน้า Messaging API ของ LINE Developers Console — ถ้าไม่เปิด ข้อความที่ลูกค้าทักเข้ามาตอนระบบมีปัญหาชั่วคราวจะหายไปถาวร'
          className="absolute top-2 right-2 text-amber-500 p-1 cursor-help"
        >
          <AlertTriangle size={15} />
        </span>
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-slate-100 text-base truncate">{channel.name}</p>
            {!isActive && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 font-medium flex-shrink-0" title="หยุดรับ-ส่งข้อความชั่วคราว แชทเดิมยังอยู่ครบ">
                ปิดใช้งาน
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500 truncate mt-0.5">LINE (ID: {channel.lineId || '—'})</p>
        </div>
        <div className="w-11 h-11 rounded-full bg-gradient-to-br from-aurora-teal to-aurora-purple flex items-center justify-center text-white flex-shrink-0">
          <MessageCircle size={20} />
        </div>
      </div>
      <div className="flex-1" />
      <div className="border-t border-slate-800 pt-3 flex justify-end">
        <button
          onClick={onManage}
          className="text-sm text-aurora-teal font-medium border border-aurora-teal/30 rounded-lg px-4 py-2 hover:bg-aurora-teal/10 transition-colors"
        >
          Manage
        </button>
      </div>
    </div>
  );
}

function ChannelConfigure({ channel, categories, onBack, onSave, onRequestDelete }) {
  const [name, setName] = useState(channel.name);
  const [lineId, setLineId] = useState(channel.lineId || '');
  // The backend no longer sends channelSecret/accessToken back in any
  // response (see channels.js) — these are live LINE credentials with no
  // reason to ever reach the browser once set, so both fields start blank
  // and are only sent on save if the admin actually typed a new value
  // (channelSecret now matches the pattern accessToken already used).
  const [channelSecret, setChannelSecret] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [savingCategory, setSavingCategory] = useState(false);
  const [togglingActive, setTogglingActive] = useState(false);
  const isActive = channel.active !== false;

  async function handleToggleActive() {
    setTogglingActive(true);
    try { await onSave(channel.id, { active: !isActive }); }
    finally { setTogglingActive(false); }
  }

  async function handleCategoryChange(e) {
    setSavingCategory(true);
    try { await onSave(channel.id, { categoryId: e.target.value }); }
    finally { setSavingCategory(false); }
  }

  const webhookUrl = `${window.location.origin}/api/webhooks/line/${channel.id}`;
  const handle = lineId ? `@${lineId.replace(/^@/, '')}` : null;
  const chatLink = handle ? `https://line.me/R/ti/p/${encodeURIComponent(handle)}` : null;

  const fieldCls = 'w-full border border-slate-700 bg-slate-800 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-aurora-teal placeholder:text-slate-500';
  const labelCls = 'text-xs font-medium text-slate-400 mb-1.5 block';
  const readonlyCls = 'w-full border border-slate-800 bg-slate-800/50 text-slate-500 rounded-lg px-3 py-2 text-sm cursor-not-allowed';

  async function handleSave() {
    setSaving(true); setSaved(false);
    try {
      await onSave(channel.id, { name, lineId, channelSecret: channelSecret || undefined, accessToken: accessToken || undefined });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally { setSaving(false); }
  }

  async function handleConfirmRedelivery() {
    setConfirming(true);
    try {
      await onSave(channel.id, { webhookRedeliveryConfirmed: true });
    } finally { setConfirming(false); }
  }

  return (
    <div className="max-w-xl">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 mb-4">
        <ArrowLeft size={15} /> กลับไปหน้ารายการ
      </button>
      <h2 className="text-lg font-semibold text-slate-100 mb-0.5">ตั้งค่า LINE OA</h2>
      <p className="text-sm text-slate-500 mb-6">จัดการข้อมูลและการตั้งค่าของช่องทางนี้</p>

      {!channel.webhookRedeliveryConfirmed && (
        <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2.5 mb-4">
          <AlertTriangle size={15} className="text-amber-500 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-amber-400">
            <p>
              อย่าลืมเปิด <span className="font-medium">"Use webhook redelivery"</span> ในหน้า Messaging API ของ LINE Developers Console — ถ้าไม่เปิด
              ข้อความที่ลูกค้าทักเข้ามาตอนระบบมีปัญหาชั่วคราวจะหายไปถาวร (LINE ไม่มี API ให้เปิด/ปิดสวิตช์นี้จากในระบบนี้ ต้องไปกดในคอนโซลของ LINE เอง —
              ระบบเลยเช็คสถานะจริงให้ไม่ได้ ต้องกดยืนยันเองด้านล่างหลังเปิดใช้แล้ว)
            </p>
            <div className="flex items-center gap-3 mt-2">
              <a
                href="https://developers.line.biz/console/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium hover:brightness-110"
              >
                เปิด LINE Developers Console <ExternalLink size={12} />
              </a>
              <button
                type="button"
                onClick={handleConfirmRedelivery}
                disabled={confirming}
                className="inline-flex items-center gap-1 font-medium text-aurora-teal hover:brightness-110 disabled:opacity-50"
              >
                <Check size={12} /> {confirming ? 'กำลังบันทึก...' : 'ฉันเปิดใช้แล้ว ซ่อนคำเตือนนี้'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {chatLink && (
          <div>
            <label className={labelCls}>Chat Link</label>
            <div className="flex items-center gap-2">
              <div className="flex-1 border border-slate-700 bg-slate-800 rounded-lg px-3 py-2 flex items-center gap-2">
                <code className="text-sm text-slate-300 flex-1 truncate">{chatLink}</code>
                <CopyButton text={chatLink} />
              </div>
              <button
                type="button"
                onClick={() => setShowQr(v => !v)}
                className="flex items-center gap-1.5 text-sm text-aurora-teal hover:brightness-110 whitespace-nowrap"
              >
                <QrCode size={15} /> QR code
              </button>
            </div>
            {showQr && (
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(chatLink)}`}
                alt="QR code"
                className="mt-2 rounded-lg border border-slate-700 bg-white p-2"
                width={120}
                height={120}
              />
            )}
          </div>
        )}

        <div>
          <label className={labelCls}>ชื่อช่องทาง</label>
          <input className={fieldCls} value={name} onChange={e => setName(e.target.value)} />
        </div>

        <div>
          <label className={labelCls}>หมวดหมู่</label>
          <select className={fieldCls} value={channel.categoryId || ''} onChange={handleCategoryChange} disabled={savingCategory}>
            <option value="">ไม่มีหมวดหมู่</option>
            {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
          </select>
        </div>

        <div>
          <label className={labelCls}>LINE ID</label>
          <input className={fieldCls} placeholder="เช่น abc1234 (ไม่ต้องใส่ @)" value={lineId} onChange={e => setLineId(e.target.value)} />
        </div>

        <div>
          <label className={labelCls}>Channel Secret</label>
          <input className={fieldCls} placeholder="ปล่อยว่างไว้ถ้าไม่ต้องการเปลี่ยน" value={channelSecret} onChange={e => setChannelSecret(e.target.value)} />
        </div>

        <div>
          <label className={labelCls}>Channel Access Token</label>
          <input className={fieldCls} placeholder="ปล่อยว่างไว้ถ้าไม่ต้องการเปลี่ยน" value={accessToken} onChange={e => setAccessToken(e.target.value)} />
        </div>

        <div>
          <label className={labelCls}>Channel ID</label>
          <input className={readonlyCls} value={channel.channelId} disabled />
        </div>

        <div>
          <label className={labelCls}>Webhook URL</label>
          <div className="flex items-center gap-2 border border-slate-800 bg-slate-800/50 rounded-lg px-3 py-2">
            <code className="text-sm text-slate-400 flex-1 truncate">{webhookUrl}</code>
            <CopyButton text={webhookUrl} />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-gradient-to-r from-aurora-teal to-aurora-purple text-white rounded-lg px-4 py-2 text-sm font-medium hover:brightness-110 disabled:opacity-50 transition-all"
          >
            {saving ? 'กำลังบันทึก...' : 'Save Changes'}
          </button>
          {saved && <span className="text-sm text-aurora-teal">บันทึกแล้ว</span>}
        </div>
      </div>

      <div className="mt-8 pt-6 border-t border-slate-800">
        <h3 className="font-semibold text-slate-100 mb-1">ปิดใช้งานช่องทาง</h3>
        <p className="text-xs text-slate-500 mb-3">
          หยุดรับ-ส่งข้อความผ่านช่องทางนี้ชั่วคราว แต่แชทและข้อความเดิมทั้งหมดยังอยู่ครบ กดเปิดใช้งานกลับมาได้ทุกเมื่อ
          — ใช้ตัวนี้แทนการลบ ถ้าไม่แน่ใจหรือแค่อยากพักช่องทางไว้ก่อน
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={handleToggleActive}
            disabled={togglingActive}
            className={`relative inline-flex overflow-hidden w-11 h-6 rounded-full transition-colors flex-shrink-0 disabled:opacity-50 ${isActive ? 'bg-gradient-to-r from-aurora-teal to-aurora-purple' : 'bg-slate-700'}`}
          >
            <span className={`absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${isActive ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
          <span className="text-sm text-slate-300">
            {isActive ? 'เปิดใช้งานอยู่' : 'ปิดใช้งานอยู่'}
          </span>
        </div>
      </div>

      <div className="mt-8 pt-6 border-t border-slate-800">
        <h3 className="font-semibold text-slate-100 mb-3">Danger Zone</h3>
        <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2.5 mb-3">
          <AlertTriangle size={15} className="text-amber-500 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-amber-400">
            ลบช่องทางนี้จะ<span className="font-semibold">ลบถาวร</span> การสนทนาและข้อความทั้งหมดที่เชื่อมกับช่องทางนี้ออกจากฐานข้อมูลทันที กู้คืนไม่ได้ไม่ว่าจะเชื่อมต่อไลน์ OA
            เดิมกลับมาใหม่ก็ตาม (ระบบจะมองเป็นช่องทางใหม่ที่ไม่มีประวัติแชท) ถ้าแค่ต้องการหยุดใช้งานชั่วคราว ให้ใช้สวิตช์ปิดใช้งานด้านบนแทน
          </p>
        </div>
        <button
          onClick={() => onRequestDelete(channel)}
          className="flex items-center gap-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
        >
          <Trash2 size={15} /> Delete Channel
        </button>
      </div>
    </div>
  );
}

function DeleteChannelModal({ channel, onCancel, onConfirm }) {
  const [text, setText] = useState('');
  const [deleting, setDeleting] = useState(false);
  if (!channel) return null;
  const convCount = channel._count?.conversations || 0;
  const matches = text.trim() === channel.name;

  async function handleConfirm() {
    setDeleting(true);
    try { await onConfirm(channel.id); } finally { setDeleting(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onCancel}>
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <h3 className="font-semibold text-slate-100 mb-1.5">ลบ "{channel.name}" ถาวร?</h3>
        <p className="text-sm text-slate-400 mb-3">
          {convCount > 0
            ? `การสนทนาทั้งหมด ${convCount} รายการและข้อความในนั้นจะถูกลบถาวรไปด้วย กู้คืนไม่ได้`
            : 'การกระทำนี้กู้คืนไม่ได้'}
        </p>
        <p className="text-xs text-slate-400 mb-1.5">พิมพ์ <span className="font-semibold text-slate-200">{channel.name}</span> เพื่อยืนยันการลบ</p>
        <input
          autoFocus
          className="w-full border border-slate-700 bg-slate-800 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500 mb-3"
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={channel.name}
        />
        <div className="flex gap-2">
          <button
            onClick={handleConfirm}
            disabled={!matches || deleting}
            className="bg-rose-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            ลบถาวร
          </button>
          <button onClick={onCancel} className="text-sm text-slate-400 hover:text-slate-200 px-4 py-2">ยกเลิก</button>
        </div>
      </div>
    </div>
  );
}

function AgentCard({ a, canManage, isMe, onEdit, onDelete }) {
  return (
    <div className="group relative rounded-xl border border-slate-800 bg-slate-900 p-4 hover:border-slate-700 hover:bg-slate-800/30 transition-colors">
      {canManage && (
        <div className="absolute top-3 right-3 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={onEdit} title="แก้ไข" className="p-1.5 text-slate-500 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors">
            <Pencil size={13} />
          </button>
          <button onClick={onDelete} title="ลบ" className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors">
            <Trash2 size={13} />
          </button>
        </div>
      )}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-aurora-teal to-aurora-purple flex items-center justify-center text-white text-sm font-semibold flex-shrink-0 ring-2 ring-slate-950/60">
          {a.name[0].toUpperCase()}
        </div>
        <div className="min-w-0 flex-1 pr-9">
          <p className="font-medium text-slate-100 text-sm truncate">{a.name}</p>
          <p className="text-xs text-slate-500 truncate mt-0.5">{a.email}</p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 mt-3">
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${a.role === 'admin' ? 'bg-aurora-tealDeep/20 text-aurora-cyan' : 'bg-aurora-teal/15 text-aurora-teal'}`}>
          {a.role === 'admin' ? 'Admin' : 'Agent'}
        </span>
        {isMe && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-400 font-medium">คุณ</span>
        )}
      </div>
    </div>
  );
}

function AgentEditModal({ agentItem, channels, categories, onSave, onClose, t }) {
  const [role, setRole] = useState(agentItem.role);
  const [selectedIds, setSelectedIds] = useState(agentItem.channelIds || []);
  const [categoryId, setCategoryId] = useState(agentItem.categoryId || '');
  const [newPassword, setNewPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const [error, setError] = useState('');

  const fieldCls = 'w-full border border-slate-700 bg-slate-800 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-aurora-teal placeholder:text-slate-500';
  const labelCls = 'text-xs font-medium text-slate-400 mb-1.5 block';

  function toggleChannel(id) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  async function handleSave() {
    setSaving(true); setError('');
    try {
      await onSave(agentItem.id, { role, channelIds: selectedIds, categoryId: categoryId || null });
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'เกิดข้อผิดพลาด');
    } finally { setSaving(false); }
  }

  async function handleResetPassword() {
    if (!newPassword || newPassword.length < 6) { setError('รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร'); return; }
    setResetting(true); setError('');
    try {
      await axios.patch(`/api/agents/${agentItem.id}/password`, { newPassword });
      setNewPassword('');
      setResetDone(true);
      setTimeout(() => setResetDone(false), 2000);
    } catch (err) {
      setError(err.response?.data?.error || 'เกิดข้อผิดพลาด');
    } finally { setResetting(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-slate-100">{agentItem.name}</h3>
            <p className="text-xs text-slate-500">{agentItem.email}</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300"><X size={18} /></button>
        </div>

        {error && <div className="bg-rose-500/10 text-rose-400 text-sm px-3 py-2 rounded-lg mb-3">{error}</div>}

        <div className="space-y-4">
          <div>
            <label className={labelCls}>{t('role')}</label>
            <select className={fieldCls} value={role} onChange={e => setRole(e.target.value)}>
              <option value="agent">Agent</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          <div>
            <label className={labelCls}>หมวดหมู่ทีมงาน</label>
            <select className={fieldCls} value={categoryId} onChange={e => setCategoryId(e.target.value)}>
              <option value="">ไม่มีหมวดหมู่</option>
              {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
            </select>
          </div>

          <div>
            <label className={labelCls}>{t('channel_visibility')}</label>
            <div className="border border-slate-700 rounded-lg p-2 space-y-1 max-h-40 overflow-y-auto">
              {channels.map(ch => (
                <label key={ch.id} className="flex items-center gap-2 text-sm px-1.5 py-1 rounded hover:bg-slate-800 cursor-pointer text-slate-200">
                  <input type="checkbox" checked={selectedIds.includes(ch.id)} onChange={() => toggleChannel(ch.id)} className="accent-aurora-teal" />
                  {ch.name}
                </label>
              ))}
              {channels.length === 0 && <p className="text-xs text-slate-500 px-1.5 py-1">ยังไม่มีช่องทาง</p>}
            </div>
            <p className="text-[11px] text-slate-500 mt-1">ไม่เลือก = มองเห็นทุกช่องทาง</p>
          </div>

          <div className="border-t border-slate-800 pt-4">
            <label className={labelCls}>{t('reset_password')}</label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  type={showPw ? 'text' : 'password'}
                  className={`${fieldCls} pr-10`}
                  placeholder={t('new_password')}
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  name="reset-agent-password"
                />
                <button type="button" onClick={() => setShowPw(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <button
                type="button"
                onClick={handleResetPassword}
                disabled={resetting || !newPassword}
                className="text-sm text-rose-400 hover:text-rose-300 font-medium border border-rose-500/30 rounded-lg px-3 py-2 hover:bg-rose-500/10 disabled:opacity-40 transition-colors whitespace-nowrap"
              >
                {t('reset_password')}
              </button>
            </div>
            {resetDone && <span className="flex items-center gap-1 text-xs text-aurora-teal mt-1.5"><Check size={13} /> เปลี่ยนรหัสผ่านแล้ว</span>}
          </div>
        </div>

        <div className="flex items-center gap-3 mt-5">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-gradient-to-r from-aurora-teal to-aurora-purple text-white rounded-lg px-4 py-2 text-sm font-medium hover:brightness-110 disabled:opacity-50 transition-all"
          >
            {t('save')}
          </button>
          <button onClick={onClose} className="text-sm text-slate-400 hover:text-slate-200 px-4 py-2">{t('cancel')}</button>
        </div>
      </div>
    </div>
  );
}

function useCategories() {
  const { t } = useLanguage();
  return {
    channels: { label: t('settings_channels'), icon: MessageSquare },
    agents: { label: t('settings_agents'), icon: Users },
    tags: { label: t('settings_tags'), icon: TagIcon },
    'approved-links': { label: 'ลิงค์ที่อนุญาต', icon: Link2 },
    system: { label: 'ระบบ', icon: Cog },
  };
}

export default function Settings() {
  const { tab } = useParams();
  const { agent } = useAuth();
  const { t } = useLanguage();
  const [channels, setChannels] = useState([]);
  const [agents, setAgents] = useState([]);
  const [tags, setTags] = useState([]);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [manageChannelId, setManageChannelId] = useState(null);
  const [editAgentTarget, setEditAgentTarget] = useState(null);
  const [showAddChannel, setShowAddChannel] = useState(false);
  const [showAddAgent, setShowAddAgent] = useState(false);
  const [showAgentPassword, setShowAgentPassword] = useState(false);
  const [agentSearch, setAgentSearch] = useState('');
  const [channelForm, setChannelForm] = useState({ name: '', lineId: '', channelId: '', channelSecret: '', accessToken: '', categoryId: '' });
  // "__new__" is a sentinel value for the category <select> below — picking it
  // reveals a plain text input for typing a brand-new category name instead
  // of choosing an existing one. Kept separate from channelForm.categoryId
  // (which only ever holds a real id or '') so the sentinel never accidentally
  // gets sent to the backend as a categoryId.
  const [newChannelCategoryName, setNewChannelCategoryName] = useState('');
  const [agentForm, setAgentForm] = useState({ name: '', email: '', password: '', role: 'agent', categoryId: '' });
  const [tagForm, setTagForm] = useState({ name: '', color: TAG_COLOR_PRESETS[0] });
  // "ลิงค์ที่อนุญาต" — the whitelist linkGuard.js checks outgoing agent
  // messages against (see backend/src/lib/linkGuard.js), so a supervisor
  // gets flagged in รายงาน > ตรวจสอบ if an agent sends a customer a link to
  // an unregistered site.
  const [approvedLinks, setApprovedLinks] = useState([]);
  const [approvedLinkForm, setApprovedLinkForm] = useState({ domain: '', label: '' });
  // "ระบบ" — global app-level settings (backend/src/lib/systemSettings.js).
  // graceInput is the text field's own draft value, kept separate from
  // systemSettings (the last-saved value from the server) so typing a new
  // number doesn't look "saved" until the PATCH actually succeeds.
  const [systemSettings, setSystemSettings] = useState(null);
  const [graceInput, setGraceInput] = useState('');
  const [savingSystemSettings, setSavingSystemSettings] = useState(false);
  const [systemSettingsSaved, setSystemSettingsSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // LINE OA channel categories — purely organizational rows on the channels page.
  const [channelCategories, setChannelCategories] = useState([]);
  const [showAddChannelCategory, setShowAddChannelCategory] = useState(false);
  const [channelCategoryName, setChannelCategoryName] = useState('');
  const [editingChannelCategoryId, setEditingChannelCategoryId] = useState(null);
  const [editingChannelCategoryName, setEditingChannelCategoryName] = useState('');

  // "หมวดหมู่ใหญ่" — one level above the channel categories above, so several
  // existing categories can be nested under a bigger heading. Exact mirror of
  // the channel category state, plus each category also carries a `groupId`
  // (see assignCategoryGroup below) pointing at one of these.
  const [channelCategoryGroups, setChannelCategoryGroups] = useState([]);
  const [showAddChannelCategoryGroup, setShowAddChannelCategoryGroup] = useState(false);
  const [channelCategoryGroupName, setChannelCategoryGroupName] = useState('');
  const [editingChannelCategoryGroupId, setEditingChannelCategoryGroupId] = useState(null);
  const [editingChannelCategoryGroupName, setEditingChannelCategoryGroupName] = useState('');

  // Team ("หมวดหมู่ทีมงาน") categories — purely organizational grouping for
  // teammates, exact mirror of the channel categories state above.
  const [agentCategories, setAgentCategories] = useState([]);
  const [showAddAgentCategory, setShowAddAgentCategory] = useState(false);
  const [agentCategoryName, setAgentCategoryName] = useState('');
  const [editingAgentCategoryId, setEditingAgentCategoryId] = useState(null);
  const [editingAgentCategoryName, setEditingAgentCategoryName] = useState('');

  useEffect(() => {
    axios.get('/api/channels').then(r => setChannels(r.data));
    axios.get('/api/agents').then(r => setAgents(r.data));
    axios.get('/api/tags').then(r => setTags(r.data));
    axios.get('/api/channel-categories').then(r => setChannelCategories(r.data));
    axios.get('/api/channel-category-groups').then(r => setChannelCategoryGroups(r.data));
    axios.get('/api/agent-categories').then(r => setAgentCategories(r.data));
    axios.get('/api/approved-links').then(r => setApprovedLinks(r.data)).catch(() => {});
    axios.get('/api/settings/system').then(r => {
      setSystemSettings(r.data);
      setGraceInput(String(r.data.agentConductGraceSeconds));
    }).catch(() => {});
  }, []);

  async function addChannelCategory(e) {
    e.preventDefault();
    if (!channelCategoryName.trim()) return;
    setSaving(true); setError('');
    try {
      const { data } = await axios.post('/api/channel-categories', { name: channelCategoryName.trim() });
      setChannelCategories(prev => [...prev, { ...data, _count: { channels: 0 } }]);
      setChannelCategoryName('');
      setShowAddChannelCategory(false);
    } catch (err) {
      setError(err.response?.data?.error || 'เกิดข้อผิดพลาด');
    } finally { setSaving(false); }
  }

  function startEditChannelCategory(cat) {
    setEditingChannelCategoryId(cat.id);
    setEditingChannelCategoryName(cat.name);
  }

  async function saveChannelCategoryEdit(id) {
    if (!editingChannelCategoryName.trim()) return;
    try {
      const { data } = await axios.patch(`/api/channel-categories/${id}`, { name: editingChannelCategoryName.trim() });
      setChannelCategories(prev => prev.map(c => c.id === id ? { ...c, name: data.name } : c));
      setEditingChannelCategoryId(null);
    } catch (err) {
      setError(err.response?.data?.error || 'เกิดข้อผิดพลาด');
    }
  }

  async function deleteChannelCategory(id) {
    if (!confirm('ลบหมวดหมู่นี้? ไลน์ที่อยู่ในหมวดหมู่นี้จะยังอยู่ครบ แค่ย้ายไปเป็น "ยังไม่มีหมวดหมู่"')) return;
    await axios.delete(`/api/channel-categories/${id}`);
    setChannelCategories(prev => prev.filter(c => c.id !== id));
    setChannels(prev => prev.map(c => c.categoryId === id ? { ...c, categoryId: null, category: null } : c));
  }

  async function addChannelCategoryGroup(e) {
    e.preventDefault();
    if (!channelCategoryGroupName.trim()) return;
    setSaving(true); setError('');
    try {
      const { data } = await axios.post('/api/channel-category-groups', { name: channelCategoryGroupName.trim() });
      setChannelCategoryGroups(prev => [...prev, { ...data, _count: { categories: 0 } }]);
      setChannelCategoryGroupName('');
      setShowAddChannelCategoryGroup(false);
    } catch (err) {
      setError(err.response?.data?.error || 'เกิดข้อผิดพลาด');
    } finally { setSaving(false); }
  }

  function startEditChannelCategoryGroup(group) {
    setEditingChannelCategoryGroupId(group.id);
    setEditingChannelCategoryGroupName(group.name);
  }

  async function saveChannelCategoryGroupEdit(id) {
    if (!editingChannelCategoryGroupName.trim()) return;
    try {
      const { data } = await axios.patch(`/api/channel-category-groups/${id}`, { name: editingChannelCategoryGroupName.trim() });
      setChannelCategoryGroups(prev => prev.map(g => g.id === id ? { ...g, name: data.name } : g));
      setEditingChannelCategoryGroupId(null);
    } catch (err) {
      setError(err.response?.data?.error || 'เกิดข้อผิดพลาด');
    }
  }

  async function deleteChannelCategoryGroup(id) {
    if (!confirm('ลบหมวดหมู่ใหญ่นี้? หมวดหมู่ย่อยข้างในจะยังอยู่ครบ แค่ย้ายออกมาเป็นหมวดหมู่ย่อยเดี่ยวๆ')) return;
    await axios.delete(`/api/channel-category-groups/${id}`);
    setChannelCategoryGroups(prev => prev.filter(g => g.id !== id));
    setChannelCategories(prev => prev.map(c => c.groupId === id ? { ...c, groupId: null } : c));
  }

  // Assigns (or clears, when groupId is '') an existing category's parent group.
  async function assignCategoryGroup(categoryId, groupId) {
    try {
      const { data } = await axios.patch(`/api/channel-categories/${categoryId}`, { groupId: groupId || null });
      setChannelCategories(prev => prev.map(c => c.id === categoryId ? { ...c, groupId: data.groupId } : c));
    } catch (err) {
      setError(err.response?.data?.error || 'เกิดข้อผิดพลาด');
    }
  }

  // Renders one channel-category block (name/edit/delete + its channel cards).
  // Shared between the "grouped under a หมวดหมู่ใหญ่" and "ungrouped" sections
  // below so the markup only lives in one place.
  function renderChannelCategoryBlock(cat) {
    const catChannels = channels.filter(ch => ch.categoryId === cat.id);
    return (
      <div key={cat.id}>
        <div className="flex items-center gap-2 mb-2 group flex-wrap">
          {editingChannelCategoryId === cat.id ? (
            <>
              <input
                autoFocus
                className="border border-slate-700 bg-slate-800 text-slate-100 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-aurora-teal"
                value={editingChannelCategoryName}
                onChange={e => setEditingChannelCategoryName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && saveChannelCategoryEdit(cat.id)}
              />
              <button onClick={() => saveChannelCategoryEdit(cat.id)} className="text-aurora-teal"><Check size={14} /></button>
              <button onClick={() => setEditingChannelCategoryId(null)} className="text-slate-500 hover:text-slate-300"><X size={14} /></button>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-slate-200">{cat.name}</p>
              <span className="text-[10px] text-slate-500">{catChannels.length} ไลน์</span>
              <button onClick={() => startEditChannelCategory(cat)} className="text-slate-600 hover:text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity"><Pencil size={12} /></button>
              <button onClick={() => deleteChannelCategory(cat.id)} className="text-slate-600 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity"><X size={13} /></button>
              {channelCategoryGroups.length > 0 && (
                <select
                  className="text-[11px] bg-slate-800 border border-slate-700 text-slate-400 rounded-md px-1.5 py-0.5 ml-1 focus:outline-none focus:ring-1 focus:ring-aurora-teal"
                  value={cat.groupId || ''}
                  onChange={e => assignCategoryGroup(cat.id, e.target.value)}
                  title="ใส่ในหมวดหมู่ใหญ่"
                >
                  <option value="">ไม่มีหมวดหมู่ใหญ่</option>
                  {channelCategoryGroups.map(g => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              )}
            </>
          )}
        </div>
        {catChannels.length > 0 ? (
          <div className="flex flex-wrap gap-4">
            {catChannels.map(ch => (
              <div key={ch.id} className="w-64 flex-shrink-0">
                <ChannelListCard channel={ch} onManage={() => setManageChannelId(ch.id)} />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-600">ยังไม่มีไลน์ในหมวดหมู่นี้ — ไปที่ Manage ของไลน์แล้วเลือกหมวดหมู่นี้</p>
        )}
      </div>
    );
  }

  async function addChannel(e) {
    e.preventDefault();
    if (channelForm.categoryId === '__new__' && !newChannelCategoryName.trim()) {
      setError('กรุณาใส่ชื่อหมวดหมู่ใหม่');
      return;
    }
    setSaving(true); setError('');
    try {
      let categoryId = channelForm.categoryId;
      // Picked "+ เพิ่มหมวดหมู่ใหม่" — create the category first so the
      // channel can be created with a real categoryId in the same submit,
      // instead of making the admin create the category separately first.
      if (categoryId === '__new__') {
        const { data: newCategory } = await axios.post('/api/channel-categories', { name: newChannelCategoryName.trim() });
        setChannelCategories(prev => [...prev, { ...newCategory, _count: { channels: 0 } }]);
        categoryId = newCategory.id;
      }
      const { data } = await axios.post('/api/channels', { ...channelForm, categoryId: categoryId || undefined });
      setChannels(prev => [...prev, data]);
      setChannelForm({ name: '', lineId: '', channelId: '', channelSecret: '', accessToken: '', categoryId: '' });
      setNewChannelCategoryName('');
      setShowAddChannel(false);
    } catch (err) {
      setError(err.response?.data?.error || 'เกิดข้อผิดพลาด');
    } finally { setSaving(false); }
  }

  async function updateChannel(id, fields) {
    const { data } = await axios.put(`/api/channels/${id}`, fields);
    setChannels(prev => prev.map(c => c.id === id ? { ...c, ...data } : c));
  }

  async function confirmDeleteChannel(id) {
    await axios.delete(`/api/channels/${id}`);
    setChannels(prev => prev.filter(c => c.id !== id));
    setDeleteTarget(null);
    setManageChannelId(null);
  }

  async function addAgent(e) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const { data } = await axios.post('/api/agents', agentForm);
      setAgents(prev => [...prev, { ...data, channelIds: [] }]);
      setAgentForm({ name: '', email: '', password: '', role: 'agent', categoryId: '' });
      setShowAddAgent(false);
    } catch (err) {
      setError(err.response?.data?.error || 'เกิดข้อผิดพลาด');
    } finally { setSaving(false); }
  }

  async function deleteAgent(id) {
    if (id === agent?.id) return alert('ไม่สามารถลบตัวเองได้');
    if (!confirm('ลบ agent นี้? แชทที่เคย assign ให้ agent นี้จะยังอยู่ครบ แค่กลายเป็นยังไม่ได้ assign')) return;
    await axios.delete(`/api/agents/${id}`);
    setAgents(prev => prev.filter(a => a.id !== id));
  }

  async function saveAgentEdit(agentId, { role, channelIds, categoryId }) {
    const original = agents.find(a => a.id === agentId);
    let updated = {};
    if (role !== original?.role || categoryId !== original?.categoryId) {
      const { data } = await axios.patch(`/api/agents/${agentId}`, { role, categoryId });
      updated = data;
    }
    await axios.put(`/api/agents/${agentId}/channels`, { channelIds });
    setAgents(prev => prev.map(a => a.id === agentId ? { ...a, role, channelIds, ...updated } : a));
  }

  async function addAgentCategory(e) {
    e.preventDefault();
    if (!agentCategoryName.trim()) return;
    setSaving(true); setError('');
    try {
      const { data } = await axios.post('/api/agent-categories', { name: agentCategoryName.trim() });
      setAgentCategories(prev => [...prev, { ...data, _count: { agents: 0 } }]);
      setAgentCategoryName('');
      setShowAddAgentCategory(false);
    } catch (err) {
      setError(err.response?.data?.error || 'เกิดข้อผิดพลาด');
    } finally { setSaving(false); }
  }

  function startEditAgentCategory(cat) {
    setEditingAgentCategoryId(cat.id);
    setEditingAgentCategoryName(cat.name);
  }

  async function saveAgentCategoryEdit(id) {
    if (!editingAgentCategoryName.trim()) return;
    try {
      const { data } = await axios.patch(`/api/agent-categories/${id}`, { name: editingAgentCategoryName.trim() });
      setAgentCategories(prev => prev.map(c => c.id === id ? { ...c, name: data.name } : c));
      setEditingAgentCategoryId(null);
    } catch (err) {
      setError(err.response?.data?.error || 'เกิดข้อผิดพลาด');
    }
  }

  async function deleteAgentCategory(id) {
    if (!confirm('ลบหมวดหมู่นี้? คนในหมวดหมู่นี้จะยังอยู่ครบ แค่ย้ายไปเป็น "ยังไม่มีหมวดหมู่"')) return;
    await axios.delete(`/api/agent-categories/${id}`);
    setAgentCategories(prev => prev.filter(c => c.id !== id));
    setAgents(prev => prev.map(a => a.categoryId === id ? { ...a, categoryId: null, category: null } : a));
  }

  // Swaps a category with its neighbor above/below and persists the new order —
  // controls which category row shows above/below which on the Team page.
  // Mirrors moveQuickReply above.
  async function moveAgentCategory(id, direction) {
    const index = agentCategories.findIndex(c => c.id === id);
    const swapWith = direction === 'up' ? index - 1 : index + 1;
    if (index === -1 || swapWith < 0 || swapWith >= agentCategories.length) return;
    const next = [...agentCategories];
    [next[index], next[swapWith]] = [next[swapWith], next[index]];
    setAgentCategories(next);
    try {
      await axios.patch('/api/agent-categories/reorder', { ids: next.map(c => c.id) });
    } catch {
      setAgentCategories(agentCategories); // revert on failure
    }
  }

  async function addTag(e) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const { data } = await axios.post('/api/tags', tagForm);
      setTags(prev => [...prev, data]);
      setTagForm({ name: '', color: TAG_COLOR_PRESETS[0] });
    } catch (err) {
      setError(err.response?.data?.error || 'เกิดข้อผิดพลาด');
    } finally { setSaving(false); }
  }

  async function deleteTag(id) {
    if (!confirm('ลบแท็กนี้? แท็กจะถูกลบออกจากทุกการสนทนาที่ติดไว้ (การสนทนาและข้อความไม่ถูกลบ)')) return;
    await axios.delete(`/api/tags/${id}`);
    setTags(prev => prev.filter(t => t.id !== id));
  }

  async function addApprovedLink(e) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const { data } = await axios.post('/api/approved-links', approvedLinkForm);
      setApprovedLinks(prev => [...prev, data]);
      setApprovedLinkForm({ domain: '', label: '' });
    } catch (err) {
      setError(err.response?.data?.error || 'เกิดข้อผิดพลาด');
    } finally { setSaving(false); }
  }

  async function deleteApprovedLink(id) {
    if (!confirm('ลบโดเมนนี้ออกจากรายการที่อนุญาต? ข้อความที่ส่งลิงค์นี้ในอนาคตจะถูกแจ้งเตือนว่าเป็นลิงค์ไม่ได้รับอนุญาต')) return;
    await axios.delete(`/api/approved-links/${id}`);
    setApprovedLinks(prev => prev.filter(l => l.id !== id));
  }

  async function saveSystemSettings(e) {
    e.preventDefault();
    const seconds = Number(graceInput);
    if (!Number.isInteger(seconds) || seconds < 0) {
      setError('grace window ต้องเป็นจำนวนเต็มวินาที ตั้งแต่ 0 ขึ้นไป');
      return;
    }
    setSavingSystemSettings(true); setError('');
    try {
      const { data } = await axios.patch('/api/settings/system', { agentConductGraceSeconds: seconds });
      setSystemSettings(data);
      setGraceInput(String(data.agentConductGraceSeconds));
      setSystemSettingsSaved(true);
      setTimeout(() => setSystemSettingsSaved(false), 2000);
    } catch (err) {
      setError(err.response?.data?.error || 'บันทึกไม่สำเร็จ');
    } finally {
      setSavingSystemSettings(false);
    }
  }

  const inputCls = 'w-full border border-slate-700 bg-slate-800 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-aurora-teal placeholder:text-slate-500';
  const cardCls = 'bg-slate-900 border border-slate-800 rounded-xl p-4';
  const CATEGORIES = useCategories();
  const active = CATEGORIES[tab] || CATEGORIES.channels;
  const manageChannel = channels.find(c => c.id === manageChannelId);

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex items-center gap-2 mb-6">
        <active.icon size={18} className="text-slate-500" />
        <h2 className="text-base font-semibold text-slate-100">{active.label}</h2>
      </div>

      {error && <div className="bg-rose-500/10 text-rose-400 text-sm px-4 py-2 rounded-lg mb-4">{error}</div>}

      {/* Channels */}
      {tab === 'channels' && (
        manageChannel ? (
          <ChannelConfigure
            channel={manageChannel}
            categories={channelCategories}
            onBack={() => setManageChannelId(null)}
            onSave={updateChannel}
            onRequestDelete={setDeleteTarget}
          />
        ) : (
          <div className="space-y-6 max-w-6xl">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">หมวดหมู่ไลน์ OA</p>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowAddChannelCategoryGroup(v => !v)}
                  className="text-xs text-aurora-cyan font-medium flex items-center gap-1 hover:brightness-110"
                >
                  <Plus size={12} /> เพิ่มหมวดหมู่ใหญ่
                </button>
                <button
                  onClick={() => setShowAddChannelCategory(v => !v)}
                  className="text-xs text-aurora-teal font-medium flex items-center gap-1 hover:brightness-110"
                >
                  <Plus size={12} /> เพิ่มหมวดหมู่
                </button>
              </div>
            </div>

            {showAddChannelCategoryGroup && (
              <form onSubmit={addChannelCategoryGroup} className="flex items-center gap-2 max-w-md">
                <input
                  autoFocus
                  className={inputCls}
                  placeholder="ชื่อหมวดหมู่ใหญ่ เช่น ทีมขายทั้งหมด"
                  value={channelCategoryGroupName}
                  onChange={e => setChannelCategoryGroupName(e.target.value)}
                />
                <button type="submit" disabled={saving} className="bg-gradient-to-r from-aurora-teal to-aurora-purple text-white rounded-lg px-4 py-2 text-sm hover:brightness-110 disabled:opacity-50 whitespace-nowrap">บันทึก</button>
                <button type="button" onClick={() => { setShowAddChannelCategoryGroup(false); setChannelCategoryGroupName(''); }} className="text-sm text-slate-400 hover:text-slate-200 px-2">ยกเลิก</button>
              </form>
            )}

            {showAddChannelCategory && (
              <form onSubmit={addChannelCategory} className="flex items-center gap-2 max-w-md">
                <input
                  autoFocus
                  className={inputCls}
                  placeholder="ชื่อหมวดหมู่ เช่น ทีมขาย A"
                  value={channelCategoryName}
                  onChange={e => setChannelCategoryName(e.target.value)}
                />
                <button type="submit" disabled={saving} className="bg-gradient-to-r from-aurora-teal to-aurora-purple text-white rounded-lg px-4 py-2 text-sm hover:brightness-110 disabled:opacity-50 whitespace-nowrap">บันทึก</button>
                <button type="button" onClick={() => { setShowAddChannelCategory(false); setChannelCategoryName(''); }} className="text-sm text-slate-400 hover:text-slate-200 px-2">ยกเลิก</button>
              </form>
            )}

            {channelCategories.length === 0 ? (
              // No categories created yet — plain flat grid, same as before.
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {channels.map(ch => (
                  <ChannelListCard key={ch.id} channel={ch} onManage={() => setManageChannelId(ch.id)} />
                ))}
                <button
                  onClick={() => setShowAddChannel(true)}
                  className="rounded-xl border border-dashed border-slate-700 hover:border-aurora-teal text-slate-500 hover:text-aurora-teal flex flex-col items-center justify-center gap-1.5 transition-colors min-h-[168px]"
                >
                  <Plus size={26} />
                  <span className="text-sm">เพิ่ม LINE OA</span>
                </button>
              </div>
            ) : (
              <div className="space-y-8">
                {channelCategoryGroups.map(group => {
                  const groupCats = channelCategories.filter(c => c.groupId === group.id);
                  return (
                    <div key={group.id} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
                      <div className="flex items-center gap-2 mb-4 group/g">
                        {editingChannelCategoryGroupId === group.id ? (
                          <>
                            <input
                              autoFocus
                              className="border border-slate-700 bg-slate-800 text-slate-100 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-aurora-teal"
                              value={editingChannelCategoryGroupName}
                              onChange={e => setEditingChannelCategoryGroupName(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && saveChannelCategoryGroupEdit(group.id)}
                            />
                            <button onClick={() => saveChannelCategoryGroupEdit(group.id)} className="text-aurora-teal"><Check size={14} /></button>
                            <button onClick={() => setEditingChannelCategoryGroupId(null)} className="text-slate-500 hover:text-slate-300"><X size={14} /></button>
                          </>
                        ) : (
                          <>
                            <p className="text-sm font-bold text-white uppercase tracking-wide">{group.name}</p>
                            <span className="text-[10px] text-slate-500">{groupCats.length} หมวดหมู่ย่อย</span>
                            <button onClick={() => startEditChannelCategoryGroup(group)} className="text-slate-600 hover:text-slate-300 opacity-0 group-hover/g:opacity-100 transition-opacity"><Pencil size={12} /></button>
                            <button onClick={() => deleteChannelCategoryGroup(group.id)} className="text-slate-600 hover:text-rose-400 opacity-0 group-hover/g:opacity-100 transition-opacity"><X size={13} /></button>
                          </>
                        )}
                      </div>
                      {groupCats.length > 0 ? (
                        <div className="space-y-6">
                          {groupCats.map(cat => renderChannelCategoryBlock(cat))}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-600">ยังไม่มีหมวดหมู่ย่อยในหมวดหมู่ใหญ่นี้ — เลือกหมวดหมู่ใหญ่นี้จากหมวดหมู่ย่อยด้านล่าง</p>
                      )}
                    </div>
                  );
                })}

                <div className="space-y-6">
                  {channelCategoryGroups.length > 0 && channelCategories.some(c => !c.groupId) && (
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">หมวดหมู่ย่อยที่ยังไม่ได้จัดเข้าหมวดหมู่ใหญ่</p>
                  )}
                  {channelCategories.filter(c => !c.groupId).map(cat => renderChannelCategoryBlock(cat))}
                </div>

                <div>
                  <p className="text-sm font-semibold text-slate-200 mb-2">ยังไม่มีหมวดหมู่</p>
                  <div className="flex flex-wrap gap-4">
                    {channels.filter(ch => !ch.categoryId).map(ch => (
                      <div key={ch.id} className="w-64 flex-shrink-0">
                        <ChannelListCard channel={ch} onManage={() => setManageChannelId(ch.id)} />
                      </div>
                    ))}
                    <button
                      onClick={() => setShowAddChannel(true)}
                      className="w-64 flex-shrink-0 rounded-xl border border-dashed border-slate-700 hover:border-aurora-teal text-slate-500 hover:text-aurora-teal flex flex-col items-center justify-center gap-1.5 transition-colors min-h-[168px]"
                    >
                      <Plus size={26} />
                      <span className="text-sm">เพิ่ม LINE OA</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {showAddChannel && (
              <form onSubmit={addChannel} className={`${cardCls} space-y-3 max-w-xl`}>
                <h3 className="font-medium text-slate-100">เพิ่ม LINE OA</h3>
                <input className={inputCls} placeholder="ชื่อ OA (เช่น ร้านค้าหลัก)" value={channelForm.name} onChange={e => setChannelForm(f => ({ ...f, name: e.target.value }))} required />
                <input className={inputCls} placeholder="LINE ID (เช่น abc1234 ไม่ต้องใส่ @) — ไม่บังคับ" value={channelForm.lineId} onChange={e => setChannelForm(f => ({ ...f, lineId: e.target.value }))} />
                <input className={inputCls} placeholder="Channel ID" value={channelForm.channelId} onChange={e => setChannelForm(f => ({ ...f, channelId: e.target.value }))} required />
                <input className={inputCls} placeholder="Channel Secret" value={channelForm.channelSecret} onChange={e => setChannelForm(f => ({ ...f, channelSecret: e.target.value }))} required />
                <textarea className={inputCls} placeholder="Channel Access Token" rows={3} value={channelForm.accessToken} onChange={e => setChannelForm(f => ({ ...f, accessToken: e.target.value }))} required />
                <div>
                  <select
                    className={inputCls}
                    value={channelForm.categoryId}
                    onChange={e => { setChannelForm(f => ({ ...f, categoryId: e.target.value })); setNewChannelCategoryName(''); }}
                  >
                    <option value="">ไม่มีหมวดหมู่</option>
                    {channelCategories.map(cat => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                    <option value="__new__">+ เพิ่มหมวดหมู่ใหม่...</option>
                  </select>
                  {channelForm.categoryId === '__new__' && (
                    <input
                      autoFocus
                      className={`${inputCls} mt-2`}
                      placeholder="ชื่อหมวดหมู่ใหม่"
                      value={newChannelCategoryName}
                      onChange={e => setNewChannelCategoryName(e.target.value)}
                    />
                  )}
                </div>
                <div className="flex gap-2">
                  <button type="submit" disabled={saving} className="bg-gradient-to-r from-aurora-teal to-aurora-purple text-white rounded-lg px-4 py-2 text-sm hover:brightness-110 disabled:opacity-50">บันทึก</button>
                  <button type="button" onClick={() => setShowAddChannel(false)} className="text-sm text-slate-400 hover:text-slate-200 px-4 py-2">ยกเลิก</button>
                </div>
              </form>
            )}
          </div>
        )
      )}

      {/* Agents */}
      {tab === 'agents' && (
        <div className="max-w-5xl space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-2.5 min-w-[88px]">
              <p className="text-xl font-semibold text-slate-100 leading-tight">{agents.length}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">ทั้งหมด</p>
            </div>
            <div className="rounded-xl border border-aurora-purple/25 bg-aurora-purple/10 px-4 py-2.5 min-w-[88px]">
              <p className="text-xl font-bold text-white leading-tight">{agents.filter(a => a.role === 'admin').length}</p>
              <p className="text-[11px] text-aurora-cyan font-medium mt-0.5">แอดมิน</p>
            </div>
            <div className="rounded-xl border border-aurora-teal/25 bg-aurora-teal/10 px-4 py-2.5 min-w-[88px]">
              <p className="text-xl font-bold text-white leading-tight">{agents.filter(a => a.role !== 'admin').length}</p>
              <p className="text-[11px] text-aurora-teal font-medium mt-0.5">พนักงาน</p>
            </div>
            <div className="flex-1" />
            <div className="relative w-full sm:w-56">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
              <input
                className="w-full border border-slate-700 bg-slate-800 text-slate-100 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-aurora-teal placeholder:text-slate-500"
                placeholder="ค้นหาชื่อหรืออีเมล"
                value={agentSearch}
                onChange={e => setAgentSearch(e.target.value)}
                autoComplete="off"
                name="team-member-search"
                type="search"
              />
            </div>
            {agent?.role === 'admin' && (
              <button
                onClick={() => setShowAddAgent(v => !v)}
                className="flex items-center gap-1.5 bg-gradient-to-r from-aurora-teal to-aurora-purple text-white rounded-lg px-3.5 py-2 text-sm font-medium hover:brightness-110 transition-all flex-shrink-0"
              >
                <Plus size={16} /> เพิ่ม Agent
              </button>
            )}
          </div>

          {agent?.role === 'admin' && showAddAgent && (
            <form onSubmit={addAgent} className={`${cardCls} space-y-3 max-w-md`}>
              <h3 className="font-medium text-slate-100">เพิ่ม Agent</h3>
              <input className={inputCls} placeholder="ชื่อ" value={agentForm.name} onChange={e => setAgentForm(f => ({ ...f, name: e.target.value }))} required />
              <input type="email" className={inputCls} placeholder="Email" value={agentForm.email} onChange={e => setAgentForm(f => ({ ...f, email: e.target.value }))} required />
              <div className="relative">
                <input
                  type={showAgentPassword ? 'text' : 'password'}
                  className={`${inputCls} pr-10`}
                  placeholder="Password"
                  value={agentForm.password}
                  onChange={e => setAgentForm(f => ({ ...f, password: e.target.value }))}
                  required
                  autoComplete="new-password"
                  name="new-agent-password"
                />
                <button
                  type="button"
                  onClick={() => setShowAgentPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  {showAgentPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <select className={inputCls} value={agentForm.role} onChange={e => setAgentForm(f => ({ ...f, role: e.target.value }))}>
                <option value="agent">Agent</option>
                <option value="admin">Admin</option>
              </select>
              <select className={inputCls} value={agentForm.categoryId} onChange={e => setAgentForm(f => ({ ...f, categoryId: e.target.value }))}>
                <option value="">ยังไม่มีทีม</option>
                {agentCategories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <div className="flex gap-2">
                <button type="submit" disabled={saving} className="bg-gradient-to-r from-aurora-teal to-aurora-purple text-white rounded-lg px-4 py-2 text-sm hover:brightness-110 disabled:opacity-50">บันทึก</button>
                <button type="button" onClick={() => setShowAddAgent(false)} className="text-sm text-slate-400 px-4 py-2">ยกเลิก</button>
              </div>
            </form>
          )}

          {agent?.role === 'admin' && (
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">หมวดหมู่ทีมงาน</p>
              <button
                onClick={() => setShowAddAgentCategory(v => !v)}
                className="text-xs text-aurora-teal font-medium flex items-center gap-1 hover:brightness-110"
              >
                <Plus size={12} /> เพิ่มทีม
              </button>
            </div>
          )}

          {showAddAgentCategory && (
            <form onSubmit={addAgentCategory} className="flex items-center gap-2 max-w-md">
              <input
                autoFocus
                className={inputCls}
                placeholder="ชื่อทีม เช่น ทีมขาย A"
                value={agentCategoryName}
                onChange={e => setAgentCategoryName(e.target.value)}
              />
              <button type="submit" disabled={saving} className="bg-gradient-to-r from-aurora-teal to-aurora-purple text-white rounded-lg px-4 py-2 text-sm hover:brightness-110 disabled:opacity-50 whitespace-nowrap">บันทึก</button>
              <button type="button" onClick={() => { setShowAddAgentCategory(false); setAgentCategoryName(''); }} className="text-sm text-slate-400 hover:text-slate-200 px-2">ยกเลิก</button>
            </form>
          )}

          {(() => {
            const q = agentSearch.trim().toLowerCase();
            const matches = a => !q || a.name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q);
            const canManage = a => agent?.role === 'admin' && a.id !== agent?.id;
            const card = a => (
              <AgentCard
                key={a.id}
                a={a}
                canManage={canManage(a)}
                isMe={a.id === agent?.id}
                onEdit={() => setEditAgentTarget(a)}
                onDelete={() => deleteAgent(a.id)}
              />
            );
            // Section headings need to actually read as headings — bumped up from
            // the body-text size they were sharing with the card names before.
            const headingCls = 'text-base font-bold text-white';

            // Admins are never sorted into categories — they always stay pinned
            // in their own section up top, same as before this feature existed.
            const admins = agents.filter(a => a.role === 'admin' && matches(a));
            const nonAdmins = agents.filter(a => a.role !== 'admin');

            return (
              <div className="space-y-8">
                <div>
                  <p className={`${headingCls} mb-3`}>แอดมิน <span className="text-slate-500 font-medium text-sm">· {agents.filter(a => a.role === 'admin').length} คน</span></p>
                  {admins.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                      {admins.map(card)}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-600 px-1">ไม่พบรายชื่อที่ตรงกับ "{agentSearch}"</p>
                  )}
                </div>

                {agentCategories.length === 0 ? (
                  // No categories created yet — plain flat grid of non-admin agents.
                  <div>
                    <p className={`${headingCls} mb-3`}>พนักงาน <span className="text-slate-500 font-medium text-sm">· {nonAdmins.length} คน</span></p>
                    {(() => {
                      const visible = nonAdmins.filter(matches);
                      return visible.length === 0 ? (
                        <p className="text-sm text-slate-600 px-1">ไม่พบรายชื่อที่ตรงกับ "{agentSearch}"</p>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                          {visible.map(card)}
                        </div>
                      );
                    })()}
                  </div>
                ) : (
                  <div className="space-y-8">
                    {agentCategories.map((cat, i) => {
                      const allInCat = nonAdmins.filter(a => a.categoryId === cat.id);
                      const catAgents = allInCat.filter(matches);
                      return (
                        <div key={cat.id}>
                          <div className="flex items-center gap-2.5 mb-3 group">
                            {editingAgentCategoryId === cat.id ? (
                              <>
                                <input
                                  autoFocus
                                  className="border border-slate-700 bg-slate-800 text-slate-100 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-aurora-teal"
                                  value={editingAgentCategoryName}
                                  onChange={e => setEditingAgentCategoryName(e.target.value)}
                                  onKeyDown={e => e.key === 'Enter' && saveAgentCategoryEdit(cat.id)}
                                />
                                <button onClick={() => saveAgentCategoryEdit(cat.id)} className="text-aurora-teal"><Check size={14} /></button>
                                <button onClick={() => setEditingAgentCategoryId(null)} className="text-slate-500 hover:text-slate-300"><X size={14} /></button>
                              </>
                            ) : (
                              <>
                                {agent?.role === 'admin' && (
                                  <div className="flex flex-col -my-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                      onClick={() => moveAgentCategory(cat.id, 'up')}
                                      disabled={i === 0}
                                      className="text-slate-500 hover:text-slate-200 disabled:opacity-20 disabled:hover:text-slate-500 leading-none"
                                    >
                                      <ChevronUp size={14} />
                                    </button>
                                    <button
                                      onClick={() => moveAgentCategory(cat.id, 'down')}
                                      disabled={i === agentCategories.length - 1}
                                      className="text-slate-500 hover:text-slate-200 disabled:opacity-20 disabled:hover:text-slate-500 leading-none"
                                    >
                                      <ChevronDown size={14} />
                                    </button>
                                  </div>
                                )}
                                <p className={headingCls}>{cat.name}</p>
                                <span className="text-sm text-slate-500 font-medium">· {allInCat.length} คน</span>
                                {agent?.role === 'admin' && (
                                  <>
                                    <button onClick={() => startEditAgentCategory(cat)} className="text-slate-600 hover:text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity"><Pencil size={13} /></button>
                                    <button onClick={() => deleteAgentCategory(cat.id)} className="text-slate-600 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity"><X size={14} /></button>
                                  </>
                                )}
                              </>
                            )}
                          </div>
                          {catAgents.length > 0 ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                              {catAgents.map(card)}
                            </div>
                          ) : (
                            <p className="text-xs text-slate-600">
                              {q ? `ไม่พบรายชื่อที่ตรงกับ "${agentSearch}" ในหมวดหมู่นี้` : 'ยังไม่มีใครอยู่ในหมวดหมู่นี้ — ไปที่แก้ไขของแต่ละคนแล้วเลือกหมวดหมู่นี้'}
                            </p>
                          )}
                        </div>
                      );
                    })}

                    <div>
                      <p className={`${headingCls} mb-3`}>ยังไม่มีหมวดหมู่</p>
                      {(() => {
                        const uncategorized = nonAdmins.filter(a => !a.categoryId && matches(a));
                        return uncategorized.length > 0 ? (
                          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                            {uncategorized.map(card)}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-600">{q ? `ไม่พบรายชื่อที่ตรงกับ "${agentSearch}"` : 'ทุกคนถูกจัดหมวดหมู่แล้ว'}</p>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* Tags */}
      {tab === 'tags' && (
        <div className="space-y-4 max-w-2xl">
          <div className="flex flex-wrap gap-2">
            {tags.map(t => (
              <div key={t.id} className="flex items-center gap-1.5 rounded-full pl-3 pr-1.5 py-1.5 text-sm font-medium" style={{ backgroundColor: `${t.color}1a`, color: t.color }}>
                {t.name}
                <button onClick={() => deleteTag(t.id)} className="hover:opacity-70 w-4 h-4 flex items-center justify-center">
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            {tags.length === 0 && <p className="text-sm text-slate-500">ยังไม่มีแท็ก</p>}
          </div>

          <form onSubmit={addTag} className={`${cardCls} space-y-3`}>
            <h3 className="font-medium text-slate-100">สร้างแท็กใหม่</h3>
            <input className={inputCls} placeholder="ชื่อแท็ก เช่น VIP, สนใจซื้อ" value={tagForm.name} onChange={e => setTagForm(f => ({ ...f, name: e.target.value }))} required />
            <div>
              <p className="text-xs text-slate-400 mb-1.5">สี</p>
              <div className="flex gap-2">
                {TAG_COLOR_PRESETS.map(c => (
                  <button
                    type="button"
                    key={c}
                    onClick={() => setTagForm(f => ({ ...f, color: c }))}
                    className={`w-6 h-6 rounded-full ${tagForm.color === c ? 'ring-2 ring-offset-2 ring-offset-slate-900 ring-slate-400' : ''}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
            <button type="submit" disabled={saving} className="bg-gradient-to-r from-aurora-teal to-aurora-purple text-white rounded-lg px-4 py-2 text-sm hover:brightness-110 disabled:opacity-50">เพิ่มแท็ก</button>
          </form>
        </div>
      )}

      {/* Approved links — whitelist linkGuard.js checks outgoing agent messages
          against, flagging anything else in รายงาน > ตรวจสอบ. */}
      {tab === 'approved-links' && (
        <div className="space-y-4 max-w-2xl">
          <p className="text-sm text-slate-400">
            ระบบจะแจ้งเตือนในหน้ารายงาน &gt; ตรวจสอบ ทันทีที่พนักงานส่งลิงค์ที่ไม่อยู่ในรายการนี้ให้ลูกค้า — ใส่แค่โดเมนก็พอ (ไม่ต้องมี https:// หรือ path) ระบบจะอนุญาตทุก path/subdomain ของโดเมนนั้นให้อัตโนมัติ
          </p>
          <div className="space-y-2">
            {approvedLinks.map(l => (
              <div key={l.id} className={`${cardCls} flex items-center justify-between`}>
                <div className="flex items-center gap-2.5 min-w-0">
                  <Link2 size={16} className="text-aurora-teal flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-slate-100 truncate">{l.domain}</p>
                    {l.label && <p className="text-xs text-slate-500 truncate">{l.label}</p>}
                  </div>
                </div>
                <button onClick={() => deleteApprovedLink(l.id)} className="text-slate-500 hover:text-rose-400 flex-shrink-0">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            {approvedLinks.length === 0 && <p className="text-sm text-slate-500">ยังไม่มีโดเมนที่อนุญาต — ทุกลิงค์ที่พนักงานส่งจะถูกแจ้งเตือน</p>}
          </div>

          <form onSubmit={addApprovedLink} className={`${cardCls} space-y-3`}>
            <h3 className="font-medium text-slate-100">เพิ่มโดเมนที่อนุญาต</h3>
            <input
              className={inputCls}
              placeholder="โดเมน เช่น mysite.com"
              value={approvedLinkForm.domain}
              onChange={e => setApprovedLinkForm(f => ({ ...f, domain: e.target.value }))}
              required
            />
            <input
              className={inputCls}
              placeholder="หมายเหตุ (ถ้ามี) เช่น เว็บหลัก"
              value={approvedLinkForm.label}
              onChange={e => setApprovedLinkForm(f => ({ ...f, label: e.target.value }))}
            />
            {error && <p className="text-sm text-rose-400">{error}</p>}
            <button type="submit" disabled={saving} className="bg-gradient-to-r from-aurora-teal to-aurora-purple text-white rounded-lg px-4 py-2 text-sm hover:brightness-110 disabled:opacity-50">
              เพิ่มโดเมน
            </button>
          </form>
        </div>
      )}

      {/* System — "ระบบ" */}
      {tab === 'system' && (
        <div className="space-y-4 max-w-2xl">
          <div className={cardCls}>
            <h3 className="font-medium text-slate-100 mb-1">Grace window สำหรับรายงาน "อ่านแล้วไม่ตอบ"</h3>
            <p className="text-sm text-slate-400 mb-4">
              เมื่อลูกค้าส่งข้อความ นับจากเวลานั้นเป็นต้นไป ถ้ามีพนักงานคนใดคนหนึ่งในบรรดาผู้ที่เปิดดูแชทนั้นตอบกลับภายในเวลาที่ตั้งไว้นี้
              ทุกคนที่เปิดดูจะไม่โดนนับว่า "อ่านแล้วไม่ตอบ" ในรายงาน พนักงาน (เพราะลูกค้าได้รับการตอบแล้วจริง) —
              แต่ถ้าเลยเวลานี้ไปแล้วยังไม่มีใครตอบเลย ทุกคนที่เปิดดูแชทนั้นจะถูกนับในรายงานตามเดิม
            </p>
            {agent?.role === 'admin' ? (
              <form onSubmit={saveSystemSettings} className="flex items-end gap-3 flex-wrap">
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Grace window (วินาที)</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    className={`${inputCls} w-32`}
                    value={graceInput}
                    onChange={e => setGraceInput(e.target.value)}
                  />
                </div>
                <button
                  type="submit"
                  disabled={savingSystemSettings || graceInput === '' || (systemSettings && String(systemSettings.agentConductGraceSeconds) === graceInput)}
                  className="bg-gradient-to-r from-aurora-teal to-aurora-purple text-white rounded-lg px-4 py-2 text-sm hover:brightness-110 disabled:opacity-50"
                >
                  {savingSystemSettings ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
                {systemSettingsSaved && <span className="text-sm text-aurora-teal flex items-center gap-1"><Check size={14} /> บันทึกแล้ว</span>}
              </form>
            ) : (
              <p className="text-sm text-slate-100">
                ค่าปัจจุบัน: {systemSettings ? `${systemSettings.agentConductGraceSeconds} วินาที` : '...'}
                <span className="text-slate-500"> (เฉพาะแอดมินเท่านั้นที่แก้ไขได้)</span>
              </p>
            )}
          </div>
        </div>
      )}

      <DeleteChannelModal channel={deleteTarget} onCancel={() => setDeleteTarget(null)} onConfirm={confirmDeleteChannel} />
      {editAgentTarget && (
        <AgentEditModal
          agentItem={editAgentTarget}
          channels={channels}
          categories={agentCategories}
          onSave={saveAgentEdit}
          onClose={() => setEditAgentTarget(null)}
          t={t}
        />
      )}
    </div>
  );
}
