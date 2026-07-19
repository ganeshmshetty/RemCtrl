import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/renderer'),
    },
  },
  server: {
    force: true, // always re-bundle on dev server start
    watch: {
      ignored: ['**/research/**', '**/release/**'],
    },
  },
  optimizeDeps: {
    force: true,
    entries: ['index.html'], // Only scan the main index.html for dependencies
    include: ['@huggingface/transformers', 'onnxruntime-web'],
    exclude: ['research', 'release'],
  },
  // Keep the WASM runtime as a deployable asset for the isolated speech worker.
  assetsInclude: ['**/*.wasm'],
  worker: {
    format: 'es',
  },
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
  },
})
