import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import axios from 'axios';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ShieldAlert, ShieldQuestion, ExternalLink, MessageSquareWarning, Users, Eye, X } from 'lucide-react';
import { startOfMonth, endOfMonth, subMonths, subDays, format, formatDistanceToNow } from 'date-fns';
import { th } from 'date-fns/locale';
import { useSocket } from '../contexts/SocketContext';

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
  const lastReloadRef = useRef(0);

  const load = useCallback(async () => {
    const params = {};
    if (channelIds.length > 0) params.channelIds = channelIds.join(',');
    if (agentId) params.agentId = agentId;
    if (channelActive) params.channelActive = channelActive;
    const { data } = await axios.get('/api/reports/unanswered', { params });
    setData(data);
  }, [channelIds, agentId, channelActive]);

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
              {data.conversations.map(c => (
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

  function goTo(conversationId) {
    onClose();
    navigate(`/inbox?conv=${conversationId}`);
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
                        onClick={() => goTo(v.message.conversation.id)}
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
                        onClick={() => m.conversation && goTo(m.conversation.id)}
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
function AgentConductSection({ from, to, navigate }) {
  const [data, setData] = useState(null);
  const [selectedAgentId, setSelectedAgentId] = useState(null);

  useEffect(() => {
    axios.get('/api/reports/agent-conduct', { params: { from, to } }).then(r => setData(r.data));
  }, [from, to]);

  return (
    <div>
      <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">
        ภาพรวมพฤติกรรมพนักงานแต่ละคน — เปิดอ่านแชทของลูกค้าแล้วยังไม่ตอบกลับ และข้อความไม่เหมาะสมที่พิมพ์ส่ง กดที่แถวเพื่อดูรายละเอียดรายบุคคล
        {data && (
          <span> · ตอนนี้มี <span className="font-semibold text-amber-600 dark:text-amber-400">{data.totalViewedNoReply}</span> เคสเปิดอ่านค้างไม่ตอบทั้งทีม</span>
        )}
      </p>

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 overflow-hidden">
        {!data ? (
          <p className="text-center text-gray-400 dark:text-slate-500 text-sm py-10">กำลังโหลด...</p>
        ) : data.agents.length === 0 ? (
          <p className="text-center text-gray-400 dark:text-slate-500 text-sm py-10">ยังไม่มีพนักงานในระบบ</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-slate-800 text-left text-gray-500 dark:text-slate-400">
                <th className="px-4 py-2.5 font-medium">พนักงาน</th>
                <th className="px-4 py-2.5 font-medium">ยศ</th>
                <th className="px-4 py-2.5 font-medium">เปิดอ่านไม่ตอบ</th>
                <th className="px-4 py-2.5 font-medium">ข้อความไม่เหมาะสม</th>
                <th className="px-4 py-2.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {data.agents.map(a => (
                <tr
                  key={a.id}
                  onClick={() => setSelectedAgentId(a.id)}
                  className="border-b border-gray-50 dark:border-slate-800/60 hover:bg-gray-50 dark:hover:bg-slate-800/40 cursor-pointer"
                >
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
              ))}
            </tbody>
          </table>
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
              {data.messages.map(m => (
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
                        onClick={() => navigate(`/inbox?conv=${m.conversation.id}`)}
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

// Sidebar routes here as /report/:tab (see Sidebar.jsx's "รายงาน" dropdown) —
// "agents" renders the employee scorecard, anything else (including no tab,
// which App.jsx redirects to /report/audit) renders the audit page.
export default function Report() {
  const { tab } = useParams();
  return tab === 'agents' ? <AgentConductPage /> : <AuditReport />;
}
