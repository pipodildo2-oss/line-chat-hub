import { useState, useEffect } from 'react';
import axios from 'axios';
import { Plus, Trash2, Copy, Check, Users, MessageSquare } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

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
  const webhookUrl = `${window.location.origin.replace('5173', '3001')}/api/webhooks/line/${channel.id}`;
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
    </div>
  );
}

export default function Settings() {
  const { agent } = useAuth();
  const [channels, setChannels] = useState([]);
  const [agents, setAgents] = useState([]);
  const [tab, setTab] = useState('channels');
  const [showAddChannel, setShowAddChannel] = useState(false);
  const [showAddAgent, setShowAddAgent] = useState(false);
  const [channelForm, setChannelForm] = useState({ name: '', channelId: '', channelSecret: '', accessToken: '' });
  const [agentForm, setAgentForm] = useState({ name: '', email: '', password: '', role: 'agent' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    axios.get('/api/channels').then(r => setChannels(r.data));
    axios.get('/api/agents').then(r => setAgents(r.data));
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
    if (!confirm('ลบช่องทางนี้?')) return;
    await axios.delete(`/api/channels/${id}`);
    setChannels(prev => prev.filter(c => c.id !== id));
  }

  async function addAgent(e) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const { data } = await axios.post('/api/agents', agentForm);
      setAgents(prev => [...prev, data]);
      setAgentForm({ name: '', email: '', password: '', role: 'agent' });
      setShowAddAgent(false);
    } catch (err) {
      setError(err.response?.data?.error || 'เกิดข้อผิดพลาด');
    } finally { setSaving(false); }
  }

  async function deleteAgent(id) {
    if (id === agent?.id) return alert('ไม่สามารถลบตัวเองได้');
    if (!confirm('ลบ agent นี้?')) return;
    await axios.delete(`/api/agents/${id}`);
    setAgents(prev => prev.filter(a => a.id !== id));
  }

  const inputCls = 'w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500';

  return (
    <div className="p-6 max-w-3xl mx-auto overflow-y-auto h-full">
      <h1 className="text-xl font-bold text-gray-900 mb-6">Settings</h1>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b">
        {[{ key: 'channels', label: 'LINE OA Channels', icon: MessageSquare }, { key: 'agents', label: 'Agents', icon: Users }].map(t => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setError(''); setShowAddChannel(false); setShowAddAgent(false); }}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t.key ? 'border-green-500 text-green-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
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
                <button type="submit" disabled={saving} className="bg-green-500 text-white rounded-lg px-4 py-2 text-sm hover:bg-green-600 disabled:opacity-50">บันทึก</button>
                <button type="button" onClick={() => setShowAddChannel(false)} className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2">ยกเลิก</button>
              </div>
            </form>
          ) : (
            <button onClick={() => setShowAddChannel(true)} className="flex items-center gap-2 text-sm text-green-600 hover:text-green-700 font-medium">
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
              <div className="w-9 h-9 rounded-full bg-indigo-400 flex items-center justify-center text-white font-medium">
                {a.name[0].toUpperCase()}
              </div>
              <div className="flex-1">
                <p className="font-medium text-gray-900 text-sm">{a.name}</p>
                <p className="text-xs text-gray-500">{a.email} · {a.role}</p>
              </div>
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
                <button type="submit" disabled={saving} className="bg-green-500 text-white rounded-lg px-4 py-2 text-sm hover:bg-green-600 disabled:opacity-50">บันทึก</button>
                <button type="button" onClick={() => setShowAddAgent(false)} className="text-sm text-gray-500 px-4 py-2">ยกเลิก</button>
              </div>
            </form>
          ) : (
            <button onClick={() => setShowAddAgent(true)} className="flex items-center gap-2 text-sm text-green-600 hover:text-green-700 font-medium">
              <Plus size={18} /> เพิ่ม Agent
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
