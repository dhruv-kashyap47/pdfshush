# PDF architecture — pdfshush

Read-only audit of the PDF path in `apps/` and `packages/`. Baseline commit
`c8f2208` on branch `pdf/s1-audit`, 2026-11-11.

This document is descriptive, not aspirational. Where a subsystem does not exist
(SHARE), it says so instead of inventing a design.

---

## 1. One engine, three front doors

`packages/pdf-core` is the only PDF engine in the monorepo. It owns parsing,
page composition, editing, rendering, OCR glue and text extraction. The web app,
the API and the MCP server all reach the same `JobDefinition` objects rather than
reimplementing a tool.

| Entry point | File | Contents |
| --- | --- | --- |
| Browser-safe barrel | `packages/pdf-core/src/index.ts:1` | contracts, limits, ops, render layer, full job registry |
| Node-safe barrel | `packages/pdf-core/src/node.ts:1` | contracts, limits, geometry/editor/form ops, 8 pdf-lib-only jobs |
| Job contract | `packages/pdf-core/src/job.ts:22` (`JobContext`), `:60` (`JobDefinition`) | `validate` / `estimate` / `run` |
| Job registry | `packages/pdf-core/src/jobs/registry.ts:51` | 39 slugs, one map shared by browser + server |
| Node job allowlist | `packages/pdf-core/src/node.ts:85` | `inspect`, `merge`, `organize`, `stamp`, `split-by-pages`, `split-in-half`, `n-up`, `edit` |

Why two barrels: the render layer needs `OffscreenCanvas` / `HTMLCanvasElement`
and a configured pdf.js worker, which a Node worker does not have. The server
bundles `@pdfshush/pdf-core/node`, so render-dependent jobs (`thumbnails`,
`pdf-to-images`, `text-runs`) never enter its module graph. The same split is
mirrored in the wire contract: `packages/api-contracts/src/jobs.ts:27` lists the
eight `SERVER_SLUGS` the API will accept.

Consequence for this audit: a defect inside a shared op (composition, transform,
text counting) reproduces identically in the browser and on the server, while a
render-layer defect is browser-only.

---

## 2. Execution topologies

```
Browser tab (default path)
  React UI
    └─ JobPool ──postMessage──► dedicated Web Worker (job-worker.ts)
                                   └─ pdf-core JOBS
                                        ├─ pdf-lib (parse, compose, edit)
                                        ├─ pdf.js     (render, text runs)
                                        ├─ PDFium WASM (in-place text edit)
                                        └─ Tesseract  (OCR, lazy)

Browser tab (server-backed tools / workflows)
  React UI ──/api/jobs──► Express API :8080 ──BullMQ/Redis──► worker process
                                                                 └─ pdf-core NODE_JOBS
                                                                      └─ work directory

Agents
  MCP client ──/api/v1/jobs──► same Express API, same queue, same worker
```

### 2.1 Main thread ↔ browser worker

- Worker construction and pool limits: `apps/web/src/lib/job-pool.ts:150`
  (`new Worker(new URL('../workers/job-worker.ts', import.meta.url))`), pool size
  `:64`, bounded timeout/termination at the top of the file.
- Wire protocol: `apps/web/src/lib/job-pool.ts:40` (`progress` / `done` /
  `error`), worker side `apps/web/src/workers/job-worker.ts:62` (`JobRequest`,
  `CancelRequest`) and `:88` (`onmessage`).
- Validation is re-run inside the worker against the shared
  `JobDefinition.validate` (`job-worker.ts:104`), then `withJobLimits` wraps the
  run (`:109`).
- Buffers cross the boundary by transfer, not copy:
  `apps/web/src/workers/job-worker.ts:142` (`collectTransferables`). The main
  thread never parses a PDF.
- Cancellation aborts the in-flight `AbortController`
  (`job-worker.ts:90`); a synchronous pdf-lib loop cannot observe an abort, so
  the pool can also terminate the worker (`job-pool.ts` header, rules 2–3).
- A worker that crashes is removed from the pool even when it is idle, so the
  next dispatch starts a live one instead of posting into a dead global
  (`job-pool.ts`, finding `PDF-ENGINE-008`).

### 2.2 Worker ↔ pdf.js / PDFium / OCR

- pdf.js is configured once per worker: `apps/web/src/workers/job-worker.ts:44`,
  with cmaps and standard fonts served from the Vite base path (`:47-49`).
- pdf.js cannot spawn its own nested worker inside a dedicated worker; it falls
  back to in-thread parsing over `LoopbackPort` and logs "Setting up fake
  worker." once per document. That is expected and is documented at
  `job-worker.ts:33-41`; verbosity is set to errors-only (`:42`).
- Parsed documents are cached by SHA-256 of bytes + password digest, LRU 3:
  `packages/pdf-core/src/render/pdfjsRuntime.ts:68` (`CACHE_LIMIT`).
- PDFium and OCR are lazy: wasm/engine URLs are injected, not imported
  (`job-worker.ts:55`, `:60`).

### 2.3 Web app ↔ API

- The SPA talks to its own origin: `apps/web/src/lib/api.ts:63` (`fetch`), with
  double-submit CSRF on mutations (`:58-61`) and `x-job-token` for job reads
  (`:56`). Vite proxies `/api` in development (`api.ts:4-7`).
- Server-backed workflows upload one step at a time:
  `apps/web/src/lib/workflows.ts:281` (`POST /api/jobs`), poll `:215`, download
  `:233`, cancel `:300`.
- API surface: `apps/api/src/http/app.ts:261` create, `:375` poll, `:386`
  download, `:414` cancel, `:185` health.
- Public REST API: `apps/api/src/http/v1/routes.ts:96` (`registerV1Routes`),
  mounted at `apps/api/src/http/app.ts:147`. MCP clients use this surface
  (`apps/mcp/src/api.ts:92`).

### 2.4 API ↔ queue ↔ worker process

- Queue: BullMQ over Redis, `apps/api/src/jobs/queue.ts:106`
  (`BullJobQueue`). The payload carries **paths, never bytes**
  (`apps/api/src/jobs/payload.ts:1-9`), so Redis holds kilobytes per job.
- Worker host: `apps/api/src/worker/host.ts:107` (`startWorkerHost`); in
  development the API can embed it (`apps/api/src/server.ts:104`), in production
  it runs as its own process (`apps/api/src/worker/main.ts:1`).
- Per-job sandbox: `apps/api/src/worker/processor.ts:34` (`processJob`); a crash
  kills one job, not the worker (`processor.ts:4-7`).
- Execution of the shared contract: `apps/api/src/jobs/runner.ts:95`
  (`runJob`) → `getNodeJob` (`:97`) → `@pdfshush/pdf-core/node`.

### 2.5 Memory ↔ disk (storage boundary)

- Browser: everything is in memory. Limits are conservative and central:
  `packages/pdf-core/src/limits.ts:25` — 100 MB per file, 250 MB total, 500
  pages, workers clamped to 1–4, thumbnails degrade above 120 pages.
- Server: uploads stream to disk and stop at a byte cap;
  `apps/api/src/files/store.ts:39` (`WorkDirStore`), cap at `:26`
  (`UploadTooLargeError`). One directory per job, `jobs/<id>/input` and
  `.../output` (`store.ts:53`).
- Every server path is built through `resolveWithin` / `safeFileName` /
  `safeJobId`, which reject traversal, control characters and oversized names:
  `apps/api/src/files/paths.ts:26`, `:50`, `:57`.
- Retention: files are deleted one hour after a job finishes
  (`limits.ts:50`), swept by `apps/api/src/files/janitor.ts:5`.

There is no object store and no cross-job document store: a result exists only
in the browser tab's memory (local path) or in the job's work directory until
the TTL janitor removes it (server path).

---

## 3. The page-composition spine (where findings cluster)

Most multi-page tools are one of two shapes.

### 3.1 Copy pages into a fresh document

`composeDocument` (`packages/pdf-core/src/ops/compose.ts:55`) is the spine for
Organize, Delete Pages, Extract Pages, Split (by pages/size/text/bookmarks),
Rotate, Crop, Stamp, Watermark, Flip and Resize:

1. load every source (`compose.ts:67`);
2. `PDFDocument.create()` (`:71`) — a brand-new catalog and Info dictionary;
3. apply **only** `/CreationDate` and `/ModDate` from the sources
   (`:72`, `ops/dates.ts:91`);
4. `out.copyPages(source, indexes)` (`:95`, duplicates re-copied at `:118`);
5. apply rotation/crop, `out.addPage(page)` (`:133`);
6. save (`:153`).

`mergePdfs` (`ops/merge.ts:31`, `:45`, `:54`) and `combineToPdf`
(`ops/combine.ts:71`, `:96`, `:141`) are the same shape without the page-ref
machinery. Split-in-half builds two fresh documents (`ops/split.ts:52-53`) and
copies pages (`:86-87`). N-up rebuilds onto new sheets (`ops/nup.ts:87`).

Two document-level structures do not travel with a copied page, so
`composeDocument`, `mergePdfs` and `combineToPdf` explicitly carry them:

- `/AcroForm` lives in the **catalog**, not on the page. `copyPages` carries the
  page's `/Annots` array (so widget annotations survive as objects) but the new
  catalog has no `/AcroForm`. `ops/formCopy.ts` clones the field tree, rewires
  each widget's `/P` to the destination page, and points the page `/Annots` at
  the cloned field widgets. Single-source copies keep the form; merge/combine
  append field trees and suffix colliding fully-qualified names (`_2`, `_3`);
  duplicated pages get renamed field copies (`PDF-ENGINE-001`).
- Semantic Info entries (`/Title`, `/Author`, `/Subject`, `/Keywords`) are
  copied by `ops/metadata.ts`: compose/N-up/split inherit their single source,
  merge/combine use the first PDF. Dates still follow the deterministic
  earliest-creation/latest-modification policy (`dates.ts:20-21`, `:91`)
  (`PDF-ENGINE-002`).

### 3.2 Rebuild pages in place

Flip and Resize compose first (`jobs/flip.job.ts:86`, `jobs/resize.job.ts:74`),
then rebuild every page:

- `mirrorPages` (`ops/transform.ts:63`): `doc.addPage(...)` (`:85`),
  `doc.embedPage(page, ...)` (`:87`), `replacement.drawPage(...)` (`:93`), then
  remove every original (`:104-106`).
- `resizePages` (`ops/transform.ts:139`): same pattern at `:152`, `:154`,
  `:162`, `:174-176`.

`embedPage` embeds **content streams**. `/Annots` is a page-dictionary entry,
not page content, so the transform would lose annotations and widget
appearances. Session 6 decided to flatten them: `transform.ts` paints stored
`/AP /N` appearances as Form XObjects, synthesises an appearance for the simple
annotation types that carry none, emits a `warnings[]` notice, removes the
AcroForm registration when widgets were flattened, and refuses a document with
a `/FT /Sig` field (`PDF-ENGINE-003`).

---

## 4. Editing, rendering and export

- Geometry is display-space at the boundary and PDF-space inside:
  `packages/pdf-core/src/ops/geometry.ts` (`pageGeom`, `viewToPdf`,
  `pdfRectToView`), consumed by `ops/edit.ts` and `ops/forms.ts`. Rotated and
  cropped pages are handled by the same mapping; see the `rotated-90.pdf` and
  `cropbox-offset.pdf` fixtures.
- Rasterisation: `render/renderPage.ts` asks for a target pixel width and
  `render/canvas.ts`'s `fitScaleToBudget` clamps the scale to both
  `LIMITS.tool.maxRenderEdgePx` (8192) and `maxRenderAreaPx` (16,777,216, the
  WebKit canvas ceiling). It fits the page instead of refusing it; the old
  edge-only check blanked tall pages and let square pages exceed iOS limits.
- Fonts are intentionally path-only in the worker: `loadPdfForRender` sets
  `disableFontFace: true` and `useSystemFonts: false`, which is why
  "Setting up fake worker." is expected. Consequence: a Type0 font with no
  `FontFile` (e.g. `STSong-Light`) has no glyph program and paints `.notdef`
  boxes; ICC profiles are also inactive because `wasmUrl`/`iccUrl` are not
  configured. Session 6 chose **not to bundle a CJK font**: render jobs now add
  a `warnings[]` notice naming the non-embedded font while the glyph repro stays
  `it.fails` (`PDF-RENDER-003`). ICC/wasm remains deferred (`PDF-RENDER-004`).
- Text typography crosses the job boundary in display space:
  `TextTypography.rotationDeg` folds in the page's `/Rotate`
  (`document/glyphs.ts`), matching the glyph boxes and `Line.rotationDeg` that
  the text layer hit-tests against.
- Form authoring/filling: `ops/formFields.ts` and `ops/forms.ts`; flattening is
  the one operation that intentionally removes the AcroForm
  (`jobs/flatten.job.ts:66-69`), which is correct.
- Text editing has two engines: a pdf-lib/content-stream path and a PDFium
  in-place path (`packages/pdf-core/src/textedit/engine.ts`), selected per page.
- Render/export (`thumbnails`, `pdf-to-images`, `text-runs`) is browser-only and
  excluded from `src/node.ts:11-13`.
- Text extraction for the `.txt` export runs on the pdf.js run clusterer
  (`jobs/text.job.ts:79`, `render/textRuns.ts`) and joins runs into lines
  (`text.job.ts:39`). `charCount` is the length of the text actually written,
  including only separators between pages (`text.job.ts:97`); the session-2
  `PDF-ENGINE-004` defect is fixed.

---

## 5. Share

SHARE is **not implemented** in `apps/` or `packages/`. There is no share-link
route, no share token, no link format, and no code that turns a job result into a
URL someone else can open. Consequently this audit records no SHARE findings and
makes no claim about link semantics.

What does exist is a per-job capability, not a share link: a created job returns
an opaque `jobId` and `token` (`apps/api/src/http/app.ts:261`), and reads must
present `x-job-token` (`apps/web/src/lib/api.ts:56`; check at
`apps/api/src/http/app.ts:375`). That capability is scoped to the job, expires
with the work directory, and is not a durable document share.

If SHARE is added later, it needs its own boundary section: who can mint a link,
how a link is revoked, whether it outlives the one-hour file TTL, and what the
server must never log.

Session 5 audited the capability above as the only second-party access surface
that exists, fixed two defects in it (`PDF-SHARE-001`, `003`), and wrote the
design-only `SHARE-SPEC.md` (link format, storage schema, routes, permissions,
password gate, range support and threat model). Session 6 made a finished job's
result revocable: `DELETE /api/jobs/:id` removes the work directory and the next
token download is 404 (`PDF-SHARE-002`), and it cache-proofed the adjacent
`/api/account*` and `/api/auth/me` responses. SHARE itself is still not
implemented; the twelve open decisions in the spec are the blocking input.

---

## 6. Security and upload boundary (SEC-UPLOAD)

Session 1 found no SEC-UPLOAD defect. Session 2 found one (`PDF-SEC-UPLOAD-001`,
fixed in `d3d0dde`): upload-name uniqueness was computed before sanitisation, so
two names that collapse to one basename shared a path and one upload was
truncated. Names are now sanitised first and uniqued with
`uniqueFileName` (`apps/api/src/files/paths.ts`), which the multipart and inline
paths both call. The rest of this section documents the boundary as audited.

- Upload type/size checks: `apps/api/src/http/uploads.ts` (PDF signature,
  multipart handling), byte cap `apps/api/src/files/store.ts:26`.
- Path containment and name sanitisation: `apps/api/src/files/paths.ts:26`
  (`safeFileName`), `:50` (`safeJobId`), `:57` (`resolveWithin`); output names
  on the engine side go through `safeOutputName` in
  `packages/pdf-core/src/jobs/helpers.ts`.
- Browser tools never upload; server-backed tools and workflows upload by
  design and say so in the UI (`apps/web/src/pages/trust.tsx:49`).
- Queue payloads carry paths, not document bytes
  (`packages/api-contracts/src/jobs.ts:1-9`), so document data never enters
  Redis.
- Embedded images are bounded before decoding (`imageLimitIssue`,
  `packages/pdf-core/src/ops/imageDocs.ts`; finding `PDF-ENGINE-006`).

---

## 7. Expected behaviour that is not a bug

| Observation | Why it is expected |
| --- | --- |
| "Setting up fake worker." in logs | pdf.js cannot nest a worker inside the job worker; it parses in-thread over `LoopbackPort` (`apps/web/src/workers/job-worker.ts:33-41`). |
| Mixed-direction Arabic appears reordered in extracted text | pdf.js emits visual-order runs; bidi reordering is the renderer's contract, not corruption (`packages/pdf-core/src/jobs/text.job.ts:39-44`). |
| Dates in output differ from "now" | Deliberate determinism policy: inherit source dates or omit them (`packages/pdf-core/src/ops/dates.ts:1-22`). |
| A server deployment exposes only 8 tools | Render-dependent jobs need a canvas / configured pdf.js worker (`packages/pdf-core/src/node.ts:11-13`, `packages/api-contracts/src/jobs.ts:19-26`). |

---

## 8. Area-tag map

| Tag | Primary code |
| --- | --- |
| `ENGINE` | `packages/pdf-core/src/ops/*`, `src/jobs/*` |
| `RENDER` | `packages/pdf-core/src/render/*` (canvas budget, page render, text runs/layout), `src/document/glyphs.ts`, `apps/web/src/workers/job-worker.ts` |
| `EDITOR` | `packages/pdf-core/src/ops/edit.ts`, `src/textedit/*`, `src/ops/geometry.ts` |
| `EXPORT` | `src/jobs/text.job.ts`, `images.job.ts`, `pdfToImages.job.ts`, `zip.job.ts` |
| `SHARE` | none — not implemented; design in `SHARE-SPEC.md`. Session-5 fixes touch `apps/api/src/http/result-stream.ts` and the `/api/jobs` mounts; session 6 adds revocation in `apps/api/src/http/app.ts` and account/auth cache headers. |
| `SEC-UPLOAD` | `apps/api/src/http/uploads.ts`, `apps/api/src/files/*` |
