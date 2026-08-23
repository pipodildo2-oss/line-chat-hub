import { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate, useParams } from 'react-router-dom';
import { Wallet, X, ExternalLink, Check, Ban, Pencil, TrendingUp, Trophy } from 'lucide-react';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';
import { useSocket } from '../contexts/SocketContext';

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

// "รายงาน" — a score leaderboard pulled from the same per-agent data the
// ตรวจสอบ tab already reviews: 1 ผ่าน = 1 รายการ, plus the running total of
// all approved upsell amounts. Read-only — no review actions here, that's
// ตรวจสอบ's job; this is just the scoreboard.
function UpsellReportPage() {
  const [agents, setAgents] = useState(null);
  const { socket } = useSocket();

  function load() {
    axios.get('/api/upsells/agents').then(r => setAgents(r.data.agents));
  }
  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!socket) return;
    socket.on('upsell_reviewed', load);
    return () => socket.off('upsell_reviewed', load);
  }, [socket]);

  const ranked = agents
    ? [...agents].filter(a => a.approved > 0).sort((a, b) => b.approvedAmount - a.approvedAmount || b.approved - a.approved)
    : [];
  const totalApproved = ranked.reduce((s, a) => s + a.approved, 0);
  const totalAmount = ranked.reduce((s, a) => s + a.approvedAmount, 0);

  return (
    <div className="p-6 overflow-y-auto h-full">
      <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100 mb-4 flex items-center gap-2">
        <TrendingUp size={20} className="text-aurora-tealDeep dark:text-aurora-teal" />
        รายงานคะแนนอัพเซลล์
      </h1>

      <div className="grid grid-cols-2 gap-4 mb-4 max-w-lg">
        <div className="bg-white dark:bg-slate-900 rounded-xl p-4 border border-gray-200 dark:border-slate-800">
          <p className="text-gray-500 dark:text-slate-400 text-sm">รายการที่ผ่านทั้งหมด</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-slate-100">{totalApproved}</p>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-xl p-4 border border-gray-200 dark:border-slate-800">
          <p className="text-gray-500 dark:text-slate-400 text-sm">ยอดอัพเซลล์รวม</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-slate-100">{totalAmount.toLocaleString()} บาท</p>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 overflow-hidden">
        {!agents ? (
          <p className="text-center text-gray-400 dark:text-slate-500 text-sm py-10">กำลังโหลด...</p>
        ) : ranked.length === 0 ? (
          <p className="text-center text-gray-400 dark:text-slate-500 text-sm py-10">ยังไม่มีรายการอัพเซลล์ที่ผ่านการตรวจสอบ</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-slate-800 text-left text-gray-500 dark:text-slate-400">
                <th className="px-4 py-2.5 font-medium">อันดับ</th>
                <th className="px-4 py-2.5 font-medium">พนักงาน</th>
                <th className="px-4 py-2.5 font-medium">รายการที่ผ่าน</th>
                <th className="px-4 py-2.5 font-medium">ยอดอัพเซลล์รวม</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((a, i) => (
                <tr key={a.id} className="border-b border-gray-50 dark:border-slate-800/60">
                  <td className="px-4 py-2.5 text-gray-500 dark:text-slate-400">
                    {i === 0 ? <Trophy size={15} className="text-amber-500 inline" /> : i + 1}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={a.name} />
                      <p className="text-gray-800 dark:text-slate-200 truncate">{a.name}</p>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-gray-700 dark:text-slate-300 font-medium">{a.approved}</td>
                  <td className="px-4 py-2.5 text-gray-900 dark:text-slate-100 font-semibold">{a.approvedAmount.toLocaleString()} บาท</td>
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
  if (tab === 'report') return <UpsellReportPage />;
  return <UpsellReviewPage />;
}
