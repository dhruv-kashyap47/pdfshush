/**
 * Reach E2E (PLAN.md §31.6, M5.5).
 *
 * Checks the HTML a crawler gets with JavaScript disabled. It is deliberately
 * not a browser test: the claim is about the bytes on the wire. Every live tool
 * route needs a title, canonical, description, an h1, visible text and
 * `SoftwareApplication` JSON-LD; the sitemap must list the live routes and omit
 * the not-built ones; the OG card must be a real PNG.
 *
 *   pnpm build && pnpm preview
 *   pnpm test:e2e:reach
 */

const BASE = (process.env.E2E_BASE_URL ?? 'http://localhost:4173').replace(/\/$/, '');

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures += 1;
}

async function text(path) {
  const response = await fetch(`${BASE}${path}`, { redirect: 'follow' });
  return { status: response.status, body: await response.text() };
}

function first(html, pattern) {
  return html.match(pattern)?.[1]?.trim() ?? null;
}

const ROOT_CONTENT = /<div id="root">([\s\S]*)<\/div>\s*<\/body>/;

function rootText(html) {
  const content = first(html, ROOT_CONTENT) ?? '';
  return content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

const home = await text('/');
if (home.status !== 200) {
  console.error(`[reach] ${BASE} is not reachable; run pnpm build && pnpm preview`);
  process.exit(2);
}

const origin = first(home.body, /rel="canonical" href="([^"]+)"/)?.replace(/\/$/, '');
check('home has a canonical origin', Boolean(origin), origin ?? 'missing');

const sitemap = await text('/sitemap.xml');
const sitemapUrls = [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
check('sitemap is served as XML', sitemap.status === 200 && sitemap.body.includes('<urlset'));

const robots = await text('/robots.txt');
check('robots.txt points at the sitemap', robots.body.includes(`Sitemap: ${origin}/sitemap.xml`));
check('robots.txt keeps /account out', robots.body.includes('Disallow: /account'));

/* Discover routes from the registry through the sitemap and the home page. */
const toolLinks = [...home.body.matchAll(/href="\/tools\/([a-z0-9-]+)"/g)].map(
  (match) => match[1],
);
const allTools = [...new Set(toolLinks)];
check('the home page links tools in HTML', allTools.length >= 40, `${allTools.length} links`);

let checkedTools = 0;
let indexedTools = 0;
for (const slug of allTools) {
  const route = `/tools/${slug}`;
  const page = await text(route);
  const html = page.body;
  const title = first(html, /<title>([^<]+)<\/title>/);
  const canonical = first(html, /rel="canonical" href="([^"]+)"/);
  const description = first(html, /<meta name="description" content="([^"]+)"/);
  const h1 = first(html, /<h1>([^<]+)<\/h1>/);
  const visible = rootText(html);
  const robotsMeta = first(html, /<meta name="robots" content="([^"]+)"/);
  const ld = first(html, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  let structured = null;
  try {
    structured = ld ? JSON.parse(ld) : null;
  } catch {
    structured = null;
  }
  const ok =
    page.status === 200 &&
    Boolean(title && canonical && description && h1) &&
    visible.length > 200 &&
    (structured?.['@type'] === 'SoftwareApplication' || robotsMeta?.includes('noindex'));
  check(`${route} has crawlable content`, ok, `${title ?? 'no title'}, ${h1 ?? 'no h1'}`);
  checkedTools += 1;
  if (robotsMeta?.includes('index')) indexedTools += 1;
}

check(
  'every live tool is in the sitemap',
  allTools.filter((slug) => {
    const page = `${origin}/tools/${slug}`;
    return !sitemapUrls.includes(page);
  }).length === 0,
  `${sitemapUrls.length} URLs`,
);
check(
  'the sitemap has no duplicate URLs',
  new Set(sitemapUrls).size === sitemapUrls.length,
  `${sitemapUrls.length} URLs`,
);

const declined = ['pdf-to-word', 'ocr-pdf', 'deskew', 'sign-workflow', 'convert-batch'];
for (const slug of declined) {
  const route = `/tools/${slug}`;
  const page = await text(route);
  if (page.status !== 200) {
    check(`${route} exists as an honest not-built page`, false, `HTTP ${page.status}`);
    continue;
  }
  const robotsMeta = first(page.body, /<meta name="robots" content="([^"]+)"/);
  check(`${route} is not indexed while unbuilt`, robotsMeta?.includes('noindex') === true, robotsMeta ?? 'missing');
}

const remoteTools = ['workflows', 'api', 'mcp'];
for (const slug of remoteTools) {
  const page = await text(`/tools/${slug}`);
  const body = rootText(page.body);
  check(
    `/tools/${slug} does not claim client-side processing`,
    !/parsed inside this browser tab|never leave the browser|nothing is uploaded/i.test(body),
    body.match(/server|api|upload|delete/i)?.[0] ?? 'no data-path sentence',
  );
  check(
    `/tools/${slug} states its server data path`,
    /api|server|upload|delete/i.test(body),
  );
}

const og = await fetch(`${BASE}/og/merge-pdf.png`);
const ogBytes = new Uint8Array(await og.arrayBuffer());
check(
  'OG card is a real PNG',
  og.status === 200 && ogBytes[0] === 0x89 && ogBytes[1] === 0x50,
  `${ogBytes.byteLength} bytes`,
);

const homeTitle = first(home.body, /<title>([^<]+)<\/title>/);
const homeText = rootText(home.body);
check('home carries real visible text without JS', homeText.length > 500, `${homeText.length} chars`);
check('home has a WebSite JSON-LD block', home.body.includes('"@type":"WebSite"'), homeTitle ?? '');

check('tools checked', checkedTools >= 40, `${checkedTools} (${indexedTools} indexable)`);

console.log(`\n=== reach e2e: ${failures === 0 ? 'all checks passed' : `${failures} failed`} ===`);
process.exit(failures === 0 ? 0 : 1);
