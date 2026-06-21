/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Hanken Grotesk', 'system-ui', 'sans-serif'], heading: ['Fraunces', 'Georgia', 'serif'] },
      colors: {
        brand: { 50: '#f1f5f2', 100: '#dde8e1', 200: '#bcd1c5', 300: '#8fb39e', 400: '#5e8d74', 500: '#3d8b6a', 600: '#2f6e54', 700: '#265a44', 800: '#1f4838', 900: '#1a3d30' },
        surface: '#F4F2EC',
        cream: '#FAF8F2',
        accent: { green: '#3d8b6a', red: '#c0492f', gold: '#b08642' },
        wa: '#25d366',
      },
      borderRadius: { '2xl': '14px', '3xl': '18px', '4xl': '24px' },
    },
  },
  plugins: [],
}
