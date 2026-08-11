import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { MessageSquare, BarChart2, Settings, LogOut, Wifi, WifiOff, MessageCircle, ChevronDown, Radio, Users, Tag, User } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { useLanguage } from '../contexts/LanguageContext';
import ProfileModal from './ProfileModal';

export default function Sidebar() {
  const { agent, logout } = useAuth();
  const { connected } = useSocket();
  const { t } = useLanguage();
  const location = useLocation();
  const isAdmin = agent?.role === 'admin';
  const onSettings = location.pathname.startsWith('/settings');
  const [settingsOpen, setSettingsOpen] = useState(onSettings);
  const [profileOpen, setProfileOpen] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);

  const settingsChildren = [
    { to: '/settings/channels', icon: Radio, label: t('settings_channels') },
    { to: '/settings/agents', icon: Users, label: t('settings_agents') },
    { to: '/settings/tags', icon: Tag, label: t('settings_tags') },
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
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-aurora-teal to-aurora-purple flex items-center justify-center shadow-sm flex-shrink-0">
          <MessageCircle size={17} className="text-white" strokeWidth={2.2} />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-sm text-slate-100 leading-tight truncate">LINE Chat Hub</p>
          <p className="text-[11px] text-slate-500 truncate">Multi-channel inbox</p>
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
            {isAdmin && (
              <NavLink to="/dashboard" className={linkCls}>
                <BarChart2 size={17} />
                {t('nav_dashboard')}
              </NavLink>
            )}
          </div>
        </div>

        {isAdmin && (
          <div>
            <p className="px-2 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t('nav_group_manage')}</p>
            <div className="space-y-0.5">
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
        <button
          onClick={() => setProfileOpen(v => !v)}
          className="w-full flex items-center justify-between px-1 py-1 rounded-lg hover:bg-slate-800 transition-colors"
        >
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-aurora-teal to-aurora-purple flex items-center justify-center text-white text-xs font-medium flex-shrink-0">
              {agent?.name?.[0]?.toUpperCase() || 'A'}
            </div>
            <div className="min-w-0 text-left">
              <p className="text-xs font-medium text-slate-200 truncate">{agent?.name}</p>
              <div className="flex items-center gap-1">
                {connected ? (
                  <Wifi size={9} className="text-aurora-green" />
                ) : (
                  <WifiOff size={9} className="text-rose-500" />
                )}
                <span className="text-[10px] text-slate-500">{connected ? t('online') : t('offline')}</span>
              </div>
            </div>
          </div>
        </button>

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
