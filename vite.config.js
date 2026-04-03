import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: resolve(__dirname, 'index.src.html'),
    },
  },
  server: {
    open: '/index.src.html',
  },
  test: {
    include: ['src/__tests__/**/*.test.js'],
  },
});
