/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'], heading: ['Inter', 'system-ui', 'sans-serif'] },
      colors: {
        brand: { 50: '#f6f6f5', 100: '#ececeb', 200: '#d8d9d7', 300: '#b8bab8', 400: '#8e9090', 500: '#5f6163', 600: '#42454a', 700: '#2a2d34', 800: '#1f2127', 900: '#16181d' },
        surface: '#f6f6f5',
        cream: '#fafafa',
        accent: { ink: '#16181d', red: '#b3402b' },
        wa: '#25d366',
      },
      borderRadius: { '2xl': '14px', '3xl': '18px', '4xl': '24px' },
    },
  },
  plugins: [],
}
