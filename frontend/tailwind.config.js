/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Brand wordmark font — Poppins, closest Google Font match to the
        // "Aurora" logo wordmark supplied for the sidebar title.
        brand: ['Poppins', 'sans-serif'],
      },
      colors: {
        aurora: {
          midnight: '#070B18',
          teal: '#18D6C8',
          tealDeep: '#0C7A9E',
          green: '#7CFF6B',
          purple: '#3d276f',
          mist: '#D9FBFF',
        },
      },
    },
  },
  plugins: [],
};
