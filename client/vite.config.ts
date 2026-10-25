import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same-origin API calls in development keep session cookies simple.
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: false },
    },
  },
});
