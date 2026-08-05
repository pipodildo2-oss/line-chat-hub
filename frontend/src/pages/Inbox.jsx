import { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { formatDistanceToNow } from 'date-fns';
import { th } from 'date-fns/locale';
import { Send, Sparkles, UserCheck, X, Search, Filter } from 'lucide-react';
import { useSocket } from '../contexts/SocketContext';
import { useAuth } from '../contexts/AuthContext';

const STATUS_COLORS = { open: 'bg-green-100 text-green-700', pending: 'bg-yellow-100 text-yellow-700', closed: 'bg-gray-100 text-gray-600' };

function Avatar({ name, pictureUrl, size = 10 }) {
  if (pictureUrl) return <img src={pictureUrl} className={`w-${size} h-${size} rounded-full object-cover`} />;
  return (
    <div className={`w-${size} h-${size} rounded-full bg-indigo-400 flex items-center justify-center text-white font-medium text-sm`}>
      {name?.[0]?.toUpperCase() || '?'}
    </div>
  );
}

function ConversationItem({ conv, selected, onClick }) {
  const lastMsg = conv.messages?.[0];
  const unread = conv._count?.messages || 0;
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b hover:bg-gray-50 transition-colors flex gap-3 ${selected ? 'bg-indigo-50 border-l-2 border-l-indigo-500' : ''}`}
    >
      <Avatar name={conv.displayName} pictureUrl={conv.pictureUrl} />
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-start">
          <span className="font-medium text-sm text-gray-900 truncate">{conv.displayName || conv.lineUserId}</span>
          <span className="text-xs text-gray-400 ml-2 whitespace-nowrap">
            {conv.lastMessageAt ? formatDistanceToNow(new Date(conv.lastMessageAt), { locale: th, addSuffix: false }) : ''}
          </span>
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          <span className="text-xs text-gray-400 truncate flex-1">
            {lastMsg?.sender === 'agent' ? '✓ ' : ''}{lastMsg?.content || ''}
          </span>
          {unread > 0 && (
            <span className="bg-green-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0">
              {unread}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 mt-1">
          <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{conv.channel?.name}</span>
          {conv.agent && <span className="text-xs text-indigo-600">→ {conv.agent.name}</span>}
        </div>
      </div>
    </button>
  );
}

function MessageBubble({ msg }) {
  const isUser = msg.sender === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-start' : 'justify-end'} mb-2`}>
      <div className={`max-w-xs lg:max-w-md px-4 py-2 rounded-2xl text-sm ${isUser ? 'bg-white border text-gray-800 rounded-tl-sm' : 'bg-green-500 text-white rounded-tr-sm'}`}>
        <p className="whitespace-pre-wrap break-words">{msg.content}</p>
        <p className={`text-xs mt-1 ${isUser ? 'text-gray-400' : 'text-green-100'}`}>
          {new Date(msg.createdAt).toLocaleTimeString('th', { hour: '2-digit', minute: '2-digit' })}
          {msg.sender === 'agent' && msg.senderName ? ` · ${msg.senderName}` : ''}
        </p>
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
  const [filter, setFilter] = useState({ status: 'open', channelId: '', search: '' });
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  // Load conversations
  const loadConversations = useCallback(async () => {
    const params = {};
    if (filter.status) params.status = filter.status;
    if (filter.channelId) params.channelId = filter.channelId;
    if (filter.search) params.search = filter.search;
    const { data } = await axios.get('/api/conversations', { params });
    setConversations(data.conversations);
  }, [filter]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  // Load channels & agents
  useEffect(() => {
    axios.get('/api/channels').then(r => setChannels(r.data));
    axios.get('/api/agents').then(r => setAgents(r.data));
  }, []);

  // Load messages when selecting conversation
  useEffect(() => {
    if (!selected) return;
    axios.get(`/api/messages/${selected.id}`).then(r => setMessages(r.data));
    setSuggestion('');
    socket?.emit('join', selected.id);
    return () => socket?.emit('leave', selected.id);
  }, [selected?.id, socket]);

  // Scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Socket events
  useEffect(() => {
    if (!socket) return;
    socket.on('new_message', ({ message, conversation }) => {
      if (selected?.id === conversation.id) {
        setMessages(prev => [...prev, message]);
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
      setMessages(prev => [...prev, data]);
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

  return (
    <div className="flex h-full">
      {/* Conversation list */}
      <div className="w-80 bg-white border-r flex flex-col">
        <div className="p-3 border-b">
          <h2 className="font-semibold text-gray-900 mb-2">Inbox</h2>
          {/* Search */}
          <div className="relative mb-2">
            <Search size={14} className="absolute left-2 top-2.5 text-gray-400" />
            <input
              className="w-full pl-7 pr-3 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="ค้นหา..."
              value={filter.search}
              onChange={e => setFilter(f => ({ ...f, search: e.target.value }))}
            />
          </div>
          {/* Filters */}
          <div className="flex gap-1 flex-wrap">
            {['open', 'pending', 'closed'].map(s => (
              <button
                key={s}
                onClick={() => setFilter(f => ({ ...f, status: f.status === s ? '' : s }))}
                className={`text-xs px-2 py-1 rounded-full border transition-colors ${filter.status === s ? 'bg-green-500 text-white border-green-500' : 'text-gray-600 hover:border-gray-400'}`}
              >
                {s === 'open' ? 'เปิด' : s === 'pending' ? 'รอ' : 'ปิด'}
              </button>
            ))}
            <select
              className="text-xs border rounded-full px-2 py-1 ml-auto focus:outline-none"
              value={filter.channelId}
              onChange={e => setFilter(f => ({ ...f, channelId: e.target.value }))}
            >
              <option value="">ทุก OA</option>
              {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 && (
            <p className="text-center text-gray-400 text-sm py-8">ไม่มีการสนทนา</p>
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
        <div className="flex-1 flex flex-col">
          {/* Header */}
          <div className="bg-white border-b px-4 py-3 flex items-center gap-3">
            <Avatar name={selected.displayName} pictureUrl={selected.pictureUrl} />
            <div className="flex-1">
              <h3 className="font-medium text-gray-900">{selected.displayName || selected.lineUserId}</h3>
              <p className="text-xs text-gray-500">{selected.channel?.name}</p>
            </div>
            {/* Assign agent */}
            <div className="flex items-center gap-2">
              <UserCheck size={16} className="text-gray-400" />
              <select
                className="text-sm border rounded-lg px-2 py-1 focus:outline-none"
                value={selected.agentId || ''}
                onChange={e => assignAgent(e.target.value)}
              >
                <option value="">ไม่ได้ assign</option>
                {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            {/* Status */}
            <select
              className={`text-xs px-2 py-1 rounded-full border-0 font-medium ${STATUS_COLORS[selected.status]}`}
              value={selected.status}
              onChange={e => changeStatus(e.target.value)}
            >
              <option value="open">เปิด</option>
              <option value="pending">รอ</option>
              <option value="closed">ปิด</option>
            </select>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
            {messages.map(msg => <MessageBubble key={msg.id} msg={msg} />)}
            <div ref={bottomRef} />
          </div>

          {/* AI suggestion */}
          {suggestion && (
            <div className="bg-indigo-50 border-t border-indigo-100 px-4 py-2 flex items-center gap-2">
              <Sparkles size={14} className="text-indigo-500 flex-shrink-0" />
              <span className="text-sm text-indigo-700 flex-1">{suggestion}</span>
              <button onClick={() => { setInput(suggestion); setSuggestion(''); }} className="text-xs bg-indigo-500 text-white px-2 py-1 rounded hover:bg-indigo-600">ใช้</button>
              <button onClick={() => setSuggestion('')}><X size={14} className="text-gray-400 hover:text-gray-600" /></button>
            </div>
          )}

          {/* Input */}
          <div className="bg-white border-t px-4 py-3 flex gap-2">
            <button
              onClick={getSuggestion}
              title="AI suggest reply"
              className="text-gray-400 hover:text-indigo-500 transition-colors flex-shrink-0"
            >
              <Sparkles size={20} />
            </button>
            <input
              className="flex-1 border rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="พิมพ์ข้อความ..."
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
            />
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || sending}
              className="bg-green-500 text-white rounded-xl px-4 py-2 hover:bg-green-600 disabled:opacity-40 transition-colors flex-shrink-0"
            >
              <Send size={18} />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-gray-400">
          <div className="text-center">
            <div className="text-5xl mb-3">💬</div>
            <p>เลือกการสนทนาเพื่อเริ่มต้น</p>
          </div>
        </div>
      )}
    </div>
  );
}
