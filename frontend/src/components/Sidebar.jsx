import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { MessageSquare, BarChart2, Settings, LogOut, Wifi, WifiOff, MessageCircle, ChevronDown, Radio, Users, Tag } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';

const navItems = [
  { to: '/inbox', icon: MessageSquare, label: 'Inbox' },
  { to: '/dashboard', icon: BarChart2, label: 'Dashboard' },
];

const settingsChildren = [
  { to: '/settings/channels', icon: Radio, label: 'ช่องทาง LINE OA' },
  { to: '/settings/agents', icon: Users, label: 'ทีมงาน' },
  { to: '/settings/tags', icon: Tag, label: 'แท็ก' },
];

export default function Sidebar() {
  const { agent, logout } = useAuth();
  const { connected } = useSocket();
  const location = useLocation();
  const onSettings = location.pathname.startsWith('/settings');
  const [settingsOpen, setSettingsOpen] = useState(onSettings);

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
          <p className="px-2 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">งาน</p>
          <div className="space-y-0.5">
            {navItems.map(({ to, icon: Icon, label }) => (
              <NavLink key={to} to={to} className={linkCls}>
                <Icon size={17} />
                {label}
              </NavLink>
            ))}
          </div>
        </div>

        <div>
          <p className="px-2 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">จัดการ</p>
          <div className="space-y-0.5">
            <button
              onClick={() => setSettingsOpen(v => !v)}
              className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                onSettings ? 'text-aurora-teal' : 'text-slate-400 hover:bg-slate-800'
              }`}
            >
              <Settings size={17} />
              <span className="flex-1 text-left">Settings</span>
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
      </nav>

      {/* Bottom */}
      <div className="border-t border-slate-800 p-3">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-aurora-teal to-aurora-purple flex items-center justify-center text-white text-xs font-medium flex-shrink-0">
              {agent?.name?.[0]?.toUpperCase() || 'A'}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-200 truncate">{agent?.name}</p>
              <div className="flex items-center gap-1">
                {connected ? (
                  <Wifi size={9} className="text-aurora-green" />
                ) : (
                  <WifiOff size={9} className="text-rose-500" />
                )}
                <span className="text-[10px] text-slate-500">{connected ? 'Online' : 'Offline'}</span>
              </div>
            </div>
          </div>
          <button
            onClick={logout}
            title="Logout"
            className="text-slate-500 hover:text-rose-400 transition-colors flex-shrink-0"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}
