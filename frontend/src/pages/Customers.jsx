import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { Contact, Search, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { th } from 'date-fns/locale';
import { STATUS_COLORS } from '../lib/constants';

const STATUS_TABS = [
  { key: '', label: 'ทั้งหมด' },
  { key: 'open', label: 'เปิด' },
  { key: 'pending', label: 'รอ' },
  { key: 'closed', label: 'ปิด' },
];

const STATUS_LABEL = { open: 'เปิด', pending: 'รอ', closed: 'ปิด' };

// Values in minutes. This is the actual filter threshold applied to the list —
// separate from the fixed 10-minute figure shown on the summary card, which is
// just a quick at-a-glance number.
const UNANSWERED_OPTIONS = [
  { value: '', label: 'ไม่กรองตามเวลารอ' },
  { value: '10', label: 'ไม่ตอบ 10 นาทีขึ้นไป' },
  { value: '30', label: 'ไม่ตอบ 30 นาทีขึ้นไป' },
  { value: '60', label: 'ไม่ตอบ 1 ชั่วโมงขึ้นไป' },
  { value: '360', label: 'ไม่ตอบ 6 ชั่วโมงขึ้นไป' },
  { value: '1440', label: 'ไม่ตอบ 1 วันขึ้นไป' },
  { value: '4320', label: 'ไม่ตอบ 3 วันขึ้นไป' },
];

const BLOCKED_OPTIONS = [
  { value: '', label: 'บล็อค: ทั้งหมด' },
  { value: 'false', label: 'ไม่ถูกบล็อค' },
  { value: 'true', label: 'บล็อคเราอยู่' },
];

const SORT_OPTIONS = [
  { value: 'newest', label: 'ข้อความล่าสุดก่อน' },
  { value: 'oldest', label: 'ข้อความเก่าสุดก่อน' },
  { value: 'name', label: 'ชื่อ A-Z' },
];

const LIMIT = 25;

function StatCard({ label, value, cls, onClick, active }) {
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

function Avatar({ name, pictureUrl }) {
  if (pictureUrl) return <img src={pictureUrl} className="w-9 h-9 rounded-full object-cover flex-shrink-0" />;
  return (
    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-aurora-teal to-aurora-purple flex items-center justify-center text-white text-sm font-semibold flex-shrink-0">
      {name?.[0]?.toUpperCase() || '?'}
    </div>
  );
}

export default function Customers() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const [channels, setChannels] = useState([]);
  const [agents, setAgents] = useState([]);
  const [tags, setTags] = useState([]);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [channelId, setChannelId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [tagId, setTagId] = useState('');
  const [blocked, setBlocked] = useState('');
  const [unansweredMinutes, setUnansweredMinutes] = useState('');
  const [sort, setSort] = useState('newest');

  const loadSummary = useCallback(() => {
    axios.get('/api/conversations/summary').then(r => setSummary(r.data)).catch(() => {});
  }, []);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: LIMIT, sort };
      if (search.trim()) params.search = search.trim();
      if (status) params.status = status;
      if (channelId) params.channelId = channelId;
      if (agentId) params.agentId = agentId;
      if (tagId) params.tagId = tagId;
      if (blocked) params.blocked = blocked;
      if (unansweredMinutes) params.unansweredMinutes = unansweredMinutes;
      const { data } = await axios.get('/api/conversations', { params });
      setConversations(data.conversations);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, [page, sort, search, status, channelId, agentId, tagId, blocked, unansweredMinutes]);

  useEffect(() => {
    loadSummary();
    axios.get('/api/channels').then(r => setChannels(r.data)).catch(() => {});
    axios.get('/api/agents').then(r => setAgents(r.data)).catch(() => {});
    axios.get('/api/tags').then(r => setTags(r.data)).catch(() => {});
  }, [loadSummary]);

  useEffect(() => { loadList(); }, [loadList]);

  // Any filter change (other than page itself) should reset back to page 1 —
  // otherwise you can get stranded on page 4 of a filter that only has 2 pages.
  useEffect(() => { setPage(1); }, [search, status, channelId, agentId, tagId, blocked, unansweredMinutes, sort]);

  const selectCls = 'text-sm border border-slate-700 bg-slate-800 text-slate-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-aurora-teal';
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div className="p-6 overflow-y-auto h-full">
      <div className="flex items-center gap-2 mb-1">
        <Contact size={20} className="text-slate-400" />
        <h1 className="text-xl font-bold text-slate-100">ลูกค้า</h1>
      </div>
      <p className="text-sm text-slate-500 mb-5">
        ฐานข้อมูลลูกค้าทั้งหมดในทุกช่องทาง LINE OA — ใช้ตัวกรองด้านล่างเพื่อดูจำนวนลูกค้าตามเงื่อนไขที่ต้องการ เช่น ลูกค้าที่ยังไม่ได้รับการตอบกลับนานเกินไป
      </p>

      {/* Summary cards */}
      <div className="flex flex-wrap gap-3 mb-6">
        <StatCard label="ลูกค้าทั้งหมด" value={summary?.total} cls="border-slate-800 bg-slate-900 text-slate-400" />
        <StatCard
          label="เปิดอยู่" value={summary?.open} cls="border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
          onClick={() => setStatus(s => s === 'open' ? '' : 'open')} active={status === 'open'}
        />
        <StatCard
          label="รอดำเนินการ" value={summary?.pending} cls="border-amber-500/25 bg-amber-500/10 text-amber-300"
          onClick={() => setStatus(s => s === 'pending' ? '' : 'pending')} active={status === 'pending'}
        />
        <StatCard
          label="ปิดแล้ว" value={summary?.closed} cls="border-slate-700 bg-slate-800/60 text-slate-400"
          onClick={() => setStatus(s => s === 'closed' ? '' : 'closed')} active={status === 'closed'}
        />
        <StatCard
          label="บล็อคเราอยู่" value={summary?.blocked} cls="border-rose-500/25 bg-rose-500/10 text-rose-300"
          onClick={() => setBlocked(b => b === 'true' ? '' : 'true')} active={blocked === 'true'}
        />
        <StatCard
          label="ยังไม่ตอบ 10 นาที+" value={summary?.unanswered} cls="border-orange-500/25 bg-orange-500/10 text-orange-300"
          onClick={() => setUnansweredMinutes(m => m === '10' ? '' : '10')} active={unansweredMinutes === '10'}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          <input
            className="w-full border border-slate-700 bg-slate-800 text-slate-100 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-aurora-teal placeholder:text-slate-500"
            placeholder="ค้นหาชื่อหรือ LINE user ID"
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoComplete="off"
            type="search"
            name="customer-search"
          />
        </div>
        <select className={selectCls} value={channelId} onChange={e => setChannelId(e.target.value)}>
          <option value="">ทุกช่องทาง</option>
          {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className={selectCls} value={agentId} onChange={e => setAgentId(e.target.value)}>
          <option value="">พนักงานทั้งหมด</option>
          <option value="unassigned">ยังไม่ได้ assign</option>
          {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select className={selectCls} value={tagId} onChange={e => setTagId(e.target.value)}>
          <option value="">ทุกแท็ก</option>
          {tags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select className={selectCls} value={blocked} onChange={e => setBlocked(e.target.value)}>
          {BLOCKED_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className={selectCls} value={unansweredMinutes} onChange={e => setUnansweredMinutes(e.target.value)}>
          {UNANSWERED_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className={selectCls} value={sort} onChange={e => setSort(e.target.value)}>
          {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      <div className="flex items-center gap-1.5 mb-4">
        {STATUS_TABS.map(tab => (
          <button
            key={tab.key || 'all'}
            onClick={() => setStatus(tab.key)}
            className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${status === tab.key ? 'bg-gradient-to-r from-aurora-teal to-aurora-purple text-white border-transparent' : 'text-slate-300 border-slate-700 hover:border-slate-500'}`}
          >
            {tab.label}
          </button>
        ))}
        <span className="text-sm text-slate-500 ml-2">
          พบ <span className="font-semibold text-slate-200">{total}</span> รายการ
        </span>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
        {loading ? (
          <p className="text-center text-slate-500 text-sm py-10">กำลังโหลด...</p>
        ) : conversations.length === 0 ? (
          <p className="text-center text-slate-500 text-sm py-10">ไม่พบลูกค้าที่ตรงกับตัวกรองที่เลือก</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-slate-500">
                <th className="px-4 py-2.5 font-medium">ลูกค้า</th>
                <th className="px-4 py-2.5 font-medium">ช่องทาง</th>
                <th className="px-4 py-2.5 font-medium">สถานะ</th>
                <th className="px-4 py-2.5 font-medium">แท็ก</th>
                <th className="px-4 py-2.5 font-medium">พนักงาน</th>
                <th className="px-4 py-2.5 font-medium">ข้อความล่าสุด</th>
                <th className="px-4 py-2.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {conversations.map(c => {
                const last = c.messages?.[0];
                const isUnanswered = last?.sender === 'user';
                return (
                  <tr
                    key={c.id}
                    onClick={() => navigate(`/inbox?conv=${c.id}`)}
                    className="border-b border-slate-800/60 hover:bg-slate-800/40 align-top cursor-pointer"
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={c.displayName || c.lineUserId} pictureUrl={c.pictureUrl} />
                        <div className="min-w-0">
                          <p className="text-slate-100 font-medium truncate max-w-[160px]">{c.displayName || c.lineUserId}</p>
                          {c.blocked && <span className="text-[10px] text-rose-400 font-medium">🚫 บล็อคเราอยู่</span>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-400 whitespace-nowrap">{c.channel?.name}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[c.status] || ''}`}>
                        {STATUS_LABEL[c.status] || c.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1 max-w-[140px]">
                        {c.tags?.slice(0, 2).map(({ tag }) => (
                          <span key={tag.id} className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ backgroundColor: `${tag.color}1a`, color: tag.color }}>
                            {tag.name}
                          </span>
                        ))}
                        {c.tags?.length > 2 && <span className="text-[10px] text-slate-500">+{c.tags.length - 2}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-300 whitespace-nowrap">
                      {c.agent?.name || <span className="text-slate-500">ยังไม่ได้ assign</span>}
                    </td>
                    <td className="px-4 py-2.5 text-slate-400 max-w-xs">
                      {last ? (
                        <>
                          <p className="line-clamp-1 text-slate-300">{last.type === 'text' ? last.content : `[${last.type}]`}</p>
                          <p className={`text-[11px] mt-0.5 ${isUnanswered ? 'text-amber-400 font-medium' : 'text-slate-500'}`}>
                            {isUnanswered ? 'รอลูกค้า' : 'ตอบแล้ว'} · {formatDistanceToNow(new Date(last.createdAt), { locale: th, addSuffix: true })}
                          </p>
                        </>
                      ) : <span className="text-slate-600">ยังไม่มีข้อความ</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <button
                        onClick={(e) => { e.stopPropagation(); navigate(`/inbox?conv=${c.id}`); }}
                        title="ไปที่แชท"
                        className="text-slate-500 hover:text-aurora-teal"
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

      {/* Pagination */}
      {total > LIMIT && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-slate-500">
            หน้า {page} จาก {totalPages} ({total} รายการ)
          </p>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="flex items-center gap-1 text-sm text-slate-300 border border-slate-700 rounded-lg px-2.5 py-1.5 hover:border-slate-500 disabled:opacity-30 disabled:hover:border-slate-700 transition-colors"
            >
              <ChevronLeft size={14} /> ก่อนหน้า
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="flex items-center gap-1 text-sm text-slate-300 border border-slate-700 rounded-lg px-2.5 py-1.5 hover:border-slate-500 disabled:opacity-30 disabled:hover:border-slate-700 transition-colors"
            >
              ถัดไป <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
