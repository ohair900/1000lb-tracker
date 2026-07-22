import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
    // NOTE: directory-based manualChunks was tried and reverted. The `store`
    // singleton is imported across formulas/systems/views/firebase, so any
    // chunk boundary that separates it from its importers creates a
    // cross-chunk circular import that fails at runtime with a TDZ error
    // ("Cannot access X before initialization"). Splitting the bundle safely
    // requires first breaking those store-centric cycles — a larger refactor.
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
