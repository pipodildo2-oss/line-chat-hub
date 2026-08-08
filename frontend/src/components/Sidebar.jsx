import { NavLink } from 'react-router-dom';
import { MessageSquare, BarChart2, Settings, LogOut, Wifi, WifiOff, MessageCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';

const navItems = [
  { to: '/inbox', icon: MessageSquare, label: 'Inbox' },
  { to: '/dashboard', icon: BarChart2, label: 'Dashboard' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export default function Sidebar() {
  const { agent, logout } = useAuth();
  const { connected } = useSocket();

  return (
    <aside className="w-16 bg-[#0a0c12] flex flex-col items-center py-4 gap-2 border-r border-white/5">
      {/* Logo */}
      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-indigo-500 flex items-center justify-center mb-4 shadow-lg shadow-indigo-500/10">
        <MessageCircle size={19} className="text-white" strokeWidth={2.2} />
      </div>

      {/* Nav */}
      <nav className="flex-1 flex flex-col gap-1">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            title={label}
            className={({ isActive }) =>
              `w-10 h-10 rounded-lg flex items-center justify-center transition-colors relative
              ${isActive ? 'bg-white/10 text-white' : 'text-white/35 hover:bg-white/5 hover:text-white/70'}`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-emerald-400 rounded-full" />}
                <Icon size={19} />
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Bottom */}
      <div className="flex flex-col items-center gap-3">
        <div title={connected ? 'Connected' : 'Disconnected'}>
          {connected ? (
            <Wifi size={15} className="text-emerald-400" />
          ) : (
            <WifiOff size={15} className="text-rose-400" />
          )}
        </div>

        <div
          className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center text-white text-sm font-medium"
          title={agent?.name}
        >
          {agent?.name?.[0]?.toUpperCase() || 'A'}
        </div>

        <button
          onClick={logout}
          title="Logout"
          className="text-white/35 hover:text-white transition-colors"
        >
          <LogOut size={17} />
        </button>
      </div>
    </aside>
  );
}
