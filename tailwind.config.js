/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Sarabun', 'sans-serif'],
        heading: ['Sarabun', 'sans-serif'],
      },
      colors: {
        brand: {
          DEFAULT: '#3B5BDB',
          mid: '#4C6EF5',
          light: '#748FFC',
          50: '#EDF2FF',
          900: '#1e3a8a',
        },
        glass: {
          blue: 'rgba(59,91,219,0.12)',
          white: 'rgba(255,255,255,0.75)',
        },
      },
    },
  },
  plugins: [],
  safelist: [
    'bg-white/8',
    'hover:bg-white/8',
  ],
}
