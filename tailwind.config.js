/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['DM Sans', 'system-ui', 'sans-serif'], heading: ['Outfit', 'DM Sans', 'system-ui', 'sans-serif'] },
      colors: {
        brand: { 50: '#fef2f2', 100: '#fee2e2', 200: '#fecaca', 300: '#f87171', 400: '#e53e3e', 500: '#c41e2a', 600: '#b11a24', 700: '#9b1520', 800: '#7f1119', 900: '#5c0c12' },
        wa: '#25d366',
        momo: '#f59e0b',
        paystack: '#00c3f7',
        refund: '#8b5cf6',
      },
      borderRadius: { '2xl': '16px', '3xl': '20px', '4xl': '28px' },
    },
  },
  plugins: [],
}
