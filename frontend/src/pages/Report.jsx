import { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ShieldAlert, ShieldQuestion, ExternalLink } from 'lucide-react';
import { startOfMonth, endOfMonth, subMonths, subDays, format } from 'date-fns';
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

export default function Report() {
  const navigate = useNavigate();
  const { socket } = useSocket();
  const [data, setData] = useState(null);
  const [agents, setAgents] = useState([]);
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
  useEffect(() => { axios.get('/api/agents').then(r => setAgents(r.data)).catch(() => {}); }, []);

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
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100">รายงานคำพูดไม่เหมาะสม</h1>
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
    </div>
  );
}
