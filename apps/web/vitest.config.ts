import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * The web app's own unit suite (new with P6.1): pure logic only. Component
 * behaviour is covered by the Playwright browser suites; this suite exists for
 * the maths and validation that would be flaky to drive through a browser.
 * `pnpm test` aggregates it automatically via `-r --if-present test`.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
