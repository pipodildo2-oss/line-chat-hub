import { useState, useEffect, useMemo, useCallback, useRef, Fragment } from 'react';
import axios from 'axios';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ShieldAlert, ShieldQuestion, ExternalLink, MessageSquareWarning, Users, Eye, X, Filter, Search, ImagePlus, Send, ChevronLeft, ChevronRight, Loader2, Clock, Plus } from 'lucide-react';
import { startOfMonth, endOfMonth, subMonths, subDays, format, formatDistanceToNow } from 'date-fns';
import { th } from 'date-fns/locale';
import { useSocket } from '../contexts/SocketContext';
import { LIFECYCLE_STAGES, stageInfo, STATUS_COLORS } from '../lib/constants';

function toISODate(d) { return format(d, 'yyyy-MM-dd'); }

// Same horizontal quick-pick pattern as Dashboard.
const PRESETS = [
  { key: 'today', label: 'วันนี้', range: () => { const d = toISODate(new Date()); return [d, d]; } },
  { key: 'yesterday', label: 'เมื่อวาน', range: () => { const d = toISODate(subDays(new Date(), 1)); return [d, d]; } },
  { key: 'thisMonth', label: 'เดือนนี้', range: () => [toISODate(startOfMonth(new Date())), toISODate(new Date())] },
  { key: 'lastMonth', label: 'เดือนที่แล้ว', range: () => {
    const d = subMonths(new Date(), 1);
    return [toISODate(startOfMonth(d)), toISODate(endOfMonth(d))];
  } },
];

const SEVERITY_TABS = [
  { key: '', label: 'ทั้งหมด' },
  { key: 'severe', label: 'รุนแรง' },
  { key: 'minor', label: 'เล็กน้อย' },
];

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl p-5 border border-gray-200 dark:border-slate-800 flex items-center gap-4">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${color}`}>
        <Icon size={22} className="text-white" />
      </div>
      <div>
        <p className="text-gray-500 dark:text-slate-400 text-sm">{label}</p>
        <p className="text-2xl font-bold text-gray-900 dark:text-slate-100">{value ?? '—'}</p>
      </div>
    </div>
  );
}

const SEVERITY_BADGE = {
  severe: 'bg-rose-500/15 text-rose-500 dark:text-rose-400',
  minor: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
};
const SEVERITY_LABEL = { severe: 'รุนแรง', minor: 'เล็กน้อย' };

// Client-side pagination — both tables on this page already fetch their full
// (capped) result set in one request, so slicing on the frontend avoids a
// second round-trip per page flip. Shared between the flagged-messages table
// and the unanswered-chats table rather than duplicated.
const PAGE_SIZE_OPTIONS = [10, 100, 1000];

function Pagination({ page, setPage, pageSize, setPageSize, total }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const startRow = (page - 1) * pageSize + 1;
  const endRow = Math.min(page * pageSize, total);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-gray-100 dark:border-slate-800">
      <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-slate-400">
        <span>แถวต่อหน้า</span>
        {PAGE_SIZE_OPTIONS.map(size => (
          <button
            key={size}
            type="button"
            onClick={() => { setPageSize(size); setPage(1); }}
            className={`px-2 py-1 rounded-full border transition-colors ${pageSize === size ? 'bg-gradient-to-r from-aurora-teal to-aurora-purple text-white border-transparent' : 'text-gray-600 dark:text-slate-300 border-gray-200 dark:border-slate-700 hover:border-gray-400 dark:hover:border-slate-500'}`}
          >
            {size}
          </button>
        ))}
        <span className="ml-1">แสดง {startRow}–{endRow} จาก {total}</span>
      </div>
      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-slate-400">
        <button
          type="button"
          onClick={() => setPage(p => Math.max(1, p - 1))}
          disabled={page <= 1}
          className="px-2.5 py-1 rounded-lg border border-gray-200 dark:border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:border-gray-400 dark:hover:border-slate-500 transition-colors"
        >
          ‹ ก่อนหน้า
        </button>
        <span>หน้า {page} / {totalPages}</span>
        <button
          type="button"
          onClick={() => setPage(p => Math.min(totalPages, p + 1))}
          disabled={page >= totalPages}
          className="px-2.5 py-1 rounded-lg border border-gray-200 dark:border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:border-gray-400 dark:hover:border-slate-500 transition-colors"
        >
          ถัดไป ›
        </button>
      </div>
    </div>
  );
}

// Business rule: an agent should always send the last message in any
// conversation. This section is a live worklist (not a historical report) of
// every open/pending chat that currently breaks that rule — the customer's
// message is sitting there unanswered. Re-check it any time to catch chats
// that slipped through.
function UnansweredSection({ channels, agents }) {
  const navigate = useNavigate();
  const { socket } = useSocket();
  const [data, setData] = useState(null);
  // Multi-select (checkbox dropdown), not a single-choice <select> — matches
  // the channel picker pattern already used in Inbox's FilterPanel, so admins
  // can narrow this worklist to any specific combination of channels, not just
  // one at a time. Empty array = all channels.
  const [channelIds, setChannelIds] = useState([]);
  const [showChannelPicker, setShowChannelPicker] = useState(false);
  const [agentId, setAgentId] = useState('');
  // Defaults to "active only" — the working assumption is that unanswered
  // chats on a paused channel aren't the urgent kind (see channels.js/schema.prisma
  // for the soft-disable flag). "ทั้งหมด" is still one select away if needed.
  const [channelActive, setChannelActive] = useState('true');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const lastReloadRef = useRef(0);

  const load = useCallback(async () => {
    const params = {};
    if (channelIds.length > 0) params.channelIds = channelIds.join(',');
    if (agentId) params.agentId = agentId;
    if (channelActive) params.channelActive = channelActive;
    const { data } = await axios.get('/api/reports/unanswered', { params });
    setData(data);
  }, [channelIds, agentId, channelActive]);

  // Any filter change invalidates the current page (e.g. page 3 might not
  // exist anymore under a narrower filter) — same reset-on-filter-change
  // pattern as every other filtered table in this app.
  useEffect(() => { setPage(1); }, [channelIds, agentId, channelActive]);
  const pagedConversations = data ? data.conversations.slice((page - 1) * pageSize, page * pageSize) : [];

  useEffect(() => { load(); }, [load]);

  // Any message send, incoming customer message, or status change touches
  // 'conversation_updated' — rather than trying to reconstruct "is this now
  // the last message and who sent it" from a partial payload, just reload the
  // list. Throttled so a burst of activity doesn't hammer the endpoint.
  useEffect(() => {
    if (!socket) return;
    function handleUpdate() {
      const now = Date.now();
      if (now - lastReloadRef.current < 3000) return;
      lastReloadRef.current = now;
      load();
    }
    socket.on('conversation_updated', handleUpdate);
    return () => socket.off('conversation_updated', handleUpdate);
  }, [socket, load]);

  // A conversation can also "age into" this list purely from time passing —
  // a customer message sent 9 minutes ago becomes unanswered-worthy at the
  // 10-minute mark with no new socket event to trigger a refresh. Poll on a
  // plain interval to catch that.
  useEffect(() => {
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="mt-10">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-bold text-gray-900 dark:text-slate-100 flex items-center gap-2">
          <MessageSquareWarning size={18} className="text-amber-500" />
          แชทที่ยังไม่ได้ตอบกลับ
        </h2>
      </div>
      <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">
        แชทที่ข้อความล่าสุดยังเป็นของลูกค้าอยู่และรอมาแล้วอย่างน้อย 10 นาที (พนักงานควรเป็นคนตอบล่าสุดเสมอ) — เรียงจากรอนานสุดก่อน
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowChannelPicker(v => !v)}
            className={`flex items-center gap-1.5 text-sm border rounded-lg px-2 py-1.5 focus:outline-none ${channelIds.length > 0 ? 'border-aurora-teal text-aurora-tealDeep dark:text-aurora-teal bg-aurora-teal/5' : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200'}`}
          >
            <span>
              {channelIds.length === 0
                ? 'ทุกช่องทาง'
                : channelIds.length === 1
                  ? channels.find(c => c.id === channelIds[0])?.name || 'เลือก 1 ช่องทาง'
                  : `เลือก ${channelIds.length} ช่องทาง`}
            </span>
            <span className="text-gray-400 dark:text-slate-500 text-xs">{showChannelPicker ? '▲' : '▼'}</span>
          </button>
          {showChannelPicker && (
            <div className="absolute top-full left-0 mt-1 w-56 border border-gray-200 dark:border-slate-600 rounded-lg p-1.5 space-y-0.5 max-h-56 overflow-y-auto bg-white dark:bg-slate-700 shadow-lg z-30">
              <label className="flex items-center gap-2 text-sm px-1.5 py-1 rounded hover:bg-gray-50 dark:hover:bg-slate-600 cursor-pointer text-gray-700 dark:text-slate-200 font-medium border-b border-gray-100 dark:border-slate-600 mb-0.5 pb-1.5">
                <input
                  type="checkbox"
                  className="accent-aurora-teal"
                  checked={channelIds.length === 0}
                  onChange={() => setChannelIds([])}
                />
                ทั้งหมด
              </label>
              {channels.map(c => (
                <label key={c.id} className="flex items-center gap-2 text-sm px-1.5 py-1 rounded hover:bg-gray-50 dark:hover:bg-slate-600 cursor-pointer text-gray-700 dark:text-slate-200">
                  <input
                    type="checkbox"
                    className="accent-aurora-teal"
                    checked={channelIds.includes(c.id)}
                    onChange={() => setChannelIds(ids => ids.includes(c.id) ? ids.filter(x => x !== c.id) : [...ids, c.id])}
                  />
                  {c.name}
                </label>
              ))}
              {channels.length === 0 && <p className="text-sm text-gray-400 dark:text-slate-500 px-1.5 py-1">ยังไม่มีช่องทาง</p>}
            </div>
          )}
        </div>
        <select
          className="text-sm border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 rounded-lg px-2 py-1.5 focus:outline-none"
          value={agentId}
          onChange={e => setAgentId(e.target.value)}
        >
          <option value="">พนักงานทั้งหมด</option>
          <option value="unassigned">ยังไม่ได้ assign</option>
          {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select
          className="text-sm border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 rounded-lg px-2 py-1.5 focus:outline-none"
          value={channelActive}
          onChange={e => setChannelActive(e.target.value)}
        >
          <option value="">ทุกสถานะช่องทาง</option>
          <option value="true">ไลน์ที่เปิดใช้งานอยู่</option>
          <option value="false">ไลน์ที่ปิดใช้งานอยู่</option>
        </select>
        {data && (
          <span className="text-sm text-gray-500 dark:text-slate-400 ml-1">
            พบ <span className="font-semibold text-gray-800 dark:text-slate-200">{data.total}</span> แชท
          </span>
        )}
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 overflow-hidden">
        {!data ? (
          <p className="text-center text-gray-400 dark:text-slate-500 text-sm py-10">กำลังโหลด...</p>
        ) : data.conversations.length === 0 ? (
          <p className="text-center text-gray-400 dark:text-slate-500 text-sm py-10">ไม่มีแชทตกหล่น — พนักงานตอบครบทุกแชทแล้ว 🎉</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-slate-800 text-left text-gray-500 dark:text-slate-400">
                <th className="px-4 py-2.5 font-medium">รอมาแล้ว</th>
                <th className="px-4 py-2.5 font-medium">ลูกค้า / ช่องทาง</th>
                <th className="px-4 py-2.5 font-medium">ข้อความล่าสุดของลูกค้า</th>
                <th className="px-4 py-2.5 font-medium">Assign</th>
                <th className="px-4 py-2.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {pagedConversations.map(c => (
                <tr key={c.id} className="border-b border-gray-50 dark:border-slate-800/60 hover:bg-gray-50 dark:hover:bg-slate-800/40 align-top">
                  <td className="px-4 py-2.5 text-amber-600 dark:text-amber-400 font-medium whitespace-nowrap">
                    {formatDistanceToNow(new Date(c.waitingSince), { locale: th, addSuffix: false })}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 dark:text-slate-300 whitespace-nowrap">
                    <p className="truncate max-w-[160px] text-gray-800 dark:text-slate-200">{c.displayName || c.lineUserId}</p>
                    <p className="text-[11px] text-gray-400 dark:text-slate-500">{c.channel?.name}</p>
                  </td>
                  <td className="px-4 py-2.5 text-gray-800 dark:text-slate-200 max-w-xs">
                    <p className="line-clamp-2 whitespace-pre-wrap break-words">
                      {c.lastMessage.type === 'text' ? c.lastMessage.content : `[${c.lastMessage.type}]`}
                    </p>
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 dark:text-slate-300 whitespace-nowrap">
                    {c.agent?.name || <span className="text-gray-400 dark:text-slate-500">ยังไม่ได้ assign</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <button
                      onClick={() => navigate(`/inbox?conv=${c.id}`)}
                      title="ไปที่แชท"
                      className="text-gray-400 dark:text-slate-500 hover:text-aurora-tealDeep dark:hover:text-aurora-teal"
                    >
                      <ExternalLink size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data && (
          <Pagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} total={data.conversations.length} />
        )}
      </div>
    </div>
  );
}

const ROLE_LABEL = { admin: 'Admin', agent: 'พนักงาน' };

function AgentAvatar({ name }) {
  return (
    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-aurora-teal to-aurora-purple flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
      {name?.[0]?.toUpperCase() || '?'}
    </div>
  );
}

// Drill-down for a single agent: everything behind their two summary numbers
// on AgentConductSection's table — the actual flagged messages (within the
// report's date range) and the conversations they currently have an open
// "viewed but didn't reply" tag on (always live/current, not date-bounded —
// see the /agent-conduct backend route for why).
function AgentConductModal({ agentId, from, to, onClose, navigate }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    axios.get(`/api/reports/agent-conduct/${agentId}`, { params: { from, to } })
      .then(r => { if (!cancelled) setData(r.data); });
    return () => { cancelled = true; };
  }, [agentId, from, to]);

  function goTo(conversationId, messageId) {
    onClose();
    navigate(messageId ? `/inbox?conv=${conversationId}&msg=${messageId}` : `/inbox?conv=${conversationId}`);
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-800">
          <div className="flex items-center gap-3 min-w-0">
            <AgentAvatar name={data?.agent?.name} />
            <div className="min-w-0">
              <p className="font-semibold text-gray-900 dark:text-slate-100 truncate">{data?.agent?.name || 'กำลังโหลด...'}</p>
              <p className="text-xs text-gray-400 dark:text-slate-500 truncate">{data?.agent?.email}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 flex-shrink-0">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-6">
          {!data ? (
            <p className="text-center text-gray-400 dark:text-slate-500 text-sm py-8">กำลังโหลด...</p>
          ) : (
            <>
              <div>
                <h3 className="text-sm font-semibold text-gray-800 dark:text-slate-200 flex items-center gap-1.5 mb-2">
                  <Eye size={14} className="text-amber-500" />
                  เปิดอ่านแล้วยังไม่ตอบ ({data.viewedNoReply.length})
                </h3>
                {data.viewedNoReply.length === 0 ? (
                  <p className="text-sm text-gray-400 dark:text-slate-500">ไม่มีรายการค้างอยู่ 🎉</p>
                ) : (
                  <div className="space-y-1.5">
                    {data.viewedNoReply.map(v => (
                      <button
                        key={v.id}
                        onClick={() => goTo(v.message.conversation.id, v.message.id)}
                        className="w-full flex items-center gap-3 text-left px-3 py-2 rounded-lg border border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-gray-800 dark:text-slate-200 truncate">
                            {v.message.conversation?.displayName || v.message.conversation?.lineUserId || '—'}
                            <span className="text-gray-400 dark:text-slate-500 font-normal"> · {v.message.conversation?.channel?.name}</span>
                          </p>
                          <p className="text-xs text-gray-500 dark:text-slate-400 truncate">
                            {v.message.type === 'text' ? v.message.content : `[${v.message.type}]`}
                          </p>
                        </div>
                        <span className="text-[11px] text-gray-400 dark:text-slate-500 whitespace-nowrap">
                          เปิดดู {formatDistanceToNow(new Date(v.viewedAt), { locale: th, addSuffix: true })}
                        </span>
                        <ExternalLink size={14} className="text-gray-400 dark:text-slate-500 flex-shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-sm font-semibold text-gray-800 dark:text-slate-200 flex items-center gap-1.5 mb-2">
                  <AlertTriangle size={14} className="text-rose-500" />
                  ข้อความไม่เหมาะสม ({data.flaggedMessages.length})
                </h3>
                {data.flaggedMessages.length === 0 ? (
                  <p className="text-sm text-gray-400 dark:text-slate-500">ไม่มีข้อความที่ถูกตีในช่วงเวลานี้</p>
                ) : (
                  <div className="space-y-1.5">
                    {data.flaggedMessages.map(m => (
                      <button
                        key={m.id}
                        onClick={() => m.conversation && goTo(m.conversation.id, m.id)}
                        className="w-full flex items-start gap-3 text-left px-3 py-2 rounded-lg border border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors"
                      >
                        <span className={`mt-0.5 text-[11px] px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${SEVERITY_BADGE[m.flagSeverity] || 'bg-gray-100 text-gray-500'}`}>
                          {SEVERITY_LABEL[m.flagSeverity] || m.flagSeverity}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-gray-800 dark:text-slate-200 line-clamp-2 whitespace-pre-wrap break-words">{m.content}</p>
                          <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5 truncate">
                            {m.conversation?.displayName || m.conversation?.lineUserId} · {m.conversation?.channel?.name} · {format(new Date(m.createdAt), 'd MMM yy HH:mm', { locale: th })}
                          </p>
                          {m.flagReason && <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">{m.flagReason}</p>}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Rolls up two existing signals — the "viewed but didn't reply" audit trail
// and AI-flagged messages — into one per-agent scorecard, sortable worst-first,
// with a click-through to the full detail for anyone the numbers look off for.
function ConductRow({ a, onClick }) {
  return (
    <tr onClick={onClick} className="border-b border-gray-50 dark:border-slate-800/60 hover:bg-gray-50 dark:hover:bg-slate-800/40 cursor-pointer">
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <AgentAvatar name={a.name} />
          <div className="min-w-0">
            <p className="text-gray-800 dark:text-slate-200 truncate max-w-[160px]">{a.name}</p>
            <p className="text-[11px] text-gray-400 dark:text-slate-500 truncate max-w-[160px]">{a.email}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-2.5">
        <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${a.role === 'admin' ? 'bg-aurora-purple/15 text-violet-500 dark:text-violet-300' : 'bg-aurora-teal/15 text-aurora-tealDeep dark:text-aurora-teal'}`}>
          {ROLE_LABEL[a.role] || a.role}
        </span>
      </td>
      <td className="px-4 py-2.5">
        {a.viewedNoReplyCount > 0 ? (
          <span className="font-semibold text-amber-600 dark:text-amber-400">{a.viewedNoReplyCount} ครั้ง</span>
        ) : (
          <span className="text-gray-400 dark:text-slate-500">—</span>
        )}
      </td>
      <td className="px-4 py-2.5">
        {a.flaggedTotal > 0 ? (
          <span className="flex items-center gap-1.5">
            {a.flaggedSevere > 0 && (
              <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-rose-500/15 text-rose-500 dark:text-rose-400">{a.flaggedSevere} รุนแรง</span>
            )}
            {a.flaggedMinor > 0 && (
              <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-amber-500/15 text-amber-600 dark:text-amber-400">{a.flaggedMinor} เล็กน้อย</span>
            )}
          </span>
        ) : (
          <span className="text-gray-400 dark:text-slate-500">—</span>
        )}
      </td>
      <td className="px-4 py-2.5 text-right">
        <span className="text-xs text-aurora-tealDeep dark:text-aurora-teal font-medium">ดูรายละเอียด →</span>
      </td>
    </tr>
  );
}

const CONDUCT_THEAD = (
  <thead className="sticky top-0 z-10 bg-white dark:bg-slate-900">
    <tr className="border-b border-gray-100 dark:border-slate-800 text-left text-gray-500 dark:text-slate-400">
      <th className="px-4 py-2.5 font-medium">พนักงาน</th>
      <th className="px-4 py-2.5 font-medium">ยศ</th>
      <th className="px-4 py-2.5 font-medium">เปิดอ่านไม่ตอบ</th>
      <th className="px-4 py-2.5 font-medium">ข้อความไม่เหมาะสม</th>
      <th className="px-4 py-2.5 font-medium"></th>
    </tr>
  </thead>
);

// Rolls up two existing signals — the "viewed but didn't reply" audit trail
// and AI-flagged messages — into one per-agent scorecard, sortable worst-first,
// with a click-through to the full detail for anyone the numbers look off for.
// Boxed to a fixed height (~6 rows, scrollable) rather than growing with the
// team, and offers a "รายทีม" grouping (by AgentCategory — see Settings'
// "หมวดหมู่ทีมงาน") alongside the default flat "รายบุคคล" list.
function AgentConductSection({ from, to, navigate }) {
  const [data, setData] = useState(null);
  const [categories, setCategories] = useState([]);
  const [selectedAgentId, setSelectedAgentId] = useState(null);
  const [groupBy, setGroupBy] = useState('individual'); // 'individual' | 'team'
  const [expandedTeams, setExpandedTeams] = useState(() => new Set());
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [filterAgentIds, setFilterAgentIds] = useState([]); // active only when groupBy === 'individual'
  const [filterTeamKeys, setFilterTeamKeys] = useState([]); // active only when groupBy === 'team'

  useEffect(() => {
    axios.get('/api/reports/agent-conduct', { params: { from, to } }).then(r => setData(r.data));
  }, [from, to]);

  useEffect(() => {
    axios.get('/api/agent-categories').then(r => setCategories(r.data)).catch(() => {});
  }, []);

  // Admins are reviewers, not the ones this scorecard is meant to check up
  // on — they're excluded from view entirely rather than shown with a row
  // full of dashes (they never accumulate either stat by design; see
  // messages.js POST /:conversationId, which only tags non-admin viewers).
  const employees = useMemo(() => (data?.agents || []).filter(a => a.role !== 'admin'), [data]);

  const teamGroups = useMemo(() => {
    const map = new Map();
    for (const a of employees) {
      const key = a.categoryId || '__none__';
      if (!map.has(key)) {
        map.set(key, { key, name: a.categoryName || 'ไม่มีหมวดหมู่', members: [], viewedNoReplyCount: 0, flaggedTotal: 0, flaggedSevere: 0, flaggedMinor: 0 });
      }
      const g = map.get(key);
      g.members.push(a);
      g.viewedNoReplyCount += a.viewedNoReplyCount;
      g.flaggedTotal += a.flaggedTotal;
      g.flaggedSevere += a.flaggedSevere;
      g.flaggedMinor += a.flaggedMinor;
    }
    return [...map.values()].sort((x, y) => (y.viewedNoReplyCount - x.viewedNoReplyCount) || (y.flaggedTotal - x.flaggedTotal));
  }, [employees]);

  // Empty selection = show everyone — same "no selection = all" convention
  // used by every other checkbox filter in this app (channel pickers, etc.).
  const visibleEmployees = filterAgentIds.length > 0 ? employees.filter(a => filterAgentIds.includes(a.id)) : employees;
  const visibleTeamGroups = filterTeamKeys.length > 0 ? teamGroups.filter(g => filterTeamKeys.includes(g.key)) : teamGroups;
  const activeFilterCount = groupBy === 'individual' ? filterAgentIds.length : filterTeamKeys.length;

  function toggleTeam(key) {
    setExpandedTeams(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function toggleFilterAgent(id) {
    setFilterAgentIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
  }
  function toggleFilterTeam(key) {
    setFilterTeamKeys(keys => keys.includes(key) ? keys.filter(x => x !== key) : [...keys, key]);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-bold text-gray-900 dark:text-slate-100 flex items-center gap-2">
          <Eye size={18} className="text-amber-500" />
          อ่านไม่ตอบ
        </h2>
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowFilterPanel(v => !v)}
            className={`flex items-center gap-1.5 text-sm border rounded-lg px-3 py-1.5 focus:outline-none ${activeFilterCount > 0 ? 'border-aurora-teal text-aurora-tealDeep dark:text-aurora-teal bg-aurora-teal/5' : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200'}`}
          >
            <Filter size={14} />
            ตัวกรอง
            {activeFilterCount > 0 && (
              <span className="text-[11px] bg-aurora-teal text-white rounded-full w-4 h-4 flex items-center justify-center">{activeFilterCount}</span>
            )}
          </button>
          {showFilterPanel && (
            <div className="absolute right-0 top-full mt-1 w-72 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-xl shadow-lg z-30 p-3 space-y-3">
              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">มุมมอง</p>
                <div className="flex gap-1.5">
                  {[{ key: 'individual', label: 'รายบุคคล' }, { key: 'team', label: 'รายทีม' }].map(opt => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setGroupBy(opt.key)}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${groupBy === opt.key ? 'bg-gradient-to-r from-aurora-teal to-aurora-purple text-white border-transparent' : 'text-gray-600 dark:text-slate-300 border-gray-200 dark:border-slate-600 hover:border-gray-400 dark:hover:border-slate-500'}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">พนักงาน</p>
                <div className={`border border-gray-200 dark:border-slate-600 rounded-lg p-1.5 space-y-0.5 max-h-36 overflow-y-auto ${groupBy !== 'individual' ? 'opacity-40 pointer-events-none bg-gray-50 dark:bg-slate-800' : 'bg-white dark:bg-slate-700'}`}>
                  {employees.map(a => (
                    <label key={a.id} className="flex items-center gap-2 text-xs px-1.5 py-1 rounded hover:bg-gray-50 dark:hover:bg-slate-600 cursor-pointer text-gray-700 dark:text-slate-200">
                      <input
                        type="checkbox"
                        className="accent-aurora-teal"
                        checked={filterAgentIds.includes(a.id)}
                        onChange={() => toggleFilterAgent(a.id)}
                        disabled={groupBy !== 'individual'}
                      />
                      {a.name}
                    </label>
                  ))}
                  {employees.length === 0 && <p className="text-xs text-gray-400 dark:text-slate-500 px-1.5 py-1">ยังไม่มีพนักงาน</p>}
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5">ทีม</p>
                <div className={`border border-gray-200 dark:border-slate-600 rounded-lg p-1.5 space-y-0.5 max-h-36 overflow-y-auto ${groupBy !== 'team' ? 'opacity-40 pointer-events-none bg-gray-50 dark:bg-slate-800' : 'bg-white dark:bg-slate-700'}`}>
                  {categories.map(c => (
                    <label key={c.id} className="flex items-center gap-2 text-xs px-1.5 py-1 rounded hover:bg-gray-50 dark:hover:bg-slate-600 cursor-pointer text-gray-700 dark:text-slate-200">
                      <input
                        type="checkbox"
                        className="accent-aurora-teal"
                        checked={filterTeamKeys.includes(c.id)}
                        onChange={() => toggleFilterTeam(c.id)}
                        disabled={groupBy !== 'team'}
                      />
                      {c.name}
                    </label>
                  ))}
                  <label className="flex items-center gap-2 text-xs px-1.5 py-1 rounded hover:bg-gray-50 dark:hover:bg-slate-600 cursor-pointer text-gray-700 dark:text-slate-200">
                    <input
                      type="checkbox"
                      className="accent-aurora-teal"
                      checked={filterTeamKeys.includes('__none__')}
                      onChange={() => toggleFilterTeam('__none__')}
                      disabled={groupBy !== 'team'}
                    />
                    ไม่มีหมวดหมู่
                  </label>
                </div>
              </div>

              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={() => { setFilterAgentIds([]); setFilterTeamKeys([]); }}
                  className="text-xs text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300"
                >
                  ล้างตัวกรอง
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">
        เปิดอ่านแชทของลูกค้าแล้วยังไม่ตอบกลับ และข้อความไม่เหมาะสมที่พิมพ์ส่ง (เฉพาะรายการที่เปิดอ่าน/พิมพ์ในช่วงเวลาที่เลือกด้านบน) — {groupBy === 'individual' ? 'กดที่แถวเพื่อดูรายละเอียดรายบุคคล' : 'กดที่ทีมเพื่อดูสมาชิกในทีม'}
        {data && (
          <span> · ในช่วงเวลานี้มี <span className="font-semibold text-amber-600 dark:text-amber-400">{data.totalViewedNoReply}</span> เคสเปิดอ่านค้างไม่ตอบทั้งทีม</span>
        )}
      </p>

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 overflow-hidden">
        {!data ? (
          <p className="text-center text-gray-400 dark:text-slate-500 text-sm py-10">กำลังโหลด...</p>
        ) : employees.length === 0 ? (
          <p className="text-center text-gray-400 dark:text-slate-500 text-sm py-10">ยังไม่มีพนักงานในระบบ</p>
        ) : groupBy === 'individual' ? (
          // Fixed height ≈ 6 rows, scrolls for the rest — keeps this box from
          // pushing everything else on the page down as the team grows.
          <div className="max-h-[460px] overflow-y-auto">
            <table className="w-full text-sm">
              {CONDUCT_THEAD}
              <tbody>
                {visibleEmployees.length === 0 ? (
                  <tr><td colSpan={5} className="text-center text-gray-400 dark:text-slate-500 text-sm py-6">ไม่พบพนักงานตามตัวกรองที่เลือก</td></tr>
                ) : visibleEmployees.map(a => (
                  <ConductRow key={a.id} a={a} onClick={() => setSelectedAgentId(a.id)} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="max-h-[460px] overflow-y-auto">
            <table className="w-full text-sm">
              {CONDUCT_THEAD}
              <tbody>
                {visibleTeamGroups.length === 0 && (
                  <tr><td colSpan={5} className="text-center text-gray-400 dark:text-slate-500 text-sm py-6">ไม่พบทีมตามตัวกรองที่เลือก</td></tr>
                )}
                {visibleTeamGroups.map(g => (
                  <Fragment key={g.key}>
                    <tr
                      onClick={() => toggleTeam(g.key)}
                      className="border-b border-gray-50 dark:border-slate-800/60 hover:bg-gray-50 dark:hover:bg-slate-800/40 cursor-pointer"
                    >
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className={`text-gray-400 dark:text-slate-500 transition-transform ${expandedTeams.has(g.key) ? 'rotate-90' : ''}`}>▸</span>
                          <span className="font-semibold text-gray-800 dark:text-slate-200">{g.name}</span>
                          <span className="text-[11px] text-gray-400 dark:text-slate-500">({g.members.length} คน)</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5"></td>
                      <td className="px-4 py-2.5">
                        {g.viewedNoReplyCount > 0 ? (
                          <span className="font-semibold text-amber-600 dark:text-amber-400">{g.viewedNoReplyCount} ครั้ง</span>
                        ) : <span className="text-gray-400 dark:text-slate-500">—</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        {g.flaggedTotal > 0 ? (
                          <span className="flex items-center gap-1.5">
                            {g.flaggedSevere > 0 && <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-rose-500/15 text-rose-500 dark:text-rose-400">{g.flaggedSevere} รุนแรง</span>}
                            {g.flaggedMinor > 0 && <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-amber-500/15 text-amber-600 dark:text-amber-400">{g.flaggedMinor} เล็กน้อย</span>}
                          </span>
                        ) : <span className="text-gray-400 dark:text-slate-500">—</span>}
                      </td>
                      <td className="px-4 py-2.5"></td>
                    </tr>
                    {expandedTeams.has(g.key) && g.members.map(a => (
                      <ConductRow key={a.id} a={a} onClick={() => setSelectedAgentId(a.id)} />
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedAgentId && (
        <AgentConductModal
          agentId={selectedAgentId}
          from={from}
          to={to}
          onClose={() => setSelectedAgentId(null)}
          navigate={navigate}
        />
      )}
    </div>
  );
}

// "ตรวจสอบ" tab — คำพูดไม่เหมาะสม (flagged messages) + แชทที่ยังไม่ได้ตอบกลับ
// (unanswered chats). Split out from the old single-page Report so it sits
// under its own sidebar item, same pattern as Settings' sub-nav.
function AuditReport() {
  const navigate = useNavigate();
  const { socket } = useSocket();
  const [data, setData] = useState(null);
  const [agents, setAgents] = useState([]);
  const [channels, setChannels] = useState([]);
  const [preset, setPreset] = useState('thisMonth');
  const [[from, to], setDateRange] = useState(PRESETS[2].range());
  const [severity, setSeverity] = useState('');
  const [agentId, setAgentId] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  function pickPreset(p) {
    setPreset(p.key);
    setDateRange(p.range());
  }

  function pickCustomDate(which, value) {
    setPreset(null);
    setDateRange(prev => which === 'from' ? [value, prev[1]] : [prev[0], value]);
  }

  const load = useCallback(async () => {
    const params = { from, to };
    if (severity) params.severity = severity;
    if (agentId) params.agentId = agentId;
    const { data } = await axios.get('/api/reports/flagged-messages', { params });
    setData(data);
  }, [from, to, severity, agentId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    axios.get('/api/agents').then(r => setAgents(r.data)).catch(() => {});
    axios.get('/api/channels').then(r => setChannels(r.data)).catch(() => {});
  }, []);
  // Any filter change invalidates the current page — reset back to page 1
  // rather than risk landing on an empty page under a narrower filter.
  useEffect(() => { setPage(1); }, [from, to, severity, agentId]);
  const pagedMessages = data ? data.messages.slice((page - 1) * pageSize, page * pageSize) : [];

  // Live-append when a new message gets flagged elsewhere in the app, so the
  // report doesn't feel stale while an admin is sitting on this page. Only
  // applied when it actually matches the currently active filters — otherwise
  // just leave it for the next explicit reload.
  useEffect(() => {
    if (!socket) return;
    function handleFlagged(payload) {
      // Loosely trust the current date-range filter here (no live event carries
      // enough info to re-derive it precisely) — a message flagged "now" is
      // always within "today", and the common case is viewing today/this month
      // anyway. Severity/agent filters are checked exactly since we have both.
      if (severity && payload.severity !== severity) return;
      if (agentId && payload.agentId !== agentId) return;
      setData(prev => {
        if (!prev) return prev;
        const already = prev.messages.some(m => m.id === payload.messageId);
        if (already) return prev;
        const newRow = {
          id: payload.messageId,
          content: payload.content,
          flagSeverity: payload.severity,
          flagReason: payload.reason,
          createdAt: payload.createdAt,
          senderName: payload.agentName,
          senderId: payload.agentId,
          senderAgent: { id: payload.agentId, name: payload.agentName },
          conversation: prev.messages[0]?.conversation || null, // best-effort; a full reload fills this in properly
        };
        return {
          messages: [newRow, ...prev.messages],
          totalFlagged: prev.totalFlagged + 1,
          severeCount: prev.severeCount + (payload.severity === 'severe' ? 1 : 0),
          minorCount: prev.minorCount + (payload.severity === 'minor' ? 1 : 0),
        };
      });
    }
    socket.on('message_flagged', handleFlagged);
    return () => socket.off('message_flagged', handleFlagged);
  }, [socket, severity, agentId]);

  const rangeLabel = useMemo(() => {
    const activePreset = PRESETS.find(p => p.key === preset);
    if (activePreset) return activePreset.label;
    return from === to ? from : `${from} ถึง ${to}`;
  }, [preset, from, to]);

  if (!data) return <div className="flex-1 flex items-center justify-center text-gray-400 dark:text-slate-500 h-full">กำลังโหลด...</div>;

  return (
    <div className="p-6 overflow-y-auto h-full">
      <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100 mb-4">ตรวจสอบ</h1>

      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-bold text-gray-900 dark:text-slate-100">คำพูดไม่เหมาะสม</h2>
      </div>
      <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">
        AI ตรวจข้อความที่พนักงานพิมพ์ส่งลูกค้าแบบอัตโนมัติ (เฉพาะข้อความใหม่นับจากนี้) — ใช้สำหรับตรวจสอบและประเมิน KPI
      </p>

      {/* Date range */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-1.5 flex-wrap">
          {PRESETS.map(p => (
            <button
              key={p.key}
              onClick={() => pickPreset(p)}
              className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${preset === p.key ? 'bg-gradient-to-r from-aurora-teal to-aurora-purple text-white border-transparent' : 'text-gray-600 dark:text-slate-300 border-gray-200 dark:border-slate-700 hover:border-gray-400 dark:hover:border-slate-500'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-slate-400">
          <input
            type="date"
            className="border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none"
            value={from}
            max={to}
            onChange={e => pickCustomDate('from', e.target.value)}
          />
          <span>ถึง</span>
          <input
            type="date"
            className="border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none"
            value={to}
            min={from}
            onChange={e => pickCustomDate('to', e.target.value)}
          />
        </div>
        <select
          className="text-sm border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 rounded-lg px-2 py-1.5 focus:outline-none"
          value={agentId}
          onChange={e => setAgentId(e.target.value)}
        >
          <option value="">พนักงานทั้งหมด</option>
          {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard icon={AlertTriangle} label={`ข้อความที่ถูกตี (${rangeLabel})`} value={data.totalFlagged} color="bg-gradient-to-br from-aurora-teal to-aurora-purple" />
        <StatCard icon={ShieldAlert} label="รุนแรง" value={data.severeCount} color="bg-rose-500" />
        <StatCard icon={ShieldQuestion} label="เล็กน้อย" value={data.minorCount} color="bg-amber-500" />
      </div>

      {/* Severity tabs */}
      <div className="flex gap-1.5 mb-3">
        {SEVERITY_TABS.map(tab => (
          <button
            key={tab.key || 'all'}
            onClick={() => setSeverity(tab.key)}
            className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${severity === tab.key ? 'bg-gradient-to-r from-aurora-teal to-aurora-purple text-white border-transparent' : 'text-gray-600 dark:text-slate-300 border-gray-200 dark:border-slate-700 hover:border-gray-400 dark:hover:border-slate-500'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 overflow-hidden">
        {data.messages.length === 0 ? (
          <p className="text-center text-gray-400 dark:text-slate-500 text-sm py-10">ไม่พบข้อความที่ถูกตีในช่วงเวลานี้</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-slate-800 text-left text-gray-500 dark:text-slate-400">
                <th className="px-4 py-2.5 font-medium">เวลา</th>
                <th className="px-4 py-2.5 font-medium">พนักงาน</th>
                <th className="px-4 py-2.5 font-medium">ลูกค้า / ช่องทาง</th>
                <th className="px-4 py-2.5 font-medium">ข้อความ</th>
                <th className="px-4 py-2.5 font-medium">ระดับ</th>
                <th className="px-4 py-2.5 font-medium">เหตุผล</th>
                <th className="px-4 py-2.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {pagedMessages.map(m => (
                <tr key={m.id} className="border-b border-gray-50 dark:border-slate-800/60 hover:bg-gray-50 dark:hover:bg-slate-800/40 align-top">
                  <td className="px-4 py-2.5 text-gray-500 dark:text-slate-400 whitespace-nowrap">
                    {format(new Date(m.createdAt), 'd MMM yy HH:mm', { locale: th })}
                  </td>
                  <td className="px-4 py-2.5 text-gray-800 dark:text-slate-200 whitespace-nowrap">
                    {m.senderAgent?.name || m.senderName || '—'}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 dark:text-slate-300 whitespace-nowrap">
                    {m.conversation ? (
                      <>
                        <p className="truncate max-w-[140px]">{m.conversation.displayName || m.conversation.lineUserId}</p>
                        <p className="text-[11px] text-gray-400 dark:text-slate-500">{m.conversation.channel?.name}</p>
                      </>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-gray-800 dark:text-slate-200 max-w-xs">
                    <p className="line-clamp-3 whitespace-pre-wrap break-words">{m.content}</p>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${SEVERITY_BADGE[m.flagSeverity] || 'bg-gray-100 text-gray-500'}`}>
                      {SEVERITY_LABEL[m.flagSeverity] || m.flagSeverity}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-500 dark:text-slate-400 max-w-[160px]">
                    <p className="line-clamp-3">{m.flagReason || '—'}</p>
                  </td>
                  <td className="px-4 py-2.5">
                    {m.conversation && (
                      <button
                        onClick={() => navigate(`/inbox?conv=${m.conversation.id}&msg=${m.id}`)}
                        title="ไปที่แชท"
                        className="text-gray-400 dark:text-slate-500 hover:text-aurora-tealDeep dark:hover:text-aurora-teal"
                      >
                        <ExternalLink size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data.messages.length > 0 && (
          <Pagination page={page} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize} total={data.messages.length} />
        )}
      </div>

      <UnansweredSection channels={channels} agents={agents} />
    </div>
  );
}

// "พนักงาน" tab — the per-agent conduct scorecard, its own page with its own
// date-range picker (same PRESETS pattern as AuditReport, kept independent
// since these are now two separate routes rather than sections on one page).
function AgentConductPage() {
  const navigate = useNavigate();
  const [preset, setPreset] = useState('thisMonth');
  const [[from, to], setDateRange] = useState(PRESETS[2].range());

  function pickPreset(p) {
    setPreset(p.key);
    setDateRange(p.range());
  }

  function pickCustomDate(which, value) {
    setPreset(null);
    setDateRange(prev => which === 'from' ? [value, prev[1]] : [prev[0], value]);
  }

  return (
    <div className="p-6 overflow-y-auto h-full">
      <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100 mb-4 flex items-center gap-2">
        <Users size={20} className="text-aurora-tealDeep dark:text-aurora-teal" />
        พนักงาน
      </h1>

      <div className="flex flex-wrap items-center gap-3 mb-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {PRESETS.map(p => (
            <button
              key={p.key}
              onClick={() => pickPreset(p)}
              className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${preset === p.key ? 'bg-gradient-to-r from-aurora-teal to-aurora-purple text-white border-transparent' : 'text-gray-600 dark:text-slate-300 border-gray-200 dark:border-slate-700 hover:border-gray-400 dark:hover:border-slate-500'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-slate-400">
          <input
            type="date"
            className="border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none"
            value={from}
            max={to}
            onChange={e => pickCustomDate('from', e.target.value)}
          />
          <span>ถึง</span>
          <input
            type="date"
            className="border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none"
            value={to}
            min={from}
            onChange={e => pickCustomDate('to', e.target.value)}
          />
        </div>
      </div>

      <AgentConductSection from={from} to={to} navigate={navigate} />
    </div>
  );
}

// ---------- "ตามลูกค้า" (customer follow-up + broadcast) ----------

const FOLLOWUP_STATUS_TABS = [
  { key: '', label: 'ทั้งหมด' },
  { key: 'open', label: 'เปิด' },
  { key: 'pending', label: 'รอ' },
  { key: 'closed', label: 'ปิด' },
];

const BLOCKED_FILTER_OPTIONS = [
  { value: '', label: 'บล็อค: ทั้งหมด' },
  { value: 'false', label: 'ไม่ถูกบล็อค' },
  { value: 'true', label: 'บล็อคเราอยู่' },
];

const FOLLOWUP_SORT_OPTIONS = [
  { value: 'oldest', label: 'หายไปนานสุดก่อน' },
  { value: 'newest', label: 'ข้อความล่าสุดก่อน' },
  { value: 'name', label: 'ชื่อ A-Z' },
];

const DAY_PRESETS = [3, 7, 14, 30, 60];
// Custom "หายไปตั้งแต่" filter — a plain number plus one of these units, converted
// to a day count before being sent as minDaysInactive (the backend only ever
// understands days, see conversationQuery.js). Month/year are calendar
// approximations (30/365 days), not exact — fine for a "roughly this long" filter.
const CUSTOM_DAYS_UNITS = [
  { value: 'day', label: 'วัน', days: 1 },
  { value: 'week', label: 'อาทิตย์', days: 7 },
  { value: 'month', label: 'เดือน', days: 30 },
  { value: 'year', label: 'ปี', days: 365 },
];
// Comparison for the custom "หายไปตั้งแต่" filter — sent as daysInactiveOp
// alongside minDaysInactive (see conversationQuery.js on the backend). Presets/
// summary cards always mean "at least" (their labels read "N+ วัน"), so only
// the custom control below exposes a choice of operator.
const CUSTOM_DAYS_OPS = [
  { value: 'eq', label: 'เท่ากับ' },
  { value: 'lt', label: 'น้อยกว่า' },
  { value: 'gt', label: 'มากกว่า' },
];
const FOLLOWUP_LIMIT = 25;
const MAX_BROADCAST_IMAGES = 3;
const MAX_BROADCAST_IMAGE_BYTES = 10 * 1024 * 1024; // matches ProfileModal's avatar-upload cap

function FollowupAvatar({ name, pictureUrl }) {
  if (pictureUrl) return <img src={pictureUrl} className="w-9 h-9 rounded-full object-cover flex-shrink-0" alt="" />;
  return (
    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-aurora-teal to-aurora-purple flex items-center justify-center text-white text-sm font-semibold flex-shrink-0">
      {name?.[0]?.toUpperCase() || '?'}
    </div>
  );
}

function FollowupStatCard({ label, value, cls, onClick, active }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={`text-left rounded-xl border px-4 py-2.5 min-w-[110px] transition-colors ${cls} ${onClick ? 'cursor-pointer hover:brightness-125' : ''} ${active ? 'ring-2 ring-offset-0 ring-current' : ''}`}
    >
      <p className="text-xl font-bold text-white leading-tight">{value ?? '—'}</p>
      <p className="text-[11px] font-medium mt-0.5">{label}</p>
    </Tag>
  );
}

function daysInactiveLabel(days) {
  if (days === null || days === undefined) return { text: 'ไม่เคยมีข้อความ', cls: 'text-rose-600 dark:text-rose-400 font-medium' };
  if (days >= 30) return { text: `${days} วัน`, cls: 'text-rose-600 dark:text-rose-400 font-semibold' };
  if (days >= 14) return { text: `${days} วัน`, cls: 'text-amber-600 dark:text-amber-400 font-semibold' };
  if (days >= 7) return { text: `${days} วัน`, cls: 'text-orange-600 dark:text-orange-400 font-medium' };
  return { text: `${days} วัน`, cls: 'text-gray-500 dark:text-slate-400' };
}

// Checkbox-dropdown multi-select — same pattern as UnansweredSection's channel
// picker above, generalized so it can also drive the tag filter here.
function MultiCheckDropdown({ label, allLabel, items, selectedIds, onToggle, onClear }) {
  const [open, setOpen] = useState(false);
  const count = selectedIds.length;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-1.5 text-sm border rounded-lg px-2.5 py-2 focus:outline-none ${count > 0 ? 'border-aurora-teal text-aurora-tealDeep dark:text-aurora-teal bg-aurora-teal/5' : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200'}`}
      >
        <span>{count === 0 ? allLabel : count === 1 ? (items.find(i => i.id === selectedIds[0])?.name || `เลือก 1 ${label}`) : `เลือก ${count} ${label}`}</span>
        <span className="text-gray-400 dark:text-slate-500 text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 w-56 border border-gray-200 dark:border-slate-600 rounded-lg p-1.5 space-y-0.5 max-h-56 overflow-y-auto bg-white dark:bg-slate-700 shadow-lg z-30">
          <label className="flex items-center gap-2 text-sm px-1.5 py-1 rounded hover:bg-gray-50 dark:hover:bg-slate-600 cursor-pointer text-gray-700 dark:text-slate-200 font-medium border-b border-gray-100 dark:border-slate-600 mb-0.5 pb-1.5">
            <input type="checkbox" className="accent-aurora-teal" checked={count === 0} onChange={onClear} />
            {allLabel}
          </label>
          {items.map(item => (
            <label key={item.id} className="flex items-center gap-2 text-sm px-1.5 py-1 rounded hover:bg-gray-50 dark:hover:bg-slate-600 cursor-pointer text-gray-700 dark:text-slate-200">
              <input type="checkbox" className="accent-aurora-teal" checked={selectedIds.includes(item.id)} onChange={() => onToggle(item.id)} />
              {item.name}
            </label>
          ))}
          {items.length === 0 && <p className="text-sm text-gray-400 dark:text-slate-500 px-1.5 py-1">ไม่มีข้อมูล</p>}
        </div>
      )}
    </div>
  );
}

function SimplePager({ page, setPage, total, limit }) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  if (total === 0) return null;
  return (
    <div className="flex items-center justify-between mt-3">
      <p className="text-xs text-gray-500 dark:text-slate-400">หน้า {page} จาก {totalPages} ({total} รายการ)</p>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setPage(p => Math.max(1, p - 1))}
          disabled={page <= 1}
          className="flex items-center gap-1 text-sm text-gray-600 dark:text-slate-300 border border-gray-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 hover:border-gray-400 dark:hover:border-slate-500 disabled:opacity-30 transition-colors"
        >
          <ChevronLeft size={14} /> ก่อนหน้า
        </button>
        <button
          onClick={() => setPage(p => Math.min(totalPages, p + 1))}
          disabled={page >= totalPages}
          className="flex items-center gap-1 text-sm text-gray-600 dark:text-slate-300 border border-gray-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 hover:border-gray-400 dark:hover:border-slate-500 disabled:opacity-30 transition-colors"
        >
          ถัดไป <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

// Compose + send a broadcast — text + up to 3 images, either to every
// conversation matching the follow-up page's current filters ("ตามตัวกรอง")
// or to a hand-picked list ("เลือกเอง"). Mirrors QuickReplyImageUpload's
// controlled data-URL pattern from Settings.jsx, repeated as a small array.
function BroadcastComposeModal({ targetCount, mode, filters, conversationIds, onClose, onSent }) {
  const [message, setMessage] = useState('');
  const [images, setImages] = useState([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return setError('กรุณาเลือกไฟล์รูปภาพ');
    if (file.size > MAX_BROADCAST_IMAGE_BYTES) return setError('ไฟล์รูปภาพต้องมีขนาดไม่เกิน 10MB ต่อรูป');
    setError('');
    const reader = new FileReader();
    reader.onload = () => setImages(prev => [...prev, reader.result]);
    reader.readAsDataURL(file);
  }

  async function handleSend() {
    if (!message.trim() && images.length === 0) {
      setError('ต้องมีข้อความหรือรูปภาพอย่างน้อย 1 อย่าง');
      return;
    }
    setSending(true); setError('');
    try {
      const body = { message: message.trim(), images, mode };
      if (mode === 'manual') body.conversationIds = conversationIds;
      else body.filters = filters;
      const { data } = await axios.post('/api/broadcasts', body);
      onSent(data);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'ส่ง Broadcast ไม่สำเร็จ');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5 w-full max-w-lg" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-2"><Send size={16} /> ส่งข้อความติดตาม (Broadcast)</h3>
          <button onClick={onClose} className="text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300"><X size={18} /></button>
        </div>
        <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">
          จะส่งถึงลูกค้า <span className="font-semibold text-gray-900 dark:text-slate-100">{targetCount}</span> คน
          {mode === 'filter' && ' ตามตัวกรองปัจจุบัน'} — ลูกค้าที่บล็อคเราอยู่หรืออยู่ในช่องทางที่ปิดใช้งานจะถูกข้ามให้อัตโนมัติ
        </p>

        <textarea
          className="w-full border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-aurora-teal placeholder:text-gray-400 dark:placeholder:text-slate-500 resize-none"
          rows={4}
          placeholder="พิมพ์ข้อความติดตามลูกค้า..."
          value={message}
          onChange={e => setMessage(e.target.value)}
        />

        <div className="flex flex-wrap items-center gap-2 mt-3">
          {images.map((img, i) => (
            <div key={i} className="relative">
              <img src={img} alt="" className="w-16 h-16 rounded-lg object-cover border border-gray-200 dark:border-slate-700" />
              <button
                type="button"
                onClick={() => setImages(prev => prev.filter((_, idx) => idx !== i))}
                className="absolute -top-1.5 -right-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-full w-5 h-5 flex items-center justify-center"
              >
                <X size={11} />
              </button>
            </div>
          ))}
          {images.length < MAX_BROADCAST_IMAGES && (
            <label className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-slate-400 border border-dashed border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 cursor-pointer hover:border-aurora-teal hover:text-aurora-teal w-fit transition-colors">
              <ImagePlus size={15} /> แนบรูป ({images.length}/{MAX_BROADCAST_IMAGES})
              <input type="file" accept="image/*" className="hidden" onChange={handleFile} />
            </label>
          )}
        </div>

        {error && <p className="text-sm text-rose-500 mt-3">{error}</p>}

        <div className="flex gap-2 mt-5">
          <button
            type="button"
            onClick={handleSend}
            disabled={sending || targetCount === 0}
            className="flex items-center gap-1.5 bg-gradient-to-r from-aurora-teal to-aurora-purple text-white rounded-lg px-4 py-2 text-sm font-medium hover:brightness-110 disabled:opacity-50"
          >
            {sending && <Loader2 size={14} className="animate-spin" />}
            ยืนยันส่ง Broadcast ให้ลูกค้า {targetCount} คน
          </button>
          <button type="button" onClick={onClose} className="text-sm text-gray-500 dark:text-slate-400 px-4 py-2">ยกเลิก</button>
        </div>
      </div>
    </div>
  );
}

const BROADCAST_STATUS_LABEL = { sent: 'สำเร็จ', failed: 'ล้มเหลว', skipped_blocked: 'ข้าม (บล็อค)', skipped_channel_inactive: 'ข้าม (ช่องทางปิด)' };

// Detail drill-down for one campaign — who it went to and who replied.
function BroadcastDetailModal({ campaignId, onClose }) {
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    axios.get(`/api/broadcasts/${campaignId}`).then(r => setDetail(r.data)).catch(() => {});
  }, [campaignId]);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5 w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900 dark:text-slate-100">รายละเอียด Broadcast</h3>
          <button onClick={onClose} className="text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300"><X size={18} /></button>
        </div>
        {!detail ? (
          <p className="text-sm text-gray-400 dark:text-slate-500 py-6 text-center">กำลังโหลด...</p>
        ) : (
          <div className="overflow-y-auto flex-1 -mx-1 px-1">
            {detail.message && <p className="text-sm text-gray-700 dark:text-slate-300 mb-3 whitespace-pre-wrap">{detail.message}</p>}
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-slate-800 text-left text-gray-500 dark:text-slate-500">
                  <th className="py-1.5 pr-3 font-medium">ลูกค้า</th>
                  <th className="py-1.5 pr-3 font-medium">ช่องทาง</th>
                  <th className="py-1.5 pr-3 font-medium">สถานะ</th>
                  <th className="py-1.5 pr-3 font-medium">ตอบกลับ</th>
                </tr>
              </thead>
              <tbody>
                {detail.recipients.map(r => (
                  <tr key={r.id} className="border-b border-gray-50 dark:border-slate-800/60">
                    <td className="py-1.5 pr-3 text-gray-800 dark:text-slate-200">{r.conversation?.displayName || r.conversation?.lineUserId || '—'}</td>
                    <td className="py-1.5 pr-3 text-gray-500 dark:text-slate-400">{r.conversation?.channel?.name}</td>
                    <td className="py-1.5 pr-3 text-gray-500 dark:text-slate-400">{BROADCAST_STATUS_LABEL[r.status] || r.status}</td>
                    <td className="py-1.5 pr-3">{r.replied ? <span className="text-emerald-600 dark:text-emerald-400 font-medium">ตอบแล้ว</span> : <span className="text-gray-400 dark:text-slate-600">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// Paginated history of past campaigns — refreshes when `refreshKey` changes
// (bumped by the parent right after a new broadcast is created) and
// live-updates the matching row when its send finishes (broadcast_progress).
function BroadcastHistorySection({ refreshKey }) {
  const { socket } = useSocket();
  const [campaigns, setCampaigns] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [detailId, setDetailId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get('/api/broadcasts', { params: { page, limit: 10 } });
      setCampaigns(data.campaigns);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [refreshKey]);

  useEffect(() => {
    if (!socket) return;
    function handleProgress(campaign) {
      setCampaigns(prev => prev.some(c => c.id === campaign.id)
        ? prev.map(c => c.id === campaign.id ? { ...c, ...campaign, repliedCount: c.repliedCount } : c)
        : prev);
    }
    socket.on('broadcast_progress', handleProgress);
    return () => socket.off('broadcast_progress', handleProgress);
  }, [socket]);

  return (
    <div className="mt-10">
      <h2 className="text-lg font-bold text-gray-900 dark:text-slate-100 mb-1">ประวัติการ Broadcast</h2>
      <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">1 ครั้งที่กดส่ง = 1 แคมเปญ ไม่ว่าจะมีข้อความ/รูปกี่ชิ้น — "ตอบกลับ" นับลูกค้า 1 คนต่อ 1 ครั้ง ไม่ว่าจะพิมพ์มากี่ข้อความ</p>
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 overflow-hidden">
        {loading && campaigns.length === 0 ? (
          <p className="text-center text-gray-400 dark:text-slate-500 text-sm py-10">กำลังโหลด...</p>
        ) : campaigns.length === 0 ? (
          <p className="text-center text-gray-400 dark:text-slate-500 text-sm py-10">ยังไม่มีการส่ง Broadcast</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-slate-800 text-left text-gray-500 dark:text-slate-500">
                <th className="px-4 py-2.5 font-medium">วันที่</th>
                <th className="px-4 py-2.5 font-medium">ผู้ส่ง</th>
                <th className="px-4 py-2.5 font-medium">ข้อความ</th>
                <th className="px-4 py-2.5 font-medium">ส่งถึง</th>
                <th className="px-4 py-2.5 font-medium">สำเร็จ/ล้มเหลว/ข้าม</th>
                <th className="px-4 py-2.5 font-medium">ตอบกลับ</th>
                <th className="px-4 py-2.5 font-medium">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map(c => (
                <tr key={c.id} onClick={() => setDetailId(c.id)} className="border-b border-gray-50 dark:border-slate-800/60 hover:bg-gray-50 dark:hover:bg-slate-800/40 cursor-pointer">
                  <td className="px-4 py-2.5 text-gray-500 dark:text-slate-400 whitespace-nowrap">{format(new Date(c.createdAt), 'd MMM yyyy HH:mm', { locale: th })}</td>
                  <td className="px-4 py-2.5 text-gray-700 dark:text-slate-300 whitespace-nowrap">{c.createdBy?.name}</td>
                  <td className="px-4 py-2.5 text-gray-600 dark:text-slate-300 max-w-xs">
                    <p className="line-clamp-1">{c.message || <span className="text-gray-400 dark:text-slate-500 italic">(ไม่มีข้อความ)</span>}</p>
                    {c.images?.length > 0 && <span className="text-[11px] text-gray-400 dark:text-slate-500">📷 {c.images.length} รูป</span>}
                  </td>
                  <td className="px-4 py-2.5 text-gray-700 dark:text-slate-300">{c.totalRecipients}</td>
                  <td className="px-4 py-2.5 text-gray-500 dark:text-slate-400 whitespace-nowrap">
                    <span className="text-emerald-600 dark:text-emerald-400">{c.successCount}</span>
                    {' / '}
                    <span className="text-rose-500 dark:text-rose-400">{c.failedCount}</span>
                    {' / '}
                    <span>{c.skippedCount}</span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-700 dark:text-slate-300">{c.repliedCount}</td>
                  <td className="px-4 py-2.5">
                    {c.status === 'sending'
                      ? <span className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400"><Loader2 size={12} className="animate-spin" /> กำลังส่ง</span>
                      : <span className="text-[11px] text-gray-500 dark:text-slate-400">เสร็จสิ้น</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <SimplePager page={page} setPage={setPage} total={total} limit={10} />
      {detailId && <BroadcastDetailModal campaignId={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}

function CustomerFollowupPage() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const [channels, setChannels] = useState([]);
  const [agents, setAgents] = useState([]);
  const [tags, setTags] = useState([]);
  const [teams, setTeams] = useState([]);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [channelIds, setChannelIds] = useState([]);
  const [agentId, setAgentId] = useState('');
  const [agentCategoryId, setAgentCategoryId] = useState('');
  const [tagIds, setTagIds] = useState([]);
  const [blocked, setBlocked] = useState('');
  const [lifecycleStage, setLifecycleStage] = useState('');
  const [minDaysInactive, setMinDaysInactive] = useState('');
  // How minDaysInactive (N) is compared — 'gte' (at least N, what every preset
  // chip/summary card uses, hence the "+" in their labels) | 'eq' (exactly N)
  // | 'lt' (less than N) | 'gt' (more than N). Presets/cards always mean
  // "at least," so they force this back to 'gte' when clicked (see below) —
  // only the custom control below lets the operator itself be chosen.
  const [daysInactiveOp, setDaysInactiveOp] = useState('gte');
  // Optional second condition, combined with the first via AND/OR (e.g.
  // "มากกว่า 5 วัน AND น้อยกว่า 10 วัน" for a range, or "น้อยกว่า 3 OR มากกว่า
  // 30" to catch either end while excluding the middle). Empty
  // minDaysInactive2 means no second condition is applied.
  const [minDaysInactive2, setMinDaysInactive2] = useState('');
  const [daysInactiveOp2, setDaysInactiveOp2] = useState('eq');
  const [daysInactiveCombine, setDaysInactiveCombine] = useState('and');
  // "กำหนดเอง" — a number + unit + operator (x2, if the second condition is
  // shown) that gets converted to days and written into the applied
  // minDaysInactive*/daysInactiveOp*/daysInactiveCombine state on apply (see
  // CUSTOM_DAYS_UNITS and CUSTOM_DAYS_OPS above). Kept as separate draft state
  // rather than driving the applied filters directly on every keystroke, so a
  // half-typed number doesn't refetch the list on every digit.
  const [customDaysValue, setCustomDaysValue] = useState('');
  const [customDaysUnit, setCustomDaysUnit] = useState('day');
  const [customDaysOp, setCustomDaysOp] = useState('eq');
  const [showSecondDaysCondition, setShowSecondDaysCondition] = useState(false);
  const [customDaysValue2, setCustomDaysValue2] = useState('');
  const [customDaysUnit2, setCustomDaysUnit2] = useState('day');
  const [customDaysOp2, setCustomDaysOp2] = useState('eq');
  const [customDaysCombine, setCustomDaysCombine] = useState('and');
  const [sort, setSort] = useState('oldest');

  function applyCustomDaysInactive() {
    const n = Number(customDaysValue);
    if (!customDaysValue || !Number.isFinite(n) || n <= 0) return;
    const unit = CUSTOM_DAYS_UNITS.find(u => u.value === customDaysUnit) || CUSTOM_DAYS_UNITS[0];
    setMinDaysInactive(String(Math.round(n * unit.days)));
    setDaysInactiveOp(customDaysOp);

    const n2 = Number(customDaysValue2);
    if (showSecondDaysCondition && customDaysValue2 && Number.isFinite(n2) && n2 > 0) {
      const unit2 = CUSTOM_DAYS_UNITS.find(u => u.value === customDaysUnit2) || CUSTOM_DAYS_UNITS[0];
      setMinDaysInactive2(String(Math.round(n2 * unit2.days)));
      setDaysInactiveOp2(customDaysOp2);
      setDaysInactiveCombine(customDaysCombine);
    } else {
      setMinDaysInactive2('');
    }
  }

  function clearCustomDaysInactive() {
    setMinDaysInactive(''); setDaysInactiveOp('gte'); setMinDaysInactive2('');
    setCustomDaysValue(''); setCustomDaysValue2(''); setShowSecondDaysCondition(false);
  }

  const [selectionMode, setSelectionMode] = useState('filter'); // 'filter' | 'manual'
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [showCompose, setShowCompose] = useState(false);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

  // Shared shape between the list query and the broadcast targeting request
  // (POST /api/broadcasts, mode: 'filter') — see conversationQuery.js on the
  // backend, which builds its `where` from these exact same param names.
  const filterParams = useMemo(() => {
    const p = {};
    if (search.trim()) p.search = search.trim();
    if (status) p.status = status;
    if (channelIds.length > 0) p.channelIds = channelIds.join(',');
    if (agentId) p.agentId = agentId;
    if (agentCategoryId) p.agentCategoryId = agentCategoryId;
    if (tagIds.length > 0) p.tagIds = tagIds.join(',');
    if (blocked) p.blocked = blocked;
    if (lifecycleStage) p.lifecycleStage = lifecycleStage;
    if (minDaysInactive) {
      p.minDaysInactive = minDaysInactive; p.daysInactiveOp = daysInactiveOp;
      if (minDaysInactive2) {
        p.minDaysInactive2 = minDaysInactive2; p.daysInactiveOp2 = daysInactiveOp2; p.daysInactiveCombine = daysInactiveCombine;
      }
    }
    return p;
  }, [search, status, channelIds, agentId, agentCategoryId, tagIds, blocked, lifecycleStage, minDaysInactive, daysInactiveOp, minDaysInactive2, daysInactiveOp2, daysInactiveCombine]);

  const loadSummary = useCallback(() => {
    axios.get('/api/conversations/summary').then(r => setSummary(r.data)).catch(() => {});
  }, []);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get('/api/conversations', { params: { ...filterParams, page, limit: FOLLOWUP_LIMIT, sort } });
      setConversations(data.conversations);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, [filterParams, page, sort]);

  useEffect(() => {
    loadSummary();
    axios.get('/api/channels').then(r => setChannels(r.data)).catch(() => {});
    axios.get('/api/agents').then(r => setAgents(r.data)).catch(() => {});
    axios.get('/api/tags').then(r => setTags(r.data)).catch(() => {});
    axios.get('/api/agent-categories').then(r => setTeams(r.data)).catch(() => {});
  }, [loadSummary]);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { setPage(1); }, [filterParams, sort]);

  function toggleSelected(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function selectAllOnPage() {
    setSelectedIds(prev => {
      const next = new Set(prev);
      conversations.forEach(c => next.add(c.id));
      return next;
    });
  }

  const targetCount = selectionMode === 'filter' ? total : selectedIds.size;
  const selectCls = 'text-sm border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 rounded-lg px-2.5 py-2 focus:outline-none';
  const totalPages = Math.max(1, Math.ceil(total / FOLLOWUP_LIMIT));
  // Active filter came from the custom control rather than a fixed-day preset
  // — drives the custom control's highlight below. Presets only ever apply
  // 'gte' (their labels read "N+ วัน"), so any other operator is always
  // "custom" by definition — this only needs to disambiguate the 'gte' case,
  // where a custom value happening to match a preset's day count should still
  // highlight as that preset, not as a separate custom filter.
  const isCustomDaysActive = minDaysInactive !== '' && (minDaysInactive2 !== '' || daysInactiveOp !== 'gte' || !DAY_PRESETS.some(d => String(d) === minDaysInactive));

  return (
    <div className="p-6 overflow-y-auto h-full">
      <div className="flex items-center gap-2 mb-1">
        <Clock size={20} className="text-aurora-tealDeep dark:text-aurora-teal" />
        <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100">ตามลูกค้า</h1>
      </div>
      <p className="text-sm text-gray-500 dark:text-slate-400 mb-5">
        ลูกค้าทุกคนในทุกช่องทาง เรียงตามจำนวนวันที่หายไป — ใช้ตัวกรองเพื่อคัดกลุ่มที่ต้องการ แล้วส่งข้อความติดตามแบบ broadcast ได้จากหน้านี้เลย
      </p>

      {/* Summary cards */}
      <div className="flex flex-wrap gap-3 mb-6">
        <FollowupStatCard label="ลูกค้าทั้งหมด" value={summary?.total} cls="border-slate-800 bg-slate-900 text-slate-400" />
        {DAY_PRESETS.slice(0, 4).map(d => (
          <FollowupStatCard
            key={d}
            label={`หายไป ${d}+ วัน`}
            value={summary?.[`inactive${d}`]}
            cls="border-orange-500/25 bg-orange-500/10 text-orange-300"
            onClick={() => {
              if (minDaysInactive === String(d) && daysInactiveOp === 'gte' && !minDaysInactive2) { setMinDaysInactive(''); }
              else { setMinDaysInactive(String(d)); setDaysInactiveOp('gte'); setMinDaysInactive2(''); }
              setCustomDaysValue(''); setShowSecondDaysCondition(false);
            }}
            active={minDaysInactive === String(d) && daysInactiveOp === 'gte' && !minDaysInactive2}
          />
        ))}
        <FollowupStatCard label="ไม่เคยมีข้อความเลย" value={summary?.neverMessaged} cls="border-rose-500/25 bg-rose-500/10 text-rose-300" />
        <FollowupStatCard
          label="บล็อคเราอยู่" value={summary?.blocked} cls="border-slate-700 bg-slate-800/60 text-slate-400"
          onClick={() => setBlocked(b => b === 'true' ? '' : 'true')} active={blocked === 'true'}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500 pointer-events-none" />
          <input
            className="w-full border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-aurora-teal placeholder:text-gray-400 dark:placeholder:text-slate-500"
            placeholder="ค้นหาชื่อหรือ LINE user ID"
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoComplete="off"
            type="search"
            name="followup-search"
          />
        </div>
        <MultiCheckDropdown label="ช่องทาง" allLabel="ทุกช่องทาง" items={channels} selectedIds={channelIds} onToggle={id => setChannelIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id])} onClear={() => setChannelIds([])} />
        <select className={selectCls} value={agentCategoryId} onChange={e => setAgentCategoryId(e.target.value)}>
          <option value="">ทุกทีม</option>
          <option value="none">ไม่มีทีม</option>
          {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select className={selectCls} value={agentId} onChange={e => setAgentId(e.target.value)}>
          <option value="">พนักงานทั้งหมด</option>
          <option value="unassigned">ยังไม่ได้ assign</option>
          {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <MultiCheckDropdown label="แท็ก" allLabel="ทุกแท็ก" items={tags} selectedIds={tagIds} onToggle={id => setTagIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id])} onClear={() => setTagIds([])} />
        <select className={selectCls} value={lifecycleStage} onChange={e => setLifecycleStage(e.target.value)}>
          <option value="">ทุก Lifecycle</option>
          {LIFECYCLE_STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <select className={selectCls} value={blocked} onChange={e => setBlocked(e.target.value)}>
          {BLOCKED_FILTER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className={selectCls} value={sort} onChange={e => setSort(e.target.value)}>
          {FOLLOWUP_SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {FOLLOWUP_STATUS_TABS.map(tab => (
          <button
            key={tab.key || 'all'}
            onClick={() => setStatus(tab.key)}
            className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${status === tab.key ? 'bg-gradient-to-r from-aurora-teal to-aurora-purple text-white border-transparent' : 'text-gray-600 dark:text-slate-300 border-gray-200 dark:border-slate-700 hover:border-gray-400 dark:hover:border-slate-500'}`}
          >
            {tab.label}
          </button>
        ))}
        <div className="flex flex-wrap items-center gap-1 ml-1">
          <span className="text-xs text-gray-500 dark:text-slate-400 mr-1">หายไปตั้งแต่:</span>
          {DAY_PRESETS.map(d => (
            <button
              key={d}
              onClick={() => {
                if (minDaysInactive === String(d) && daysInactiveOp === 'gte' && !minDaysInactive2) { setMinDaysInactive(''); }
                else { setMinDaysInactive(String(d)); setDaysInactiveOp('gte'); setMinDaysInactive2(''); }
                setCustomDaysValue(''); setShowSecondDaysCondition(false);
              }}
              className={`text-xs px-2 py-1 rounded-full border transition-colors ${minDaysInactive === String(d) && daysInactiveOp === 'gte' && !minDaysInactive2 ? 'bg-aurora-teal text-white border-transparent' : 'text-gray-500 dark:text-slate-400 border-gray-200 dark:border-slate-700 hover:border-gray-400 dark:hover:border-slate-500'}`}
            >
              {d}+ วัน
            </button>
          ))}
          <div className={`flex flex-wrap items-center gap-1 border rounded-full pl-2 pr-1 py-0.5 ml-1 ${isCustomDaysActive ? 'border-aurora-teal bg-aurora-teal/5' : 'border-gray-200 dark:border-slate-700'}`}>
            <select
              className="text-xs bg-transparent text-gray-700 dark:text-slate-200 focus:outline-none"
              value={customDaysOp}
              onChange={e => setCustomDaysOp(e.target.value)}
            >
              {CUSTOM_DAYS_OPS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <input
              type="number"
              min="1"
              className="w-12 text-xs bg-transparent text-gray-700 dark:text-slate-200 focus:outline-none placeholder:text-gray-400 dark:placeholder:text-slate-500"
              placeholder="จำนวน"
              value={customDaysValue}
              onChange={e => setCustomDaysValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') applyCustomDaysInactive(); }}
            />
            <select
              className="text-xs bg-transparent text-gray-700 dark:text-slate-200 focus:outline-none"
              value={customDaysUnit}
              onChange={e => setCustomDaysUnit(e.target.value)}
            >
              {CUSTOM_DAYS_UNITS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
            </select>

            {showSecondDaysCondition ? (
              <>
                <select
                  className="text-xs bg-transparent text-aurora-tealDeep dark:text-aurora-teal font-medium focus:outline-none"
                  value={customDaysCombine}
                  onChange={e => setCustomDaysCombine(e.target.value)}
                  title="วิธีรวมเงื่อนไขทั้งสอง"
                >
                  <option value="and">และ (AND)</option>
                  <option value="or">หรือ (OR)</option>
                </select>
                <select
                  className="text-xs bg-transparent text-gray-700 dark:text-slate-200 focus:outline-none"
                  value={customDaysOp2}
                  onChange={e => setCustomDaysOp2(e.target.value)}
                >
                  {CUSTOM_DAYS_OPS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <input
                  type="number"
                  min="1"
                  className="w-12 text-xs bg-transparent text-gray-700 dark:text-slate-200 focus:outline-none placeholder:text-gray-400 dark:placeholder:text-slate-500"
                  placeholder="จำนวน"
                  value={customDaysValue2}
                  onChange={e => setCustomDaysValue2(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') applyCustomDaysInactive(); }}
                />
                <select
                  className="text-xs bg-transparent text-gray-700 dark:text-slate-200 focus:outline-none"
                  value={customDaysUnit2}
                  onChange={e => setCustomDaysUnit2(e.target.value)}
                >
                  {CUSTOM_DAYS_UNITS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
                </select>
                <button
                  type="button"
                  onClick={() => { setShowSecondDaysCondition(false); setCustomDaysValue2(''); }}
                  title="ลบเงื่อนไขที่ 2"
                  className="text-gray-400 dark:text-slate-500 hover:text-rose-500"
                >
                  <X size={12} />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setShowSecondDaysCondition(true)}
                title="เพิ่มเงื่อนไข AND/OR"
                className="flex items-center text-gray-400 dark:text-slate-500 hover:text-aurora-tealDeep dark:hover:text-aurora-teal px-0.5"
              >
                <Plus size={12} />
              </button>
            )}

            <button
              type="button"
              onClick={applyCustomDaysInactive}
              className="text-xs text-aurora-tealDeep dark:text-aurora-teal font-medium px-1.5 py-0.5 rounded-full hover:bg-aurora-teal/10"
            >
              กรอง
            </button>
          </div>
          {minDaysInactive && (
            <button
              type="button"
              onClick={clearCustomDaysInactive}
              className="text-xs text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 px-1"
              title="ล้างตัวกรองหายไปกี่วัน"
            >
              ล้าง
            </button>
          )}
        </div>
        <span className="text-sm text-gray-500 dark:text-slate-400 ml-auto">
          พบ <span className="font-semibold text-gray-800 dark:text-slate-200">{total}</span> รายการ
        </span>
      </div>

      {/* Selection mode + broadcast action */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3 bg-gray-50 dark:bg-slate-800/50 border border-gray-200 dark:border-slate-800 rounded-xl px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-slate-400">โหมดเลือกลูกค้า:</span>
          {[{ key: 'filter', label: 'ตามตัวกรองปัจจุบัน' }, { key: 'manual', label: 'เลือกเอง' }].map(opt => (
            <button
              key={opt.key}
              onClick={() => setSelectionMode(opt.key)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${selectionMode === opt.key ? 'bg-gradient-to-r from-aurora-teal to-aurora-purple text-white border-transparent' : 'text-gray-600 dark:text-slate-300 border-gray-200 dark:border-slate-600 hover:border-gray-400 dark:hover:border-slate-500'}`}
            >
              {opt.label}
            </button>
          ))}
          {selectionMode === 'manual' && (
            <>
              <button onClick={selectAllOnPage} className="text-xs text-aurora-tealDeep dark:text-aurora-teal hover:brightness-110">เลือกทั้งหมดในหน้านี้</button>
              <button onClick={() => setSelectedIds(new Set())} className="text-xs text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300">ล้างที่เลือก</button>
            </>
          )}
        </div>
        <button
          onClick={() => setShowCompose(true)}
          disabled={targetCount === 0}
          className="flex items-center gap-1.5 bg-gradient-to-r from-aurora-teal to-aurora-purple text-white rounded-lg px-3.5 py-2 text-sm font-medium hover:brightness-110 disabled:opacity-40 transition-all"
        >
          <Send size={15} /> ส่งข้อความติดตาม ({targetCount} คน)
        </button>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        {loading ? (
          <p className="text-center text-gray-400 dark:text-slate-500 text-sm py-10">กำลังโหลด...</p>
        ) : conversations.length === 0 ? (
          <p className="text-center text-gray-400 dark:text-slate-500 text-sm py-10">ไม่พบลูกค้าที่ตรงกับตัวกรองที่เลือก</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-slate-800 text-left text-gray-500 dark:text-slate-500">
                {selectionMode === 'manual' && <th className="px-4 py-2.5 w-8"></th>}
                <th className="px-4 py-2.5 font-medium">ลูกค้า</th>
                <th className="px-4 py-2.5 font-medium">ช่องทาง</th>
                <th className="px-4 py-2.5 font-medium">พนักงาน/ทีม</th>
                <th className="px-4 py-2.5 font-medium">สถานะ</th>
                <th className="px-4 py-2.5 font-medium">Lifecycle</th>
                <th className="px-4 py-2.5 font-medium">หายไปกี่วัน</th>
                <th className="px-4 py-2.5 font-medium">ข้อความล่าสุด</th>
                <th className="px-4 py-2.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {conversations.map(c => {
                const last = c.messages?.[0];
                const inactive = daysInactiveLabel(c.daysInactive);
                const stage = stageInfo(c.lifecycleStage);
                return (
                  <tr
                    key={c.id}
                    onClick={() => selectionMode === 'manual' ? toggleSelected(c.id) : navigate(`/inbox?conv=${c.id}`)}
                    className="border-b border-gray-50 dark:border-slate-800/60 hover:bg-gray-50 dark:hover:bg-slate-800/40 align-top cursor-pointer"
                  >
                    {selectionMode === 'manual' && (
                      <td className="px-4 py-2.5" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" className="accent-aurora-teal" checked={selectedIds.has(c.id)} onChange={() => toggleSelected(c.id)} />
                      </td>
                    )}
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <FollowupAvatar name={c.displayName || c.lineUserId} pictureUrl={c.pictureUrl} />
                        <div className="min-w-0">
                          <p className="text-gray-800 dark:text-slate-100 font-medium truncate max-w-[160px]">{c.displayName || c.lineUserId}</p>
                          {c.blocked && <span className="text-[10px] text-rose-500 dark:text-rose-400 font-medium">🚫 บล็อคเราอยู่</span>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 dark:text-slate-400 whitespace-nowrap">{c.channel?.name}</td>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-slate-300 whitespace-nowrap">
                      {c.agent?.name || <span className="text-gray-400 dark:text-slate-500">ยังไม่ได้ assign</span>}
                      {c.agent?.category?.name && <span className="block text-[11px] text-gray-400 dark:text-slate-500">{c.agent.category.name}</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[c.status] || ''}`}>
                        {c.status === 'open' ? 'เปิด' : c.status === 'pending' ? 'รอ' : 'ปิด'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium border ${stage.color}`}>{stage.label}</span>
                    </td>
                    <td className={`px-4 py-2.5 whitespace-nowrap ${inactive.cls}`}>{inactive.text}</td>
                    <td className="px-4 py-2.5 text-gray-500 dark:text-slate-400 max-w-xs">
                      {last ? <p className="line-clamp-1 text-gray-600 dark:text-slate-300">{last.type === 'text' ? last.content : `[${last.type}]`}</p> : <span className="text-gray-400 dark:text-slate-600">ยังไม่มีข้อความ</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <button
                        onClick={(e) => { e.stopPropagation(); navigate(`/inbox?conv=${c.id}`); }}
                        title="ไปที่แชท"
                        className="text-gray-400 dark:text-slate-500 hover:text-aurora-tealDeep dark:hover:text-aurora-teal"
                      >
                        <ExternalLink size={15} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {total > FOLLOWUP_LIMIT && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-gray-500 dark:text-slate-400">หน้า {page} จาก {totalPages} ({total} รายการ)</p>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="flex items-center gap-1 text-sm text-gray-600 dark:text-slate-300 border border-gray-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 hover:border-gray-400 dark:hover:border-slate-500 disabled:opacity-30 transition-colors">
              <ChevronLeft size={14} /> ก่อนหน้า
            </button>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="flex items-center gap-1 text-sm text-gray-600 dark:text-slate-300 border border-gray-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 hover:border-gray-400 dark:hover:border-slate-500 disabled:opacity-30 transition-colors">
              ถัดไป <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      <BroadcastHistorySection refreshKey={historyRefreshKey} />

      {showCompose && (
        <BroadcastComposeModal
          targetCount={targetCount}
          mode={selectionMode}
          filters={filterParams}
          conversationIds={[...selectedIds]}
          onClose={() => setShowCompose(false)}
          onSent={() => { setHistoryRefreshKey(k => k + 1); loadSummary(); }}
        />
      )}
    </div>
  );
}

// Sidebar routes here as /report/:tab (see Sidebar.jsx's "รายงาน" dropdown) —
// "agents" renders the employee scorecard, "followup" renders the customer
// follow-up + broadcast page, anything else (including no tab, which
// App.jsx redirects to /report/audit) renders the audit page.
export default function Report() {
  const { tab } = useParams();
  if (tab === 'agents') return <AgentConductPage />;
  if (tab === 'followup') return <CustomerFollowupPage />;
  return <AuditReport />;
}
