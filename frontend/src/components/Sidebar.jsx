import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import axios from 'axios';
import { MessageSquare, BarChart2, Settings, LogOut, ChevronDown, Radio, Users, Tag, User, Zap, ShieldAlert, Contact, Search } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
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
  const [profileOpen, setProfileOpen] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const status = agent?.status || 'online';

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
    { to: '/settings/quick-replies', icon: Zap, label: t('settings_quick_replies') },
  ];

  const reportChildren = [
    { to: '/report/audit', icon: Search, label: 'ตรวจสอบ' },
    { to: '/report/agents', icon: Users, label: 'พนักงาน' },
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
        <img src="/logo.png" alt="Aurora" className="w-9 h-9 rounded-lg shadow-sm flex-shrink-0" />
        <div className="min-w-0">
          <p className="font-brand font-semibold text-base text-slate-100 leading-tight truncate">Aurora</p>
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
              {t('nav_inbox')}
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
