# PDF findings — PDFShush

Read-only audit of `apps/` and `packages/` at commit `c8f2208`
(branch `pdf/s1-audit`, 2026-11-11). Session 1 made no source change; the only
committed artifacts are these documents, the audit fixtures and the
known-failing repro tests.

Session 2 (branch `pdf/s2-engine`, cut from `pdf/s1-audit`) audits the ENGINE
and SEC-UPLOAD focus areas and fixes every unambiguous defect found there.
Per-fix commits and verification are recorded in the status column; decisions
that change product policy stay in "Needs decision" rather than being guessed.

Session 3 (branch `pdf/s3-render`, cut from `pdf/s2-engine`) audits the RENDER
focus area: page rasterisation and its canvas budget, rotation/CropBox frames,
font substitution (including CJK/RTL), text-layer/overlay alignment, and the
editor's raster cache. It fixed two defects and recorded three decisions; the
render-regression corpus it added is the evidence anchor for the rest.

Evidence conventions:

- `file:line` points at the root cause in the tree at `c8f2208` (session-1
  findings) or at the session-2 base `7ffbdc7` (new findings).
- Session-1 findings have a repro test under `packages/pdf-core/test/pdf-audit/`.
  Those tests assert the **desired** behaviour and are marked `it.fails`, so the
  suite is green while the bug exists and turns red the moment a fix lands.
- Session-2 regressions are ordinary tests next to the code they cover; each
  was written first and failed against the unfixed tree.
- Raw observations from the audit probes are kept in
  `docs/pdf-audit/.baseline/` (line references below). Session-2 lifecycle
  numbers are in `METRICS.md`.

---

## Ranked findings

Session 2 (`pdf/s2-engine`) added five findings in the audit focus areas. The
four session-1 IDs keep their numbers; new IDs are appended. Ranks are
presentation only and are ordered by severity.

| Rank | ID | Area | Symptom | Root cause | Severity | Fix size | Risk | Status | Repro |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `PDF-ENGINE-001` | ENGINE | Every page-copy/rebuild tool returns a PDF with no `/AcroForm`. Widget annotations remain on the page as unregistered orphans, so `inspect` reports 0 fields and no viewer can fill the form. Affects Organize, Delete Pages, Extract, every Split, Rotate/Crop, Merge, Combine, N-up, Stamp, Watermark, and the compose step of Flip/Resize. Silent. | `packages/pdf-core/src/ops/compose.ts:71` (`PDFDocument.create()`), `:95` (`copyPages`), `:133` (`addPage`) never carry the catalog-level form. Same shape: `ops/merge.ts:31,45`, `ops/combine.ts:71,96`, `ops/nup.ts:87`, `ops/split.ts:52-53`. | HIGH | L | HIGH | **Needs decision** (`7845dca`) | `packages/pdf-core/test/pdf-audit/page-pipelines.test.ts` |
| 2 | `PDF-ENGINE-003` | ENGINE | Flip and Resize silently delete every page annotation and form widget: highlights, comments, links, stamps, signatures and form fields disappear. Page content itself is preserved. | `packages/pdf-core/src/ops/transform.ts:85-106` (`addPage` + `embedPage` + `removePage`) and `:152-176`. `embedPage` copies content streams only; `/Annots` is a page-dictionary entry, not content, so it is never re-attached. | HIGH | L | HIGH | **Needs decision** (`7845dca`) | `packages/pdf-core/test/pdf-audit/transform-annotations.test.ts` |
| 3 | `PDF-ENGINE-006` | ENGINE | A small, valid PNG (or JPEG) declaring an enormous raster is handed to `embedPng`/`embedJpg` before any limit is applied, so the worker inflates the full bitmap. A 63 KB PNG declaring 9000×1 px was accepted; an attacker-sized IHDR is a decompression bomb that dies as an OOM/tab crash instead of a refusal. | `packages/pdf-core/src/ops/imageDocs.ts:145-147` (`imagesToPdf` embeds first, checks later — it never checked at all) and `ops/combine.ts:114-116`. `LIMITS.tool.maxImagePixels` was only applied by the editor path (`ops/edit.ts:350-355`). | HIGH | S | LOW | **Fixed** (`9382d1d`) | `packages/pdf-core/test/next-tools.test.ts`, `packages/pdf-core/test/bookmark-batch.test.ts` |
| 4 | `PDF-ENGINE-002` | ENGINE | `/Title`, `/Author`, `/Subject` and `/Keywords` disappear from the output of the compose/merge/combine family. `/CreationDate` and `/ModDate` survive. | `packages/pdf-core/src/ops/compose.ts:71-72`, `ops/merge.ts:34`, `ops/combine.ts:138`; `ops/dates.ts:91-99` deliberately sets/removes only the two date keys. | MEDIUM | S–M | LOW | **Needs decision** (`7845dca`) | `packages/pdf-core/test/pdf-audit/page-pipelines.test.ts` |
| 5 | `PDF-ENGINE-008` | ENGINE | A worker that crashes while it is *between* jobs stays in the pool. The next job is posted into a dead worker global that can never answer, so it hangs until its full timeout (up to 120 s by default) and then reports a timeout instead of a crash. | `apps/web/src/lib/job-pool.ts:155-161`: `worker.onerror` only finished/respawned when `slot.job` was set. An idle worker has no job, so nothing recycled it. | MEDIUM | S | LOW | **Fixed** (`85a5d68`) | `apps/web/src/lib/job-pool.test.ts` |
| 6 | `PDF-SEC-UPLOAD-001` | SEC-UPLOAD | Two uploaded files that sanitise to the same basename resolve to one path and the second write truncates the first. The job then runs with one document twice and one upload silently missing. Reproduced with `a b.pdf` + `a_b.pdf` (inline JSON) and with two maximum-length duplicate multipart names, where the `-2` suffix was truncated straight back off. | `apps/api/src/http/v1/routes.ts` deduped the *unsanitised* names; `apps/api/src/http/uploads.ts:183-191` appended the suffix before `store.writeInput` (`files/store.ts:77-78`) applied `safeFileName` again and truncated it. | MEDIUM | S | LOW | **Fixed** (`d3d0dde`) | `apps/api/test/v1.test.ts`, `apps/api/test/http.test.ts`, `apps/api/test/files.test.ts` |
| 7 | `PDF-ENGINE-007` | ENGINE | When a pdf.js render task rejects (bad content stream, GPU context loss, cancelled page), the page-sized canvas allocated just before the await is never released. A page that fails mid-run pins its bitmap until GC. | `packages/pdf-core/src/render/renderPage.ts:71-80` awaited `task.promise` with no `catch`; `renderPageToImage`'s `finally` only covers a successful `renderPageToCanvas` return. The `null`-context path also threw after allocation. | MEDIUM | S | LOW | **Fixed** (`fa07fc2`) | `packages/pdf-core/test/renderPage-cleanliness.test.ts` |
| 8 | `PDF-ENGINE-005` | ENGINE | A ZIP can contain two entries with the same path. `fflate` keeps only one of them, so a batch/split archive silently loses a file. Trigger: `['a.png','a.png','a-2.png']` → `['a.png','a-2.png','a-2.png']`. | `packages/pdf-core/src/ops/zip.ts:37-47` counted occurrences of the *original* name; a generated `-N` name was never checked against names that arrive later. | LOW | S | LOW | **Fixed** (`550f545`) | `packages/pdf-core/test/pdf-core.test.ts` |
| 9 | `PDF-ENGINE-004` | EXPORT | `pdf-to-text` on a page with no extractable text reports `charCount: 1` while the emitted `.txt` body is empty. Cosmetic; the downloaded file is correct. | `packages/pdf-core/src/jobs/text.job.ts:94` adds `line.length + 1` for every page, including an empty joined line. | LOW | S | LOW | **Deferred** — EXPORT area, outside the session-2 ENGINE/SEC-UPLOAD scope (`7845dca`) | `packages/pdf-core/test/pdf-audit/text-extraction.test.ts` |

"Fix size" is S (a few lines in one file), M (one module plus tests), L (new
mechanism across several ops plus regression coverage). "Risk" is the chance a
naive fix silently changes user-visible output in another tool.

### Session 3 — RENDER (`pdf/s3-render`)

Session 3 audits the render layer (`packages/pdf-core/src/render/*`, the
editor's raster pipeline and the text/overlay frames). It found six RENDER
defects; two are fixed, three are product/build decisions, and one is deferred
for lack of a harness.

| Rank | ID | Area | Symptom | Root cause | Severity | Fix size | Risk | Status | Repro |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 10 | `PDF-RENDER-001` | RENDER | A tall page can never be rendered: a 600x6000 pt page is refused at 1600 and 2560 px with "Rendered page would be 1600x16000 px; the limit is 8192 px on the longest side", so its preview/export stays blank. A 5000x5000 pt page passes that check and allocates a 64 MP canvas, which iOS/Safari caps at ~16.7 MP and paints blank. A 250 pt wide page at the 2560 px preset is silently capped at 8x and returns 2000 px. | `packages/pdf-core/src/render/renderPage.ts:51-62` chose the scale from the requested width (via `scaleForWidth`'s hard 8x cap), then validated only the longest side and threw instead of fitting the budget. | HIGH | M | LOW | **Fixed** (`6d49d7d`) | `packages/pdf-core/test/render-budget.test.ts`, `packages/pdf-core/test/render-regression.test.ts` |
| 11 | `PDF-RENDER-002` | RENDER | On a `/Rotate 90` page a horizontal line is reported as `rotationDeg: 0`, `direction: 'ltr'` while its glyph boxes are vertical and its `Line` says 90°/`ttb`. The two halves of the text model disagree, and the paragraph orientation key groups rotated text as horizontal. | `packages/pdf-core/src/document/glyphs.ts:259` computed `TextTypography.rotationDeg` from the raw PDF text matrix only. The page's `/Rotate` is applied later by the viewport. | LOW | S | LOW | **Fixed** (`b5cfcfa`) | `packages/pdf-core/test/textModel.test.ts` |
| 12 | `PDF-RENDER-003` | RENDER | Non-embedded CJK text (Type0/CIDFontType0 with no `FontFile`, e.g. `STSong-Light`) extracts as `你好，世界` but every raster paints five `.notdef` boxes. Affects the editor preview, PDF-to-images, Grayscale, Dark mode and OCR output for those files. | `packages/pdf-core/src/render/pdfjsRuntime.ts:156-164` forces `disableFontFace: true` and `useSystemFonts: false`; a dedicated worker has no `FontFaceSet` (`apps/web/src/workers/job-worker.ts:33-41`), so pdf.js has neither a glyph program nor a system font to substitute. | HIGH | L | HIGH | **Needs decision** | `packages/pdf-core/test/render-regression.test.ts` (`it.fails`, `PDF-RENDER-003`) |
| 13 | `PDF-RENDER-004` | RENDER | ICC color management is disabled. pdf.js warns `No ICC color space support due to missing 'wasmUrl' API option`; an ICCBased color space is treated as its component-count default (the profile is ignored), so ICC/CMYK-derived colors can be wrong. JPEG2000/JBIG2 decode through the slower no-wasm fallback. | `packages/pdf-core/src/render/pdfjsRuntime.ts:13-29`, `:190-195` never pass `wasmUrl`, `iccUrl` or `useWasm`; `apps/web/src/workers/job-worker.ts:44-50` configures cmaps and standard fonts only. | MEDIUM | M | MEDIUM | **Needs decision** | pdf.js source (`.pnpm/pdfjs-dist@6.4.299/.../pdf.worker.mjs:2784`, `:2807`) |
| 14 | `PDF-RENDER-005` | RENDER | Inline text editing on a rotated page is drawn horizontally: the paragraph box is 18x289 pt (vertical) but the textarea and the text-object preview have no rotation transform, so the editor shows short horizontal lines over vertical text. | `apps/web/src/components/editor/text-layer.tsx:542-566` (`editorStyle` has no `transform`), `apps/web/src/components/editor/editor-page.tsx:996-1012` (text preview). | LOW | M | MEDIUM | **Needs decision** | `docs/pdf-audit/.baseline/probe-observations.log`-style probe: rotated fixture paragraph bbox 18x289 at `pkgs/pdf-core` probe; code path above |
| 15 | `PDF-RENDER-006` | RENDER | Swapping documents while page rasters are in flight bypasses the two-render concurrency cap: `invalidateDocumentCaches` zeroes the counter and queue, then each old `ensureRaster` `finally` decrements the fresh counter and dequeues a page of the *new* document. Up to four full file reads run at once instead of two. | `apps/web/src/components/tools/edit-pdf-tool.tsx:805-809` (reset) vs `:638-659` (old callbacks mutate the new state). | LOW | S | LOW | **Deferred** — needs a browser/React harness; the fix is a generation guard in `finally` | `apps/web/src/components/tools/edit-pdf-tool.tsx:594-659` |

---

## Evidence

### PDF-ENGINE-001 — AcroForm dropped

`probe-observations.log`:

- source form: 6 fillable fields (`person.name`, `person.agree`, `person.color`
  ×2, `person.country`, `person.tags`) — line 6.
- `organize`: `hasAcroForm: false`, `fields: []`, page `/Annots: [6]` — lines
  47-60.
- `merge`: `hasAcroForm: false`, page `/Annots: [6, 0]` — lines 97-111.
- `combine`: `hasAcroForm: false`, page `/Annots: [6, 0]` — lines 115-129.
- `stamp`: `hasAcroForm: false`, page `/Annots: [6]` — lines 165-178.
- `n-up`: `hasAcroForm: false`, page `/Annots: [0]` — lines 257-270.

For contrast, the in-place paths that do **not** rebuild pages keep the form:
`edit` (line 81) and `compress` lossless (line 133) both report
`acroform: true, fields: 6`.

Control flow: every affected tool creates a new `PDFDocument`, copies pages and
saves. `PDFDocument.create()` produces an empty catalog; `copyPages` transfers
page objects (including `/Annots`) but not the catalog's `/AcroForm`. The
widgets therefore remain as ordinary annotation dictionaries that no field tree
points at.

### PDF-ENGINE-003 — annotations dropped by Flip/Resize

`probe-observations.log`:

- `flip`: `acroform: false`, `fields: 0`, `annots: [0]` — lines 193-205.
- `resize`: `acroform: false`, `fields: 0`, `annots: [0]` — lines 149-161.

The transform deliberately rebuilds each page as an embedded copy under a new
matrix (`transform.ts:1-16`), then removes the originals
(`transform.ts:104-106`, `:174-176`). Only the content stream is embedded;
annotations are not.

### PDF-ENGINE-002 — semantic metadata dropped

`probe-observations.log`:

- source metadata: title/author/subject/keywords/creator/producer — lines 18-27.
- `organize` on that source: every semantic field is `null` — lines 64-77.
- `merge` and `combine`: every semantic field is `null` — lines 97-129.
- `compress` (which does not rebuild the catalog): metadata is retained — lines
  322-335.

`ops/dates.ts:20-21` states the policy explicitly: "Only the two date keys are
touched." That was the right call for determinism, but it also means semantic
metadata is discarded, not inherited.

### PDF-ENGINE-004 — charCount of an empty page

`probe-observations.log` lines 363-367: `pdf-to-text image-only.pdf` returns
`charCount: 1` and `text: ""`. For comparison, `tiny-1page.pdf` returns 37 and
the CJK fixture returns 6 (`text.job.ts:94` is the formula).

### PDF-ENGINE-006 — image raster limit checked after (never before) the decode

`imagesToPdf` (`ops/imageDocs.ts`) and `combineToPdf` (`ops/combine.ts`) called
`embedPng`/`embedJpg` immediately after magic-byte sniffing. The limits that
exist for exactly this case live in `limits.ts`:

- `LIMITS.tool.maxImageBytes` — "Largest embedded image accepted, in bytes
  (decompression-bomb guard)".
- `LIMITS.tool.maxImagePixels` — "Largest embedded image edge in pixels; also
  caps decoded RGBA at ~256 MB".

Only the editor path (`ops/edit.ts:345-355`) applied them, through
`imagePixelSize`, which reads PNG IHDR / JPEG SOF without decoding.

Evidence (probe removed after use): a valid 63 KB-scale PNG produced by
`encodePng(8193, 1, [])` was accepted by `jpgToPdfJob.run` before the fix and
produced a one-page PDF; it must be refused. An IHDR can declare
`100000×100000`, at which point `embedPng` attempts a 40 GB allocation in the
worker. `jpgToPdfJob.validate` also reported `{ ok: true }` for the same file,
so neither the pre-flight nor the run boundary stopped it.

Fix: `imageLimitIssue` (`ops/imageDocs.ts`) probes the declared raster and
returns a user-facing sentence; `imagesToPdf`, `combineToPdf`, `jpgToPdfJob.validate`
and `combineJob.validate` all use it, so the refusal happens before the decoder
is entered. Commit `9382d1d`.

### PDF-ENGINE-008 — an idle worker crash is not recycled

`JobPool` handles a worker crash only when the slot has a current job
(`apps/web/src/lib/job-pool.ts:155-161` before `85a5d68`):

```ts
worker.onerror = (event) => {
  const job = slot.job;
  if (job) { finish(job, 'reject', ...); respawn(slot); }
};
```

A worker that crashes between jobs leaves a dead slot at the top of the free
list. `pump()` finds it (`slots.find((s) => !s.job)`) and posts the next job
into a worker global that no longer exists. `postMessage` succeeds, no message
ever comes back, and the job is rejected by its own timer — reported to the
user as a timeout, not a crash.

Regression test: `apps/web/src/lib/job-pool.test.ts` drives a `FakeWorker`,
completes job 1, fires `onerror` while idle, then queues job 2 and asserts a
second worker was spawned and received the dispatch. It failed on
`crashed.terminated === true` before the fix. `respawn` now runs on every
`onerror`; `pump()` spawns a replacement only when work is waiting, so an idle
pool still shrinks to zero workers. Commit `85a5d68`.

### PDF-SEC-UPLOAD-001 — upload name uniqueness computed before sanitisation

`safeFileName` collapses every character outside `[A-Za-z0-9._-]` and caps the
basename at 96 characters. Two independent paths chose a unique name *before*
that happened:

1. Inline JSON (`apps/api/src/http/v1/routes.ts`): the reserved set held the
   client's names, so `a b.pdf` and `a_b.pdf` were considered distinct. Both
   reached `writeInput`, both sanitised to `a_b.pdf`, and the second write
   truncated the first. The job payload then listed the same name twice.
2. Multipart (`apps/api/src/http/uploads.ts`): the `-2` suffix was appended to
   the already-sanitised name. For a 96-character name the result was 98
   characters, and `writeInput`'s own `safeFileName` truncated the suffix away
   again, restoring the original collision.

Evidence: `apps/api/test/v1.test.ts` (inline, `a b.pdf` + `a_b.pdf`) and
`apps/api/test/http.test.ts` (two 96-character duplicates) both failed with one
stored name before the fix. Fix: `uniqueFileName` in `apps/api/src/files/paths.ts`
computes the suffix against the sanitised stem, keeps the result within the
length cap, and verifies `safeFileName(candidate) === candidate` so the store's
second pass cannot undo it. Both upload paths use it. Commit `d3d0dde`.

### PDF-ENGINE-007 — canvas leaked when the render task rejects

`renderPageToCanvas` allocates the canvas, then awaits `page.render(...).promise`
(`packages/pdf-core/src/render/renderPage.ts` before `fa07fc2`). The
`release()` call lives in `renderPageToImage`'s `finally`, which only runs if
`renderPageToCanvas` returns. A rejected render task (malformed content stream,
GPU context loss, a cancelled page) therefore discarded the only reference to a
page-sized bitmap without zeroing it; `renderPages`/`renderThumbnails` continued
with the rest of the document and held it until GC. The `!context` branch had
the same shape.

Regression test: `packages/pdf-core/test/renderPage-cleanliness.test.ts` uses a
page whose `render()` rejects and asserts `release` ran; it failed with 0
releases before the fix. Commit `fa07fc2`.

### PDF-ENGINE-005 — duplicate ZIP entry names

`dedupeNames` (`packages/pdf-core/src/ops/zip.ts`) counted occurrences of each
*original* name. `['a.png','a.png','a-2.png']` produced
`['a.png','a-2.png','a-2.png']`, because the generated `a-2.png` was never
checked against the third input. `fflate` keeps one entry per path, so the
archive silently lost one file. The fix tracks every emitted name and advances
the suffix until it is unused; `createZip` calls the same helper, so the
reported entry list and the archive agree. Commit `550f545`.

### PDF-RENDER-001 — render scale was not fitted to the canvas budget

Measured with the real pipeline on synthetic pages (`renderPageToCanvas`, fixed
widths) before `6d49d7d`:

```text
tall viewport 600 6000
tall ok   540   540x5400
tall ok   775   775x7750
tall FAIL 1600  Rendered page would be 1600x16000 px; the limit is 8192 px on the longest side. Choose a smaller width.
tall FAIL 2560  Rendered page would be 2560x25600 px; the limit is 8192 px on the longest side. Choose a smaller width.
editor budget widths at zoom 0.6/1/1.5/2: 540 / 900 / 1095 / 1095
```

At the editor's fit-width zoom (1.5 on a ~950 px column, times `RASTER_SCALE`
1.5) the requested width is 1095 px, i.e. a 10950 px tall bitmap, so the page
failed on open at every preset. `scaleForWidth` also capped the scale at 8x
before the budget was consulted: a 250 pt page at a 2560 px request rendered at
2000 px with no warning, and the 5000x5000 pt case stayed under 8192 per side
but asked for 64 MP (4 bytes/pixel = 256 MB; WebKit's canvas ceiling is
16,777,216 px and paints larger ones blank).

Fix: `fitScaleToBudget` (`src/render/canvas.ts`) takes the smallest of the
requested scale, `maxRenderEdgePx / longestSide` and
`sqrt(maxRenderAreaPx / area)`, and `renderPageToCanvas` uses it instead of
rejecting the page. New limits live in `limits.ts` (`maxRenderEdgePx: 8192`,
`maxRenderAreaPx: 16_777_216`). The regression tests pin the former failures:
`render-budget.test.ts` (unit arithmetic and `renderPageToCanvas` dimensions)
and the golden renders of the rotated/cropped fixtures. Commit `6d49d7d`.

### PDF-RENDER-002 — typography rotation was PDF-space, not display-space

Probe of `rotated-90.pdf` page 1 (a `/Rotate 90` page) before `b5cfcfa`:

```text
run  {"t":"ROTATED-90", "x":47, "y":50, "w":15, "h":74.68, "horiz":false}
para {"t":"ROTATED-90", "bbox":{"x":47.84,"y":50,"width":12,"height":74.68}, "rot":0}
```

The line's glyphs and `Line.rotationDeg` are vertical (90°), while the
paragraph's `typography.rotationDeg` is 0 and `direction` is `ltr`;
`TextTypography.rotationDeg` is documented as "Baseline angle in display space"
(`document/types.ts:63`). `glyphs.ts` derived it from `matrixRotation` of the
raw PDF matrix, which does not include the page's `/Rotate`. The viewport maps
a text-space angle `θ` to display `pageRotation - θ`, so the fix subtracts the
matrix angle from `geometry.rotation`. `document/group.ts:2105` keys paragraph
orientation by this field, so rotated paragraphs were being grouped as
horizontal. Regression test: `textModel.test.ts` — "reports typography rotation
in display space on a rotated page" (fails with 0 before the fix). Commit
`b5cfcfa`.

### PDF-RENDER-003 — non-embedded CJK fonts paint `.notdef` boxes

The CJK fixture is a Type0/CIDFontType0 font (`STSong-Light`) with no
`FontFile` and a working `ToUnicode` CMap. Text extraction returns
`你好，世界`; rendering the page at 2x produces five hollow rectangles. The
reference crop inspected during this session shows the boxes, and the new
`it.fails` repro in `render-regression.test.ts` asserts that at least three of
the five glyph cells have ink inside their own ink box (a `.notdef` box has
none). The cause is the font strategy, not the fixture: `loadPdfForRender`
sets `disableFontFace: true` and `useSystemFonts: false` (deterministic
path-only rendering inside a worker), and pdf.js can only fall back to a system
font through a `document.fonts` FontFaceSet, which a dedicated worker does not
have (`job-worker.ts:33-41`). The fix is a bundle decision (an embeddable CJK
fallback, e.g. a subsetted Noto/Adobe Song, or an explicit "this document uses
a non-embedded CJK font" warning), so it is parked in Needs decision.

### PDF-RENDER-004 — ICC profiles and wasm decoders are not configured

`PdfjsRuntimeConfig` has no `wasmUrl`/`iccUrl`, and `job-worker.ts` passes
neither. In the installed pdf.js (`6.4.299`), `IccColorSpace.isUsable` warns
`No ICC color space support due to missing 'wasmUrl' API option` and
`CmykICCBasedCS.isUsable` warns `No CMYK ICC profile support due to missing
'iccUrl' API option`; an ICCBased space then falls back to its component-count
default, i.e. the profile is ignored. Shipping `wasm/{qcms_bg,openjpeg,jbig2}.wasm`
and `iccs/CGATS001Compat-v2-micro.icc` (~480 KB total) plus the two URLs fixes
it; that is a build/packaging decision, so it is parked rather than guessed.

### PDF-RENDER-005 — rotated-page inline editing has no rotation transform

On `/Rotate 90`, a paragraph's box is `18 x 289` pt (vertical). The inline
editor (`text-layer.tsx:542-566`) and the text-object preview
(`editor-page.tsx:996-1012`) position by that box but never rotate the element,
so a horizontal textarea is laid into a vertical strip. The text remains
editable and commits correctly; the presentation is wrong. Fixing it needs a UI
decision (rotate the editor surface, or switch rotated text to a line-by-line
editor), so it is parked.

### PDF-RENDER-006 — a document swap bypasses the raster concurrency cap

`invalidateDocumentCaches` zeroes `rasterActive`/`rasterQueue`
(`edit-pdf-tool.tsx:805-809`) while `ensureRaster` calls from the previous
document are still awaiting the job pool. Their `finally` (`:638-659`) then
decrements the *new* counter, deletes a pending marker and dequeues a page of
the new document, so the intended `MAX_PARALLEL_RASTERS = 2` can be exceeded
(up to four full `file.arrayBuffer()` reads at once). The fix is a captured
generation guard before the `finally` side effects. Deferred because the
editor's raster queue has no test harness in Node; the browser probe used for
METRICS.md is not a deterministic repro.

---

## Counts

By area:

| Area | Findings |
| --- | --- |
| ENGINE | 7 (`001`, `002`, `003`, `005`, `006`, `007`, `008`) |
| EXPORT | 1 (`004`) |
| RENDER | 6 (`001`–`006`) |
| EDITOR | 0 |
| SHARE | 0 (not implemented — see `ARCHITECTURE-PDF.md` §5) |
| SEC-UPLOAD | 1 (`001`) |

By severity:

| Severity | Findings |
| --- | --- |
| HIGH | 5 (`ENGINE-001`, `ENGINE-003`, `ENGINE-006`, `RENDER-001`, `RENDER-003`) |
| MEDIUM | 5 (`ENGINE-002`, `ENGINE-007`, `ENGINE-008`, `SEC-UPLOAD-001`, `RENDER-004`) |
| LOW | 5 (`ENGINE-004`, `ENGINE-005`, `RENDER-002`, `RENDER-005`, `RENDER-006`) |

Session 2 closed 5 of the 8 in-scope findings; the 3 open ones are all
needs-decision (form, metadata and annotation policy, below). Session 3 closed
2 of the 6 RENDER findings, parked 3 decisions and deferred 1 harness.

---

## Needs decision

These are product/contract decisions, not implementation details. A fix that
guesses one of them can break issued documents or surprise users, so they are
parked here rather than "fixed".

1. **Form policy across document boundaries (`PDF-ENGINE-001`).**
   Single-source compose can copy the field tree and remap widget `/P` refs.
   Multi-source merge/combine has no obvious answer: keep only the first
   document's form, rename colliding field names, or flatten every form and
   carry appearances only. Also decide whether a copied page's widgets should
   stay live, become static, or be dropped with a warning. Session 2 did not
   guess: the naive fix (copy the catalog `/AcroForm` with a fresh copier)
   either duplicates the page tree through every widget `/P` or leaves the
   field widgets disjoint from the page annotations, so it needs the policy
   above. Duplicated pages in Organize add a second sub-question (one field
   tree, several widget copies).
2. **Metadata precedence (`PDF-ENGINE-002`).**
   Single-source compose should inherit Title/Author/Subject/Keywords, but
   Merge/Combine need a rule: first document wins, last wins, union of keywords,
   or no semantic metadata by design. The current date policy ("earliest
   creation, latest modification") suggests source-derived values are wanted;
   the tool copy does not say.
3. **Annotation semantics on Flip/Resize (`PDF-ENGINE-003`).**
   Carrying a live annotation through a geometry rebuild is not just a copy:
   rectangles, quad points and link destinations must be transformed, and a
   digital signature would be invalidated by the rewrite. The alternatives are
   (a) transform and re-create live annotations, (b) flatten their appearances
   into page content, or (c) refuse/warn when annotations exist. Pick one before
   implementing.
4. **Warning surface for lossy tools.** Today all of the above are silent. If
   the chosen policy keeps any loss, the tool result should say what was
   dropped; that is a UI/contract change, not an engine detail.
5. **Non-embedded CJK fallback (`PDF-RENDER-003`).** A worker has no
   `FontFaceSet`, so the current deterministic path-only font strategy renders
   `.notdef` boxes for Type0 fonts without a `FontFile` (the common
   `STSong-Light` case) even though the text extracts correctly. Options:
   bundle a subsetted CJK fallback font and wire it into pdf.js's substitution
   map (size/licensing), render those documents in a context with a font stack,
   or accept the boxes and warn the user before exporting. This changes visible
   output and ships a font, so it is not guessed here.
6. **ICC/wasm rendering assets (`PDF-RENDER-004`).** Enabling ICC conversion
   means shipping pdf.js's `wasm/` and `iccs/` files (~480 KB) and passing
   `wasmUrl`/`iccUrl` from `job-worker.ts`, plus a build rule that keeps them in
   sync with the pdf.js version. It changes colors for ICC/CMYK documents and
   adds reviewed binary assets, so the packaging decision goes here.
7. **Rotated-text inline editing (`PDF-RENDER-005`).** The paragraph editor and
   text-object preview do not rotate with the page. Rotating the editing
   surface or replacing it with a vertical editor changes interaction design,
   so it needs a decision.

---

## RENDER coverage checked, no defect found

These were checked numerically rather than by eye, and are now guarded by
tests:

- **DPR / scale.** `renderPageToCanvas` asks for the requested width and lets
  the budget clamp it; ordinary pages are unchanged at every preset
  (`render-budget.test.ts`: A4 at 1190 px -> 1190x1684, US Letter at 1600 ->
  1600x2070). The editor's `RASTER_SCALE` and `rasterWidthWithinBudget`
  arithmetic was already correct (session-1 fix); the regression suite renders
  the rotated fixture at 1x and 2x.
- **Rotation / CropBox.** `getViewport` and `pageGeom` agree for all four
  rotations with and without a non-zero CropBox; `rotated-90.pdf` and
  `cropbox-offset.pdf` are golden references at 1x (and rotated at 2x).
- **Overlay alignment.** `extractFormWidgets` (pdf-lib) and
  `page.getAnnotations()` (pdf.js) agree to 0.1 px for a widget on all four
  rotations, cropped and uncropped (`editor.test.ts`). Text-layer paragraph
  boxes contain the rendered ink (>= 80% coverage of a 2 px halo) and the
  click-to-replace run boxes land within 0.3 em of the paragraph box on every
  fixture page (`render-regression.test.ts`).
- **Blank/partial pages.** Every golden render must contain ink; the image-only
  page covers 19% of its pixels. No page in the corpus renders blank except the
  CJK `.notdef` case above.
- **RTL.** The Arabic fixture paints glyphs (not tofu); its reversed logical
  order is pdf.js's documented visual-order output, not corruption.
- **Flicker / cache.** Blob-URL replacement keeps the previous `<img>` content
  until the new decode commits; the raster cache is bounded to 12 resident
  pages with a 4-page retain margin. No defect was observed in the browser
  scroll probe (`METRICS.md`). The swap-time concurrency issue is
  `PDF-RENDER-006` (deferred).
- **Virtualized page list.** There is no windowing library: the editor renders
  every `EditorPage` and lazy-loads its raster, so there is no virtualized list
  to mis-index.

---

## Out of scope / not findings

- The 60 sweep failure groups caused by the marketing footer reveal
  (`apps/web/src/components/layout/footer.tsx:135`, only `useReveal()` call site
  `apps/web/src/pages/home.tsx:14`) are recorded in `BASELINE.md`. That is a web
  UI regression, not part of the PDF engine.
- The "Setting up fake worker." pdf.js message is expected inside the job worker
  (`apps/web/src/workers/job-worker.ts:33-41`).
- Arabic text appearing reordered after extraction is pdf.js visual-order output,
  not corruption (`packages/pdf-core/src/jobs/text.job.ts:39-44`).
- Gated e2e/sweep suites could not run because Docker, Redis and Memurai were
  unavailable in this environment; the gap and the failed preflight are recorded
  in `BASELINE.md`. No result here depends on those suites.

---

## Verification

```powershell
# Repros: 7 known-failing cases, suite stays green while the bugs exist.
pnpm --filter @pdfshush/pdf-core exec vitest run test/pdf-audit

# Watch a repro actually fail: remove `.fails` from one `it.fails` case.
# On a correct fix, the case must be promoted to `it` (delete `.fails`).
```

Session-1 repro commit: `7845dca` (docs, fixtures and known-failing tests only;
no source change). Session-2 fixes: `550f545`, `9382d1d`, `fa07fc2`, `85a5d68`,
`d3d0dde` (one root cause each). Session-3 fixes: `6d49d7d`, `b5cfcfa`; the
render-regression corpus and overlay coverage are `160fdf4`. Lifecycle and
render numbers: `METRICS.md`.

Session-2 commands:

```powershell
pnpm typecheck
pnpm test                 # 1418 passed, 0 failed, 7 expected fail
pnpm build
pnpm test:bundle
node tests/support/preflight.mjs   # exit 1: Docker/Redis/API unavailable
```

Session-3 commands (results in `METRICS.md`):

```powershell
pnpm typecheck            # pass
pnpm test                 # 1439 passed, 0 failed, 8 expected fail
pnpm build                # pass, 63 routes prerendered
pnpm test:bundle          # pass, 0 engines in app chunks
node tests/support/preflight.mjs   # exit 1: web/API/Docker unavailable
node tests/sweep.mjs      # ungated diagnostic: exit 1, same 60 footer-reveal groups
node tests/fixtures/pdf-audit/generate.mjs   # fixtures unchanged (byte-identical)

# Regenerate the golden renders only for a deliberate rendering change:
$env:UPDATE_RENDER_REFS='1'
pnpm --filter @pdfshush/pdf-core exec vitest run test/render-regression.test.ts
Remove-Item Env:UPDATE_RENDER_REFS
```

Lint has no configured script in this workspace (same as `BASELINE.md`).
