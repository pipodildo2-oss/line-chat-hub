import { createContext, useContext, useEffect } from 'react';

// The app has a single visual theme now — the Aurora dark palette.
// This context stays in place (rather than deleting it) only so components
// that used `useTheme()` for chart colors etc. keep working unchanged.
const ThemeContext = createContext({ theme: 'dark' });

export function ThemeProvider({ children }) {
  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  return (
    <ThemeContext.Provider value={{ theme: 'dark' }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
