import { useState, useEffect } from 'react';
import axios from 'axios';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { MessageSquare, Users, CheckCircle, Clock } from 'lucide-react';

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div className="bg-white rounded-xl p-5 border flex items-center gap-4">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${color}`}>
        <Icon size={22} className="text-white" />
      </div>
      <div>
        <p className="text-gray-500 text-sm">{label}</p>
        <p className="text-2xl font-bold text-gray-900">{value ?? '—'}</p>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [days, setDays] = useState(7);

  useEffect(() => {
    axios.get('/api/analytics/summary', { params: { days } }).then(r => setData(r.data));
  }, [days]);

  if (!data) return <div className="flex-1 flex items-center justify-center text-gray-400">กำลังโหลด...</div>;

  const activityData = data.recentActivity.map(row => ({
    date: new Date(row.date).toLocaleDateString('th', { month: 'short', day: 'numeric' }),
    messages: Number(row.count),
  }));

  return (
    <div className="p-6 overflow-y-auto h-full">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>
        <select
          className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none"
          value={days}
          onChange={e => setDays(Number(e.target.value))}
        >
          <option value={7}>7 วัน</option>
          <option value={14}>14 วัน</option>
          <option value={30}>30 วัน</option>
        </select>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard icon={MessageSquare} label="การสนทนาทั้งหมด" value={data.totalConversations} color="bg-indigo-500" />
        <StatCard icon={Clock} label="กำลังเปิด" value={data.openConversations} color="bg-green-500" />
        <StatCard icon={CheckCircle} label="ปิดแล้ว" value={data.closedConversations} color="bg-gray-400" />
        <StatCard icon={Users} label={`การสนทนาใหม่ (${days}วัน)`} value={data.newConversations} color="bg-yellow-500" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Activity chart */}
        <div className="lg:col-span-2 bg-white rounded-xl border p-5">
          <h2 className="font-semibold text-gray-800 mb-4">ข้อความต่อวัน</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={activityData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="messages" fill="#22c55e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* By channel */}
        <div className="bg-white rounded-xl border p-5">
          <h2 className="font-semibold text-gray-800 mb-4">การสนทนาตาม OA</h2>
          <div className="space-y-3">
            {data.conversationsByChannel.length === 0 && (
              <p className="text-gray-400 text-sm">ยังไม่มีข้อมูล</p>
            )}
            {data.conversationsByChannel.map(ch => {
              const max = Math.max(...data.conversationsByChannel.map(c => c.count), 1);
              return (
                <div key={ch.channelId}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-700 truncate">{ch.channelName}</span>
                    <span className="font-medium text-gray-900">{ch.count}</span>
                  </div>
                  <div className="bg-gray-100 rounded-full h-1.5">
                    <div
                      className="bg-green-500 h-1.5 rounded-full"
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
