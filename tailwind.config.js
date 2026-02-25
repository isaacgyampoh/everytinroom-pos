/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: { outfit: ['Outfit', 'system-ui', 'sans-serif'] },
      colors: {
        brand: { 50: '#e8f5e9', 100: '#c8e6c9', 200: '#a5d6a7', 300: '#81c784', 400: '#66bb6a', 500: '#2ecc40', 600: '#27b336', 700: '#1e8c2a', 800: '#15661e', 900: '#0c3f12' },
        accent: { 50: '#fff3e0', 100: '#ffe0b2', 200: '#ffcc80', 300: '#ffb74d', 400: '#ffa726', 500: '#e67e22', 600: '#d35400', 700: '#bf4300', 800: '#a03600', 900: '#7a2900' },
        navy: { 50: '#e8eaf0', 100: '#c5c9d6', 200: '#9fa5ba', 300: '#78819e', 400: '#5b6688', 500: '#3e4c72', 600: '#2d3a5c', 700: '#1e2a4a', 800: '#151b2b', 900: '#0c1018' },
        sky: { 50: '#e3f2fd', 100: '#bbdefb', 200: '#90caf9', 300: '#64b5f6', 400: '#42a5f5', 500: '#2196f3', 600: '#1e88e5', 700: '#1976d2', 800: '#1565c0', 900: '#0d47a1' },
        gold: { 50: '#fffde7', 100: '#fff9c4', 200: '#fff59d', 300: '#fff176', 400: '#ffee58', 500: '#f1c40f', 600: '#d4ac0d', 700: '#b7950b', 800: '#9a7d0a', 900: '#7d6608' },
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
