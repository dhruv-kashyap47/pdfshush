import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The Worker realm has no DOM; `node:sqlite` gives the tests a real database
    // with the production migrations applied.
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
