import { createContext, useContext, useEffect, useState } from 'react';

// Two color modes, picked from the profile modal (see ProfileModal.jsx):
//   - 'default' — the app's original always-on look (Aurora dark palette,
//     with its gradients and translucent glass panels/overlays).
//   - 'light'   — every component's own light Tailwind classes, already
//     written alongside their `dark:` counterparts throughout the app but
//     normally dormant since `dark` used to be forced unconditionally.
// Persisted per-browser (a personal display preference, not a shared
// workspace setting — unlike Settings > "ระบบ"), so it's remembered across
// reloads without needing a backend round-trip.
const COLOR_MODES = ['default', 'light'];
const STORAGE_KEY = 'color_mode';

function readStoredColorMode() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return COLOR_MODES.includes(saved) ? saved : 'default';
  } catch {
    return 'default';
  }
}

const ThemeContext = createContext({ colorMode: 'default', setColorMode: () => {}, theme: 'dark' });

export function ThemeProvider({ children }) {
  const [colorMode, setColorModeState] = useState(readStoredColorMode);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', colorMode !== 'light');
    // Keeps native browser chrome (scrollbars, date pickers, select
    // dropdowns) in sync with the picked mode — otherwise those stay
    // permanently dark-styled regardless of what the app itself shows.
    root.style.colorScheme = colorMode === 'light' ? 'light' : 'dark';
  }, [colorMode]);

  function setColorMode(mode) {
    if (!COLOR_MODES.includes(mode)) return;
    try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* ignore */ }
    setColorModeState(mode);
  }

  const theme = colorMode === 'light' ? 'light' : 'dark';

  return (
    <ThemeContext.Provider value={{ colorMode, setColorMode, theme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
