/**
 * Bundle boundary check.
 *
 * The web app's *main* chunk must never contain a PDF engine. pdf-lib, pdf.js
 * and pdfium are what the worker does; if any of them lands in the entry chunk,
 * every visitor pays to download the engines before they choose a tool. Only the
 * worker chunks may carry them.
 *
 * A runtime `identityRefs` import once dragged all of pdf-lib into the entry
 * chunk this way, silently — running this after a build makes that a failure
 * instead of a 570 kB surprise.
 *
 *   pnpm build && node tests/bundle-boundary.mjs
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'apps', 'web', 'dist');

/** Module paths that mean "an engine is in this chunk". */
const ENGINE = /pdf-lib|pdfjs|pdfium/i;

let failures = 0;

function check(name, ok, detail = '') {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

async function main() {
  let html;
  try {
    html = await readFile(path.join(DIST, 'index.html'), 'utf8');
  } catch {
    console.error('No build found. Run `pnpm build` first.');
    process.exit(1);
  }

  const entry = html.match(/<script[^>]+src="[^"]*\/assets\/([^"]+\.js)"/)?.[1];
  if (!entry) {
    console.error('Could not find the entry script in dist/index.html.');
    process.exit(1);
  }

  const main = path.join(DIST, 'assets', entry);
  const bytes = (await readFile(main)).byteLength;
  console.log(`main chunk: assets/${entry} (${(bytes / 1024).toFixed(1)} kB)`);

  const mapFile = `${main}.map`;
  let sources;
  try {
    sources = JSON.parse(await readFile(mapFile, 'utf8')).sources ?? [];
  } catch {
    // No sourcemap: fall back to the literal signatures the engines emit.
    const text = await readFile(main, 'utf8');
    const hit = ['PDFDocument', 'pdf.worker.min', 'pdfium'].find((needle) => text.includes(needle));
    check('main chunk carries no PDF engine (signature scan)', !hit, hit ?? 'clean');
    finish();
    return;
  }

  const bundled = sources.filter((source) => ENGINE.test(source));
  check(
    'main chunk carries no PDF engine',
    bundled.length === 0,
    bundled.length === 0 ? `${sources.length} modules, 0 engines` : `${bundled.length} engine modules`,
  );
  for (const source of bundled.slice(0, 5)) console.log(`         e.g. ${source}`);

  // The engines should exist *somewhere* in the worker chunks; if they vanished
  // entirely the check above would pass for the wrong reason.
  const assets = await readdir(path.join(DIST, 'assets'));
  const workers = assets.filter((name) => /^job-worker-.*\.js$|^pdf\.worker.*\.mjs$/.test(name));
  const workerHasEngine = await Promise.all(
    workers.map(async (name) => {
      try {
        const map = JSON.parse(await readFile(path.join(DIST, 'assets', `${name}.map`), 'utf8'));
        return (map.sources ?? []).some((source) => ENGINE.test(source));
      } catch {
        return false;
      }
    }),
  );
  check(
    'the engines still ship (in the worker chunks)',
    workerHasEngine.some(Boolean) || assets.some((name) => name.startsWith('pdfium-')),
    workers.join(', ') || 'no worker chunks found',
  );

  finish();
}

function finish() {
  console.log(failures === 0 ? '\n=== bundle boundary: ok ===' : `\n=== bundle boundary: ${failures} failed ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
