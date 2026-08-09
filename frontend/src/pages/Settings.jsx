import { useState, useEffect } from 'react';
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
    <button onClick={copy} className="text-gray-400 hover:text-gray-600">
      {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
    </button>
  );
}

function ChannelCard({ channel, onDelete }) {
  const webhookUrl = `${window.location.origin}/api/webhooks/line/${channel.id}`;
  return (
    <div className="bg-white border rounded-xl p-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-medium text-gray-900">{channel.name}</h3>
          <p className="text-xs text-gray-500">Channel ID: {channel.channelId}</p>
        </div>
        <button onClick={() => onDelete(channel.id)} className="text-gray-300 hover:text-red-400 transition-colors">
          <Trash2 size={16} />
        </button>
      </div>
      <div className="bg-gray-50 rounded-lg p-2 flex items-center gap-2">
        <code className="text-xs text-gray-600 flex-1 truncate">{webhookUrl}</code>
        <CopyButton text={webhookUrl} />
      </div>
      <p className="text-xs text-gray-400 mt-1.5">ตั้ง Webhook URL นี้ใน LINE Developers Console</p>
      <div className="flex items-start gap-1.5 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-2 mt-2">
        <AlertTriangle size={13} className="text-amber-500 mt-0.5 flex-shrink-0" />
        <p className="text-xs text-amber-700">
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
        className="flex items-center gap-1.5 text-xs text-gray-500 border rounded-lg px-2.5 py-1.5 hover:border-gray-400"
      >
        <Radio size={12} /> {label}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white border rounded-xl shadow-lg z-20 p-3 w-56">
          <p className="text-xs font-medium text-gray-500 mb-2">เลือก OA ที่ agent นี้เห็นได้ (ไม่เลือก = เห็นทั้งหมด)</p>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {channels.map(ch => (
              <label key={ch.id} className="flex items-center gap-2 text-sm px-1.5 py-1 rounded hover:bg-gray-50 cursor-pointer">
                <input type="checkbox" checked={selectedIds.includes(ch.id)} onChange={() => toggle(ch.id)} className="accent-indigo-500" />
                {ch.name}
              </label>
            ))}
          </div>
          <div className="flex gap-2 mt-2">
            <button onClick={save} disabled={saving} className="text-xs bg-indigo-500 text-white rounded-lg px-3 py-1.5 hover:bg-indigo-600 disabled:opacity-50">บันทึก</button>
            <button onClick={() => setOpen(false)} className="text-xs text-gray-500 px-3 py-1.5">ยกเลิก</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Settings() {
  const { agent } = useAuth();
  const [channels, setChannels] = useState([]);
  const [agents, setAgents] = useState([]);
  const [tags, setTags] = useState([]);
  const [tab, setTab] = useState('channels');
  const [showAddChannel, setShowAddChannel] = useState(false);
  const [showAddAgent, setShowAddAgent] = useState(false);
  const [channelForm, setChannelForm] = useState({ name: '', channelId: '', channelSecret: '', accessToken: '' });
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
    setChannels(prev => prev.filter(c => c.id !== id));
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

  const inputCls = 'w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';

  return (
    <div className="p-6 max-w-3xl mx-auto overflow-y-auto h-full">
      <h1 className="text-xl font-bold text-gray-900 mb-6">Settings</h1>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b">
        {[
          { key: 'channels', label: 'LINE OA Channels', icon: MessageSquare },
          { key: 'agents', label: 'Agents', icon: Users },
          { key: 'tags', label: 'Tags', icon: TagIcon },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setError(''); setShowAddChannel(false); setShowAddAgent(false); }}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t.key ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            <t.icon size={16} />{t.label}
          </button>
        ))}
      </div>

      {error && <div className="bg-red-50 text-red-600 text-sm px-4 py-2 rounded-lg mb-4">{error}</div>}

      {/* Channels tab */}
      {tab === 'channels' && (
        <div className="space-y-4">
          {channels.map(ch => <ChannelCard key={ch.id} channel={ch} onDelete={deleteChannel} />)}

          {showAddChannel ? (
            <form onSubmit={addChannel} className="bg-white border rounded-xl p-4 space-y-3">
              <h3 className="font-medium text-gray-900">เพิ่ม LINE OA</h3>
              <input className={inputCls} placeholder="ชื่อ OA (เช่น ร้านค้าหลัก)" value={channelForm.name} onChange={e => setChannelForm(f => ({ ...f, name: e.target.value }))} required />
              <input className={inputCls} placeholder="Channel ID" value={channelForm.channelId} onChange={e => setChannelForm(f => ({ ...f, channelId: e.target.value }))} required />
              <input className={inputCls} placeholder="Channel Secret" value={channelForm.channelSecret} onChange={e => setChannelForm(f => ({ ...f, channelSecret: e.target.value }))} required />
              <textarea className={inputCls} placeholder="Channel Access Token" rows={3} value={channelForm.accessToken} onChange={e => setChannelForm(f => ({ ...f, accessToken: e.target.value }))} required />
              <div className="flex gap-2">
                <button type="submit" disabled={saving} className="bg-indigo-500 text-white rounded-lg px-4 py-2 text-sm hover:bg-indigo-600 disabled:opacity-50">บันทึก</button>
                <button type="button" onClick={() => setShowAddChannel(false)} className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2">ยกเลิก</button>
              </div>
            </form>
          ) : (
            <button onClick={() => setShowAddChannel(true)} className="flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-700 font-medium">
              <Plus size={18} /> เพิ่ม LINE OA
            </button>
          )}
        </div>
      )}

      {/* Agents tab */}
      {tab === 'agents' && (
        <div className="space-y-3">
          {agents.map(a => (
            <div key={a.id} className="bg-white border rounded-xl p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center text-white font-medium">
                {a.name[0].toUpperCase()}
              </div>
              <div className="flex-1">
                <p className="font-medium text-gray-900 text-sm">{a.name}</p>
                <p className="text-xs text-gray-500">{a.email} · {a.role}</p>
              </div>
              {agent?.role === 'admin' && a.role !== 'admin' && (
                <AgentChannelAccess agentItem={a} channels={channels} onSave={saveAgentChannels} />
              )}
              {a.id !== agent?.id && agent?.role === 'admin' && (
                <button onClick={() => deleteAgent(a.id)} className="text-gray-300 hover:text-red-400">
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          ))}

          {agent?.role === 'admin' && (showAddAgent ? (
            <form onSubmit={addAgent} className="bg-white border rounded-xl p-4 space-y-3">
              <h3 className="font-medium text-gray-900">เพิ่ม Agent</h3>
              <input className={inputCls} placeholder="ชื่อ" value={agentForm.name} onChange={e => setAgentForm(f => ({ ...f, name: e.target.value }))} required />
              <input type="email" className={inputCls} placeholder="Email" value={agentForm.email} onChange={e => setAgentForm(f => ({ ...f, email: e.target.value }))} required />
              <input type="password" className={inputCls} placeholder="Password" value={agentForm.password} onChange={e => setAgentForm(f => ({ ...f, password: e.target.value }))} required />
              <select className={inputCls} value={agentForm.role} onChange={e => setAgentForm(f => ({ ...f, role: e.target.value }))}>
                <option value="agent">Agent</option>
                <option value="admin">Admin</option>
              </select>
              <div className="flex gap-2">
                <button type="submit" disabled={saving} className="bg-indigo-500 text-white rounded-lg px-4 py-2 text-sm hover:bg-indigo-600 disabled:opacity-50">บันทึก</button>
                <button type="button" onClick={() => setShowAddAgent(false)} className="text-sm text-gray-500 px-4 py-2">ยกเลิก</button>
              </div>
            </form>
          ) : (
            <button onClick={() => setShowAddAgent(true)} className="flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-700 font-medium">
              <Plus size={18} /> เพิ่ม Agent
            </button>
          ))}
        </div>
      )}

      {/* Tags tab */}
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
            {tags.length === 0 && <p className="text-sm text-gray-400">ยังไม่มีแท็ก</p>}
          </div>

          <form onSubmit={addTag} className="bg-white border rounded-xl p-4 space-y-3">
            <h3 className="font-medium text-gray-900">สร้างแท็กใหม่</h3>
            <input className={inputCls} placeholder="ชื่อแท็ก เช่น VIP, สนใจซื้อ" value={tagForm.name} onChange={e => setTagForm(f => ({ ...f, name: e.target.value }))} required />
            <div>
              <p className="text-xs text-gray-500 mb-1.5">สี</p>
              <div className="flex gap-2">
                {TAG_COLOR_PRESETS.map(c => (
                  <button
                    type="button"
                    key={c}
                    onClick={() => setTagForm(f => ({ ...f, color: c }))}
                    className={`w-6 h-6 rounded-full ${tagForm.color === c ? 'ring-2 ring-offset-2 ring-gray-400' : ''}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
            <button type="submit" disabled={saving} className="bg-indigo-500 text-white rounded-lg px-4 py-2 text-sm hover:bg-indigo-600 disabled:opacity-50">เพิ่มแท็ก</button>
          </form>
        </div>
      )}
    </div>
  );
}
