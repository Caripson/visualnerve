import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { piperBrowserRuntime, vendorChunk } from './build/browser-runtime';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/editor/' : '/',
  plugins: [piperBrowserRuntime(), react()],
  optimizeDeps: { exclude: ['@diffusionstudio/piper-wasm/build/piper_phonemize.js'] },
  worker: { format: 'es', plugins: () => [piperBrowserRuntime()] },
  build: {
    outDir: '../hugo/static/editor',
    emptyOutDir: true,
    // The static shell serves one fixed stylesheet; keep lazy views in that file.
    cssCodeSplit: false,
    rollupOptions: {
      input: 'src/main.tsx',
      output: {
        entryFileNames: 'app.js',
        onlyExplicitManualChunks: true,
        manualChunks: vendorChunk,
        assetFileNames: (asset) =>
          asset.names.some((name) => name.endsWith('.css'))
            ? 'app.css'
            : 'assets/[name]-[hash][extname]',
      },
    },
  },
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:4317' } },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
    maxWorkers: 2,
    // Native 600k-iteration password KDFs remain real in the security suites.
    // Allow their multi-operation scenarios to finish on shared CI/mobile-class CPUs;
    // production deadlines and explicit performance-test ceilings are independent.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
}));
