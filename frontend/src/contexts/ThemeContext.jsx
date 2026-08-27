import { createContext, useContext, useEffect, useState } from 'react';

// Three color modes, picked from Sidebar's profile popup (see there):
//   - 'default' — the app's original always-on look (Aurora dark palette,
//     with its gradients and translucent glass panels/overlays).
//   - 'light'   — every component's own light Tailwind classes, already
//     written alongside their `dark:` counterparts throughout the app but
//     normally dormant since `dark` used to be forced unconditionally.
//   - 'dark'    — "โหมดทึบ" (solid/opaque dark) — the same dark palette as
//     'default', but with every gradient and translucent surface flattened
//     to a solid equivalent (see theme-solid.css) instead of the glassier
//     default look.
// Persisted per-browser (a personal display preference, not a shared
// workspace setting — unlike Settings > "ระบบ"), so it's remembered across
// reloads without needing a backend round-trip.
const COLOR_MODES = ['default', 'light', 'dark'];
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
    // 'default' and 'dark' both render the app's dark palette (there is no
    // OTHER dark look) — only 'light' removes the `dark` class so the
    // light Tailwind classes take over. `theme-solid` is the ADDITIONAL
    // flattening layer, only for the 'dark' (solid) mode specifically.
    root.classList.toggle('dark', colorMode !== 'light');
    root.classList.toggle('theme-solid', colorMode === 'dark');
  }, [colorMode]);

  function setColorMode(mode) {
    if (!COLOR_MODES.includes(mode)) return;
    try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* ignore */ }
    setColorModeState(mode);
  }

  // Kept for existing callers (e.g. Dashboard.jsx's chart colors) that only
  // ever cared whether the app is CURRENTLY rendering dark or light, not
  // which of the two dark variants — 'default' and 'dark' both count as
  // dark here.
  const theme = colorMode === 'light' ? 'light' : 'dark';

  return (
    <ThemeContext.Provider value={{ colorMode, setColorMode, theme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
