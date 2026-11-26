/**
 * On-page SEO audit for the built site.
 *
 * Reads `apps/web/dist`, not the source, so it checks the bytes a crawler
 * actually receives. Run after `pnpm build`:
 *
 *   node scripts/seo-audit.mjs
 *
 * It fails on a title outside 50–60 characters, a description outside
 * 150–160, a missing canonical/OG/Twitter/hreflang tag, more than one H1,
 * a thin tool or guide page, a missing JSON-LD type, or a sitemap URL that
 * does not resolve to a page. Exact lengths are a brief requirement, not a
 * Google ranking factor; the audit keeps the copy honest to the brief.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'apps', 'web', 'dist');

let failures = 0;
let warnings = 0;

function fail(label, detail = '') {
  failures += 1;
  console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ''}`);
}

function warn(label, detail = '') {
  warnings += 1;
  console.log(`  WARN  ${label}${detail ? ` -- ${detail}` : ''}`);
}

function pass(label, detail = '') {
  console.log(`  PASS  ${label}${detail ? ` -- ${detail}` : ''}`);
}

function first(html, pattern) {
  return html.match(pattern)?.[1]?.trim() ?? null;
}

function decodeHtml(value) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

function textOf(html) {
  const root = first(html, /<div id="root">([\s\S]*)<\/div>\s*<\/body>/) ?? '';
  return root
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function words(text) {
  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

async function collectHtmlFiles(dir, base = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const route = `${base}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...(await collectHtmlFiles(full, route)));
    } else if (entry.name.endsWith('.html') && entry.name !== '404.html' && entry.name !== 'index.html') {
      files.push({ file: full, route: route.replace(/\.html$/, '') });
    }
  }
  return files;
}

const homeHtml = await readFile(path.join(DIST, 'index.html'), 'utf8');
const pages = [{ file: path.join(DIST, 'index.html'), route: '/' }, ...(await collectHtmlFiles(DIST))];
const origin = (first(homeHtml, /<link rel="canonical" href="([^"]+)"/) ?? 'https://pdfshush.com/').replace(/\/$/, '');

const titles = new Map();
const descriptions = new Map();
const sitemap = await readFile(path.join(DIST, 'sitemap.xml'), 'utf8');
const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);

console.log(`\n== Seeded pages: ${pages.length} ==`);

for (const page of pages) {
  const html = await readFile(page.file, 'utf8');
  const label = page.route;

  const title = first(html, /<title>([^<]+)<\/title>/);
  const description = first(html, /<meta name="description" content="([^"]+)"/);
  const canonical = first(html, /<link rel="canonical" href="([^"]+)"/);
  const robots = first(html, /<meta name="robots" content="([^"]+)"/);
  const h1s = [...html.matchAll(/<h1[^>]*>/g)];
  const visible = textOf(html);
  const wordCount = words(visible);
  const isTool = label.startsWith('/tools/');
  const isGuide = !isTool && !['/', '/about', '/contact', '/privacy', '/terms', '/status', '/trust', '/verify', '/workflows', '/account'].includes(label);
  const indexable = robots !== null && /(^|,)\s*index\s*(,|$)/.test(robots);

  if (!title) fail(`${label} has a title`);
  else {
    const decoded = decodeHtml(title);
    const length = [...decoded].length;
    if (length < 50 || length > 60) fail(`${label} title length`, `${length}: ${decoded}`);
    if (titles.has(decoded)) fail(`${label} duplicate title`, `also ${titles.get(decoded)}`);
    titles.set(decoded, label);
  }

  if (!description) fail(`${label} has a description`);
  else {
    const decoded = decodeHtml(description);
    const length = [...decoded].length;
    if (length < 150 || length > 160) fail(`${label} description length`, `${length}: ${decoded.slice(0, 60)}…`);
    if (descriptions.has(decoded)) fail(`${label} duplicate description`, `also ${descriptions.get(decoded)}`);
    descriptions.set(decoded, label);
  }

  if (!canonical) fail(`${label} has a canonical`);
  else {
    const expected = `${origin}${label === '/' ? '/' : label}`;
    if (canonical !== expected) fail(`${label} canonical`, `${canonical} != ${expected}`);
  }

  if (!robots) fail(`${label} has robots`);
  if (indexable && !sitemapUrls.includes(`${origin}${label === '/' ? '/' : label}`)) {
    fail(`${label} is in the sitemap`);
  }

  if (h1s.length !== 1) fail(`${label} has exactly one H1`, `${h1s.length}`);
  if (!/<h1[^>]*>/.test(html)) fail(`${label} H1 is present`);

  for (const required of [
    'og:type',
    'og:site_name',
    'og:title',
    'og:description',
    'og:url',
    'og:image',
    'og:image:alt',
    'og:image:width',
    'og:image:height',
    'og:locale',
  ]) {
    if (!html.includes(`property="${required}"`)) fail(`${label} has ${required}`);
  }
  for (const required of [
    'twitter:card',
    'twitter:title',
    'twitter:description',
    'twitter:image',
    'twitter:image:alt',
  ]) {
    if (!html.includes(`name="${required}"`)) fail(`${label} has ${required}`);
  }
  if ((html.match(/hreflang="en-IN"/g) ?? []).length !== 1) fail(`${label} has one en-IN hreflang`);
  if (!html.includes('hreflang="x-default"')) fail(`${label} has x-default hreflang`);

  if (isTool && indexable) {
    if (wordCount < 300) fail(`${label} word count`, `${wordCount} (< 300)`);
    if (!html.includes('"@type":"SoftwareApplication"')) fail(`${label} has SoftwareApplication schema`);
    if (!html.includes('"@type":"BreadcrumbList"')) fail(`${label} has BreadcrumbList schema`);
  }
  if (isGuide && indexable && wordCount < 300) fail(`${label} guide word count`, `${wordCount} (< 300)`);
  if (label === '/' && wordCount < 600) fail(`home word count`, `${wordCount} (< 600)`);

  // Parse every JSON-LD block and check the shape, not just the type string.
  const schemas = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((match) => {
      try {
        return JSON.parse(match[1]);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const types = new Set(schemas.map((schema) => schema['@type']));
  if (isTool && indexable) {
    const app = schemas.find((schema) => schema['@type'] === 'SoftwareApplication');
    if (!app) fail(`${label} parses a SoftwareApplication`);
    else {
      if (app.applicationCategory !== 'UtilitiesApplication') fail(`${label} applicationCategory`);
      if (String(app.offers?.price) !== '0') fail(`${label} offer price is 0`, String(app.offers?.price));
      if (app.isAccessibleForFree !== true) fail(`${label} isAccessibleForFree`);
    }
    if (!types.has('FAQPage')) fail(`${label} has an FAQPage`);
  }
  if (isGuide && indexable) {
    if (!types.has('FAQPage')) fail(`${label} has an FAQPage`);
    if (!types.has('BreadcrumbList')) fail(`${label} has a BreadcrumbList`);
  }

  const image = first(html, /<meta property="og:image" content="([^"]+)"/);
  if (image?.startsWith('http')) {
    const relative = image.replace(origin, '');
    try {
      await stat(path.join(DIST, relative));
    } catch {
      fail(`${label} og:image exists`, relative);
    }
  }
}

pass(`pages audited`, `${pages.length}`);
pass(`unique titles`, `${titles.size}`);
pass(`unique descriptions`, `${descriptions.size}`);

// Sitemap: every URL must resolve to a generated file (flat `.html`).
let missing = 0;
for (const url of sitemapUrls) {
  const relative = url.replace(origin, '');
  const file = relative === '/' ? path.join(DIST, 'index.html') : path.join(DIST, `${relative}.html`);
  try {
    await stat(file);
  } catch {
    missing += 1;
    fail('sitemap URL resolves', url);
  }
}
pass('sitemap URLs resolve', `${sitemapUrls.length - missing}/${sitemapUrls.length}`);

const robotsTxt = await readFile(path.join(DIST, 'robots.txt'), 'utf8');
if (!robotsTxt.includes(`Sitemap: ${origin}/sitemap.xml`)) fail('robots.txt sitemap origin');
if (!robotsTxt.includes('Disallow: /account')) fail('robots.txt disallows /account');

const types = ['Organization', 'WebSite', 'SearchAction', 'FAQPage'];
for (const type of types) {
  if (!homeHtml.includes(`"@type":"${type}"`)) fail(`home schema ${type}`);
}

if (!homeHtml.includes('Free Online PDF Tools')) fail('home title/H1 carries the main keyword');

console.log(`\n== SEO audit: ${failures === 0 ? 'PASS' : `${failures} failed`} (${warnings} warnings) ==\n`);
process.exit(failures === 0 ? 0 : 1);
