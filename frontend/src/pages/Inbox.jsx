import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { formatDistanceToNow, isToday, isYesterday, isSameDay, format } from 'date-fns';
import { th } from 'date-fns/locale';
import { Send, Sparkles, UserCheck, X, Search, SlidersHorizontal, Info, Tag as TagIcon, Plus, Check, CheckCheck, Pencil, Zap, ImagePlus, Smile, Loader2 } from 'lucide-react';
import { useSocket } from '../contexts/SocketContext';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { STATUS_COLORS } from '../lib/constants';

// Tailwind's JIT compiler only picks up class names it can see literally in the
// source, so `w-${size}` (a runtime template string) never gets generated and the
// avatar ends up with no size constraint at all. Map to static classes instead.
const AVATAR_SIZE_CLASSES = {
  10: 'w-10 h-10',
  16: 'w-16 h-16',
};

// How many messages GET /api/messages/:conversationId returns per page —
// matches the backend's own default `limit` there.
const MESSAGE_PAGE_LIMIT = 50;

function Avatar({ name, pictureUrl, size = 10 }) {
  const sizeCls = AVATAR_SIZE_CLASSES[size] || AVATAR_SIZE_CLASSES[10];
  if (pictureUrl) return <img src={pictureUrl} className={`${sizeCls} rounded-full object-cover flex-shrink-0`} />;
  return (
    <div className={`${sizeCls} rounded-full bg-gradient-to-br from-aurora-teal to-aurora-purple flex items-center justify-center text-white font-medium text-sm flex-shrink-0`}>
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

function ConversationItem({ conv, selected, onClick, typingAgent }) {
  const lastMsg = conv.messages?.[0];
  const unread = conv._count?.messages || 0;
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/60 transition-colors flex gap-3 ${selected ? 'bg-gradient-to-r from-aurora-teal/10 to-aurora-purple/10 border-l-2 border-l-aurora-teal' : ''}`}
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
          {typingAgent ? (
            // Visible right in the list, without opening the chat — this is what
            // actually helps avoid two agents replying to the same customer at once.
            <span className="text-xs text-aurora-tealDeep dark:text-aurora-teal font-medium truncate flex-1 animate-pulse">
              ✏️ {typingAgent} กำลังพิมพ์...
            </span>
          ) : (
            <span className="text-xs text-gray-400 dark:text-slate-500 truncate flex-1">
              {lastMsg?.sender === 'agent' ? '✓ ' : ''}{lastMsg?.content || ''}
            </span>
          )}
          {unread > 0 && (
            <span className="bg-aurora-green text-aurora-midnight font-semibold text-xs rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0">
              {unread}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 mt-1.5 flex-wrap">
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400">{conv.channel?.name}</span>
          {conv.agent && <span className="text-[10px] text-aurora-teal dark:text-aurora-teal">→ {conv.agent.name}</span>}
          {conv.blocked && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-500 dark:text-rose-400 font-medium" title="ลูกค้าบล็อคเราอยู่">
              🚫 บล็อค
            </span>
          )}
          {conv.channel?.active === false && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 dark:bg-slate-700 text-gray-500 dark:text-slate-400 font-medium" title="ช่องทางนี้ถูกปิดใช้งานอยู่">
              ⏸ ปิดใช้งาน
            </span>
          )}
          {conv.tags?.slice(0, 2).map(({ tag }) => <TagChip key={tag.id} tag={tag} small />)}
        </div>
      </div>
    </button>
  );
}

// LINE's media content endpoint requires our server's Channel Access Token to fetch —
// there's no public URL an <img> tag can hit directly. So we fetch it ourselves through
// our authenticated backend proxy and turn it into a blob URL.
function ImageMessage({ messageId, onImageClick }) {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl;
    let cancelled = false;
    setSrc(null);
    setFailed(false);
    axios.get(`/api/messages/content/${messageId}`, { responseType: 'blob' })
      .then(res => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(res.data);
        setSrc(objectUrl);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [messageId]);

  if (failed) return <p className="text-sm text-gray-400">[Image]</p>;
  if (!src) return <div className="w-48 h-48 rounded-lg bg-gray-100 dark:bg-slate-800 animate-pulse" />;
  return (
    <button type="button" onClick={() => onImageClick?.(src)} className="block cursor-zoom-in">
      <img src={src} alt="" className="max-w-[240px] max-h-[240px] rounded-lg object-cover" />
    </button>
  );
}

// Same authenticated-proxy pattern as ImageMessage above — LINE's video
// content also requires our Channel Access Token to fetch, so it's pulled
// through the backend and played from a blob URL rather than linked directly.
function VideoMessage({ messageId }) {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl;
    let cancelled = false;
    setSrc(null);
    setFailed(false);
    axios.get(`/api/messages/content/${messageId}`, { responseType: 'blob' })
      .then(res => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(res.data);
        setSrc(objectUrl);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [messageId]);

  if (failed) return <p className="text-sm text-gray-400">[Video] โหลดวิดีโอไม่สำเร็จ</p>;
  if (!src) {
    return (
      <div className="w-56 h-40 rounded-lg bg-gray-100 dark:bg-slate-800 animate-pulse flex items-center justify-center text-xs text-gray-400 dark:text-slate-500">
        กำลังโหลดวิดีโอ...
      </div>
    );
  }
  return (
    // eslint-disable-next-line jsx-a11y/media-has-caption
    <video src={src} controls preload="metadata" className="max-w-[280px] max-h-[280px] rounded-lg bg-black" />
  );
}

// Full-screen in-app image viewer — used for customer-sent images, agent-sent
// images, and the not-yet-sent pending attachment, so clicking any of them
// stays in the current tab instead of opening a new browser tab.
function Lightbox({ src, onClose }) {
  if (!src) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-white/80 hover:text-white bg-white/10 hover:bg-white/20 rounded-full w-9 h-9 flex items-center justify-center"
      >
        <X size={20} />
      </button>
      <img
        src={src}
        alt=""
        className="max-w-full max-h-full rounded-lg object-contain"
        onClick={e => e.stopPropagation()}
      />
    </div>
  );
}

function formatDayLabel(date) {
  if (isToday(date)) return 'วันนี้';
  if (isYesterday(date)) return 'เมื่อวาน';
  return format(date, 'd MMMM yyyy', { locale: th });
}

// A "วันนี้ / เมื่อวาน / 12 สิงหาคม 2569" divider inserted between messages from
// different days, so it's obvious at a glance which day a message belongs to.
function DateDivider({ label }) {
  return (
    <div className="flex items-center gap-3 my-3">
      <div className="flex-1 h-px bg-gray-200 dark:bg-slate-800" />
      <span className="text-xs text-gray-400 dark:text-slate-500 font-medium whitespace-nowrap">{label}</span>
      <div className="flex-1 h-px bg-gray-200 dark:bg-slate-800" />
    </div>
  );
}

// Admin-only audit trail: names of agents who opened the conversation while this
// was the newest customer message and did NOT go on to reply. Only ever rendered
// for customer (sender: 'user') messages — msg.views only arrives from the API at
// all when the requesting agent is an admin, and isAdmin here is a second,
// belt-and-suspenders check on the frontend.
function ViewerTags({ msg, isAdmin }) {
  if (!isAdmin || msg.sender !== 'user' || !msg.views?.length) return null;
  const names = msg.views.map(v => v.agent?.name).filter(Boolean);
  if (names.length === 0) return null;
  return (
    <p className="text-[10px] text-amber-500 dark:text-amber-400 mt-1" title="เปิดอ่านแล้วแต่ยังไม่มีการตอบกลับข้อความนี้">
      👁 เปิดอ่านแล้วไม่ตอบ: {names.join(', ')}
    </p>
  );
}

// NOT a LINE read receipt — LINE's Messaging API has no way to tell us when a
// customer has actually opened/read a message we sent (only human-to-human
// LINE chats get that; it isn't exposed to bots/OAs at all). This is the
// closest honest proxy available: one tick once we've sent it, two once the
// customer has sent ANYTHING back afterward in this conversation (concrete
// proof they were in the chat, even if we can't know exactly when they saw
// this particular message).
function DeliveryTick({ repliedTo, onBubble }) {
  const Icon = repliedTo ? CheckCheck : Check;
  const activeCls = onBubble ? 'text-teal-200' : 'text-aurora-tealDeep dark:text-aurora-teal';
  const inactiveCls = onBubble ? 'text-white/50' : 'text-gray-400 dark:text-slate-500';
  return (
    <span
      className="inline-block ml-1 align-text-bottom"
      title={repliedTo ? 'ลูกค้าส่งข้อความกลับมาหลังจากนี้' : 'ส่งแล้ว — ยังไม่มีข้อความตอบกลับจากลูกค้า'}
    >
      <Icon size={12} className={repliedTo ? activeCls : inactiveCls} />
    </span>
  );
}

function MessageBubble({ msg, onImageClick, isAdmin, repliedTo }) {
  const isUser = msg.sender === 'user';
  const timeCls = isUser ? 'text-gray-400 dark:text-slate-500' : 'text-white/70';
  const timeLabel = (
    <p className={`text-xs mt-1 ${timeCls}`}>
      {new Date(msg.createdAt).toLocaleTimeString('th', { hour: '2-digit', minute: '2-digit' })}
      {msg.sender === 'agent' && msg.senderName ? ` · ${msg.senderName}` : ''}
      {!isUser && <DeliveryTick repliedTo={repliedTo} onBubble />}
    </p>
  );

  if (msg.type === 'image' && msg.lineMessageId) {
    return (
      <div className={`flex ${isUser ? 'justify-start' : 'justify-end'} mb-2`}>
        <div className="max-w-xs lg:max-w-md">
          <ImageMessage messageId={msg.lineMessageId} onImageClick={onImageClick} />
          <p className={`text-xs mt-1 ${isUser ? 'text-gray-400 dark:text-slate-500' : 'text-gray-400 dark:text-slate-500 text-right'}`}>
            {new Date(msg.createdAt).toLocaleTimeString('th', { hour: '2-digit', minute: '2-digit' })}
            {msg.sender === 'agent' && msg.senderName ? ` · ${msg.senderName}` : ''}
            {!isUser && <DeliveryTick repliedTo={repliedTo} />}
          </p>
          <ViewerTags msg={msg} isAdmin={isAdmin} />
        </div>
      </div>
    );
  }

  // Image attached to a quick-reply we sent — served from our own public
  // /api/quick-replies/:id/image route, so it can be linked directly (no auth proxy needed).
  if (msg.type === 'image' && !msg.lineMessageId) {
    let meta = {};
    try { meta = msg.metadata ? JSON.parse(msg.metadata) : {}; } catch { /* ignore */ }
    return (
      <div className={`flex ${isUser ? 'justify-start' : 'justify-end'} mb-2`}>
        <div className="max-w-xs lg:max-w-md">
          {meta.url ? (
            <button type="button" onClick={() => onImageClick?.(meta.url)} className="block cursor-zoom-in">
              <img src={meta.url} alt="" className="max-w-[240px] max-h-[240px] rounded-lg object-cover" />
            </button>
          ) : <p className="text-sm text-gray-400">[Image]</p>}
          <p className={`text-xs mt-1 ${isUser ? 'text-gray-400 dark:text-slate-500' : 'text-gray-400 dark:text-slate-500 text-right'}`}>
            {new Date(msg.createdAt).toLocaleTimeString('th', { hour: '2-digit', minute: '2-digit' })}
            {msg.sender === 'agent' && msg.senderName ? ` · ${msg.senderName}` : ''}
            {!isUser && <DeliveryTick repliedTo={repliedTo} />}
          </p>
          <ViewerTags msg={msg} isAdmin={isAdmin} />
        </div>
      </div>
    );
  }

  if (msg.type === 'sticker') {
    let meta = {};
    try { meta = msg.metadata ? JSON.parse(msg.metadata) : {}; } catch { /* ignore */ }
    const stickerUrl = meta.stickerId
      ? `https://stickershop.line-scdn.net/stickershop/v1/sticker/${meta.stickerId}/android/sticker.png`
      : null;
    return (
      <div className={`flex ${isUser ? 'justify-start' : 'justify-end'} mb-2`}>
        <div className="max-w-xs lg:max-w-md">
          {stickerUrl ? <img src={stickerUrl} alt="sticker" className="w-24 h-24 object-contain" /> : <p className="text-sm text-gray-400">[Sticker]</p>}
          <p className={`text-xs mt-1 ${isUser ? 'text-gray-400 dark:text-slate-500' : 'text-gray-400 dark:text-slate-500 text-right'}`}>
            {new Date(msg.createdAt).toLocaleTimeString('th', { hour: '2-digit', minute: '2-digit' })}
            {msg.sender === 'agent' && msg.senderName ? ` · ${msg.senderName}` : ''}
            {!isUser && <DeliveryTick repliedTo={repliedTo} />}
          </p>
          <ViewerTags msg={msg} isAdmin={isAdmin} />
        </div>
      </div>
    );
  }

  // Customer-sent video (agents can only attach images from the composer, so
  // there's no "agent-sent video" case to handle here unlike the image
  // branches above). Needs a lineMessageId to fetch through LINE's content
  // API — every incoming message has one, so this should always be present.
  if (msg.type === 'video' && msg.lineMessageId) {
    return (
      <div className={`flex ${isUser ? 'justify-start' : 'justify-end'} mb-2`}>
        <div className="max-w-xs lg:max-w-md">
          <VideoMessage messageId={msg.lineMessageId} />
          <p className={`text-xs mt-1 ${isUser ? 'text-gray-400 dark:text-slate-500' : 'text-gray-400 dark:text-slate-500 text-right'}`}>
            {new Date(msg.createdAt).toLocaleTimeString('th', { hour: '2-digit', minute: '2-digit' })}
            {msg.sender === 'agent' && msg.senderName ? ` · ${msg.senderName}` : ''}
            {!isUser && <DeliveryTick repliedTo={repliedTo} />}
          </p>
          <ViewerTags msg={msg} isAdmin={isAdmin} />
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${isUser ? 'justify-start' : 'justify-end'} mb-2`}>
      <div className="max-w-xs lg:max-w-md">
        <div className={`px-4 py-2 rounded-2xl text-sm shadow-sm ${isUser ? 'bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 text-gray-800 dark:text-slate-100 rounded-tl-sm' : 'bg-gradient-to-br from-aurora-tealDeep to-aurora-purple text-white rounded-tr-sm'}`}>
          <p className="whitespace-pre-wrap break-words">{msg.content}</p>
          {timeLabel}
        </div>
        <ViewerTags msg={msg} isAdmin={isAdmin} />
      </div>
    </div>
  );
}

function FilterPanel({ filter, setFilter, channels, agents, tags, onClose }) {
  const { t } = useLanguage();
  const [showChannelPicker, setShowChannelPicker] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState({});
  const channelLabel = filter.channelIds.length === 0
    ? 'ทุก OA'
    : filter.channelIds.length === 1
      ? channels.find(c => c.id === filter.channelIds[0])?.name || 'เลือก 1 ช่องทาง'
      : `เลือก ${filter.channelIds.length} ช่องทาง`;

  // Nest channels under their category's parent "หมวดหมู่ใหญ่" group (if any) —
  // a channel with no category, or whose category has no group, stays in the
  // flat list below instead. Grouped channels start collapsed (expandedGroups)
  // so a long OA list doesn't overwhelm the picker by default.
  const groupMap = new Map();
  const flatChannels = [];
  channels.forEach(c => {
    const group = c.category?.group;
    if (group) {
      if (!groupMap.has(group.id)) groupMap.set(group.id, { id: group.id, name: group.name, channels: [] });
      groupMap.get(group.id).channels.push(c);
    } else {
      flatChannels.push(c);
    }
  });
  const channelGroups = Array.from(groupMap.values());
  return (
    <div className="absolute top-full left-3 right-3 mt-1 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-lg z-20 p-3 space-y-3">
      <div>
        <p className="text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">สถานะ</p>
        <div className="flex gap-1 flex-wrap">
          {['', 'open', 'pending', 'closed'].map(s => (
            <button
              key={s || 'all'}
              onClick={() => setFilter(f => ({ ...f, status: s }))}
              className={`text-xs px-2 py-1 rounded-full border transition-colors ${filter.status === s ? 'bg-gradient-to-r from-aurora-teal to-aurora-purple text-white border-transparent' : 'text-gray-600 dark:text-slate-300 border-gray-200 dark:border-slate-600 hover:border-gray-400 dark:hover:border-slate-500'}`}
            >
              {s === '' ? t('status_all') : s === 'open' ? t('status_open') : s === 'pending' ? t('status_pending') : t('status_closed')}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">เรียงตาม</p>
        <div className="flex gap-1 flex-wrap">
          {[
            { key: 'newest', label: 'ใหม่สุด → เก่าสุด' },
            { key: 'oldest', label: 'เก่าสุด → ใหม่สุด' },
          ].map(opt => (
            <button
              key={opt.key}
              onClick={() => setFilter(f => ({ ...f, sort: opt.key }))}
              className={`text-xs px-2 py-1 rounded-full border transition-colors ${(filter.sort || 'newest') === opt.key ? 'bg-gradient-to-r from-aurora-teal to-aurora-purple text-white border-transparent' : 'text-gray-600 dark:text-slate-300 border-gray-200 dark:border-slate-600 hover:border-gray-400 dark:hover:border-slate-500'}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div className="relative">
        <p className="text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">ช่องทาง</p>
        <button
          type="button"
          onClick={() => setShowChannelPicker(v => !v)}
          className={`w-full flex items-center justify-between text-xs border rounded-lg px-2 py-1.5 focus:outline-none ${filter.channelIds.length > 0 ? 'border-aurora-teal text-aurora-tealDeep dark:text-aurora-teal bg-aurora-teal/5' : 'border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-700 dark:text-slate-200'}`}
        >
          <span>{channelLabel}</span>
          <span className="text-gray-400 dark:text-slate-500">{showChannelPicker ? '▲' : '▼'}</span>
        </button>
        {showChannelPicker && (
          <div className="absolute top-full left-0 right-0 mt-1 border border-gray-200 dark:border-slate-600 rounded-lg p-1.5 space-y-0.5 max-h-40 overflow-y-auto bg-white dark:bg-slate-700 shadow-lg z-30">
            <label className="flex items-center gap-2 text-xs px-1.5 py-1 rounded hover:bg-gray-50 dark:hover:bg-slate-600 cursor-pointer text-gray-700 dark:text-slate-200 font-medium border-b border-gray-100 dark:border-slate-600 mb-0.5 pb-1.5">
              <input
                type="checkbox"
                className="accent-aurora-teal"
                checked={filter.channelIds.length === 0}
                onChange={() => setFilter(f => ({ ...f, channelIds: [] }))}
              />
              ทั้งหมด
            </label>
            {channelGroups.map(group => {
              const ids = group.channels.map(c => c.id);
              const allSelected = ids.length > 0 && ids.every(id => filter.channelIds.includes(id));
              const expanded = !!expandedGroups[group.id];
              return (
                <div key={group.id} className="border-b border-gray-100 dark:border-slate-600 pb-0.5 mb-0.5 last:border-0 last:mb-0 last:pb-0">
                  <div className="flex items-center gap-0.5">
                    <label className="flex items-center gap-2 text-xs px-1.5 py-1 rounded hover:bg-gray-50 dark:hover:bg-slate-600 cursor-pointer text-gray-700 dark:text-slate-200 font-medium flex-1 min-w-0">
                      <input
                        type="checkbox"
                        className="accent-aurora-teal flex-shrink-0"
                        checked={allSelected}
                        onChange={() => setFilter(f => ({
                          ...f,
                          channelIds: allSelected
                            ? f.channelIds.filter(id => !ids.includes(id))
                            : [...new Set([...f.channelIds, ...ids])],
                        }))}
                      />
                      <span className="truncate">{group.name}</span>
                      <span className="text-[10px] text-gray-400 dark:text-slate-500 font-normal flex-shrink-0">({group.channels.length})</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setExpandedGroups(e => ({ ...e, [group.id]: !e[group.id] }))}
                      className="text-gray-400 dark:text-slate-500 px-1.5 py-1 flex-shrink-0"
                    >
                      {expanded ? '▲' : '▼'}
                    </button>
                  </div>
                  {expanded && (
                    <div className="pl-4 space-y-0.5">
                      {group.channels.map(c => (
                        <label key={c.id} className="flex items-center gap-2 text-xs px-1.5 py-1 rounded hover:bg-gray-50 dark:hover:bg-slate-600 cursor-pointer text-gray-600 dark:text-slate-300">
                          <input
                            type="checkbox"
                            className="accent-aurora-teal"
                            checked={filter.channelIds.includes(c.id)}
                            onChange={() => setFilter(f => ({
                              ...f,
                              channelIds: f.channelIds.includes(c.id) ? f.channelIds.filter(x => x !== c.id) : [...f.channelIds, c.id],
                            }))}
                          />
                          {c.name}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {flatChannels.map(c => (
              <label key={c.id} className="flex items-center gap-2 text-xs px-1.5 py-1 rounded hover:bg-gray-50 dark:hover:bg-slate-600 cursor-pointer text-gray-700 dark:text-slate-200">
                <input
                  type="checkbox"
                  className="accent-aurora-teal"
                  checked={filter.channelIds.includes(c.id)}
                  onChange={() => setFilter(f => ({
                    ...f,
                    channelIds: f.channelIds.includes(c.id) ? f.channelIds.filter(x => x !== c.id) : [...f.channelIds, c.id],
                  }))}
                />
                {c.name}
              </label>
            ))}
            {channels.length === 0 && <p className="text-xs text-gray-400 dark:text-slate-500 px-1.5 py-1">ยังไม่มีช่องทาง</p>}
          </div>
        )}
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
      {tags.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">แท็ก</p>
          <div className="flex gap-1 flex-wrap">
            <button
              onClick={() => setFilter(f => ({ ...f, tagId: '' }))}
              className={`text-xs px-2 py-1 rounded-full border transition-colors ${filter.tagId === '' ? 'bg-gradient-to-r from-aurora-teal to-aurora-purple text-white border-transparent' : 'text-gray-600 dark:text-slate-300 border-gray-200 dark:border-slate-600 hover:border-gray-400 dark:hover:border-slate-500'}`}
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

function CustomerPanel({ conv, tags, onUpdate, onAddTag, onRemoveTag, onCreateTag, onClose, isAdmin }) {
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
        {conv.blocked && (
          <span className="mt-2 text-[11px] px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-500 dark:text-rose-400 font-medium">
            🚫 ลูกค้าบล็อคเราอยู่
          </span>
        )}
      </div>

      {/* Manual override — LINE gives no API to check current block status, only
          the 'unfollow'/'follow' webhook events going forward, so a block that
          happened before this feature shipped (or a rare missed webhook) can't
          be auto-detected. Admin can correct it by hand here. */}
      {isAdmin && (
        <div className="p-4 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between">
          <span className="text-xs font-medium text-gray-500 dark:text-slate-400">ลูกค้าบล็อคเราอยู่</span>
          <button
            onClick={() => onUpdate({ blocked: !conv.blocked })}
            className={`relative inline-flex overflow-hidden w-9 h-5 rounded-full transition-colors flex-shrink-0 ${conv.blocked ? 'bg-rose-500' : 'bg-gray-200 dark:bg-slate-700'}`}
          >
            <span className={`absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${conv.blocked ? 'translate-x-4' : 'translate-x-0'}`} />
          </button>
        </div>
      )}

      <div className="p-4 border-b border-gray-100 dark:border-slate-800">
        <label className="text-xs font-medium text-gray-500 dark:text-slate-400 mb-1 flex items-center gap-1"><Pencil size={11}/> ชื่อลูกค้า</label>
        <div className="flex gap-1.5">
          <input
            className="flex-1 border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-aurora-tealDeep"
            value={name}
            onChange={e => setName(e.target.value)}
            onBlur={() => name !== conv.displayName && onUpdate({ displayName: name })}
            onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
          />
        </div>
      </div>

      <div className="p-4 border-b border-gray-100 dark:border-slate-800">
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-medium text-gray-500 dark:text-slate-400 flex items-center gap-1"><TagIcon size={11}/> แท็ก</label>
          <button onClick={() => setShowTagPicker(v => !v)} className="text-aurora-tealDeep hover:text-aurora-teal dark:hover:text-aurora-teal"><Plus size={14} /></button>
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
            {isAdmin && (
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
            )}
          </div>
        )}
      </div>

      <div className="p-4 flex-1">
        <label className="text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5 block">โน้ต</label>
        <textarea
          className="w-full border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-aurora-tealDeep resize-none placeholder:text-gray-400 dark:placeholder:text-slate-500"
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

const QR_KIND_TABS = [
  { key: 'reply', label: 'ตอบกลับ' },
  { key: 'promotion', label: 'โปรโมชั่น' },
];

// Small curated set rather than a full picker library/dependency — covers
// the common cases for a customer-service chat (reactions, hands, status
// marks) without pulling in an emoji-data package just for this.
const EMOJI_LIST = [
  '😀', '😁', '😊', '🙂', '😉', '😍', '🥰', '😘', '😎', '🤔',
  '😅', '😢', '😭', '😡', '😱', '🙏', '👍', '👎', '👏', '🙌',
  '💪', '🤝', '❤️', '💛', '💚', '💙', '💜', '🔥', '✨', '🎉',
  '🎁', '✅', '❌', '⚠️', '⏰', '💰', '📦', '🚚', '💳', '📱',
];

// Simple static grid — no fetch/state beyond what the parent already tracks.
// Stays open after each pick (onPick doesn't call onClose) so an agent can
// drop in several emoji in a row without reopening it each time.
function EmojiPicker({ onPick, onClose }) {
  return (
    <div className="absolute bottom-full left-0 mb-2 w-64 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-xl z-20 overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-200 dark:border-slate-800 flex items-center justify-between">
        <p className="text-sm font-medium text-gray-700 dark:text-slate-200">อิโมจิ</p>
        <button onClick={onClose}><X size={14} className="text-gray-400 dark:text-slate-500" /></button>
      </div>
      <div className="grid grid-cols-8 gap-0.5 p-2 max-h-48 overflow-y-auto">
        {EMOJI_LIST.map(e => (
          <button
            key={e}
            type="button"
            onClick={() => onPick(e)}
            className="text-lg hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg w-7 h-7 flex items-center justify-center transition-colors"
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}

// Picker for the quick-reply/canned-message feature. Agents pick a "ประเภท"
// (ตอบกลับ / โปรโมชั่น) first, then see the matching messages — categories are
// just an admin-side organizing label shown as a small tag per item here.
// Only categories unrestricted or explicitly enabled for this conversation's
// channel show up; the conversation's channel is also what sends the message.
function QuickReplyPicker({ channelId, onSend, onClose }) {
  const [kind, setKind] = useState('reply');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sendingId, setSendingId] = useState('');

  useEffect(() => {
    setLoading(true);
    axios.get('/api/quick-replies', { params: { kind, channelId } }).then(r => setItems(r.data)).finally(() => setLoading(false));
  }, [kind, channelId]);

  async function handlePick(item) {
    setSendingId(item.id);
    try {
      await onSend(item.id);
      onClose();
    } finally {
      setSendingId('');
    }
  }

  return (
    <div className="absolute bottom-full left-0 mb-2 w-80 max-h-96 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-xl flex flex-col overflow-hidden z-20">
      <div className="px-3 py-2 border-b border-gray-200 dark:border-slate-800 flex items-center justify-between flex-shrink-0">
        <p className="text-sm font-medium text-gray-700 dark:text-slate-200">ข้อความลัด</p>
        <button onClick={onClose}><X size={14} className="text-gray-400 dark:text-slate-500" /></button>
      </div>
      <div className="flex gap-1.5 px-3 py-2 border-b border-gray-100 dark:border-slate-800/60 flex-shrink-0">
        {QR_KIND_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setKind(tab.key)}
            className={`text-xs px-2.5 py-1.5 rounded-lg font-medium transition-colors ${
              kind === tab.key ? 'bg-aurora-teal/15 text-aurora-teal' : 'bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="overflow-y-auto flex-1">
        {loading && <p className="text-sm text-gray-400 dark:text-slate-500 px-3 py-3">กำลังโหลด...</p>}
        {!loading && items.length === 0 && <p className="text-sm text-gray-400 dark:text-slate-500 px-3 py-3">ยังไม่มีข้อความลัดในประเภทนี้ — ตั้งค่าได้ในหน้า ตั้งค่า &gt; ข้อความลัด</p>}
        {!loading && items.map(item => (
          <button
            key={item.id}
            onClick={() => handlePick(item)}
            disabled={!!sendingId}
            className="w-full text-left px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-slate-800/60 border-b border-gray-50 dark:border-slate-800/40 disabled:opacity-50 flex items-start gap-2"
          >
            {item.hasImage && (
              <img src={`/api/quick-replies/${item.id}/image`} alt="" className="w-9 h-9 rounded-lg object-cover flex-shrink-0" />
            )}
            <span className="min-w-0">
              <span className="flex items-center gap-1.5">
                <p className="text-sm font-medium text-gray-800 dark:text-slate-100">{item.name}</p>
                {item.category?.name && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400 flex-shrink-0">
                    {item.category.name}
                  </span>
                )}
              </span>
              <p className="text-xs text-gray-500 dark:text-slate-400 line-clamp-2 mt-0.5">{item.content}</p>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Inbox() {
  const { socket, connected } = useSocket();
  const { agent } = useAuth();
  const { t } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();
  const [conversations, setConversations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [suggestion, setSuggestion] = useState('');
  const [agents, setAgents] = useState([]);
  const [channels, setChannels] = useState([]);
  const [tags, setTags] = useState([]);
  const [filter, setFilter] = useState({ status: 'open', channelIds: [], search: '', tagId: '', agentId: '', sort: 'newest' });
  const [showFilters, setShowFilters] = useState(false);
  // Persisted across conversation switches (and page reloads) so the panel stays
  // open/closed the same way no matter which chat you're looking at.
  const [showDetail, setShowDetail] = useState(() => localStorage.getItem('inbox_showDetail') === '1');
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [pendingImage, setPendingImage] = useState(null); // { previewUrl, base64 } — attached but not sent yet
  const [dragOver, setDragOver] = useState(false);
  const [showQrPicker, setShowQrPicker] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState(null); // src of the image currently open in the in-app viewer
  const [typingMap, setTypingMap] = useState({}); // { [conversationId]: agentName } — who else is currently typing a reply
  const typingTimeoutsRef = useRef({});
  const lastTypingEmitRef = useRef(0);
  const bottomRef = useRef(null);
  const composerRef = useRef(null);
  const messageListRef = useRef(null);
  // Pending "scroll to + highlight this message" target from the `msg`
  // deep-link param (e.g. the Report page's "ไปที่แชท" on a flagged message).
  // A ref rather than state — it's read/cleared synchronously inside the
  // scroll-management effect below and doesn't need to trigger its own
  // re-render; flashMessageId (below) is the piece that actually drives a
  // visual update once the target is found.
  const jumpTargetRef = useRef(null);
  const [flashMessageId, setFlashMessageId] = useState(null);
  // Older-message pagination (GET /api/messages/:conversationId?cursor=...).
  // hasMoreMessagesRef/messagesRef are refs (not state) so loadOlderMessages
  // and the scroll listener always read the latest value without having to be
  // recreated on every message list change — same "ref mirror" pattern as
  // typingTimeoutsRef/lastTypingEmitRef below.
  const hasMoreMessagesRef = useRef(true);
  const messagesRef = useRef([]);
  const selectedRef = useRef(null); // lets loadOlderMessages notice it should discard a stale response after a conversation switch mid-fetch
  const loadingOlderRef = useRef(false);
  const isPrependingRef = useRef(false); // true for exactly one render right after loadOlderMessages prepends, so the bottom-scroll effect skips that update
  const [loadingOlder, setLoadingOlder] = useState(false);

  useEffect(() => {
    localStorage.setItem('inbox_showDetail', showDetail ? '1' : '0');
  }, [showDetail]);

  // Composer is a <textarea> (was a single-line <input>, which can't hold a
  // line break at all — that's why Shift+Enter did nothing before) that
  // grows with its content up to a cap, then scrolls. Recomputed on every
  // `input` change, which also covers the reset back to one line right
  // after sending (input gets cleared to '').
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [input]);

  // Inserts at the cursor (not just appended to the end) so picking an emoji
  // mid-sentence lands where you'd expect, then puts the cursor right after
  // it and keeps focus on the composer so typing can continue immediately.
  function insertEmoji(emoji) {
    const el = composerRef.current;
    if (!el) { setInput(prev => prev + emoji); return; }
    const start = el.selectionStart ?? input.length;
    const end = el.selectionEnd ?? input.length;
    setInput(input.slice(0, start) + emoji + input.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
    });
  }

  useEffect(() => {
    setEditingName(false);
    setShowQrPicker(false);
    setPendingImage(null);
  }, [selected?.id]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filter.channelIds.length > 0) n++;
    if (filter.tagId) n++;
    if (filter.agentId) n++;
    return n;
  }, [filter]);

  // Which of our own (agent-sent) messages already have a customer reply
  // somewhere after them in this conversation — see DeliveryTick above for
  // why this is the proxy used instead of a real LINE read receipt. Single
  // backward scan: walk from the newest message down, and once we've passed
  // a user message everything before it (agent-side) counts as "replied to".
  const repliedIds = useMemo(() => {
    const ids = new Set();
    let sawUser = false;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.sender === 'agent' && sawUser) ids.add(m.id);
      if (m.sender === 'user') sawUser = true;
    }
    return ids;
  }, [messages]);

  const loadConversations = useCallback(async () => {
    const params = {};
    Object.entries(filter).forEach(([k, v]) => {
      if (k === 'channelIds') { if (v.length > 0) params.channelIds = v.join(','); return; }
      if (v) params[k] = v;
    });
    const { data } = await axios.get('/api/conversations', { params });
    setConversations(data.conversations);
  }, [filter]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  // Deep link from elsewhere in the app (e.g. the Report page's "ไปที่แชท"
  // button) — /inbox?conv=<id>[&msg=<id>]. The target conversation might not
  // be in the currently filtered list (e.g. it's closed, or a different
  // channel), so fetch it directly rather than relying on the list containing
  // it. `msg`, when present, is picked up by the scroll/highlight effect below
  // once that conversation's messages have actually loaded.
  useEffect(() => {
    const convId = searchParams.get('conv');
    const msgId = searchParams.get('msg');
    if (!convId) return;
    axios.get(`/api/conversations/${convId}`).then(r => setSelected(r.data)).catch(() => {});
    if (msgId) jumpTargetRef.current = msgId;
    setSearchParams(prev => { const next = new URLSearchParams(prev); next.delete('conv'); next.delete('msg'); return next; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The list only reorders itself in response to socket events (see 'conversation_updated'
  // below). If the tab sits idle for a while, the browser can throttle background JS or
  // the socket can silently drop and reconnect — either way, whatever happened during
  // that gap never reaches the client, so the list quietly goes stale (shows old order,
  // missing badges) until something forces a resync. Re-fetch whenever the socket
  // reconnects or the tab regains focus to close that gap.
  const prevConnectedRef = useRef(connected);
  useEffect(() => {
    if (connected && !prevConnectedRef.current) {
      loadConversations();
    }
    prevConnectedRef.current = connected;
  }, [connected, loadConversations]);

  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === 'visible') loadConversations();
    }
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [loadConversations]);

  useEffect(() => {
    axios.get('/api/channels').then(r => setChannels(r.data));
    axios.get('/api/agents').then(r => setAgents(r.data));
    axios.get('/api/tags').then(r => setTags(r.data));
  }, []);

  useEffect(() => {
    if (!selected) return;
    hasMoreMessagesRef.current = true;
    axios.get(`/api/messages/${selected.id}`, { params: { limit: MESSAGE_PAGE_LIMIT } }).then(r => {
      if (r.data.length < MESSAGE_PAGE_LIMIT) hasMoreMessagesRef.current = false;
      setMessages(r.data);
      // That GET call also marks this conversation's unread messages as read
      // on the server (for agents), but the unread badge count in the
      // conversation list lives in local state and never got told — clear it
      // here so it disappears the moment you open the chat instead of staying
      // stuck until the next full list refetch. Admins are reviewers, not the
      // one handling the chat — the backend deliberately does NOT mark it read
      // when an admin opens it, so the local badge must stay too, otherwise it
      // would look "handled" to everyone else even though nobody replied.
      if (agent?.role !== 'admin') {
        setConversations(prev => prev.map(c => c.id === selected.id ? { ...c, _count: { ...c._count, messages: 0 } } : c));
      }
    });
    setSuggestion('');
    socket?.emit('join', selected.id);
    return () => socket?.emit('leave', selected.id);
  }, [selected?.id, socket]);

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  // Fetches the next-older page (cursor = the oldest message currently
  // loaded) and prepends it. Used both by the "scroll to top" listener below
  // and by the jump-to-message search in the scroll-management effect further
  // down. Guarded by loadingOlderRef (not React state) so a scroll event and
  // an in-flight jump-search never fire overlapping requests. Restores the
  // scroll position itself right after prepending — without this the view
  // would jump around as the container's content grows above the fold — and
  // sets isPrependingRef so the scroll-management effect knows to leave that
  // restored position alone instead of also trying to scroll to the bottom.
  const loadOlderMessages = useCallback(async () => {
    if (!selected || loadingOlderRef.current || !hasMoreMessagesRef.current || messagesRef.current.length === 0) return;
    const conversationId = selected.id;
    loadingOlderRef.current = true;
    // Captured BEFORE the loading spinner renders (not after the fetch
    // resolves) — otherwise the spinner's own height would throw off the
    // scrollHeight-delta math below by a few pixels once it disappears again.
    const container = messageListRef.current;
    const prevScrollHeight = container?.scrollHeight ?? 0;
    const prevScrollTop = container?.scrollTop ?? 0;
    setLoadingOlder(true);
    try {
      const cursor = messagesRef.current[0].createdAt;
      const { data } = await axios.get(`/api/messages/${conversationId}`, { params: { cursor, limit: MESSAGE_PAGE_LIMIT } });
      // The agent may have switched to a different conversation while this was
      // in flight — prepending onto whatever's now loaded would splice one
      // chat's history into another's, so bail out silently instead.
      if (selectedRef.current?.id !== conversationId) return;
      if (data.length < MESSAGE_PAGE_LIMIT) hasMoreMessagesRef.current = false;
      if (data.length > 0) {
        isPrependingRef.current = true;
        setMessages(prev => [...data, ...prev]);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (container) container.scrollTop = container.scrollHeight - prevScrollHeight + prevScrollTop;
          });
        });
      }
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [selected]);

  // Infinite-scroll-up: load older history once the user scrolls near the top
  // of the message list, independent of the jump-to-message feature below.
  useEffect(() => {
    const container = messageListRef.current;
    if (!container) return;
    function handleScroll() {
      if (container.scrollTop < 100) loadOlderMessages();
    }
    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [selected?.id, loadOlderMessages]);

  // Normally just scrolls to the newest message on any change to `messages`.
  // When a jump target is pending (see the `msg` deep-link effect above and
  // jumpTargetRef), it takes priority: if the target message is already
  // loaded, scroll to it + flash-highlight it; if not, keep paging in older
  // history (loadOlderMessages) and re-check on the next `messages` update,
  // until it's found or this conversation's entire history is exhausted (at
  // which point it gives up rather than getting stuck, and falls through to
  // the normal bottom-scroll). isPrependingRef is checked separately below —
  // it means this update came from loadOlderMessages itself (either the
  // infinite-scroll-up path or a jump-search step that just gave up), which
  // already restored the right scroll position, so skip bottom-scrolling.
  useEffect(() => {
    if (jumpTargetRef.current) {
      const targetId = jumpTargetRef.current;
      const found = messages.some(m => m.id === targetId);
      if (found) {
        requestAnimationFrame(() => {
          document.querySelector(`[data-message-id="${targetId}"]`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        setFlashMessageId(targetId);
        jumpTargetRef.current = null;
        isPrependingRef.current = false;
        return;
      }
      if (messages.length === 0) return; // first page for this conversation hasn't arrived yet
      if (hasMoreMessagesRef.current) {
        loadOlderMessages();
        return;
      }
      jumpTargetRef.current = null; // exhausted this conversation's history — give up, fall through below
    }
    if (isPrependingRef.current) {
      isPrependingRef.current = false;
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loadOlderMessages]);

  useEffect(() => {
    if (!flashMessageId) return;
    const timer = setTimeout(() => setFlashMessageId(null), 2200);
    return () => clearTimeout(timer);
  }, [flashMessageId]);

  useEffect(() => {
    if (!socket) return;
    socket.on('new_message', ({ message, conversation }) => {
      if (selected?.id === conversation.id) {
        setMessages(prev => (prev.some(m => m.id === message.id) ? prev : [...prev, message]));
      }
    });
    socket.on('conversation_updated', (rawConv) => {
      // The backend emits the newest message as `lastMessage` (singular) on
      // this event, but ConversationItem's preview text reads
      // `conv.messages[0]` — the shape GET /api/conversations returns
      // (`messages: { take: 1 }`). Without normalizing here, a live update
      // never touches `messages` at all, so the list preview silently keeps
      // showing whatever was last loaded via REST (blank for a
      // conversation not yet in the local list, or the previous message for
      // one that is) until something else happens to trigger a full
      // refetch, like switching filter tabs. Other 'conversation_updated'
      // emits not tied to a new message (block/unblock, tag/assign changes)
      // don't include lastMessage, so this leaves those untouched.
      const conv = rawConv.lastMessage ? { ...rawConv, messages: [rawConv.lastMessage] } : rawConv;
      setConversations(prev => {
        const idx = prev.findIndex(c => c.id === conv.id);
        if (idx === -1) return [conv, ...prev];
        const next = [...prev];
        next[idx] = { ...next[idx], ...conv };
        // dir=-1 (newest first, the default) must produce a DESCENDING sort, i.e.
        // compare as (b - a). The previous version compared (b - a) but then
        // multiplied by -1 for the "newest" case, which is actually the formula
        // for ASCENDING order — so every local resort (message sent, status
        // changed, anything touching the conversation) flipped the whole list to
        // oldest-first. Comparing (a - b) here gives the correct sign in both cases.
        const dir = filter.sort === 'oldest' ? 1 : -1;
        return next.sort((a, b) => dir * (new Date(a.lastMessageAt) - new Date(b.lastMessageAt)));
      });
      setSelected(prev => (prev?.id === conv.id ? { ...prev, ...conv } : prev));
    });
    // Admin-only audit trail, live update: someone else (or this agent, in another
    // tab) just opened the conversation without replying, or just cleared their own
    // tag by replying. Non-admins never render ViewerTags, but skip touching state
    // for them anyway — no reason to hold data they shouldn't see.
    socket.on('message_view', ({ messageId, agentId, agentName }) => {
      if (agent?.role !== 'admin') return;
      setMessages(prev => prev.map(m => {
        if (m.id !== messageId) return m;
        const views = m.views || [];
        if (views.some(v => v.agentId === agentId)) return m;
        return { ...m, views: [...views, { agentId, agent: { name: agentName } }] };
      }));
    });
    // Fired when an agent sends any reply — clears THAT agent's tag from every
    // message in this conversation (not just one), since replying means they
    // didn't leave it for someone else, even if a newer customer message had
    // already arrived since they viewed it.
    socket.on('message_view_cleared', ({ agentId }) => {
      if (agent?.role !== 'admin') return;
      setMessages(prev => prev.map(m => {
        if (!m.views?.length) return m;
        const filtered = m.views.filter(v => v.agentId !== agentId);
        return filtered.length === m.views.length ? m : { ...m, views: filtered };
      }));
    });
    return () => {
      socket.off('new_message');
      socket.off('conversation_updated');
      socket.off('message_view');
      socket.off('message_view_cleared');
    };
  }, [socket, selected?.id, filter.sort, agent?.role]);

  // Typing indicator — deliberately NOT scoped to the currently open conversation
  // (unlike 'new_message'/'join' above), since the whole point is to show "someone's
  // already replying" on the conversation LIST too, so agents can avoid double-replying
  // to a customer without having to open every chat first. No explicit "stopped typing"
  // event from the server — each indicator just auto-clears a few seconds after the
  // last keystroke was seen, which is simpler and survives a dropped connection fine.
  useEffect(() => {
    if (!socket) return;
    function handleAgentTyping({ conversationId, agentName }) {
      if (!conversationId) return;
      setTypingMap(prev => ({ ...prev, [conversationId]: agentName }));
      clearTimeout(typingTimeoutsRef.current[conversationId]);
      typingTimeoutsRef.current[conversationId] = setTimeout(() => {
        setTypingMap(prev => {
          const next = { ...prev };
          delete next[conversationId];
          return next;
        });
      }, 3000);
    }
    socket.on('agent_typing', handleAgentTyping);
    return () => socket.off('agent_typing', handleAgentTyping);
  }, [socket]);

  // Reads a dropped/picked file into a pending attachment shown in the composer —
  // it isn't sent to the customer until the agent hits Send.
  function attachImageFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => setPendingImage({ previewUrl: reader.result, base64: reader.result });
    reader.readAsDataURL(file);
  }

  async function handleSend(text) {
    const content = (text ?? input).trim();
    const image = pendingImage;
    if ((!content && !image) || !selected || sending) return;
    setSending(true);
    try {
      // Only clear each piece (input / pendingImage) after IT actually succeeds —
      // clearing both upfront meant a failed send (e.g. LINE rejects the push
      // because the customer blocked the OA, or the access token is bad) silently
      // wiped what the agent typed with no error shown and nothing to retry.
      if (image) {
        const { data } = await axios.post(`/api/messages/${selected.id}`, { imageData: image.base64 });
        setMessages(prev => (prev.some(m => m.id === data.id) ? prev : [...prev, data]));
        setPendingImage(null);
      }
      if (content) {
        const { data } = await axios.post(`/api/messages/${selected.id}`, { content });
        setMessages(prev => (prev.some(m => m.id === data.id) ? prev : [...prev, data]));
        setInput('');
      }
      setSuggestion('');
    } catch (err) {
      alert(err.response?.data?.error || 'ส่งข้อความไม่สำเร็จ ลองใหม่อีกครั้ง');
    } finally {
      setSending(false);
    }
  }

  async function getSuggestion() {
    const { data } = await axios.get(`/api/messages/${selected.id}/suggest`);
    setSuggestion(data.suggestion || '');
  }

  async function sendQuickReply(quickReplyId) {
    try {
      const { data } = await axios.post(`/api/quick-replies/${quickReplyId}/send`, { conversationId: selected.id });
      setMessages(prev => {
        let next = prev;
        for (const m of data.messages) {
          if (!next.some(x => x.id === m.id)) next = [...next, m];
        }
        return next;
      });
    } catch (err) {
      alert(err.response?.data?.error || 'ส่งข้อความลัดไม่สำเร็จ ลองใหม่อีกครั้ง');
      throw err; // re-throw so the picker (handlePick) knows not to close itself
    }
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
                className="w-full pl-7 pr-3 py-1.5 text-sm border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-aurora-tealDeep placeholder:text-gray-400 dark:placeholder:text-slate-500"
                placeholder={t('search_placeholder')}
                value={filter.search}
                onChange={e => setFilter(f => ({ ...f, search: e.target.value }))}
              />
            </div>
            <button
              onClick={() => setShowFilters(v => !v)}
              className={`relative flex items-center justify-center w-9 h-9 rounded-lg border transition-colors ${showFilters || activeFilterCount ? 'bg-gradient-to-r from-aurora-teal to-aurora-purple border-transparent text-white' : 'text-gray-500 dark:text-slate-400 border-gray-200 dark:border-slate-700 hover:border-gray-400 dark:hover:border-slate-500'}`}
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
                className={`text-xs px-2 py-1 rounded-full border transition-colors ${filter.status === s ? 'bg-gradient-to-r from-aurora-teal to-aurora-purple text-white border-transparent' : 'text-gray-600 dark:text-slate-300 border-gray-200 dark:border-slate-700 hover:border-gray-400 dark:hover:border-slate-500'}`}
              >
                {s === 'open' ? t('status_open') : s === 'pending' ? t('status_pending') : t('status_closed')}
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
              typingAgent={typingMap[conv.id]}
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
                <div className="flex items-center gap-1.5">
                  {editingName ? (
                    <input
                      autoFocus
                      className="font-medium text-gray-900 dark:text-slate-100 bg-transparent border-b border-aurora-tealDeep focus:outline-none px-0.5 -ml-0.5 min-w-0 flex-1"
                      value={nameDraft}
                      onChange={e => setNameDraft(e.target.value)}
                      onBlur={async () => {
                        const trimmed = nameDraft.trim();
                        setEditingName(false);
                        if (trimmed && trimmed !== selected.displayName) await updateConv({ displayName: trimmed });
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                        if (e.key === 'Escape') setEditingName(false);
                      }}
                    />
                  ) : (
                    <h3 className="font-medium text-gray-900 dark:text-slate-100 truncate">{selected.displayName || selected.lineUserId}</h3>
                  )}
                  <button
                    onClick={() => { setNameDraft(selected.displayName || ''); setEditingName(true); }}
                    title="แก้ไขชื่อลูกค้า"
                    className="text-gray-400 dark:text-slate-500 hover:text-aurora-tealDeep transition-colors flex-shrink-0"
                  >
                    <Pencil size={13} />
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <p className="text-xs text-gray-500 dark:text-slate-500">{selected.channel?.name}</p>
                  {selected.blocked && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-500 dark:text-rose-400 font-medium">
                      🚫 ลูกค้าบล็อคเราอยู่
                    </span>
                  )}
                  {selected.channel?.active === false && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 dark:bg-slate-700 text-gray-500 dark:text-slate-400 font-medium">
                      ⏸ ช่องทางนี้ถูกปิดใช้งานอยู่
                    </span>
                  )}
                </div>
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
                className={`flex items-center gap-1.5 h-8 px-2.5 rounded-lg border text-xs font-medium transition-colors ${
                  showDetail
                    ? 'bg-gradient-to-r from-aurora-teal to-aurora-purple text-white border-transparent'
                    : 'text-gray-500 dark:text-slate-400 border-gray-200 dark:border-slate-700 hover:border-gray-400 dark:hover:border-slate-500'
                }`}
                title={showDetail ? 'ปิดรายละเอียดลูกค้า' : 'เปิดรายละเอียดลูกค้า'}
              >
                <Info size={15} />
                ลูกค้า
              </button>
            </div>

            {/* Messages — also acts as an image drop zone; dropping a file attaches
                it to the composer below rather than sending it immediately. */}
            <div
              ref={messageListRef}
              className="flex-1 overflow-y-auto p-4 bg-gray-50 dark:bg-aurora-midnight relative"
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={e => { e.preventDefault(); setDragOver(false); }}
              onDrop={e => {
                e.preventDefault();
                setDragOver(false);
                attachImageFile(e.dataTransfer.files?.[0]);
              }}
            >
              {dragOver && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-aurora-teal/10 border-2 border-dashed border-aurora-teal pointer-events-none">
                  <p className="text-sm font-medium text-aurora-tealDeep dark:text-aurora-teal bg-white dark:bg-slate-900 px-4 py-2 rounded-lg shadow">
                    วางรูปที่นี่เพื่อแนบ
                  </p>
                </div>
              )}
              {loadingOlder && (
                <div className="flex justify-center py-2">
                  <Loader2 size={16} className="animate-spin text-gray-400 dark:text-slate-500" />
                </div>
              )}
              {messages.map((msg, i) => {
                const prev = messages[i - 1];
                const showDivider = !prev || !isSameDay(new Date(prev.createdAt), new Date(msg.createdAt));
                return (
                  <div key={msg.id}>
                    {showDivider && <DateDivider label={formatDayLabel(new Date(msg.createdAt))} />}
                    <div
                      data-message-id={msg.id}
                      className={`-mx-2 px-2 rounded-xl transition-colors duration-700 ${flashMessageId === msg.id ? 'bg-amber-200/60 dark:bg-amber-500/15 ring-2 ring-amber-400' : ''}`}
                    >
                      <MessageBubble msg={msg} onImageClick={setLightboxSrc} isAdmin={agent?.role === 'admin'} repliedTo={repliedIds.has(msg.id)} />
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            {/* AI suggestion */}
            {suggestion && (
              <div className="bg-gradient-to-r from-aurora-teal/10 to-aurora-purple/10 border-t border-aurora-teal/20 px-4 py-2 flex items-center gap-2">
                <Sparkles size={14} className="text-aurora-teal flex-shrink-0" />
                <span className="text-sm text-aurora-teal flex-1">{suggestion}</span>
                <button onClick={() => { setInput(suggestion); setSuggestion(''); }} className="text-xs bg-gradient-to-r from-aurora-teal to-aurora-purple text-white px-2 py-1 rounded hover:brightness-110">ใช้</button>
                <button onClick={() => setSuggestion('')}><X size={14} className="text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300" /></button>
              </div>
            )}

            {/* Typing indicator for the currently open chat */}
            {typingMap[selected.id] && (
              <div className="bg-aurora-teal/10 border-t border-aurora-teal/20 px-4 py-1.5 text-xs text-aurora-tealDeep dark:text-aurora-teal font-medium">
                ✏️ {typingMap[selected.id]} กำลังพิมพ์ข้อความอยู่...
              </div>
            )}

            {/* Input — replaced entirely with a notice when the customer has
                blocked our LINE OA, since LINE returns 200 OK with no error
                for a push to a blocked user (the message just silently never
                arrives), there's no point letting anyone try to type here. */}
            {selected.blocked ? (
              <div className="bg-rose-50 dark:bg-rose-950/30 border-t border-rose-200 dark:border-rose-900/50 px-4 py-4 text-center">
                <p className="text-sm text-rose-600 dark:text-rose-400 font-medium">
                  🚫 ลูกค้าคนนี้บล็อคเราไปแล้ว ไม่สามารถส่งข้อความได้
                </p>
              </div>
            ) : selected.channel?.active === false ? (
              <div className="bg-gray-50 dark:bg-slate-800/50 border-t border-gray-200 dark:border-slate-800 px-4 py-4 text-center">
                <p className="text-sm text-gray-500 dark:text-slate-400 font-medium">
                  ⏸ ช่องทางนี้ถูกปิดใช้งานอยู่ ไม่สามารถส่งข้อความได้ — เปิดใช้งานได้ในหน้า Settings
                </p>
              </div>
            ) : (
            <div className="relative bg-white dark:bg-slate-900 border-t border-gray-200 dark:border-slate-800">
              {showQrPicker && (
                <div className="relative px-4">
                  <QuickReplyPicker
                    channelId={selected.channelId}
                    onSend={sendQuickReply}
                    onClose={() => setShowQrPicker(false)}
                  />
                </div>
              )}

              {pendingImage && (
                <div className="px-4 pt-3 flex items-center gap-2">
                  <div className="relative">
                    <button type="button" onClick={() => setLightboxSrc(pendingImage.previewUrl)} className="block cursor-zoom-in">
                      <img src={pendingImage.previewUrl} alt="" className="w-16 h-16 rounded-lg object-cover border border-gray-200 dark:border-slate-700" />
                    </button>
                    <button
                      onClick={() => setPendingImage(null)}
                      className="absolute -top-1.5 -right-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-full w-5 h-5 flex items-center justify-center"
                    >
                      <X size={11} />
                    </button>
                  </div>
                  <span className="text-xs text-gray-500 dark:text-slate-400">แนบรูปแล้ว (กดรูปเพื่อดูขนาดเต็ม) — พิมพ์ข้อความ (ถ้ามี) แล้วกดส่ง</span>
                </div>
              )}

              {/* Toolbar icons live inside the same box as the text field, below
                  it, rather than to its left — keeps the input full-width and
                  matches the layout requested (text on top, icons + send
                  bar underneath). */}
              <div className="px-4 py-3">
                <div className="border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 focus-within:ring-2 focus-within:ring-aurora-tealDeep transition-shadow">
                  <textarea
                    ref={composerRef}
                    rows={1}
                    className="w-full bg-transparent text-gray-900 dark:text-slate-100 px-4 pt-2.5 pb-1 text-sm focus:outline-none placeholder:text-gray-400 dark:placeholder:text-slate-500 resize-none leading-normal max-h-[120px] overflow-y-auto"
                    placeholder="พิมพ์ข้อความ... (Shift+Enter เพื่อขึ้นบรรทัดใหม่)"
                    value={input}
                    onChange={e => {
                      setInput(e.target.value);
                      // Throttled — don't fire a socket event on every keystroke, just
                      // at most once every 2s while the agent is actively typing.
                      const now = Date.now();
                      if (socket && selected && now - lastTypingEmitRef.current > 2000) {
                        lastTypingEmitRef.current = now;
                        socket.emit('typing', { conversationId: selected.id, agentName: agent?.name || 'Agent' });
                      }
                    }}
                    onKeyDown={e => {
                      // Plain Enter sends (matches the old <input> behavior everyone's
                      // used to); Shift+Enter inserts a line break instead — same
                      // convention as LINE, WhatsApp, Slack, etc. The old element was a
                      // single-line <input>, which can never hold a newline at all no
                      // matter what the key handler does, hence this being a <textarea> now.
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    onPaste={e => {
                      // A pasted screenshot/image arrives as a clipboard item, not text —
                      // pull the image file out (if any) and attach it the same way a
                      // drag-drop or file-picker attachment works. Text pastes (Ctrl+V of
                      // plain text) fall through untouched.
                      const item = Array.from(e.clipboardData?.items || []).find(i => i.type.startsWith('image/'));
                      if (item) {
                        e.preventDefault();
                        attachImageFile(item.getAsFile());
                      }
                    }}
                  />
                  <div className="flex items-center justify-between px-3 pb-2 pt-0.5">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setShowEmojiPicker(v => !v)}
                          title="อิโมจิ"
                          className={`inline-flex items-center justify-center w-5 h-5 transition-colors flex-shrink-0 ${showEmojiPicker ? 'text-aurora-tealDeep' : 'text-gray-400 dark:text-slate-500 hover:text-aurora-tealDeep'}`}
                        >
                          <Smile size={19} />
                        </button>
                        {showEmojiPicker && (
                          <EmojiPicker onPick={insertEmoji} onClose={() => setShowEmojiPicker(false)} />
                        )}
                      </div>
                      <button
                        onClick={() => setShowQrPicker(v => !v)}
                        title="ข้อความลัด"
                        className={`inline-flex items-center justify-center w-5 h-5 transition-colors flex-shrink-0 ${showQrPicker ? 'text-aurora-tealDeep' : 'text-gray-400 dark:text-slate-500 hover:text-aurora-tealDeep'}`}
                      >
                        <Zap size={19} />
                      </button>
                      <button
                        onClick={getSuggestion}
                        title="AI suggest reply"
                        className="inline-flex items-center justify-center w-5 h-5 text-gray-400 dark:text-slate-500 hover:text-aurora-tealDeep transition-colors flex-shrink-0"
                      >
                        <Sparkles size={19} />
                      </button>
                      <label
                        title="แนบรูปภาพ"
                        className={`inline-flex items-center justify-center w-5 h-5 transition-colors flex-shrink-0 cursor-pointer ${pendingImage ? 'text-aurora-tealDeep' : 'text-gray-400 dark:text-slate-500 hover:text-aurora-tealDeep'}`}
                      >
                        <ImagePlus size={19} />
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={e => {
                            attachImageFile(e.target.files?.[0]);
                            e.target.value = '';
                          }}
                        />
                      </label>
                    </div>
                    <button
                      onClick={() => handleSend()}
                      disabled={(!input.trim() && !pendingImage) || sending}
                      className="bg-gradient-to-r from-aurora-teal to-aurora-purple text-white rounded-full w-8 h-8 flex items-center justify-center hover:brightness-110 disabled:opacity-40 transition-all flex-shrink-0"
                    >
                      <Send size={15} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
            )}
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
              isAdmin={agent?.role === 'admin'}
            />
          )}
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center text-gray-400 dark:text-slate-600 bg-gray-50 dark:bg-aurora-midnight">
          <div className="text-center">
            <div className="text-5xl mb-3">💬</div>
            <p>เลือกการสนทนาเพื่อเริ่มต้น</p>
          </div>
        </div>
      )}
      <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </div>
  );
}
