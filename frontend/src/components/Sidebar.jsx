import { useState, useEffect, useRef, useCallback } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import axios from 'axios';
import { MessageSquare, BarChart2, Settings, LogOut, ChevronDown, Radio, Users, Tag, User, Zap, ShieldAlert, Contact, Search, Clock, Wallet, ClipboardCheck, TrendingUp, FileText, Link2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useSocket } from '../contexts/SocketContext';
import { useInboxChannelFilter } from '../contexts/InboxChannelFilterContext';
import ProfileModal from './ProfileModal';

const STATUS_DOT = { online: 'bg-aurora-green', break: 'bg-amber-400', offline: 'bg-slate-500' };
const STATUS_LABEL_TH = { online: 'ออนไลน์', break: 'พัก', offline: 'ออฟไลน์' };

export default function Sidebar() {
  const { agent, logout, updateAgent } = useAuth();
  const { t } = useLanguage();
  const location = useLocation();
  const isAdmin = agent?.role === 'admin';
  const onSettings = location.pathname.startsWith('/settings');
  const [settingsOpen, setSettingsOpen] = useState(onSettings);
  const onReport = location.pathname.startsWith('/report');
  const [reportOpen, setReportOpen] = useState(onReport);
  const onUpsell = location.pathname.startsWith('/upsell');
  const [upsellOpen, setUpsellOpen] = useState(onUpsell);
  const [profileOpen, setProfileOpen] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const status = agent?.status || 'online';
  const { socket, connected } = useSocket();
  // "Things needing MY action" on quick-reply requests — admins count pending
  // (awaiting their review), agents count needs_revision (awaiting their own
  // fix + resubmit). Kept live via socket events rather than polling.
  const [qrRequestCount, setQrRequestCount] = useState(0);
  // The set of conversation ids currently counted as "เปิด" (open) for the
  // badge — tracked incrementally (added/removed one id at a time as
  // 'conversation_updated' events arrive) rather than re-fetched from the
  // server on every event. A debounced refetch-the-whole-count approach was
  // tried first and reported as feeling stale/non-live by agents — tracking
  // the actual set client-side means a status change or a new chat updates
  // the badge the instant its socket event arrives, no request round-trip
  // needed at all for the common case.
  const [openConvIds, setOpenConvIds] = useState(() => new Set());
  const openConvCount = openConvIds.size;
  // Which channels THIS agent can see at all (independent of the Inbox
  // filter below) — rides along on the /api/conversations/open-count
  // response (see there), rather than a separate /api/channels request, so
  // there's only one thing that has to succeed for the live-update listener
  // below to attach. undefined = not loaded yet (listener stays off), null =
  // unrestricted (sees every channel), Set = restricted to those ids.
  const [myChannelIds, setMyChannelIds] = useState(undefined);
  // The LINE channel(s) currently selected in the Inbox filter (empty =
  // every channel the agent can see) — shared via context since Sidebar and
  // the Inbox page are siblings under Layout, not parent/child (see
  // InboxChannelFilterContext).
  const { channelIds: filterChannelIds } = useInboxChannelFilter();

  useEffect(() => {
    if (!agent?.id) return;
    function loadCount() {
      const status = isAdmin ? 'pending' : 'needs_revision';
      axios.get('/api/quick-replies/requests', { params: { status } })
        .then(r => setQrRequestCount(r.data.length))
        .catch(() => {});
    }
    loadCount();
    if (!socket) return;
    socket.on('quick_reply_request_created', loadCount);
    socket.on('quick_reply_request_reviewed', loadCount);
    return () => {
      socket.off('quick_reply_request_created', loadCount);
      socket.off('quick_reply_request_reviewed', loadCount);
    };
  }, [socket, isAdmin, agent?.id]);

  // (Re)seeds the open set (and myChannelIds) from the server — the
  // incremental socket handler below then takes over keeping openConvIds
  // current from this point on.
  const fetchOpenCount = useCallback(() => {
    if (!agent?.id) return;
    const params = filterChannelIds.length > 0 ? { channelIds: filterChannelIds.join(',') } : {};
    axios.get('/api/conversations/open-count', { params })
      .then(r => {
        setOpenConvIds(new Set(r.data.ids));
        setMyChannelIds(r.data.myChannelIds ? new Set(r.data.myChannelIds) : null);
      })
      .catch(() => {});
  }, [agent?.id, filterChannelIds]);

  // Runs on mount, and whenever the agent or the channel filter changes.
  useEffect(() => { fetchOpenCount(); }, [fetchOpenCount]);

  // Also re-seeds whenever the socket reconnects (network blip, a
  // backgrounded/throttled tab, a backend redeploy) — the incremental
  // handler below can only apply deltas from events it actually receives, so
  // any 'conversation_updated' that fired while disconnected is gone for
  // good and the count quietly drifts until something re-fetches the full
  // set. Inbox.jsx closes the same gap for its own list the same way (see
  // the reconnect effect there); without this, the badge only ever
  // recovers on a full page reload.
  const prevConnectedRef = useRef(connected);
  useEffect(() => {
    if (connected && !prevConnectedRef.current) fetchOpenCount();
    prevConnectedRef.current = connected;
  }, [connected, fetchOpenCount]);

  useEffect(() => {
    if (!socket || myChannelIds === undefined) return;
    function onConversationUpdated(conv) {
      const inScope = (myChannelIds === null || myChannelIds.has(conv.channelId))
        && (filterChannelIds.length === 0 || filterChannelIds.includes(conv.channelId));
      const shouldCount = conv.status === 'open' && inScope;
      setOpenConvIds(prev => {
        if (shouldCount === prev.has(conv.id)) return prev; // no change — same Set reference, no re-render
        const next = new Set(prev);
        if (shouldCount) next.add(conv.id); else next.delete(conv.id);
        return next;
      });
    }
    socket.on('conversation_updated', onConversationUpdated);
    return () => socket.off('conversation_updated', onConversationUpdated);
  }, [socket, myChannelIds, filterChannelIds]);

  async function handleStatusChange(next) {
    setStatusOpen(false);
    try {
      const { data } = await axios.patch('/api/agents/me', { status: next });
      updateAgent(data);
    } catch { /* ignore */ }
  }

  const settingsChildren = [
    { to: '/settings/channels', icon: Radio, label: t('settings_channels') },
    { to: '/settings/agents', icon: Users, label: t('settings_agents') },
    { to: '/settings/tags', icon: Tag, label: t('settings_tags') },
    { to: '/settings/approved-links', icon: Link2, label: 'ลิงค์ที่อนุญาต' },
  ];

  const reportChildren = [
    { to: '/report/audit', icon: Search, label: 'ตรวจสอบ' },
    { to: '/report/agents', icon: Users, label: 'พนักงาน' },
    { to: '/report/followup', icon: Clock, label: 'ตามลูกค้า' },
  ];

  const upsellChildren = [
    { to: '/upsell/review', icon: ClipboardCheck, label: 'ตรวจสอบ' },
    { to: '/upsell/score', icon: TrendingUp, label: 'คะแนน' },
    { to: '/upsell/report', icon: FileText, label: 'รายงาน' },
  ];

  const linkCls = ({ isActive }) =>
    `flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors
    ${isActive
      ? 'bg-gradient-to-r from-aurora-teal/20 to-aurora-purple/20 text-aurora-teal'
      : 'text-slate-400 hover:bg-slate-800'}`;

  return (
    <aside className="w-56 bg-aurora-midnight border-r border-slate-800 flex flex-col flex-shrink-0">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-4 h-16 border-b border-slate-800">
        <img src="/logo.png" alt="Alpha" className="w-11 h-11 rounded-lg shadow-sm flex-shrink-0" />
        <div className="min-w-0">
          <p className="font-brand font-semibold text-base text-slate-100 leading-tight truncate">Alpha Chat</p>
          <p className="text-[11px] text-slate-500 truncate">By BBB888</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-5">
        <div>
          <p className="px-2 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t('nav_group_work')}</p>
          <div className="space-y-0.5">
            <NavLink to="/inbox" className={linkCls}>
              <MessageSquare size={17} />
              <span className="flex-1">{t('nav_inbox')}</span>
              {openConvCount > 0 && (
                <span className="bg-rose-500 text-white text-[10px] font-semibold rounded-full px-1.5 min-w-[18px] text-center">
                  {openConvCount}
                </span>
              )}
            </NavLink>
            <NavLink to={qrRequestCount > 0 ? '/quick-replies/requests' : '/quick-replies/catalog'} className={linkCls}>
              <Zap size={17} />
              <span className="flex-1">{t('settings_quick_replies')}</span>
              {qrRequestCount > 0 && (
                <span className="bg-rose-500 text-white text-[10px] font-semibold rounded-full px-1.5 min-w-[18px] text-center">
                  {qrRequestCount}
                </span>
              )}
            </NavLink>
          </div>
        </div>

        {isAdmin && (
          <div>
            <p className="px-2 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t('nav_group_manage')}</p>
            <div className="space-y-0.5">
              <NavLink to="/dashboard" className={linkCls}>
                <BarChart2 size={17} />
                {t('nav_dashboard')}
              </NavLink>
              <button
                onClick={() => setReportOpen(v => !v)}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                  onReport ? 'text-aurora-teal' : 'text-slate-400 hover:bg-slate-800'
                }`}
              >
                <ShieldAlert size={17} />
                <span className="flex-1 text-left">{t('nav_report')}</span>
                <ChevronDown size={15} className={`transition-transform ${reportOpen ? 'rotate-180' : ''}`} />
              </button>
              {reportOpen && (
                <div className="pl-4 space-y-0.5 pt-0.5">
                  {reportChildren.map(({ to, icon: Icon, label }) => (
                    <NavLink key={to} to={to} className={linkCls}>
                      <Icon size={14} />
                      <span className="text-[13px]">{label}</span>
                    </NavLink>
                  ))}
                </div>
              )}
              <NavLink to="/customers" className={linkCls}>
                <Contact size={17} />
                {t('nav_customers')}
              </NavLink>
              <button
                onClick={() => setUpsellOpen(v => !v)}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                  onUpsell ? 'text-aurora-teal' : 'text-slate-400 hover:bg-slate-800'
                }`}
              >
                <Wallet size={17} />
                <span className="flex-1 text-left">อัพเซลล์</span>
                <ChevronDown size={15} className={`transition-transform ${upsellOpen ? 'rotate-180' : ''}`} />
              </button>
              {upsellOpen && (
                <div className="pl-4 space-y-0.5 pt-0.5">
                  {upsellChildren.map(({ to, icon: Icon, label }) => (
                    <NavLink key={to} to={to} className={linkCls}>
                      <Icon size={14} />
                      <span className="text-[13px]">{label}</span>
                    </NavLink>
                  ))}
                </div>
              )}
              <button
                onClick={() => setSettingsOpen(v => !v)}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                  onSettings ? 'text-aurora-teal' : 'text-slate-400 hover:bg-slate-800'
                }`}
              >
                <Settings size={17} />
                <span className="flex-1 text-left">{t('nav_settings')}</span>
                <ChevronDown size={15} className={`transition-transform ${settingsOpen ? 'rotate-180' : ''}`} />
              </button>
              {settingsOpen && (
                <div className="pl-4 space-y-0.5 pt-0.5">
                  {settingsChildren.map(({ to, icon: Icon, label }) => (
                    <NavLink key={to} to={to} className={linkCls}>
                      <Icon size={14} />
                      <span className="text-[13px]">{label}</span>
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </nav>

      {/* Bottom */}
      <div className="border-t border-slate-800 p-3 relative">
        <div className="w-full flex items-center gap-1.5 px-1 py-1 rounded-lg hover:bg-slate-800 transition-colors">
          <button
            onClick={() => setProfileOpen(v => !v)}
            className="flex items-center gap-2 min-w-0 flex-1 text-left"
          >
            {agent?.avatarUrl ? (
              <img src={agent.avatarUrl} alt="" className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
            ) : (
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-aurora-teal to-aurora-purple flex items-center justify-center text-white text-xs font-medium flex-shrink-0">
                {agent?.name?.[0]?.toUpperCase() || 'A'}
              </div>
            )}
            <p className="text-xs font-medium text-slate-200 truncate min-w-0">{agent?.name}</p>
          </button>

          <div className="relative flex-shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); setStatusOpen(v => !v); setProfileOpen(false); }}
              className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-200 px-1.5 py-1 rounded-md hover:bg-slate-700 transition-colors"
            >
              <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[status]}`} />
              {STATUS_LABEL_TH[status]}
              <ChevronDown size={9} />
            </button>
            {statusOpen && (
              <div className="absolute bottom-full right-0 mb-1 w-28 bg-slate-800 border border-slate-700 rounded-lg shadow-lg overflow-hidden z-20">
                {['online', 'break', 'offline'].map(s => (
                  <button
                    key={s}
                    onClick={() => handleStatusChange(s)}
                    className="w-full flex items-center gap-2 px-2.5 py-2 text-xs text-slate-200 hover:bg-slate-700 transition-colors"
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[s]}`} /> {STATUS_LABEL_TH[s]}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {profileOpen && (
          <div className="absolute bottom-full left-3 right-3 mb-1 bg-slate-800 border border-slate-700 rounded-xl shadow-lg overflow-hidden">
            <button
              onClick={() => { setShowProfileModal(true); setProfileOpen(false); }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-slate-200 hover:bg-slate-700 transition-colors"
            >
              <User size={15} /> {t('profile')}
            </button>
            <button
              onClick={logout}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-rose-400 hover:bg-slate-700 transition-colors border-t border-slate-700"
            >
              <LogOut size={15} /> {t('logout')}
            </button>
          </div>
        )}
      </div>

      {showProfileModal && <ProfileModal onClose={() => setShowProfileModal(false)} />}
    </aside>
  );
}
