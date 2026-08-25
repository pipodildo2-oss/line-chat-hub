import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import { InboxChannelFilterProvider } from '../contexts/InboxChannelFilterContext';

export default function Layout() {
  return (
    <InboxChannelFilterProvider>
      <div className="flex h-screen bg-gray-50 dark:bg-aurora-navy overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </InboxChannelFilterProvider>
  );
}
