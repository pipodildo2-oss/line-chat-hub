import { NavLink } from 'react-router-dom';
import { MessageSquare, BarChart2, Settings, LogOut, Wifi, WifiOff } from 'lucide-react';
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
    <aside className="w-16 bg-gray-900 flex flex-col items-center py-4 gap-2">
      {/* Logo */}
      <div className="w-10 h-10 bg-green-500 rounded-xl flex items-center justify-center mb-4 text-white font-bold text-lg">
        L
      </div>

      {/* Nav */}
      <nav className="flex-1 flex flex-col gap-1">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            title={label}
            className={({ isActive }) =>
              `w-10 h-10 rounded-lg flex items-center justify-center transition-colors
              ${isActive ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`
            }
          >
            <Icon size={20} />
          </NavLink>
        ))}
      </nav>

      {/* Bottom */}
      <div className="flex flex-col items-center gap-3">
        {/* Connection status */}
        <div title={connected ? 'Connected' : 'Disconnected'}>
          {connected ? (
            <Wifi size={16} className="text-green-400" />
          ) : (
            <WifiOff size={16} className="text-red-400" />
          )}
        </div>

        {/* Avatar */}
        <div
          className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center text-white text-sm font-medium"
          title={agent?.name}
        >
          {agent?.name?.[0]?.toUpperCase() || 'A'}
        </div>

        {/* Logout */}
        <button
          onClick={logout}
          title="Logout"
          className="text-gray-400 hover:text-white transition-colors"
        >
          <LogOut size={18} />
        </button>
      </div>
    </aside>
  );
}
