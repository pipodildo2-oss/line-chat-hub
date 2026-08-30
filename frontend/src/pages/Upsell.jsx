import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Wallet, X, ExternalLink, Check, Ban, Pencil, TrendingUp, Trophy, FileText, Users, CheckCircle2, ChevronUp, ChevronDown, ChevronsUpDown, Trash2 } from 'lucide-react';
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

// Same backdrop+centered-image pattern as Inbox.jsx's own Lightbox — kept as
// a separate local copy since that one isn't exported, but intentionally
// identical so the viewing experience matches across the app.
function Lightbox({ src, onClose }) {
  if (!src) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-6" onClick={onClose}>
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-white/80 hover:text-white bg-white/10 hover:bg-white/20 rounded-full w-9 h-9 flex items-center justify-center"
      >
        <X size={20} />
      </button>
      <img src={src} alt="" className="max-w-full max-h-full rounded-lg object-contain" onClick={e => e.stopPropagation()} />
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
function CustomerImagePreview({ messageId, onImageClick }) {
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

  if (failed) return <div className="w-20 h-20 rounded-lg bg-gray-100 dark:bg-slate-800 flex items-center justify-center text-[10px] text-gray-400 dark:text-slate-500">[รูป]</div>;
  if (!src) return <div className="w-20 h-20 rounded-lg bg-gray-100 dark:bg-slate-800 animate-pulse" />;
  return (
    <img
      src={src}
      alt=""
      onClick={() => onImageClick?.(src)}
      className="w-20 h-20 rounded-lg object-cover border border-gray-200 dark:border-slate-700 cursor-zoom-in hover:opacity-90 transition-opacity"
    />
  );
}

function AgentImagePreview({ msg, onImageClick }) {
  let url = null;
  try { url = msg.metadata ? JSON.parse(msg.metadata).url : null; } catch { /* ignore */ }
  return url ? (
    <img
      src={url}
      alt=""
      onClick={() => onImageClick?.(url)}
      className="w-20 h-20 rounded-lg object-cover border border-gray-200 dark:border-slate-700 cursor-zoom-in hover:opacity-90 transition-opacity"
    />
  ) : (
    <div className="w-20 h-20 rounded-lg bg-gray-100 dark:bg-slate-800 flex items-center justify-center text-[10px] text-gray-400 dark:text-slate-500">[รูป]</div>
  );
}

// Text and image items are laid out separately (images as a thumbnail strip,
// text as stacked bubbles) instead of one wrapped row mixing both — much
// easier to scan when a submission bundles several claimed messages together.
function SubmissionItems({ items, onImageClick }) {
  const imageItems = items.filter(i => i.message?.type === 'image');
  const textItems = items.filter(i => i.message && i.message.type !== 'image');

  return (
    <div className="space-y-2">
      {textItems.length > 0 && (
        <div className="space-y-1.5">
          {textItems.map(item => (
            <p
              key={item.id}
              className="text-sm text-gray-700 dark:text-slate-300 whitespace-pre-wrap break-words bg-gray-50 dark:bg-slate-800/60 rounded-lg px-3 py-2"
            >
              {item.message.content}
            </p>
          ))}
        </div>
      )}
      {imageItems.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {imageItems.map(item => (
            item.message.lineMessageId
              ? <CustomerImagePreview key={item.id} messageId={item.message.lineMessageId} onImageClick={onImageClick} />
              : <AgentImagePreview key={item.id} msg={item.message} onImageClick={onImageClick} />
          ))}
        </div>
      )}
    </div>
  );
}

function SubmissionRow({ submission, onReview, onDelete, navigate, onImageClick }) {
  const [amount, setAmount] = useState(submission.amount ?? '');
  const [saving, setSaving] = useState(false);
  // Lets a reviewer reopen the amount+ผ่าน/ไม่ผ่าน form after already
  // reviewing a submission, in case they got the amount or the ผ่าน/ไม่ผ่าน
  // call wrong — without this there was no way to correct it after the fact.
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

  async function handleDelete() {
    if (!confirm('ลบรายการอัพเซลล์นี้? ข้อความที่เลือกไว้จะกลับไปให้เลือกใหม่ได้อีกครั้ง')) return;
    setSaving(true);
    try {
      await onDelete(submission.id);
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
          <button
            onClick={handleDelete}
            disabled={saving}
            title="ลบรายการ"
            className="text-gray-400 dark:text-slate-500 hover:text-rose-500 disabled:opacity-50"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      <SubmissionItems items={submission.items} onImageClick={onImageClick} />

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
          {(submission.status === 'approved' || submission.status === 'rejected') && (
            <button
              onClick={() => { setAmount(submission.amount ?? ''); setEditing(true); }}
              className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800"
            >
              <Pencil size={12} /> แก้ไข
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Shared by both the ตรวจสอบ per-agent modal and the รายงาน detail table —
// same four tabs, same labels, same "empty key = no filter" convention.
const STATUS_TABS = [
  { key: '', label: 'ทั้งหมด' },
  { key: 'pending', label: 'รอตรวจ' },
  { key: 'approved', label: 'ผ่าน' },
  { key: 'rejected', label: 'ไม่ผ่าน' },
];

// agentSummary (optional) is that agent's row from the ตรวจสอบ list
// (total/pending/approved/rejected already loaded there) — passed down just
// so each tab can show its count without a second round-trip.
function UpsellAgentModal({ agentId, agentSummary, onClose, navigate, onChanged }) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('');
  const [lightboxSrc, setLightboxSrc] = useState(null);

  function load() {
    axios.get(`/api/upsells/agents/${agentId}`, { params: { status: status || undefined } }).then(r => setData(r.data));
  }
  useEffect(() => { load(); }, [agentId, status]);

  async function handleReview(submissionId, status, amount) {
    await axios.patch(`/api/upsells/${submissionId}`, { status, amount: amount === '' ? null : amount });
    load();
    onChanged?.();
  }

  async function handleDelete(submissionId) {
    await axios.delete(`/api/upsells/${submissionId}`);
    load();
    onChanged?.();
  }

  return (
    <>
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

        <div className="flex items-center gap-1 bg-gray-100 dark:bg-slate-800 rounded-lg p-1 mx-5 mt-4">
          {STATUS_TABS.map(s => {
            const count = agentSummary ? (s.key === '' ? agentSummary.total : agentSummary[s.key]) : null;
            return (
              <button
                key={s.key}
                onClick={() => setStatus(s.key)}
                className={`flex-1 text-sm px-3 py-1.5 rounded-md transition-colors ${status === s.key ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 shadow-sm' : 'text-gray-500 dark:text-slate-400'}`}
              >
                {s.label}{count != null && ` (${count})`}
              </button>
            );
          })}
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-3">
          {!data ? (
            <p className="text-center text-gray-400 dark:text-slate-500 text-sm py-8">กำลังโหลด...</p>
          ) : data.submissions.length === 0 ? (
            <p className="text-center text-gray-400 dark:text-slate-500 text-sm py-8">
              {status ? `ไม่มีรายการที่${STATUS_TABS.find(s => s.key === status)?.label}` : 'ยังไม่มีรายการอัพเซลล์'}
            </p>
          ) : (
            data.submissions.map(s => (
              <SubmissionRow key={s.id} submission={s} onReview={handleReview} onDelete={handleDelete} navigate={navigate} onImageClick={setLightboxSrc} />
            ))
          )}
        </div>
      </div>
    </div>
    <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </>
  );
}

// "ตรวจสอบ" — the reviewer confirms upsell work agents submitted from Inbox:
// per-agent list (with pending/approved/rejected counts) → drill into an
// agent → approve/reject each submission with a ผ่าน/ไม่ผ่าน + amount.
function UpsellReviewPage() {
  const [agents, setAgents] = useState(null);
  // Kept in the URL (not local state) so it survives a round trip to the
  // chat and back: "ไปที่แชท" pushes /inbox onto history, and browser back
  // then lands on this exact /upsell/review?agent=<id> URL again, reopening
  // the same agent's modal instead of dropping back to the bare list.
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedAgentId = searchParams.get('agent');
  // Shared across every team box, same sortable-header idea as คะแนน —
  // defaults to worklist-first (most รอตรวจ on top) since that's the whole
  // point of this page.
  const [sortKey, setSortKey] = useState('pending'); // 'name'|'total'|'pending'|'approved'|'rejected'|'approvedAmount'
  const [sortDir, setSortDir] = useState('desc');
  const { socket } = useSocket();
  const navigate = useNavigate();

  function openAgent(id) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('agent', id);
      return next;
    });
  }

  // Explicit close uses replace so it doesn't leave a dead "agent selected"
  // entry in history for back to land on again right after closing.
  function closeAgent() {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete('agent');
      return next;
    }, { replace: true });
  }

  function handleSort(key) {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  }

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

  const teams = useMemo(() => {
    if (!agents) return [];
    const byTeam = {};
    for (const a of agents) {
      const key = a.categoryId || '__none__';
      (byTeam[key] ||= { id: a.categoryId, name: a.categoryName || 'ไม่มีทีม', agents: [] }).agents.push(a);
    }
    const groups = Object.values(byTeam).map(g => ({
      ...g,
      pending: g.agents.reduce((s, a) => s + a.pending, 0),
      total: g.agents.reduce((s, a) => s + a.total, 0),
    }));
    // Teams still carrying unreviewed work float to the top, same worklist
    // priority the flat list used before team grouping was added.
    groups.sort((x, y) => (y.pending - x.pending) || (y.total - x.total));
    const dirMul = sortDir === 'asc' ? 1 : -1;
    for (const g of groups) {
      g.agents = [...g.agents].sort((a, b) => (
        sortKey === 'name' ? dirMul * a.name.localeCompare(b.name) : dirMul * (a[sortKey] - b[sortKey])
      ));
    }
    return groups;
  }, [agents, sortKey, sortDir]);

  return (
    <div className="p-6 overflow-y-auto h-full">
      <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100 mb-4 flex items-center gap-2">
        <Wallet size={20} className="text-aurora-tealDeep dark:text-aurora-teal" />
        ตรวจสอบอัพเซลล์
      </h1>

      {!agents ? (
        <p className="text-center text-gray-400 dark:text-slate-500 text-sm py-10">กำลังโหลด...</p>
      ) : teams.length === 0 ? (
        <p className="text-center text-gray-400 dark:text-slate-500 text-sm py-10">ยังไม่มีพนักงานส่งรายการอัพเซลล์เข้ามา</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {teams.map(team => (
            <div key={team.id || 'none'} className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 overflow-hidden">
              <div className="px-4 py-2.5 bg-gray-50 dark:bg-slate-800/50 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Users size={14} /> {team.name}
                </p>
                <p className="text-xs text-gray-500 dark:text-slate-400">
                  {team.pending > 0 && <span className="text-amber-600 dark:text-amber-400 font-medium">{team.pending} รอตรวจ · </span>}
                  {team.total} รายการทั้งหมด
                </p>
              </div>
              {/* overflow-x-auto is the safety net — without it, nowrap cells
                  in a narrow (half-width, 2-column grid) box would get
                  silently clipped by the card's own overflow-hidden right at
                  the ยอด column instead of ever being reachable. */}
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-slate-800 text-left text-gray-500 dark:text-slate-400">
                    <SortableTh label="พนักงาน" active={sortKey === 'name'} dir={sortDir} onClick={() => handleSort('name')} />
                    <SortableTh label="ส่งมา" active={sortKey === 'total'} dir={sortDir} onClick={() => handleSort('total')} align="center" />
                    <SortableTh label="รอตรวจ" active={sortKey === 'pending'} dir={sortDir} onClick={() => handleSort('pending')} align="center" />
                    <SortableTh label="ผ่าน" active={sortKey === 'approved'} dir={sortDir} onClick={() => handleSort('approved')} align="center" />
                    <SortableTh label="ไม่ผ่าน" active={sortKey === 'rejected'} dir={sortDir} onClick={() => handleSort('rejected')} align="center" />
                    <SortableTh label="ยอดผ่าน" active={sortKey === 'approvedAmount'} dir={sortDir} onClick={() => handleSort('approvedAmount')} align="right" />
                  </tr>
                </thead>
                <tbody>
                  {team.agents.map(a => (
                    <tr
                      key={a.id}
                      onClick={() => openAgent(a.id)}
                      className={`border-b border-gray-50 dark:border-slate-800/60 last:border-0 cursor-pointer transition-colors ${
                        a.pending > 0
                          ? 'bg-amber-50 dark:bg-amber-500/10 border-l-2 border-l-amber-400 hover:bg-amber-100 dark:hover:bg-amber-500/20'
                          : 'hover:bg-gray-50 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <Avatar name={a.name} />
                          <div className="min-w-0">
                            <p className="text-gray-800 dark:text-slate-200 truncate max-w-[110px]">{a.name}</p>
                            <p className="text-[11px] text-gray-400 dark:text-slate-500 truncate max-w-[110px]">{a.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-2.5 text-center text-gray-600 dark:text-slate-300">{a.total}</td>
                      <td className="px-2 py-2.5 text-center">
                        {a.pending > 0 ? (
                          <span className="text-amber-600 dark:text-amber-400 font-semibold">{a.pending}</span>
                        ) : (
                          <span className="text-gray-400 dark:text-slate-500">0</span>
                        )}
                      </td>
                      <td className="px-2 py-2.5 text-center text-emerald-600 dark:text-emerald-400">{a.approved}</td>
                      <td className="px-2 py-2.5 text-center text-rose-500 dark:text-rose-400">{a.rejected}</td>
                      <td className="px-3 py-2.5 text-right text-gray-800 dark:text-slate-200 font-medium whitespace-nowrap">
                        {a.approvedAmount ? `${a.approvedAmount.toLocaleString()} บาท` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedAgentId && (
        <UpsellAgentModal
          agentId={selectedAgentId}
          agentSummary={agents?.find(a => a.id === selectedAgentId)}
          onClose={closeAgent}
          navigate={navigate}
          onChanged={load}
        />
      )}
    </div>
  );
}

// One consistent card style for both the overall totals and each team's
// subtotal, so they read as one uniform row instead of two different-looking
// groups of boxes.
// Same colored-icon-badge pattern as Report.jsx's StatCard, so this row reads
// as a real dashboard row instead of plain white boxes — `color` is a
// Tailwind bg-* (solid or gradient) class for the icon badge.
function ScoreStatCard({ icon: Icon, label, value, caption, color }) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl p-4 border border-gray-200 dark:border-slate-800 flex items-center gap-3">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
        {Icon && <Icon size={20} className="text-white" />}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500 dark:text-slate-400 truncate">{label}</p>
        <p className="text-xl font-bold text-gray-900 dark:text-slate-100">{value}</p>
        {caption && <p className="text-[11px] text-gray-400 dark:text-slate-500 truncate">{caption}</p>}
      </div>
    </div>
  );
}

// Cycled across team cards (index % length) so each team gets a visually
// distinct color regardless of how many teams exist.
const TEAM_CARD_COLORS = ['bg-amber-500', 'bg-sky-500', 'bg-rose-500', 'bg-violet-500', 'bg-cyan-500', 'bg-fuchsia-500'];

// Clickable column header — click to sort by this column, click again to
// flip direction. Purely a display affordance; UpsellScorePage owns the
// actual sort state and re-orders each team's agents by it.
const TH_ALIGN_CLS = { left: 'text-left', center: 'text-center', right: 'text-right' };
function SortableTh({ label, active, dir, onClick, align = 'left' }) {
  return (
    <th className={`px-3 py-2.5 font-medium select-none whitespace-nowrap ${TH_ALIGN_CLS[align]}`}>
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 hover:text-gray-700 dark:hover:text-slate-200 ${active ? 'text-gray-800 dark:text-slate-100 font-semibold' : ''} ${align === 'right' ? 'flex-row-reverse' : ''}`}
      >
        {label}
        {active ? (dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : <ChevronsUpDown size={12} className="opacity-40" />}
      </button>
    </th>
  );
}

// Three visually distinct medal hues (yellow/gray/orange) rather than the
// amber-on-amber gold/bronze that used to be hard to tell apart at a glance.
const RANK_STYLE = [
  'text-yellow-500', // 1st — gold
  'text-gray-400 dark:text-gray-300', // 2nd — silver
  'text-orange-700 dark:text-orange-500', // 3rd — bronze
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
  // Which column each team's table is currently ordered by — click a header
  // to change it (see handleSort below). Shared across every team box so
  // "highest/lowest" reads consistently no matter which team you're looking at.
  const [sortKey, setSortKey] = useState('amount'); // 'name' | 'approved' | 'amount'
  const [sortDir, setSortDir] = useState('desc');
  const { socket } = useSocket();

  function handleSort(key) {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  }

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

  // Only used for the two org-wide totals cards above the team tables —
  // NOT for ranking, which must stay scoped per team (see teams below).
  const overallRanked = useMemo(() => (
    agents ? agents.filter(a => a.approved > 0) : []
  ), [agents]);

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
    const dirMul = sortDir === 'asc' ? 1 : -1;
    for (const g of groups) {
      // Rank is scoped to this team ONLY — each team's #1 earner is always
      // rank 0 regardless of how they'd stack up against other teams, so a
      // team's badges run 1..N with no gaps from other teams' agents being
      // interleaved in. Computed independently of the currently selected
      // sort column, so the medal stays put even when rows are reordered by
      // name/รายการ/ยอดเงิน.
      const rankedWithinTeam = [...g.agents].sort((a, b) => b.approvedAmount - a.approvedAmount || b.approved - a.approved);
      const teamRankById = Object.fromEntries(rankedWithinTeam.map((a, i) => [a.id, i]));
      g.agents = [...g.agents]
        .sort((a, b) => {
          if (sortKey === 'name') return dirMul * a.name.localeCompare(b.name);
          if (sortKey === 'approved') return dirMul * (a.approved - b.approved);
          return dirMul * (a.approvedAmount - b.approvedAmount);
        })
        .map(a => ({ ...a, teamRank: teamRankById[a.id] }));
    }
    return groups;
  }, [overallRanked, sortKey, sortDir]);

  const totalApproved = overallRanked.reduce((s, a) => s + a.approved, 0);
  const totalAmount = overallRanked.reduce((s, a) => s + a.approvedAmount, 0);

  return (
    <div className="p-6 overflow-y-auto h-full">
      <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100 mb-4 flex items-center gap-2">
        <TrendingUp size={20} className="text-aurora-tealDeep dark:text-aurora-teal" />
        คะแนนอัพเซลล์
      </h1>

      <DateRangeFilter preset={preset} from={from} to={to} onPreset={pickPreset} onCustom={pickCustom} />

      {!agents ? (
        <p className="text-center text-gray-400 dark:text-slate-500 text-sm py-10">กำลังโหลด...</p>
      ) : teams.length === 0 ? (
        <>
          <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
            <ScoreStatCard icon={CheckCircle2} label="รายการที่ผ่านทั้งหมด" value={totalApproved} color="bg-gradient-to-br from-aurora-teal to-aurora-purple" />
            <ScoreStatCard icon={Wallet} label="ยอดอัพเซลล์รวม" value={`${totalAmount.toLocaleString()} บาท`} color="bg-emerald-500" />
          </div>
          <p className="text-center text-gray-400 dark:text-slate-500 text-sm py-10">ยังไม่มีรายการอัพเซลล์ที่ผ่านการตรวจสอบในช่วงนี้</p>
        </>
      ) : (
        <>
          {/* Totals + every team's subtotal, all in one uniform row of
              identically-styled cards — "ทีมไหนทำเป้าได้เท่าไหร่" sits right
              next to the org-wide totals instead of in a separately-styled
              row below. */}
          <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
            <ScoreStatCard icon={CheckCircle2} label="รายการที่ผ่านทั้งหมด" value={totalApproved} color="bg-gradient-to-br from-aurora-teal to-aurora-purple" />
            <ScoreStatCard icon={Wallet} label="ยอดอัพเซลล์รวม" value={`${totalAmount.toLocaleString()} บาท`} color="bg-emerald-500" />
            {teams.map((t, i) => (
              <ScoreStatCard
                key={t.id || 'none'}
                icon={Users}
                label={t.name}
                value={`${t.approvedAmount.toLocaleString()} บาท`}
                caption={`${t.approved} รายการ · ${t.agents.length} คน`}
                color={TEAM_CARD_COLORS[i % TEAM_CARD_COLORS.length]}
              />
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
                      <SortableTh label="ชื่อ" active={sortKey === 'name'} dir={sortDir} onClick={() => handleSort('name')} />
                      <SortableTh label="รายการ" active={sortKey === 'approved'} dir={sortDir} onClick={() => handleSort('approved')} />
                      <SortableTh label="ยอดเงิน" active={sortKey === 'amount'} dir={sortDir} onClick={() => handleSort('amount')} align="right" />
                    </tr>
                  </thead>
                  <tbody>
                    {team.agents.map(a => {
                      const rank = a.teamRank;
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
  // Per-employee activity-vs-upsell comparison — shares this page's date
  // range but not the status/team filters below (those scope the detail
  // log only), and deliberately includes every agent (not just submitters)
  // so someone who's busy in chat but has submitted nothing still shows up.
  const [agentActivity, setAgentActivity] = useState(null);
  const [activitySort, setActivitySort] = useState('pct');
  const [activitySortDir, setActivitySortDir] = useState('asc'); // lowest conversion rate first — the whole point of this table
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

  function loadActivity() {
    axios.get('/api/upsells/agents', { params: { from: from || undefined, to: to || undefined, includeAll: 1 } })
      .then(r => setAgentActivity(r.data.agents));
  }
  useEffect(() => { loadActivity(); }, [from, to]);

  useEffect(() => {
    if (!socket) return;
    socket.on('upsell_reviewed', load);
    socket.on('upsell_claimed', load);
    return () => {
      socket.off('upsell_reviewed', load);
      socket.off('upsell_claimed', load);
    };
  }, [socket, from, to, status, teamFilter]);

  useEffect(() => {
    if (!socket) return;
    socket.on('upsell_reviewed', loadActivity);
    socket.on('upsell_claimed', loadActivity);
    return () => {
      socket.off('upsell_reviewed', loadActivity);
      socket.off('upsell_claimed', loadActivity);
    };
  }, [socket, from, to]);

  function handleActivitySort(key) {
    if (activitySort === key) {
      setActivitySortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setActivitySort(key);
      setActivitySortDir(key === 'name' ? 'asc' : key === 'pct' ? 'asc' : 'desc');
    }
  }

  // pct = รายการ (approved) ÷ รับเคส (conversationsHandled) — how many of
  // this agent's handled cases actually converted to an approved upsell,
  // full case load = 100%. null (not 0%) when they haven't handled any
  // cases yet, so an idle agent doesn't look identical to a 0%-conversion one.
  const activityWithPct = (agentActivity || []).map(a => ({
    ...a,
    pct: a.conversationsHandled > 0 ? (a.approved / a.conversationsHandled) * 100 : null,
  }));

  function sortAgents(agents) {
    const dir = activitySortDir === 'asc' ? 1 : -1;
    return [...agents].sort((a, b) => {
      if (activitySort === 'name') return dir * a.name.localeCompare(b.name);
      const av = a[activitySort];
      const bv = b[activitySort];
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // no cases received — always sorts last, regardless of direction
      if (bv == null) return -1;
      return dir * (av - bv);
    });
  }

  // Grouped by team, same pattern as ตรวจสอบ/คะแนน — team boxes ordered by
  // approved amount ascending (lowest-earning team first, matching this
  // table's whole "who needs a push" purpose); agents within each team
  // follow whichever column header was last clicked.
  const activityTeamGroups = (() => {
    // Agents with no team assigned are left out of this table entirely —
    // it's meant for team-vs-team comparison, so a "ไม่มีทีม" catch-all box
    // doesn't serve that and was just clutter.
    const withTeam = activityWithPct.filter(a => a.categoryId);
    if (!withTeam.length) return [];
    const byTeam = {};
    for (const a of withTeam) {
      const key = a.categoryId;
      (byTeam[key] ||= { id: a.categoryId, name: a.categoryName, agents: [] }).agents.push(a);
    }
    const groups = Object.values(byTeam).map(g => {
      const conversationsHandled = g.agents.reduce((s, a) => s + a.conversationsHandled, 0);
      const approved = g.agents.reduce((s, a) => s + a.approved, 0);
      const approvedAmount = g.agents.reduce((s, a) => s + a.approvedAmount, 0);
      return {
        ...g,
        conversationsHandled, approved, approvedAmount,
        pct: conversationsHandled > 0 ? (approved / conversationsHandled) * 100 : null,
      };
    });
    groups.sort((x, y) => x.approvedAmount - y.approvedAmount);
    for (const g of groups) g.agents = sortAgents(g.agents);
    return groups;
  })();

  return (
    <div className="p-6 overflow-y-auto h-full">
      <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100 mb-4 flex items-center gap-2">
        <FileText size={20} className="text-aurora-tealDeep dark:text-aurora-teal" />
        รายงานอัพเซลล์
      </h1>

      <DateRangeFilter preset={preset} from={from} to={to} onPreset={pickPreset} onCustom={pickCustom} />

      <div className="mb-6">
        <p className="text-sm font-semibold text-gray-800 dark:text-slate-200 mb-1">สรุปกิจกรรมรายพนักงาน</p>
        <p className="text-xs text-gray-500 dark:text-slate-400 mb-3">
          % คือสัดส่วนรายการที่ผ่านจากจำนวนเคสที่รับทั้งหมดในช่วงเวลานี้ — รับเคสเท่าไหร่ทำได้ครบเท่านั้นคือ 100%
        </p>
        {!agentActivity ? (
          <p className="text-center text-gray-400 dark:text-slate-500 text-sm py-10">กำลังโหลด...</p>
        ) : activityTeamGroups.length === 0 ? (
          <p className="text-center text-gray-400 dark:text-slate-500 text-sm py-10">ไม่มีพนักงานในระบบ</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {activityTeamGroups.map(team => (
              <div key={team.id || 'none'} className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 overflow-hidden overflow-x-auto">
                <div className="px-4 py-2.5 bg-gray-50 dark:bg-slate-800/50 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-800 dark:text-slate-200 flex items-center gap-1.5">
                    <Users size={14} /> {team.name}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-slate-400">
                    {team.approved}/{team.conversationsHandled} รายการ ({team.pct != null ? `${team.pct.toFixed(0)}%` : '—'}) · {team.approvedAmount.toLocaleString()} บาท
                  </p>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-slate-800 text-left text-gray-500 dark:text-slate-400">
                      <SortableTh label="พนักงาน" active={activitySort === 'name'} dir={activitySortDir} onClick={() => handleActivitySort('name')} />
                      <SortableTh label="รับเคส" active={activitySort === 'conversationsHandled'} dir={activitySortDir} onClick={() => handleActivitySort('conversationsHandled')} align="center" />
                      <SortableTh label="รายการ" active={activitySort === 'approved'} dir={activitySortDir} onClick={() => handleActivitySort('approved')} align="center" />
                      <SortableTh label="%" active={activitySort === 'pct'} dir={activitySortDir} onClick={() => handleActivitySort('pct')} align="center" />
                      <SortableTh label="ยอดที่อัพเซลล์ได้" active={activitySort === 'approvedAmount'} dir={activitySortDir} onClick={() => handleActivitySort('approvedAmount')} align="right" />
                    </tr>
                  </thead>
                  <tbody>
                    {team.agents.map(a => (
                      <tr key={a.id} className="border-b border-gray-50 dark:border-slate-800/60 last:border-0 hover:bg-gray-50 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <Avatar name={a.name} />
                            <p className="text-gray-800 dark:text-slate-200 truncate">{a.name}</p>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-center text-gray-600 dark:text-slate-300">{a.conversationsHandled}</td>
                        <td className="px-3 py-2.5 text-center text-gray-600 dark:text-slate-300">{a.approved}</td>
                        <td className="px-3 py-2.5 text-center font-semibold text-gray-800 dark:text-slate-200">
                          {a.pct != null ? `${a.pct.toFixed(0)}%` : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold whitespace-nowrap text-gray-900 dark:text-slate-100">
                          {a.approvedAmount ? `${a.approvedAmount.toLocaleString()} บาท` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-1 bg-gray-100 dark:bg-slate-800 rounded-lg p-1">
          {STATUS_TABS.map(s => (
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
