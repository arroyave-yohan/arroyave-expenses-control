import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/app',
  publicDir: 'public',
  build: { outDir: '../../dist', emptyOutDir: true, target: 'es2022' },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
      '/health': 'http://localhost:8787',
    },
  },
});
