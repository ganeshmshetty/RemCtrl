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
    exclude: ['research', 'release'],
  },
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
  },
})
