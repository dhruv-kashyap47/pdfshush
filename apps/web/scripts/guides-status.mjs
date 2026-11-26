#!/usr/bin/env node
/**
 * Guide availability report.
 *
 * Exits non-zero when fewer than 20 guides are published, which is the AdSense
 * threshold the plan commits to. Run it before applying, and in CI if you want
 * the gate enforced.
 *
 *   node scripts/guides-status.mjs           # report
 *   node scripts/guides-status.mjs --check   # report, exit 1 if under 20
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED = 20;
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, '..', 'src', 'content', 'guides');

let files = [];
try {
  files = readdirSync(dir).filter((file) => file.endsWith('.md')).sort();
} catch {
  console.error(`No guides directory at ${dir}`);
  process.exit(1);
}

const rows = files.map((file) => {
  const source = readFileSync(path.join(dir, file), 'utf8');
  const slug = /^slug:\s*"?(.*?)"?\s*$/m.exec(source)?.[1] ?? file.replace(/\.md$/, '');
  const draft = /^draft:\s*(true|"true")\s*$/m.test(source);
  const words = source
    .replace(/^---[\s\S]*?---/, '')
    .split(/\s+/)
    .filter(Boolean).length;
  return { slug, draft, words };
});

const published = rows.filter((row) => !row.draft);
const drafts = rows.filter((row) => row.draft);

console.log(`Guides: ${rows.length} total — ${published.length} published, ${drafts.length} draft`);
console.log('');

for (const row of rows.sort((a, b) => Number(a.draft) - Number(b.draft) || a.slug.localeCompare(b.slug))) {
  const status = row.draft ? 'draft' : 'LIVE ';
  const flag = row.words < 1200 && !row.draft ? '  <-- under 1,200 words' : '';
  console.log(`  ${status}  ${String(row.words).padStart(5)} words  ${row.slug}${flag}`);
}

console.log('');

if (process.argv.includes('--check') && published.length < REQUIRED) {
  console.error(`FAIL: ${published.length} of ${REQUIRED} guides published.`);
  process.exit(1);
}

if (published.length >= REQUIRED) {
  console.log(`OK: ${published.length} published guides (threshold ${REQUIRED}).`);
} else {
  console.log(`Pending: ${REQUIRED - published.length} more guides must be published before applying.`);
}
