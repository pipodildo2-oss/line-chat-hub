import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { MessageSquare, Users, CheckCircle, Clock } from 'lucide-react';
import { startOfMonth, endOfMonth, subMonths, subDays, format } from 'date-fns';
import { useTheme } from '../contexts/ThemeContext';
import { useLanguage } from '../contexts/LanguageContext';
import DateRangePicker from '../components/DateRangePicker';

function StatCard({ icon: Icon, label, value, color, caption }) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl p-5 border border-gray-200 dark:border-slate-800 flex items-center gap-4">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${color}`}>
        <Icon size={22} className="text-white" />
      </div>
      <div>
        <p className="text-gray-500 dark:text-slate-400 text-sm">{label}</p>
        <p className="text-2xl font-bold text-gray-900 dark:text-slate-100">{value ?? '—'}</p>
        {caption && <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-0.5">{caption}</p>}
      </div>
    </div>
  );
}

function toISODate(d) { return format(d, 'yyyy-MM-dd'); }

// Horizontal quick-pick tabs. Each returns a [from, to] ISO date pair (inclusive).
const PRESETS = [
  { key: 'today', label: 'วันนี้', range: () => { const d = toISODate(new Date()); return [d, d]; } },
  { key: 'yesterday', label: 'เมื่อวาน', range: () => { const d = toISODate(subDays(new Date(), 1)); return [d, d]; } },
  { key: 'thisMonth', label: 'เดือนนี้', range: () => [toISODate(startOfMonth(new Date())), toISODate(new Date())] },
  { key: 'lastMonth', label: 'เดือนที่แล้ว', range: () => {
    const d = subMonths(new Date(), 1);
    return [toISODate(startOfMonth(d)), toISODate(endOfMonth(d))];
  } },
];

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [preset, setPreset] = useState('today');
  const [[from, to], setDateRange] = useState(PRESETS[0].range());
  const { theme } = useTheme();
  const { t } = useLanguage();
  const isDark = theme === 'dark';
  const gridColor = isDark ? '#1e293b' : '#f0f0f0';
  const tickColor = isDark ? '#94a3b8' : '#6b7280';

  function pickPreset(p) {
    setPreset(p.key);
    setDateRange(p.range());
  }

  function pickCustomRange(newFrom, newTo) {
    setPreset(null); // manual pick — no longer matches any quick-pick tab
    setDateRange([newFrom, newTo]);
  }

  // No guard against out-of-order responses previously — switching the date
  // range fires a new request while the old one may still be in flight, and
  // nothing stopped a slower OLDER response (e.g. the initial "วันนี้" load,
  // still pending) from resolving AFTER a faster newer one and overwriting
  // it. The visible symptom: pick "เดือนนี้" right after the page loads, and
  // the hourly chart from the still-in-flight "วันนี้" request lands last,
  // showing hour-of-day labels under a "(เดือนนี้)" heading even though
  // activityGranularity is only ever 'hour' for a single selected day. The
  // `cancelled` flag (the standard fix for this in a plain useEffect, no
  // AbortController plumbing needed since the request has no side effects
  // worth aborting server-side) makes a response from a superseded request
  // a no-op once a newer one for the current from/to has started.
  useEffect(() => {
    let cancelled = false;
    axios.get('/api/analytics/summary', { params: { from, to } })
      .then(r => { if (!cancelled) setData(r.data); })
      .catch(err => { if (!cancelled) console.error('Failed to load dashboard summary:', err); });
    return () => { cancelled = true; };
  }, [from, to]);

  const rangeLabel = useMemo(() => {
    const activePreset = PRESETS.find(p => p.key === preset);
    if (activePreset) return activePreset.label;
    return from === to ? from : `${from} ถึง ${to}`;
  }, [preset, from, to]);

  if (!data) return <div className="flex-1 flex items-center justify-center text-gray-400 dark:text-slate-500 h-full">กำลังโหลด...</div>;

  // For a single selected day the backend already returns hour-of-day labels
  // ("14:00") ready to display as-is — only the multi-day case needs the
  // "YYYY-MM-DD" rows turned into a formatted date label (see analytics.js's
  // activityGranularity).
  const activityData = data.recentActivity.map(row => ({
    date: data.activityGranularity === 'hour' ? row.date : new Date(row.date).toLocaleDateString('th', { month: 'short', day: 'numeric' }),
    incoming: Number(row.incoming),
    outgoing: Number(row.outgoing),
  }));

  return (
    <div className="p-6 overflow-y-auto h-full">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100">Dashboard</h1>
      </div>

      {/* Date range picker — preset sidebar + click-click range calendar */}
      <div className="mb-6">
        <DateRangePicker presets={PRESETS} preset={preset} from={from} to={to} label={rangeLabel} onPreset={pickPreset} onCustomRange={pickCustomRange} />
      </div>

      {/* Stats — the first 3 are live snapshots of current status (a chat is
          either open or closed right now; there's no history log to look up
          "how many were open as of a past date"), so they intentionally don't
          move with the date picker above. Only "การสนทนาใหม่" and everything
          below (chart, by-channel) are scoped to the selected range — the
          caption/label text spells this out so it doesn't read as a bug. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard icon={MessageSquare} label={t('dashboard_total_conversations')} value={data.totalConversations} color="bg-gradient-to-br from-aurora-teal to-aurora-purple" caption="ข้อมูลปัจจุบันทั้งหมด ไม่ขึ้นกับช่วงเวลาที่เลือก" />
        <StatCard icon={Clock} label={t('dashboard_open')} value={data.openConversations} color="bg-aurora-tealDeep" caption="ข้อมูลปัจจุบัน" />
        <StatCard icon={CheckCircle} label={t('dashboard_closed')} value={data.closedConversations} color="bg-gray-400 dark:bg-slate-600" caption="ข้อมูลปัจจุบัน" />
        <StatCard icon={Users} label={`${t('dashboard_new_conversations')} (${rangeLabel})`} value={data.newConversations} color="bg-amber-500" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Activity chart */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-5">
          <h2 className="font-semibold text-gray-800 dark:text-slate-200 mb-4">{data.activityGranularity === 'hour' ? 'ข้อความต่อชั่วโมง' : t('dashboard_messages_per_day')} <span className="font-normal text-gray-400 dark:text-slate-500">({rangeLabel})</span></h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={activityData}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
              <XAxis dataKey="date" tick={{ fontSize: 12, fill: tickColor }} />
              <YAxis tick={{ fontSize: 12, fill: tickColor }} />
              <Tooltip
                contentStyle={isDark ? { backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0' } : undefined}
                labelStyle={isDark ? { color: '#e2e8f0' } : undefined}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: tickColor }} />
              {/* Bot auto-replies count as "ออก" alongside agent replies — both
                  hit the LINE API the same way (see routes/analytics.js). */}
              <Bar dataKey="incoming" name="ข้อความเข้า" fill="#005BFF" radius={[4, 4, 0, 0]} />
              <Bar dataKey="outgoing" name="ข้อความออก" fill="#22C55E" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* By channel */}
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-5">
          <h2 className="font-semibold text-gray-800 dark:text-slate-200 mb-4">{t('dashboard_by_channel')} <span className="font-normal text-gray-400 dark:text-slate-500">({rangeLabel})</span></h2>
          <div className="space-y-3">
            {data.messagesByChannel.length === 0 && (
              <p className="text-gray-400 dark:text-slate-500 text-sm">ยังไม่มีข้อมูล</p>
            )}
            {data.messagesByChannel.map(ch => {
              const max = Math.max(...data.messagesByChannel.map(c => c.count), 1);
              return (
                <div key={ch.channelId}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-700 dark:text-slate-300 truncate">{ch.channelName}</span>
                    <span className="font-medium text-gray-900 dark:text-slate-100">{ch.count.toLocaleString()}</span>
                  </div>
                  <div className="bg-gray-100 dark:bg-slate-800 rounded-full h-1.5">
                    <div
                      className="bg-aurora-teal h-1.5 rounded-full"
                      style={{ width: `${(ch.count / max) * 100}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          {/* This is a volume proxy for comparing OAs against each other, not
              a real bill — LINE's own free-tier/metered rules for which
              messages actually count don't map cleanly onto a simple
              in+out sum. */}
          <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-3 leading-relaxed">
            นับข้อความเข้า+ออกรวมกันต่อ OA — ใช้เทียบปริมาณระหว่างไลน์ได้ ไม่ใช่ยอดค่าใช้จ่ายจริงจาก LINE
          </p>
        </div>
      </div>
    </div>
  );
}
