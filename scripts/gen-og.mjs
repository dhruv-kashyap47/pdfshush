/**
 * Generates one Open Graph card per tool (1200x630 PNG).
 *
 * Run once when the catalog changes and commit the output under
 * `apps/web/public/og/`; the build never depends on a native canvas module.
 * The registry parser is intentionally the same shape as `tests/support/catalog.mjs`
 * so a new tool cannot appear in the app and be forgotten here.
 *
 *   node scripts/gen-og.mjs
 */

import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireFromPdfCore = createRequire(path.join(ROOT, 'packages/pdf-core/package.json'));
const { createCanvas } = requireFromPdfCore('@napi-rs/canvas');

const W = 1200;
const H = 630;
const OUT = path.join(ROOT, 'apps/web/public/og');

function parseRegistry(source) {
  const liveBlock = source.slice(source.indexOf('const LIVE'), source.indexOf('const TOOL_NEXT'));
  const live = new Set([...liveBlock.matchAll(/'([a-z0-9-]+)'/g)].map((match) => match[1]));
  const tools = [];
  const categoryPattern =
    /id:\s*'([^']+)',[^\[]*?label:\s*'([^']+)',[^\[]*?tools:\s*\[([\s\S]*?)\n\s{4}\],/g;
  for (const match of source.matchAll(categoryPattern)) {
    const [, category, label, body] = match;
    for (const toolMatch of body.matchAll(
      /tool\('([a-z0-9-]+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*([A-Za-z0-9_]+),\s*'([a-z]+)'\)/g,
    )) {
      tools.push({
        slug: toolMatch[1],
        name: toolMatch[2],
        description: toolMatch[3],
        category,
        categoryLabel: label,
        live: live.has(toolMatch[1]),
      });
    }
  }
  return tools;
}

function wrap(ctx, text, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawCard({ name, lead, category, live }) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fbfaf8';
  ctx.fillRect(0, 0, W, H);

  // Hairline frame and an accent bar; the card has to read at 300 px wide.
  ctx.strokeStyle = '#ded9d2';
  ctx.lineWidth = 2;
  ctx.strokeRect(28, 28, W - 56, H - 56);
  ctx.fillStyle = live ? '#0f766e' : '#a16207';
  ctx.fillRect(28, 28, 12, H - 56);

  ctx.fillStyle = '#1c1917';
  ctx.font = '700 44px "Segoe UI", Helvetica, Arial, sans-serif';
  ctx.fillText('pdfshush', 78, 118);

  ctx.fillStyle = '#57534e';
  ctx.font = '500 24px "Segoe UI", Helvetica, Arial, sans-serif';
  ctx.fillText(category.toUpperCase(), 78, 160);

  ctx.fillStyle = '#1c1917';
  ctx.font = '700 72px "Segoe UI", Helvetica, Arial, sans-serif';
  const lines = wrap(ctx, name, 1000);
  lines.slice(0, 3).forEach((line, index) => ctx.fillText(line, 78, 300 + index * 84));

  ctx.fillStyle = '#44403c';
  ctx.font = '400 30px "Segoe UI", Helvetica, Arial, sans-serif';
  const leadLines = wrap(ctx, lead, 1000).slice(0, 2);
  leadLines.forEach((line, index) => ctx.fillText(line, 78, 520 + index * 40));

  ctx.fillStyle = live ? '#0f766e' : '#a16207';
  ctx.font = '600 24px "Segoe UI", Helvetica, Arial, sans-serif';
  ctx.fillText(live ? 'Runs in your browser. Nothing is uploaded.' : 'Not built — the honest reason is on the page.', 78, 588);

  return canvas.toBuffer('image/png');
}

const registry = await readFile(path.join(ROOT, 'apps/web/src/tools/registry.ts'), 'utf8');
const tools = parseRegistry(registry);
await mkdir(OUT, { recursive: true });

const home = drawCard({
  name: 'Private PDF tools',
  lead: 'Merge, organize, convert and edit PDF files without uploading them.',
  category: 'Privacy-first',
  live: true,
});
await writeFile(path.join(OUT, 'home.png'), home);

for (const tool of tools) {
  const png = drawCard({
    name: tool.name,
    lead: tool.description,
    category: tool.categoryLabel,
    live: tool.live,
  });
  await writeFile(path.join(OUT, `${tool.slug}.png`), png);
}

console.log(`[og] wrote ${tools.length + 1} cards to ${path.relative(ROOT, OUT)}`);
