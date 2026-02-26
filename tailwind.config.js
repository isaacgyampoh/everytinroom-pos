/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: { outfit: ['Outfit', 'system-ui', 'sans-serif'] },
      colors: {
        brand: { 50: '#f0f9ff', 100: '#e0f2fe', 200: '#bae6fd', 300: '#7dd3fc', 400: '#38bdf8', 500: '#0ea5e9', 600: '#0284c7', 700: '#0369a1', 800: '#075985', 900: '#0c4a6e' },
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
