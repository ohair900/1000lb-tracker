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
    environment: 'happy-dom',
    include: ['src/__tests__/**/*.test.js'],
    exclude: ['node_modules', 'dist', 'assets'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      exclude: [
        'node_modules/**',
        'dist/**',
        'assets/**',
        'src/__tests__/**',
        '**/*.config.js',
        'src/firebase/**',
        'src/main.js',
        'tests.js',
        'sw.js',
      ],
    },
  },
});
