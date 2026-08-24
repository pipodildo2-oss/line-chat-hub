/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Brand wordmark font — Sarabun, chosen for full Thai script support
        // (the app's primary audience) with good legibility at UI sizes.
        brand: ['Sarabun', 'sans-serif'],
      },
      colors: {
        // Blue design-system palette (replaces the earlier teal/purple
        // "Aurora" scheme) — token NAMES kept as-is on purpose so every
        // existing `aurora-*` class across the app repaints automatically
        // without needing a mechanical find/replace in every file. Only
        // the VALUES changed here; `teal`/`tealDeep`/`purple` map onto the
        // new Primary/Secondary/Light-blue-accent roles respectively.
        aurora: {
          midnight: '#070B14',  // Darker navy — sidebar / deepest surfaces
          navy: '#0E1626',      // Dark navy — general app background
          teal: '#005BFF',      // Primary blue
          tealDeep: '#3D6BFF',  // Secondary blue
          purple: '#7EC7FF',    // Light blue accent (primary gradient's end color)
          cyan: '#00E5FF',      // Secondary gradient's end color
          green: '#7CFF6B',     // Unchanged — semantic "online" status green, not a brand accent
          mist: '#D9ECFF',
        },
      },
    },
  },
  plugins: [],
};
