/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['DM Sans', 'system-ui', 'sans-serif'], heading: ['Outfit', 'DM Sans', 'system-ui', 'sans-serif'] },
      colors: {
        brand: { 50: '#f7f7f8', 100: '#ededf0', 200: '#d5d5dc', 300: '#b0b0bc', 400: '#8585969', 500: '#6b6b7b', 600: '#545463', 700: '#434350', 800: '#2d2d38', 900: '#1a1a24' },
        surface: '#F5F5F3',
        cream: '#FAFAF8',
        accent: { orange: '#FF6B35', green: '#10B981', red: '#EF4444', blue: '#3B82F6' },
        wa: '#25d366',
        momo: '#f59e0b',
        paystack: '#00c3f7',
        refund: '#8b5cf6',
      },
      borderRadius: { '2xl': '14px', '3xl': '18px', '4xl': '24px' },
    },
  },
  plugins: [],
}
