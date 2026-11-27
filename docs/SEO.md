# On-page SEO

This is the working reference for the SEO surface. The rendered HTML is the
source of truth; `pnpm seo:audit` checks the built bytes.

## Canonical origin

`apps/web/src/seo/site.ts` defines `SITE_ORIGIN` (`https://pdfshush.com`). The
build reads `VITE_SITE_ORIGIN` and falls back to that constant, so a self-hoster
can point canonical URLs, Open Graph, hreflang and the sitemap at their own
domain without editing source:

```bash
VITE_SITE_ORIGIN=https://example.com pnpm build
```

`apps/web/.env.production` sets the same origin for the hosted build.

`www.pdfshush.com` is not a second canonical origin. Cloudflare answers every
`www` request with a **301** to the same path and query on `https://pdfshush.com`
(zone Redirect Rule; see [DEPLOY-WORKERS.md §3.1](DEPLOY-WORKERS.md#31-www-and-the-apex)).
There is therefore one hostname to crawl, one set of canonical URLs and no
duplicate-content pair to canonicalise.

## Two URL families

| URL | Purpose |
| --- | --- |
| `/tools/compress-pdf` | The working utility. `SoftwareApplication` + `BreadcrumbList` + `FAQPage`, 300+ words, steps, limits, related tools. |
| `/compress-pdf` | A keyword guide ("PDF compressor online free"), 500+ words, its own H1/FAQ/schema, links into the utility. |

The guide does not duplicate the tool page. It answers the search intent, then
sends the visitor to the working tool. Both URLs are self-canonical and both are
in the sitemap.

Tool pages keep `/tools/<slug>` so existing links and E2E tests do not break.
The short keyword URLs are the guide pages.

### Guide pages

| Path | Primary intent |
| --- | --- |
| `/compress-pdf` | pdf compressor online free, 200 KB / 100 KB / 500 KB / 1 MB targets |
| `/pdf-under-200kb` | compress PDF to 200 KB for exam and government forms |
| `/pdf-under-100kb` | PDF under 100 KB for SSC / UPSC / NEET / IBPS |
| `/merge-pdf` | merge PDF, PDF merger, combine PDF |
| `/split-pdf` | split PDF, page remover, page delete, extract pages |
| `/pdf-editor-online-free` | PDF editor online free, edit text, PDF filler |
| `/unlock-pdf` | PDF unlocker, remove password without software |
| `/pdf-to-jpg` | PDF to JPG high quality 300 DPI, PDF to PNG |
| `/jpg-to-pdf` | JPG/PNG/image to PDF, JPG to PDF under 200 KB |
| `/pdf-tools-no-signup` | no signup, no watermark, private in browser, iLovePDF / Smallpdf / PDF Candy alternatives |
| `/pdf-dark-mode` | PDF dark mode converter, invert colors, night reading, dark to light |
| `/pdf-converter` | PDF converter, PDF to Word/Excel status, PDF to text/images |
| `/pdf-tools-for-exam-forms` | exam/government upload checklist |
| `/pdfshush` | brand query |

## Home page body

The home SEO body is a compact reading layer, not a second catalog. It has one
introduction, one bordered index of 12 categories with every live tool as an
inline link, one band for "why" and use cases, and one horizontal three-step
row. Keep it around 1,600 px on a 1440 px viewport; a full card per tool was
3,600 px and made the page feel endless. The copy uses common action verbs and
no em-dashes.

## Files

| File | Role |
| --- | --- |
| `src/seo/site.ts` | origin, name, locale, default OG image |
| `src/seo/home-content.ts` | home title/description, 600+ word copy, 6 FAQs, per-tool benefits |
| `src/seo/tool-seo.ts` | per-tool titles, descriptions, H1, 300+ word copy, steps, related tools |
| `src/seo/landing-pages.ts` | guide pages and their FAQ/schema data |
| `src/seo/schema.ts` | Organization, WebSite+SearchAction, SoftwareApplication, BreadcrumbList, FAQPage, WebPage/Article |
| `src/seo/head.ts` | SPA head manager (title, canonical, OG, Twitter, hreflang, JSON-LD) |
| `src/seo/static-pages.ts` | head data for the information routes |
| `build/prerender.ts` | writes the static HTML, sitemap, robots.txt and 404 |
| `src/pages/landing.tsx` | renders a guide from `landing-pages.ts` |

## What every prerendered page carries

- Unique title (50–60 characters) and description (150–160 characters)
- `lang="en-IN"`, viewport, `robots` (`index, follow, max-image-preview:large`)
- canonical, `hreflang` `en-IN`, `en`, `x-default`
- Open Graph: type, site name (`PDFShush`), title, description, url, image
  (absolute, 1200×630), image alt, width, height, locale (`en_IN`)
- Twitter: `summary_large_image`, title, description, image, image alt
- JSON-LD: Organization + WebSite/SearchAction + FAQPage on home;
  SoftwareApplication + BreadcrumbList + FAQPage on live tools;
  Article + BreadcrumbList + FAQPage on guides
- Visible H1, supporting H2/H3, internal links, FAQ details

`/account` is `noindex` and not in the sitemap. The seven declined tools
(`pdf-to-word`, `pdf-to-excel`, `pdf-to-ppt`, `word-to-pdf`, `html-to-pdf`,
`sign-workflow`, `convert-batch`) keep an honest status page, are `noindex`,
and are not in the sitemap.

## Verify

```bash
pnpm build

# Metadata, schema, word counts, sitemap integrity (82 pages)
pnpm seo:audit

# Static crawler view (needs `pnpm preview` on :4173)
pnpm test:e2e:reach

# Browser: SPA titles, canonical, JSON-LD replacement, no console errors
pnpm test:e2e:seo

# Character counts while editing copy
pnpm seo:lengths
```

`seo:lengths` prints `T=` and `D=` for every tool/guide. The audit fails on a
title outside 50–60, a description outside 150–160, a missing tag, more than one
H1, a thin page, a duplicate title/description, or a broken sitemap entry.

The SPA head hook removes every route-owned JSON-LD node before adding the new
route's schema. `ToolFaq` finds the prerendered `FAQPage` by type and content and
reuses it, so a hydrated tool page has exactly one FAQ block, not a static copy
plus a client copy.

## Adding a tool

1. Add the tool to the registry (`src/tools/registry.ts`) and its body.
2. Add copy to `TOOL_SEO` in `src/seo/tool-seo.ts` (title, description, H1,
   summary, audience, three steps, related slugs).
3. Add FAQ answers to `src/tools/tool-faqs.ts`.
4. Run `pnpm seo:lengths` until title/description fit, then `pnpm build` and
   `pnpm seo:audit`.

A live tool without a `TOOL_SEO` entry still gets a page from the fallback, but
the fallback is not keyword-targeted; treat it as a safety net, not a substitute.

## Adding a guide

Append to `LANDING_PAGES` in `src/seo/landing-pages.ts`. The router exposes it
through the lazy `:slug` route, the sitemap picks it up, and the head hook builds
its schema. No route table edit is needed.

## Deliberately not targeted

There is no PDF QR code generator, no PDF quality enhancer and no English–Hindi
PDF translator in the product. The copy says so instead of publishing a page
that promises a tool that cannot run. `/pdf-converter` explains the status of
the Office conversions, and `/pdf-tools-no-signup` answers the QR/translation
queries honestly.

## SearchAction

The WebSite schema points at `/?q={search_term_string}`. The home catalog reads
`q` on mount and shows the filtered tool list, so the action is functional rather
than decorative.
