/**
 * Static reach for a client-side product (PLAN.md §31.6, M5.5).
 *
 * Every tool URL already exists as a React route, but the HTML a crawler gets
 * before JavaScript is an empty `<div id="root">`. This plugin writes a real
 * `dist/<route>.html` for every route: title, description, canonical,
 * Open Graph card, `SoftwareApplication` JSON-LD and visible content (headline,
 * explanation, limits, navigation). React replaces the content on mount, so
 * there is no hydration contract and no duplicate shell.
 *
 * The one-URL-per-tool promise is kept: each route is a directory with its own
 * `index.html`, not a query string or a fragment.
 *
 * `VITE_SITE_ORIGIN` is the origin used in canonical URLs, Open Graph and the
 * sitemap. It defaults to the project origin so a local build is still
 * self-describing; a self-hoster sets it to their own domain.
 */

import { readFile, readdir, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'vite';

export interface PrerenderOptions {
  rootDir: string;
  siteOrigin?: string;
}

interface ToolEntry {
  slug: string;
  name: string;
  description: string;
  category: string;
  categoryLabel: string;
  live: boolean;
}

const DEFAULT_ORIGIN = 'https://pdfshush.app';
/** Live tools get indexable pages; a not-built page is not a search result. */
const NOT_INDEXABLE = new Set(['/account']);
/** These live surfaces upload by design; the static copy must not claim otherwise. */
const REMOTE = new Set(['workflows', 'api', 'mcp']);
const REMOTE_COPY: Record<string, { status: string; how: string }> = {
  workflows: {
    status:
      'Server-run by design. Each step uploads the file to the pdfshush API, which deletes it within an hour of the job finishing. This is not a client-side promise.',
    how: 'Build a recipe, send the file to the pdfshush API, and download the result. The quota and the one-hour retention window are stated on the page.',
  },
  api: {
    status:
      'Server-side by design. An API call uploads the file to the endpoint, and the API deletes the result after the retention window. This docs page stores no document.',
    how: 'Create a key, POST a PDF to `/api/v1`, poll the job and download the result. The per-key quota and deletion window are stated on the page.',
  },
  mcp: {
    status:
      'Runs on your machine, calls the API. The MCP server is a local process; each tool call uploads the file to the pdfshush API for that call, and the API deletes it within an hour.',
    how: 'Launch the local MCP server, point your agent at it, and call a tool. The document is uploaded for that call and deleted on the API schedule.',
  },
};

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Same regular shape as `tests/support/catalog.mjs`; no second list to forget. */
function parseRegistry(source: string): ToolEntry[] {
  const liveBlock = source.slice(source.indexOf('const LIVE'), source.indexOf('const TOOL_NEXT'));
  const live = new Set([...liveBlock.matchAll(/'([a-z0-9-]+)'/g)].map((match) => match[1]));
  const tools: ToolEntry[] = [];
  const categoryPattern =
    /id:\s*'([^']+)',[^\[]*?label:\s*'([^']+)',[^\[]*?tools:\s*\[([\s\S]*?)\n\s{4}\],/g;
  for (const match of source.matchAll(categoryPattern)) {
    const category = match[1] ?? '';
    const categoryLabel = match[2] ?? '';
    const body = match[3] ?? '';
    for (const toolMatch of body.matchAll(
      /tool\('([a-z0-9-]+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*([A-Za-z0-9_]+),\s*'([a-z]+)'\)/g,
    )) {
      tools.push({
        slug: toolMatch[1]!,
        name: toolMatch[2]!,
        description: toolMatch[3]!,
        category,
        categoryLabel,
        live: live.has(toolMatch[1]!),
      });
    }
  }
  return tools;
}

const STYLE = `
.pre-shell{max-width:68rem;margin:0 auto;padding:1.5rem 1.25rem 3rem;color:#1c1917;background:#fbfaf8;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.6}
.pre-header{display:flex;flex-wrap:wrap;gap:1rem;align-items:center;justify-content:space-between;border-bottom:1px solid #ded9d2;padding-bottom:1rem}
.pre-brand{font-weight:700;font-size:1.25rem;color:#1c1917;text-decoration:none}
.pre-nav{display:flex;flex-wrap:wrap;gap:1rem;font-size:.9rem}
.pre-nav a{color:#0f766e;text-decoration:none}
.pre-main{padding:2.5rem 0}
.pre-kicker{text-transform:uppercase;letter-spacing:.12em;font-size:.72rem;font-weight:700;color:#0f766e;margin:0 0 .5rem}
.pre-main h1{font-size:clamp(2rem,6vw,3.5rem);line-height:1.05;margin:0 0 1rem;letter-spacing:-.02em}
.pre-lead{font-size:1.15rem;max-width:46rem;color:#44403c;margin:0 0 1rem}
.pre-note{border-left:3px solid #0f766e;padding:.6rem .9rem;background:#f1f5f3;max-width:46rem;font-size:.95rem}
.pre-main h2{font-size:1.15rem;margin:2rem 0 .5rem}
.pre-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(15rem,1fr));gap:.75rem;padding:0;list-style:none;margin:1rem 0}
.pre-list a{display:block;border:1px solid #ded9d2;border-radius:.6rem;padding:.75rem .9rem;text-decoration:none;color:#1c1917;background:#fff}
.pre-list span{display:block;color:#57534e;font-size:.85rem}
.pre-footer{border-top:1px solid #ded9d2;padding-top:1.25rem;font-size:.85rem;color:#57534e}
.pre-footer a{color:#0f766e;text-decoration:none;margin-right:1rem}
@media(prefers-color-scheme:dark){.pre-shell{background:#0c0a09;color:#f5f5f4}.pre-brand{color:#f5f5f4}.pre-lead{color:#d6d3d1}.pre-note{background:#1c1917}.pre-list a{background:#1c1917;border-color:#292524;color:#f5f5f4}.pre-list span,.pre-footer{color:#a8a29e}}
.pre-boot{min-height:100vh;min-height:100svh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.375rem;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:inherit}
.pre-boot-brand{font-size:1.25rem;font-weight:700;letter-spacing:-.02em}
.pre-boot-note{font-size:.875rem;opacity:.65}
`.trim();

function header(): string {
  return `<header class="pre-header"><a class="pre-brand" href="/">pdfshush</a><nav class="pre-nav" aria-label="Primary"><a href="/#all-tools">All tools</a><a href="/workflows">Workflows</a><a href="/trust">Privacy</a><a href="/verify">Verify a redaction</a></nav></header>`;
}

function footer(): string {
  return `<footer class="pre-footer"><a href="/">Home</a><a href="/trust">How privacy is proven</a><a href="/verify">Redaction verifier</a><a href="/workflows">Workflows</a><p>pdfshush runs in your browser. Files are not uploaded to a server.</p></footer>`;
}

function relatedTools(tool: ToolEntry, tools: ToolEntry[]): ToolEntry[] {
  return tools
    .filter((entry) => entry.live && entry.slug !== tool.slug && entry.category === tool.category)
    .slice(0, 3)
    .concat(tools.filter((entry) => entry.live && entry.slug !== tool.slug && entry.category !== tool.category))
    .slice(0, 4);
}

function toolPage(tool: ToolEntry, tools: ToolEntry[]): string {
  const related = relatedTools(tool, tools);
  const remote = REMOTE.has(tool.slug);
  const status = !tool.live
    ? `<p class="pre-note"><strong>Not built.</strong> This page is not a promise with a date. It explains why the tool is missing and points at the closest thing that works today. The live catalog is on the <a href="/#all-tools">home page</a>.</p>`
    : remote
      ? `<p class="pre-note">${escapeHtml(REMOTE_COPY[tool.slug]?.status ?? 'Server-run by design. The file is uploaded for the job and deleted on the API schedule.')}</p>`
      : `<p class="pre-note"><strong>Private by construction.</strong> The PDF is parsed inside this browser tab. Nothing is uploaded, and there is no account or quota for this tool.</p>`;
  const how = !tool.live
    ? ''
    : remote
      ? `<h2>How it works</h2><p>${escapeHtml(REMOTE_COPY[tool.slug]?.how ?? 'Send the file to the pdfshush API and download the result; the API deletes it on its stated schedule.')}</p>`
      : `<h2>How it works</h2><ol><li>Choose a PDF from this device.</li><li>The engine reads and writes it inside a worker in this tab.</li><li>Download the result; the bytes never leave the browser.</li></ol>`;
  return `<div class="pre-shell">${header()}<main class="pre-main">
<p class="pre-kicker">${escapeHtml(tool.categoryLabel)}</p>
<h1>${escapeHtml(tool.name)}</h1>
<p class="pre-lead">${escapeHtml(tool.description)}</p>
${status}
${how}
<h2>Limits, stated up front</h2>
<p>${!tool.live ? 'This tool is not built, so it has no limits to state; the live alternatives below state theirs.' : remote ? 'Server-run surfaces have their own quota and retention window, stated on the page. A refusal names the reason and the next step.' : 'Up to 100 MB and 500 pages per file in this browser tab. A refusal names the reason and the next step, and the editor’s measured limits are listed inside the tool rather than hidden in documentation.'}</p>
${related.length > 0 ? `<h2>Related tools</h2><ul class="pre-list">${related.map((entry) => `<li><a href="/tools/${entry.slug}">${escapeHtml(entry.name)}<span>${escapeHtml(entry.description)}</span></a></li>`).join('')}</ul>` : ''}
</main>${footer()}</div>`;
}

function homePage(tools: ToolEntry[]): string {
  const categories = new Map<string, ToolEntry[]>();
  for (const tool of tools.filter((entry) => entry.live)) {
    const list = categories.get(tool.categoryLabel) ?? [];
    list.push(tool);
    categories.set(tool.categoryLabel, list);
  }
  const sections = [...categories.entries()]
    .map(
      ([label, entries]) =>
        `<h2>${escapeHtml(label)}</h2><ul class="pre-list">${entries
          .map(
            (entry) =>
              `<li><a href="/tools/${entry.slug}">${escapeHtml(entry.name)}<span>${escapeHtml(entry.description)}</span></a></li>`,
          )
          .join('')}</ul>`,
    )
    .join('');
  return `<div class="pre-shell">${header()}<main class="pre-main">
<p class="pre-kicker">Free · private · in your browser</p>
<h1>PDF tools that keep the file on your device.</h1>
<p class="pre-lead">Merge, organize, convert, redact and edit PDF files without uploading them. Every client-side tool runs in a worker in this tab; server-run surfaces (workflows, API, MCP) say so and state their quota, and the Content-Security-Policy has no origin a client tool could upload to.</p>
<p class="pre-note"><strong>Verifiable, not a slogan.</strong> The policy is part of the build, the service worker keeps the shell available offline, and <a href="/verify">the verifier</a> prints a SHA-256 receipt for any redacted PDF.</p>
${sections}
</main>${footer()}</div>`;
}

/**
 * The first paint of `/`, for a browser that runs JavaScript.
 *
 * The prerendered catalog below is real content for crawlers and for visitors
 * without JavaScript, but it used to be the first thing every browser painted:
 * a complete, separately styled tools directory stayed on screen until the
 * module graph had downloaded and React had replaced it. Opening the app
 * therefore *looked* like it had navigated to the wrong page first.
 *
 * The catalog now lives inside `<noscript>` (same bytes, same links, so no-JS
 * reach is unchanged) and a JS visitor gets this small branded shell until
 * React mounts. It deliberately has no timer, redirect or fake progress: the
 * app replaces it as soon as the real route is ready.
 */
function startupShell(): string {
  return '<div class="pre-boot" role="status" aria-live="polite"><span class="pre-boot-brand">pdfshush</span><span class="pre-boot-note">Loading…</span></div>';
}

function simplePage(
  title: string,
  lead: string,
  body: string,
): string {
  return `<div class="pre-shell">${header()}<main class="pre-main"><p class="pre-kicker">pdfshush</p><h1>${escapeHtml(title)}</h1><p class="pre-lead">${escapeHtml(lead)}</p><p class="pre-note">${body}</p></main>${footer()}</div>`;
}

function jsonLd(origin: string, route: string, tool?: ToolEntry): string {
  const url = `${origin}${route}`;
  const application = tool
    ? tool.live
      ? {
          '@context': 'https://schema.org',
          '@type': 'SoftwareApplication',
          name: tool.name,
          description: tool.description,
          url,
          applicationCategory: 'UtilitiesApplication',
          operatingSystem: 'Web',
          offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
          isAccessibleForFree: true,
          featureList: 'Runs entirely in the browser; no upload; no account.',
        }
      : {
          '@context': 'https://schema.org',
          '@type': 'WebPage',
          name: tool.name,
          description: `${tool.name} is not built. This page explains why and points at the closest live alternative.`,
          url,
          isPartOf: { '@type': 'WebSite', name: 'pdfshush', url: origin },
        }
    : {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: 'pdfshush',
        url: origin,
        description:
          'Private PDF tools that run in your browser: merge, organize, convert, redact and edit without uploading.',
      };
  return `<script type="application/ld+json">${JSON.stringify(application)}</script>`;
}

function withHead(
  html: string,
  options: {
    title: string;
    description: string;
    route: string;
    origin: string;
    image: string;
    indexable: boolean;
    jsonLd: string;
  },
): string {
  const { title, description, route, origin, image, indexable, jsonLd } = options;
  const url = `${origin}${route}`;
  let next = html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(title)}</title>`)
    .replace(
      /<meta\s+name="description"[^>]*>/,
      `<meta name="description" content="${escapeHtml(description)}" />`,
    )
    .replace(
      /<meta\s+property="og:title"[^>]*>/,
      `<meta property="og:title" content="${escapeHtml(title)}" />`,
    )
    .replace(
      /<meta\s+property="og:description"[^>]*>/,
      `<meta property="og:description" content="${escapeHtml(description)}" />`,
    )
    .replace(
      /<meta\s+name="robots"[^>]*>/,
      `<meta name="robots" content="${indexable ? 'index, follow' : 'noindex, follow'}" />`,
    );
  const tags = [
    `<link rel="canonical" href="${escapeHtml(url)}" />`,
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
    `<meta property="og:image" content="${escapeHtml(`${origin}${image}`)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(`${origin}${image}`)}" />`,
    jsonLd,
    `<style>${STYLE}</style>`,
  ].join('\n    ');
  next = next.replace('</head>', `    ${tags}\n  </head>`);
  return next;
}

/**
 * The 404 document.
 *
 * A static host serves a top-level `404.html` with a real 404 status for any
 * path it cannot match. Without one, Cloudflare Pages falls back to serving
 * the app shell with a **200** -- a soft 404, which tells a crawler the URL
 * exists and is content. That is the kind of quiet dishonesty this product
 * does not ship.
 *
 * Every route the app knows is prerendered (63 of them), so this file is only
 * ever reached by a URL that does not exist. The copy matches the client's own
 * NotFound page so a no-JS visitor sees the same thing.
 */
function notFoundDocument(template: string): string {
  return template
    .replace(/<title>[\s\S]*?<\/title>/, '<title>Page not found | pdfshush</title>')
    .replace(
      /<meta\s+name="description"[^>]*>/,
      '<meta name="description" content="This page does not exist. The full pdfshush catalog is one click away." />',
    )
    .replace(/<meta\s+name="robots"[^>]*>/, '<meta name="robots" content="noindex, follow" />')
    .replace(
      '<div id="root"></div>',
      `<div id="root">${simplePage(
        'This page went missing',
        'The link may be old, or the tool has not shipped yet.',
        'The full catalog is one click away.',
      )}</div>`,
    );
}

export function prerenderPlugin(options: PrerenderOptions): Plugin {
  return {
    name: 'pdfshush-prerender',
    apply: 'build',
    async closeBundle() {
      const dist = path.resolve(options.rootDir, 'dist');
      const origin = (options.siteOrigin || DEFAULT_ORIGIN).replace(/\/$/, '');
      const template = await readFile(path.join(dist, 'index.html'), 'utf8');
      const registry = await readFile(
        path.resolve(options.rootDir, 'src/tools/registry.ts'),
        'utf8',
      );
      const tools = parseRegistry(registry);

      const routes: {
        route: string;
        title: string;
        description: string;
        html: string;
        image: string;
        indexable: boolean;
        tool?: ToolEntry;
      }[] = [
        {
          route: '/',
          title: 'pdfshush: Free, private PDF tools that run in your browser',
          description:
            'Merge, split, edit, sign and redact PDFs in your browser. Your files never leave your device: nothing is uploaded, stored or seen. Free, no sign-up.',
          html: homePage(tools),
          image: '/og/home.png',
          indexable: true,
        },
        {
          route: '/workflows',
          title: 'Workflows - chain PDF tools and re-run them | pdfshush',
          description:
            'Chain pdfshush tools into a recipe and run it again on new files. Server-run workflows state their quota; client tools stay on your device.',
          html: simplePage(
            'Workflows',
            'Chain tools into a recipe and run it again on new files.',
            'Workflows are server-run and state their quota. A client-side tool in a recipe still runs in the browser; the API and MCP pages document the server path.',
          ),
          image: '/og/home.png',
          indexable: true,
        },
        {
          route: '/trust',
          title: 'How pdfshush proves privacy | pdfshush',
          description:
            'The Content-Security-Policy is part of the build, the service worker is versioned, and the trust page runs a live proof with zero body-bearing requests.',
          html: simplePage(
            'How privacy is proven',
            'The policy is in the HTML the browser enforces, the worker is versioned, and the proof runs a real job.',
            'The trust page reads the live policy, reports the service worker state, and lists what the proof cannot see. It does not ask you to take the copy on faith.',
          ),
          image: '/og/home.png',
          indexable: true,
        },
        {
          route: '/verify',
          title: 'Verify a redacted PDF | pdfshush',
          description:
            'Run the same independent verifier the Redact tool requires before export on any PDF, and get a SHA-256 receipt with the exact bytes.',
          html: simplePage(
            'Verify a redacted PDF',
            'The verifier the Redact tool trusts, exposed for any file.',
            'It reports what it can and cannot decide: with no marked regions it says the marks were not checked, and it never upgrades a vacuous pass. The receipt has no timestamp, so the same bytes produce the same text.',
          ),
          image: '/og/home.png',
          indexable: true,
        },
        {
          route: '/account',
          title: 'Account - optional sync | pdfshush',
          description:
            'Accounts are optional. Client-side tools work without one; an account only syncs preferences and workflow recipes.',
          html: simplePage(
            'Account (optional)',
            'Client-side tools work without an account.',
            'An account syncs preferences and workflow recipes. It never becomes a condition for editing a local file.',
          ),
          image: '/og/home.png',
          indexable: false,
        },
        ...tools.map((tool) => ({
          route: `/tools/${tool.slug}`,
          title: `${tool.name} - ${tool.live ? 'free and private' : 'not built'} | pdfshush`,
          description: tool.live
            ? `${tool.description} Runs in your browser; the file is not uploaded.`
            : `${tool.name} is not built. This page explains why and points at the closest live alternative.`,
          html: toolPage(tool, tools),
          image: `/og/${tool.slug}.png`,
          indexable: tool.live,
          tool,
        })),
      ];

      for (const entry of routes) {
        // Root only: a tool route's static copy already describes the page the
        // visitor asked for, so it is not the wrong page flashing by. The home
        // document is the one that must not paint the whole catalog first.
        const staticBody =
          entry.route === '/'
            ? `${startupShell()}<noscript>${entry.html}</noscript>`
            : entry.html;
        const html = withHead(template, {
          title: entry.title,
          description: entry.description,
          route: entry.route,
          origin,
          image: entry.image,
          indexable: entry.indexable && !NOT_INDEXABLE.has(entry.route),
          jsonLd: jsonLd(origin, entry.route, entry.tool),
        }).replace(
          '<div id="root"></div>',
          `<div id="root">${staticBody}</div>`,
        );
        // A flat `<route>.html`, not `<route>/index.html`.
        //
        // Cloudflare Pages (like Netlify and most static hosts) resolves a
        // directory's `index.html` only at the *trailing-slash* URL: a request
        // for `/tools/merge-pdf` is 308-redirected to `/tools/merge-pdf/`. Every
        // canonical URL and every sitemap entry would then point at a
        // redirect, which is exactly the kind of quiet SEO damage this product
        // does not ship. A flat file is served at the extension-less path with a
        // 200, so the URL we publish is the URL the visitor gets.
        const file =
          entry.route === '/'
            ? path.join(dist, 'index.html')
            : path.join(dist, `${entry.route}.html`);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, html);
      }

      const sitemapRoutes = routes.filter(
        (entry) => entry.indexable && !NOT_INDEXABLE.has(entry.route),
      );
      const sitemap = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...sitemapRoutes.map(
          (entry) => `  <url><loc>${origin}${entry.route}</loc></url>`,
        ),
        '</urlset>',
        '',
      ].join('\n');
      await writeFile(path.join(dist, 'sitemap.xml'), sitemap);
      await writeFile(
        path.join(dist, 'robots.txt'),
        ['User-agent: *', 'Allow: /', 'Disallow: /account', 'Disallow: /api/', `Sitemap: ${origin}/sitemap.xml`, ''].join('\n'),
      );
      // A top-level 404.html, so a static host answers an unknown URL with a
      // real 404 status instead of the app shell and a 200.
      await writeFile(path.join(dist, '404.html'), notFoundDocument(template));

      const assetCount = (await readdir(dist, { withFileTypes: true })).length;
      this.warn(
        `prerendered ${routes.length} routes, ${sitemapRoutes.length} in the sitemap (origin ${origin}, ${assetCount} top-level entries)`,
      );
    },
  };
}

/**
 * `vite preview` uses the SPA fallback, so it would answer `/tools/merge-pdf`
 * with the root document even though the prerendered file exists. Static
 * hosts serve `route.html` at the extension-less path; this makes the local
 * preview match them so the reach suite tests the bytes a crawler gets.
 */
export function prerenderedRoutesPlugin(rootDir: string): Plugin {
  return {
    name: 'pdfshush-prerendered-routes',
    apply: 'serve',
    configurePreviewServer(server) {
      server.middlewares.use(async (request, _response, next) => {
        try {
          const url = new URL(request.url ?? '/', 'http://preview.local');
          if (url.pathname === '/' || url.pathname.includes('.')) return next();
          const clean = url.pathname.replace(/\/$/, '');
          // The prerendered file is flat (`/tools/merge-pdf.html`), which is how
          // a static host resolves the extension-less path.
          const candidate = path.join(rootDir, 'dist', `${clean}.html`);
          await access(candidate);
          request.url = `${clean}.html${url.search}`;
        } catch {
          /* not a prerendered route; let the SPA fallback handle it */
        }
        next();
      });
    },
  };
}
