/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['DM Sans', 'system-ui', 'sans-serif'], heading: ['Outfit', 'DM Sans', 'system-ui', 'sans-serif'] },
      colors: {
        brand: { 50: '#f2f7f5', 100: '#dceee6', 200: '#b8dccb', 300: '#8cc4aa', 400: '#5fa886', 500: '#3d8b6a', 600: '#2d6f53', 700: '#265a44', 800: '#1f4838', 900: '#1a3d30' },
        surface: '#f6f4ef',
        cream: '#faf8f3',
        sage: { 50: '#f5f7f4', 100: '#e8ece6', 200: '#d4dbd0', 300: '#adbba5', 400: '#879b7d', 500: '#6b8160', 600: '#546a4c' },
        accent: { orange: '#f97316', green: '#22c55e', red: '#ef4444', lime: '#c5d45a' },
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
