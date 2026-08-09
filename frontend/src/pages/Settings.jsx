import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { Plus, Trash2, Copy, Check, Users, MessageSquare, Tag as TagIcon, Radio, AlertTriangle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { TAG_COLOR_PRESETS } from '../lib/constants';

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button onClick={copy} className="text-slate-500 hover:text-slate-300">
      {copied ? <Check size={14} className="text-aurora-teal" /> : <Copy size={14} />}
    </button>
  );
}

function ChannelTile({ channel, selected, onSelect, onDelete }) {
  return (
    <button
      onClick={onSelect}
      className={`relative aspect-square rounded-xl border p-3 flex flex-col items-center justify-center gap-2 text-center transition-colors ${
        selected ? 'border-aurora-teal bg-gradient-to-br from-aurora-teal/10 to-aurora-purple/10' : 'border-slate-800 bg-slate-900 hover:border-slate-600'
      }`}
    >
      <span
        onClick={(e) => { e.stopPropagation(); onDelete(channel.id); }}
        className="absolute top-1.5 right-1.5 text-slate-600 hover:text-rose-400 p-1"
      >
        <Trash2 size={13} />
      </span>
      <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-aurora-teal to-aurora-purple flex items-center justify-center text-white font-semibold text-sm flex-shrink-0">
        {channel.name?.[0]?.toUpperCase() || '?'}
      </div>
      <p className="text-sm font-medium text-slate-100 truncate w-full">{channel.name}</p>
      <p className="text-[10px] text-slate-500 truncate w-full">{channel.channelId}</p>
    </button>
  );
}

function ChannelDetail({ channel }) {
  const webhookUrl = `${window.location.origin}/api/webhooks/line/${channel.id}`;
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <h3 className="font-medium text-slate-100 mb-2">{channel.name}</h3>
      <div className="bg-slate-800 rounded-lg p-2 flex items-center gap-2">
        <code className="text-xs text-slate-300 flex-1 truncate">{webhookUrl}</code>
        <CopyButton text={webhookUrl} />
      </div>
      <p className="text-xs text-slate-500 mt-1.5">ตั้ง Webhook URL นี้ใน LINE Developers Console</p>
      <div className="flex items-start gap-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-2 mt-2">
        <AlertTriangle size={13} className="text-amber-500 mt-0.5 flex-shrink-0" />
        <p className="text-xs text-amber-400">
          อย่าลืมเปิด <strong>"Use webhook redelivery"</strong> ในหน้า Messaging API ของ LINE Developers Console ด้วย —
          ถ้าไม่เปิด ข้อความที่ลูกค้าทักเข้ามาตอนระบบมีปัญหาชั่วคราวจะหายไปถาวร ไม่สามารถกู้คืนได้
        </p>
      </div>
    </div>
  );
}

function AgentChannelAccess({ agentItem, channels, onSave }) {
  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState(agentItem.channelIds || []);
  const [saving, setSaving] = useState(false);

  function toggle(id) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  async function save() {
    setSaving(true);
    try {
      await onSave(agentItem.id, selectedIds);
      setOpen(false);
    } finally { setSaving(false); }
  }

  const label = selectedIds.length === 0 ? 'มองเห็นทุก OA' : `${selectedIds.length} OA ที่เลือก`;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 text-xs text-slate-400 border border-slate-700 rounded-lg px-2.5 py-1.5 hover:border-slate-500"
      >
        <Radio size={12} /> {label}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-slate-800 border border-slate-700 rounded-xl shadow-lg z-20 p-3 w-56">
          <p className="text-xs font-medium text-slate-400 mb-2">เลือก OA ที่ agent นี้เห็นได้ (ไม่เลือก = เห็นทั้งหมด)</p>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {channels.map(ch => (
              <label key={ch.id} className="flex items-center gap-2 text-sm px-1.5 py-1 rounded hover:bg-slate-700 cursor-pointer text-slate-200">
                <input type="checkbox" checked={selectedIds.includes(ch.id)} onChange={() => toggle(ch.id)} className="accent-aurora-teal" />
                {ch.name}
              </label>
            ))}
          </div>
          <div className="flex gap-2 mt-2">
            <button onClick={save} disabled={saving} className="text-xs bg-gradient-to-r from-aurora-teal to-aurora-purple text-white rounded-lg px-3 py-1.5 hover:brightness-110 disabled:opacity-50">บันทึก</button>
            <button onClick={() => setOpen(false)} className="text-xs text-slate-400 px-3 py-1.5">ยกเลิก</button>
          </div>
        </div>
      )}
    </div>
  );
}

const CATEGORIES = {
  channels: { label: 'ช่องทาง LINE OA', icon: MessageSquare },
  agents: { label: 'ทีมงาน', icon: Users },
  tags: { label: 'แท็ก', icon: TagIcon },
};

export default function Settings() {
  const { tab } = useParams();
  const { agent } = useAuth();
  const [channels, setChannels] = useState([]);
  const [agents, setAgents] = useState([]);
  const [tags, setTags] = useState([]);
  const [selectedChannelId, setSelectedChannelId] = useState(null);
  const [showAddChannel, setShowAddChannel] = useState(false);
  const [showAddAgent, setShowAddAgent] = useState(false);
  const [channelForm, setChannelForm] = useState({ name: '', channelId: '', channelSecret: '', accessToken: '' });
  const [agentForm, setAgentForm] = useState({ name: '', email: '', password: '', role: 'agent' });
  const [tagForm, setTagForm] = useState({ name: '', color: TAG_COLOR_PRESETS[0] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    axios.get('/api/channels').then(r => { setChannels(r.data); if (r.data.length) setSelectedChannelId(r.data[0].id); });
    axios.get('/api/agents').then(r => setAgents(r.data));
    axios.get('/api/tags').then(r => setTags(r.data));
  }, []);

  async function addChannel(e) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const { data } = await axios.post('/api/channels', channelForm);
      setChannels(prev => [...prev, data]);
      setSelectedChannelId(data.id);
      setChannelForm({ name: '', channelId: '', channelSecret: '', accessToken: '' });
      setShowAddChannel(false);
    } catch (err) {
      setError(err.response?.data?.error || 'เกิดข้อผิดพลาด');
    } finally { setSaving(false); }
  }

  async function deleteChannel(id) {
    const ch = channels.find(c => c.id === id);
    const convCount = ch?._count?.conversations || 0;
    const warning = convCount > 0
      ? `ลบ "${ch.name}" ถาวร?\n\nการสนทนาทั้งหมด ${convCount} รายการและข้อความในนั้นจะถูกลบถาวรไปด้วย กู้คืนไม่ได้`
      : `ลบ "${ch?.name || 'ช่องทางนี้'}" ถาวร? การกระทำนี้กู้คืนไม่ได้`;
    if (!confirm(warning)) return;
    await axios.delete(`/api/channels/${id}`);
    setChannels(prev => {
      const next = prev.filter(c => c.id !== id);
      if (selectedChannelId === id) setSelectedChannelId(next[0]?.id || null);
      return next;
    });
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

  async function saveAgentChannels(agentId, channelIds) {
    await axios.put(`/api/agents/${agentId}/channels`, { channelIds });
    setAgents(prev => prev.map(a => a.id === agentId ? { ...a, channelIds } : a));
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
  const active = CATEGORIES[tab] || CATEGORIES.channels;
  const selectedChannel = channels.find(c => c.id === selectedChannelId);

  return (
    <div className="h-full overflow-y-auto p-6 max-w-3xl">
      <div className="flex items-center gap-2 mb-6">
        <active.icon size={18} className="text-slate-500" />
        <h2 className="text-base font-semibold text-slate-100">{active.label}</h2>
      </div>

      {error && <div className="bg-rose-500/10 text-rose-400 text-sm px-4 py-2 rounded-lg mb-4">{error}</div>}

      {/* Channels */}
      {tab === 'channels' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
            {channels.map(ch => (
              <ChannelTile
                key={ch.id}
                channel={ch}
                selected={selectedChannelId === ch.id}
                onSelect={() => setSelectedChannelId(ch.id)}
                onDelete={deleteChannel}
              />
            ))}
            <button
              onClick={() => setShowAddChannel(true)}
              className="aspect-square rounded-xl border border-dashed border-slate-700 hover:border-aurora-teal text-slate-500 hover:text-aurora-teal flex flex-col items-center justify-center gap-1 transition-colors"
            >
              <Plus size={20} />
              <span className="text-xs">เพิ่ม LINE OA</span>
            </button>
          </div>

          {showAddChannel && (
            <form onSubmit={addChannel} className={`${cardCls} space-y-3`}>
              <h3 className="font-medium text-slate-100">เพิ่ม LINE OA</h3>
              <input className={inputCls} placeholder="ชื่อ OA (เช่น ร้านค้าหลัก)" value={channelForm.name} onChange={e => setChannelForm(f => ({ ...f, name: e.target.value }))} required />
              <input className={inputCls} placeholder="Channel ID" value={channelForm.channelId} onChange={e => setChannelForm(f => ({ ...f, channelId: e.target.value }))} required />
              <input className={inputCls} placeholder="Channel Secret" value={channelForm.channelSecret} onChange={e => setChannelForm(f => ({ ...f, channelSecret: e.target.value }))} required />
              <textarea className={inputCls} placeholder="Channel Access Token" rows={3} value={channelForm.accessToken} onChange={e => setChannelForm(f => ({ ...f, accessToken: e.target.value }))} required />
              <div className="flex gap-2">
                <button type="submit" disabled={saving} className="bg-gradient-to-r from-aurora-teal to-aurora-purple text-white rounded-lg px-4 py-2 text-sm hover:brightness-110 disabled:opacity-50">บันทึก</button>
                <button type="button" onClick={() => setShowAddChannel(false)} className="text-sm text-slate-400 hover:text-slate-200 px-4 py-2">ยกเลิก</button>
              </div>
            </form>
          )}

          {selectedChannel && !showAddChannel && <ChannelDetail channel={selectedChannel} />}
        </div>
      )}

      {/* Agents */}
      {tab === 'agents' && (
        <div className="space-y-3">
          {agents.map(a => (
            <div key={a.id} className={`${cardCls} flex items-center gap-3`}>
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-aurora-teal to-aurora-purple flex items-center justify-center text-white font-medium flex-shrink-0">
                {a.name[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-slate-100 text-sm">{a.name}</p>
                <p className="text-xs text-slate-500">{a.email} · {a.role}</p>
              </div>
              {agent?.role === 'admin' && a.role !== 'admin' && (
                <AgentChannelAccess agentItem={a} channels={channels} onSave={saveAgentChannels} />
              )}
              {a.id !== agent?.id && agent?.role === 'admin' && (
                <button onClick={() => deleteAgent(a.id)} className="text-slate-600 hover:text-rose-400">
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          ))}

          {agent?.role === 'admin' && (showAddAgent ? (
            <form onSubmit={addAgent} className={`${cardCls} space-y-3`}>
              <h3 className="font-medium text-slate-100">เพิ่ม Agent</h3>
              <input className={inputCls} placeholder="ชื่อ" value={agentForm.name} onChange={e => setAgentForm(f => ({ ...f, name: e.target.value }))} required />
              <input type="email" className={inputCls} placeholder="Email" value={agentForm.email} onChange={e => setAgentForm(f => ({ ...f, email: e.target.value }))} required />
              <input type="password" className={inputCls} placeholder="Password" value={agentForm.password} onChange={e => setAgentForm(f => ({ ...f, password: e.target.value }))} required />
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
        <div className="space-y-4">
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
    </div>
  );
}
