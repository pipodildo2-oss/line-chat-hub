import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import AfkTracker from './AfkTracker';
import { InboxChannelFilterProvider } from '../contexts/InboxChannelFilterContext';

export default function Layout() {
  return (
    <InboxChannelFilterProvider>
      <AfkTracker />
      <div className="flex h-screen bg-gray-50 dark:bg-aurora-navy overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </InboxChannelFilterProvider>
  );
}
