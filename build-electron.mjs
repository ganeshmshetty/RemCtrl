// Build script for main + preload processes using esbuild
// Run: node build-electron.mjs

import { build } from 'esbuild';
import { existsSync, mkdirSync } from 'fs';
import { copyFileSync } from 'fs';

if (!existsSync('dist/main')) mkdirSync('dist/main', { recursive: true });

// ── Build Main Process ────────────────────────────────────────────────────────
await build({
  entryPoints: ['src/main/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist/main/index.cjs',
  external: ['electron'],
  packages: 'external',   // keep node_modules out of the bundle — avoids CJS dynamic require() in ESM
  sourcemap: true,
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
});

console.log('✓ Main process built → dist/main/index.cjs');

// ── Copy Preload (CJS, no bundling needed) ────────────────────────────────────
copyFileSync('src/preload/index.cjs', 'dist/main/preload.cjs');
console.log('✓ Preload copied → dist/main/preload.cjs');
