import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 3000 },
  // Tests run in plain Node — the modules under test are the money-critical
  // ones (the offline sale queue, the RPC migration fallback, the page
  // permission rule), none of which need a DOM. test-setup.js supplies the few
  // browser globals they do touch, so there is no jsdom dependency.
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
    setupFiles: ['./src/test-setup.js'],
    restoreMocks: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-hot-toast', 'zustand'],
          supabase: ['@supabase/supabase-js'],
        }
      }
    }
  }
})
