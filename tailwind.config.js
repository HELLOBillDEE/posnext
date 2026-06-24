/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Kanit', 'sans-serif'],
        heading: ['Kanit', 'sans-serif'],
      },
      colors: {
        brand: {
          DEFAULT: '#C72C41',
          mid: '#801336',
          light: '#EE4540',
          50: '#FFF0F2',
          dark: '#510A32',
          900: '#2D142C',
        },
        glass: {
          blue: 'rgba(199,44,65,0.12)',
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
