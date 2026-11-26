import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit-level: no Redis, no network. The queue/quota/files layers are all
    // behind interfaces with in-memory doubles so the gate runs anywhere.
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});