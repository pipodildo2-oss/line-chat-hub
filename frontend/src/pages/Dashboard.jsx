import { useState, useEffect } from 'react';
import axios from 'axios';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { MessageSquare, Users, CheckCircle, Clock } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useLanguage } from '../contexts/LanguageContext';

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

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [days, setDays] = useState(7);
  const { theme } = useTheme();
  const { t } = useLanguage();
  const isDark = theme === 'dark';
  const gridColor = isDark ? '#1e293b' : '#f0f0f0';
  const tickColor = isDark ? '#94a3b8' : '#6b7280';

  useEffect(() => {
    axios.get('/api/analytics/summary', { params: { days } }).then(r => setData(r.data));
  }, [days]);

  if (!data) return <div className="flex-1 flex items-center justify-center text-gray-400 dark:text-slate-500 h-full">กำลังโหลด...</div>;

  const activityData = data.recentActivity.map(row => ({
    date: new Date(row.date).toLocaleDateString('th', { month: 'short', day: 'numeric' }),
    messages: Number(row.count),
  }));

  return (
    <div className="p-6 overflow-y-auto h-full">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100">Dashboard</h1>
        <select
          className="border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none"
          value={days}
          onChange={e => setDays(Number(e.target.value))}
        >
          <option value={7}>{t('dashboard_days_7')}</option>
          <option value={14}>{t('dashboard_days_14')}</option>
          <option value={30}>{t('dashboard_days_30')}</option>
        </select>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard icon={MessageSquare} label={t('dashboard_total_conversations')} value={data.totalConversations} color="bg-gradient-to-br from-aurora-teal to-aurora-purple" />
        <StatCard icon={Clock} label={t('dashboard_open')} value={data.openConversations} color="bg-aurora-purple" />
        <StatCard icon={CheckCircle} label={t('dashboard_closed')} value={data.closedConversations} color="bg-gray-400 dark:bg-slate-600" />
        <StatCard icon={Users} label={`${t('dashboard_new_conversations')} (${days})`} value={data.newConversations} color="bg-amber-500" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Activity chart */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-5">
          <h2 className="font-semibold text-gray-800 dark:text-slate-200 mb-4">{t('dashboard_messages_per_day')}</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={activityData}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
              <XAxis dataKey="date" tick={{ fontSize: 12, fill: tickColor }} />
              <YAxis tick={{ fontSize: 12, fill: tickColor }} />
              <Tooltip
                contentStyle={isDark ? { backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0' } : undefined}
                labelStyle={isDark ? { color: '#e2e8f0' } : undefined}
              />
              <Bar dataKey="messages" fill="#18D6C8" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* By channel */}
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-5">
          <h2 className="font-semibold text-gray-800 dark:text-slate-200 mb-4">{t('dashboard_by_channel')}</h2>
          <div className="space-y-3">
            {data.conversationsByChannel.length === 0 && (
              <p className="text-gray-400 dark:text-slate-500 text-sm">ยังไม่มีข้อมูล</p>
            )}
            {data.conversationsByChannel.map(ch => {
              const max = Math.max(...data.conversationsByChannel.map(c => c.count), 1);
              return (
                <div key={ch.channelId}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-700 dark:text-slate-300 truncate">{ch.channelName}</span>
                    <span className="font-medium text-gray-900 dark:text-slate-100">{ch.count}</span>
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
        </div>
      </div>
    </div>
  );
}
