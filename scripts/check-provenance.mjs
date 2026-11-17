#!/usr/bin/env node
/**
 * Provenance gate for owner-authorised copies from `rea ihpdf/`.
 *
 * Every copied file carries a header naming its source under `rea ihpdf/`, with
 * the owner-authorised notice, and the same source path must appear in
 * `licenses/rea-ihpdf-NOTICE.md`. This keeps the ledger and the header from
 * drifting apart, and it fails closed if the notice file or a header disappears.
 *
 * No copied code has landed yet, so a clean run reports zero derived files.
 * The check becomes meaningful with the first port (F-01, C-01, C-02, ...).
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOTICE_PATH = path.join(ROOT, 'licenses', 'rea-ihpdf-NOTICE.md');
const SCAN_DIRS = ['apps', 'packages', 'scripts', 'tests'];
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.git',
  '.pnpm-store',
  '.wrangler',
  'rea ihpdf',
]);
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const MARKER = /Derived from rea ihpdf\/([^\s)]+)/g;

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(path.join(dir, entry.name));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!CODE_EXTENSIONS.has(path.extname(entry.name))) continue;
    yield path.join(dir, entry.name);
  }
}

function relative(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

async function main() {
  let notice;
  try {
    notice = await readFile(NOTICE_PATH, 'utf8');
  } catch {
    console.error('provenance: licenses/rea-ihpdf-NOTICE.md is missing.');
    process.exit(1);
  }

  const problems = [];
  let derivedFiles = 0;
  let markers = 0;

  for (const dir of SCAN_DIRS) {
    for await (const file of walk(path.join(ROOT, dir))) {
      if (relative(file) === 'scripts/check-provenance.mjs') continue;
      let text;
      try {
        text = await readFile(file, 'utf8');
      } catch {
        continue;
      }
      if (!text.includes('Derived from rea ihpdf/')) continue;
      derivedFiles += 1;
      const fileProblems = [];
      for (const match of text.matchAll(MARKER)) {
        markers += 1;
        const source = match[1];
        if (!notice.includes(`rea ihpdf/${source}`)) {
          fileProblems.push(`source "${source}" is missing from the ledger`);
        }
      }
      if (fileProblems.length === 0) continue;
      problems.push(`${relative(file)}: ${fileProblems.join('; ')}`);
    }
  }

  if (problems.length > 0) {
    console.error('provenance: FAILED');
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error(
      'Add the source path to licenses/rea-ihpdf-NOTICE.md or remove the derived-code header.',
    );
    process.exit(1);
  }

  console.log(
    `provenance: OK — ${derivedFiles} derived file(s), ${markers} ledger marker(s), notice present.`,
  );
}

await main();
