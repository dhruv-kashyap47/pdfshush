<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/pdfshush-wordmark-dark-640.png">
    <img src="docs/assets/pdfshush-wordmark-light-640.png" alt="pdfshush" width="340">
  </picture>
</p>

<p align="center"><strong>Free PDF tools that never upload your files.</strong></p>

<p align="center">
  <a href="https://pdfshush.com"><img alt="Open pdfshush" src="https://img.shields.io/badge/Open_the_app-%E2%86%92-2f9e6a?style=for-the-badge"></a>
</p>

<p align="center">
  <a href="https://pdfshush.com">Live app</a>
  &nbsp;·&nbsp; <a href="#tools">Tools</a>
  &nbsp;·&nbsp; <a href="#private-by-default">Privacy</a>
  &nbsp;·&nbsp; <a href="#run-it-yourself">Self-host</a>
</p>

<p align="center">
  <img alt="48 browser tools" src="https://img.shields.io/badge/51-browser_tools-2f9e6a?style=flat-square">
  <img alt="0 uploads" src="https://img.shields.io/badge/uploads-0-0b3b2c?style=flat-square">
  <img alt="AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-2f9e6a?style=flat-square">
</p>

<img src="docs/assets/readme-hero.svg" alt="A PDF is signed and redacted on the device. Floating chips read Merge PDF, Sign and fill, and OCR, next to a badge that reads zero uploads." width="100%">

**pdfshush is a free PDF toolkit that runs entirely in your browser.** Merge, split, sign, redact, OCR, compress: pick a tool, drop a file, download the result. Your document never leaves your device.

No account. No upload. No waiting for a server.

<p align="center">
  <a href="https://pdfshush.com/tools/merge-pdf">Merge PDF</a> ·
  <a href="https://pdfshush.com/tools/compress-pdf">Compress PDF</a> ·
  <a href="https://pdfshush.com/tools/redact-pdf">Redact PDF</a> ·
  <a href="https://pdfshush.com/tools/fill-sign">Sign a PDF</a> ·
  <a href="https://pdfshush.com/tools/ocr-pdf">OCR a scan</a>
</p>

## A real look

| The app | A tool |
| --- | --- |
| ![The pdfshush home screen](docs/assets/readme-home.jpg) | ![The Merge PDF tool](docs/assets/readme-merge.jpg) |

## Tools

**Merge & organize:** Merge PDF, Organize pages, Alternate & mix, Combine files, Delete pages, Extract pages, Rotate, N-up, Crop, Batch run.

**Split:** Split by pages, Split in half, Split by size, Split by text, Split by bookmarks.

**Edit & sign:** Edit PDF, Fill & sign, Signature, Create forms, Create bookmarks, Page numbers, Header & footer, Watermark, Stamp, Bates numbering, Edit metadata, Rename, Image editor.

**Convert & clean:** PDF to JPG, PDF to text, Extract images, JPG to PDF, Compress, Grayscale, Dark mode, Resize, Flip, Deskew, OCR, Repair, Flatten, Remove annotations.

**Protect:** Redact PDF (with a verifier), Protect with a password, Unlock.

**AI:** Summarize, Chat with a PDF, Edit with AI and Smart redaction. Bring your own provider key, or use a small managed trial.

<p align="center">
  <a href="https://pdfshush.com"><strong>See all 51 tools →</strong></a>
</p>

## Private by default

| Your files stay here | Your keys stay here | Your work still works |
| --- | --- | --- |
| Every tool runs inside your browser tab. There is no upload endpoint, no file server, and no copy of your document on our side. | AI tools use your own provider key by default. It is stored in your browser and sent straight to the provider you chose. The optional managed trial sends only the text you choose through our Worker. | Install pdfshush as an app and keep using tools offline. Once a tool is open, the network is optional. |

Redaction is the one you can check: pages are rebuilt without the hidden text or images, then reopened and verified before the download appears. The [verifier](https://pdfshush.com/verify) lets you inspect the result yourself.

When you use an AI tool, the text you choose to send goes to your AI provider, not to us. Everything else stays on your device.

## Drop, pick, done

1. **Drop a PDF.** Choose a local file, or drag it into the tab.
2. **Pick a tool.** Merge, sign, redact, OCR, compress. It opens in place.
3. **Download the result.** The finished file is built in your browser.

Nothing is sent anywhere in between.

## Engineering record

The editor uplift and its parity sweep are documented instead of advertised:
[`docs/PARITY-REPORT.md`](./docs/PARITY-REPORT.md) maps every task to shipped
evidence and names what remains partial; [`PLAN.md`](./PLAN.md) carries the
sprint records and gate results; [`tests/benchmarks/editor-ceilings.md`](./tests/benchmarks/editor-ceilings.md)
publishes the measured editor numbers, and [`docs/CROSS-BROWSER.md`](./docs/CROSS-BROWSER.md)
records the engine and touch matrix.

## Run it yourself

pdfshush is open source. The frontend runs on its own — no Docker, no database, no API keys. The optional Cloudflare Worker adds Google sign-in, D1 sync and the managed AI trial; every PDF tool works without it.

```bash
pnpm install
pnpm dev            # http://localhost:5173, all tools, no Worker needed
pnpm dev:edge       # optional Worker on http://localhost:8787
```

Production build and deploy:

```bash
pnpm build
npx wrangler deploy
```

Requires Node 20.19+ and pnpm 12. The deployment is one Cloudflare Worker serving the SPA from Static Assets and `/api` from `apps/edge`; the runbook is [`docs/DEPLOY-WORKERS.md`](./docs/DEPLOY-WORKERS.md). The old Express/BullMQ/Redis/Mongo server tier is deliberately archived in [`archive/`](./archive/README.md) for a later paid tier.

## License

[AGPL-3.0-or-later](./LICENSE). The UI foundation is the MIT-licensed [shadcn dashboard & landing template](https://github.com/shadcnstore/shadcn-dashboard-landing-template); its notice is in [`licenses/`](./licenses/). The PDF engine builds on [pdf-lib](https://github.com/cantoo-pdf-lib/pdf-lib), [pdf.js](https://mozilla.github.io/pdf.js/), [PDFium](https://github.com/embedpdf/embed-pdf-viewer), [Tesseract.js](https://github.com/naptha/tesseract.js) and [fflate](https://github.com/101arrowz/fflate). Product scope is modeled on [Sejda](https://www.sejda.com/) (not affiliated).

<p align="center"><sub>Made for documents that are nobody else's business.</sub></p>
