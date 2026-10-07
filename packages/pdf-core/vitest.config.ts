import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // The modern pdf.js build expects browser crypto APIs that Node lacks;
    // tests run the legacy build (identical API) so the same code paths that
    // run in the worker are the ones under test.
    alias: [{ find: /^pdfjs-dist$/, replacement: 'pdfjs-dist/legacy/build/pdf.mjs' }],
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
