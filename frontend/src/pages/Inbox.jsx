import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import axios from 'axios';
import { formatDistanceToNow } from 'date-fns';
import { th } from 'date-fns/locale';
import { Send, Sparkles, UserCheck, X, Search, SlidersHorizontal, Info, Tag as TagIcon, Plus, Check, Pencil } from 'lucide-react';
import { useSocket } from '../contexts/SocketContext';
import { useAuth } from '../contexts/AuthContext';
import { LIFECYCLE_STAGES, stageInfo, STATUS_COLORS } from '../lib/constants';

function Avatar({ name, pictureUrl, size = 10 }) {
  if (pictureUrl) return <img src={pictureUrl} className={`w-${size} h-${size} rounded-full object-cover flex-shrink-0`} />;
  return (
    <div className={`w-${size} h-${size} rounded-full bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center text-white font-medium text-sm flex-shrink-0`}>
      {name?.[0]?.toUpperCase() || '?'}
    </div>
  );
}

function TagChip({ tag, onRemove, small }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${small ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-1'}`}
      style={{ backgroundColor: `${tag.color}1a`, color: tag.color }}
    >
      {tag.name}
      {onRemove && (
        <button onClick={onRemove} className="hover:opacity-70">
          <X size={small ? 9 : 11} />
        </button>
      )}
    </span>
  );
}

function ConversationItem({ conv, selected, onClick }) {
  const lastMsg = conv.messages?.[0];
  const unread = conv._count?.messages || 0;
  const stage = stageInfo(conv.lifecycleStage);
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/60 transition-colors flex gap-3 ${selected ? 'bg-indigo-50/70 dark:bg-indigo-500/10 border-l-2 border-l-indigo-500' : ''}`}
    >
      <Avatar name={conv.displayName} pictureUrl={conv.pictureUrl} />
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-start">
          <span className="font-medium text-sm text-gray-900 dark:text-slate-100 truncate">{conv.displayName || conv.lineUserId}</span>
          <span className="text-xs text-gray-400 dark:text-slate-500 ml-2 whitespace-nowrap">
            {conv.lastMessageAt ? formatDistanceToNow(new Date(conv.lastMessageAt), { locale: th, addSuffix: false }) : ''}
          </span>
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          <span className="text-xs text-gray-400 dark:text-slate-500 truncate flex-1">
            {lastMsg?.sender === 'agent' ? '✓ ' : ''}{lastMsg?.content || ''}
          </span>
          {unread > 0 && (
            <span className="bg-emerald-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0">
              {unread}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 mt-1.5 flex-wrap">
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400">{conv.channel?.name}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${stage.color}`}>{stage.label}</span>
          {conv.agent && <span className="text-[10px] text-indigo-600 dark:text-indigo-400">→ {conv.agent.name}</span>}
          {conv.tags?.slice(0, 2).map(({ tag }) => <TagChip key={tag.id} tag={tag} small />)}
        </div>
      </div>
    </button>
  );
}

function MessageBubble({ msg }) {
  const isUser = msg.sender === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-start' : 'justify-end'} mb-2`}>
      <div className={`max-w-xs lg:max-w-md px-4 py-2 rounded-2xl text-sm shadow-sm ${isUser ? 'bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 text-gray-800 dark:text-slate-100 rounded-tl-sm' : 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white rounded-tr-sm'}`}>
        <p className="whitespace-pre-wrap break-words">{msg.content}</p>
        <p className={`text-xs mt-1 ${isUser ? 'text-gray-400 dark:text-slate-500' : 'text-emerald-100'}`}>
          {new Date(msg.createdAt).toLocaleTimeString('th', { hour: '2-digit', minute: '2-digit' })}
          {msg.sender === 'agent' && msg.senderName ? ` · ${msg.senderName}` : ''}
        </p>
      </div>
    </div>
  );
}

function FilterPanel({ filter, setFilter, channels, agents, tags, onClose }) {
  return (
    <div className="absolute top-full left-3 right-3 mt-1 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-lg z-20 p-3 space-y-3">
      <div>
        <p className="text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">สถานะ</p>
        <div className="flex gap-1 flex-wrap">
          {['', 'open', 'pending', 'closed'].map(s => (
            <button
              key={s || 'all'}
              onClick={() => setFilter(f => ({ ...f, status: s }))}
              className={`text-xs px-2 py-1 rounded-full border transition-colors ${filter.status === s ? 'bg-indigo-500 text-white border-indigo-500' : 'text-gray-600 dark:text-slate-300 border-gray-200 dark:border-slate-600 hover:border-gray-400 dark:hover:border-slate-500'}`}
            >
              {s === '' ? 'ทั้งหมด' : s === 'open' ? 'เปิด' : s === 'pending' ? 'รอ' : 'ปิด'}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">Lifecycle</p>
        <div className="flex gap-1 flex-wrap">
          <button
            onClick={() => setFilter(f => ({ ...f, lifecycleStage: '' }))}
            className={`text-xs px-2 py-1 rounded-full border transition-colors ${filter.lifecycleStage === '' ? 'bg-indigo-500 text-white border-indigo-500' : 'text-gray-600 dark:text-slate-300 border-gray-200 dark:border-slate-600 hover:border-gray-400 dark:hover:border-slate-500'}`}
          >
            ทั้งหมด
          </button>
          {LIFECYCLE_STAGES.map(s => (
            <button
              key={s.key}
              onClick={() => setFilter(f => ({ ...f, lifecycleStage: s.key }))}
              className={`text-xs px-2 py-1 rounded-full border transition-colors ${filter.lifecycleStage === s.key ? s.color + ' font-medium' : 'text-gray-500 dark:text-slate-400 border-gray-200 dark:border-slate-600 hover:border-gray-400 dark:hover:border-slate-500'}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">ช่องทาง</p>
          <select
            className="w-full text-xs border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-700 dark:text-slate-200 rounded-lg px-2 py-1.5 focus:outline-none"
            value={filter.channelId}
            onChange={e => setFilter(f => ({ ...f, channelId: e.target.value }))}
          >
            <option value="">ทุก OA</option>
            {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">พนักงาน</p>
          <select
            className="w-full text-xs border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-700 dark:text-slate-200 rounded-lg px-2 py-1.5 focus:outline-none"
            value={filter.agentId}
            onChange={e => setFilter(f => ({ ...f, agentId: e.target.value }))}
          >
            <option value="">ทั้งหมด</option>
            <option value="me">ของฉัน</option>
            <option value="unassigned">ยังไม่ assign</option>
            {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      </div>
      {tags.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">แท็ก</p>
          <div className="flex gap-1 flex-wrap">
            <button
              onClick={() => setFilter(f => ({ ...f, tagId: '' }))}
              className={`text-xs px-2 py-1 rounded-full border transition-colors ${filter.tagId === '' ? 'bg-indigo-500 text-white border-indigo-500' : 'text-gray-600 dark:text-slate-300 border-gray-200 dark:border-slate-600 hover:border-gray-400 dark:hover:border-slate-500'}`}
            >
              ทั้งหมด
            </button>
            {tags.map(t => (
              <button
                key={t.id}
                onClick={() => setFilter(f => ({ ...f, tagId: t.id }))}
                className="text-xs px-2 py-1 rounded-full border font-medium transition-colors"
                style={filter.tagId === t.id ? { backgroundColor: t.color, color: '#fff', borderColor: t.color } : { color: t.color, borderColor: `${t.color}55` }}
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <button onClick={onClose} className="text-xs text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 w-full text-center pt-1">ปิด</button>
    </div>
  );
}

function CustomerPanel({ conv, tags, onUpdate, onAddTag, onRemoveTag, onCreateTag, onClose }) {
  const [name, setName] = useState(conv.displayName || '');
  const [notes, setNotes] = useState(conv.notes || '');
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [newTagName, setNewTagName] = useState('');

  useEffect(() => { setName(conv.displayName || ''); setNotes(conv.notes || ''); }, [conv.id]);

  const assignedTagIds = new Set((conv.tags || []).map(t => t.tagId));
  const availableTags = tags.filter(t => !assignedTagIds.has(t.id));

  return (
    <div className="w-72 bg-white dark:bg-slate-900 border-l border-gray-200 dark:border-slate-800 flex flex-col overflow-y-auto flex-shrink-0">
      <div className="p-4 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between">
        <h3 className="font-semibold text-gray-900 dark:text-slate-100 text-sm">รายละเอียดลูกค้า</h3>
        <button onClick={onClose} className="text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300"><X size={16} /></button>
      </div>

      <div className="p-4 flex flex-col items-center border-b border-gray-100 dark:border-slate-800">
        <Avatar name={conv.displayName} pictureUrl={conv.pictureUrl} size={16} />
        <p className="text-xs text-gray-400 dark:text-slate-500 mt-2">{conv.channel?.name}</p>
      </div>

      <div className="p-4 border-b border-gray-100 dark:border-slate-800">
        <label className="text-xs font-medium text-gray-500 dark:text-slate-400 mb-1 flex items-center gap-1"><Pencil size={11}/> ชื่อลูกค้า</label>
        <div className="flex gap-1.5">
          <input
            className="flex-1 border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            value={name}
            onChange={e => setName(e.target.value)}
            onBlur={() => name !== conv.displayName && onUpdate({ displayName: name })}
            onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
          />
        </div>
      </div>

      <div className="p-4 border-b border-gray-100 dark:border-slate-800">
        <label className="text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5 block">Lifecycle stage</label>
        <select
          className={`w-full text-xs font-medium border rounded-lg px-2 py-1.5 focus:outline-none ${stageInfo(conv.lifecycleStage).color}`}
          value={conv.lifecycleStage}
          onChange={e => onUpdate({ lifecycleStage: e.target.value })}
        >
          {LIFECYCLE_STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </div>

      <div className="p-4 border-b border-gray-100 dark:border-slate-800">
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-medium text-gray-500 dark:text-slate-400 flex items-center gap-1"><TagIcon size={11}/> แท็ก</label>
          <button onClick={() => setShowTagPicker(v => !v)} className="text-indigo-500 hover:text-indigo-700 dark:hover:text-indigo-300"><Plus size={14} /></button>
        </div>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {(conv.tags || []).length === 0 && <p className="text-xs text-gray-300 dark:text-slate-600">ยังไม่มีแท็ก</p>}
          {(conv.tags || []).map(({ tag }) => (
            <TagChip key={tag.id} tag={tag} onRemove={() => onRemoveTag(tag.id)} />
          ))}
        </div>
        {showTagPicker && (
          <div className="border border-gray-200 dark:border-slate-700 rounded-lg p-2 bg-gray-50 dark:bg-slate-800 space-y-1.5">
            {availableTags.map(t => (
              <button
                key={t.id}
                onClick={() => { onAddTag(t.id); setShowTagPicker(false); }}
                className="flex items-center gap-2 text-xs w-full text-left px-1.5 py-1 rounded hover:bg-white dark:hover:bg-slate-700 text-gray-700 dark:text-slate-200"
              >
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: t.color }} /> {t.name}
              </button>
            ))}
            <div className="flex gap-1 pt-1">
              <input
                className="flex-1 text-xs border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 rounded px-1.5 py-1 focus:outline-none"
                placeholder="สร้างแท็กใหม่..."
                value={newTagName}
                onChange={e => setNewTagName(e.target.value)}
                onKeyDown={async e => {
                  if (e.key === 'Enter' && newTagName.trim()) {
                    const tag = await onCreateTag(newTagName.trim());
                    if (tag) onAddTag(tag.id);
                    setNewTagName('');
                    setShowTagPicker(false);
                  }
                }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="p-4 flex-1">
        <label className="text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5 block">โน้ต</label>
        <textarea
          className="w-full border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none placeholder:text-gray-400 dark:placeholder:text-slate-500"
          rows={6}
          placeholder="บันทึกรายละเอียดเกี่ยวกับลูกค้า..."
          value={notes}
          onChange={e => setNotes(e.target.value)}
          onBlur={() => notes !== (conv.notes || '') && onUpdate({ notes })}
        />
      </div>
    </div>
  );
}

export default function Inbox() {
  const { socket } = useSocket();
  const { agent } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [suggestion, setSuggestion] = useState('');
  const [agents, setAgents] = useState([]);
  const [channels, setChannels] = useState([]);
  const [tags, setTags] = useState([]);
  const [filter, setFilter] = useState({ status: 'open', channelId: '', search: '', tagId: '', lifecycleStage: '', agentId: '' });
  const [showFilters, setShowFilters] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filter.channelId) n++;
    if (filter.tagId) n++;
    if (filter.lifecycleStage) n++;
    if (filter.agentId) n++;
    return n;
  }, [filter]);

  const loadConversations = useCallback(async () => {
    const params = {};
    Object.entries(filter).forEach(([k, v]) => { if (v) params[k] = v; });
    const { data } = await axios.get('/api/conversations', { params });
    setConversations(data.conversations);
  }, [filter]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  useEffect(() => {
    axios.get('/api/channels').then(r => setChannels(r.data));
    axios.get('/api/agents').then(r => setAgents(r.data));
    axios.get('/api/tags').then(r => setTags(r.data));
  }, []);

  useEffect(() => {
    if (!selected) return;
    axios.get(`/api/messages/${selected.id}`).then(r => setMessages(r.data));
    setSuggestion('');
    socket?.emit('join', selected.id);
    return () => socket?.emit('leave', selected.id);
  }, [selected?.id, socket]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!socket) return;
    socket.on('new_message', ({ message, conversation }) => {
      if (selected?.id === conversation.id) {
        setMessages(prev => (prev.some(m => m.id === message.id) ? prev : [...prev, message]));
      }
    });
    socket.on('conversation_updated', (conv) => {
      setConversations(prev => {
        const idx = prev.findIndex(c => c.id === conv.id);
        if (idx === -1) return [conv, ...prev];
        const next = [...prev];
        next[idx] = { ...next[idx], ...conv };
        return next.sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
      });
      setSelected(prev => (prev?.id === conv.id ? { ...prev, ...conv } : prev));
    });
    return () => { socket.off('new_message'); socket.off('conversation_updated'); };
  }, [socket, selected?.id]);

  async function handleSend(text) {
    const content = (text || input).trim();
    if (!content || !selected || sending) return;
    setSending(true);
    setInput('');
    setSuggestion('');
    try {
      const { data } = await axios.post(`/api/messages/${selected.id}`, { content });
      setMessages(prev => (prev.some(m => m.id === data.id) ? prev : [...prev, data]));
    } finally {
      setSending(false);
    }
  }

  async function getSuggestion() {
    const { data } = await axios.get(`/api/messages/${selected.id}/suggest`);
    setSuggestion(data.suggestion || '');
  }

  async function assignAgent(agentId) {
    const { data } = await axios.patch(`/api/conversations/${selected.id}`, { agentId: agentId || null });
    setSelected(data);
    setConversations(prev => prev.map(c => c.id === data.id ? { ...c, agent: data.agent, agentId: data.agentId } : c));
  }

  async function changeStatus(status) {
    const { data } = await axios.patch(`/api/conversations/${selected.id}`, { status });
    setSelected(data);
    setConversations(prev => prev.filter(c => c.id !== data.id));
  }

  async function updateConv(fields) {
    const { data } = await axios.patch(`/api/conversations/${selected.id}`, fields);
    setSelected(data);
    setConversations(prev => prev.map(c => c.id === data.id ? { ...c, ...data } : c));
  }

  async function addTag(tagId) {
    await axios.post(`/api/tags/${tagId}/conversations/${selected.id}`);
    const { data } = await axios.get(`/api/conversations/${selected.id}`);
    setSelected(data);
    setConversations(prev => prev.map(c => c.id === data.id ? { ...c, tags: data.tags } : c));
  }

  async function removeTag(tagId) {
    await axios.delete(`/api/tags/${tagId}/conversations/${selected.id}`);
    setSelected(prev => ({ ...prev, tags: prev.tags.filter(t => t.tagId !== tagId) }));
    setConversations(prev => prev.map(c => c.id === selected.id ? { ...c, tags: c.tags.filter(t => t.tagId !== tagId) } : c));
  }

  async function createTag(name) {
    try {
      const { data } = await axios.post('/api/tags', { name });
      setTags(prev => [...prev, data]);
      return data;
    } catch { return null; }
  }

  return (
    <div className="flex h-full">
      {/* Conversation list */}
      <div className="w-80 bg-white dark:bg-slate-900 border-r border-gray-200 dark:border-slate-800 flex flex-col flex-shrink-0">
        <div className="p-3 border-b border-gray-100 dark:border-slate-800 relative">
          <h2 className="font-semibold text-gray-900 dark:text-slate-100 mb-2">Inbox</h2>
          <div className="relative mb-2 flex gap-1.5">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-2 top-2.5 text-gray-400 dark:text-slate-500" />
              <input
                className="w-full pl-7 pr-3 py-1.5 text-sm border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-gray-400 dark:placeholder:text-slate-500"
                placeholder="ค้นหา..."
                value={filter.search}
                onChange={e => setFilter(f => ({ ...f, search: e.target.value }))}
              />
            </div>
            <button
              onClick={() => setShowFilters(v => !v)}
              className={`relative flex items-center justify-center w-9 h-9 rounded-lg border transition-colors ${showFilters || activeFilterCount ? 'bg-indigo-500 border-indigo-500 text-white' : 'text-gray-500 dark:text-slate-400 border-gray-200 dark:border-slate-700 hover:border-gray-400 dark:hover:border-slate-500'}`}
            >
              <SlidersHorizontal size={15} />
              {activeFilterCount > 0 && !showFilters && (
                <span className="absolute -top-1 -right-1 bg-rose-500 text-white text-[9px] w-4 h-4 rounded-full flex items-center justify-center">{activeFilterCount}</span>
              )}
            </button>
          </div>
          <div className="flex gap-1 flex-wrap">
            {['open', 'pending', 'closed'].map(s => (
              <button
                key={s}
                onClick={() => setFilter(f => ({ ...f, status: f.status === s ? '' : s }))}
                className={`text-xs px-2 py-1 rounded-full border transition-colors ${filter.status === s ? 'bg-emerald-500 text-white border-emerald-500' : 'text-gray-600 dark:text-slate-300 border-gray-200 dark:border-slate-700 hover:border-gray-400 dark:hover:border-slate-500'}`}
              >
                {s === 'open' ? 'เปิด' : s === 'pending' ? 'รอ' : 'ปิด'}
              </button>
            ))}
          </div>
          {showFilters && (
            <FilterPanel filter={filter} setFilter={setFilter} channels={channels} agents={agents} tags={tags} onClose={() => setShowFilters(false)} />
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 && (
            <p className="text-center text-gray-400 dark:text-slate-500 text-sm py-8">ไม่มีการสนทนา</p>
          )}
          {conversations.map(conv => (
            <ConversationItem
              key={conv.id}
              conv={conv}
              selected={selected?.id === conv.id}
              onClick={() => setSelected(conv)}
            />
          ))}
        </div>
      </div>

      {/* Chat window */}
      {selected ? (
        <>
          <div className="flex-1 flex flex-col min-w-0">
            {/* Header */}
            <div className="bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800 px-4 py-3 flex items-center gap-3">
              <Avatar name={selected.displayName} pictureUrl={selected.pictureUrl} />
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-gray-900 dark:text-slate-100 truncate">{selected.displayName || selected.lineUserId}</h3>
                <p className="text-xs text-gray-500 dark:text-slate-500">{selected.channel?.name}</p>
              </div>
              <div className="flex items-center gap-2">
                <UserCheck size={16} className="text-gray-400 dark:text-slate-500" />
                <select
                  className="text-sm border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 rounded-lg px-2 py-1 focus:outline-none"
                  value={selected.agentId || ''}
                  onChange={e => assignAgent(e.target.value)}
                >
                  <option value="">ไม่ได้ assign</option>
                  {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <select
                className={`text-xs px-2 py-1 rounded-full border-0 font-medium ${STATUS_COLORS[selected.status]}`}
                value={selected.status}
                onChange={e => changeStatus(e.target.value)}
              >
                <option value="open">เปิด</option>
                <option value="pending">รอ</option>
                <option value="closed">ปิด</option>
              </select>
              <button
                onClick={() => setShowDetail(v => !v)}
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${showDetail ? 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400' : 'text-gray-400 dark:text-slate-500 hover:bg-gray-100 dark:hover:bg-slate-800'}`}
                title="รายละเอียดลูกค้า"
              >
                <Info size={16} />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 bg-gray-50 dark:bg-slate-950">
              {messages.map(msg => <MessageBubble key={msg.id} msg={msg} />)}
              <div ref={bottomRef} />
            </div>

            {/* AI suggestion */}
            {suggestion && (
              <div className="bg-indigo-50 dark:bg-indigo-500/10 border-t border-indigo-100 dark:border-indigo-500/20 px-4 py-2 flex items-center gap-2">
                <Sparkles size={14} className="text-indigo-500 flex-shrink-0" />
                <span className="text-sm text-indigo-700 dark:text-indigo-300 flex-1">{suggestion}</span>
                <button onClick={() => { setInput(suggestion); setSuggestion(''); }} className="text-xs bg-indigo-500 text-white px-2 py-1 rounded hover:bg-indigo-600">ใช้</button>
                <button onClick={() => setSuggestion('')}><X size={14} className="text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300" /></button>
              </div>
            )}

            {/* Input */}
            <div className="bg-white dark:bg-slate-900 border-t border-gray-200 dark:border-slate-800 px-4 py-3 flex gap-2">
              <button
                onClick={getSuggestion}
                title="AI suggest reply"
                className="text-gray-400 dark:text-slate-500 hover:text-indigo-500 transition-colors flex-shrink-0"
              >
                <Sparkles size={20} />
              </button>
              <input
                className="flex-1 border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 placeholder:text-gray-400 dark:placeholder:text-slate-500"
                placeholder="พิมพ์ข้อความ..."
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
              />
              <button
                onClick={() => handleSend()}
                disabled={!input.trim() || sending}
                className="bg-emerald-500 text-white rounded-xl px-4 py-2 hover:bg-emerald-600 disabled:opacity-40 transition-colors flex-shrink-0"
              >
                <Send size={18} />
              </button>
            </div>
          </div>

          {showDetail && (
            <CustomerPanel
              conv={selected}
              tags={tags}
              onUpdate={updateConv}
              onAddTag={addTag}
              onRemoveTag={removeTag}
              onCreateTag={createTag}
              onClose={() => setShowDetail(false)}
            />
          )}
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center text-gray-400 dark:text-slate-600 bg-gray-50 dark:bg-slate-950">
          <div className="text-center">
            <div className="text-5xl mb-3">💬</div>
            <p>เลือกการสนทนาเพื่อเริ่มต้น</p>
          </div>
        </div>
      )}
    </div>
  );
}
