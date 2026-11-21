#!/usr/bin/env node
/**
 * One-command golden corpus run (G-03).
 *
 * The harness lives in `packages/pdf-core/test/goldenCorpus.test.ts`; this
 * wrapper gives a single command that prints the pass/fail report plus the
 * per-page diffs Vitest already produces when a golden assertion fails.
 */
import { spawnSync } from 'node:child_process';

const result = spawnSync(
  'pnpm',
  ['--filter', '@pdfshush/pdf-core', 'exec', 'vitest', 'run', 'test/goldenCorpus.test.ts'],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);

process.exit(result.status ?? 1);
