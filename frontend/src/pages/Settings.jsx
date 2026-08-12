import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { Plus, Trash2, Copy, Check, Users, MessageSquare, Tag as TagIcon, AlertTriangle, ArrowLeft, QrCode, MessageCircle, Eye, EyeOff, Pencil, X, ExternalLink } from 'lucide-react';
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
  return (
    <div className="relative rounded-xl border border-slate-800 bg-slate-900 p-5 min-h-[168px] flex flex-col gap-4">
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
          <p className="font-semibold text-slate-100 text-base truncate">{channel.name}</p>
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

function ChannelConfigure({ channel, onBack, onSave, onRequestDelete }) {
  const [name, setName] = useState(channel.name);
  const [lineId, setLineId] = useState(channel.lineId || '');
  const [channelSecret, setChannelSecret] = useState(channel.channelSecret || '');
  const [accessToken, setAccessToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const webhookUrl = `${window.location.origin}/api/webhooks/line/${channel.id}`;
  const handle = lineId ? `@${lineId.replace(/^@/, '')}` : null;
  const chatLink = handle ? `https://line.me/R/ti/p/${encodeURIComponent(handle)}` : null;

  const fieldCls = 'w-full border border-slate-700 bg-slate-800 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-aurora-teal placeholder:text-slate-500';
  const labelCls = 'text-xs font-medium text-slate-400 mb-1.5 block';
  const readonlyCls = 'w-full border border-slate-800 bg-slate-800/50 text-slate-500 rounded-lg px-3 py-2 text-sm cursor-not-allowed';

  async function handleSave() {
    setSaving(true); setSaved(false);
    try {
      await onSave(channel.id, { name, lineId, channelSecret, accessToken: accessToken || undefined });
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
          <label className={labelCls}>LINE ID</label>
          <input className={fieldCls} placeholder="เช่น abc1234 (ไม่ต้องใส่ @)" value={lineId} onChange={e => setLineId(e.target.value)} />
        </div>

        <div>
          <label className={labelCls}>Channel Secret</label>
          <input className={fieldCls} value={channelSecret} onChange={e => setChannelSecret(e.target.value)} />
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
        <h3 className="font-semibold text-slate-100 mb-3">Danger Zone</h3>
        <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2.5 mb-3">
          <AlertTriangle size={15} className="text-amber-500 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-amber-400">
            ถ้าลบช่องทางนี้ การสนทนาและข้อความทั้งหมดที่เชื่อมกับช่องทางนี้จะถูกลบถาวรไปด้วย และจะไม่สามารถรับ-ส่งข้อความผ่านช่องทางนี้ได้อีก
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

function AgentEditModal({ agentItem, channels, onSave, onClose, t }) {
  const [role, setRole] = useState(agentItem.role);
  const [selectedIds, setSelectedIds] = useState(agentItem.channelIds || []);
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
      await onSave(agentItem.id, { role, channelIds: selectedIds });
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
  const [channelForm, setChannelForm] = useState({ name: '', lineId: '', channelId: '', channelSecret: '', accessToken: '' });
  const [agentForm, setAgentForm] = useState({ name: '', email: '', password: '', role: 'agent' });
  const [tagForm, setTagForm] = useState({ name: '', color: TAG_COLOR_PRESETS[0] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    axios.get('/api/channels').then(r => setChannels(r.data));
    axios.get('/api/agents').then(r => setAgents(r.data));
    axios.get('/api/tags').then(r => setTags(r.data));
  }, []);

  async function addChannel(e) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const { data } = await axios.post('/api/channels', channelForm);
      setChannels(prev => [...prev, data]);
      setChannelForm({ name: '', lineId: '', channelId: '', channelSecret: '', accessToken: '' });
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
      setAgentForm({ name: '', email: '', password: '', role: 'agent' });
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

  async function saveAgentEdit(agentId, { role, channelIds }) {
    const original = agents.find(a => a.id === agentId);
    if (role !== original?.role) {
      await axios.patch(`/api/agents/${agentId}`, { role });
    }
    await axios.put(`/api/agents/${agentId}/channels`, { channelIds });
    setAgents(prev => prev.map(a => a.id === agentId ? { ...a, role, channelIds } : a));
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
            onBack={() => setManageChannelId(null)}
            onSave={updateChannel}
            onRequestDelete={setDeleteTarget}
          />
        ) : (
          <div className="space-y-4 max-w-6xl">
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

            {showAddChannel && (
              <form onSubmit={addChannel} className={`${cardCls} space-y-3 max-w-xl`}>
                <h3 className="font-medium text-slate-100">เพิ่ม LINE OA</h3>
                <input className={inputCls} placeholder="ชื่อ OA (เช่น ร้านค้าหลัก)" value={channelForm.name} onChange={e => setChannelForm(f => ({ ...f, name: e.target.value }))} required />
                <input className={inputCls} placeholder="LINE ID (เช่น abc1234 ไม่ต้องใส่ @) — ไม่บังคับ" value={channelForm.lineId} onChange={e => setChannelForm(f => ({ ...f, lineId: e.target.value }))} />
                <input className={inputCls} placeholder="Channel ID" value={channelForm.channelId} onChange={e => setChannelForm(f => ({ ...f, channelId: e.target.value }))} required />
                <input className={inputCls} placeholder="Channel Secret" value={channelForm.channelSecret} onChange={e => setChannelForm(f => ({ ...f, channelSecret: e.target.value }))} required />
                <textarea className={inputCls} placeholder="Channel Access Token" rows={3} value={channelForm.accessToken} onChange={e => setChannelForm(f => ({ ...f, accessToken: e.target.value }))} required />
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
        <div className="space-y-6 max-w-2xl">
          {[
            { key: 'admins', label: t('section_admins'), rows: agents.filter(a => a.role === 'admin') },
            { key: 'agents', label: t('section_agents'), rows: agents.filter(a => a.role !== 'admin') },
          ].map(group => (
            group.rows.length > 0 && (
              <div key={group.key}>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">{group.label}</p>
                <div className="space-y-3">
                  {group.rows.map(a => (
                    <div key={a.id} className={`${cardCls} flex items-center gap-3`}>
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-aurora-teal to-aurora-purple flex items-center justify-center text-white font-medium flex-shrink-0">
                        {a.name[0].toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-slate-100 text-sm">{a.name}</p>
                        <p className="text-xs text-slate-500">{a.email} · {a.role}</p>
                      </div>
                      {agent?.role === 'admin' && a.id !== agent?.id && (
                        <button
                          onClick={() => setEditAgentTarget(a)}
                          className="flex items-center gap-1.5 text-xs text-slate-400 border border-slate-700 rounded-lg px-2.5 py-1.5 hover:border-slate-500 hover:text-slate-200"
                        >
                          <Pencil size={12} /> {t('edit')}
                        </button>
                      )}
                      {a.id !== agent?.id && agent?.role === 'admin' && (
                        <button onClick={() => deleteAgent(a.id)} className="text-slate-600 hover:text-rose-400">
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          ))}

          {agent?.role === 'admin' && (showAddAgent ? (
            <form onSubmit={addAgent} className={`${cardCls} space-y-3`}>
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
              <div className="flex gap-2">
                <button type="submit" disabled={saving} className="bg-gradient-to-r from-aurora-teal to-aurora-purple text-white rounded-lg px-4 py-2 text-sm hover:brightness-110 disabled:opacity-50">บันทึก</button>
                <button type="button" onClick={() => setShowAddAgent(false)} className="text-sm text-slate-400 px-4 py-2">ยกเลิก</button>
              </div>
            </form>
          ) : (
            <button onClick={() => setShowAddAgent(true)} className="flex items-center gap-2 text-sm text-aurora-teal hover:brightness-110 font-medium">
              <Plus size={18} /> เพิ่ม Agent
            </button>
          ))}
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

      <DeleteChannelModal channel={deleteTarget} onCancel={() => setDeleteTarget(null)} onConfirm={confirmDeleteChannel} />
      {editAgentTarget && (
        <AgentEditModal
          agentItem={editAgentTarget}
          channels={channels}
          onSave={saveAgentEdit}
          onClose={() => setEditAgentTarget(null)}
          t={t}
        />
      )}
    </div>
  );
}
