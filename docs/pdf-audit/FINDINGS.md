# PDF findings — PDFShush

Read-only audit of `apps/` and `packages/` at commit `c8f2208`
(branch `pdf/s1-audit`, 2026-11-11). No source change was made in this session;
the only committed artifacts are these documents, the audit fixtures and the
known-failing repro tests.

Evidence conventions:

- `file:line` points at the root cause in the tree at `c8f2208`.
- Every finding has a repro test under `packages/pdf-core/test/pdf-audit/`.
  Those tests assert the **desired** behaviour and are marked `it.fails`, so the
  suite is green while the bug exists and turns red the moment a fix lands.
- Raw observations from the audit probes are kept in
  `docs/pdf-audit/.baseline/probe-observations.log` (line references below).

---

## Ranked findings

| Rank | ID | Area | Symptom | Root cause | Severity | Fix size | Risk | Status | Repro |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `PDF-ENGINE-001` | ENGINE | Every page-copy/rebuild tool returns a PDF with no `/AcroForm`. Widget annotations remain on the page as unregistered orphans, so `inspect` reports 0 fields and no viewer can fill the form. Affects Organize, Delete Pages, Extract, every Split, Rotate/Crop, Merge, Combine, N-up, Stamp, Watermark, and the compose step of Flip/Resize. Silent. | `packages/pdf-core/src/ops/compose.ts:71` (`PDFDocument.create()`), `:95` (`copyPages`), `:133` (`addPage`) never carry the catalog-level form. Same shape: `ops/merge.ts:31,45`, `ops/combine.ts:71,96`, `ops/nup.ts:87`, `ops/split.ts:52-53`. | HIGH | L | HIGH | Open — repro committed | `packages/pdf-core/test/pdf-audit/page-pipelines.test.ts` |
| 2 | `PDF-ENGINE-003` | ENGINE | Flip and Resize silently delete every page annotation and form widget: highlights, comments, links, stamps, signatures and form fields disappear. Page content itself is preserved. | `packages/pdf-core/src/ops/transform.ts:85-106` (`addPage` + `embedPage` + `removePage`) and `:152-176`. `embedPage` copies content streams only; `/Annots` is a page-dictionary entry, not content, so it is never re-attached. | HIGH | L | HIGH | Open — needs decision | `packages/pdf-core/test/pdf-audit/transform-annotations.test.ts` |
| 3 | `PDF-ENGINE-002` | ENGINE | `/Title`, `/Author`, `/Subject` and `/Keywords` disappear from the output of the compose/merge/combine family. `/CreationDate` and `/ModDate` survive. | `packages/pdf-core/src/ops/compose.ts:71-72`, `ops/merge.ts:34`, `ops/combine.ts:138`; `ops/dates.ts:91-99` deliberately sets/removes only the two date keys. | MEDIUM | S–M | LOW | Open — needs decision | `packages/pdf-core/test/pdf-audit/page-pipelines.test.ts` |
| 4 | `PDF-ENGINE-004` | EXPORT | `pdf-to-text` on a page with no extractable text reports `charCount: 1` while the emitted `.txt` body is empty. Cosmetic; the downloaded file is correct. | `packages/pdf-core/src/jobs/text.job.ts:94` adds `line.length + 1` for every page, including an empty joined line. | LOW | S | LOW | Open — repro committed | `packages/pdf-core/test/pdf-audit/text-extraction.test.ts` |

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

---

## Counts

By area:

| Area | Findings |
| --- | --- |
| ENGINE | 3 |
| EXPORT | 1 |
| RENDER | 0 |
| EDITOR | 0 |
| SHARE | 0 (not implemented — see `ARCHITECTURE-PDF.md` §5) |
| SEC-UPLOAD | 0 (boundary reviewed, no defect found) |

By severity:

| Severity | Findings |
| --- | --- |
| HIGH | 2 (`ENGINE-001`, `ENGINE-003`) |
| MEDIUM | 1 (`ENGINE-002`) |
| LOW | 1 (`ENGINE-004`) |

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
   stay live, become static, or be dropped with a warning.
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

Repro commit: `TODO-AFTER-COMMIT` (docs, fixtures and known-failing tests only;
no source change).
