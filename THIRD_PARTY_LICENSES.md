# Third-party licences and attribution

pdfshush is distributed under **AGPL-3.0-or-later** (see [`LICENSE`](./LICENSE)).
This file covers the third-party code, fonts, data and images that are part of
the repository or the deployed application. The generated appendix
[`THIRD_PARTY_LICENSES.deps.md`](./THIRD_PARTY_LICENSES.deps.md) contains the
actual licence text of every production dependency, read from the installed
packages.

The dependency inventory was produced with `pnpm -r licenses list --prod`.
Regenerate the appendix with `pnpm deps:licenses` after a dependency change.

## Vendored or adapted code

These files contain expression taken from another project. Each keeps the
upstream notice; none may be relicensed as AGPL-only.

| Destination | Upstream | Licence | Notice |
| --- | --- | --- | --- |
| `packages/ai-provider/src/` | GenOffice `packages/ai-provider` | Apache-2.0 | [`licenses/genoffice-MCP-donor-Apache-2.0.txt`](./licenses/genoffice-MCP-donor-Apache-2.0.txt), [`licenses/genoffice-NOTICE.txt`](./licenses/genoffice-NOTICE.txt) |
| `packages/ai-agent/src/` | GenOffice `packages/agent-core` | Apache-2.0 | same as above |
| `archive/apps/mcp/src/` (archived, not deployed) | GenOffice `packages/cli/src/mcp` | Apache-2.0 | [`licenses/pdfshush-mcp-donor-NOTICE.txt`](./licenses/pdfshush-mcp-donor-NOTICE.txt) |
| `apps/web/src/components/reactbits/spotlight-card.tsx` | React Bits `SpotlightCard` | MIT + Commons Clause v1.0 | [`licenses/react-bits-LICENSE.md`](./licenses/react-bits-LICENSE.md) |
| `packages/pdf-core/src/darkmode/` | `chizkiyahu/pdf-dark-mode-converter` | MIT | [`licenses/pdf-dark-mode-converter-MIT.txt`](./licenses/pdf-dark-mode-converter-MIT.txt) |
| UI foundation (`components/ui`, layout and theme patterns) | `shadcnstore/shadcn-dashboard-landing-template` | MIT | [`licenses/shadcn-dashboard-landing-template-MIT.txt`](./licenses/shadcn-dashboard-landing-template-MIT.txt) |
| `packages/pdf-core` (engine foundation) | `@cantoo/pdf-lib`, `pdf.js`, PDFium (via `@embedpdf/pdfium`) | MIT / Apache-2.0 / BSD-3-Clause | [`licenses/cantoo-fontkit-MIT.txt`](./licenses/cantoo-fontkit-MIT.txt), [`licenses/embedpdf-pdfium-MIT.txt`](./licenses/embedpdf-pdfium-MIT.txt), [`licenses/pdfium-BSD-3-Clause.txt`](./licenses/pdfium-BSD-3-Clause.txt) |

The GenOffice attribution is required by Apache-2.0 section 4: the licence
text and the donor's NOTICE travel with the adapted packages. The upstream
copyright line is `Copyright 2026 Mainfunc, Inc.`

### Items that need the owner's decision

- **React Bits `SpotlightCard`.** The upstream licence is “MIT + Commons
  Clause v1.0”. It is **not OSI-approved** and its Commons Clause forbids
  selling, sublicensing or redistributing the component itself, alone or as a
  ported version. Using it inside the application is permitted, but this
  repository publishes the component's source under AGPL-3.0-or-later, which
  lets a recipient extract and redistribute it. Either rewrite the component
  from the behaviour spec and delete the vendored file, or confirm the
  upstream terms are acceptable for this distribution. The file is excluded
  from the AGPL grant in its header until that decision is made.
- **`rea ihpdf/` reference material.** The upstream project ships no licence
  file; the project owner supplied it and authorised copying (see
  [`licenses/rea-ihpdf-NOTICE.md`](./licenses/rea-ihpdf-NOTICE.md)). The
  provenance gate currently reports **0** copied files, so nothing derived
  from it is distributed today. Keep it that way unless the owner can grant
  downstream rights, because “owner authorised” is not a licence to third
  parties.

### Idea-only inspiration (no attribution required)

`apps/web/src/components/reactbits/animated-content.tsx` and `count-up.tsx`
keep the React Bits *component interface* but are independent anime.js
implementations. No React Bits expression is copied in those two files.
Product scope is modelled on Sejda (not affiliated); no code or assets are
taken from it.

## Fonts

| Font | Files | Licence | Notice |
| --- | --- | --- | --- |
| Instrument Serif | bundled via `@fontsource/instrument-serif` | OFL-1.1 | [`licenses/instrument-serif-OFL-1.1.txt`](./licenses/instrument-serif-OFL-1.1.txt) |
| Caveat | `apps/web/src/assets/signature/caveat-*.woff2` | OFL-1.1 | [`licenses/caveat-SIL-OFL-1.1.txt`](./licenses/caveat-SIL-OFL-1.1.txt) |
| Source Code Pro | typed-signature font | OFL-1.1 | [`licenses/source-code-pro-OFL.md`](./licenses/source-code-pro-OFL.md) |

## Data and bundled engine assets

| Asset | Source | Licence | Notice |
| --- | --- | --- | --- |
| `apps/web/public/cmaps/*.bcmap` | pdf.js | Apache-2.0 | [`licenses/tesseract-Apache-2.0.txt`](./licenses/tesseract-Apache-2.0.txt) is the Apache-2.0 text used for engine dependencies; `pdfjs-dist` ships its own copy in the package |
| `apps/web/public/standard_fonts/*` | pdf.js standard-font data | Foxit / Liberation licences | `apps/web/public/standard_fonts/LICENSE_FOXIT`, `LICENSE_LIBERATION` |
| `/tessdata/eng.traineddata.gz` | `@tesseract.js-data/eng` | MIT | [`licenses/tesseract-eng-data-MIT.txt`](./licenses/tesseract-eng-data-MIT.txt) |
| OCR runtime (`tesseract.js`, `tesseract.js-core`) | Tesseract.js | Apache-2.0 | [`licenses/tesseract-Apache-2.0.txt`](./licenses/tesseract-Apache-2.0.txt) |
| Node render tests (`@napi-rs/canvas`) | napi-rs | MIT | [`licenses/napi-rs-canvas-MIT.txt`](./licenses/napi-rs-canvas-MIT.txt) — dev-only, not shipped |

## Images and artwork

| Asset | Origin | Status |
| --- | --- | --- |
| `apps/web/public/brand/stem-3.png`, `apps/web/public/icons/*`, `favicon.ico` | pdfshush brand artwork supplied by the project owner | Project asset |
| `docs/assets/*`, `apps/web/public/og/*` | Screenshots and Open Graph cards generated from this app | Project asset |
| `apps/web/public/hero/greek-night.webp`, `greek-night-sm.webp` | **No provenance record in the repository.** The design record only describes the grade, not the source photograph or generator. | **UNVERIFIED — owner must confirm the licence or replace the file.** Do not rely on the AGPL grant for these two images. |

The ignored local `assets/` directory holds the retired design's photograph
originals and `credits.json` (Library of Congress / Archives New Zealand). They
are not distributed, but if either is reintroduced the credit and licence must
move into this file first.

## Production dependency summary

From `pnpm -r licenses list --prod` (2026-11-26):

| Licence | Packages | Compatibility |
| --- | --- | --- |
| MIT | 93 | Permissive; notice required. |
| Apache-2.0 | 6 | Permissive; licence and NOTICE required. |
| OFL-1.1 | 1 | Font licence; notice required. |
| ISC | 1 | Permissive; notice required. |
| 0BSD | 1 | Permissive; no attribution required (notice included anyway). |
| BSD-2-Clause | 1 | Permissive; notice required. |

No GPL, AGPL, SSPL, Commons Clause or unknown licence appears in the
**production** tree. Two dev-only families are MPL-2.0 (`axe-core` and
`lightningcss`); MPL-2.0 is file-level copyleft and these are not shipped.

Four production packages declare a licence but do not ship a licence file in
the installed package: `brotli@1.3.3`, `dfa@1.2.0`,
`react-remove-scroll-bar@2.3.8`, `tr46@0.0.3` (all MIT per their package
metadata). They are listed in the appendix rather than assigned a fabricated
copyright line; confirm upstream before a release that relies on their
notice terms.

The appendix is authoritative for exact versions and copyright lines:
[`THIRD_PARTY_LICENSES.deps.md`](./THIRD_PARTY_LICENSES.deps.md).
