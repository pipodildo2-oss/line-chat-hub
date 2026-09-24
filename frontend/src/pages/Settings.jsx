import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { Plus, Trash2, Copy, Check, Users, MessageSquare, Tag as TagIcon, AlertTriangle, ArrowLeft, QrCode, MessageCircle, Eye, EyeOff, Pencil, X, ExternalLink, Search, Link2, ChevronUp, ChevronDown, Cog, Send } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useSocket } from '../contexts/SocketContext';
import { TAG_COLOR_PRESETS } from '../lib/constants';

// Settings > "ระบบ" > บังคับใช้ 2FA — matches backend/src/lib/systemSettings.js's
// TWO_FACTOR_REQUIRED_SCOPES exactly ('all'/'admin'/'agent' scope values
// double as Agent.role for the latter two, see roleIsInTwoFactorScope there).
const TWO_FACTOR_SCOPE_OPTIONS = [
  { key: 'off', label: 'ปิดใช้งาน' },
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'admin', label: 'เฉพาะ Admin' },
  { key: 'agent', label: 'เฉพาะ Agent' },
];

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  function copy(e) {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button type="button" onClick={copy} className="text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 flex-shrink-0">
      {copied ? <Check size={14} className="text-aurora-teal" /> : <Copy size={14} />}
    </button>
  );
}

function ChannelListCard({ channel, onManage }) {
  const isActive = channel.active !== false;
  return (
    <div className={`relative rounded-xl border border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 min-h-[168px] flex flex-col gap-4 ${!isActive ? 'opacity-60' : ''}`}>
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
            <p className="font-semibold text-gray-900 dark:text-slate-100 text-base truncate">{channel.name}</p>
            {!isActive && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 dark:bg-slate-700 text-gray-600 dark:text-slate-300 font-medium flex-shrink-0" title="หยุดรับ-ส่งข้อความชั่วคราว แชทเดิมยังอยู่ครบ">
                ปิดใช้งาน
              </span>
            )}
          </div>
          <p className="text-sm text-gray-400 dark:text-slate-500 truncate mt-0.5">LINE (ID: {channel.lineId || '—'})</p>
        </div>
        <div className="w-11 h-11 rounded-full bg-gradient-to-br from-aurora-teal to-aurora-purple flex items-center justify-center text-white flex-shrink-0">
          <MessageCircle size={20} />
        </div>
      </div>
      <div className="flex-1" />
      <div className="border-t border-gray-100 dark:border-slate-800 pt-3 flex justify-end">
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

  const fieldCls = 'w-full border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-aurora-teal placeholder:text-gray-400 dark:placeholder:text-slate-500';
  const labelCls = 'text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5 block';
  const readonlyCls = 'w-full border border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-800/50 text-gray-400 dark:text-slate-500 rounded-lg px-3 py-2 text-sm cursor-not-allowed';

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
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 mb-4">
        <ArrowLeft size={15} /> กลับไปหน้ารายการ
      </button>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-0.5">ตั้งค่า LINE OA</h2>
      <p className="text-sm text-gray-400 dark:text-slate-500 mb-6">จัดการข้อมูลและการตั้งค่าของช่องทางนี้</p>

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
              <div className="flex-1 border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 rounded-lg px-3 py-2 flex items-center gap-2">
                <code className="text-sm text-gray-600 dark:text-slate-300 flex-1 truncate">{chatLink}</code>
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
                className="mt-2 rounded-lg border border-gray-200 dark:border-slate-700 null dark:bg-white p-2"
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
          <div className="flex items-center gap-2 border border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-800/50 rounded-lg px-3 py-2">
            <code className="text-sm text-gray-500 dark:text-slate-400 flex-1 truncate">{webhookUrl}</code>
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

      <div className="mt-8 pt-6 border-t border-gray-100 dark:border-slate-800">
        <h3 className="font-semibold text-gray-900 dark:text-slate-100 mb-1">ปิดใช้งานช่องทาง</h3>
        <p className="text-xs text-gray-400 dark:text-slate-500 mb-3">
          หยุดรับ-ส่งข้อความผ่านช่องทางนี้ชั่วคราว แต่แชทและข้อความเดิมทั้งหมดยังอยู่ครบ กดเปิดใช้งานกลับมาได้ทุกเมื่อ
          — ใช้ตัวนี้แทนการลบ ถ้าไม่แน่ใจหรือแค่อยากพักช่องทางไว้ก่อน
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={handleToggleActive}
            disabled={togglingActive}
            className={`relative inline-flex overflow-hidden w-11 h-6 rounded-full transition-colors flex-shrink-0 disabled:opacity-50 ${isActive ? 'bg-gradient-to-r from-aurora-teal to-aurora-purple' : 'bg-gray-200 dark:bg-slate-700'}`}
          >
            <span className={`absolute left-0.5 top-0.5 w-5 h-5 rounded-full null dark:bg-white transition-transform ${isActive ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
          <span className="text-sm text-gray-600 dark:text-slate-300">
            {isActive ? 'เปิดใช้งานอยู่' : 'ปิดใช้งานอยู่'}
          </span>
        </div>
      </div>

      <div className="mt-8 pt-6 border-t border-gray-100 dark:border-slate-800">
        <h3 className="font-semibold text-gray-900 dark:text-slate-100 mb-3">Danger Zone</h3>
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
      <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-xl p-5 w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <h3 className="font-semibold text-gray-900 dark:text-slate-100 mb-1.5">ลบ "{channel.name}" ถาวร?</h3>
        <p className="text-sm text-gray-500 dark:text-slate-400 mb-3">
          {convCount > 0
            ? `การสนทนาทั้งหมด ${convCount} รายการและข้อความในนั้นจะถูกลบถาวรไปด้วย กู้คืนไม่ได้`
            : 'การกระทำนี้กู้คืนไม่ได้'}
        </p>
        <p className="text-xs text-gray-500 dark:text-slate-400 mb-1.5">พิมพ์ <span className="font-semibold text-gray-700 dark:text-slate-200">{channel.name}</span> เพื่อยืนยันการลบ</p>
        <input
          autoFocus
          className="w-full border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500 mb-3"
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
          <button onClick={onCancel} className="text-sm text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 px-4 py-2">ยกเลิก</button>
        </div>
      </div>
    </div>
  );
}

// Shown right after "เพิ่ม LINE OA" successfully creates a channel — the
// admin's very next step is always pasting this exact URL into LINE
// Developers Console's Messaging API > Webhook settings, and previously the
// only way to find it again was to open Manage on the channel they just
// created. Same webhookUrl format/copy affordance as ChannelConfigure's own
// "Webhook URL" field (see there) so this isn't a second, drifting source
// of truth for how that URL is built.
function NewChannelWebhookModal({ channelName, webhookUrl, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-xl p-5 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-1.5">
          <div className="w-7 h-7 rounded-full bg-aurora-teal/15 flex items-center justify-center flex-shrink-0">
            <Check size={14} className="text-aurora-teal" />
          </div>
          <h3 className="font-semibold text-gray-900 dark:text-slate-100">เพิ่ม "{channelName}" สำเร็จ</h3>
        </div>
        <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">
          เอา Webhook URL ด้านล่างไปวางในหน้า Messaging API ของ LINE Developers Console แล้วเปิด <span className="font-medium">"Use webhook"</span> กับ{' '}
          <span className="font-medium">"Use webhook redelivery"</span> ด้วย
        </p>

        <label className="text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5 block">Webhook URL</label>
        <div className="flex items-center gap-2 border border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-800/50 rounded-lg px-3 py-2 mb-4">
          <code className="text-sm text-gray-500 dark:text-slate-400 flex-1 truncate">{webhookUrl}</code>
          <CopyButton text={webhookUrl} />
        </div>

        <div className="flex items-center justify-between">
          <a
            href="https://developers.line.biz/console/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm font-medium text-aurora-teal hover:brightness-110"
          >
            เปิด LINE Developers Console <ExternalLink size={13} />
          </a>
          <button
            onClick={onClose}
            className="bg-gradient-to-r from-aurora-teal to-aurora-purple text-white rounded-lg px-4 py-2 text-sm font-medium hover:brightness-110 transition-all"
          >
            เสร็จสิ้น
          </button>
        </div>
      </div>
    </div>
  );
}

function AgentCard({ a, canManage, isMe, online, onEdit, onDelete }) {
  return (
    <div className="group relative rounded-xl border border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 hover:border-gray-200 dark:hover:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800/30 transition-colors">
      {canManage && (
        <div className="absolute top-3 right-3 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={onEdit} title="แก้ไข" className="p-1.5 text-gray-400 dark:text-slate-500 hover:text-gray-700 dark:hover:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-800 rounded-lg transition-colors">
            <Pencil size={13} />
          </button>
          <button onClick={onDelete} title="ลบ" className="p-1.5 text-gray-400 dark:text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors">
            <Trash2 size={13} />
          </button>
        </div>
      )}
      <div className="flex items-center gap-3">
        <div className="relative flex-shrink-0">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-aurora-teal to-aurora-purple flex items-center justify-center text-white text-sm font-semibold ring-2 ring-gray-200 dark:ring-slate-950/60">
            {a.name[0].toUpperCase()}
          </div>
          {/* 'away' — auto-set by AfkTracker.jsx when this agent's own
              browser sat idle past Settings > "ระบบ"'s afkMinutes and it
              logged them out; not something anyone picks manually (see
              Sidebar.jsx's status dropdown, which never offers it) — this
              dot is the only place a teammate sees it happened. Takes
              priority over the online dot below when both could apply
              (the stored status field can briefly lag the socket actually
              closing). */}
          {a.status === 'away' ? (
            <span
              title="ไม่อยู่หน้าจอ (ออกจากระบบอัตโนมัติเนื่องจากไม่มีการใช้งาน)"
              className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-orange-400 ring-2 ring-white dark:ring-slate-900"
            />
          ) : online ? (
            // Live connection presence (backend/src/lib/presence.js) — true
            // only while a socket is actually open, unlike `a.status` which
            // is a stored value that can go stale. No dot at all = offline,
            // the implicit default, kept quiet rather than drawn as a chip
            // for every single teammate not currently connected.
            <span
              title="ออนไลน์อยู่ตอนนี้"
              className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-400 ring-2 ring-white dark:ring-slate-900"
            />
          ) : null}
        </div>
        <div className="min-w-0 flex-1 pr-9">
          <p className="font-medium text-gray-900 dark:text-slate-100 text-sm truncate">{a.name}</p>
          <p className="text-xs text-gray-400 dark:text-slate-500 truncate mt-0.5">{a.email}</p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 mt-3">
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${a.role === 'admin' ? 'bg-aurora-tealDeep/20 text-aurora-cyan' : 'bg-aurora-teal/15 text-aurora-teal'}`}>
          {a.role === 'admin' ? 'Admin' : 'Agent'}
        </span>
        {isMe && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-50 dark:bg-slate-800 text-gray-500 dark:text-slate-400 font-medium">คุณ</span>
        )}
        {a.status === 'away' ? (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-500/15 text-orange-600 dark:text-orange-400 font-medium">ไม่อยู่หน้าจอ</span>
        ) : online ? (
          <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-600 dark:text-green-400 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400" /> ออนไลน์
          </span>
        ) : null}
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
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(!!agentItem.twoFactorEnabled);
  const [resettingTwoFactor, setResettingTwoFactor] = useState(false);
  const [twoFactorResetDone, setTwoFactorResetDone] = useState(false);
  const [error, setError] = useState('');

  const fieldCls = 'w-full border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-aurora-teal placeholder:text-gray-400 dark:placeholder:text-slate-500';
  const labelCls = 'text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5 block';

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

  // Only ever needed if this agent has lost both their authenticator device
  // AND their backup codes — clears their 2FA so they can set it up fresh
  // on next login (see routes/agents.js POST /:id/2fa/reset). Their
  // password is untouched.
  async function handleResetTwoFactor() {
    setResettingTwoFactor(true); setError('');
    try {
      await axios.post(`/api/agents/${agentItem.id}/2fa/reset`);
      setTwoFactorEnabled(false);
      setTwoFactorResetDone(true);
      setTimeout(() => setTwoFactorResetDone(false), 2000);
    } catch (err) {
      setError(err.response?.data?.error || 'เกิดข้อผิดพลาด');
    } finally { setResettingTwoFactor(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-xl p-5 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-slate-100">{agentItem.name}</h3>
            <p className="text-xs text-gray-400 dark:text-slate-500">{agentItem.email}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300"><X size={18} /></button>
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
            <div className="border border-gray-200 dark:border-slate-700 rounded-lg p-2 space-y-1 max-h-40 overflow-y-auto">
              {channels.map(ch => (
                <label key={ch.id} className="flex items-center gap-2 text-sm px-1.5 py-1 rounded hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer text-gray-700 dark:text-slate-200">
                  <input type="checkbox" checked={selectedIds.includes(ch.id)} onChange={() => toggleChannel(ch.id)} className="accent-aurora-teal" />
                  {ch.name}
                </label>
              ))}
              {channels.length === 0 && <p className="text-xs text-gray-400 dark:text-slate-500 px-1.5 py-1">ยังไม่มีช่องทาง</p>}
            </div>
            <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1">ไม่เลือก = มองเห็นทุกช่องทาง</p>
          </div>

          <div className="border-t border-gray-100 dark:border-slate-800 pt-4">
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
                <button type="button" onClick={() => setShowPw(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300">
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

          <div className="border-t border-gray-100 dark:border-slate-800 pt-4">
            <div className="flex items-center justify-between mb-1.5">
              <label className={labelCls + ' mb-0'}>2FA</label>
              <span className={`text-[11px] font-medium ${twoFactorEnabled ? 'text-aurora-teal' : 'text-gray-400 dark:text-slate-500'}`}>
                {twoFactorEnabled ? 'เปิดใช้งานอยู่' : 'ยังไม่ได้เปิดใช้งาน'}
              </span>
            </div>
            {twoFactorEnabled ? (
              <>
                <button
                  type="button"
                  onClick={handleResetTwoFactor}
                  disabled={resettingTwoFactor}
                  className="text-sm text-rose-400 hover:text-rose-300 font-medium border border-rose-500/30 rounded-lg px-3 py-2 hover:bg-rose-500/10 disabled:opacity-40 transition-colors"
                >
                  {resettingTwoFactor ? 'กำลังรีเซ็ต...' : 'รีเซ็ต 2FA'}
                </button>
                <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1.5">
                  ใช้เมื่อพนักงานทำมือถือหายและใช้รหัสสำรองไม่ได้แล้ว — พนักงานจะตั้งค่า 2FA ใหม่ได้ในครั้งถัดไปที่ล็อกอิน รหัสผ่านจะไม่เปลี่ยน
                </p>
                {twoFactorResetDone && <span className="flex items-center gap-1 text-xs text-aurora-teal mt-1.5"><Check size={13} /> รีเซ็ตแล้ว</span>}
              </>
            ) : (
              <p className="text-[11px] text-gray-400 dark:text-slate-500">พนักงานคนนี้ยังไม่ได้ตั้งค่า 2FA ของตัวเอง</p>
            )}
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
          <button onClick={onClose} className="text-sm text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 px-4 py-2">{t('cancel')}</button>
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

// Settings > "ระบบ" > Telegram — admin config for the monthly
// "คะแนนอัพเซลล์" notification (see backend/src/lib/telegramReport.js for
// what actually gets sent: one header message + one message per team, sent
// on the configured day/time each month). Self-contained (own fetch/save)
// rather than threading more state through the parent Settings component,
// same reasoning as QuickReplyPicker/EmojiPicker elsewhere in this file.
function TelegramReportSettings({ agent, inputCls, cardCls }) {
  const [settings, setSettings] = useState(null);
  const [botTokenInput, setBotTokenInput] = useState(''); // write-only — never pre-filled from the server, see systemSettings.js
  const [chatIdInput, setChatIdInput] = useState('');
  const [enabledInput, setEnabledInput] = useState(false);
  const [dayInput, setDayInput] = useState('1');
  const [hourInput, setHourInput] = useState('9');
  const [minuteInput, setMinuteInput] = useState('0');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null); // { ok: true } | { ok: false, error }
  const [sendingNow, setSendingNow] = useState(false);
  const [sendNowResult, setSendNowResult] = useState(null);

  function load() {
    axios.get('/api/settings/telegram').then(r => {
      setSettings(r.data);
      setChatIdInput(r.data.chatId || '');
      setEnabledInput(r.data.enabled);
      setDayInput(String(r.data.day));
      setHourInput(String(r.data.hour));
      setMinuteInput(String(r.data.minute));
    }).catch(() => {});
  }
  useEffect(() => { if (agent?.role === 'admin') load(); }, [agent?.role]);

  async function handleSave(e) {
    e.preventDefault();
    const day = Number(dayInput), hour = Number(hourInput), minute = Number(minuteInput);
    if (!Number.isInteger(day) || day < 1 || day > 28) return setError('วันที่ต้องเป็นจำนวนเต็ม ระหว่าง 1-28');
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) return setError('ชั่วโมงต้องเป็นจำนวนเต็ม ระหว่าง 0-23');
    if (!Number.isInteger(minute) || minute < 0 || minute > 59) return setError('นาทีต้องเป็นจำนวนเต็ม ระหว่าง 0-59');
    if (!chatIdInput.trim()) return setError('กรุณาใส่ Chat ID');

    setSaving(true); setError('');
    try {
      const { data } = await axios.patch('/api/settings/telegram', {
        ...(botTokenInput.trim() ? { botToken: botTokenInput.trim() } : {}),
        chatId: chatIdInput.trim(),
        enabled: enabledInput,
        day, hour, minute,
      });
      setSettings(data);
      setBotTokenInput('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err.response?.data?.error || 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true); setTestResult(null);
    try {
      await axios.post('/api/settings/telegram/test');
      setTestResult({ ok: true });
    } catch (err) {
      setTestResult({ ok: false, error: err.response?.data?.error || 'ทดสอบส่งไม่สำเร็จ' });
    } finally {
      setTesting(false);
    }
  }

  async function handleSendNow() {
    if (!confirm('ส่งรายงานคะแนนอัพเซลล์ของเดือนที่แล้วเข้ากลุ่ม Telegram ตอนนี้เลยหรือไม่?')) return;
    setSendingNow(true); setSendNowResult(null);
    try {
      const { data } = await axios.post('/api/settings/telegram/send-now');
      setSendNowResult({ ok: true, ...data });
      load(); // picks up the updated lastSentPeriod
    } catch (err) {
      setSendNowResult({ ok: false, error: err.response?.data?.error || 'ส่งไม่สำเร็จ' });
    } finally {
      setSendingNow(false);
    }
  }

  if (agent?.role !== 'admin') {
    return (
      <div className={cardCls}>
        <h3 className="font-medium text-gray-900 dark:text-slate-100 mb-1">แจ้งเตือนคะแนนอัพเซลล์ทาง Telegram</h3>
        <p className="text-sm text-gray-900 dark:text-slate-100">เฉพาะแอดมินเท่านั้นที่ตั้งค่าได้</p>
      </div>
    );
  }

  return (
    <div className={cardCls}>
      <h3 className="font-medium text-gray-900 dark:text-slate-100 mb-1">แจ้งเตือนคะแนนอัพเซลล์ทาง Telegram</h3>
      <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">
        ส่งสรุปคะแนนอัพเซลล์ของเดือนที่แล้วเข้ากลุ่ม Telegram อัตโนมัติตามวัน/เวลาที่ตั้งไว้ — แบ่งส่งเป็นข้อความละทีม เรียงอันดับเหมือนหน้าคะแนนอัพเซลล์
      </p>

      {error && <div className="bg-rose-500/10 text-rose-400 text-sm px-3 py-2 rounded-lg mb-3">{error}</div>}

      <form onSubmit={handleSave} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-400 dark:text-slate-500 block mb-1">Bot Token</label>
            <input
              type="password"
              className={inputCls}
              placeholder={settings?.hasToken ? 'ตั้งค่าไว้แล้ว (เว้นว่างไว้เพื่อไม่เปลี่ยน)' : 'วางค่าจาก @BotFather'}
              value={botTokenInput}
              onChange={e => setBotTokenInput(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 dark:text-slate-500 block mb-1">Chat ID (กลุ่มที่จะส่งเข้าไป)</label>
            <input
              className={inputCls}
              placeholder="เช่น -1001234567890"
              value={chatIdInput}
              onChange={e => setChatIdInput(e.target.value)}
            />
          </div>
        </div>

        <div className="flex items-end gap-3 flex-wrap">
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300 select-none">
            <input type="checkbox" checked={enabledInput} onChange={e => setEnabledInput(e.target.checked)} className="rounded" />
            เปิดใช้งานการส่งอัตโนมัติ
          </label>
          <div>
            <label className="text-xs text-gray-400 dark:text-slate-500 block mb-1">วันที่ของเดือน</label>
            <input type="number" min="1" max="28" step="1" className={`${inputCls} w-20`} value={dayInput} onChange={e => setDayInput(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-gray-400 dark:text-slate-500 block mb-1">ชั่วโมง (0-23)</label>
            <input type="number" min="0" max="23" step="1" className={`${inputCls} w-20`} value={hourInput} onChange={e => setHourInput(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-gray-400 dark:text-slate-500 block mb-1">นาที (0-59)</label>
            <input type="number" min="0" max="59" step="1" className={`${inputCls} w-20`} value={minuteInput} onChange={e => setMinuteInput(e.target.value)} />
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap pt-1">
          <button type="submit" disabled={saving} className="bg-gradient-to-r from-aurora-teal to-aurora-purple text-white rounded-lg px-4 py-2 text-sm hover:brightness-110 disabled:opacity-50">
            {saving ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
          {saved && <span className="text-sm text-aurora-teal flex items-center gap-1"><Check size={14} /> บันทึกแล้ว</span>}

          <button type="button" onClick={handleTest} disabled={testing || !settings?.hasToken} title={!settings?.hasToken ? 'บันทึก Bot Token ก่อน' : undefined} className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800 disabled:opacity-50">
            <Send size={13} /> {testing ? 'กำลังทดสอบ...' : 'ทดสอบส่งข้อความ'}
          </button>

          <button type="button" onClick={handleSendNow} disabled={sendingNow || !settings?.hasToken} title={!settings?.hasToken ? 'บันทึก Bot Token ก่อน' : undefined} className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800 disabled:opacity-50">
            <Send size={13} /> {sendingNow ? 'กำลังส่ง...' : 'ส่งรายงานเดือนที่แล้วตอนนี้'}
          </button>
        </div>

        {testResult && (
          <p className={`text-sm ${testResult.ok ? 'text-aurora-teal' : 'text-rose-400'}`}>
            {testResult.ok ? '✅ ส่งข้อความทดสอบสำเร็จ ตรวจสอบในกลุ่ม Telegram ได้เลย' : `❌ ${testResult.error}`}
          </p>
        )}
        {sendNowResult && (
          <p className={`text-sm ${sendNowResult.ok ? 'text-aurora-teal' : 'text-rose-400'}`}>
            {sendNowResult.ok
              ? `✅ ส่งรายงาน ${sendNowResult.periodLabel} แล้ว (${sendNowResult.teamCount} ทีม · ${sendNowResult.totalApproved} รายการ · ${sendNowResult.totalAmount.toLocaleString()} บาท)`
              : `❌ ${sendNowResult.error}`}
          </p>
        )}

        {settings?.lastSentPeriod && (
          <p className="text-xs text-gray-400 dark:text-slate-500">ส่งล่าสุดสำหรับช่วง: {settings.lastSentPeriod}</p>
        )}
      </form>
    </div>
  );
}

export default function Settings() {
  const { tab } = useParams();
  const { agent } = useAuth();
  const { t } = useLanguage();
  const { socket } = useSocket();
  const [channels, setChannels] = useState([]);
  const [agents, setAgents] = useState([]);
  // Live "ออนไลน์" presence on the ทีมงาน page — a Set of agent ids with at
  // least one open socket right now (backend/src/lib/presence.js), separate
  // from each agent's own `status` field. Seeded once from the server, then
  // kept current purely from 'agent_presence' events — no polling.
  const [onlineIds, setOnlineIds] = useState(() => new Set());
  const [tags, setTags] = useState([]);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [manageChannelId, setManageChannelId] = useState(null);
  const [editAgentTarget, setEditAgentTarget] = useState(null);
  const [showAddChannel, setShowAddChannel] = useState(false);
  // Set right after a channel is successfully created — see addChannel and
  // NewChannelWebhookModal. null hides the popup.
  const [newChannelWebhook, setNewChannelWebhook] = useState(null); // { channelName, webhookUrl }
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
  // graceInput/thresholdInput are each field's own draft value, kept separate
  // from systemSettings (the last-saved value from the server) so typing a
  // new number doesn't look "saved" until its PATCH actually succeeds. Two
  // independent saving/saved flags so submitting one field's form doesn't
  // show a stray "บันทึกแล้ว" on the other.
  const [systemSettings, setSystemSettings] = useState(null);
  const [graceInput, setGraceInput] = useState('');
  const [savingSystemSettings, setSavingSystemSettings] = useState(false);
  const [systemSettingsSaved, setSystemSettingsSaved] = useState(false);
  const [thresholdInput, setThresholdInput] = useState('');
  const [savingThreshold, setSavingThreshold] = useState(false);
  const [thresholdSaved, setThresholdSaved] = useState(false);
  // AFK auto-logout timeout (minutes) — same independent-field-save pattern
  // as grace/threshold above. 0 = feature off.
  const [afkInput, setAfkInput] = useState('');
  const [savingAfk, setSavingAfk] = useState(false);
  const [afkSaved, setAfkSaved] = useState(false);
  // "บังคับใช้ 2FA" — a plain boolean, so it saves the moment it's clicked
  // rather than needing a draft-input + separate save button like the
  // number fields above.
  const [savingTwoFactorRequired, setSavingTwoFactorRequired] = useState(false);
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
    axios.get('/api/agents/online-ids').then(r => setOnlineIds(new Set(r.data.ids))).catch(() => {});
    axios.get('/api/tags').then(r => setTags(r.data));
    axios.get('/api/channel-categories').then(r => setChannelCategories(r.data));
    axios.get('/api/channel-category-groups').then(r => setChannelCategoryGroups(r.data));
    axios.get('/api/agent-categories').then(r => setAgentCategories(r.data));
    axios.get('/api/approved-links').then(r => setApprovedLinks(r.data)).catch(() => {});
    axios.get('/api/settings/system').then(r => {
      setSystemSettings(r.data);
      setGraceInput(String(r.data.agentConductGraceSeconds));
      setThresholdInput(String(r.data.responseRateThresholdPercent));
      setAfkInput(String(r.data.afkMinutes));
    }).catch(() => {});
  }, []);

  // Keeps onlineIds current after the initial seed above — no polling, just
  // the two events index.js emits when an agent's room goes from 0→1 or
  // 1→0 open sockets cluster-wide (see lib/presence.js).
  useEffect(() => {
    if (!socket) return;
    function onPresence({ agentId, online }) {
      setOnlineIds(prev => {
        const next = new Set(prev);
        if (online) next.add(agentId); else next.delete(agentId);
        return next;
      });
    }
    socket.on('agent_presence', onPresence);
    return () => socket.off('agent_presence', onPresence);
  }, [socket]);

  // Keeps name/avatar/status current after the initial fetch above — a
  // teammate editing their own profile elsewhere shouldn't need everyone
  // else to reload this page to see it (backend/src/routes/agents.js
  // PATCH /me and /me/avatar).
  useEffect(() => {
    if (!socket) return;
    function onAgentUpdated(patch) {
      setAgents(prev => prev.map(a => (a.id === patch.id ? { ...a, ...patch } : a)));
    }
    socket.on('agent_updated', onAgentUpdated);
    return () => socket.off('agent_updated', onAgentUpdated);
  }, [socket]);

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
                className="border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-slate-100 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-aurora-teal"
                value={editingChannelCategoryName}
                onChange={e => setEditingChannelCategoryName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && saveChannelCategoryEdit(cat.id)}
              />
              <button onClick={() => saveChannelCategoryEdit(cat.id)} className="text-aurora-teal"><Check size={14} /></button>
              <button onClick={() => setEditingChannelCategoryId(null)} className="text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300"><X size={14} /></button>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-gray-700 dark:text-slate-200">{cat.name}</p>
              <span className="text-[10px] text-gray-400 dark:text-slate-500">{catChannels.length} ไลน์</span>
              <button onClick={() => startEditChannelCategory(cat)} className="text-gray-300 dark:text-slate-600 hover:text-gray-600 dark:hover:text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity"><Pencil size={12} /></button>
              <button onClick={() => deleteChannelCategory(cat.id)} className="text-gray-300 dark:text-slate-600 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity"><X size={13} /></button>
              {channelCategoryGroups.length > 0 && (
                <select
                  className="text-[11px] bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400 rounded-md px-1.5 py-0.5 ml-1 focus:outline-none focus:ring-1 focus:ring-aurora-teal"
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
          <p className="text-xs text-gray-300 dark:text-slate-600">ยังไม่มีไลน์ในหมวดหมู่นี้ — ไปที่ Manage ของไลน์แล้วเลือกหมวดหมู่นี้</p>
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
      // Same URL shape as ChannelConfigure's own "Webhook URL" field — see
      // NewChannelWebhookModal's own comment on why this is shown right away
      // instead of only inside Manage.
      setNewChannelWebhook({ channelName: data.name, webhookUrl: `${window.location.origin}/api/webhooks/line/${data.id}` });
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

  async function saveResponseRateThreshold(e) {
    e.preventDefault();
    const percent = Number(thresholdInput);
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
      setError('เกณฑ์อัตราตอบขั้นต่ำต้องเป็นจำนวนเต็ม ระหว่าง 0-100');
      return;
    }
    setSavingThreshold(true); setError('');
    try {
      const { data } = await axios.patch('/api/settings/system', { responseRateThresholdPercent: percent });
      setSystemSettings(data);
      setThresholdInput(String(data.responseRateThresholdPercent));
      setThresholdSaved(true);
      setTimeout(() => setThresholdSaved(false), 2000);
    } catch (err) {
      setError(err.response?.data?.error || 'บันทึกไม่สำเร็จ');
    } finally {
      setSavingThreshold(false);
    }
  }

  async function saveAfkMinutes(e) {
    e.preventDefault();
    const minutes = Number(afkInput);
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) {
      setError('เวลา AFK ต้องเป็นจำนวนเต็มนาที ระหว่าง 0-1440 (0 = ปิดใช้งาน)');
      return;
    }
    setSavingAfk(true); setError('');
    try {
      const { data } = await axios.patch('/api/settings/system', { afkMinutes: minutes });
      setSystemSettings(data);
      setAfkInput(String(data.afkMinutes));
      setAfkSaved(true);
      setTimeout(() => setAfkSaved(false), 2000);
    } catch (err) {
      setError(err.response?.data?.error || 'บันทึกไม่สำเร็จ');
    } finally {
      setSavingAfk(false);
    }
  }

  async function setTwoFactorRequiredScope(scope) {
    if (scope === systemSettings?.twoFactorRequiredScope) return;
    setSavingTwoFactorRequired(true); setError('');
    try {
      const { data } = await axios.patch('/api/settings/system', { twoFactorRequiredScope: scope });
      setSystemSettings(data);
    } catch (err) {
      setError(err.response?.data?.error || 'บันทึกไม่สำเร็จ');
    } finally {
      setSavingTwoFactorRequired(false);
    }
  }

  const inputCls = 'w-full border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-aurora-teal placeholder:text-gray-400 dark:placeholder:text-slate-500';
  const cardCls = 'bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-xl p-4';
  const CATEGORIES = useCategories();
  const active = CATEGORIES[tab] || CATEGORIES.channels;
  const manageChannel = channels.find(c => c.id === manageChannelId);

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex items-center gap-2 mb-6">
        <active.icon size={18} className="text-gray-400 dark:text-slate-500" />
        <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100">{active.label}</h2>
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
            <div className="flex items-center justify-between flex-wrap gap-3">
              <button
                onClick={() => setShowAddChannel(true)}
                className="flex items-center gap-1.5 bg-gradient-to-r from-aurora-teal to-aurora-purple text-white rounded-lg px-4 py-2 text-sm font-medium hover:brightness-110"
              >
                <Plus size={15} /> เพิ่ม LINE OA
              </button>
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
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500 -mt-3">หมวดหมู่ไลน์ OA</p>

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
                <button type="button" onClick={() => { setShowAddChannelCategoryGroup(false); setChannelCategoryGroupName(''); }} className="text-sm text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 px-2">ยกเลิก</button>
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
                <button type="button" onClick={() => { setShowAddChannelCategory(false); setChannelCategoryName(''); }} className="text-sm text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 px-2">ยกเลิก</button>
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
                  className="rounded-xl border border-dashed border-gray-200 dark:border-slate-700 hover:border-aurora-teal text-gray-400 dark:text-slate-500 hover:text-aurora-teal flex flex-col items-center justify-center gap-1.5 transition-colors min-h-[168px]"
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
                    <div key={group.id} className="rounded-xl border border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-900/40 p-4">
                      <div className="flex items-center gap-2 mb-4 group/g">
                        {editingChannelCategoryGroupId === group.id ? (
                          <>
                            <input
                              autoFocus
                              className="border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-slate-100 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-aurora-teal"
                              value={editingChannelCategoryGroupName}
                              onChange={e => setEditingChannelCategoryGroupName(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && saveChannelCategoryGroupEdit(group.id)}
                            />
                            <button onClick={() => saveChannelCategoryGroupEdit(group.id)} className="text-aurora-teal"><Check size={14} /></button>
                            <button onClick={() => setEditingChannelCategoryGroupId(null)} className="text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300"><X size={14} /></button>
                          </>
                        ) : (
                          <>
                            <p className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wide">{group.name}</p>
                            <span className="text-[10px] text-gray-400 dark:text-slate-500">{groupCats.length} หมวดหมู่ย่อย</span>
                            <button onClick={() => startEditChannelCategoryGroup(group)} className="text-gray-300 dark:text-slate-600 hover:text-gray-600 dark:hover:text-slate-300 opacity-0 group-hover/g:opacity-100 transition-opacity"><Pencil size={12} /></button>
                            <button onClick={() => deleteChannelCategoryGroup(group.id)} className="text-gray-300 dark:text-slate-600 hover:text-rose-400 opacity-0 group-hover/g:opacity-100 transition-opacity"><X size={13} /></button>
                          </>
                        )}
                      </div>
                      {groupCats.length > 0 ? (
                        <div className="space-y-6">
                          {groupCats.map(cat => renderChannelCategoryBlock(cat))}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-300 dark:text-slate-600">ยังไม่มีหมวดหมู่ย่อยในหมวดหมู่ใหญ่นี้ — เลือกหมวดหมู่ใหญ่นี้จากหมวดหมู่ย่อยด้านล่าง</p>
                      )}
                    </div>
                  );
                })}

                <div className="space-y-6">
                  {channelCategoryGroups.length > 0 && channelCategories.some(c => !c.groupId) && (
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500">หมวดหมู่ย่อยที่ยังไม่ได้จัดเข้าหมวดหมู่ใหญ่</p>
                  )}
                  {channelCategories.filter(c => !c.groupId).map(cat => renderChannelCategoryBlock(cat))}
                </div>

                <div>
                  <p className="text-sm font-semibold text-gray-700 dark:text-slate-200 mb-2">ยังไม่มีหมวดหมู่</p>
                  <div className="flex flex-wrap gap-4">
                    {channels.filter(ch => !ch.categoryId).map(ch => (
                      <div key={ch.id} className="w-64 flex-shrink-0">
                        <ChannelListCard channel={ch} onManage={() => setManageChannelId(ch.id)} />
                      </div>
                    ))}
                    <button
                      onClick={() => setShowAddChannel(true)}
                      className="w-64 flex-shrink-0 rounded-xl border border-dashed border-gray-200 dark:border-slate-700 hover:border-aurora-teal text-gray-400 dark:text-slate-500 hover:text-aurora-teal flex flex-col items-center justify-center gap-1.5 transition-colors min-h-[168px]"
                    >
                      <Plus size={26} />
                      <span className="text-sm">เพิ่ม LINE OA</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {showAddChannel && (
              <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowAddChannel(false)}>
                <form
                  onSubmit={addChannel}
                  className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-xl p-5 w-full max-w-md max-h-[85vh] overflow-y-auto space-y-3"
                  onClick={e => e.stopPropagation()}
                >
                  <h3 className="font-medium text-gray-900 dark:text-slate-100">เพิ่ม LINE OA</h3>
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
                  {error && <div className="bg-rose-500/10 text-rose-400 text-sm px-3 py-2 rounded-lg">{error}</div>}
                  <div className="flex gap-2">
                    <button type="submit" disabled={saving} className="bg-gradient-to-r from-aurora-teal to-aurora-purple text-white rounded-lg px-4 py-2 text-sm hover:brightness-110 disabled:opacity-50">บันทึก</button>
                    <button type="button" onClick={() => setShowAddChannel(false)} className="text-sm text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 px-4 py-2">ยกเลิก</button>
                  </div>
                </form>
              </div>
            )}
          </div>
        )
      )}

      {/* Agents */}
      {tab === 'agents' && (
        <div className="max-w-5xl space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-xl border border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-2.5 min-w-[88px]">
              <p className="text-xl font-semibold text-gray-900 dark:text-slate-100 leading-tight">{agents.length}</p>
              <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-0.5">ทั้งหมด</p>
            </div>
            <div className="rounded-xl border border-aurora-purple/25 bg-aurora-purple/10 px-4 py-2.5 min-w-[88px]">
              <p className="text-xl font-bold text-gray-900 dark:text-white leading-tight">{agents.filter(a => a.role === 'admin').length}</p>
              <p className="text-[11px] text-aurora-cyan font-medium mt-0.5">แอดมิน</p>
            </div>
            <div className="rounded-xl border border-aurora-teal/25 bg-aurora-teal/10 px-4 py-2.5 min-w-[88px]">
              <p className="text-xl font-bold text-gray-900 dark:text-white leading-tight">{agents.filter(a => a.role !== 'admin').length}</p>
              <p className="text-[11px] text-aurora-teal font-medium mt-0.5">พนักงาน</p>
            </div>
            <div className="flex-1" />
            <div className="relative w-full sm:w-56">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500 pointer-events-none" />
              <input
                className="w-full border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-slate-100 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-aurora-teal placeholder:text-gray-400 dark:placeholder:text-slate-500"
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
              <h3 className="font-medium text-gray-900 dark:text-slate-100">เพิ่ม Agent</h3>
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
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300"
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
                <button type="button" onClick={() => setShowAddAgent(false)} className="text-sm text-gray-500 dark:text-slate-400 px-4 py-2">ยกเลิก</button>
              </div>
            </form>
          )}

          {agent?.role === 'admin' && (
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500">หมวดหมู่ทีมงาน</p>
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
              <button type="button" onClick={() => { setShowAddAgentCategory(false); setAgentCategoryName(''); }} className="text-sm text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 px-2">ยกเลิก</button>
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
                online={onlineIds.has(a.id)}
                onEdit={() => setEditAgentTarget(a)}
                onDelete={() => deleteAgent(a.id)}
              />
            );
            // ออนไลน์ (live socket presence) ก่อน, แล้วค่อยไม่อยู่หน้าจอ, แล้วค่อย
            // ออฟไลน์ — applied inside every section below (แอดมิน included),
            // never across sections, so a team's own grouping stays intact.
            // A plain stable sort (Array.prototype.sort is stable in every
            // engine this runs on) so agents sharing a rank keep whatever
            // order they were already in instead of reshuffling on every
            // presence change.
            const presenceRank = a => (a.status === 'away' ? 1 : onlineIds.has(a.id) ? 0 : 2);
            const byPresence = list => [...list].sort((a, b) => presenceRank(a) - presenceRank(b));
            // Section headings need to actually read as headings — bumped up from
            // the body-text size they were sharing with the card names before.
            const headingCls = 'text-base font-bold text-gray-900 dark:text-white';

            // Admins are never sorted into categories — they always stay pinned
            // in their own section up top, same as before this feature existed.
            const admins = agents.filter(a => a.role === 'admin' && matches(a));
            const nonAdmins = agents.filter(a => a.role !== 'admin');

            return (
              <div className="space-y-8">
                <div>
                  <p className={`${headingCls} mb-3`}>แอดมิน <span className="text-gray-400 dark:text-slate-500 font-medium text-sm">· {agents.filter(a => a.role === 'admin').length} คน</span></p>
                  {admins.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                      {byPresence(admins).map(card)}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-300 dark:text-slate-600 px-1">ไม่พบรายชื่อที่ตรงกับ "{agentSearch}"</p>
                  )}
                </div>

                {agentCategories.length === 0 ? (
                  // No categories created yet — plain flat grid of non-admin agents.
                  <div>
                    <p className={`${headingCls} mb-3`}>พนักงาน <span className="text-gray-400 dark:text-slate-500 font-medium text-sm">· {nonAdmins.length} คน</span></p>
                    {(() => {
                      const visible = nonAdmins.filter(matches);
                      return visible.length === 0 ? (
                        <p className="text-sm text-gray-300 dark:text-slate-600 px-1">ไม่พบรายชื่อที่ตรงกับ "{agentSearch}"</p>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                          {byPresence(visible).map(card)}
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
                                  className="border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-slate-100 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-aurora-teal"
                                  value={editingAgentCategoryName}
                                  onChange={e => setEditingAgentCategoryName(e.target.value)}
                                  onKeyDown={e => e.key === 'Enter' && saveAgentCategoryEdit(cat.id)}
                                />
                                <button onClick={() => saveAgentCategoryEdit(cat.id)} className="text-aurora-teal"><Check size={14} /></button>
                                <button onClick={() => setEditingAgentCategoryId(null)} className="text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300"><X size={14} /></button>
                              </>
                            ) : (
                              <>
                                {agent?.role === 'admin' && (
                                  <div className="flex flex-col -my-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                      onClick={() => moveAgentCategory(cat.id, 'up')}
                                      disabled={i === 0}
                                      className="text-gray-400 dark:text-slate-500 hover:text-gray-700 dark:hover:text-slate-200 disabled:opacity-20 disabled:hover:text-gray-400 dark:disabled:hover:text-slate-500 leading-none"
                                    >
                                      <ChevronUp size={14} />
                                    </button>
                                    <button
                                      onClick={() => moveAgentCategory(cat.id, 'down')}
                                      disabled={i === agentCategories.length - 1}
                                      className="text-gray-400 dark:text-slate-500 hover:text-gray-700 dark:hover:text-slate-200 disabled:opacity-20 disabled:hover:text-gray-400 dark:disabled:hover:text-slate-500 leading-none"
                                    >
                                      <ChevronDown size={14} />
                                    </button>
                                  </div>
                                )}
                                <p className={headingCls}>{cat.name}</p>
                                <span className="text-sm text-gray-400 dark:text-slate-500 font-medium">· {allInCat.length} คน</span>
                                {agent?.role === 'admin' && (
                                  <>
                                    <button onClick={() => startEditAgentCategory(cat)} className="text-gray-300 dark:text-slate-600 hover:text-gray-600 dark:hover:text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity"><Pencil size={13} /></button>
                                    <button onClick={() => deleteAgentCategory(cat.id)} className="text-gray-300 dark:text-slate-600 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity"><X size={14} /></button>
                                  </>
                                )}
                              </>
                            )}
                          </div>
                          {catAgents.length > 0 ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                              {byPresence(catAgents).map(card)}
                            </div>
                          ) : (
                            <p className="text-xs text-gray-300 dark:text-slate-600">
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
                            {byPresence(uncategorized).map(card)}
                          </div>
                        ) : (
                          <p className="text-xs text-gray-300 dark:text-slate-600">{q ? `ไม่พบรายชื่อที่ตรงกับ "${agentSearch}"` : 'ทุกคนถูกจัดหมวดหมู่แล้ว'}</p>
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
            {tags.length === 0 && <p className="text-sm text-gray-400 dark:text-slate-500">ยังไม่มีแท็ก</p>}
          </div>

          <form onSubmit={addTag} className={`${cardCls} space-y-3`}>
            <h3 className="font-medium text-gray-900 dark:text-slate-100">สร้างแท็กใหม่</h3>
            <input className={inputCls} placeholder="ชื่อแท็ก เช่น VIP, สนใจซื้อ" value={tagForm.name} onChange={e => setTagForm(f => ({ ...f, name: e.target.value }))} required />
            <div>
              <p className="text-xs text-gray-500 dark:text-slate-400 mb-1.5">สี</p>
              <div className="flex gap-2">
                {TAG_COLOR_PRESETS.map(c => (
                  <button
                    type="button"
                    key={c}
                    onClick={() => setTagForm(f => ({ ...f, color: c }))}
                    className={`w-6 h-6 rounded-full ${tagForm.color === c ? 'ring-2 ring-offset-2 ring-offset-slate-900 ring-gray-400 dark:ring-slate-400' : ''}`}
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
          <p className="text-sm text-gray-500 dark:text-slate-400">
            ระบบจะแจ้งเตือนในหน้ารายงาน &gt; ตรวจสอบ ทันทีที่พนักงานส่งลิงค์ที่ไม่อยู่ในรายการนี้ให้ลูกค้า — ใส่แค่โดเมนก็พอ (ไม่ต้องมี https:// หรือ path) ระบบจะอนุญาตทุก path/subdomain ของโดเมนนั้นให้อัตโนมัติ
          </p>
          <div className="space-y-2">
            {approvedLinks.map(l => (
              <div key={l.id} className={`${cardCls} flex items-center justify-between`}>
                <div className="flex items-center gap-2.5 min-w-0">
                  <Link2 size={16} className="text-aurora-teal flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-gray-900 dark:text-slate-100 truncate">{l.domain}</p>
                    {l.label && <p className="text-xs text-gray-400 dark:text-slate-500 truncate">{l.label}</p>}
                  </div>
                </div>
                <button onClick={() => deleteApprovedLink(l.id)} className="text-gray-400 dark:text-slate-500 hover:text-rose-400 flex-shrink-0">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            {approvedLinks.length === 0 && <p className="text-sm text-gray-400 dark:text-slate-500">ยังไม่มีโดเมนที่อนุญาต — ทุกลิงค์ที่พนักงานส่งจะถูกแจ้งเตือน</p>}
          </div>

          <form onSubmit={addApprovedLink} className={`${cardCls} space-y-3`}>
            <h3 className="font-medium text-gray-900 dark:text-slate-100">เพิ่มโดเมนที่อนุญาต</h3>
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
            <h3 className="font-medium text-gray-900 dark:text-slate-100 mb-1">Grace window สำหรับรายงาน "อ่านแล้วไม่ตอบ"</h3>
            <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">
              เมื่อพนักงานคนใดเปิดดูแชทที่ยังไม่ได้ตอบ ระบบจะเริ่มนับเวลาของคนนั้นเอง (แต่ละคนมีเวลานับแยกกันไปตามเวลาที่ตัวเองเปิดดู ไม่เกี่ยวกับคนอื่น) —
              ถ้ามีคนตอบกลับ<b>ก่อน</b>เวลาของตัวเองหมด จะไม่โดนนับว่า "อ่านแล้วไม่ตอบ" ในรายงานพนักงาน (ไม่ว่าจะเป็นคนที่ตอบเอง หรือคนอื่นที่เปิดดูอยู่แต่เวลาตัวเองยังไม่หมด) —
              แต่ถ้าเวลาของใครหมดไปแล้วก่อนจะมีคนตอบ คนนั้นจะโดนนับในรายงานทันที ต่อให้หลังจากนั้นมีคนอื่นตอบทันเวลาของตัวเองก็ไม่ช่วยย้อนเคลียร์ให้คนที่เวลาหมดไปแล้ว
            </p>
            {agent?.role === 'admin' ? (
              <form onSubmit={saveSystemSettings} className="flex items-end gap-3 flex-wrap">
                <div>
                  <label className="text-xs text-gray-400 dark:text-slate-500 block mb-1">Grace window (วินาที)</label>
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
              <p className="text-sm text-gray-900 dark:text-slate-100">
                ค่าปัจจุบัน: {systemSettings ? `${systemSettings.agentConductGraceSeconds} วินาที` : '...'}
                <span className="text-gray-400 dark:text-slate-500"> (เฉพาะแอดมินเท่านั้นที่แก้ไขได้)</span>
              </p>
            )}
          </div>

          <div className={cardCls}>
            <h3 className="font-medium text-gray-900 dark:text-slate-100 mb-1">เกณฑ์อัตราตอบขั้นต่ำสำหรับตาราง "อัตราการตอบเทียบกับการเปิดดู"</h3>
            <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">
              แถวที่ "อัตราตอบเอง (%)" ต่ำกว่าเกณฑ์นี้ จะถูกเน้นด้วยสีแดงในตารางที่หน้ารายงาน &gt; พนักงาน — ไว้แค่ช่วยให้สังเกตเห็นง่ายขึ้น ไม่มีผลต่อการคำนวณอื่นใด
            </p>
            {agent?.role === 'admin' ? (
              <form onSubmit={saveResponseRateThreshold} className="flex items-end gap-3 flex-wrap">
                <div>
                  <label className="text-xs text-gray-400 dark:text-slate-500 block mb-1">เกณฑ์อัตราตอบขั้นต่ำ (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    className={`${inputCls} w-32`}
                    value={thresholdInput}
                    onChange={e => setThresholdInput(e.target.value)}
                  />
                </div>
                <button
                  type="submit"
                  disabled={savingThreshold || thresholdInput === '' || (systemSettings && String(systemSettings.responseRateThresholdPercent) === thresholdInput)}
                  className="bg-gradient-to-r from-aurora-teal to-aurora-purple text-white rounded-lg px-4 py-2 text-sm hover:brightness-110 disabled:opacity-50"
                >
                  {savingThreshold ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
                {thresholdSaved && <span className="text-sm text-aurora-teal flex items-center gap-1"><Check size={14} /> บันทึกแล้ว</span>}
              </form>
            ) : (
              <p className="text-sm text-gray-900 dark:text-slate-100">
                ค่าปัจจุบัน: {systemSettings ? `${systemSettings.responseRateThresholdPercent}%` : '...'}
                <span className="text-gray-400 dark:text-slate-500"> (เฉพาะแอดมินเท่านั้นที่แก้ไขได้)</span>
              </p>
            )}
          </div>

          <div className={cardCls}>
            <h3 className="font-medium text-gray-900 dark:text-slate-100 mb-1">ออกจากระบบอัตโนมัติเมื่อไม่มีการใช้งาน (AFK)</h3>
            <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">
              ถ้าพนักงานคนใดไม่มีการเคลื่อนไหว (เมาส์/คีย์บอร์ด/สัมผัสหน้าจอ) ในระบบนานเกินเวลาที่ตั้งไว้นี้ ระบบจะขึ้นป้าย "ไม่อยู่หน้าจอ" ให้เพื่อนร่วมทีมเห็น (ในหน้า ทีมงาน) และออกจากระบบให้อัตโนมัติ — ใส่ 0 เพื่อปิดใช้งาน
            </p>
            {agent?.role === 'admin' ? (
              <form onSubmit={saveAfkMinutes} className="flex items-end gap-3 flex-wrap">
                <div>
                  <label className="text-xs text-gray-400 dark:text-slate-500 block mb-1">เวลา AFK (นาที)</label>
                  <input
                    type="number"
                    min="0"
                    max="1440"
                    step="1"
                    className={`${inputCls} w-32`}
                    value={afkInput}
                    onChange={e => setAfkInput(e.target.value)}
                  />
                </div>
                <button
                  type="submit"
                  disabled={savingAfk || afkInput === '' || (systemSettings && String(systemSettings.afkMinutes) === afkInput)}
                  className="bg-gradient-to-r from-aurora-teal to-aurora-purple text-white rounded-lg px-4 py-2 text-sm hover:brightness-110 disabled:opacity-50"
                >
                  {savingAfk ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
                {afkSaved && <span className="text-sm text-aurora-teal flex items-center gap-1"><Check size={14} /> บันทึกแล้ว</span>}
              </form>
            ) : (
              <p className="text-sm text-gray-900 dark:text-slate-100">
                ค่าปัจจุบัน: {systemSettings ? (systemSettings.afkMinutes > 0 ? `${systemSettings.afkMinutes} นาที` : 'ปิดใช้งาน') : '...'}
                <span className="text-gray-400 dark:text-slate-500"> (เฉพาะแอดมินเท่านั้นที่แก้ไขได้)</span>
              </p>
            )}
          </div>

          <div className={cardCls}>
            <h3 className="font-medium text-gray-900 dark:text-slate-100 mb-1">บังคับใช้ 2FA</h3>
            <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">
              เลือกกลุ่มพนักงานที่ต้องตั้งค่ายืนยันตัวตนสองขั้นตอน (2FA) ก่อนเข้าใช้งานได้ — คนในกลุ่มที่เลือกซึ่งยังไม่เคยตั้งค่าไว้
              จะถูกบังคับให้ตั้งค่าในครั้งถัดไปที่ล็อกอิน ส่วนคนที่เปิด 2FA ของตัวเองไว้แล้วจะยังคงต้องกรอกรหัสทุกครั้งต่อไป
              ไม่ว่าจะปรับตัวเลือกนี้เป็นอะไรในภายหลังก็ตาม
            </p>
            {agent?.role === 'admin' ? (
              <div className="flex items-center gap-1.5 flex-wrap">
                {TWO_FACTOR_SCOPE_OPTIONS.map(opt => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setTwoFactorRequiredScope(opt.key)}
                    disabled={savingTwoFactorRequired || !systemSettings}
                    className={`text-sm px-3 py-1.5 rounded-full border transition-colors disabled:opacity-50 ${
                      systemSettings?.twoFactorRequiredScope === opt.key
                        ? 'bg-gradient-to-r from-aurora-teal to-aurora-purple text-white border-transparent'
                        : 'text-gray-600 dark:text-slate-300 border-gray-200 dark:border-slate-700 hover:border-gray-400 dark:hover:border-slate-500'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-900 dark:text-slate-100">
                สถานะปัจจุบัน: {systemSettings ? (TWO_FACTOR_SCOPE_OPTIONS.find(o => o.key === systemSettings.twoFactorRequiredScope)?.label || 'ปิดใช้งาน') : '...'}
                <span className="text-gray-400 dark:text-slate-500"> (เฉพาะแอดมินเท่านั้นที่แก้ไขได้)</span>
              </p>
            )}
          </div>

          <TelegramReportSettings agent={agent} inputCls={inputCls} cardCls={cardCls} />
        </div>
      )}

      <DeleteChannelModal channel={deleteTarget} onCancel={() => setDeleteTarget(null)} onConfirm={confirmDeleteChannel} />
      {newChannelWebhook && (
        <NewChannelWebhookModal
          channelName={newChannelWebhook.channelName}
          webhookUrl={newChannelWebhook.webhookUrl}
          onClose={() => setNewChannelWebhook(null)}
        />
      )}
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
