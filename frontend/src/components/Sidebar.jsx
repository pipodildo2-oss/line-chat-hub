import { NavLink } from 'react-router-dom';
import { MessageSquare, BarChart2, Settings, LogOut, Wifi, WifiOff, MessageCircle, Sun, Moon } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { useTheme } from '../contexts/ThemeContext';

const navGroups = [
  {
    label: 'งาน',
    items: [
      { to: '/inbox', icon: MessageSquare, label: 'Inbox' },
      { to: '/dashboard', icon: BarChart2, label: 'Dashboard' },
    ],
  },
  {
    label: 'จัดการ',
    items: [
      { to: '/settings', icon: Settings, label: 'Settings' },
    ],
  },
];

export default function Sidebar() {
  const { agent, logout } = useAuth();
  const { connected } = useSocket();
  const { theme, toggleTheme } = useTheme();

  return (
    <aside className="w-56 bg-white dark:bg-slate-900 border-r border-gray-100 dark:border-slate-800 flex flex-col flex-shrink-0">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-4 h-16 border-b border-gray-100 dark:border-slate-800">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-400 to-indigo-500 flex items-center justify-center shadow-sm flex-shrink-0">
          <MessageCircle size={17} className="text-white" strokeWidth={2.2} />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-sm text-gray-900 dark:text-slate-100 leading-tight truncate">LINE Chat Hub</p>
          <p className="text-[11px] text-gray-400 dark:text-slate-500 truncate">Multi-channel inbox</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-5">
        {navGroups.map(group => (
          <div key={group.label}>
            <p className="px-2 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map(({ to, icon: Icon, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors
                    ${isActive
                      ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400'
                      : 'text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800'}`
                  }
                >
                  <Icon size={17} />
                  {label}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom */}
      <div className="border-t border-gray-100 dark:border-slate-800 p-3 space-y-2">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center text-white text-xs font-medium flex-shrink-0">
              {agent?.name?.[0]?.toUpperCase() || 'A'}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-gray-800 dark:text-slate-200 truncate">{agent?.name}</p>
              <div className="flex items-center gap-1">
                {connected ? (
                  <Wifi size={9} className="text-emerald-500" />
                ) : (
                  <WifiOff size={9} className="text-rose-500" />
                )}
                <span className="text-[10px] text-gray-400 dark:text-slate-500">{connected ? 'Online' : 'Offline'}</span>
              </div>
            </div>
          </div>
          <button
            onClick={logout}
            title="Logout"
            className="text-gray-400 dark:text-slate-500 hover:text-rose-500 dark:hover:text-rose-400 transition-colors flex-shrink-0"
          >
            <LogOut size={16} />
          </button>
        </div>

        <button
          onClick={toggleTheme}
          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          {theme === 'dark' ? 'โหมดสว่าง' : 'โหมดมืด'}
        </button>
      </div>
    </aside>
  );
}
