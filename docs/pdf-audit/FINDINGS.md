# PDF findings — PDFShush

Read-only audit of `apps/` and `packages/` at commit `c8f2208`
(branch `pdf/s1-audit`, 2026-11-11). Session 1 made no source change; the only
committed artifacts are these documents, the audit fixtures and the
known-failing repro tests.

Session 2 (branch `pdf/s2-engine`, cut from `pdf/s1-audit`) audits the ENGINE
and SEC-UPLOAD focus areas and fixes every unambiguous defect found there.
Per-fix commits and verification are recorded in the status column; decisions
that change product policy stay in "Needs decision" rather than being guessed.

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

---

## Counts

By area:

| Area | Findings |
| --- | --- |
| ENGINE | 7 (`001`, `002`, `003`, `005`, `006`, `007`, `008`) |
| EXPORT | 1 (`004`) |
| RENDER | 0 |
| EDITOR | 0 |
| SHARE | 0 (not implemented — see `ARCHITECTURE-PDF.md` §5) |
| SEC-UPLOAD | 1 (`001`) |

By severity:

| Severity | Findings |
| --- | --- |
| HIGH | 3 (`ENGINE-001`, `ENGINE-003`, `ENGINE-006`) |
| MEDIUM | 4 (`ENGINE-002`, `ENGINE-007`, `ENGINE-008`, `SEC-UPLOAD-001`) |
| LOW | 2 (`ENGINE-004`, `ENGINE-005`) |

Session 2 closed 5 of the 8 in-scope findings; the 3 open ones are all
needs-decision (form, metadata and annotation policy, below).

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
`d3d0dde` (one root cause each). Lifecycle numbers: `METRICS.md`.

Session-2 commands:

```powershell
pnpm typecheck
pnpm test                 # 1418 passed, 0 failed, 7 expected fail
pnpm build
pnpm test:bundle
node tests/support/preflight.mjs   # exit 1: Docker/Redis/API unavailable
```

Lint has no configured script in this workspace (same as `BASELINE.md`).
