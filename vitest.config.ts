import { defineConfig } from 'vitest/config';

/** Keep the project test command isolated from vendored research fixtures. */
export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['research/**', 'node_modules/**'],
  },
});
