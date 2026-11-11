# PDF findings — PDFShush

Read-only audit of `apps/` and `packages/` at commit `c8f2208`
(branch `pdf/s1-audit`, 2026-11-11). Session 1 made no source change; the only
committed artifacts are these documents, the audit fixtures and the
known-failing repro tests.

Session 2 (branch `pdf/s2-engine`, cut from `pdf/s1-audit`) audits the ENGINE
and SEC-UPLOAD focus areas and fixes every unambiguous defect found there.
Per-fix commits and verification are recorded in the status column; decisions
that change product policy were parked until session 6, when the owner answered
them and they were implemented.

Session 3 (branch `pdf/s3-render`, cut from `pdf/s2-engine`) audits the RENDER
focus area: page rasterisation and its canvas budget, rotation/CropBox frames,
font substitution (including CJK/RTL), text-layer/overlay alignment, and the
editor's raster cache. It fixed two defects and recorded three decisions; the
render-regression corpus it added is the evidence anchor for the rest.

Session 4 (branch `pdf/s4-editor`, cut from `pdf/s3-render`) audits the EDITOR
and EXPORT focus areas: display-space geometry and caret placement, text-edit
fidelity, form-field editing, annotation persistence, undo/dirty state, and the
export jobs. It added a fixture-wide round-trip harness, closed `ENGINE-004`
and seven EDITOR findings, fixed one image-export decoder defect, and parked
two export policy decisions.

Session 5 (branch `pdf/s5-share`, cut from `pdf/s4-editor`) was scoped to
SHARE. SHARE does not exist in `apps/` or `packages/` (see `PDF-SHARE-000`), so
the session audited the only second-party access surface that does: the per-job
`jobId` + `x-job-token` capability and the result download streamer. It fixed
two defects there (`PDF-SHARE-001`, `003`), fixed one redaction-gate defect
found while proving byte-level removal (`PDF-REDACT-001`), parked the inability
to revoke a finished result (`PDF-SHARE-002`), and wrote the design-only
`SHARE-SPEC.md`.

Session 6 (branch `pdf/s6-decisions`, cut from `pdf/s5-share`) implemented the
owner's decisions rather than re-auditing: a finished job can now be revoked,
page-copy tools keep their AcroForm and semantic metadata, Flip/Resize flatten
annotations instead of deleting them, the four lossy/limited surfaces report a
non-blocking `warnings[]` notice, and `PDF-RENDER-003` warns instead of staying
silent (the glyph fix itself remains deferred by the no-bundled-font decision).
The `it.fails` repros that had become ordinary pass/fail cases were promoted to
normal tests; only the CJK glyph repro remains expected-fail.

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
| 1 | `PDF-ENGINE-001` | ENGINE | Every page-copy/rebuild tool returns a PDF with no `/AcroForm`. Widget annotations remain on the page as unregistered orphans, so `inspect` reports 0 fields and no viewer can fill the form. Affects Organize, Delete Pages, Extract, every Split, Rotate/Crop, Merge, Combine, Stamp, Watermark, and the compose step of Flip/Resize. Silent. | `packages/pdf-core/src/ops/compose.ts:71` (`PDFDocument.create()`), `:95` (`copyPages`), `:133` (`addPage`) never carry the catalog-level form. Same shape: `ops/merge.ts:31,45`, `ops/combine.ts:71,96`, `ops/nup.ts:87`, `ops/split.ts:52-53`. | HIGH | L | HIGH | **Fixed** for page-copy tools (`b721487`); N-up imposes onto new sheets and is outside the copy policy | `packages/pdf-core/test/pdf-audit/page-pipelines.test.ts` |
| 2 | `PDF-ENGINE-003` | ENGINE | Flip and Resize silently delete every page annotation and form widget: highlights, comments, links, stamps, signatures and form fields disappear. Page content itself is preserved. | `packages/pdf-core/src/ops/transform.ts:85-106` (`addPage` + `embedPage` + `removePage`) and `:152-176`. `embedPage` copies content streams only; `/Annots` is a page-dictionary entry, not content, so it is never re-attached. | HIGH | L | HIGH | **Fixed** (`2160778`) — flattened into content, warning emitted, signatures refused | `packages/pdf-core/test/pdf-audit/transform-annotations.test.ts` |
| 3 | `PDF-ENGINE-006` | ENGINE | A small, valid PNG (or JPEG) declaring an enormous raster is handed to `embedPng`/`embedJpg` before any limit is applied, so the worker inflates the full bitmap. A 63 KB PNG declaring 9000×1 px was accepted; an attacker-sized IHDR is a decompression bomb that dies as an OOM/tab crash instead of a refusal. | `packages/pdf-core/src/ops/imageDocs.ts:145-147` (`imagesToPdf` embeds first, checks later — it never checked at all) and `ops/combine.ts:114-116`. `LIMITS.tool.maxImagePixels` was only applied by the editor path (`ops/edit.ts:350-355`). | HIGH | S | LOW | **Fixed** (`9382d1d`) | `packages/pdf-core/test/next-tools.test.ts`, `packages/pdf-core/test/bookmark-batch.test.ts` |
| 4 | `PDF-ENGINE-002` | ENGINE | `/Title`, `/Author`, `/Subject` and `/Keywords` disappear from the output of the compose/merge/combine family. `/CreationDate` and `/ModDate` survive. | `packages/pdf-core/src/ops/compose.ts:71-72`, `ops/merge.ts:34`, `ops/combine.ts:138`; `ops/dates.ts:91-99` deliberately sets/removes only the two date keys. | MEDIUM | S–M | LOW | **Fixed** (`0d7dda8`) | `packages/pdf-core/test/pdf-audit/page-pipelines.test.ts` |
| 5 | `PDF-ENGINE-008` | ENGINE | A worker that crashes while it is *between* jobs stays in the pool. The next job is posted into a dead worker global that can never answer, so it hangs until its full timeout (up to 120 s by default) and then reports a timeout instead of a crash. | `apps/web/src/lib/job-pool.ts:155-161`: `worker.onerror` only finished/respawned when `slot.job` was set. An idle worker has no job, so nothing recycled it. | MEDIUM | S | LOW | **Fixed** (`85a5d68`) | `apps/web/src/lib/job-pool.test.ts` |
| 6 | `PDF-SEC-UPLOAD-001` | SEC-UPLOAD | Two uploaded files that sanitise to the same basename resolve to one path and the second write truncates the first. The job then runs with one document twice and one upload silently missing. Reproduced with `a b.pdf` + `a_b.pdf` (inline JSON) and with two maximum-length duplicate multipart names, where the `-2` suffix was truncated straight back off. | `apps/api/src/http/v1/routes.ts` deduped the *unsanitised* names; `apps/api/src/http/uploads.ts:183-191` appended the suffix before `store.writeInput` (`files/store.ts:77-78`) applied `safeFileName` again and truncated it. | MEDIUM | S | LOW | **Fixed** (`d3d0dde`) | `apps/api/test/v1.test.ts`, `apps/api/test/http.test.ts`, `apps/api/test/files.test.ts` |
| 7 | `PDF-ENGINE-007` | ENGINE | When a pdf.js render task rejects (bad content stream, GPU context loss, cancelled page), the page-sized canvas allocated just before the await is never released. A page that fails mid-run pins its bitmap until GC. | `packages/pdf-core/src/render/renderPage.ts:71-80` awaited `task.promise` with no `catch`; `renderPageToImage`'s `finally` only covers a successful `renderPageToCanvas` return. The `null`-context path also threw after allocation. | MEDIUM | S | LOW | **Fixed** (`fa07fc2`) | `packages/pdf-core/test/renderPage-cleanliness.test.ts` |
| 8 | `PDF-ENGINE-005` | ENGINE | A ZIP can contain two entries with the same path. `fflate` keeps only one of them, so a batch/split archive silently loses a file. Trigger: `['a.png','a.png','a-2.png']` → `['a.png','a-2.png','a-2.png']`. | `packages/pdf-core/src/ops/zip.ts:37-47` counted occurrences of the *original* name; a generated `-N` name was never checked against names that arrive later. | LOW | S | LOW | **Fixed** (`550f545`) | `packages/pdf-core/test/pdf-core.test.ts` |
| 9 | `PDF-ENGINE-004` | EXPORT | `pdf-to-text` on a page with no extractable text reported `charCount: 1` while the emitted `.txt` body was empty. | `packages/pdf-core/src/jobs/text.job.ts:94` added `line.length + 1` for every page, including an empty joined line. | LOW | S | LOW | **Fixed** (`5acf1be`) | `packages/pdf-core/test/pdf-audit/text-extraction.test.ts`, `packages/pdf-core/test/plain-tools.test.ts` |

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
| 12 | `PDF-RENDER-003` | RENDER | Non-embedded CJK text (Type0/CIDFontType0 with no `FontFile`, e.g. `STSong-Light`) extracts as `你好，世界` but every raster paints five `.notdef` boxes. Affects the editor preview, PDF-to-images, Grayscale, Dark mode and OCR output for those files. | `packages/pdf-core/src/render/pdfjsRuntime.ts:156-164` forces `disableFontFace: true` and `useSystemFonts: false`; a dedicated worker has no `FontFaceSet` (`apps/web/src/workers/job-worker.ts:33-41`), so pdf.js has neither a glyph program nor a system font to substitute. | HIGH | L | HIGH | **Warning fixed** (`6d499f0`); glyph fix deferred by the no-bundled-font decision | `packages/pdf-core/test/render-regression.test.ts` (`it.fails`, `PDF-RENDER-003`), `test/pdf-audit/font-warnings.test.ts` |
| 13 | `PDF-RENDER-004` | RENDER | ICC color management is disabled. pdf.js warns `No ICC color space support due to missing 'wasmUrl' API option`; an ICCBased color space is treated as its component-count default (the profile is ignored), so ICC/CMYK-derived colors can be wrong. JPEG2000/JBIG2 decode through the slower no-wasm fallback. | `packages/pdf-core/src/render/pdfjsRuntime.ts:13-29`, `:190-195` never pass `wasmUrl`, `iccUrl` or `useWasm`; `apps/web/src/workers/job-worker.ts:44-50` configures cmaps and standard fonts only. | MEDIUM | M | MEDIUM | **Deferred** — ships reviewed binary assets and changes colors | pdf.js source (`.pnpm/pdfjs-dist@6.4.299/.../pdf.worker.mjs:2784`, `:2807`) |
| 14 | `PDF-RENDER-005` | RENDER | Inline text editing on a rotated page is drawn horizontally: the paragraph box is 18x289 pt (vertical) but the textarea and the text-object preview have no rotation transform, so the editor shows short horizontal lines over vertical text. | `apps/web/src/components/editor/text-layer.tsx:542-566` (`editorStyle` has no `transform`), `apps/web/src/components/editor/editor-page.tsx:996-1012` (text preview). | LOW | M | MEDIUM | **Deferred** — changes interaction design | `docs/pdf-audit/.baseline/probe-observations.log`-style probe: rotated fixture paragraph bbox 18x289 at `pkgs/pdf-core` probe; code path above |
| 15 | `PDF-RENDER-006` | RENDER | Swapping documents while page rasters are in flight bypasses the two-render concurrency cap: `invalidateDocumentCaches` zeroes the counter and queue, then each old `ensureRaster` `finally` decrements the fresh counter and dequeues a page of the *new* document. Up to four full file reads run at once instead of two. | `apps/web/src/components/tools/edit-pdf-tool.tsx:805-809` (reset) vs `:638-659` (old callbacks mutate the new state). | LOW | S | LOW | **Deferred** — needs a browser/React harness; the fix is a generation guard in `finally` | `apps/web/src/components/tools/edit-pdf-tool.tsx:594-659` |

### Session 4 — EDITOR / EXPORT (`pdf/s4-editor`)

Session 4 cut from `pdf/s3-render` and audited the editor save path and the
export jobs. It added a fixture-wide round-trip harness
(`packages/pdf-core/test/pdf-audit/roundtrip.test.ts`, commit `900d452`) that
opens every fixture, applies a representative edit, saves, reopens and compares
page count, text, annotations, forms, metadata, rendered pixels outside the edit
box and file size. The harness and the focused repros below are green.

The highest-severity defect is data loss: a save that rewrote text in place
silently discarded form values. The remaining fixes are editor-fidelity and
state-tracking defects; two export policy questions are parked.

| Rank | ID | Area | Symptom | Root cause | Severity | Fix size | Risk | Status | Repro |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 16 | `PDF-EDITOR-002` | EDITOR | Filling a form field and editing text in the same save silently drops the form value whenever the text rewrite succeeds natively. The output text is correct, so nothing warns the user. | `packages/pdf-core/src/textedit/engine.ts:1058` made the overlay pass conditional on overlay/fallback objects only; `applyFormValues` runs inside that pass (`:1197`), so `formValues` never reached the document. | HIGH | S | LOW | **Fixed** (`a5bffdd`) | `packages/pdf-core/test/textEdit.test.ts` ("applies form values even when the text edit succeeds natively"), `test/pdf-audit/roundtrip.test.ts` |
| 17 | `PDF-EDITOR-003` | EDITOR | Two form widgets at the same rectangle on different pages are both reported on page 1 when `/P` is absent, so page 2's field has no editable overlay. | `packages/pdf-core/src/ops/forms.ts:222` built a rect→page map only; identical template rectangles collided and first-page won. `/Annots` ownership was never consulted. | MEDIUM | S | LOW | **Fixed** (`2967699`) | `packages/pdf-core/test/editor.test.ts` ("falls back to /Annots ownership when /P is missing") |
| 18 | `PDF-EDITOR-005` | EDITOR | The selected radio option renders unchecked until the user clicks a radio; all dots in a group start blank. | `apps/web/src/components/editor/editor-page.tsx:1209` compared the document's boolean selection to the option string, so `true === 'red'` was always false. | MEDIUM | S | LOW | **Fixed** (`d1b78d9`) | `apps/web/src/lib/form-widgets.test.ts` |
| 19 | `PDF-EDITOR-006` | EDITOR | After saving filled form values the header still says "Unsaved changes" and Back warns forever; conversely, typing in an inline paragraph editor is not dirty, so Back can close and lose the text. | `apps/web/src/components/tools/edit-pdf-tool.tsx:2778-2782` treated *any* form value as unsaved and omitted `paragraphEdit`; `requestExit` also used `hasEdits`, which stays true after a successful save. | MEDIUM | S | LOW | **Fixed** (`a642124`) | `apps/web/src/lib/editor-dirty.test.ts` |
| 20 | `PDF-EDITOR-001` | EDITOR | A two-line text box cannot be saved: validation reports the newline as a character the standard font cannot encode. | `packages/pdf-core/src/ops/edit.ts:418` passed structural control characters to the WinAnsi probe, although `wrapTextToWidth`/`drawText` already split on `\n`. | MEDIUM | S | LOW | **Fixed** (`ed9d2d3`) | `packages/pdf-core/test/editor.test.ts` ("accepts line breaks in a multi-line text box") |
| 21 | `PDF-EDITOR-007` | EDITOR | One nudge needs two undos: the first appears to do nothing because the pre-gesture snapshot was pushed twice. | `apps/web/src/components/tools/edit-pdf-tool.tsx:1658-1662` opened a transaction, then used `apply()` (which pushes a checkpoint) instead of `live()`; `endTx()` pushed the same snapshot again. | LOW | S | LOW | **Fixed** (`03cbf25`) | `apps/web/src/lib/editor-state.test.ts` (transaction contract) |
| 22 | `PDF-EDITOR-004` | EDITOR | The caret box on vertical (`/Rotate 90/270`) text is a one-pixel-wide bar across the top of the column and does not move with the offset; `caretAtParagraphOffset` returns the paragraph corner for every offset. | `packages/pdf-core/src/document/hitTest.ts:510` always advanced along +x and returned `{width:1,height:line.height}`. | LOW | S | LOW | **Fixed** (`32708be`) | `packages/pdf-core/test/textModel.test.ts` ("places a caret along the text axis on a rotated page") |
| 23 | `PDF-EXPORT-001` | EXPORT | Extract Images exports an image with remapped (`/Decode`, commonly `[1 0]` inverted) samples as its raw values, so a white image becomes black with no warning. | `packages/pdf-core/src/ops/images.ts:185` never inspected `/Decode`; the Flate re-encode and DCT pass-through both copy samples verbatim. | LOW | S | LOW | **Fixed** (`55f2321`) | `packages/pdf-core/test/plain-tools.test.ts` ("honestly skips a non-identity Decode array") |

"Fix size" is S (a few lines in one file), M (one module plus tests), L (new
mechanism across several ops plus regression coverage). "Risk" is the chance a
naive fix silently changes user-visible output in another tool.

### Session 5 — SHARE and the second-party surface (`pdf/s5-share`)

SHARE is not implemented, so there are no SHARE defects to inherit and no
issued links to protect. The session audited the capability that *does* let a
second party reach a document — the per-job `jobId` + `x-job-token` — and the
result download streamer behind it. Two defects were found and fixed; the one
product decision they exposed is parked.

The redaction check the scope also asked for ("is the content removed from the
bytes?") found no security hole, but driving it end to end exposed a
false-refusal in the verification gate, fixed as `PDF-REDACT-001`.

| Rank | ID | Area | Symptom | Root cause | Severity | Fix size | Risk | Status | Repro |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 24 | `PDF-SHARE-001` | SHARE | A completed result is cached by any intermediary that stores it: the URL (`/api/jobs/<id>/files/<name>`) contains no secret (the capability travels in `x-job-token`), and the response carried no `Cache-Control` at all. A shared cache can replay the document to a caller that never had the token, and keeps replaying it after expiry or revocation. Job state JSON and 404/403 bodies were cacheable too. | `apps/api/src/http/result-stream.ts:47-51` set only Content-Type/Length/Disposition; `apps/api/src/http/app.ts:375-412` and `v1/routes.ts:472-535` set no cache headers on state or errors. | MEDIUM | S | LOW | **Fixed** (`2cba94c`) | `apps/api/test/share-boundary.test.ts` ("tells every cache not to store…"), `tests/e2e/share-boundary.mjs` |
| 25 | `PDF-SHARE-002` | SHARE | A finished result cannot be revoked before the one-hour TTL. `DELETE /api/jobs/:id` answers 409 `not_cancellable`, removes nothing, and the same token keeps downloading the file. There is no other revoke route. | `apps/api/src/jobs/queue.ts:148` classifies completed/failed as `'finished'`; `apps/api/src/http/app.ts:430-438` maps that to 409 without touching the work directory. | MEDIUM | M | HIGH | **Fixed** (`9263c69`) — DELETE removes the result, 2xx, next read is 404 | `apps/api/test/share-boundary.test.ts` ("blocks access immediately when a completed job is revoked") |
| 26 | `PDF-SHARE-003` | SHARE | The download filename is written into `Content-Disposition` from the queue-reported value without re-sanitising it, although the route's own contract says the name is safe. A quote produces a malformed RFC 6266 quoted-string; a CR/LF makes `setHeader` throw after the stat, i.e. a 500 instead of a download. | `apps/api/src/http/result-stream.ts:51` (before `8e2fd65`) trusted the invariant enforced only by `files/store.ts:117` when the result was written. | LOW | S | LOW | **Fixed** (`8e2fd65`) | `apps/api/test/share-boundary.test.ts` ("sanitises the download filename reported by the queue") |
| 27 | `PDF-REDACT-001` | REDACT | Redacting a page completely is refused with "page-not-blank: a page lost its content — contrast spread only -255". The user asked for exactly that result; the error is indistinguishable from a failed render. | `packages/pdf-core/src/redact/verify.ts:430-455` (before `f922d62`) computed min/max luminance over samples outside the marks and asserted when there were none, instead of skipping the vacuous comparison. | LOW | S | LOW | **Fixed** (`f922d62`) | `packages/pdf-core/test/redact.test.ts` ("accepts a page that is entirely covered by its marks"), `test/pdf-audit/redaction-output.test.ts` |

#### `PDF-SHARE-000` — SHARE is not implemented (scope record, not a defect)

Verified four ways before any code was touched:

- `docs/pdf-audit/ARCHITECTURE-PDF.md:233-248` states SHARE is not implemented
  and that the audit makes no claim about link semantics.
- Route inventory of `apps/api/src` (`http/app.ts`, `http/v1/routes.ts`,
  `account/routes.ts`, `auth/routes.ts`, `ai/routes.ts`) contains no share
  route. `apps/web/src/pages/` contains only `account, home, not-found, tool,
  trust, verify, workflows`.
- `rg -i "shareLink|shareToken|createShare|/share|/:token" apps packages`
  returns nothing.
- `git log --all -S "shareToken"` / `-S "shareLink" -- apps packages` returns
  no commit that ever added one.

Consequence: there is no link format to preserve and no issued link that could
break. Implementing one requires public-API, schema and link-format decisions,
so the session produced `SHARE-SPEC.md` (design only, no code) and the user
chose option 2: audit the existing surface, do not build the feature.

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

`probe-observations.log` lines 363-367: `pdf-to-text image-only.pdf` returned
`charCount: 1` and `text: ""`. For comparison, `tiny-1page.pdf` returned 37 and
the CJK fixture returned 6 (`text.job.ts:94` was the formula).

Fixed in `5acf1be`: `charCount` is now the length of the body that is written
(`text.job.ts:97`), not `line.length + 1` per page. The single page separator
only exists *between* pages, so an empty document now reports 0 and a
multi-page export reports exactly the downloaded text length. The `it.fails`
repro was promoted to a normal test; `plain-tools.test.ts` also pins the
body/count equality.

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
a non-embedded CJK font" warning), so it was parked in Needs decision. Session
6 chose the warning only and left the glyph fix `it.fails`.

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

## Session 4 evidence (EDITOR / EXPORT)

### PDF-EDITOR-002 — form values dropped by a native text save

`editPdfText` had two save paths. When every edit rewrote its own text object,
the function returned the PDFium bytes directly:

```ts
const hasOverlay = fallbackObjects.length > 0 || overlayObjects.length > 0;
const finalBytes = hasOverlay ? await applyOverlayPass(...) : workingBytes;
```

`applyFormValues` is called only inside `applyOverlayPass`
(`textedit/engine.ts:1197`). With no overlay and no fallback, a non-empty
`options.formValues` was never read. Reproduced on `acroform.pdf` with one
in-place edit (`ACROFORM FIXTURE` -> `ACROFORM EDITED`) and
`{ 'person.name': 'Grace Hopper', 'person.country': 'India' }`: the text
changed, the report said `in-place`, and both captured values stayed `Ada
Lovelace` / `Japan`.

Fixed in `a5bffdd`: form values force the overlay pass, and the rectangles of
the widgets whose values were supplied are appended to the visual-edit regions
(`engine.ts:1147-1152`). Otherwise the final visual gate would correctly see the
widget appearance change as an unexpected pixel change outside the text-edit
box and refuse a save the user asked for. Regression coverage:
`textEdit.test.ts` and the harness's mixed save case.

### PDF-EDITOR-003 — /Annots ownership for widgets without /P

`extractFormWidgets` used `/P` first, then a rectangle→page map. `/P` is
optional, and form templates repeat the same widget rectangle on every page;
with no `/P`, the map kept the first page for every occurrence. The failing
repro creates two text fields at the same rect on pages 1 and 2, deletes `/P`
from both, and asserts each field is reported on its own page. Fixed in
`2967699` by mapping the exact widget dictionary from each page's `/Annots` to
that page (`forms.ts:234`); the rectangle remains the last resort.

### PDF-EDITOR-005 — the selected radio is invisible until clicked

`extractFormWidgets` returns one widget per radio option with
`value: selected === option`, i.e. a boolean. The overlay did:

```tsx
checked={widget.type === 'radio' ? value === widget.option : Boolean(value)}
```

so the initial `true === 'red'` comparison was false for every dot. The helper
`isFormWidgetChecked` (`apps/web/src/lib/form-widgets.ts`) accepts the
document's boolean and the overlay's option-string form; the component now uses
it. The pure helper is covered by `form-widgets.test.ts`.

### PDF-EDITOR-006 — dirty state was not the saved state

Two independent shapes in `edit-pdf-tool.tsx:2778-2782`:

- `Object.keys(formValues).length > 0` kept the document dirty after a
  successful save and after every value was reset.
- `paragraphEdit` was omitted, although an inline paragraph edit deliberately
  lives only in its textarea until commit. With no other edits the document was
  "clean", so Back called `resetAll()` without the unsaved-changes gate.

`requestExit` also used `hasEdits`, which is still true after a successful save.
Fixed in `a642124` with the pure `editorIsDirty` helper: the current
`EditorDoc` snapshot is compared with the one actually saved, and an active
paragraph edit / pending page or redaction work counts as dirty. Tests:
`apps/web/src/lib/editor-dirty.test.ts`.

### PDF-EDITOR-001 — newlines rejected by text-object validation

`findUnencodable` (`ops/edit.ts:418`) walked every code point and rejected
anything WinAnsi does not encode. A newline is structural: `wrapTextToWidth`
splits paragraphs on it and `drawText` maps each resulting line separately, so
it never reaches the font as a glyph. Nevertheless a normal two-line textarea
value failed validation with "cannot be drawn with the standard font". Fixed in
`ed9d2d3` by skipping `\n`, `\r` and `\t`; the test applies and exports a
two-line object and checks both lines are present.

### PDF-EDITOR-007 — a nudge pushed the pre-gesture snapshot twice

The nudge branch opened a transaction with `beginTx()` and then called
`apply(move)`. `apply` already pushes the current document onto the undo stack;
`endTx()` then pushed the transaction snapshot (the same document) again. One
undo therefore restored the pre-gesture state and left `canUndo` true with a
duplicate entry, so a second undo did nothing. Fixed in `03cbf25` by using
`live()` inside the transaction. `editor-state.test.ts` drives the real
`useEditorDoc` hook through a synchronous hook runtime and pins the
begin/live/end contract plus undo/redo snapshot identity.

### PDF-EDITOR-004 — caret geometry ignored the text axis

`caretRect` always returned `{ x: word.x + word.width * ratio, width: 1,
height: line.height }` with `y = line.bbox.y`. On a `/Rotate 90` page the line
advances downward, so the caret stayed on the top edge and moved horizontally
inside the 15 pt-wide column. `caretAtParagraphOffset` returned
`paragraph.bbox.{x,y}` for every offset. Fixed in `32708be`: the line's
`rotationDeg` decides whether the caret is a horizontal bar that walks down/up
or a vertical bar that walks left/right; reversed text walks right-to-left.
`textModel.test.ts` asserts the caret keeps one x and reaches the bottom of a
rotated line, and that the serialized caret point agrees.

### PDF-EXPORT-001 — `/Decode` remapping was ignored

`classifyImageStream` copied Flate samples through `encodeFlatPng` and passed
DCT bytes through untouched without reading `/Decode`. An image with
`/Decode [1 0]` (inverted grayscale) was therefore exported with its raw
samples: a white image came out black, uncounted. Fixed in `55f2321`: only the
identity map (or no `/Decode`) is accepted; any other map, and an indirect
reference that cannot be read safely, is skipped and counted like the other
unsupported encodings. The test accepts `[0 1]` and refuses `[1 0]`.

---

## Session 5 evidence (SHARE / second-party access)

### PDF-SHARE-001 — token-protected responses were cacheable

A probe against the real `createApp` (`apps/api/test/share-boundary.test.ts`,
before `2cba94c`) recorded a completed download as:

```text
GET /api/jobs/<id>/files/out.pdf   (x-job-token: <valid>)
200  content-disposition: attachment; filename="out.pdf"
     content-type: application/pdf
     content-length: 21
     referrer-policy: no-referrer
     <no cache-control>
     <no vary>
```

The same absence held for `GET /api/jobs/<id>` (200 JSON) and for the refusal
bodies. The URL contains no secret, so a shared cache keys on the URL alone: the
first authenticated fetch populates it, and a later request without the header
can be answered from the cache. `no-store` is the directive that forbids both
storage and reuse; `Vary: x-job-token` is the backstop for a cache that ignores
it. The middleware is registered on `/api/jobs` before the routes and on
`/api/v1/jobs` before `authenticate`, so 400/403/404/503 answers are covered too.
The `pdf-lib`-free probe above was turned into the regression test; the e2e
walkthrough asserts the header on a real download.

The same check found no other second-party leak in the file route: the token is
never accepted from the query string, is never echoed in a header, and a foreign
`Origin` gets no `Access-Control-Allow-Origin`.

### PDF-SHARE-002 — a finished result cannot be revoked

Probe on a completed job (before any change):

```text
DELETE /api/jobs/<id>              (x-job-token: <valid>) -> 409 {"code":"not_cancellable"}
GET    /api/jobs/<id>/files/out.pdf (x-job-token: <valid>) -> 200  %PDF-1.7 result-bytes
```

`BullJobQueue.cancel` returns `'finished'` for `completed`/`failed`
(`jobs/queue.ts:148`), and the route deliberately does not delete the work
directory in that case (`http/app.ts:430-438`). The result stays reachable for
the full retention window (`FILE_TTL_MS`, one hour by default) and there is no
other delete route. A queued job *is* revoked immediately: `cancel` removes the
job and `store.removeJob` (`queue.ts:158`), and the test asserts the next read is
404.

Why this was parked: making `DELETE` remove a finished result changes the public
semantics of an already-shipped route (today 409 means "nothing to cancel"), and
choosing between (a) 200 + delete, (b) a separate revoke endpoint and (c) a
signed short-lived URL is a product/API decision. The existing
`http.test.ts` case pins the current 409 contract; the session added the
desired-behaviour repro as `it.fails` so the suite stays green and turns red the
day the decision lands. `SHARE-SPEC.md` §5.1/§9 (D8) records the options.

Superseded in session 6: the owner chose (a). See "Session 6 evidence -
PDF-SHARE-002".

### PDF-SHARE-003 — the header trusted a queue-supplied name

Before `8e2fd65`, `sendResultFile` wrote `args.name` into
`Content-Disposition` while `statResult` beside it re-sanitised the same value.
With a queue snapshot of `report".pdf` the probe received:

```text
content-disposition: attachment; filename="report".pdf"
```

which is not a valid quoted-string. The regression test writes the file under
the sanitised name (`report_.pdf`) and poisons the queue snapshot with the raw
one; `safeFileName` at the header boundary produces
`attachment; filename="report_.pdf"`. The function is idempotent for names the
store already sanitised, so ordinary downloads are unchanged.

### PDF-REDACT-001 — a fully marked page was refused

The end-to-end redaction run (`test/pdf-audit/redaction-output.test.ts`) first
used a whole-page region and failed inside the shipped gate:

```text
RedactionVerificationError: Redaction verification failed — no output is offered.
- page-not-blank: a page lost its content — p1: contrast spread only -255
```

`verifyRedaction` scans samples *outside* the marks; with a full-page mark there
are none, so `darkest`/`lightest` kept their sentinels and the difference became
negative. Fixed in `f922d62` by counting the samples and skipping the comparison
when the set is empty; a page covered entirely by its marks now reports
`every page is covered entirely by its marks`. The safety property is not
weakened: `marks-burned-in` still fails a blank rebuild, because a white page
cannot be dark inside its own marks. The test asserts both the new acceptance
and the unchanged blank-page rejection.

### Redaction: removal, not covering (verified, no defect)

`redactPdf` rebuilds every page from an image and verifies the serialized bytes
before returning them (`redact/redact.ts:227-232`). Session 5 re-verified this
from the outside, on the shipped output of a committed fixture
(`test/pdf-audit/redaction-output.test.ts`):

- pdf.js extracts **no** text from the output, while the control run extracts
  the fixture's text from the source;
- the gate's decompressing scan finds no text-showing operator and no
  forbidden string in the same bytes (re-run independently of the pipeline);
- the object graph contains no `/AcroForm`, `/EmbeddedFiles`, `/Metadata`,
  `/Info`, and no font object (`/BaseFont`, `/Type /Font`, Type0/TrueType/Type1);
  an empty `/Font << >>` written by pdf-lib for a fresh page is present and
  carries no font;
- every page is exactly one full-size image, and the mark is opaque in the
  pixels (`marks-burned-in`).

The existing browser e2e performs the same structural checks on a real redaction
(`tests/e2e/smoke.mjs` §19b: no font object, no annotation/attachment tree,
every page replaced by an image). No defect was found in removal.

### Checked, no defect

| Check | Evidence |
| --- | --- |
| Token entropy / CSPRNG | 32 CSPRNG bytes for the pepper (`context.ts:newPepper`), persisted `0600` (`resolvePepper`); token is 64 hex chars and changes with pepper or job (`share-boundary.test.ts`); `PEPPER` is validated at 16 characters minimum (`config.ts:40`). |
| Constant-time comparison | `tokensMatch` uses `timingSafeEqual` with an explicit length guard (`quota/quota.ts:44-49`); equal-length mismatch and different-length inputs both reject without throwing (test). |
| Tokens in logs | No request logger; every log call passes an explicit shape (`job queued` logs id/slug/count/bytes only, `app.ts:362-365`); pino redacts `token`, `*.token`, `x-job-token`, `cookie` and the auth headers (`logger.ts:17-39`). |
| Tokens in referrers / URLs | The token is header-only and a query-string token is refused (403, test); the e2e asserts a download URL contains no token; helmet sets `Referrer-Policy: no-referrer` on every response (observed in the probe and asserted in the test). |
| Expiry enforced server-side | Authorisation precedes state; a result whose files the janitor removed answers 404 `result_not_found` (`store.statResult` → `sendResultFile`); the queue entry alone never grants bytes. Tested. |
| IDOR | The token is bound to the id used to derive it; a token from job A on job B is 403 for state and file; a file name that exists only under another job is 404. Tested + e2e. |
| Path traversal | `safeJobId` rejects a malformed id with 400; `safeFileName` + `resolveWithin` contain every name; `../`, encoded `%2F` and backslash variants all 404. Tested + e2e. |
| Content-Type / Disposition | Closed allowlist (`contentTypeFor`), `attachment` with a sanitised filename, `X-Content-Type-Options: nosniff` (helmet). Tested; the `.json` case is pre-existing coverage. |
| CORS | No CORS middleware; a foreign `Origin` receives no `Access-Control-Allow-Origin` and no allow-credentials. Tested. |
| Status codes | 400 malformed id, 403 missing/wrong token (foreign and unknown indistinguishable), 404 unknown/expired/removed result, 200/206 not implemented. Tested + e2e. |
| Range requests | **Not supported, and not a defect on a download-only route.** A probe with `Range: bytes=0-4` returned 200 and the complete 21-byte body with `Content-Length: 21` and no `Accept-Ranges`; RFC 9110 §14.2 permits ignoring `Range`. Large downloads therefore cannot resume — recorded as a requirement for the future share route (`SHARE-SPEC.md` §5.3), not fixed here, because adding partial-content semantics changes the shipped response contract for every result kind. |

## Session 6 evidence (owner decisions)

Session 6 did not re-audit. It implemented the decisions the owner made for the
parked items, one root cause per commit, and converted every `it.fails` repro
whose bug is now fixed into an ordinary test. The four affected surfaces share
one new contract: an optional `warnings?: string[]` on a successful job result,
rendered by `ResultPanel` as a non-blocking notice. Older clients ignore it, and
a job with nothing to report omits the key entirely.

### PDF-SHARE-002 — revoking a finished result

`DELETE /api/jobs/:id` now handles the queue's `finished` outcome by removing
the job's work directory and answering `200 {"status":"deleted"}`. The queue
entry itself is untouched (the route owns the bytes), so a poll may still show
the completed state, but every download is a 404 `result_not_found` immediately
rather than after the retention janitor runs. Queued jobs keep `200 cancelled`,
and running jobs keep their cooperative `202 cancelling` contract.

Evidence: the former `it.fails` in `apps/api/test/share-boundary.test.ts` is a
normal test, a failed-job variant was added, `apps/api/test/http.test.ts` now
pins the 2xx/`deleted` contract, and `tests/e2e/share-boundary.mjs` performs the
real revocation and re-download. The same commit mounted the existing no-store
middleware on `/api/account*` and `/api/auth/me` with `Vary: cookie`, closing the
adjacent cache class recorded as risk 5 in the session-5 report.

### PDF-ENGINE-001 — AcroForm across page copies

`ops/formCopy.ts` clones the field tree node by node. It maps each widget's `/P`
to the destination page instead of letting a generic object copier follow `/P`
into the source page tree, and rewrites the page's `/Annots` to reference the
copied field widgets, so the form tree and the page share one widget object.
Single-source composes keep the form; merge/combine append each source's field
tree and rename colliding fully-qualified names (`person.name` -> `person.name_2`,
then `_3`); a duplicated page gets its own renamed field copies. The `/XFA`
mirror is dropped, leaving one authoritative AcroForm tree.

Evidence: `page-pipelines.test.ts` opens the fixture, copies, fills, saves and
reopens: `person.name`, `person.country` and `person.tags` keep their values and
the catalog registers `/AcroForm`. Merge of two forms exposes both `person.name`
and `person.name_2`; the duplicate-page case asserts every widget `/P` points at
one of the two real output pages (no page-tree duplication). The round-trip
harness gained a "merged form" case that fills both renamed fields. N-up is not
a page copy -- it imposes source pages onto new sheets -- so it stays outside
this policy rather than pretending a widget rectangle survived the imposition.

### PDF-ENGINE-002 — semantic metadata

`readDocumentMetadata`/`applyDocumentMetadata` copy Title, Author, Subject and
Keywords. Compose, N-up and split-in-half inherit their single source; merge and
combine use the first PDF (or first document) by explicit policy. The date
policy is unchanged: earliest creation / latest modification, written only by
`applyDocumentDates`.

Evidence: `page-pipelines.test.ts` pins all four fields on organize, merge and
combine, and asserts the inherited creation date is unchanged.

### PDF-ENGINE-003 — Flip/Resize annotation policy

The owner chose flattening. `ops/transform.ts` detects `/FT /Sig` fields and
refuses with a clear error before touching the page, then paints every
annotation into the page content before the page is embedded: a stored `/AP /N`
stream is invoked as a Form XObject with its `/BBox` mapped to the `/Rect`;
annotations without an appearance (the audit fixture's highlight, square and
free text) are synthesised from `/QuadPoints`/`/Rect`/`/C`/`/Contents`. Widgets
are included, so the output is deliberately no longer fillable and the AcroForm
registration is removed. The result carries a `warnings[]` notice naming the
count and the form loss.

Evidence: `transform-annotations.test.ts` asserts both tools emit the warning,
leave zero live annotations, and that a document with a signature field is
refused. `roundtrip.test.ts` adds a flip-with-annotation case and the render
corpus gained `flip-annotations.p1.s1.png`, a committed golden of the flattened
yellow highlight and blue square after the mirror. The image was inspected
before committing; the highlight box also passes an ink check.

### PDF-RENDER-003 — warning only, no bundled font

**Decision: do not bundle a CJK fallback font.** Size, licensing and the
deterministic path-only font strategy outweigh a glyph fix in this audit line.
`render/fontWarnings.ts` reads every page's font resources, finds Type0/CID
fonts with no `/FontFile`, `/FontFile2` or `/FontFile3`, and returns a warning
naming the font. PDF-to-images, Grayscale, Dark mode and OCR attach it to their
results, so the user sees the limitation instead of silent `.notdef` boxes.
The glyph repro stays `it.fails` in `render-regression.test.ts`; when a fallback
is chosen, that test is the acceptance criterion. Detection is best-effort: an
unreadable document returns no warning rather than failing the render.

### PDF-EXPORT-002/003 — alpha and source-page names

Extract Images now summarises `alphaDropped` into a warning (the files are still
opaque RGB; writing RGBA remains a future encoder change). PDF-to-images names
each output from its **source page number** (`pageIndexes[i] + 1`), so selecting
pages 3 and 5 produces `...-3.jpg` / `...-5.jpg`; the all-pages names and their
zero padding are unchanged. No contract change beyond `warnings[]` was needed.

### Deferred by decision (PDF-RENDER-004/005/006)

- `PDF-RENDER-004` (ICC/wasm assets) stays deferred: enabling it ships ~480 KB
  of reviewed binary assets and changes rendered colors for ICC/CMYK documents.
- `PDF-RENDER-005` (rotated inline editing) stays deferred: rotating the editor
  surface changes interaction design and needs a UI decision.
- `PDF-RENDER-006` (raster-cap race on document swap) stays deferred: the
  editor raster queue still has no deterministic Node harness, and the fix is a
  generation guard that should be proven in that harness.

---

## Counts

By area:

| Area | Findings |
| --- | --- |
| ENGINE | 7 (`001`, `002`, `003`, `005`, `006`, `007`, `008`) |
| EXPORT | 4 (`ENGINE-004`, `EXPORT-001`, `EXPORT-002`, `EXPORT-003`) |
| RENDER | 6 (`001`–`006`) |
| EDITOR | 7 (`001`–`007`) |
| SHARE | 3 (`001`–`003`); the area itself is not implemented — `PDF-SHARE-000` in the session-5 section |
| SEC-UPLOAD | 1 (`001`) |
| REDACT | 1 (`001`) |

By severity:

| Severity | Findings |
| --- | --- |
| HIGH | 6 (`ENGINE-001`, `ENGINE-003`, `ENGINE-006`, `RENDER-001`, `RENDER-003`, `EDITOR-002`) |
| MEDIUM | 11 (`ENGINE-002`, `ENGINE-007`, `ENGINE-008`, `SEC-UPLOAD-001`, `RENDER-004`, `EDITOR-001`, `EDITOR-003`, `EDITOR-005`, `EDITOR-006`, `SHARE-001`, `SHARE-002`) |
| LOW | 12 (`ENGINE-004`, `ENGINE-005`, `RENDER-002`, `RENDER-005`, `RENDER-006`, `EDITOR-004`, `EDITOR-007`, `EXPORT-001`, `EXPORT-002`, `EXPORT-003`, `SHARE-003`, `REDACT-001`) |

Session 2 closed 5 of the 8 in-scope findings; the 3 open ones were the form,
metadata and annotation policy decisions. Session 3 closed 2 of the 6 RENDER
findings, parked 3 decisions and deferred 1 harness. Session 4 closed
`ENGINE-004` and all seven EDITOR findings, fixed the `/Decode` image export
defect, and parked two export policy decisions (transparent images and output
page names). Session 5 closed `SHARE-001`, `SHARE-003` and `REDACT-001`.
Session 6 implemented every remaining engine/export/share-boundary decision:
`ENGINE-001`, `ENGINE-002`, `ENGINE-003`, `SHARE-002`, the warning surface
(`ENGINE-004` follow-up), `RENDER-003` (warning only), and `EXPORT-002`/`003`.
`RENDER-004`/`005`/`006` remain deferred with the reasons above; SHARE itself
and its twelve design decisions remain unimplemented by decision. Only the CJK
glyph repro (`RENDER-003`) is still `it.fails`; the other session-1 repros are
ordinary passing tests.

---

## Open decisions

The session-2/3/4/5 decisions were answered by the owner and implemented in
session 6 (see "Session 6 evidence"): form policy, metadata precedence,
annotation semantics on Flip/Resize, the warnings contract, the CJK choice
(warn, do not bundle a font), the two export options and revoking a finished
job are no longer parked. No ENGINE, EXPORT or SHARE-boundary decision remains
open.

1. **Share feature design (`SHARE-SPEC.md`).** Twelve decisions (storage
   lifetime, view/download semantics, edit permission, expiry defaults,
   status-code policy, password policy, backend, cascade, origin, audit,
   anonymous owners, embedding) are listed there with recommendations. No code
   exists until they are answered; issued links cannot be migrated cheaply,
   which is why they were not guessed.
2. **`PDF-RENDER-004` — ICC/wasm assets (deferred).** Enabling ICC conversion
   means shipping pdf.js's `wasm/` and `iccs/` files (~480 KB), passing
   `wasmUrl`/`iccUrl` from `job-worker.ts`, and adding a build rule that keeps
   them in sync with the pdf.js version. It changes colors for ICC/CMYK
   documents and adds reviewed binary assets.
3. **`PDF-RENDER-005` — rotated inline editing (deferred).** Rotating the
   paragraph editor or replacing it with a vertical editor changes interaction
   design; it should be decided with the editor UX, not in the engine audit.
4. **`PDF-RENDER-006` — raster-cap race on document swap (deferred).** The
   editor raster queue still has no deterministic Node harness, and the fix is
   a generation guard that should be proven there rather than merged on a
   browser probe alone.
5. **Future follow-ups, not findings.** Writing RGBA PNGs in Extract Images
   (the alpha loss is now warned), bundling a CJK fallback font (the glyph repro
   remains `it.fails`), and range support on the existing job download route
   (required for the future share route, not for the current download-only
   contract).

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
- Gated e2e/sweep suites could not run in sessions 1-4 because Docker, Redis and
  Memurai were unavailable; the gap and the failed preflight are recorded in
  `BASELINE.md`. Sessions 5 and 6 ran them live (see Verification). No result
  here depends on the blocked runs.

---

## Verification

```powershell
# The audit repro suite now has one expected-fail case (the CJK glyph render);
# every other decision repro is an ordinary test.
pnpm --filter @pdfshush/pdf-core exec vitest run test/pdf-audit
```

Session-1 repro commit: `7845dca` (docs, fixtures and known-failing tests only;
no source change). Session-2 fixes: `550f545`, `9382d1d`, `fa07fc2`, `85a5d68`,
`d3d0dde` (one root cause each). Session-3 fixes: `6d49d7d`, `b5cfcfa`; the
render-regression corpus and overlay coverage are `160fdf4`. Session-4 harness:
`900d452`; fixes: `ed9d2d3`, `a5bffdd`, `2967699`, `32708be`, `d1b78d9`,
`a642124`, `03cbf25`, `5acf1be`, `55f2321` (one root cause each). Session-5
fixes: `2cba94c`, `8e2fd65`, `f922d62`; evidence `f94ebda`. Session-6 fixes:
`9263c69` (SHARE-002 + account/auth cache), `7d0f75d` (warnings contract),
`b721487` (ENGINE-001), `0d7dda8` (ENGINE-002), `2160778` (ENGINE-003),
`6d499f0` (RENDER-003 warning), `7bd3051` (EXPORT-002/003). Lifecycle and render
numbers: `METRICS.md`.

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

Session-4 commands:

```powershell
pnpm typecheck            # pass
pnpm test                 # 1471 passed, 0 failed, 7 expected fail (115 files)
pnpm build                # pass, 63 routes prerendered
pnpm test:bundle          # pass, 0 engines in app chunks
pnpm --filter @pdfshush/pdf-core exec vitest run test/pdf-audit/roundtrip.test.ts  # 15 passed
pnpm --filter @pdfshush/web test  # 172 passed
node tests/support/preflight.mjs   # exit 1: web at :5173 and API at :8080 are down
```

Session-5 commands (logs in `docs/pdf-audit/.baseline/*-s5.log`):

```powershell
pnpm typecheck            # pass
pnpm test                 # 1496 passed, 0 failed, 8 expected fail (117 files)
pnpm build                # pass, 63 routes prerendered
pnpm test:bundle          # pass, 0 engines in app chunks
node tests/support/preflight.mjs   # exit 0: web + API reachable, compose ok
pnpm test:e2e             # ALL CHECKS PASSED (14 tools + editor + redact)
pnpm test:sweep           # 61 groups vs 60 at baseline (see FINAL-REPORT.md §4)
node tests/e2e/share-boundary.mjs  # 17/17: upload -> process -> token download -> denied
pnpm --filter @pdfshush/pdf-core exec vitest run test/pdf-audit/roundtrip.test.ts  # 15 passed
pnpm --filter @pdfshush/pdf-core exec vitest run test/render-regression.test.ts    # 10 passed, 1 expected fail
```

Session-6 commands (live, stack up):

```powershell
pnpm typecheck            # pass (all 7 packages)
pnpm test                 # 1523 passed, 0 failed, 1 expected fail (119 files)
pnpm build                # pass, 63 routes prerendered
pnpm test:bundle          # pass, 0 engines in app chunks
node tests/support/preflight.mjs   # exit 0: web + API reachable, compose ok
pnpm test:e2e             # ALL CHECKS PASSED (14 tools + editor + redact)
node tests/e2e/share-boundary.mjs  # 18/18 incl. finished-result revocation
pnpm test:sweep           # 60 groups vs 60 at baseline; no new group
pnpm --filter @pdfshush/pdf-core exec vitest run test/pdf-audit/roundtrip.test.ts  # 17 passed
pnpm --filter @pdfshush/pdf-core exec vitest run test/render-regression.test.ts    # 11 passed, 1 expected fail
```

The CJK glyph repro is the single expected fail. `RENDER-004`/`005`/`006` are
deferred with the reasons in "Open decisions"; nothing was added to the bundle.

The gated suites ran for the first time in this audit: Docker, Redis, the API
and the web dev server were all available in this session. Lint is still not
configured (`pnpm lint` → `Command "lint" not found`), same as `BASELINE.md`.

The gated e2e/sweep suites were blocked in sessions 1–4 by a missing stack
(preflight exit 1). Session 5 was able to start Docker, Redis, the API and the
web dev server, so `pnpm test:e2e` and `pnpm test:sweep` ran for real; the
results are above and in `METRICS.md`. Lint still has no configured workspace
script (same as `BASELINE.md`).
