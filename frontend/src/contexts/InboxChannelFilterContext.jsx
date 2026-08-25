import { createContext, useContext, useState } from 'react';

// Lets the Inbox page (a routed child under Layout's <Outlet>) tell Sidebar
// (Layout's OTHER child, a sibling of that routed content — not an
// ancestor, so plain prop-drilling can't reach it) which LINE channel(s)
// its filter is currently scoped to. Used by the "กล่องข้อความ" nav badge's
// open-conversation count, so it matches whatever channel selection is
// actually applied in the Inbox filter instead of always counting every
// channel the agent can see.
const InboxChannelFilterContext = createContext({ channelIds: [], setChannelIds: () => {} });

export function InboxChannelFilterProvider({ children }) {
  // Seeded from the same localStorage key Inbox.jsx persists its filter to
  // (see there), so the Sidebar badge reflects the right channel selection
  // immediately on load even before Inbox itself has mounted this session —
  // Inbox's own effect takes over keeping this in sync from then on.
  const [channelIds, setChannelIds] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('inbox_filter'));
      return Array.isArray(saved?.channelIds) ? saved.channelIds : [];
    } catch { return []; }
  });
  return (
    <InboxChannelFilterContext.Provider value={{ channelIds, setChannelIds }}>
      {children}
    </InboxChannelFilterContext.Provider>
  );
}

export const useInboxChannelFilter = () => useContext(InboxChannelFilterContext);
