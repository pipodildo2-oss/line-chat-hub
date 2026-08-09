/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        aurora: {
          midnight: '#070B18',
          teal: '#18D6C8',
          tealDeep: '#0B8F84',
          green: '#7CFF6B',
          purple: '#3d276f',
          mist: '#D9FBFF',
        },
      },
    },
  },
  plugins: [],
};
