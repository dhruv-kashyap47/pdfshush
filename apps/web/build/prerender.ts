/**
 * Static reach for a client-side product (PLAN.md §31.6, M5.5).
 *
 * Every tool URL already exists as a React route, but the HTML a crawler gets
 * before JavaScript is an empty `<div id="root">`. This plugin writes a real
 * `dist/<route>.html` for every route: title, description, canonical, Open
 * Graph card, Twitter card, hreflang, JSON-LD and visible content (headline,
 * explanation, steps, limits, related links, FAQ).
 *
 * React replaces the content on mount, so there is no hydration contract and no
 * duplicate shell. The one-URL-per-tool promise is kept: each route is a
 * directory with its own `index.html`, not a query string or a fragment.
 *
 * `VITE_SITE_ORIGIN` is the origin used in canonical URLs, Open Graph and the
 * sitemap. It defaults to the public production origin; a self-hoster sets it
 * to their own domain.
 */

import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'vite';
import { faqsFor } from '../src/tools/tool-faqs.ts';
import {
  CATEGORY_BLURBS,
  HOME_DESCRIPTION,
  HOME_FAQS,
  HOME_INTRO,
  HOME_KEYWORDS,
  HOME_TITLE,
  HOME_TOOL_INTRO,
  HOW_IT_WORKS,
  TOOL_BENEFITS,
  USE_CASES,
  WHY_CHOOSE,
} from '../src/seo/home-content.ts';
import { TOOL_SEO, toolSeoFor } from '../src/seo/tool-seo.ts';
import { loadGuides } from './guides.ts';
import { guidePath, type Guide } from '../src/content/guide-format.ts';
import { articleSchema } from '../src/seo/article.ts';
import { LANDING_PAGES, type LandingPage } from '../src/seo/landing-pages.ts';
import { SPONSOR_FAQ, SPONSOR_STATIC_BODY } from '../src/content/sponsor.ts';
import {
  OG_IMAGE_HEIGHT,
  OG_IMAGE_WIDTH,
  SITE_LOCALE,
  SITE_NAME,
  SITE_ORIGIN,
} from '../src/seo/site.ts';
import {
  breadcrumbSchema,
  faqPageSchema,
  organizationSchema,
  softwareApplicationSchema,
  webPageSchema,
  websiteSchema,
} from '../src/seo/schema.ts';

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

const DEFAULT_ORIGIN = SITE_ORIGIN;
/** Live tools get indexable pages; a not-built page is not a search result. */
const NOT_INDEXABLE = new Set(['/account']);
/** These live surfaces upload by design; the static copy must not claim otherwise. */
const REMOTE = new Set(['workflows', 'api', 'mcp']);
const REMOTE_COPY: Record<string, { status: string; how: string }> = {
  workflows: {
    status:
      'Server-run by design. Each step uploads the file to the PDFShush API, which deletes it within an hour of the job finishing. This is not a client-side promise.',
    how: 'Build a recipe, send the file to the PDFShush API, and download the result. The quota and the one-hour retention window are stated on the page.',
  },
  api: {
    status:
      'Server-side by design. An API call uploads the file to the endpoint, and the API deletes the result after the retention window. This docs page stores no document.',
    how: 'Create a key, POST a PDF to `/api/v1`, poll the job and download the result. The per-key quota and deletion window are stated on the page.',
  },
  mcp: {
    status:
      'Runs on your machine, calls the API. The MCP server is a local process; each tool call uploads the file to the PDFShush API for that call, and the API deletes it within an hour.',
    how: 'Launch the local MCP server, point your agent at it, and call a tool. The document is uploaded for that call and deleted on the API schedule.',
  },
};

/**
 * Honest metadata for the seven tools this origin declined. They stay
 * `noindex`; the titles are still unique and descriptive so a visitor who
 * follows an old link sees a real page rather than a generic notice.
 */
const DECLINED_SEO: Record<string, { title: string; description: string }> = {
  'pdf-to-word': {
    title: 'PDF to Word Converter – Status and Alternatives | PDFShush',
    description:
      'PDF to Word is not live on this origin. This page explains the status and points to PDF to Text and other working alternatives. No fake download button.',
  },
  'pdf-to-excel': {
    title: 'PDF to Excel Converter – Status and Alternatives | PDFShush',
    description:
      'PDF to Excel is not live on this origin. This page explains the status and points to PDF to Text, table extraction and working alternatives. No fake download.',
  },
  'pdf-to-ppt': {
    title: 'PDF to PowerPoint – Status and Alternatives | PDFShush',
    description:
      'PDF to PowerPoint is not live on this origin. This page explains the status and points to PDF to JPG and other working alternatives for slides. No fake download',
  },
  'word-to-pdf': {
    title: 'Word to PDF Converter – Status and Alternatives | PDFShush',
    description:
      'Word to PDF is not live on this origin. This page explains the status and points to PDF to Text, JPG to PDF and the working alternatives. No fake download.',
  },
  'html-to-pdf': {
    title: 'HTML to PDF Converter – Status and Alternatives | PDFShush',
    description:
      'HTML to PDF is not live on this origin. This page explains the status and points to PDF to Text and the working browser alternatives. No fake download.',
  },
  'sign-workflow': {
    title: 'Sign and Route PDF – Status and Alternatives | PDFShush',
    description:
      'Sign and route is not live on this origin. This page explains the status and points to Fill & Sign and the working alternatives for collecting signatures.',
  },
  'convert-batch': {
    title: 'Batch Convert PDF – Status and Alternatives | PDFShush',
    description:
      'Batch convert is not live on this origin. This page explains the status and points to Batch run, Compress PDF and the working alternatives for many files.',
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
.pre-shell{max-width:68rem;margin:0 auto;padding:1.5rem 1.25rem 3rem;color:#f5f5f4;background:#0c0a09;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.6}
.pre-header{display:flex;flex-wrap:wrap;gap:1rem;align-items:center;justify-content:space-between;border-bottom:1px solid #292524;padding-bottom:1rem}
.pre-brand{font-weight:700;font-size:1.25rem;color:#f5f5f4;text-decoration:none}
.pre-nav{display:flex;flex-wrap:wrap;gap:1rem;font-size:.9rem}
.pre-nav a{color:#5eead4;text-decoration:none}
.pre-main{padding:2.5rem 0}
.pre-kicker{text-transform:uppercase;letter-spacing:.12em;font-size:.72rem;font-weight:700;color:#5eead4;margin:0 0 .5rem}
.pre-main h1{font-size:clamp(2rem,6vw,3.5rem);line-height:1.05;margin:0 0 1rem;letter-spacing:-.02em}
.pre-lead{font-size:1.15rem;max-width:46rem;color:#d6d3d1;margin:0 0 1rem}
.pre-note{border-left:3px solid #5eead4;padding:.6rem .9rem;background:#1c1917;max-width:46rem;font-size:.95rem}
.pre-main h2{font-size:1.25rem;margin:2rem 0 .5rem}
.pre-main h3{font-size:1rem;margin:1.25rem 0 .4rem}
.pre-main p{max-width:48rem;color:#d6d3d1}
.pre-main ol,.pre-main ul{max-width:48rem;color:#d6d3d1}
.pre-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(15rem,1fr));gap:.75rem;padding:0;list-style:none;margin:1rem 0}
.pre-list a{display:block;border:1px solid #292524;border-radius:.6rem;padding:.75rem .9rem;text-decoration:none;color:#f5f5f4;background:#1c1917}
.pre-list span{display:block;color:#a8a29e;font-size:.85rem}
.pre-faq{margin-top:2.5rem;border-top:1px solid #292524;padding-top:1.25rem;max-width:52rem}
.pre-faq h2{font-size:1.15rem;margin:0}
.pre-faq-lead{color:#a8a29e;font-size:.85rem;margin:.35rem 0 1rem}
.pre-faq details{border-top:1px solid #292524;padding:.65rem 0}
.pre-faq details:last-child{border-bottom:1px solid #292524}
.pre-faq summary{cursor:pointer;color:#f5f5f4}
.pre-faq summary h3{display:inline;font-size:.95rem;margin:0;font-weight:600}
.pre-faq details p{color:#a8a29e;font-size:.92rem;margin:.4rem 0 0;max-width:46rem}
.pre-footer{border-top:1px solid #292524;padding-top:1.25rem;font-size:.85rem;color:#a8a29e}
.pre-footer a{color:#5eead4;text-decoration:none;margin-right:1rem}
.pre-boot{display:none;min-height:100vh;min-height:100svh;flex-direction:column;align-items:center;justify-content:center;gap:.375rem;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:inherit}
html.js .pre-boot{display:flex}
html.js .pre-static{display:none}
.pre-boot-brand{font-size:1.25rem;font-weight:700;letter-spacing:-.02em}
.pre-boot-note{font-size:.875rem;opacity:.65}
`.trim();

function header(): string {
  return `<header class="pre-header"><a class="pre-brand" href="/">PDFShush</a><nav class="pre-nav" aria-label="Primary"><a href="/#all-tools">All tools</a><a href="/compress-pdf">Compress PDF</a><a href="/merge-pdf">Merge PDF</a><a href="/split-pdf">Split PDF</a><a href="/pdf-editor-online-free">Edit PDF</a><a href="/pdf-under-200kb">200 KB guide</a><a href="/trust">Privacy</a><a href="/about">About</a><a href="/contact">Contact</a></nav></header>`;
}

function footer(): string {
  return `<footer class="pre-footer"><a href="/">Home</a><a href="/compress-pdf">Compress PDF</a><a href="/merge-pdf">Merge PDF</a><a href="/split-pdf">Split PDF</a><a href="/pdf-to-jpg">PDF to JPG</a><a href="/jpg-to-pdf">JPG to PDF</a><a href="/unlock-pdf">Unlock PDF</a><a href="/pdf-dark-mode">Dark mode</a><a href="/pdf-tools-no-signup">No signup</a><a href="/trust">How privacy is proven</a><a href="/privacy">Privacy policy</a><a href="/terms">Terms</a><a href="/about">About</a><a href="/contact">Contact</a><a href="/status">Status</a><p>PDFShush runs in your browser. Files are not uploaded for client-side tools.</p></footer>`;
}

function relatedTools(tool: ToolEntry, tools: ToolEntry[]): ToolEntry[] {
  const seoRelated = TOOL_SEO[tool.slug]?.related ?? [];
  return [...new Set([...seoRelated, ...tools.filter((entry) => entry.live && entry.category === tool.category).map((entry) => entry.slug)])]
    .map((slug) => tools.find((entry) => entry.slug === slug))
    .filter((entry): entry is ToolEntry => Boolean(entry) && entry?.live === true && entry.slug !== tool.slug)
    .slice(0, 4);
}

function guidesFor(slug: string): LandingPage[] {
  return LANDING_PAGES.filter(
    (page) => page.toolSlug === slug || page.related.some((link) => link.href === `/tools/${slug}`),
  ).slice(0, 3);
}

/**
 * The FAQ reaches a crawler without JavaScript. The React section replaces it
 * on mount, but the bytes on the wire already contain the questions, the
 * answers and the FAQPage schema.
 */
function faqBlock(
  items: ReadonlyArray<{ question: string; answer: string }>,
  name: string,
  id: string,
): string {
  if (items.length === 0) return '';
  return `<section class="pre-faq" id="faq" aria-labelledby="faq-${id}">
<h2 id="faq-${id}">Frequently asked questions</h2>
<p class="pre-faq-lead">About ${escapeHtml(name)}.</p>
${items
  .map(
    (item) =>
      `<details><summary><h3>${escapeHtml(item.question)}</h3></summary><p>${escapeHtml(item.answer)}</p></details>`,
  )
  .join('\n')}
</section>`;
}

function toolPage(tool: ToolEntry, tools: ToolEntry[], guides: Guide[]): string {
  const related = relatedTools(tool, tools);
  const landingGuides = guidesFor(tool.slug);
  const remote = REMOTE.has(tool.slug);
  const seo = TOOL_SEO[tool.slug] ?? toolSeoFor(tool.slug, tool.name, tool.description);
  const status = !tool.live
    ? `<p class="pre-note"><strong>Coming soon.</strong> This page is not a promise with a date. It explains what the tool will do, why it is not here yet, and points at the closest thing that works today. The live catalog is on the <a href="/#all-tools">home page</a>.</p>`
    : remote
      ? `<p class="pre-note">${escapeHtml(REMOTE_COPY[tool.slug]?.status ?? 'Server-run by design. The file is uploaded for the job and deleted on the API schedule.')}</p>`
      : `<p class="pre-note"><strong>Private by construction.</strong> The PDF is parsed inside this browser tab. Nothing is uploaded, and there is no account or quota for this tool.</p>`;
  const how = !tool.live
    ? ''
    : remote
      ? `<h2>How it works</h2><p>${escapeHtml(REMOTE_COPY[tool.slug]?.how ?? 'Send the file to the PDFShush API and download the result; the API deletes it on its stated schedule.')}</p>`
      : `<h2>How to use ${escapeHtml(seo.h1)}</h2><ol>${seo.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol>`;
  const articleGuides = guides.filter((entry) => entry.frontmatter.relatedTools.includes(tool.slug));
  const guidesBlock =
    landingGuides.length + articleGuides.length > 0
      ? `<h2>Guides</h2><ul class="pre-list">${[
          ...landingGuides.map(
            (guide) =>
              `<li><a href="${guide.path}">${escapeHtml(guide.h1)}<span>${escapeHtml(guide.description)}</span></a></li>`,
          ),
          ...articleGuides.map(
            (guide) =>
              `<li><a href="${guidePath(guide.frontmatter.slug)}">${escapeHtml(guide.frontmatter.title)}<span>${escapeHtml(guide.frontmatter.description)}</span></a></li>`,
          ),
        ].join('')}</ul>`
      : '';
  return `<div class="pre-shell">${header()}<main class="pre-main">
<p class="pre-kicker">${escapeHtml(tool.categoryLabel)}</p>
<h1>${escapeHtml(seo.h1)}</h1>
<p class="pre-lead">${escapeHtml(seo.summary)}</p>
${status}
<p>${escapeHtml(seo.audience)}</p>
${how}
<h2>Good to know</h2>
<p>${
    remote
      ? 'This surface is server-run by design, with a stated quota and retention window. The file is uploaded for the job, not processed in the browser, and the API deletes it on the schedule described on the page.'
      : 'The file is processed inside this browser tab, so there is no upload and no account. Up to 100 MB per file, 250 MB per run and 500 pages, with a lower page cap for tools that rebuild pages as images (redaction, grayscale, dark mode and strong compression).'
  }</p>
${related.length > 0 ? `<h2>Related PDF tools</h2><ul class="pre-list">${related.map((entry) => `<li><a href="/tools/${entry.slug}">${escapeHtml(entry.name)}<span>${escapeHtml(TOOL_BENEFITS[entry.slug] ?? entry.description)}</span></a></li>`).join('')}</ul>` : ''}
${guidesBlock}
${faqBlock(faqsFor(tool.slug), tool.name, tool.slug)}
</main>${footer()}</div>`;
}

function guidesIndexPage(guides: Guide[]): string {
  const categories = new Map<string, Guide[]>();
  for (const guide of guides) {
    const list = categories.get(guide.frontmatter.category) ?? [];
    list.push(guide);
    categories.set(guide.frontmatter.category, list);
  }

  const sections = [...categories.entries()]
    .map(
      ([name, entries]) =>
        `<h2>${escapeHtml(name)}</h2><ul class="pre-list">${entries
          .map(
            (guide) =>
              `<li><a href="${guidePath(guide.frontmatter.slug)}">${escapeHtml(guide.frontmatter.title)}<span>${escapeHtml(guide.frontmatter.description)}</span></a></li>`,
          )
          .join('')}</ul>`,
    )
    .join('\n');

  return `<div class="pre-shell">${header()}<main class="pre-main">
<p class="pre-kicker">Guides</p>
<h1>PDF guides for work that has to be right</h1>
<p class="pre-lead">Redaction that actually removes text, numbering a court production, filling a form a portal will accept.</p>
${sections || '<p>Guides are being written. Check back shortly.</p>'}
</main>${footer()}</div>`;
}

function guidePage(guide: Guide, all: Guide[]): string {
  const fm = guide.frontmatter;
  const toc = guide.headings.filter((heading) => heading.level === 2);
  const relatedTools = fm.relatedTools
    .map(
      (slug) =>
        `<li><a href="/tools/${slug}">${escapeHtml(slug.replace(/-/g, ' '))}</a></li>`,
    )
    .join('');
  const relatedGuides = (
    fm.relatedGuides.length > 0
      ? fm.relatedGuides
          .map((slug) => all.find((entry) => entry.frontmatter.slug === slug))
          .filter((entry): entry is Guide => Boolean(entry))
      : all.filter((entry) => entry.frontmatter.slug !== fm.slug).slice(0, 2)
  )
    .map(
      (entry) =>
        `<li><a href="${guidePath(entry.frontmatter.slug)}">${escapeHtml(entry.frontmatter.title)}</a></li>`,
    )
    .join('');

  return `<div class="pre-shell">${header()}<main class="pre-main">
<p class="pre-kicker"><a href="/guides">Guides</a> / ${escapeHtml(fm.category)}</p>
<h1>${escapeHtml(fm.title)}</h1>
<p class="pre-lead">${escapeHtml(fm.description)}</p>
<p class="pre-note">${escapeHtml(fm.category)} · <time datetime="${escapeHtml(fm.publishedAt)}">${escapeHtml(fm.publishedAt)}</time> · ${guide.minutes} min read</p>
${
  toc.length >= 3
    ? `<h2>On this page</h2><ol>${toc
        .map((heading) => `<li><a href="#${heading.id}">${escapeHtml(heading.title)}</a></li>`)
        .join('')}</ol>`
    : ''
}
${guide.html}
${relatedTools ? `<h2>Do it now, in your browser</h2><ul class="pre-list">${relatedTools}</ul>` : ''}
${relatedGuides ? `<h2>Related reading</h2><ul class="pre-list">${relatedGuides}</ul>` : ''}
</main>${footer()}</div>`;
}

function homePage(tools: ToolEntry[]): string {
  const categoryOrder = [...new Set(tools.map((tool) => tool.category))];
  const toolSections = categoryOrder
    .map((category) => {
      const entries = tools.filter((entry) => entry.live && entry.category === category);
      if (entries.length === 0) return '';
      const label = entries[0]!.categoryLabel;
      const links = entries
        .map((entry) => `<a href="/tools/${entry.slug}">${escapeHtml(entry.name)}</a>`)
        .join(', ');
      return `<h3>${escapeHtml(label)}</h3><p>${escapeHtml(CATEGORY_BLURBS[category] ?? 'Open a tool and start.')}</p><p>${links}</p>`;
    })
    .join('');

  return `<div class="pre-shell pre-static">${header()}<main class="pre-main">
<p class="pre-kicker">Free · private · in your browser</p>
<h1>Free Online PDF Tools That Stay on Your Device</h1>
<p class="pre-lead">${escapeHtml(HOME_DESCRIPTION)}</p>
<p>${escapeHtml(HOME_INTRO[0]!)}</p>
<p>${escapeHtml(HOME_INTRO[1]!)}</p>
<p>${escapeHtml(HOME_TOOL_INTRO)}</p>
<h2>All free PDF tools</h2>
${toolSections}
<h2>Why people use PDFShush</h2>
${WHY_CHOOSE.map((item) => `<h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.body)}</p>`).join('\n')}
<h2>What people use it for</h2>
${USE_CASES.map((item) => `<h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.body)}</p>`).join('\n')}
<h2>How it works</h2>
<ol>${HOW_IT_WORKS.map((step) => `<li><strong>${escapeHtml(step.title)}</strong> ${escapeHtml(step.body)}</li>`).join('')}</ol>
${faqBlock(HOME_FAQS, 'PDFShush', 'home')}
</main>${footer()}</div>`;
}

function landingPage(page: LandingPage): string {
  return `<div class="pre-shell">${header()}<main class="pre-main">
<p class="pre-kicker">Free · no signup · in your browser</p>
<h1>${escapeHtml(page.h1)}</h1>
${page.intro.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('\n')}
<p><a href="/tools/${page.toolSlug}">${escapeHtml(page.toolCta)}</a></p>
${page.sections
  .map(
    (section) =>
      `<h2>${escapeHtml(section.heading)}</h2>${(section.paragraphs ?? []).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')}${section.bullets ? `<ul>${section.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join('')}</ul>` : ''}`,
  )
  .join('\n')}
<h2>How it works in three steps</h2>
<ol>${page.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol>
${faqBlock(page.faqs, page.h1, page.path.replace(/\//g, ''))}
<h2>Keep going</h2>
<ul>${page.related.map((link) => `<li><a href="${link.href}">${escapeHtml(link.label)}</a></li>`).join('')}</ul>
</main>${footer()}</div>`;
}

function startupShell(): string {
  return '<div class="pre-boot" role="status" aria-live="polite"><span class="pre-boot-brand">PDFShush</span><span class="pre-boot-note">Loading…</span></div>';
}

function simplePage(title: string, lead: string, body: string): string {
  // A `div`, not a `p`: `body` is trusted HTML and some pages put a list or an
  // FAQ block inside it. A paragraph wrapper would be closed by the parser at
  // the first block element and the copy would fall out of its container.
  return `<div class="pre-shell">${header()}<main class="pre-main"><p class="pre-kicker">PDFShush</p><h1>${escapeHtml(title)}</h1><p class="pre-lead">${escapeHtml(lead)}</p><div class="pre-note">${body}</div></main>${footer()}</div>`;
}

function withHead(
  html: string,
  options: {
    title: string;
    description: string;
    route: string;
    origin: string;
    image: string;
    imageAlt: string;
    keywords: string[];
    indexable: boolean;
    type: 'website' | 'article';
    jsonLd: string;
  },
): string {
  const {
    title,
    description,
    route,
    origin,
    image,
    imageAlt,
    keywords,
    indexable,
    type,
    jsonLd,
  } = options;
  const url = `${origin}${route === '/' ? '/' : route}`;
  const imageUrl = `${origin}${image}`;

  // Start from the base document and remove every SEO tag it carries, so a
  // route never ships two canonicals or a stale Open Graph image.
  let next = html
    .replace(/<link rel="canonical"[^>]*>\s*/g, '')
    .replace(/<link rel="alternate" hreflang="[^"]*"[^>]*>\s*/g, '')
    .replace(/<meta\s+property="og:[^"]*"[^>]*>\s*/g, '')
    .replace(/<meta\s+name="twitter:[^"]*"[^>]*>\s*/g, '')
    .replace(/<meta\s+name="keywords"[^>]*>\s*/g, '')
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(title)}</title>`)
    .replace(
      /<meta\s+name="description"[^>]*>/,
      `<meta name="description" content="${escapeHtml(description)}" />`,
    )
    .replace(
      /<meta\s+name="robots"[^>]*>/,
      `<meta name="robots" content="${indexable ? 'index, follow, max-image-preview:large' : 'noindex, follow'}" />`,
    );

  const tags = [
    `<meta name="keywords" content="${escapeHtml(keywords.join(', '))}" />`,
    `<link rel="canonical" href="${escapeHtml(url)}" />`,
    `<link rel="alternate" hreflang="en" href="${escapeHtml(url)}" />`,
    `<link rel="alternate" hreflang="x-default" href="${escapeHtml(url)}" />`,
    `<meta property="og:type" content="${type}" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
    `<meta property="og:image" content="${escapeHtml(imageUrl)}" />`,
    `<meta property="og:image:alt" content="${escapeHtml(imageAlt)}" />`,
    `<meta property="og:image:width" content="${OG_IMAGE_WIDTH}" />`,
    `<meta property="og:image:height" content="${OG_IMAGE_HEIGHT}" />`,
    `<meta property="og:locale" content="${SITE_LOCALE}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(imageUrl)}" />`,
    `<meta name="twitter:image:alt" content="${escapeHtml(imageAlt)}" />`,
    jsonLd,
    `<script>document.documentElement.classList.add('js')</script>`,
    `<style>${STYLE}</style>`,
  ].join('\n    ');
  next = next.replace('</head>', `    ${tags}\n  </head>`);
  return next;
}

function notFoundDocument(template: string): string {
  return template
    .replace(/<title>[\s\S]*?<\/title>/, '<title>Page not found | PDFShush</title>')
    .replace(
      /<meta\s+name="description"[^>]*>/,
      '<meta name="description" content="This page does not exist. The full PDFShush catalog is one click away." />',
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
      // Published guides only: a draft is never prerendered and never sitemapped.
      const guides = loadGuides(options.rootDir);
      const buildDate = new Date().toISOString().slice(0, 10);

      const routes: {
        route: string;
        title: string;
        description: string;
        html: string;
        image: string;
        imageAlt: string;
        keywords: string[];
        indexable: boolean;
        type: 'website' | 'article';
        tool?: ToolEntry;
        landing?: LandingPage;
        guide?: Guide;
      }[] = [
        {
          route: '/',
          title: HOME_TITLE,
          description: HOME_DESCRIPTION,
          html: homePage(tools),
          image: '/og/home.png',
          imageAlt: 'PDFShush free online PDF tools: compress, merge, split and edit PDFs',
          keywords: HOME_KEYWORDS,
          indexable: true,
          type: 'website',
        },
        {
          route: '/workflows',
          title: 'PDF Workflows – Automate and Re-Run PDF Tasks | PDFShush',
          description:
            'Chain PDF tools into a saved workflow recipe and re-run it on new files. Workflows are server-run, with a stated quota and a one-hour deletion window.',
          html: simplePage(
            'PDF Workflows – Chain Tools and Re-Run',
            'Chain tools into a recipe and run it again on new files.',
            'Workflows are server-run and state their quota. A client-side tool in a recipe still runs in the browser; the API and MCP pages document the server path.',
          ),
          image: '/og/workflows.png',
          imageAlt: 'PDFShush workflows – chain PDF tools and re-run them',
          keywords: ['pdf workflow', 'automate pdf tasks', 'pdf pipeline'],
          indexable: true,
          type: 'website',
        },
        {
          route: '/trust',
          title: 'How PDFShush Proves Privacy – Live Proof | PDFShush',
          description:
            'The Content-Security-Policy is part of the build, the service worker is versioned, and the trust page runs a live proof with zero body-bearing requests.',
          html: simplePage(
            'How privacy is proven',
            'The policy is in the HTML the browser enforces, the worker is versioned, and the proof runs a real job.',
            'The trust page reads the live policy, reports the service worker state, and lists what the proof cannot see. It does not ask you to take the copy on faith.',
          ),
          image: '/og/home.png',
          imageAlt: 'How PDFShush proves that PDF files are not uploaded',
          keywords: ['private pdf tools in browser', 'pdf privacy', 'no upload pdf tools'],
          indexable: true,
          type: 'website',
        },
        {
          route: '/verify',
          title: 'Verify a Redacted PDF – SHA-256 Receipt | PDFShush',
          description:
            'Run the same independent verifier the Redact tool uses on any PDF and get a SHA-256 receipt of the exact bytes it checked, plus what it could not check.',
          html: simplePage(
            'Verify a redacted PDF',
            'The verifier the Redact tool trusts, exposed for any file.',
            'It reports what it can and cannot decide: with no marked regions it says the marks were not checked, and it never upgrades a vacuous pass. The receipt has no timestamp, so the same bytes produce the same text.',
          ),
          image: '/og/home.png',
          imageAlt: 'PDFShush redaction verifier with a SHA-256 receipt',
          keywords: ['verify redacted pdf', 'pdf redaction verifier', 'sha256 pdf'],
          indexable: true,
          type: 'website',
        },
        {
          route: '/privacy',
          title: 'Privacy Policy – Files Stay on Your Device | PDFShush',
          description:
            'How PDFShush handles your data: what stays in the browser, the narrow cases where data can leave it, and how to remove local history, drafts and signatures.',
          html: simplePage(
            'Privacy policy',
            'Your files stay on your device.',
            'The ordinary tools run in the browser with no upload. AI features send only what you ask about, only to the provider you configure. Local history, drafts and signatures can be cleared in your browser. This deployment has no server tier.',
          ),
          image: '/og/home.png',
          imageAlt: 'PDFShush privacy policy – PDF tools that run in your browser',
          keywords: ['pdfshush privacy', 'private pdf tools', 'pdf tools no upload'],
          indexable: true,
          type: 'website',
        },
        {
          route: '/terms',
          title: 'Terms of Use – Free, Open Source PDF Tools | PDFShush',
          description:
            'The plain-language terms for using PDFShush: free, open source, provided as-is, with your documents always staying yours and no account is ever required.',
          html: simplePage(
            'Terms of use',
            'Free, open source, and provided as-is.',
            'You keep ownership of your documents. The software is provided without warranties; mandatory consumer rights are not limited. The AGPL-3.0-or-later licence governs copying, modification and redistribution.',
          ),
          image: '/og/home.png',
          imageAlt: 'PDFShush terms of use',
          keywords: ['pdfshush terms', 'free pdf tools terms'],
          indexable: true,
          type: 'website',
        },
        {
          route: '/about',
          title: 'About PDFShush – Free, Private, Open-Source PDF Tools',
          description:
            'Why PDFShush exists: ordinary PDF tasks should not require uploading the document. An independent, open-source workspace with 51 live client-side tools.',
          html: simplePage(
            'About PDFShush',
            'PDF tools without the upload.',
            'An independent, open-source PDF workspace. The browser does the work; the catalog is honest about the seven tools it declined; the server tier is parked rather than offered and left to fail.',
          ),
          image: '/og/home.png',
          imageAlt: 'About PDFShush – an open-source PDF workspace',
          keywords: ['about pdfshush', 'open source pdf tools', 'private pdf workspace'],
          indexable: true,
          type: 'website',
        },
        {
          route: '/contact',
          title: 'Contact PDFShush – Support and Security | PDFShush',
          description:
            'Email foundersoffice@proton.me, open a GitHub issue for a reproducible bug, or use the private security advisory form for a security vulnerability report.',
          html: simplePage(
            'Contact PDFShush',
            'Email is the reliable route; GitHub is best for a reproducible bug.',
            'Write to foundersoffice@proton.me. Do not attach a real document to a public issue; a small synthetic PDF is enough. Security reports go through the private advisory form.',
          ),
          image: '/og/home.png',
          imageAlt: 'Contact PDFShush',
          keywords: ['contact pdfshush', 'pdfshush support'],
          indexable: true,
          type: 'website',
        },
        {
          route: '/sponsor',
          title: 'Sponsor PDFShush – Two Slots, No Ad Network | PDFShush',
          description:
            'Put your product in front of people who care about document privacy. Two first-party sponsor slots, no scripts and no tracking. Founding rates from $19/month.',
          html: simplePage(
            'Sponsor PDFShush',
            'Two first-party slots. No ad network, no script, no tracking.',
            `${SPONSOR_STATIC_BODY}${faqBlock(
              SPONSOR_FAQ.map((entry) => ({ question: entry.q, answer: entry.a })),
              'sponsorship at PDFShush',
              'sponsor',
            )}`,
          ),
          image: '/og/home.png',
          imageAlt: 'Sponsor PDFShush – first-party sponsor slots',
          keywords: ['sponsor pdfshush', 'pdf tool sponsorship', 'privacy friendly sponsorship'],
          indexable: true,
          type: 'website',
        },
        {
          route: '/status',
          title: 'Service Status – All Client PDF Tools Online | PDFShush',
          description:
            'The static app and all 51 client-side PDF tools are operational. Accounts, workflows, the REST API and MCP are not deployed on this origin. No login needed.',
          html: simplePage(
            'Service status',
            'The static app and its client tools are operational.',
            'This is a static status note, not a live monitoring dashboard. The server-backed surfaces are intentionally off; /api/* answers a JSON 404. The trust page and verifier let you check the privacy and redaction claims yourself.',
          ),
          image: '/og/home.png',
          imageAlt: 'PDFShush service status',
          keywords: ['pdfshush status', 'pdf tools status'],
          indexable: true,
          type: 'website',
        },
        {
          route: '/account',
          title: 'Account – Optional Sync for Free PDF Tools | PDFShush',
          description:
            'Accounts are optional. Every client-side PDF tool works without one; an account only syncs preferences and workflow recipes. No document is ever uploaded.',
          html: simplePage(
            'Account (optional)',
            'Client-side tools work without an account.',
            'An account syncs preferences and workflow recipes. It never becomes a condition for editing a local file.',
          ),
          image: '/og/home.png',
          imageAlt: 'Optional PDFShush account',
          keywords: ['pdfshush account'],
          indexable: false,
          type: 'website',
        },
        ...tools.map((tool) => {
          const seo = TOOL_SEO[tool.slug] ?? toolSeoFor(tool.slug, tool.name, tool.description);
          const meta = tool.live ? seo : { ...seo, ...(DECLINED_SEO[tool.slug] ?? {}) };
          return {
            route: `/tools/${tool.slug}`,
            title: meta.title,
            description: meta.description,
            html: toolPage(tool, tools, guides),
            image: `/og/${tool.slug}.png`,
            imageAlt: `${tool.name} – ${tool.categoryLabel} on PDFShush`,
            keywords: seo.keywords,
            indexable: tool.live,
            type: 'website' as const,
            tool,
          };
        }),
        ...LANDING_PAGES.map((page) => ({
          route: page.path,
          title: page.title,
          description: page.description,
          html: landingPage(page),
          image: page.image,
          imageAlt: `${page.h1} - PDFShush guide`,
          keywords: page.keywords,
          indexable: true,
          type: 'article' as const,
          landing: page,
        })),
        {
          route: '/guides',
          title: 'PDF Guides - Practical, No-Fluff How-Tos | PDFShush',
          description:
            'Step-by-step guides for redacting, merging, signing and compressing PDFs, written for people who need the file to be right the first time. No filler at all.',
          html: guidesIndexPage(guides),
          image: '/og/home.png',
          imageAlt: 'PDFShush guides',
          keywords: ['pdf guides', 'how to edit pdf', 'pdf how-to'],
          indexable: guides.length > 0,
          type: 'website' as const,
        },
        ...guides.map((guide) => ({
          route: guidePath(guide.frontmatter.slug),
          title: `${guide.frontmatter.title} | PDFShush`,
          description: guide.frontmatter.description,
          html: guidePage(guide, guides),
          image: '/og/home.png',
          imageAlt: guide.frontmatter.title,
          keywords: [guide.frontmatter.category.toLowerCase(), ...guide.frontmatter.relatedTools],
          indexable: true,
          type: 'article' as const,
          guide,
        })),
      ];

      for (const entry of routes) {
        const staticBody =
          entry.route === '/'
            ? `${entry.html}${startupShell()}`
            : entry.html;

        const schemas: Record<string, unknown>[] = [];
        if (entry.route === '/') {
          schemas.push(organizationSchema(origin));
          schemas.push(websiteSchema(origin));
          schemas.push(
            webPageSchema(
              {
                name: entry.title,
                description: entry.description,
                route: '/',
                image: '/og/home.png',
              },
              origin,
            ),
          );
          schemas.push(faqPageSchema(HOME_FAQS, origin, '/'));
        } else if (entry.tool) {
          const tool = entry.tool;
          schemas.push(
            softwareApplicationSchema(
              { slug: tool.slug, name: tool.name, description: entry.description },
              origin,
              entry.route,
            ),
          );
          schemas.push(
            breadcrumbSchema(
              [
                { name: 'Home', route: '/' },
                { name: 'All PDF tools', route: '/#all-tools' },
                { name: tool.name, route: entry.route },
              ],
              origin,
            ),
          );
          const faqs = faqsFor(tool.slug);
          if (tool.live && faqs.length > 0) {
            schemas.push(faqPageSchema(faqs, origin, entry.route));
          }
        } else if (entry.guide) {
          const guide = entry.guide;
          schemas.push(
            articleSchema(
              {
                title: entry.title,
                description: entry.description,
                route: entry.route,
                publishedAt: guide.frontmatter.publishedAt,
                updatedAt: guide.frontmatter.updatedAt,
                section: guide.frontmatter.category,
                image: entry.image,
              },
              origin,
            ),
          );
          schemas.push(
            breadcrumbSchema(
              [
                { name: 'Home', route: '/' },
                { name: 'Guides', route: '/guides' },
                { name: guide.frontmatter.title, route: entry.route },
              ],
              origin,
            ),
          );
        } else if (entry.landing) {
          const page = entry.landing;
          schemas.push(
            webPageSchema(
              {
                name: entry.title,
                description: entry.description,
                route: entry.route,
                image: entry.image,
                type: 'Article',
              },
              origin,
            ),
          );
          schemas.push(
            breadcrumbSchema(
              [
                { name: 'Home', route: '/' },
                { name: 'PDF tools', route: '/#all-tools' },
                { name: page.h1, route: entry.route },
              ],
              origin,
            ),
          );
          schemas.push(faqPageSchema(page.faqs, origin, entry.route));
        } else {
          schemas.push(websiteSchema(origin));
          schemas.push(
            webPageSchema(
              {
                name: entry.title,
                description: entry.description,
                route: entry.route,
                image: entry.image,
              },
              origin,
            ),
          );
        }

        // `/sponsor` is the one static page that also carries FAQ and breadcrumb
        // markup: its questions are real search intent, and the SPA renders the
        // same array.
        if (entry.route === '/sponsor') {
          schemas.push(
            breadcrumbSchema(
              [
                { name: 'Home', route: '/' },
                { name: 'Sponsor', route: '/sponsor' },
              ],
              origin,
            ),
          );
          schemas.push(
            faqPageSchema(
              SPONSOR_FAQ.map((entry) => ({ question: entry.q, answer: entry.a })),
              origin,
              '/sponsor',
            ),
          );
        }

        const jsonLd = schemas
          .map(
            (schema) =>
              `<script type="application/ld+json">${JSON.stringify(schema)}</script>`,
          )
          .join('\n    ');

        const html = withHead(template, {
          title: entry.title,
          description: entry.description,
          route: entry.route,
          origin,
          image: entry.image,
          imageAlt: entry.imageAlt,
          keywords: entry.keywords,
          indexable: entry.indexable && !NOT_INDEXABLE.has(entry.route),
          type: entry.type,
          jsonLd,
        }).replace('<div id="root"></div>', `<div id="root">${staticBody}</div>`);

        // A flat `<route>.html`, not `<route>/index.html`.
        //
        // Cloudflare Pages (like Netlify and most static hosts) resolves a
        // directory's `index.html` only at the *trailing-slash* URL: a request
        // for `/tools/merge-pdf` is 308-redirected to `/tools/merge-pdf/`.
        // Every canonical URL and every sitemap entry would then point at a
        // redirect. A flat file is served at the extension-less path with a
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
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
        ...sitemapRoutes.map((entry) => {
          const loc = `${origin}${entry.route === '/' ? '/' : entry.route}`;
          return [
            '  <url>',
            `    <loc>${loc}</loc>`,
            `    <lastmod>${buildDate}</lastmod>`,
            '    <xhtml:link rel="alternate" hreflang="en" href="' + loc + '" />',
            '    <xhtml:link rel="alternate" hreflang="x-default" href="' + loc + '" />',
            '  </url>',
          ].join('\n');
        }),
        '</urlset>',
        '',
      ].join('\n');
      await writeFile(path.join(dist, 'sitemap.xml'), sitemap);
      await writeFile(
        path.join(dist, 'robots.txt'),
        [
          'User-agent: *',
          'Allow: /',
          'Disallow: /account',
          'Disallow: /api/',
          `Sitemap: ${origin}/sitemap.xml`,
          '',
        ].join('\n'),
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
          const candidate = path.join(rootDir, 'dist', `${clean}.html`);
          await import('node:fs/promises').then((fs) => fs.access(candidate));
          request.url = `${clean}.html${url.search}`;
        } catch {
          /* not a prerendered route; let the SPA fallback handle it */
        }
        next();
      });
    },
  };
}
