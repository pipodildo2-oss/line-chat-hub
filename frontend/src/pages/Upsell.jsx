import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { useNavigate, useParams } from 'react-router-dom';
import { Wallet, X, ExternalLink, Check, Ban, Pencil, TrendingUp, Trophy, FileText, Users } from 'lucide-react';
import { format, startOfMonth, endOfMonth, subMonths, subDays } from 'date-fns';
import { th } from 'date-fns/locale';
import { useSocket } from '../contexts/SocketContext';

function toISODate(d) { return format(d, 'yyyy-MM-dd'); }

// Same horizontal quick-pick pattern as Report.jsx's AgentConductPage, plus
// an explicit "ทั้งหมด" (all-time) option — [null, null] sends no from/to at
// all, so the backend applies no date filter.
const DATE_PRESETS = [
  { key: 'today', label: 'วันนี้', range: () => { const d = toISODate(new Date()); return [d, d]; } },
  { key: 'thisMonth', label: 'เดือนนี้', range: () => [toISODate(startOfMonth(new Date())), toISODate(new Date())] },
  { key: 'lastMonth', label: 'เดือนที่แล้ว', range: () => {
    const d = subMonths(new Date(), 1);
    return [toISODate(startOfMonth(d)), toISODate(endOfMonth(d))];
  } },
  { key: 'all', label: 'ทั้งหมด', range: () => [null, null] },
];

function DateRangeFilter({ preset, from, to, onPreset, onCustom }) {
  return (
    <div className="flex flex-wrap items-center gap-3 mb-4">
      <div className="flex items-center gap-1.5 flex-wrap">
        {DATE_PRESETS.map(p => (
          <button
            key={p.key}
            onClick={() => onPreset(p)}
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
          value={from || ''}
          max={to || undefined}
          onChange={e => onCustom('from', e.target.value)}
        />
        <span>ถึง</span>
        <input
          type="date"
          className="border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none"
          value={to || ''}
          min={from || undefined}
          onChange={e => onCustom('to', e.target.value)}
        />
      </div>
    </div>
  );
}

function Avatar({ name }) {
  return (
    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-aurora-teal to-aurora-purple flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
      {name?.[0]?.toUpperCase() || '?'}
    </div>
  );
}

const STATUS_BADGE = {
  pending: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  approved: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  rejected: 'bg-rose-500/15 text-rose-500 dark:text-rose-400',
};
const STATUS_LABEL = { pending: 'รอตรวจ', approved: 'ผ่าน', rejected: 'ไม่ผ่าน' };

// Customer-sent images need our Channel Access Token to fetch from LINE, so
// they're served through an authenticated proxy (/api/messages/content/:id)
// and can't be linked directly via <img src> — same blob-fetch pattern as
// ImageMessage in Inbox.jsx. Agent-sent images (quick-reply/composer) have no
// lineMessageId and are a plain, unauthenticated /uploads/... link instead.
function CustomerImagePreview({ messageId }) {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl;
    let cancelled = false;
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

  if (failed) return <div className="w-16 h-16 rounded-lg bg-gray-100 dark:bg-slate-800 flex items-center justify-center text-[10px] text-gray-400 dark:text-slate-500">[รูป]</div>;
  if (!src) return <div className="w-16 h-16 rounded-lg bg-gray-100 dark:bg-slate-800 animate-pulse" />;
  return <img src={src} alt="" className="w-16 h-16 rounded-lg object-cover border border-gray-200 dark:border-slate-700" />;
}

function AgentImagePreview({ msg }) {
  let url = null;
  try { url = msg.metadata ? JSON.parse(msg.metadata).url : null; } catch { /* ignore */ }
  return url ? (
    <img src={url} alt="" className="w-16 h-16 rounded-lg object-cover border border-gray-200 dark:border-slate-700" />
  ) : (
    <div className="w-16 h-16 rounded-lg bg-gray-100 dark:bg-slate-800 flex items-center justify-center text-[10px] text-gray-400 dark:text-slate-500">[รูป]</div>
  );
}

function SubmissionItemPreview({ item }) {
  const msg = item.message;
  if (!msg) return null;
  if (msg.type === 'image') {
    return msg.lineMessageId ? <CustomerImagePreview messageId={msg.lineMessageId} /> : <AgentImagePreview msg={msg} />;
  }
  return (
    <p className="text-sm text-gray-700 dark:text-slate-300 line-clamp-3 whitespace-pre-wrap break-words">
      {msg.content}
    </p>
  );
}

function SubmissionRow({ submission, onReview, navigate }) {
  const [amount, setAmount] = useState(submission.amount ?? '');
  const [saving, setSaving] = useState(false);
  // Lets a reviewer reopen the amount+ผ่าน/ไม่ผ่าน form after already
  // approving a submission, in case they typed the wrong figure — without
  // this there was no way to correct a mis-scored amount after the fact.
  const [editing, setEditing] = useState(false);
  // Backend now returns items sorted oldest-message-first (see
  // GET /api/upsells/agents/:agentId), so items[0] is always the topmost
  // claimed message in the actual chat — used both for the customer/channel
  // header below and as the "ไปที่แชท" scroll target.
  const topItem = submission.items[0];
  const conv = topItem?.message?.conversation;

  async function act(status) {
    setSaving(true);
    try {
      await onReview(submission.id, status, amount);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  const showForm = submission.status === 'pending' || editing;

  return (
    <div className="border border-gray-100 dark:border-slate-800 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-800 dark:text-slate-200 truncate">
            {conv?.displayName || conv?.lineUserId || '—'}
            <span className="text-gray-400 dark:text-slate-500 font-normal"> · {conv?.channel?.name}</span>
          </p>
          <p className="text-[11px] text-gray-400 dark:text-slate-500">
            {format(new Date(submission.createdAt), 'd MMM yy HH:mm', { locale: th })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[submission.status]}`}>
            {STATUS_LABEL[submission.status]}
          </span>
          {conv && topItem && (
            <button
              onClick={() => navigate(`/inbox?conv=${conv.id}&msg=${topItem.message.id}`)}
              title="ไปที่แชท"
              className="text-gray-400 dark:text-slate-500 hover:text-aurora-tealDeep dark:hover:text-aurora-teal"
            >
              <ExternalLink size={15} />
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {submission.items.map(item => <SubmissionItemPreview key={item.id} item={item} />)}
      </div>

      {showForm ? (
        <div className="flex items-center gap-2 pt-1 flex-wrap">
          <div className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-slate-400">
            <span>บาท</span>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="จำนวนเงิน"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              className="w-28 border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none"
            />
          </div>
          <button
            disabled={saving}
            onClick={() => act('approved')}
            className="flex items-center gap-1 text-sm px-3 py-1.5 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50"
          >
            <Check size={14} /> ผ่าน
          </button>
          <button
            disabled={saving}
            onClick={() => act('rejected')}
            className="flex items-center gap-1 text-sm px-3 py-1.5 rounded-lg bg-rose-500 text-white hover:bg-rose-600 disabled:opacity-50"
          >
            <Ban size={14} /> ไม่ผ่าน
          </button>
          {editing && (
            <button
              disabled={saving}
              onClick={() => { setEditing(false); setAmount(submission.amount ?? ''); }}
              className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800 disabled:opacity-50"
            >
              ยกเลิก
            </button>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
          <div className="text-sm text-gray-500 dark:text-slate-400">
            {submission.status === 'approved' && (
              <span className="font-medium text-gray-800 dark:text-slate-200">
                {submission.amount != null ? `${submission.amount.toLocaleString()} บาท` : '—'}
              </span>
            )}
            {submission.reviewedBy && <span> · ตรวจโดย {submission.reviewedBy.name}</span>}
            {submission.reviewedAt && <span> · {format(new Date(submission.reviewedAt), 'd MMM yy HH:mm', { locale: th })}</span>}
          </div>
          {submission.status === 'approved' && (
            <button
              onClick={() => { setAmount(submission.amount ?? ''); setEditing(true); }}
              className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800"
            >
              <Pencil size={12} /> แก้ไขยอด
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function UpsellAgentModal({ agentId, onClose, navigate, onChanged }) {
  const [data, setData] = useState(null);

  function load() {
    axios.get(`/api/upsells/agents/${agentId}`).then(r => setData(r.data));
  }
  useEffect(() => { load(); }, [agentId]);

  async function handleReview(submissionId, status, amount) {
    await axios.patch(`/api/upsells/${submissionId}`, { status, amount: amount === '' ? null : amount });
    load();
    onChanged?.();
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-800">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar name={data?.agent?.name} />
            <div className="min-w-0">
              <p className="font-semibold text-gray-900 dark:text-slate-100 truncate">{data?.agent?.name || 'กำลังโหลด...'}</p>
              <p className="text-xs text-gray-400 dark:text-slate-500 truncate">{data?.agent?.email}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 flex-shrink-0">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-3">
          {!data ? (
            <p className="text-center text-gray-400 dark:text-slate-500 text-sm py-8">กำลังโหลด...</p>
          ) : data.submissions.length === 0 ? (
            <p className="text-center text-gray-400 dark:text-slate-500 text-sm py-8">ยังไม่มีรายการอัพเซลล์</p>
          ) : (
            data.submissions.map(s => <SubmissionRow key={s.id} submission={s} onReview={handleReview} navigate={navigate} />)
          )}
        </div>
      </div>
    </div>
  );
}

// "ตรวจสอบ" — the reviewer confirms upsell work agents submitted from Inbox:
// per-agent list (with pending/approved/rejected counts) → drill into an
// agent → approve/reject each submission with a ผ่าน/ไม่ผ่าน + amount.
function UpsellReviewPage() {
  const [agents, setAgents] = useState(null);
  const [selectedAgentId, setSelectedAgentId] = useState(null);
  const { socket } = useSocket();
  const navigate = useNavigate();

  function load() {
    axios.get('/api/upsells/agents').then(r => setAgents(r.data.agents));
  }
  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!socket) return;
    socket.on('upsell_reviewed', load);
    socket.on('upsell_claimed', load);
    return () => {
      socket.off('upsell_reviewed', load);
      socket.off('upsell_claimed', load);
    };
  }, [socket]);

  return (
    <div className="p-6 overflow-y-auto h-full">
      <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100 mb-4 flex items-center gap-2">
        <Wallet size={20} className="text-aurora-tealDeep dark:text-aurora-teal" />
        ตรวจสอบอัพเซลล์
      </h1>

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 overflow-hidden">
        {!agents ? (
          <p className="text-center text-gray-400 dark:text-slate-500 text-sm py-10">กำลังโหลด...</p>
        ) : agents.length === 0 ? (
          <p className="text-center text-gray-400 dark:text-slate-500 text-sm py-10">ยังไม่มีพนักงานส่งรายการอัพเซลล์เข้ามา</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-slate-800 text-left text-gray-500 dark:text-slate-400">
                <th className="px-4 py-2.5 font-medium">พนักงาน</th>
                <th className="px-4 py-2.5 font-medium">ส่งมาแล้ว</th>
                <th className="px-4 py-2.5 font-medium">รอตรวจ</th>
                <th className="px-4 py-2.5 font-medium">ผ่าน</th>
                <th className="px-4 py-2.5 font-medium">ไม่ผ่าน</th>
                <th className="px-4 py-2.5 font-medium">ยอดที่ผ่านแล้ว</th>
              </tr>
            </thead>
            <tbody>
              {agents.map(a => (
                <tr
                  key={a.id}
                  onClick={() => setSelectedAgentId(a.id)}
                  className="border-b border-gray-50 dark:border-slate-800/60 hover:bg-gray-50 dark:hover:bg-slate-800/40 cursor-pointer"
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={a.name} />
                      <div className="min-w-0">
                        <p className="text-gray-800 dark:text-slate-200 truncate">{a.name}</p>
                        <p className="text-[11px] text-gray-400 dark:text-slate-500 truncate">{a.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 dark:text-slate-300">{a.total}</td>
                  <td className="px-4 py-2.5">
                    {a.pending > 0 ? (
                      <span className="text-amber-600 dark:text-amber-400 font-medium">{a.pending}</span>
                    ) : (
                      <span className="text-gray-400 dark:text-slate-500">0</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-emerald-600 dark:text-emerald-400">{a.approved}</td>
                  <td className="px-4 py-2.5 text-rose-500 dark:text-rose-400">{a.rejected}</td>
                  <td className="px-4 py-2.5 text-gray-800 dark:text-slate-200 font-medium">
                    {a.approvedAmount ? `${a.approvedAmount.toLocaleString()} บาท` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selectedAgentId && (
        <UpsellAgentModal
          agentId={selectedAgentId}
          onClose={() => setSelectedAgentId(null)}
          navigate={navigate}
          onChanged={load}
        />
      )}
    </div>
  );
}

const RANK_STYLE = [
  'text-amber-500', // 1st — gold
  'text-slate-400', // 2nd — silver
  'text-amber-700 dark:text-amber-600', // 3rd — bronze
];

// "คะแนน" — a score leaderboard pulled from the same per-agent data the
// ตรวจสอบ tab already reviews: 1 ผ่าน = 1 รายการ, plus the running total of
// approved upsell amounts — grouped by team so a supervisor can see which
// team is hitting target, not just individuals. Read-only — no review
// actions here, that's ตรวจสอบ's job; this is just the scoreboard.
function UpsellScorePage() {
  const [preset, setPreset] = useState('thisMonth');
  const [[from, to], setDateRange] = useState(DATE_PRESETS[1].range());
  const [agents, setAgents] = useState(null);
  const { socket } = useSocket();

  function pickPreset(p) { setPreset(p.key); setDateRange(p.range()); }
  function pickCustom(which, value) { setPreset(null); setDateRange(prev => which === 'from' ? [value, prev[1]] : [prev[0], value]); }

  function load() {
    axios.get('/api/upsells/agents', { params: { from: from || undefined, to: to || undefined } }).then(r => setAgents(r.data.agents));
  }
  useEffect(() => { load(); }, [from, to]);

  useEffect(() => {
    if (!socket) return;
    socket.on('upsell_reviewed', load);
    return () => socket.off('upsell_reviewed', load);
  }, [socket, from, to]);

  // Overall (org-wide) rank, computed once across every agent regardless of
  // team, so the medal/rank number shown next to a name inside its team
  // section still reflects how they stack up company-wide.
  const overallRanked = useMemo(() => (
    agents ? [...agents].filter(a => a.approved > 0).sort((a, b) => b.approvedAmount - a.approvedAmount || b.approved - a.approved) : []
  ), [agents]);
  const rankById = useMemo(() => Object.fromEntries(overallRanked.map((a, i) => [a.id, i])), [overallRanked]);

  const teams = useMemo(() => {
    if (!overallRanked.length) return [];
    const byTeam = {};
    for (const a of overallRanked) {
      const key = a.categoryId || '__none__';
      (byTeam[key] ||= { id: a.categoryId, name: a.categoryName || 'ไม่มีทีม', agents: [] }).agents.push(a);
    }
    const groups = Object.values(byTeam).map(g => ({
      ...g,
      approved: g.agents.reduce((s, a) => s + a.approved, 0),
      approvedAmount: g.agents.reduce((s, a) => s + a.approvedAmount, 0),
    }));
    groups.sort((x, y) => y.approvedAmount - x.approvedAmount);
    return groups;
  }, [overallRanked]);

  const totalApproved = overallRanked.reduce((s, a) => s + a.approved, 0);
  const totalAmount = overallRanked.reduce((s, a) => s + a.approvedAmount, 0);

  return (
    <div className="p-6 overflow-y-auto h-full">
      <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100 mb-4 flex items-center gap-2">
        <TrendingUp size={20} className="text-aurora-tealDeep dark:text-aurora-teal" />
        คะแนนอัพเซลล์
      </h1>

      <DateRangeFilter preset={preset} from={from} to={to} onPreset={pickPreset} onCustom={pickCustom} />

      <div className="grid grid-cols-2 gap-4 mb-5 max-w-lg">
        <div className="bg-white dark:bg-slate-900 rounded-xl p-4 border border-gray-200 dark:border-slate-800">
          <p className="text-gray-500 dark:text-slate-400 text-sm">รายการที่ผ่านทั้งหมด</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-slate-100">{totalApproved}</p>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-xl p-4 border border-gray-200 dark:border-slate-800">
          <p className="text-gray-500 dark:text-slate-400 text-sm">ยอดอัพเซลล์รวม</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-slate-100">{totalAmount.toLocaleString()} บาท</p>
        </div>
      </div>

      {!agents ? (
        <p className="text-center text-gray-400 dark:text-slate-500 text-sm py-10">กำลังโหลด...</p>
      ) : teams.length === 0 ? (
        <p className="text-center text-gray-400 dark:text-slate-500 text-sm py-10">ยังไม่มีรายการอัพเซลล์ที่ผ่านการตรวจสอบในช่วงนี้</p>
      ) : (
        <>
          {/* Per-team subtotals up top — "ทีมไหนทำเป้าได้เท่าไหร่" at a glance
              before drilling into the per-agent breakdown below. */}
          <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
            {teams.map(t => (
              <div key={t.id || 'none'} className="bg-gradient-to-br from-aurora-teal/10 to-aurora-purple/10 dark:from-aurora-teal/15 dark:to-aurora-purple/15 rounded-xl p-4 border border-aurora-teal/20">
                <p className="text-xs font-semibold text-aurora-tealDeep dark:text-aurora-teal flex items-center gap-1.5 mb-1.5">
                  <Users size={13} /> {t.name}
                </p>
                <p className="text-lg font-bold text-gray-900 dark:text-slate-100">{t.approvedAmount.toLocaleString()} บาท</p>
                <p className="text-xs text-gray-500 dark:text-slate-400">{t.approved} รายการ · {t.agents.length} คน</p>
              </div>
            ))}
          </div>

          {/* One boxed table per team, matching the "พนักงาน" report page's
              table-frame look (CONDUCT_THEAD-style header + plain rows) —
              two side by side on a wide screen when there are ~2 teams,
              wrapping to one column on narrower ones. */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {teams.map(team => (
              <div key={team.id || 'none'} className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 overflow-hidden">
                <div className="px-4 py-2.5 bg-gray-50 dark:bg-slate-800/50 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-800 dark:text-slate-200 flex items-center gap-1.5">
                    <Users size={14} /> {team.name}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-slate-400">{team.approved} รายการ · {team.approvedAmount.toLocaleString()} บาท</p>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-slate-800 text-left text-gray-500 dark:text-slate-400">
                      <th className="px-4 py-2.5 font-medium w-10 text-center">อันดับ</th>
                      <th className="px-4 py-2.5 font-medium">ชื่อ</th>
                      <th className="px-4 py-2.5 font-medium">รายการ</th>
                      <th className="px-4 py-2.5 font-medium text-right">ยอดเงิน</th>
                    </tr>
                  </thead>
                  <tbody>
                    {team.agents.map(a => {
                      const rank = rankById[a.id];
                      return (
                        <tr key={a.id} className="border-b border-gray-50 dark:border-slate-800/60 last:border-0 hover:bg-gray-50 dark:hover:bg-slate-800/40">
                          <td className="px-4 py-2.5 w-10 text-center">
                            {rank < 3 ? <Trophy size={15} className={`inline ${RANK_STYLE[rank]}`} /> : <span className="text-gray-400 dark:text-slate-500">{rank + 1}</span>}
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2.5">
                              <Avatar name={a.name} />
                              <p className="text-gray-800 dark:text-slate-200 truncate">{a.name}</p>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-gray-600 dark:text-slate-300 whitespace-nowrap">{a.approved} รายการ</td>
                          <td className="px-4 py-2.5 text-right text-gray-900 dark:text-slate-100 font-semibold whitespace-nowrap">
                            {a.approvedAmount.toLocaleString()} บาท
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const REPORT_STATUS_TABS = [
  { key: '', label: 'ทั้งหมด' },
  { key: 'pending', label: 'รอตรวจ' },
  { key: 'approved', label: 'ผ่าน' },
  { key: 'rejected', label: 'ไม่ผ่าน' },
];

// "รายงาน" — the detailed, filterable log behind the คะแนน rollup: every
// submission across every agent/team, one row each, for record-keeping and
// spot-checking rather than scoring at a glance.
function UpsellReportPage() {
  const [preset, setPreset] = useState('thisMonth');
  const [[from, to], setDateRange] = useState(DATE_PRESETS[1].range());
  const [status, setStatus] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [teams, setTeams] = useState([]);
  const [rows, setRows] = useState(null);
  const { socket } = useSocket();
  const navigate = useNavigate();

  useEffect(() => {
    axios.get('/api/agent-categories').then(r => setTeams(r.data)).catch(() => {});
  }, []);

  function pickPreset(p) { setPreset(p.key); setDateRange(p.range()); }
  function pickCustom(which, value) { setPreset(null); setDateRange(prev => which === 'from' ? [value, prev[1]] : [prev[0], value]); }

  function load() {
    axios.get('/api/upsells', {
      params: { from: from || undefined, to: to || undefined, status: status || undefined, agentCategoryId: teamFilter || undefined },
    }).then(r => setRows(r.data.submissions));
  }
  useEffect(() => { load(); }, [from, to, status, teamFilter]);

  useEffect(() => {
    if (!socket) return;
    socket.on('upsell_reviewed', load);
    socket.on('upsell_claimed', load);
    return () => {
      socket.off('upsell_reviewed', load);
      socket.off('upsell_claimed', load);
    };
  }, [socket, from, to, status, teamFilter]);

  return (
    <div className="p-6 overflow-y-auto h-full">
      <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100 mb-4 flex items-center gap-2">
        <FileText size={20} className="text-aurora-tealDeep dark:text-aurora-teal" />
        รายงานอัพเซลล์
      </h1>

      <DateRangeFilter preset={preset} from={from} to={to} onPreset={pickPreset} onCustom={pickCustom} />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-1 bg-gray-100 dark:bg-slate-800 rounded-lg p-1">
          {REPORT_STATUS_TABS.map(s => (
            <button
              key={s.key}
              onClick={() => setStatus(s.key)}
              className={`text-sm px-3 py-1.5 rounded-md transition-colors ${status === s.key ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 shadow-sm' : 'text-gray-500 dark:text-slate-400'}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <select
          className="text-sm border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 rounded-lg px-2 py-1.5 focus:outline-none"
          value={teamFilter}
          onChange={e => setTeamFilter(e.target.value)}
        >
          <option value="">ทุกทีม</option>
          <option value="none">ไม่มีทีม</option>
          {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {rows && <span className="text-sm text-gray-500 dark:text-slate-400">พบ <span className="font-semibold text-gray-800 dark:text-slate-200">{rows.length}</span> รายการ</span>}
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 overflow-hidden overflow-x-auto">
        {!rows ? (
          <p className="text-center text-gray-400 dark:text-slate-500 text-sm py-10">กำลังโหลด...</p>
        ) : rows.length === 0 ? (
          <p className="text-center text-gray-400 dark:text-slate-500 text-sm py-10">ไม่พบรายการในช่วงที่เลือก</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-slate-800 text-left text-gray-500 dark:text-slate-400">
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">วันที่</th>
                <th className="px-4 py-2.5 font-medium">พนักงาน</th>
                <th className="px-4 py-2.5 font-medium">ทีม</th>
                <th className="px-4 py-2.5 font-medium">ลูกค้า</th>
                <th className="px-4 py-2.5 font-medium">รายการ</th>
                <th className="px-4 py-2.5 font-medium">ยอดเงิน</th>
                <th className="px-4 py-2.5 font-medium">สถานะ</th>
                <th className="px-4 py-2.5 font-medium">ตรวจโดย</th>
                <th className="px-4 py-2.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-b border-gray-50 dark:border-slate-800/60 hover:bg-gray-50 dark:hover:bg-slate-800/40">
                  <td className="px-4 py-2.5 text-gray-500 dark:text-slate-400 whitespace-nowrap">
                    {format(new Date(r.createdAt), 'd MMM yy HH:mm', { locale: th })}
                  </td>
                  <td className="px-4 py-2.5 text-gray-800 dark:text-slate-200 whitespace-nowrap">{r.agent.name}</td>
                  <td className="px-4 py-2.5 text-gray-500 dark:text-slate-400 whitespace-nowrap">{r.agent.categoryName || '—'}</td>
                  <td className="px-4 py-2.5 text-gray-600 dark:text-slate-300 max-w-[160px] truncate">
                    {r.conversation?.displayName || r.conversation?.lineUserId || '—'}
                    {r.conversation?.channel?.name && <span className="text-gray-400 dark:text-slate-500"> · {r.conversation.channel.name}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 dark:text-slate-300 whitespace-nowrap">{r.itemCount} รายการ</td>
                  <td className="px-4 py-2.5 text-gray-900 dark:text-slate-100 font-medium whitespace-nowrap">
                    {r.status === 'approved' && r.amount != null ? `${r.amount.toLocaleString()} บาท` : '—'}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-500 dark:text-slate-400 whitespace-nowrap">{r.reviewedBy?.name || '—'}</td>
                  <td className="px-4 py-2.5">
                    {r.conversation && r.topMessageId && (
                      <button
                        onClick={() => navigate(`/inbox?conv=${r.conversation.id}&msg=${r.topMessageId}`)}
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

export default function Upsell() {
  const { tab } = useParams();
  if (tab === 'score') return <UpsellScorePage />;
  if (tab === 'report') return <UpsellReportPage />;
  return <UpsellReviewPage />;
}
