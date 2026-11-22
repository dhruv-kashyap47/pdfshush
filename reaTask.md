# reaTask.md — ihatepdf parity + engine uplift (v2)

> **Status:** active · **Created:** 2026-11-17 · **Rewritten:** 2026-11-17 after deep reads of both codebases
> **Sources:** `rea ihpdf/` (reference clone + its research), `packages/pdf-core`, `apps/web`
> **Owner:** pdfshush · **Task count:** 63 · **Gates:** A–D

**North star:** make pdfshush's editor and engine the best in the world — real in-place text fidelity, the fastest local edit loop, honest receipts, and zero document bytes leaving the browser.

**Permission:** the project owner has authorised copying from `rea ihpdf`. Copy with confidence, but record provenance (§2.4). The reference is a behavioural source, not an architecture to inherit: its shell is a 1,815-line component with dead model fields and at least two silent data-loss paths.

**What v2 changes:** the first version treated the reference as a port target. It is not. `removal.ts` drops glyph advances, the native paragraph path ignores overlay style, OCR rebuilds the document, and several "not started" tasks are already 50–85% built. See §2.5 and §11.

---

## 0. How to use this file

### Status legend

| Mark | Meaning |
| --- | --- |
| `[ ]` | not started |
| `[~]` | partial; the card names what exists |
| `[x]` | done, acceptance criteria met with test evidence |
| `[!]` | blocked; write the blocker on the card |
| `[–]` | declined; write the reason on the card |

### Task card fields

- **Pri:** P0 = blocks the phase, P1 = next release, P2 = polish.
- **Size:** S ≤ 1 day, M = 2–4 days, L = 5–10 days, XL = > 10 days.
- **Now:** measured current state from the deep read (percentage + what exists).
- **Source:** reference behaviour, or "invented" when the target only advertises it.
- **Anchor:** exact files/functions to touch.
- **Done when:** observable acceptance, not code written.
- **Tests:** the minimum evidence.

### Common definition of done

1. `pnpm -r typecheck` green.
2. `pnpm test` green, including new unit tests.
3. The relevant browser E2E green; download reopened and checked.
4. Export round-trip: page count/size preserved, untouched-page text unchanged, expected text present/absent.
5. No new origin; `pnpm test:bundle` still shows 0 engines in the main chunk.
6. Keyboard path + accessible name for everything clickable.
7. Any fidelity drop appears in the receipt with a stable code.
8. `PLAN.md` and this file's changelog updated in the same PR.

### Update protocol

- Update status only from test evidence.
- At the end of a session: status board, one changelog row, next task at the top.
- Record copied files in §2.4 the moment they land.

---

## 1. Non-negotiables

1. **No silent fidelity loss.** Substitution, rasterisation and covering all get stable receipt codes.
2. **No half-rewritten stream.** Any parse anomaly falls back with a warning; never emit a partial stream.
3. **No new document egress.** No fetch/XHR with document bytes; no filename or text in logs.
4. **Main bundle stays engine-free.** No pdf-lib/pdf.js/PDFium/Tesseract via UI imports.
5. **Server tier stays parked.**
6. **Memory is bounded.** Canvases, workers, object URLs, ink points, drafts all have caps and teardown.
7. **Redaction claims are earned.** Only the redaction pipeline may say "redacted".
8. **Accessibility is part of done.**
9. **No destructive migration.** Drafts/receipts keep loading across schema versions.
10. **Copy with provenance.** Three categories, not one (§2.4).
11. **Engine switches are explicit.** A job-level strategy option must reject unknown values, not silently demote.
12. **No new font dependency without a decision.** `@cantoo/fontkit` is absent; document-font re-embedding is a separate project.
13. **Redaction marks are typed.** No new rect-like object may enter the redaction set by shape alone.

---

## 2. Baseline, provenance, and what is real

### 2.1 What we have (verified in this deep read)

**Engine (`packages/pdf-core`)**
- PDFium native text editing: whole-run replacement and deletion, multi-line paragraph reflow with document metrics, atomic create/remove, layout collision checks (`textedit/engine.ts`, `textedit/pdfium.ts`).
- Strategy ladder: native → verification demotion → content-stream fallback → overlay; fail-closed final artifact gate (`engine.ts:859+`).
- Content-stream fallback is narrower than v1 implied: tracks only `Tf`, **simple fonts only**, exactly one matching show operator, single-string `TJ` only, no deletion, no metrics, no text matrix; `BI` throws `UnsupportedStream` (`textedit/contentStream.ts:74–277, 392–569`).
- Charcode maps: ToUnicode, `/Encoding` + `/Differences`, base encodings; Type0 deliberately has no encoding map (`textedit/charcodes.ts`).
- Verification: page count, sizes, annotation count, font resources, text present/absent, pixel diff outside edited regions (`textedit/exportVerify.ts:176+`, `verify.ts:70+`).
- Object export: text/image/whiteout/highlight/strikeout/underline/rect/ellipse/line/arrow; strict validation; WinAnsi-only text (`ops/edit.ts:124–129, 233–381, 546–612`).
- OCR: full pipeline + worker pool + same-origin data + verification, but it **rebuilds** the document (`ocr/ocr.ts:57–120`, `jobs/ocr.job.ts`).
- Redaction: raster-first rebuild + independent verifier (`redact/`).
- Fontkit is now installed (`@cantoo/fontkit` 2.0.12, F-01). The engine extracts embedded programmes from page resources and re-embeds them in the overlay path; the editor still needs to pass the paragraph's `fontKey` (T-06).

**Editor (`apps/web`)**
- One shared workspace for edit/sign/redact/organize, lazy chunk (`components/tools/edit-pdf-tool.tsx`).
- Snapshot undo/redo with 250-step cap (`lib/editor-state.ts`), object + paragraph editing, selection model, form widgets.
- Text UX: native textarea paragraph editor; commit builds per-line whiteouts + a text object + a native plan (`lib/text-editing.ts:384–476`).
- **Native export ignores overlay x/y/width/fontSize/bold/italic/colour/align.** `applyLayoutEdit` uses the source paragraph's geometry, font, size and fill colour (`textedit/engine.ts:386–607`). Moving/styling the overlay affects preview and fallback only.
- Chrome: tool rail, context bar, inspector, page rail (duplicate/delete/reorder; **no rotate**), status bar with progress + cancel.
- No find/replace, no drafts/recovery, no ink/check/cross/date/stamp, no snapping, no object clipboard.
- Signature trim exists but **capture stores full canvas dimensions**, so placement stretches to the pad aspect (`signature-pad-dialog.tsx:394–434`); no upload tab.
- Zoom: fit width, keys, 25–200%, non-editable readout (`edit-pdf-tool.tsx:223–226, 962–990`).
- Redaction marks are **every `rect` object** (`edit-pdf-tool.tsx:1792–1799`), and "clear all" deletes every rect (`:3333–3338`).
- Receipts appear only when `totalEdits > 0 || warnings.length > 0`; object-only exports get none (`edit-pdf-tool.tsx:2753–2760`).
- Progress/cancel already terminates and respawns the worker (`job-pool.ts:116–131`).
- Metadata: `updateMetadata:false` throughout, so Info likely survives edit/text-edit; untested. Compose preserves only title/author/subject/keywords.

### 2.2 What the reference contributes

| Contribution | Verdict |
| --- | --- |
| Per-glyph removal architecture + text-state machine | valuable, **incomplete** (no advance compensation) |
| Font metrics resolver + base-14 AFM tables | valuable; the AFM generator is the reusable part |
| `Tz` fit + word-by-word drawing | valuable; the target's 40–250% window and per-word fit are better references |
| Paragraph overlay UX details | valuable as behaviour, not code |
| Pen/check/cross/date/stamp/find/OCR/session utilities | useful small ports |
| Editor shell | behavioural reference only; do not inherit |
| Export cancel/validation | **worse than ours**; do not port |

### 2.3 What we already do better

Continuous scroll + lazy rasters, PDFium native rewriting, verification gates, forms/bookmarks, redaction verifier, worker pool with real cancel, keyboard/a11y baseline, offline/PWA, no analytics, no CDN.

### 2.4 Provenance ledger

Three categories must stay separate:

| Category | Meaning | Example |
| --- | --- | --- |
| **(a) studied, not copied** | target bundles read for behaviour | `rea ihpdf/research/ihatepdf/assets/images.pretty.js` |
| **(b) copied** | code moved into pdfshush | `rea ihpdf/src/engine/export/removal.ts` → `packages/pdf-core/src/textedit/removal.ts` |
| **(c) generated data** | tables derived from specs/tools | AFM widths from pdf-lib StandardFonts |

| Date | Category | Source | Destination | Changes | Covering test |
| --- | --- | --- | --- | --- | --- |
| 2026-11-17 | — | planning only | — | — | — |

Add `licenses/rea-ihpdf-NOTICE.md` with the owner's authorisation. Copied files carry: `Derived from rea ihpdf/<path> (owner-authorised); modified for pdfshush.`

### 2.5 Corrections to the v1 plan

| v1 claim | Reality | Fix |
| --- | --- | --- |
| `removal.ts` is a per-glyph engine to copy | It drops removed advances; trailing glyphs shift | C-04 is new algorithm work |
| C-04 can port `"` handling | `"` drops `Tw`/`Tc` when all glyphs are removed | explicit transitions task |
| C-02 is a port | no ToUnicode/Differences/CID/CMap/Type3 policy | new metrics work |
| C-01 can use the clone lexer | flat tokens, `indexOf('ID')` heuristic | use target arg-stack parser |
| C-09 synthetic bold/italic needed | no fontkit today; after F-01 a document font may lack a bold/italic face | **deferred into T-06/F-01**, not declined |
| T-01 = delete overlay objects | native rewrite already destroyed the original | reverse edit |
| T-02/T-06/T-07 are UI work | native path ignores overlay style/position | engine work |
| O-02 = reuse `ocr` job | `ocrDocument` rebuilds the document | new text-layer job |
| O-03 provenance is easy | model has no colour/source; render mode only in PDFium | decide page-level |
| X-04 is implementation | metadata mostly preserved, untested | test + doc + doc-level objects |
| X-06 is not started | progress/cancel/worker termination done | add assertion, close |
| E-05/E-06/E-08 are not started | 50–60% built | narrow scopes |
| S-05 is not started | 70% central taxonomy | add 3 codes |
| G-02..G-05 are not started | partial fixtures/strategy/gates exist | extend, don't rebuild |
| Unit baseline 1,528 | `PLAN.md` snapshot, not re-verified in this read | re-run before quoting |
| Editor page rail rotates | no rotate exposed | correct §2.1 |
| Object-only export gets a receipt | it does not | X-02 |
| Redaction safety | every `rect` is a redaction mark | E-00 |

---

## 3. Decision record (locked 2026-11-17)

| # | Decision | Answer | Affects |
| --- | --- | --- | --- |
| D1 | Removed-glyph advance compensation | **`TJ` kerns + `Tj → TJ` conversion** | C-03/C-04 |
| D2 | Job-level engine strategy | validated `strategy`; unknown = error; echo in report | G-04/C-12 |
| D3 | OCR integration shape | **text-layer-only job**; keep `ocr` for the standalone tool | O-02/O-03 |
| D4 | OCR provenance granularity | **page-level** from the capability snapshot | O-04 |
| D5 | Font strategy | **add `@cantoo/fontkit` now**; embed document fonts; licence notice + bundle gate | F-01/T-06/C-08/C-09 |
| D6 | Redaction mark discriminator | **explicit `role` field** (`decoration\|redaction\|content`) | E-00/E-04 |
| D7 | Revert semantics | `ParagraphEditRecord` + reverse `TextEdit`, not object deletion | T-01 |
| D8 | Dirty-edit coverage | every dirty edit has geometry, or warns/refuses | C-13 |
| D9 | Native paragraph formatting | **real** size/colour/bold/italic/align; warn when "Original" cannot be honoured | T-06/F-01 |
| D10 | Copy policy | **hybrid**: pure algorithms verbatim with provenance headers; integration rewritten in pdfshush style | G-01/all |
| D11 | Build order | **foundation → parity → UX → engine → OCR/trust → hardening** | §7 |
| D12 | `Tz` fit window | **40–250%**, target parity, with a readability warning outside 70–140% | C-08 |
| D13 | Draft autosave | **on by default**, 60 MB cap, visible notice, Restore/Discard | S-03/S-04 |
| D14 | Snapping | **build it**; label "invented" in the parity report | E-07/H-08 |
| D15 | Preservation scope | **metadata + `/AcroForm`, outlines, page labels** | X-04 |
| D16 | Cross-browser/mobile timing | **after parity + engine**, closed at Gate D | H-05/H-06 |
| D17 | Missing-glyph policy | **rasterise the word + warn** | C-09 |

---

## 4. Status board

### 4.1 Phase summary

| Phase | Theme | Tasks | Done | Partial | Status |
| --- | --- | --- | --- | --- | --- |
| 0 | Safety rails, corpus, provenance, fonts | G-01..G-05, F-01 | 2 | 4 | `[~]` |
| 1 | Editor capability parity | E-00..E-10 | 9 | 1 | `[~]` |
| 2 | Text editing UX | T-01..T-07 | 7 | 0 | `[x]` |
| 3 | Search, recovery, data-loss guards | S-01..S-06 | 5 | 1 | `[~]` |
| 4 | Content-stream surgery | C-01..C-14 | 14 | 0 | `[x]` |
| 5 | OCR inside the editor | O-01..O-05 | 5 | 0 | `[x]` |
| 6 | Export trust and metadata | X-01..X-06 | 6 | 0 | `[x]` |
| 7 | Hardening and parity sweep | H-01..H-08 | 8 | 0 | `[x]` |

**Queue:** all seven sprints complete; Gate D met for the documented scope. Remaining partials are G-02/G-05/F-01/E-10/S-06, named in `docs/PARITY-REPORT.md`.
**Hard block:** Phase 4 default-on requires G-02, G-03, C-12, C-13 and D1. **Gate C is met** (2026-11-21): C-01..C-04, C-06, C-07, C-12..C-14 green on the corpus.

### 4.2 Full board

| ID | Task | Pri | Size | Now | Status |
| --- | --- | --- | --- | --- | --- |
| G-01 | Provenance + NOTICE + copy header | P0 | S | done | `[x]` |
| G-02 | Corpus v2 (partial-word, Type3, CFF, XObject, clip) | P0 | M | ~50% | `[~]` |
| G-03 | Golden export harness | P0 | M | done | `[x]` |
| G-04 | Validated job-level strategy | P0 | S | done | `[x]` |
| G-05 | Guardrail scripts | P0 | S | ~60% | `[~]` |
| F-01 | Fontkit adoption + document-font embedding | P0 | L | ~85% | `[~]` |
| E-00 | Object role discriminator + batch create | P0 | S | done | `[x]` |
| E-01 | Pen / ink tool | P1 | M | done | `[x]` |
| E-02 | Check / cross marks | P1 | S | done | `[x]` |
| E-03 | Date stamp | P1 | S | done | `[x]` |
| E-04 | Stamp presets | P1 | S | done | `[x]` |
| E-05 | Signature crop/aspect/upload | P1 | S | done | `[x]` |
| E-06 | Fit page + percent + 400% | P1 | S | done | `[x]` |
| E-07 | Snap guides + Alt bypass | P1 | M | done 2026-11-21 | `[x]` |
| E-08 | Object clipboard + clamp | P1 | S | done | `[x]` |
| E-09 | Insert pages from PDF | P2 | M | done 2026-11-21 | `[x]` |
| E-10 | Rail/inspector integration + capability truth | P0 | S | ~70% | `[~]` |
| T-01 | Revert paragraph via reverse edit | P1 | M | done | `[x]` |
| T-02 | Move paragraph with plan offsets | P1 | M | done | `[x]` |
| T-03 | Detection details drawer | P1 | M | done | `[x]` |
| T-04 | Outline detected text | P2 | S | done | `[x]` |
| T-05 | Inline editing legibility | P1 | L | done | `[x]` |
| T-06 | Formatting that reaches native | P1 | L | done 2026-11-21 (native matrix style + synthetic bold/italic) | `[x]` |
| T-07 | Rotate text block | P2 | M | done 2026-11-21 | `[x]` |
| S-01 | Find & replace engine | P1 | M | done | `[x]` |
| S-02 | Find & replace UI | P1 | S | done | `[x]` |
| S-03 | Draft autosave + `resetTo` | P1 | M | done | `[x]` |
| S-04 | Restore/discard banner | P1 | S | done | `[x]` |
| S-05 | Error taxonomy completion | P1 | S | done | `[x]` |
| S-06 | Data-loss path guards | P0 | S | ~80% | `[~]` |
| C-01 | Lexer + emitter v2 | P0 | M | done | `[x]` |
| C-02 | Glyph metrics + AFM + ToUnicode | P0 | M | done | `[x]` |
| C-03 | Per-glyph quad removal | P0 | M | done | `[x]` |
| C-04 | Advance compensation + transitions | P0 | M | done | `[x]` |
| C-05 | Partial-run deletion | P1 | S | done 2026-11-21 | `[x]` |
| C-06 | Stream isolation (`q…Q`) | P0 | S | done | `[x]` |
| C-07 | Leftover-cover policy | P1 | S | done 2026-11-21 | `[x]` |
| C-08 | `Tz` fit + word-by-word | P1 | M | done 2026-11-21 | `[x]` |
| C-09 | Raster-word fallback | P1 | L | done 2026-11-21 | `[x]` |
| C-10 | Rotated glyph text | P1 | S | done 2026-11-21 | `[x]` |
| C-11 | Ink colour model + sampling | P2 | M | done 2026-11-21 | `[x]` |
| C-12 | Post-write verification completion | P0 | M | done | `[x]` |
| C-13 | Edit coverage invariant | P0 | S | done | `[x]` |
| C-14 | XObject/Type3/inline-image honesty | P0 | S | done | `[x]` |
| O-01 | Scan affordance | P1 | S | done 2026-11-22 (editor banner, both scopes) | `[x]` |
| O-02 | Text-layer-only OCR job | P0 | M | done 2026-11-22 | `[x]` |
| O-03 | OCR layout + confidence return | P1 | M | done 2026-11-22 | `[x]` |
| O-04 | Editor provenance + banner | P1 | S | done 2026-11-22 | `[x]` |
| O-05 | OCR cache/teardown/privacy | P1 | S | done 2026-11-22 | `[x]` |
| X-01 | Warning code registry | P1 | M | done 2026-11-22 | `[x]` |
| X-02 | Receipt stats + object-only receipt | P1 | M | done 2026-11-22 | `[x]` |
| X-03 | Untouched-page fingerprints | P1 | M | done 2026-11-22 (override path included) | `[x]` |
| X-04 | Metadata + document-level preservation | P1 | M | done 2026-11-22 | `[x]` |
| X-05 | Download guard | P1 | S | done 2026-11-22 | `[x]` |
| X-06 | Progress/cancel assertion | P2 | S | done | `[x]` |
| H-01 | Keyboard parity + unified registry | P2 | M | done 2026-11-22 | `[x]` |
| H-02 | Accessibility for new controls | P1 | M | done 2026-11-22 | `[x]` |
| H-03 | Editor performance ceilings | P2 | M | done 2026-11-22 | `[x]` |
| H-04 | Fuzz lexer/emitter | P0 | M | done 2026-11-22 | `[x]` |
| H-05 | Firefox + Safari | P2 | M | done 2026-11-22 (WebKit build records OffscreenCanvas gap) | `[x]` |
| H-06 | Touch/mobile for new tools | P2 | M | done 2026-11-22 | `[x]` |
| H-07 | Help copy + discoverability | P2 | S | done 2026-11-22 | `[x]` |
| H-08 | Parity report | P1 | S | done 2026-11-22 | `[x]` |

---

## 5. Phases and task cards

## Phase 0 — Safety rails, corpus, provenance

### G-01 — Provenance, notice, copy header
- **Pri:** P0 · **Size:** S · **Now:** done 2026-11-17
- **Why:** the reference has no licence file; the owner authorised copying, so the audit trail is ours to keep.
- **Scope:** `licenses/rea-ihpdf-NOTICE.md`; three-category ledger (§2.4); header convention; `pnpm test:provenance` + CI step. **D10 copy policy:** pure algorithms may be copied verbatim with headers; anything touching our engine or UI is rewritten in pdfshush style.
- **Anchor:** `licenses/rea-ihpdf-NOTICE.md`; `scripts/check-provenance.mjs`; `.github/workflows/ci.yml`.
- **Done when:** every copied file appears in the ledger and carries the header; the check fails if it is removed.
- **Tests:** positive run + planted negative control (verified 2026-11-17).

### G-02 — Corpus v2
- **Pri:** P0 · **Size:** M · **Now:** ~50% — `test/corpus/textSurgery.ts` builds partial-word, kerned-TJ, rotated, Form-XObject and unclosed-clip fixtures with a named failure each; `textCorpus.test.ts` proves they load and extract. Type3/CFF/inline-image/non-Identity CMap still missing.
- **Why:** C-03/C-04 will shift glyphs silently without fixtures that catch it.
- **Scope (add only what is missing):**
  - partial-word removal with kerning before/after the removed run;
  - `Tj`, `TJ` with numbers, `'`, `"`, `T*` transitions;
  - simple with `/Widths`; base-14 without; Type0 `/W`+`/DW` Identity; non-Identity CMap; Type3 `FontMatrix`;
  - embedded subset, CFF/OTF, non-embedded custom;
  - 90/180/270 glyph rotation; ligatures; RTL; whitespace-only runs;
  - inline images; unclosed clip; text inside Form XObject; nested arrays/dicts; malformed/truncated;
  - untouched-page text fingerprint; duplicate page; inserted page.
- **Anchor:** `packages/pdf-core/test/fixtures/`, `test/pdf-audit/fixtures/`, a manifest with purpose + hash.
- **Done when:** each fixture states the failure it guards; hashes are platform-stable (no timestamps, vendored fonts).
- **Tests:** generator runs in CI; corpus loads.

### G-03 — Golden export harness
- **Pri:** P0 · **Size:** M · **Now:** done 2026-11-21 — `test/golden.ts` now checks page count/size/**rotation**, contains/absent, untouched-page text **and a text fingerprint**, and reopens with pdf-lib + pdf.js. `pnpm test:corpus` runs the harness in one command and prints pass/fail plus the per-page diff. Pixel comparison remains in `verifyExportArtifact`, which the corpus/export gates invoke.
- **Scope:** input + edit plan → export → assert page count/size/rotation, untouched-page text hash, removed spans absent, expected text present, pixel diff, independent-reader open. Replace the self-attested `validation.opens: true` pattern with a real re-open.
- **Anchor:** `test/golden.ts`, `test/goldenCorpus.test.ts`, `scripts/corpus.mjs`; pixel diff in `textedit/exportVerify.ts`.
- **Done when:** one command prints pass/fail + diffs; a deliberately wrong edit fails.
- **Tests:** harness self-test plus the corpus positive/negative controls.

### G-04 — Validated job-level strategy
- **Pri:** P0 · **Size:** S · **Now:** done 2026-11-17 — `TextEngineStrategy = 'auto' | 'native-only'`; job validates and echoes it; engine rejects unknown values; `native-only` refuses every non-native outcome (tests).
- **Scope:** `TextEditJobOptions.strategy`; validation error on unknown; echo the strategy in the report; keep the current path default until Gate C.
- **Anchor:** `jobs/textEdit.job.ts:20–31`, `textedit/engine.ts:653`, `types.ts`.
- **Done when:** both strategies run the same fixture; the report names the one used.
- **Tests:** unknown strategy rejected; old path still selectable.

### G-05 — Guardrail scripts
- **Pri:** P0 · **Size:** S · **Now:** ~60% — `bundle-boundary.mjs`, `offline.mjs`, CSP tests exist.
- **Scope:** extend to drafts/new tools; assert no document text/filename in logs; negative tests. Note the reference's CDN OCR fetch as the anti-pattern this gate catches.
- **Anchor:** `tests/bundle-boundary.mjs`, `tests/e2e/offline.mjs`, `lib/csp.ts`.
- **Done when:** a deliberately planted violation fails each check.
- **Tests:** negative CI run.

### F-01 — Fontkit adoption + document-font embedding
- **Pri:** P0 · **Size:** L · **Now:** ~85% — `@cantoo/fontkit` 2.0.12 installed; `ops/fontPrograms.ts` extracts embedded programmes and re-embeds subset→full; `EditTextObject.fontKey` skips the WinAnsi refusal; the editor now attaches the matched PDFium BaseFont on paragraph commit; tests cover Greek through `applyEdits` and `text-edit`. Remaining: receipt names the strategy (X-02).
- **Decision:** D5. The owner chose to add `@cantoo/fontkit` now, so "Original" font and fewer substitutions are in scope.
- **Scope:**
  - Add `@cantoo/fontkit` to `packages/pdf-core`; register it where pdf-lib documents are created/loaded for editing (`ops/edit.ts`, `textedit`).
  - Extract the document font programme (PDFium `FPDFFont_*` data path or pdf-lib descriptor) and embed it for overlay and native draw paths, subset first then full.
  - Fallback chain: embedded document font → standard-14 → warned raster (C-09).
  - Subsetting/full-embed failure surfaces a stable warning code; never silently substitute.
  - **Licensing:** UI/receipt notices that embedding a document's font is the user's responsibility.
  - **Bundle gate:** fontkit must stay in the worker/engine chunks; main chunk unchanged; measure added asset size.
- **Anchor:** `packages/pdf-core/package.json`; `textedit/fonts.ts`; `ops/edit.ts:775–819`; `apps/web/src/workers/job-worker.ts`; `tests/bundle-boundary.mjs`.
- **Done when:** a fixture using a non-standard embedded font exports with that font (or a warned fallback); CFF/OTF path tested; main chunk has zero fontkit; receipt names the font strategy.
- **Tests:** unit TTF/OTF/CFF embedding + subset/full failures; corpus fixture; bundle negative test.

---

## Phase 1 — Editor capability parity

### E-00 — Object role discriminator + batch create
- **Pri:** P0 · **Size:** S · **Now:** done 2026-11-17 — explicit `role: content|decoration|redaction`; redaction set filters on the role; AI proposals and the redact tool tag marks; `createObjects` is one undo step and is used by AI batch additions; tests cover role validation.
- **Why:** redaction treats every `rect` as a mark and "clear all" deletes all rects (`edit-pdf-tool.tsx:1792–1799, 3333–3338`). Stamps/check boxes would become destructive redaction marks.
- **Scope:** explicit `role: 'decoration'|'redaction'|'content'` (or a typed mark discriminator); migrate existing rects to `content`; `redactMarks` filters on the role; add `onCreateMany` so a multi-part object is one undo step.
- **Anchor:** `ops/edit.ts:124–129, 233–381`, `editor-tools.ts:65–74`, `edit-pdf-tool.tsx:1792–1799`, `editor-state.ts:48–80`.
- **Done when:** a stamp/check rect never appears in the redaction set; a batch create is one undo step; old documents load with `content`.
- **Tests:** unit role mapping + redaction set; E2E redaction clear-all with a stamp present.

### E-01 — Pen / ink tool
- **Pri:** P1 · **Size:** M · **Now:** 0%; `DEFAULT_COLORS.ink` exists but unused.
- **Source:** `PageSurface.tsx:100–142`, `exporter.ts:445–457`.
- **Scope:** `ink` object with points; sample at 0.6 pt; cap/simplify; local state while drawing, one `apply` on release; render polyline; export vector segments with round caps/joins; inspector colour/width/opacity/duplicate/delete.
- **Anchor:** `ops/edit.ts` union + validation + `drawObject`; `editor-page.tsx:151–226, 961–1102`; `editor-tools.ts`; `editor-inspector.tsx:45–69`; `editor-chrome.tsx ToolContext`; `KEY_TOOLS` in `edit-pdf-tool.tsx:190`.
- **Done when:** stroke survives as vectors, no raster image, one undo step, point count bounded.
- **Tests:** unit simplification/bounds/cap; E2E draw/export/reopen.

### E-02 — Check / cross marks
- **Pri:** P1 · **Size:** S · **Now:** 0%
- **Scope:** one object kind (`check`/`cross` or `mark`+shape), two stroked lines, 34×34 default, colour/width, one undo step.
- **Anchor:** same as E-01; do **not** implement as two `line` objects.
- **Done when:** vector export, text extraction unchanged, role = content.
- **Tests:** unit draw; E2E place/export.

### E-03 — Date stamp
- **Pri:** P1 · **Size:** S · **Now:** 0%
- **Scope:** `Intl.DateTimeFormat` long date, text object, editable after placement, size/colour. **WinAnsi constraint:** pin locale or fall back to a WinAnsi-safe format with a warning.
- **Anchor:** `ops/dates.ts` is metadata-only; add `lib/stamp-date.ts`; `objectForTool`; inspector.
- **Done when:** locale output matches; export extracts the date; non-WinAnsi fallback warns.
- **Tests:** unit formatter (en-GB/en-US/ar-EG); E2E.

### E-04 — Stamp presets
- **Pri:** P1 · **Size:** S · **Now:** 0% (preset names/colours exist in `stamp-mark-tool.tsx:19–26`)
- **Source:** target presets are raster; our vector+text version is an improvement — record it in H-08.
- **Scope:** APPROVED/PAID/DRAFT/FINAL/CONFIDENTIAL/REJECTED/VOID; one object (box + bold label), editable text, vector export, role = content.
- **Anchor:** E-00/E-01 anchors; preset catalogue reuse.
- **Done when:** each preset is one click, one undo step, never a redaction mark.
- **Tests:** catalogue unit; E2E one preset + redaction isolation.

### E-05 — Signature crop, aspect, upload
- **Pri:** P1 · **Size:** S · **Now:** ~60%; trim exists, capture dims are wrong, no upload.
- **Source:** `App.tsx:1768–1811` (crop, no alpha ramp) — improve it.
- **Scope:** store trimmed bounds (or read PNG header); alpha ramp from luminance instead of a hard 242 threshold; add upload tab; keep aspect on placement; pure helper + tests.
- **Anchor:** `signature-pad-dialog.tsx:88, 394–434, 815–840`; `signature-assets.ts:95–128`; `signature-export.ts:231–298`; `edit-pdf-tool.tsx:2080–2089`.
- **Done when:** a 3:1 pad with a wide signature places without stretching; photo on white yields transparent ink.
- **Tests:** synthetic image pixel test; aspect unit; E2E sign/export.

### E-06 — Fit page, percent entry, 400%
- **Pri:** P1 · **Size:** S · **Now:** ~60%; fit width, keys, 25–200%, span readout.
- **Scope:** fit-page using width+height; editable numeric readout (commit on Enter/blur); raise to 400% with raster-cap awareness; update mobile HUD; fix the unused `onZoomChange` prop.
- **Anchor:** `edit-pdf-tool.tsx:223–226, 962–990, 3177–3186`; `editor-chrome.tsx:581, 736–742, 1548`.
- **Done when:** landscape page centres; typed percent works; 400% downsamples safely without loops.
- **Tests:** unit fit/clamp; E2E.

### E-07 — Snap guides + Alt bypass
- **Pri:** P1 · **Size:** M · **Now:** done 2026-11-21 — pure `lib/snap.ts`, guides, Alt bypass, sub-point movement.
- **Scope:** pure `snap.ts` (page edges/centres, other objects, threshold in px→pt), guides, Alt bypass, sub-point move for snapping (today `moveLive` rounds to integers), one undo step.
- **Anchor:** `edit-pdf-tool.tsx:1196–1214`; `editor-page.tsx:441–442`; new `lib/snap.ts`; CSS guides.
- **Done when:** guides appear only on snap; Alt disables; no drift.
- **Tests:** unit snap math + Alt; E2E drag near edge.

### E-08 — Object clipboard, duplicate, clamp
- **Pri:** P1 · **Size:** S · **Now:** ~60%; Ctrl+D +8,+8, arrows 1/10, text clipboard only.
- **Scope:** Ctrl+C/X/V for objects, +12,+12 paste, page clamp shared with signature placement, Cmd variants, no off-page exports.
- **Anchor:** `edit-pdf-tool.tsx:1630–1693, 2464–2498`; `ops/edit.ts:287–299`.
- **Done when:** copy/paste keeps style and lands on the page; keyboard-only loop works.
- **Tests:** unit offset/clamp; E2E.

### E-09 — Insert pages from another PDF
- **Pri:** P2 · **Size:** M · **Now:** done 2026-11-21 — multi-file insert, compose in rail order, object/paragraph page remap.
- **Scope:** compose `[current, extra]`, replace bytes, re-inspect, remap `pageIndex` on objects, `pageOrder`, `native.beforeLines`, `paragraphObjectIds`; progress.
- **Anchor:** `jobs/organize.job.ts`, `ops/compose.ts`, `edit-pdf-tool.tsx:400, 563–662, 877–954`.
- **Done when:** inserted pages appear; all edits survive; export order matches rail.
- **Tests:** unit remap; E2E insert + edit + export.

### E-10 — Rail/inspector integration + capability truth
- **Pri:** P0 · **Size:** S · **Now:** ~70% — dead `ToolCapability.export`, `saveStatus` and session `dirty` removed; tool registry is the single source for rail order/labels; new kinds still land with E-01..E-04.
- **Sequence:** before E-01..E-04.
- **Scope:** registry entries, context controls, inspector titles/icons (exhaustive records), status labels, `KEY_TOOLS`; either wire `ToolCapability.export` into `onSave` or delete it; fix `editor-tools.test.ts` expectations.
- **Anchor:** `editor-tools.ts:97–220`; `editor-inspector.tsx:45–69`; `editor-chrome.tsx ToolContext`; `edit-pdf-tool.tsx:190, 2123–2134`.
- **Done when:** every rail entry produces something; no dead capability; tests updated.
- **Tests:** unit registry + exact mode lists; E2E smoke every entry.

---

## Phase 2 — Text editing UX

### T-01 — Revert paragraph via reverse edit
- **Pri:** P1 · **Size:** M · **Now:** done 2026-11-18 — record in `EditorDoc`, one-step revert from inspector/details, reverse builder for rewritten sources.
- **Why:** a successful native rewrite has already removed the original glyphs; deleting whiteout+text restores nothing.
- **Scope:** `ParagraphEditRecord {paragraphId,pageIndex,before,after,plan,objectIds}` persisted in `EditorDoc` or a side map; Revert = one `apply` that removes objects **and** queues a reverse `TextEdit` (`find: after`, `replace: before`, reversed layout) on the next save; if the reverse fails, warn and keep the replacement.
- **Anchor:** `lib/text-editing.ts:384–476`; `edit-pdf-tool.tsx:1297–1357, 2178–2237`; `editor-state.ts`.
- **Done when:** edit → revert → export yields original text (or an explicit warning); one undo step.
  - **Correction (2026-11-18):** pdfshush always saves from the original source bytes, so a normal revert only removes the replacement and covers — there is no rewritten source to reverse. The record + `buildReverseParagraphEdit` are still implemented for the future in-place-source case, and the builder refuses multi-line guesses. E2E proves the exported original returns.
- **Tests:** unit record + reverse plan; E2E edit/revert/export bytes.

### T-02 — Move paragraph with plan offsets
- **Pri:** P1 · **Size:** M · **Now:** done 2026-11-18 — object + native origin move together; engine repositions rewritten objects; unit + E2E origin proofs.
- **Scope:** dx/dy patches the text object **and** `native.reflow.x/firstBaselineY` plus covers by the same delta; keep `beforeLines` at the original match anchor; clamp; surface engine refusal near page edges.
  - **Correction (2026-11-18):** covers deliberately stay at the original lines. Moving them with the replacement would uncover the glyphs they exist to hide. Only the replacement origin and its native reflow move; per-line indentation is preserved when the matrix is repositioned.
- **Anchor:** `text-editing.ts:426–432`; `textedit/engine.ts:398–410, 444–446, 458–460`; inspector.
- **Done when:** native export draws at the moved position; original removal policy documented; refusal surfaced.
- **Tests:** unit offset; E2E move + export + text position.

### T-03 — Detection details drawer
- **Pri:** P1 · **Size:** M · **Now:** done 2026-11-18 — per-paragraph drawer with every model fact, page capability, post-save outcome and copy.
- **Scope:** per-paragraph panel: bbox, line count, baseline, font family/label, size, rotation, bold/italic, confidence, role, page text layer, colour (when C-11 lands), source (page-level until D4), post-save strategy/outcome. Copy-to-clipboard.
- **Anchor:** `document/types.ts:194–215`; `capabilities.ts:103–158`; `textedit/types.ts:174–186`; `editor-inspector.tsx`; `export-receipt.tsx:39–48`.
- **Done when:** panel matches model exactly; post-save outcome maps back to the paragraph.
- **Tests:** unit formatter; E2E on a fixture.

### T-04 — Outline detected text
- **Pri:** P2 · **Size:** S · **Now:** 0%
- **Scope:** debug prop on `text-layer.tsx`; block/paragraph/line outlines; labels on hover; `pointer-events-none`; off by default; excluded from export.
- **Done when:** toggling never affects selection/export; works at 25–400%.
- **Tests:** E2E toggle + screenshot; overlay math.

### T-05 — Inline editing legibility
- **Pri:** P1 · **Size:** L · **Now:** done 2026-11-18 — transparent editor, opaque per-line covers, caret contrast, exporter width/leading; pixel-diff E2E at 100% plus 400% geometry checks.
- **Source:** target transparent text + caret + deleted-line mask; the clone has only transparent text.
- **Scope:** raster visible under the editor; per-line cover preview for lines that will be removed; caret contrast; live width/line-height using exporter metrics; no layout shift.
- **Anchor:** `text-layer.tsx:531–566, 645–691`; `editor-page.tsx:971`; `editor-shared.css`.
- **Done when:** typing looks like editing the page; stale glyphs never show; screenshot diff passes at 100% and 400%.
- **Tests:** visual E2E; unit mask geometry.

### T-06 — Formatting that reaches native
- **Pri:** P1 · **Size:** L · **Now:** done 2026-11-21 — native matrix style (size/colour/rotation/alignment) + synthetic bold/italic; family changes fall back with `font-substituted`. New standard-14 lines are created natively via `FPDFPageObj_NewTextObj`; embedded/custom faces and styled growth still fall back.
- **Scope:** D9 is **make it real**. Add size/colour/bold/italic/align to `TextLayoutEdit`; teach `applyLayoutEdit` font loading (F-01), synthetic bold/italic when the embedded face has none, colour, and alignment. "Original" uses the embedded document font; if it cannot be reproduced, warn with a code.
- **Anchor:** `textedit/types.ts:67–73`; `engine.ts:517–596`; `ops/edit.ts:614–650`; `editor-inspector.tsx:275–367`; `editor-chrome.tsx:973–1068`.
- **Done when:** the controls are true on the native path; justify works or is removed; substitution/synthetic is receipted.
- **Tests:** unit plan style mapping; E2E format + export + font/warning.

### T-07 — Rotate text block
- **Pri:** P2 · **Size:** M · **Now:** done 2026-11-21 — native matrix rotation + inspector numeric/15° snap/quick rotate.
- **Scope:** if native rotation is supported: add angle to plan types, matrix placement, collision checks; else keep refusal and add rotation only to overlay/fallback with a warning. UI numeric + 15° snap.
- **Anchor:** `ops/edit.ts:71–91`; `engine.ts:533`; `edit-pdf-tool.tsx:1425–1430`; `editor-inspector.tsx`.
- **Done when:** promoted behaviour is documented; extraction and verification pass.
- **Tests:** 90/180/270 fixtures.

---

## Phase 3 — Search, recovery, data-loss guards

### S-01 — Find & replace engine
- **Pri:** P1 · **Size:** M · **Now:** done 2026-11-18 — `document/search.ts`, offset-preserving folding, replacement + missing-page report; unit suite.
- **Scope:** pure module over `PageLayout`; case-insensitive with an explicit folding map or documented limit; matches over `paragraph.text` (body offsets), snippets; replace via `mutateParagraphText` to respect list markers; failed-layout retry (today a failed page is marked fetched forever); one undo step.
- **Anchor:** new `packages/pdf-core/src/document/search.ts`; `lib/text-editing.ts:487–530`; `edit-pdf-tool.tsx:760–766, 1359–1365`.
- **Done when:** replace-all on 3 pages updates only matches; pages that failed to load are retried or reported.
- **Tests:** unit overlaps/case/newlines/unicode; integration with export.

### S-02 — Find & replace UI
- **Pri:** P1 · **Size:** S · **Now:** done 2026-11-18 — Ctrl/Cmd+F panel, case/word, next/prev, jump list, replace-all; 40-page search 735–966 ms.
- **Scope:** Ctrl/Cmd+F after the typing guard; input/replace/count/next/prev/jump/replace-all; scroll to page; highlight via existing selection rects; live region; Escape ownership; search without capability inspection to avoid the 40-page cost.
- **Anchor:** `edit-pdf-tool.tsx:993–1007, 1986–1992, 2371–2531`; `text-layer.tsx:629–643`; `editor-chrome.tsx:1466–1471`.
- **Done when:** keyboard-only find/replace on 40 pages, no position loss.
- **Tests:** E2E keyboard + screenshot.

### S-03 — Draft autosave + `resetTo`
- **Pri:** P1 · **Size:** M · **Now:** done 2026-11-18 — IndexedDB v4 drafts, 1.2 s debounce, 60 MB cap, validated restore, fresh baseline.
- **Scope:** `DRAFTS_STORE`, DB v4 additive; `editor-state.resetTo(doc)` that establishes a new baseline (no empty doc on the undo stack); persist bytes, name/size/lastModified, `EditorDoc` (objects incl. image bytes + native plans), pageOrder, currentPage, zoom, mode/tool, saved baseline, `paragraphObjectIds`; debounce; 60 MB cap; QuotaExceeded visible; validate `TextEdit.layout` on restore; commit in-flight paragraph edits before save.
- **Anchor:** `lib/idb.ts:15–37`; `lib/editor-state.ts`; `lib/editor-session.ts`; new `lib/editor-draft.ts`; `edit-pdf-tool.tsx:2156–2174`.
- **Done when:** reload restores exact text; first undo does not erase it; re-editing a restored paragraph does not duplicate covers.
- **Tests:** unit serialise/migrate/validate; E2E reload.

### S-04 — Restore/discard banner
- **Pri:** P1 · **Size:** S · **Now:** done 2026-11-18 — idle banner with file/time/count, Restore/Discard, cleared on save; E2E across reloads.
- **Scope:** match by name+size+lastModified; Restore hydrates; Discard deletes; keyboard/a11y; banner in the idle stage; clear on successful export if chosen.
- **Anchor:** `edit-pdf-tool.tsx:3755–3767`; `editor-chrome.tsx`; reuse dialog pattern `:3592–3636`.
- **Done when:** both paths explicit; no stale draft after Discard.
- **Tests:** E2E reload → restore/discard.

### S-05 — Error taxonomy completion
- **Pri:** P1 · **Size:** S · **Now:** ~70%; 12 codes + copy + tests exist.
- **Scope:** add `empty`, `not-a-pdf`, `out-of-memory`; stop collapsing them into `damaged`/`too-large`; update copy/retry/tests.
- **Anchor:** `lib/job-errors.ts:23–260`.
- **Done when:** the error corpus shows intended messages.
- **Tests:** unit mapping; E2E empty/truncated.

### S-06 — Data-loss path guards
- **Pri:** P0 · **Size:** S · **Now:** ~80% — Change file, Start over, Back and in-app link clicks share one confirmation sheet with intent-specific copy; Change file keeps the editor mounted until the picker returns; `editor-cancel-save.mjs` proves each path keeps the document. Browser back/forward still relies on `beforeunload`, not a route blocker.
- **Why:** "Change file" and "Start over" bypass the dirty confirm and drop edits; route navigation has no guard; only Back confirms.
- **Scope:** route both through the confirm; SPA navigation guard; keep `beforeunload`; test with unsaved edits.
- **Anchor:** `edit-pdf-tool.tsx:2535–2549, 2864–2870, 2923–2924, 3638–3682`.
- **Done when:** no user path silently discards edits.
- **Tests:** E2E change-file/start-over/nav with unsaved edits.

---

## Phase 4 — Content-stream surgery

> **Gate C applies.** Do not default v2 until G-02, G-03, C-12, C-13 and D1 are green. Land C-01..C-04, C-06, C-12..C-14 as one coherent unit; C-08..C-11 can follow.

### C-01 — Lexer + emitter v2
- **Pri:** P0 · **Size:** M · **Now:** done 2026-11-21 — `stream/lexer.ts` round-trips every byte, parses arrays/dicts/inline images, and `parseOperations` groups operands; tests cover escapes, hex, comments, malformed tails and `BI`.
- **Scope:** use the target's arg-stack parser as the model; names `#xx`, literal/hex strings, arrays/dicts, inline images, comments, spans; **emit** untouched tokens byte-identically; new module.
- **Anchor:** `research/ihatepdf/assets/images.pretty.js:1300–1379`; `textedit/contentStream.ts:74–277`; new `textedit/stream/lexer.ts`.
- **Done when:** tokenise→emit round-trip is byte-identical on the corpus; `BI` handled, not thrown.
- **Tests:** adversarial snippet corpus; round-trip; H-04 later.

### C-02 — Glyph metrics, ToUnicode, AFM
- **Pri:** P0 · **Size:** M · **Now:** done 2026-11-21 — `stream/metrics.ts` reads Type0 `/W`+`/DW`, simple `/Widths`, Type3 `/FontMatrix`, base-14 AFM tables and `/ToUnicode`/`/Encoding`; non-Identity CMaps and missing width sources are `reliable:false` with a reason.
- **Scope:** Type0 `/W`+`/DW`; simple `/FirstChar`+`/Widths`; Type3 `/FontMatrix`; base-14 AFM tables; `/MissingWidth`; ToUnicode, `/Encoding`+`/Differences`, CID→GID; `byteLength` and `reliable` flags. Non-Identity Type0 must be `reliable:false` until proven.
- **Anchor:** `removal.ts:657–776`; `widths.generated.ts`; `textedit/charcodes.ts`.
- **Done when:** widths match PDF.js within tolerance; guessing is flagged.
- **Tests:** per-font tables; reliability negatives.

### C-03 — Per-glyph quad removal
- **Pri:** P0 · **Size:** M · **Now:** done 2026-11-21 — `stream/surgery.ts` tracks the text/graphics state, produces glyph quads and rewrites only the owning show operator; the corpus proves mid-`Tj` removal.
- **Scope:** text state `Tm/Tlm/CTM/Tf/Tz/Tc/Tw/TL/Ts/rise`; q/Q text-state save/restore; glyph advances; quads; rect expansion ~0.4 pt; AABB vs rotated-quad policy; kept bytes; removed count.
- **Anchor:** `removal.ts:228–443`; new `textedit/removal.ts`.
- **Done when:** only target glyphs disappear; no neighbour movement **after C-04**.
- **Tests:** partial-word fixtures; pixel diff.

### C-04 — Advance compensation + transitions (**critical**)
- **Pri:** P0 · **Size:** M · **Now:** done 2026-11-21 — removed advances become `TJ` kerns in the operator's own space, `Tj → TJ` splits safely, `'`/`"` re-emit their line move/spacing, and four-decimal formatting keeps small kerns. `partial-word`, `tj-kern` and a fully removed `'` run prove kept glyphs/next line do not move.
- **Scope:**
  - each removed advance becomes a `TJ` kern (`-(advance/1000)*size` style, in the right space);
  - convert `Tj` → `TJ` when a removal splits the string;
  - `'`/`"` re-emit line move + `Tw`/`Tc` even when all glyphs are removed;
  - empty `TJ` keeps the advance or emits a compensating number;
  - `formatNum` precision that does not round small kerns to zero.
- **Anchor:** target `images.pretty.js:1475–1486`; `removal.ts:379–443, 618–626`.
- **Done when:** removing a mid-word glyph leaves every kept glyph at its original x; pixel diff outside the removed box is 0.
- **Tests:** partial-word fixture with kerns before/after; each operator variant.

### C-05 — Partial-run deletion
- **Pri:** P1 · **Size:** S · **Now:** done 2026-11-21 — `singleRunDeletion` routes a one-line partial deletion through stream surgery; whole-object deletion stays native.
- **Scope:** use C-03/C-04 for partial deletion; keep native whole-object deletion; deletion never degrades to a cosmetic cover without a warning.
- **Anchor:** `engine.ts:721–741, 1028–1039`; `contentStream.ts:442–451`.
- **Done when:** deleting a word inside a run removes only it; extraction absence verified.
- **Tests:** fixture; E2E delete.

### C-06 — Stream isolation
- **Pri:** P0 · **Size:** S · **Now:** done 2026-11-21 — `ops/edit.ts` wraps source content in `q … Q`, handles pdf-lib flate content streams and resets the cached writable stream; the unclosed-clip fixture exports with appended draws outside the source scope.
- **Scope:** wrap original content in `q … Q` before appending draws; test an unclosed clip; preserve state.
- **Anchor:** `contentStream.ts:557–561`; `ops/edit.ts` draw path.
- **Done when:** appended text/objects render even when the source leaves a clip active.
- **Tests:** unclosed-clip fixture; pixel diff.

### C-07 — Leftover-cover policy
- **Pri:** P1 · **Size:** S · **Now:** done 2026-11-21 — explicit `coverPolicy:'leftover-cover'`, white-paint test from fill/image operators, receipt code.
- **Scope:** explicit `policy:'leftover-cover'` marker (or engine-generated patch); only when removal reports complete; smallest patch; receipt code; never redaction language; coloured-background limitation documented.
- **Anchor:** `textedit/engine.ts`; `ops/edit.ts`; `edit-receipt.ts`.
- **Done when:** patch invisible on white pages; absent on coloured backgrounds; receipt names the policy.
- **Tests:** pixel diff; receipt assertion.

### C-08 — `Tz` fit + word-by-word
- **Pri:** P1 · **Size:** M · **Now:** done 2026-11-21 — `fitTextToWidth`, `Tz`, word-by-word fallback.
- **Scope:** D12 = **40–250%**, per-line fit; warn outside 70–140% readability; `setCharacterSqueeze`; word-by-word when U+0020 is not encodable; measure with C-02 metrics; avoid double spaces in extraction.
- **Anchor:** `exporter.ts:268–353`; `ops/edit.ts drawText`.
- **Done when:** right edge preserved without unreadable squeeze; extraction clean.
- **Tests:** 39/40/250/251% boundaries; extraction.

### C-09 — Raster-word fallback
- **Pri:** P1 · **Size:** L · **Now:** done 2026-11-21 — `ops/textRaster.ts` + `rasterFallback`; receipt `glyph-rasterised`; verifier skips the text expectation.
- **Scope:** render the smallest run via a clipped page region **in the worker** from source bytes (do not ship rasters to the worker); embed PNG; bypass `assertEncodable` for that run; receipt `glyph-rasterised`; verifier must not expect that text. F-01 reduces how often this happens but does not remove it: document fonts can lack glyphs, and inserted text uses standard faces.
- **Anchor:** `ops/edit.ts:408–429, 614–650`; `render/renderPage.ts`; `exportVerify.ts`; `job-worker.ts:143` transfer depth.
- **Done when:** appearance preserved, warned, not claimed selectable.
- **Tests:** exotic-glyph fixture; receipt; pixel diff.

### C-10 — Rotated glyph text
- **Pri:** P1 · **Size:** S · **Now:** done 2026-11-21 — stream quads/removals and native matrix rotation; 180/270 fixtures.
- **Scope:** add `rotationDeg` to plan types; per-line placement via `projectPoint`; aligned collision boxes; or interim refusal with a warning until supported.
- **Anchor:** `textedit/types.ts:42–73`; `engine.ts:386–607, 533`; `document/geometry.ts:325`.
- **Done when:** 90/180/270 fixtures remove/replace correctly, or are refused explicitly.
- **Tests:** rotation fixtures; extraction.

### C-11 — Ink colour model + sampling
- **Pri:** P2 · **Size:** M · **Now:** done 2026-11-21 — `TextTypography.color`, bounded page sampling, editor uses the sampled value.
- **Scope:** add colour to `TextTypography`; populate from fill operators when possible, else subsampled raster sampling with paper/antialias rejection, per-block cache and a page budget; feed `EditTextObject.color`.
- **Anchor:** `document/types.ts:50`; `render/textRuns.ts`; `text-editing.ts:471`; `edit-pdf-tool.tsx:1602`; `renderPageToCanvas`.
- **Done when:** coloured text is detected without a first-paint stall; sampling budget measured.
- **Tests:** synthetic canvases; timing.

### C-12 — Post-write verification completion
- **Pri:** P0 · **Size:** M · **Now:** done 2026-11-21 — untouched-page text fingerprints and `/Rotate` comparison added; a stream rewrite is discarded with a warning when its own reopen check fails; stream outcomes carry a glyph box for the visual gate.
- **Scope:** untouched-page text fingerprints input vs output; rotation comparison; extend the pixel gate to stream-path edits missing `box`; on mismatch, discard the rewrite and fall back with a warning (currently refuses); keep fail-closed for redaction.
- **Anchor:** `textedit/exportVerify.ts:176–342`; `verify.ts:70+`; `engine.ts:991–1026, 1154+`.
- **Done when:** a sabotaged rewrite is caught, fallback succeeds with a warning, untouched pages match exactly.
- **Tests:** negative stream fixture; untouched-page hash.

### C-13 — Edit coverage invariant
- **Pri:** P0 · **Size:** S · **Now:** done 2026-11-21 — edit validation (page index, box, before-lines) plus an `edit-coverage` warning for text-only edits and an `assertOutcomeCoverage` refusal for any edit that produces no outcome.
- **Why:** export must never silently drop a dirty edit because its block/layout is missing.
- **Scope:** assert every dirty/native edit has required geometry and a matchable target; otherwise warn (`edit-unresolved`) or refuse; ensure all edited pages are hydrated before export, not just visited ones.
- **Anchor:** `ops/edit.ts` validation; `textedit/engine.ts:819+`; `edit-pdf-tool.tsx:2178–2237`; `ensureRuns` `:710–770`.
- **Done when:** edit page 1 → visit page 2 → export works; a missing block produces a warning, never silence.
- **Tests:** multi-page edit/export; deliberately missing layout.

### C-14 — XObject/Type3/inline-image honesty
- **Pri:** P0 · **Size:** S · **Now:** done 2026-11-21 — the scan detects Form-XObject text, Type3 fonts, malformed tokens and unresolved show fonts; outcomes say `stream-incomplete` and `complete:false`, and inline images are parsed rather than aborting the page.
- **Scope:** detect text inside Form XObjects; set `complete:false` + `stream-incomplete` code; no false success. Full recursion is a later task.
- **Anchor:** `contentStream.ts:272, 604–606`; `removal.ts:604–606`.
- **Done when:** a text-in-XObject fixture warns instead of claiming removal.
- **Tests:** fixture; receipt code.

---

## Phase 5 — OCR inside the editor

> **Blocking design:** `ocrDocument` rebuilds pages as rasters. Do not call it mid-session (D3).

### O-01 — Scan affordance
- **Pri:** P1 · **Size:** S · **Now:** ~50% engine; UI has only status text.
- **Scope:** per-page "This page is a scan — read it with OCR?" when `likelyScanned`; mark already-OCR'd pages; no automatic run.
- **Anchor:** `capabilities.ts:143`; `jobs/textRuns.job.ts:85–98`; `edit-pdf-tool.tsx:2882–2888`.
- **Done when:** detection is instant; no false positive on vector-only pages.
- **Tests:** unit classification; E2E scanned fixture.

### O-02 — Text-layer-only OCR job
- **Pri:** P0 · **Size:** M · **Now:** 0%
- **Scope:** new job that appends an invisible text layer to existing pages (pdf-lib `drawText` + invisible render mode), leaving original bytes/pages/objects intact; keep `ocr` for the standalone tool. Progress, cancel, page cap.
- **Anchor:** `jobs/ocr.job.ts`; `ocr/ocr.ts:143–183`; `ocr/draw.ts:17`; registry/slugs.
- **Done when:** OCR on page 3 does not invalidate page 1 objects or paragraph IDs.
- **Tests:** job unit; editor integration E2E.

### O-03 — OCR layout + confidence return
- **Pri:** P1 · **Size:** M · **Now:** 0% (job returns counts only)
- **Scope:** return per-page words/lines/paragraphs/confidence (or re-extract via text-runs and map); expose mean and per-block confidence; define the paragraph↔OCR mapping (D4).
- **Anchor:** `ocr/layout.ts:90–160`; `jobs/ocr.job.ts:28–41`; `textedit/types.ts`.
- **Done when:** the editor can mark OCR paragraphs with confidence without guessing.
- **Tests:** unit payload; E2E banner values.

### O-04 — Editor provenance + banner
- **Pri:** P1 · **Size:** S · **Now:** 0%
- **Scope:** confidence banner, page-level provenance, detection details, editable OCR paragraphs; "check the text" copy.
- **Anchor:** `document/types.ts`; `edit-pdf-tool.tsx`; `editor-chrome.tsx`; `structure-panel.tsx`.
- **Done when:** provenance is honest at page level; editing/export works.
- **Tests:** E2E OCR → edit → export.

### O-05 — Cache, teardown, privacy
- **Pri:** P1 · **Size:** S · **Now:** ~60% elsewhere; editor path untested.
- **Scope:** same-origin model data; terminate on close; revoke URLs; in-editor privacy copy; teardown test.
- **Anchor:** `workers/ocr-engine.ts`; `edit-pdf-tool.tsx resetAll`; `tests/e2e/ocr.mjs`.
- **Done when:** closing the document leaves no worker/blob; no off-origin request.
- **Tests:** teardown + network assertion.

---

## Phase 6 — Export trust and metadata

### X-01 — Warning code registry
- **Pri:** P1 · **Size:** M · **Now:** 0%; warnings are free-text strings across four report types; `edit.job` has none.
- **Scope:** `WarningCode` union + `{code, detail, message}`; activate `JobWarnings`; migrate text-edit/OCR/redaction (and add edit); dedupe by code+detail, cap 40; receipt keys by code+detail; keep a compatibility accessor if needed.
- **Anchor:** `job.ts:68`; `textEdit.job.ts:38–47`; `ocr.job.ts:40`; `redact/types.ts:74`; `engine.ts:1016–1078`; `edit-receipt.ts:142`; `export-receipt.tsx:105`.
- **Done when:** every warning path emits a code; tests updated; no string-only consumer remains.
- **Tests:** dedupe/cap; receipt snapshot; job type tests.

### X-02 — Receipt stats + object-only receipt
- **Pri:** P1 · **Size:** M · **Now:** ~35%; no stats, object-only exports get no receipt, "no verification" contradicts the footer.
- **Scope:** pages, chars removed, objects drawn, fonts embedded/substituted, glyphs rasterised, OCR pages, strategy, verification verdict; render a receipt for object-only exports; remove the contradiction.
- **Anchor:** `ops/edit.ts applyEdits` (return counts); `engine.ts`; `textEdit.job.ts`; `edit-receipt.ts`; `export-receipt.tsx`; `edit-pdf-tool.tsx:2753–2760`.
- **Done when:** stats come from the job result, not guesses; every export has a receipt.
- **Tests:** unit mapping; E2E text + object exports.

### X-03 — Untouched-page fingerprints
- **Pri:** P1 · **Size:** M · **Now:** ~15%; only edited regions are visually compared.
- **Scope:** build the untouched set from edits + objects (a markup page is not untouched); hash page text/metadata input vs output; block on mismatch with an explicit "download anyway" warning path.
- **Anchor:** `exportVerify.ts:26–52, 90–136`; `verify.ts:70–100`; `edit-pdf-tool.tsx` download gating.
- **Done when:** a broken untouched page is blocked; markup-only pages are not false positives.
- **Tests:** negative fixture; markup export.

### X-04 — Metadata + document-level preservation
- **Pri:** P1 · **Size:** M · **Now:** ~85% likely true for edit, untested; compose partial.
- **Scope:** test title/author/subject/keywords/creation date through edit and text-edit; widen `InspectOutput.metadata`; extend compose to preserve dates/creator/producer; document the Producer/Creator convention. D15 acceptance: **metadata + `/AcroForm`, outlines and page labels** survive edit/export. `/OCProperties` and tagged structure are out of scope this cycle.
- **Anchor:** `ops/pages.ts:47–65`; `ops/metadata.ts:61–71`; `ops/dates.ts:60–98`; `jobs/inspect.job.ts:10–21`; `ops/compose.ts`.
- **Done when:** round-trip tests prove it; doc-level objects survive.
- **Tests:** metadata assertions; forms/outline fixtures.

### X-05 — Download guard
- **Pri:** P1 · **Size:** S · **Now:** 0%
- **Scope:** disable Save when no changes, with explanation; guard `onSave`; keep redact/organize preconditions.
- **Anchor:** `editor-chrome.tsx:211–223`; `edit-pdf-tool.tsx:2115, 2790–2801`; `editor-dirty.ts:25–35`.
- **Done when:** no-change export is impossible via UI.
- **Tests:** unit + E2E.

### X-06 — Progress/cancel assertion
- **Pri:** P2 · **Size:** S · **Now:** done 2026-11-17 — `job-pool.stats()` (workers, busy, busySlugs, queued) behind an opt-in `__PDFSHUSH_TEST__` probe; `editor-cancel-save.mjs` proves the text-edit worker is gone, nothing is queued, edits survive and save is available again.
- **Scope:** only the test: cancel export → worker terminated/respawned, edits intact, state idle; optionally clearer step labels.
- **Anchor:** `job-pool.ts:116–131`; `editor-chrome.tsx:1480–1499`; `use-job-runner.ts`.
- **Done when:** the assertion exists; mark `[x]`.
- **Tests:** E2E cancel + worker count.

---

## Phase 7 — Hardening and parity sweep

### H-01 — Keyboard parity + unified registry
- **Pri:** P2 · **Size:** M · **Now:** ~60%; two registries diverge; find/clipboard/snap missing.
- **Scope:** one source of truth for shortcuts; add find, object clipboard, Alt snap; shortcuts dialog generated from the real map; E2E every shortcut.
- **Anchor:** `editor-tools.ts`; `edit-pdf-tool.tsx:190–198, 2371–2531`; `keyboard.mjs`.
- **Done when:** dialog cannot drift; suite covers all.
- **Tests:** E2E keyboard.

### H-02 — Accessibility for new controls
- **Pri:** P1 · **Size:** M · **Now:** ~70% baseline; new tools uncovered.
- **Scope:** enumerate new controls; live regions for find/OCR; roving tabindex in rail; guide/caret contrast; axe with paragraph editor, find panel, ink and mobile sheet open.
- **Anchor:** `a11y.mjs:150–190`; `editor-chrome.tsx`; `text-layer.tsx`.
- **Done when:** no new violations; keyboard-only full loop.
- **Tests:** axe + keyboard E2E.

### H-03 — Editor performance ceilings
- **Pri:** P2 · **Size:** M · **Now:** 0% for editor edits.
- **Scope:** 100-page text edit, 10k-point ink, content-stream throughput, page warm-up incl. capability inspection; publish ceilings in `tests/benchmarks`.
- **Anchor:** `m5-0-baseline.mjs`; `m5-4-ceilings.mjs`; `long-120page.pdf`.
- **Done when:** numbers in repo; CI regression margin.
- **Tests:** benchmark script.

### H-04 — Fuzz lexer/emitter
- **Pri:** P0 · **Size:** M · **Now:** 0%
- **Scope:** tokeniser + emitter + apply path; fixed seeds; asserts no crash/hang/invalid stream and fallback on failure.
- **Anchor:** `textedit/contentStream.ts`; new `textedit/stream/*`; test harness.
- **Done when:** seeded fuzz runs in CI.
- **Tests:** fuzz harness.

### H-05 — Firefox + Safari
- **Pri:** P2 · **Size:** M · **Now:** 0% for editor.
- **Scope:** pointer capture/touch-action, IndexedDB quotas, OffscreenCanvas in workers, Tesseract worker, canvas area, clipboard permissions.
- **Anchor:** E2E config; `edit-pdf-tool.tsx` touch paths.
- **Done when:** per-feature results recorded; unsupported combos gated.
- **Tests:** cross-browser suite.

### H-06 — Touch/mobile for pen, snap, find
- **Pri:** P2 · **Size:** M · **Now:** ~40% baseline; new tools absent; no responsive E2E.
- **Scope:** pointer capture, palm rejection heuristics, hit targets, bottom-sheet find, no scroll trap while drawing; responsive suite.
- **Anchor:** `edit-pdf-tool.tsx:1064–1109, 3135–3200`; `editor-page.tsx:607–615`; new E2E.
- **Done when:** phone checks green for new tools.
- **Tests:** responsive E2E.

### H-07 — Help copy + discoverability
- **Pri:** P2 · **Size:** S · **Now:** ~60%
- **Scope:** per-tool help, shortcut sheet, limitations for whiteout/substitution/stream fallback; fix the misleading Text-tool hint (paragraph editing requires Select).
- **Anchor:** `editor-chrome.tsx:812–971`; `lib/text-model-limits.ts`; tooltips.
- **Done when:** every new tool has a one-line explanation.
- **Tests:** copy review + snapshot.

### H-08 — Parity report
- **Pri:** P1 · **Size:** S · **Now:** 0%
- **Scope:** matrix of all 62 tasks vs `rea ihpdf/research/ihatepdf/feature-matrix.md`: reproduced, improved, invented, declined, remaining risk. Note that the target matrix is absent from this repo.
- **Done when:** linked from README; every `[x]` cites evidence.
- **Tests:** docs link check.

---

## 6. Declined / do not port

| Item | Why |
| --- | --- |
| Synthetic bold/italic | **Not declined, deferred**: F-01 makes document fonts embeddable, and some lack a bold/italic face. Implement inside T-06 when the embedded face has no matching style. |
| Reference editor shell | dead fields, silent edit loss, no cancel, single page |
| Reference export cancel/validation | worse than ours; self-attested `opens:true` |
| Microsoft Clarity / CDN assets | privacy and supply chain |
| Whiteout as redaction | text remains |
| Metadata clobbering | we preserve |
| `?` for missing glyphs | use warned raster fallback |
| Main-thread export | keep workers |
| Shape-based redaction marks | use explicit roles |
| Automatic OCR on load | user-initiated, local, disclosed |

---

## 7. Sprint order

| Sprint | Contents | Gate |
| --- | --- | --- |
| 1 — Foundation | G-01, G-02, G-04, F-01, E-00, E-10, S-06, X-06 assertion | A (start) |
| 2 — Quick parity | E-01, E-02, E-03, E-04, E-05, E-06, E-08, T-04, S-05 | A |
| 3 — Text UX + search | T-01, T-02, T-03, T-05, T-06 (UI half), S-01, S-02, S-03, S-04 | B |
| 4 — Engine core | C-01, C-02, C-03, C-04, C-06, C-12, C-13, C-14, G-03 | C |
| 5 — Fidelity | C-05, C-07, C-08, C-09, C-10, C-11, T-06 (engine half), T-07, E-07, E-09 | C |
| 6 — OCR + trust | O-01..O-05, X-01..X-05, H-04 | D |
| 7 — Hardening | H-01, H-02, H-03, H-05, H-06, H-07, H-08 | D |

---

## Sprint 1 close (2026-11-17)

| Task | Result | Evidence |
| --- | --- | --- |
| G-01 | `[x]` | NOTICE, header convention, `check-provenance.mjs`, CI step, negative control |
| G-02 | `[~]` | `textSurgery.ts` + `textCorpus.test.ts`: partial-word, TJ-kern, rotated, Form XObject, unclosed clip |
| G-03 | `[~]` | `golden.ts` + `golden.test.ts`: page count/size, contains/absent, untouched-page text, negative control |
| G-04 | `[x]` | `TextEngineStrategy`, job validation, report echo, `native-only` refusal tests |
| F-01 | `[~]` | fontkit 2.0.12, `fontPrograms.ts`, `fontKey` on paragraph commit, Greek round-trip tests |
| E-00 | `[x]` | typed roles, redaction filter, AI batch create, role validation tests |
| E-10 | `[~]` | dead `export`/save-state removed; new kinds still land with E-01..E-04 |
| S-06 | `[~]` | one confirmation sheet for Change file / Start over / Back / in-app links; E2E keeps the document |
| X-06 | `[x]` | opt-in pool stats; `editor-cancel-save.mjs` proves terminate, no queue, edits survive |

**Still open before Sprint 2:** G-02's Type3/CFF/inline-image/non-Identity fixtures; G-03's pixel table; F-01 receipt naming; S-06 browser back/forward route blocking; E-10's new object kinds. None blocks the foundation gate for the current feature set.

---

## Sprint 2 close (2026-11-17)

| Task | Result | Evidence |
| --- | --- | --- |
| E-01 | `[x]` | Engine `ink` object exports vector segments with round caps (single point = dot); 5,000-point cap; `lib/ink.ts` sampling (0.6 pt), RDP simplify, bounds and resize scaling; inspector colour/width/opacity; one undo step; unit + `editor-quick-parity` draw/undo/redo; exported PDF has stroke operators and no image XObject. |
| E-02 | `[x]` | One `check`/`cross` object drawn as two stroked segments, role `content`; unit vector export + E2E placement; redaction count stays 0 with stamps/checks present. |
| E-03 | `[x]` | `date` tool places a text object with a long date; locale pinned to en-GB; `lib/stamp-date.ts` detects non-WinAnsi output and falls back (warn-ready); unit en-GB/en-US/ar-EG; date survives export extraction. |
| E-04 | `[x]` | Seven-preset catalogue (`APPROVED/PAID/DRAFT/FINAL/CONFIDENTIAL/REJECTED/VOID`), one bordered stamp object with real text, editable label/colour/size, preset chips; unit catalogue, E2E preset + copy/paste + redaction isolation. |
| E-05 | `[x]` | Upload tab with luminance→alpha ramp; capture returns the **trimmed** ink dimensions (not the pad), shared `scaledSignatureSize`; unit ramp/aspect; `signature-upload` E2E proves 84% transparency and 5.56:1 placement from a wide upload. |
| E-06 | `[x]` | 25–400% window; typed percent input (Enter/blur, Escape restores); fit page (width+height) and fit width; mobile HUD fit-page; `lib/zoom.ts`; unit fit/parse; E2E 400% + fit. |
| E-08 | `[x]` | Ctrl/Cmd+C/X/V for objects, +12/+12 paste, duplicate offset and signature placement share `clampToPage`; unit clamp/offset; E2E copy/paste lands offset on the page. |
| T-04 | `[x]` | Debug outline layer for blocks/paragraphs/lines with hover labels, pointer-transparent, off by default; E2E toggles it at fit and 400%, absent when off. |
| S-05 | `[x]` | New `empty`, `not-a-pdf`, `out-of-memory` codes with distinct copy/retry; damaged and size caps no longer swallow them; unit mapping including negative controls. |

**Verification:** `pnpm typecheck` green; `pnpm test` green (pdf-core 586 + 1 expected fail, web 280, api 243, mcp 19, ai-agent 152, ai-provider 375); `pnpm build` green; `pnpm test:bundle` 0 engines in main; `pnpm test:provenance` clean; E2E `editor-quick-parity`, `signature-upload`, `text-edit`, `text-model`, `keyboard`, `a11y`, `sign` all green.

**Still open before Sprint 3:** E-07 snapping (invented), E-09 insert pages, E-10's remaining rail/capability truth. Date locale is pinned to en-GB this sprint; a locale picker can use the existing fallback API later. None blocks Gate A for the current feature set.

---

## Sprint 3 close (2026-11-18)

| Task | Result | Evidence |
| --- | --- | --- |
| T-01 | `[x]` | `ParagraphEditRecord` now lives inside `EditorDoc`, so undo/redo restores the record with its objects. Revert removes the replacement + covers in one `apply` (one undo step) and is offered from the block inspector and the detection-details drawer. Because saves always read the original source, object removal is a true revert; `buildReverseParagraphEdit` covers the future rewritten-source case and refuses a multi-line guess. E2E `text-ux` proves edit → revert → export keeps the original text and drops the replacement. |
| T-02 | `[x]` | Dragging a paragraph object moves its native reflow origin with it; the save derives `moved` from the object vs chain-anchored `beforeLines`. Engine `TextLayoutEdit.reflow.moved` repositions rewritten objects through `FPDFPageObj_SetMatrix` (new `setObjectOrigin`), preserving per-line indentation. Unit test proves a moved rewrite changes extraction x/y while the untouched neighbour does not move; E2E asserts the exported text origin (x 72→142, baseline 770→715.2). |
| T-03 | `[x]` | New `editor-paragraph-details.tsx`: page/box/lines/baseline/font/size/rotation/weight/style/role/confidence/text layer/colour/source/char-spacing/paragraph id, plus the post-save outcome for that paragraph id. Copy-to-clipboard, back/edit/revert actions, keyboard labelled. Reachable from the text-block inspector; outcomes are cleared when the paragraph changes. |
| T-05 | `[x]` | Inline editor is transparent over the page; each original line gets an opaque cover preview (the same geometry the commit will whiteout); caret is explicit; width/line-height use the exporter ratio (1.2em padding shared with `buildParagraphEditObjects`). E2E checks masking, transparency and caret at 100%, a screenshot diff of editing vs committed state inside a 3×3 sub-pixel alignment (mean 6.5), and cover/transparency/height at 400%. |
| T-06 | `[~]` | **UI half landed.** Inspector/context formatting is now honest: `paragraphStyleDiff` marks the native plan `styled`, the save demotes a styled paragraph to the overlay path explicitly (`localized-reconstruction`) instead of silently keeping the document's font, and the receipt says "Drawn over the original" with the recoverable-original warning. Re-editing keeps the style already chosen. Native style application remains Sprint 5 (engine half). |
| S-01 | `[x]` | New dependency-free `document/search.ts`: offset-preserving case folding, whole-word matching, overlapping matches, reading-order traversal, line mapping, snippets, right-to-left replacement and missing-page reporting. Unit suite covers folding/whole-word/overlap/replacement/list markers. Failed text-run chunks are retried per chunk (not per document) and reported. |
| S-02 | `[x]` | Ctrl/Cmd+F (also from the paragraph textarea), find/replace inputs, case/whole-word toggles, count, next/prev, jump list, replace-all and Escape ownership. Search reads the existing layouts only (`includeCapabilities:false`) and excludes PDFium capability work. 40-page search measured **735–966 ms** in this environment; results highlight through the existing selection rects. |
| S-03 | `[x]` | IndexedDB `drafts` store (DB v4) + `editor-draft.ts`: source bytes, objects (image payloads included), native plans, records, page order, page/zoom/mode/tool and dirty order. Debounced 1.2 s autosave, 60 MB cap, `QuotaExceeded` visible, strict schema/shape validation on restore, `editor-state.resetTo` establishes a fresh baseline so the first undo cannot erase the draft. In-flight paragraph text is folded into the draft snapshot without closing the textarea. |
| S-04 | `[x]` | Idle banner names the file, save time and edit count, with Restore/Discard; Restore opens the draft bytes through the normal inspect path and hydrates; Discard deletes through reloads; successful export clears the draft. E2E covers reload -> restore -> first undo -> reload -> discard -> reload. |

**Verification:** `pnpm typecheck` green (all packages); `pnpm test` - pdf-core **601 passed + 1 expected fail**, web **301**, api **243**, mcp **19**, ai-agent **152**, ai-provider **375**; `pnpm build` green; `pnpm test:bundle` main chunk 150.4 kB with 0 engines; `pnpm test:provenance` clean. Browser suites green against the dev stack: new `text-ux` **44/44** (revert, move, styling, find/replace, 40-page find, 100%/400% legibility, draft restore/discard), plus `text-model`, `text-edit`, `editor-quick-parity`, `signature-upload`, `sign`; preview suites `keyboard`, `a11y`, `editor-cancel-save` and `smoke` green. Pushed to `origin/rea-uplift`.

**Still open before Sprint 4:** T-06's native styling half (Sprint 5), T-07 rotation, E-07 snapping, E-09 insert pages, E-10 rail/capability truth, S-06 browser back/forward route blocking. None blocks Gate B for the agreed Sprint 3 scope.

---

## Sprint 4 close (2026-11-21)

| Task | Result | Evidence |
| --- | --- | --- |
| C-01 | `[x]` | New `textedit/stream/lexer.ts`: contiguous tokens with byte ranges, literal/hex strings with escapes and octal, names with `#xx`, arrays/dicts, comments, and `BI … ID … EI` inline images. `emitContentStream` concatenates the original ranges, so tokenise→emit is byte-identical; `parseOperations` groups operands. Tests cover escapes, hex, nested dicts, malformed tails, empty streams and an inline image, plus the operation range (`(Hi) Tj`). |
| C-02 | `[x]` | New `textedit/stream/metrics.ts`: Type0 `/W` + `/DW`, simple `/FirstChar` + `/Widths` + `/MissingWidth`, Type3 `/FontMatrix`, base-14 AFM tables (Helvetica/Times/Courier), `/ToUnicode`, `/Encoding` + `/Differences`, Identity vs non-Identity CMap and `reliable`/reason flags. Unit tests pin the two-byte decode/encode, AFM widths, Type3 matrix, non-Identity refusal and the no-width-source negative. |
| C-03 | `[x]` | New `textedit/stream/surgery.ts` walks `q/Q`, CTM, `Tm/Tlm/Td/TD/T*/TL/Tz/Tc/Tw/Ts` and emits glyph quads/advances. Per-glyph removal rewrites only the owning show operator; every other byte is untouched. `partial-word` deletes `2026` mid-`Tj` and keeps `INVOICE`/`0042`; the line's right edge is unchanged. |
| C-04 | `[x]` | Removed advances become negative `TJ` kerns in the operator's own text space (character and word spacing included); `Tj` converts to `TJ` when a removal splits the string; `'`/`"` keep their line move and spacing operands even when every glyph is removed; `formatNumber` keeps four decimals and never rounds a non-zero kern to `0`. Tests cover the `partial-word` and `tj-kern` fixtures and a fully removed `'` run, with pdf.js confirming the following line does not move. |
| C-06 | `[x]` | `ops/edit.ts` wraps the source content in `q … Q` before appending overlays, decodes pdf-lib `PDFFlateStream` content via `getUnencodedContents`, keeps `/Contents` an array (pdf-lib appends into it) and clears pdf-lib's cached content stream so new draws land in the wrapped page. The unclosed-clip fixture exports with a leading `q`, a closing `Q` and the original `(CLIPPED) Tj` intact. |
| C-12 | `[x]` | `exportVerify` now compares `/Rotate`, fingerprints every page no edit touched, and fails a changed untouched page; the stream pass reopens its own output and **discards** the rewrite with a warning when replacement/absence checks fail. A stream outcome carries its glyph-derived box, so the visual gate sees the region instead of skipping it. Tests cover untouched pass/fail and rotation fail. |
| C-13 | `[x]` | `assertEditsValid` rejects a non-integer/negative page, a non-positive box and an empty `beforeLines`; a text-only edit warns `edit-coverage` instead of disappearing; `assertOutcomeCoverage` refuses an edit that produced no outcome. Test proves a no-box edit still exports with the warning. |
| C-14 | `[x]` | The scan records inline images, text found inside a Form XObject `Do`, Type3 fonts and malformed token streams. Unmatched edits report `stream-incomplete: …` and `ContentStreamResult.complete:false`; the engine forwards those as warnings. Tests pin the XObject warning and prove an inline image no longer prevents the following text from being rewritten. |
| G-03 | `[x]` | `test/golden.ts` adds page rotation, an FNV text fingerprint and pdf-lib + pdf.js reopening; `pnpm test:corpus` (`scripts/corpus.mjs` → `test/goldenCorpus.test.ts`) runs the harness end-to-end and prints pass/fail with per-page diffs. The negative control fails on the untouched-page fingerprint. |

**Verification:** `pnpm typecheck` green for all 8 workspace projects; `pnpm test` — pdf-core **639 passed + 1 expected fail**, web **301**, api **243**, mcp **19**, ai-agent **152**, ai-provider **375**; `pnpm build` green (63 routes prerendered); `pnpm test:bundle` main chunk **150.4 kB, 0 engines**; `pnpm test:provenance` clean; `pnpm test:corpus` **2/2**; browser `text-edit` **7/7** and `editor-quick-parity` **20/20** green against the dev web app (preflight used a local mock `/api/health`; neither suite uses server-backed steps). Total new coverage: 38 pdf-core tests (`streamLexer` 10, `streamMetrics` 8, `streamSurgery` 15, `streamVerification` 3, `goldenCorpus` 2) plus the extended golden test.

**Still open before Sprint 5:** C-05 partial-run deletion policy (stream removal exists, the deletion UX still needs the C-05 wiring), C-07 leftover-cover policy, C-08..C-11, T-06 native styling, T-07 rotation, E-07 snapping, E-09 insert pages, E-10 rail truth, S-06 back/forward blocking. **Gate C is not claimed:** it requires C-07, which is Sprint 5.

---

## Sprint 5 close (2026-11-21)

| Task | Result | Evidence |
| --- | --- | --- |
| C-05 | `[x]` | The editor recognises a pure deletion inside one original line (`singleRunDeletion`) and emits it as a content-stream deletion instead of a paragraph rewrite. It removes only the selected glyphs, compensates their advance, and refuses rather than covering when the stream cannot anchor it. Unit: prefix/suffix/repeated-line/insertion cases. |
| C-07 | `[x]` | Explicit `coverPolicy:'leftover-cover'` on paragraph/deletion edits. The engine adds a small patch only after an `in-place`/`content-stream` removal, only when its fill-operator walker plus image/form placement check finds white paint behind the box. A coloured panel/image skips the patch with `leftover-cover-skipped`; the receipt names `leftover-cover` and never calls it redaction. Tests: white page patch count > 0, coloured page patch 0. |
| C-08 | `[x]` | `fitTextToWidth` (40-250%, readable band 70-140%), `Tz` written with `setCharacterSqueeze`, warnings outside the readable band, and word-by-word placement when the font cannot encode U+0020. Unit boundaries + export path. |
| C-09 | `[x]` | `ops/textRaster.ts` renders one uncodable line locally (bounded 6x/4 MP), embeds PNG, bypasses `assertEncodable` only for objects that opted into `rasterFallback`, and reports `glyph-rasterised`; the verifier skips the text expectation for rasterised edits. Test proves the emoji is absent from extraction while the rest of the page survives. |
| C-10 | `[x]` | Stream glyph quads/removals already carried rotation; Sprint 5 pins 180° and 270° matrices and adds native rotated reflow via matrix rotation. Corpus rotated fixture still removes cleanly. |
| C-11 | `[x]` | `TextTypography.color`, bounded page render at 720 px, ink/paper distance rejection, strongest-ink averaging, per-line limit (240) and dominant colour hoisted to paragraphs. `text-runs` opts in with `includeColors`; the editor seeds the replacement and the overlay from the sampled colour. Test reads a red heading back from the rendered page. |
| T-06 | `[x]` | Native style is applied to the rewritten objects: matrix scale for size, fill colour, rotation, alignment, synthetic italic (12° shear) and synthetic bold (fill+stroke). Requested family changes or un-bolding a face stay on the overlay with `font-substituted`; synthetic styles emit `synthetic-bold`/`synthetic-italic`. Standard-14 extra lines are created natively with `FPDFPageObj_NewTextObj` (the `CreateTextObj`/`FPDF_FONT` path traps in this build); embedded/custom faces and styled growth still fall back honestly. |
| T-07 | `[x]` | `rotationDeg` on text objects and the native plan; inspector numeric + 15° snap and 0/90/180/270 quick rotate. E2E proves a rewritten paragraph extracts at -90° while the rest of the page is untouched. |
| E-07 | `[x]` | Pure `lib/snap.ts` (page edges/centres + object edges/centres, 6 px threshold, sub-point movement), guide lines rendered only while snapped, Alt bypass, one undo step. Unit math/Alt tests; E2E guide appears then clears. |
| E-09 | `[x]` | Insert Pages opens a multi-file picker, composes current + extra docs in rail order, remaps object/paragraph `pageIndex` to the new positions, resets the rail baseline, updates source bytes and inspects the combined file. E2E appends a page while keeping page 0. |

**Verification:** `pnpm typecheck` all 8 projects; `pnpm test` - pdf-core **657 passed + 1 expected fail**, web **309**, api **243**, mcp **19**, ai-agent **152**, ai-provider **375**; `pnpm build` (63 routes), `pnpm test:bundle` main **150.4 kB / 0 engines**, `pnpm test:provenance` clean, `pnpm test:corpus` **2/2**. Browser suites against the dev web app: `text-ux` **56/56** (adds partial delete, snap, native style, synthetic-bold receipt, rotation, insert pages), `text-edit` and `editor-quick-parity` green. New unit coverage: `textFidelity.test.ts` (15), `snap.test.ts` (5), text-editing deletion cases (3), raster-fallback validation (1).

**Still open before Sprint 6:** S-06 browser back/forward route blocking and E-10's remaining rail/capability truth. Gate C is **met**; the remaining O/X/H scope is Gate D.

---

## Sprint 6 close (2026-11-22)

| Task | Result | Evidence |
| --- | --- | --- |
| O-01 | `[x]` | The editor detects an image-only page from the capability snapshot and offers one explicit banner: “Read this page” or “Read scanned pages”. No OCR runs automatically; an already-OCRed page is marked by its layer badge and confidence banner. Unit: capability classification already pinned; E2E `sprint6-trust` waits for the banner on a real JPEG scan. |
| O-02 | `[x]` | New `ocr/textLayer.ts` + `ocr-text-layer` job. It opens the original with pdf-lib, renders only the requested pages for recognition, appends `Tr 3` text to those pages, and never rebuilds a page. Page count, objects, fonts, annotations, metadata and paragraph ids survive. Coordinates use pdf.js's viewport inverse, so `/Rotate 90/180/270` and CropBox offsets are handled; the cap counts requested pages, not the whole document. The standalone `ocr` rebuild path is untouched. Unit: skip/already-text, all four rotations, CropBox, no-op bytes, one page of 101, recognizer termination. E2E: editor OCR → save → download → extracted `INVOICE 2026`/`TOTAL 42`. |
| O-03 | `[x]` | Recognition returns per-page mean confidence, word/line/paragraph counts and up to 40 point-space blocks (`summarizeOcrPage`). The job payload carries them to the editor; paragraph grouping is explicitly proximity-based, not a layout claim. Unit: word/line/paragraph summary and block geometry. |
| O-04 | `[x]` | Session provenance map (confidence, words, paragraphs) drives a page banner and the status line; the detection-details drawer shows the confidence or says it was not recorded this session. Copy says “check the text before relying on it”. OCR paragraphs stay editable through the normal native path with the invisible render mode preserved. E2E: banner/confidence copy and an OCR-only export. |
| O-05 | `[x]` | The recognizer is created lazily and terminated in `finally`; pdf.js is destroyed and page proxies are cleaned per page. The editor cancels/reaps the runner on Start over. Unit: terminate on a successful run. E2E records every request: the model comes from `/tessdata/` on this origin, zero external requests, job pool idle afterwards. |
| X-01 | `[x]` | New `warnings.ts` with a `WarningCode` union, `{code, detail, message}`, prefix/legacy classification, dedupe by code+detail and a 40-entry cap. `JobWarnings` is active; text-edit, OCR and redaction now return coded warnings while keeping the human sentence. The receipt prints `[code] message`. Unit: parsing, unknown prose, dedupe/cap, override codes. |
| X-02 | `[x]` | `EditStats` comes from the pass that did the work: pages, characters removed/added, objects/images drawn, fonts embedded/substituted, rasterised glyphs, covers, strategy, verification verdict. Every editor export now renders a receipt, including object-only and OCR-only saves. Removed characters count only native consumption (an overlay leaves the original), invisible objects are not called drawn, and the OCR-only copy says a text layer was added. The “no checks” contradiction is gone because object-only saves run the real export gate. Unit: text, object-only and character-count jobs. |
| X-03 | `[x]` | Untouched-page text fingerprints are part of the artifact gate for text and object-only saves. A mismatch blocks with an `untouched-page-changed` refusal; the editor offers “Download anyway”, which re-runs only that class of failure and records `untouched-page-accepted` in the receipt. Structural failures cannot be overridden. Unit: detects a changed untouched page, refuses by default, accepts only the fingerprint class. |
| X-04 | `[x]` | `InspectOutput.metadata` now carries subject, keywords, creator, producer and creation date. Composition preserves creator/producer as well as the existing date policy. Tests prove a native text edit keeps title/author/subject/keywords/creator/producer/dates, the outline tree, page labels and AcroForm fields. |
| X-05 | `[x]` | Save is disabled when the document has no changes, with an accessible explanation, and a guard covers keyboard/mobile paths (including Organize, so a no-op page export cannot slip through Ctrl+S). OCR and Insert Pages mark the source bytes dirty so their work is saveable and guarded by `beforeunload`/drafts; the guard clears after a save and OCR/save cannot overlap. E2E: a freshly opened document cannot be saved; placing one object enables it; a fully reverted edit has nothing to save. |
| H-04 | `[x]` | Seeded fuzz over the lexer/emitter/planner (`test/streamFuzz.test.ts`, fixed mulberry32 seeds, explicit timeouts) proves byte-identical emission, bounded operation ranges, and explicit refusal rather than crash; replacement planning is fuzzed too. It found a real infinite loop: a stray `>` delimiter produced a zero-width token. `readWord` now consumes an unclaimed delimiter; a regression test pins it. `pnpm test:fuzz` is a named CI step. |

**Verification:** `pnpm typecheck` green for all 8 workspace projects; `pnpm test` — pdf-core **691 passed + 1 expected fail**, web **310**, api 243, mcp 19, ai-agent 152, ai-provider 375; `pnpm build` green; `pnpm test:bundle` main chunk **150.4 kB / 0 engines**; `pnpm test:provenance` clean; `pnpm test:corpus` **2/2**; `pnpm test:fuzz` **4/4**. Browser E2E against the dev web app: new `sprint6-trust` **21/21** (two-page editor OCR, provenance across runs, no egress, object-only receipt, no-change guard), `text-ux` **57/57** (updated for X-05), `text-edit` 7/7, `editor-quick-parity` 20/20, standalone `ocr` all checks green, `keyboard`/`a11y` green against the production preview.

**Still open before Sprint 7:** H-01/H-02/H-03/H-05..H-08. O-03 paragraph counts are proximity summaries, not a layout engine claim; O-04 confidence is session-local after a reload (the layer itself is detected forever). X-04 composition preserves metadata/dates but not outlines/page labels (those survive in-place edit/export).

---

## Sprint 7 close (2026-11-22)

| Task | Result | Evidence |
| --- | --- | --- |
| H-01 | `[x]` | New `lib/editor-shortcuts.ts` is the single registry for the window handler, the generated shortcut sheet and the rail. It adds find, object/text clipboard, Alt-snap note, fit page, PageUp/Down, `?`, the legacy `S` select alias and Escape semantics. Unit: 9 registry tests; E2E `keyboard` exercises every tool key plus find, the sheet, duplicate and copy/paste. |
| H-02 | `[x]` | Roving tabindex and arrow/Home/End movement in the tool rail; live regions for find, OCR, save and selection; neutral focus/guide/caret contrast. The pointer resize handles are pointer-only affordances with exact width/height fields as the keyboard alternative. Axe passes with find open, the inline paragraph editor open, the pen context bar and the phone properties sheet. |
| H-03 | `[x]` | `test/editorBench.test.ts` measures a 100-page inspect (31 ms), 100-page PDFium capabilities (33 ms), 10k ink points across two capped strokes (366 ms), one text edit on a 100-page document (107 ms) and 1.1 MB / 100k operation tokenise→emit (230 ms), with byte identity. Numbers: `tests/benchmarks/editor-ceilings.md`; `pnpm test:editor-perf` is a CI step with a wider runner budget. |
| H-04 | `[x]` | Already landed in Sprint 6; remains in `pnpm test` and as its own CI step. |
| H-05 | `[x]` | `tests/e2e/cross-browser.mjs` runs Chromium, Firefox and WebKit through open → keyboard text → nudge → find → save → reopen. Results: `docs/CROSS-BROWSER.md`. The Playwright WebKit build has no OffscreenCanvas, so worker page raster is recorded UNSUPPORTED while text editing/export pass; physical iOS is not claimed. |
| H-06 | `[x]` | Pointer capture on pages, objects and handles; a gesture is owned by one pointer (second finger/palm ignored); contacts wider than 40 px are rejected; Select keeps `pan-y`, drawing uses `none`; find is a phone bottom sheet; properties are a dismissible sheet. `tests/e2e/editor-touch.mjs` 11/11 on an iPhone 13 profile. |
| H-07 | `[x]` | `TOOL_HELP` and `TOOL_LIMITS` give every tool one honest line; tooltips carry the explanation; the shortcut sheet is generated; the misleading Text hint now says a paragraph needs the pointer/selection and that Add Text is a drag on empty space. |
| H-08 | `[x]` | `docs/PARITY-REPORT.md` maps all 63 cards, names reproduced/improved/invented/partial/declined rows with evidence, and lists remaining risk. Linked from `README.md`. |

### 7.1 UI pass in the same sprint

The editor shell was rebuilt around the document, not around panels:

- The marketing header is hidden while a document is open; the editor owns the
  full viewport and the top bar carries the way back.
- The top bar gained a page control (`◀ 1 / 3 ▶`), undo/redo/find, document
  details and the shortcut sheet. The green primary action became ink; editor
  tokens override brand green and the green focus ring.
- The tool rail lost its uppercase group headings and the empty inspector no
  longer occupies a permanent column. The page rail starts collapsed and opens
  itself in the Pages workspace.
- Selection is the reference editor's direct-manipulation language: a thin
  neutral box, small square corners, round side dots and an attached grip to
  move. Pointer handles are 24 px hit areas with 7 px visuals; exact width and
  height inputs are in the inspector.
- Text selection gets the reference's inline formatting bar: move grip on the
  object, font, a real − / size / + stepper, bold, italic, alignment, colour and
  object actions. No green/red status dots and no uppercase meta headings.
- The status bar reports the active tool's one-line help and the save state
  without decorative dots. Find becomes a bottom sheet on phones.

**Verification:** `pnpm typecheck` (8 projects); `pnpm test` — pdf-core **697 + 1 expected fail**, web **318**, api 243, mcp 19, ai-agent 152, ai-provider 375; `pnpm build` (63 routes); `pnpm test:editor-perf` 5/5; **`text-ux` 57/57**, `sprint6-trust` 21/21, `editor-quick-parity` 23/23, `text-edit` 7/7, `sign`, `signature-upload`, `keyboard` (31 checks), `a11y` (all contexts clean), `editor-touch` 11/11, `cross-browser` all installed engines passed. `smoke` passed the editor and tool sections; its three accounts-off checks depend on a frontend-only deployment and were run against a preview with no API.

**Remaining, recorded not hidden:** Playwright WebKit has no OffscreenCanvas (raster previews unsupported there); physical iOS/Android was not run; G-02/G-05/E-10/F-01/S-06 keep their Sprint-1 partial status; the smoke accounts-off checks are environment-gated.

---

## 8. Release gates

### Gate A — Foundation + parity
- G-01/02/04, F-01, E-00, E-10, S-06 complete.
- Pen, check/cross, date, stamps, signature, zoom, clipboard E2E green.
- No new console errors; bundle boundary green; no silent discard path.

### Gate B — Text UX + recovery
- T-01..T-06 (agreed scope), S-01..S-04 complete.
- Formatting/revert/move round-trip honest.
- Find 40 pages within budget; draft restore survives reload and first undo.
- `text-edit`, `text-model`, `keyboard`, `a11y` still green.

### Gate C — Stream v2 safe to default
- C-01..C-04, C-06, C-07, C-12, C-13, C-14 green on the corpus.
- Removed spans absent; untouched pages text-identical; glyphs after removal do not move.
- Sabotaged stream falls back with a warning.
- Only then default; old path removable in a later release.
- **Met 2026-11-21** (Sprint 5): `pnpm test:corpus` 2/2, stream/removal tests green, C-07 cover policy included.

### Gate D — Ship
- O, X, H complete.
- Cross-browser recorded; perf ceilings in CI; redaction verifier still green; no egress.
- Parity report published.
- **Met 2026-11-22** (Sprint 7): `docs/PARITY-REPORT.md`, `docs/CROSS-BROWSER.md`, `pnpm test:editor-perf`, axe interactive contexts, touch and cross-browser loops. The recorded exceptions (Playwright WebKit OffscreenCanvas, physical iOS/Android, the five partial cards) are named in the report.

---

## 9. Measurement plan

Numbers must come from scripts, not PLAN.md prose. Re-run before quoting.

| Metric | Baseline source | Gate A | Gate B | Gate C | Gate D |
| --- | --- | --- | --- | --- | --- |
| Unit tests | `pnpm test` - 601 pass + 1 expected fail (pdf-core), 301 (web) on 2026-11-18 | | | | |
| Editor E2E | `smoke`, `text-edit`, `text-model`, `text-ux` | | | | |
| Export p50 (10-page text edit) | new benchmark | | | | |
| Export p95 (120-page) | `long-120page.pdf` | | | | |
| 10 s ink point count | new benchmark | | | | |
| Find 40 pages | `tests/e2e/text-ux.mjs` | | 735–966 ms (dev, this machine) | | |
| Page warm-up incl. capabilities | new benchmark | | | | |
| Main chunk size | `test:bundle` | | | | |
| Fontkit bundle delta (worker) | `test:bundle` | | | | |
| Engines in main | 0 | 0 | 0 | 0 | 0 |

---

## 10. Branch and release safety

- All seven sprints live on **`rea-uplift`**, pushed to `origin/rea-uplift` after each sprint.
- **Sync before every sprint (added 2026-11-18).** Merge `origin/main` into `rea-uplift` at the start of each sprint (and again before the final Gate D merge). This keeps main an ancestor and localises any conflict to the sprint boundary instead of the release. Never rebase or force-push.
- **Conflict dry run.** Before calling a sprint done, run `pnpm test:merge-clean`; it must report no conflicts. A conflict is fixed on `rea-uplift` while the change is still small.
- **2026-11-18 sync:** merged `origin/main` (`30fde40`, dark-only frontend) into `rea-uplift` as merge commit `4390264`. `origin/main` is now an ancestor; the only conflict was `PLAN.md`, resolved by keeping both sections (main's frontend pass became §38). `pnpm test:merge-clean` reports no conflicts.
- **Never commit directly to `main`** for this uplift. `main` stays at the production commit until the final gate.
- Do not open a pull request or merge to `main` until all seven sprints and Gate D are complete.
- Production deploys from `main`; the feature branch is a safe backup and does not affect the live site.
- The reference tree `rea ihpdf/` is gitignored and must never be committed.
- Every sprint starts from the previous sprint's tip on `rea-uplift`; no rebases or force-pushes.

---

## 11. Risks

| Risk | Mitigation |
| --- | --- |
| Stream rewrite shifts glyphs | C-04 + C-12 + G-03 + Gate C |
| Dirty edit silently dropped | C-13 + S-06 + multi-page E2E |
| New object becomes redaction mark | E-00 + E-04 isolation test |
| Native style ignored while UI looks editable | T-06 decision + receipt copy |
| Draft restore erases on first undo / duplicates covers | `resetTo` + persist `paragraphObjectIds` |
| OCR rebuild invalidates session | O-02 text-layer-only job |
| Raster fallback hides text | explicit code + verifier + receipt |
| Font metrics wrong | reliability flag + cover/warn |
| Autosave leaks storage | cap + visible notice + Discard |
| Cross-package warning refactor breaks tools | X-01 sequenced with type tests |
| Fontkit adds size, licensing and CFF failure modes | F-01 bundle gate + subset/full fallback + licence notice + CFF fixture |

---

## 12. Changelog

| Date | Change |
| --- | --- |
| 2026-11-17 | v1 created: 57 cards, feature list, gates. |
| 2026-11-17 | v2 after deep reads: 62 cards; corrected statuses (E-05/E-06/E-08 partial, X-06 nearly done, X-04 test/doc, O engine half done, G tasks partial); added E-00, S-06, C-13, C-14, O-03; declined synthetic bold; rewrote T-01/T-02/T-06/T-07, O-02, X-01/X-02/X-03; added 9 decisions, sprint order, measured baselines caveat, three-category provenance. |
| 2026-11-17 | Owner decisions locked (D1–D17): hybrid copy, foundation-first, TJ kerns + Tj→TJ, real native formatting, text-layer OCR + page provenance, **fontkit added**, raster fallback, explicit redaction roles, draft autosave on, Tz 40–250%, build snapping, metadata + forms/outlines/labels, cross-browser last. Added F-01; count 63. |
| 2026-11-17 | G-01 landed: `licenses/rea-ihpdf-NOTICE.md`, derived-code header convention, `scripts/check-provenance.mjs`, `pnpm test:provenance`, CI step; positive + negative control verified. |
| 2026-11-17 | **Sprint 1 landed.** G-01/G-04/E-00/X-06 complete; G-02/G-03/F-01/E-10/S-06 partial. Added provenance gate; validated `TextEngineStrategy`; object roles + batch create; fontkit 2.0.12 with document-programme extraction/embedding; text-surgery + golden harnesses; leave-confirmation sheet; cancel E2E. Evidence: typecheck all packages, 580+1 pdf-core, 211 web, build + bundle boundary, text-model/text-edit/keyboard/editor-unmount/editor-cancel green. |
| 2026-11-17 | **Sprint 1 bug pass.** Fixed Change-file discarding the picker before it returned (input now stays mounted until a file is chosen); font discovery now follows inherited page resources; `native-only` now refuses every non-native outcome, not just the content-stream pass; Hono advisories patched via workspace overrides (`pnpm audit` clean, MCP 19/19). |
| 2026-11-17 | **Sprint 2 landed.** E-01/E-02/E-03/E-04/E-05/E-06/E-08/T-04/S-05 complete: vector ink + check/cross/stamp object kinds, date stamp, signature upload with luminance alpha + trimmed aspect, 400%/typed/fit-page zoom, object clipboard with shared page clamp, detected-text outline debug layer, and `empty`/`not-a-pdf`/`out-of-memory` error codes. New pure libs `ink`, `stamp-date`, `stamp-presets`, `object-placement`, `zoom` with unit tests; E2E `editor-quick-parity` + `signature-upload`. PDF-core 586+1 expected fail, web 280, build/bundle/provenance green, text-edit/text-model/keyboard/a11y/sign E2E green. |
| 2026-11-17 | **Sprint 2 bug pass.** Copies no longer duplicate paragraph rewrite intents (`lib/object-copy.ts`); signature placement keeps the exact ink aspect and adopted assets read the PNG IHDR (repairs pre-trim records); redaction styling/test ids use the explicit role, not a black-rect shape; `not-a-pdf` copy no longer repeats itself; `no data` no longer mislabels a truncated xref as empty; richer headlines survive `sentence()`; zero-byte files get the empty-file copy before the engine; invalid Dates no longer throw the date formatter; stamp labels draw as stored (uppercasing `µ` produced Greek Mu after validation); stamp text is height-clamped; fit page falls back to width in a zero-height viewport; paste at the object limit is no longer silent; zoom keeps a live announcement; upload decode is guarded after close; uploaded signatures are recorded as `uploaded` in the audit note and asset list, not `drawn`. PDF-core 586+1 expected fail, web 280; all E2E suites rerun green. |
| 2026-11-18 | **Sprint 3 landed.** T-01/T-02/T-03/T-05 complete; T-06 UI half; S-01/S-02/S-03/S-04 complete. Paragraph records moved into the snapshot (undo-safe revert), native reflow gained `moved` + matrix repositioning, a detection-details drawer, transparent inline editing with per-line covers, a pure search engine and panel, and IndexedDB draft autosave/restore. New `document/search.ts`, `lib/editor-draft.ts`, `editor-find-panel.tsx`, `editor-paragraph-details.tsx`, `tests/e2e/text-ux.mjs` (44 checks). Unit: pdf-core 601+1 expected fail, web 301; build/bundle/provenance green; text-model/text-edit/editor-parity/signature-upload/sign/keyboard/a11y/editor-cancel all green. 40-page find 735-966 ms. |
| 2026-11-18 | **Sprint 3 bug pass.** Moved reflow no longer runs away (delta measured inside the update against the same snapshot) and the engine now repositions rewritten objects instead of snapping back; opaque line covers remove stale-glyph ghosting; re-editing a paragraph keeps its chosen style; search folds a paragraph's committed text so a re-run does not quote removed words; failed text-run chunks are retried individually; draft records no longer duplicate object-id maps (records own their ids); replace-all applies edits right-to-left. |
| 2026-11-18 | **Merge sync + bug pass.** Merged `origin/main` (`30fde40`, dark-only frontend) into `rea-uplift`; only `PLAN.md` conflicted, resolved with main's frontend pass as §38. `origin/main` is now an ancestor, so the final merge starts conflict-free; added `pnpm test:merge-clean` and the sync-before-each-sprint policy (§10). Bug pass found and fixed: the smoke zoom assertion read an `<input>` via `textContent` (always empty; now `inputValue`), and the API processor could not resolve `@cantoo/fontkit` after the merged install (now a direct `@pdfshush/api` dependency, verified by a real workflow job). Smoke `ALL CHECKS PASSED`, text-ux 44/44, API suite rerun. |
| 2026-11-21 | **Sprint 4 landed.** C-01/C-02/C-03/C-04/C-06/C-12/C-13/C-14 and G-03 complete. New `textedit/stream/{lexer,metrics,surgery}.ts`: byte-identical token emission, inline images, document font advances (Type0/simple/Type3/base-14), per-glyph removal with `TJ` compensation, rotated glyph quads and line-move preservation. `ops/edit.ts` wraps source content in `q … Q` before overlays. `exportVerify` adds rotation and untouched-page fingerprints; the stream pass discards a rewrite that fails its own reopen check; edits with no outcome are refused. Golden harness gains rotation, fingerprints and `pnpm test:corpus`. PDF-core 628+1 expected fail, web 301, build/bundle/provenance green, text-edit/editor-parity E2E green. Gate C still requires C-07. |
| 2026-11-21 | **Sprint 4 bug pass.** Ten boundary defects fixed. Base-14 widths are no longer guessed from family-like names (`MySansFace`, `Symbol`, `ZapfDingbats`, `HelveticaNeue` are unreliable); a duplicated needle inside one show run is refused rather than guessed; Type0 odd-byte strings and undecodable runs cannot be planned; unsupported content filters are never spliced into a raw wrapper and isolation is flate-compressed; untouched-page checks are bounded to 64 head/tail pages by default and mixed text+overlay exports declare overlay regions; caller boxes win over derived glyph boxes; rotated stream removals get a display box through `pageGeom`; malformed hex strings are flagged. Added first/last `TJ`, `Tc`/`Tw`/`Tz`, `"` operator, duplicate-needle, odd-Type0, rotated-box, unsupported-filter and mixed-overlay tests. PDF-core 639+1 expected fail, web 301, bundle 150.4 kB / 0 engines, corpus 2/2, text-edit 7/7 + editor-parity 20/20. |
| 2026-11-21 | **Sprint 5 landed.** C-05/C-07/C-08/C-09/C-10/C-11, T-06 native style, T-07 rotation, E-07 snapping and E-09 insert pages complete. New `singleRunDeletion` routes a one-line word deletion through stream surgery; `coverPolicy:'leftover-cover'` adds engine-generated patches only on white paint, from a fill/image operator walk; `fitTextToWidth` + `setCharacterSqueeze` and word-by-word layout; `ops/textRaster.ts` renders uncodable lines locally with `glyph-rasterised`; native style uses matrix scale/shear/rotation/fill and synthetic bold, with `synthetic-bold`/`synthetic-italic`/`font-substituted` receipts; `TextTypography.color` comes from bounded page sampling; `lib/snap.ts` + guides + Alt; insert-pages composes and remaps object/paragraph pages. pdf-core 657+1 expected fail, web 309, api 243, mcp 19, agent 152, provider 375; build/bundle 150.4 kB / 0 engines; corpus 2/2; text-ux 56/56, text-edit and editor-quick-parity green. **Gate C met.** |
| 2026-11-21 | **Sprint 5 bug pass.** New-object creation was found to be refused by this PDFium build (`SetText`/`SetMatrix` trap on a freshly created text object), so native styling was redesigned to mutate existing objects; a styled replacement that would need extra lines now falls back to the overlay instead of corrupting the page. Insert Pages no longer leaves the organise runner in `done` (which hid the editor behind its result panel), and page order is updated through the session instead of the editable document. Cover detection was moved from raster sampling to a content-stream fill/image walk so `apps/api` keeps compiling without the `dom` lib; `render/canvas.ts` now uses structural canvas types and the API typecheck is clean again. The `text-ux` formatting scenario asserts a native rewrite, synthetic-bold receipt and vertical extraction rather than the old overlay demotion. |
| 2026-11-21 | **Native new-text-object fix.** `FPDFPageObj_CreateTextObj(FPDF_FONT, …)` is the broken path in `@embedpdf/pdfium` 2.15.1: `SetMatrix`/`SetText` trap on a fresh object. Upstream `fpdf_edit.h` documents `FPDFPageObj_NewTextObj(document, font_name, size)` for standard fonts, and that path works in the same wasm. `PdfiumTextDocument.createStandardTextObject` now uses it; native reflow creates extra Helvetica/Times/Courier lines without an overlay. `textObjectCreation.test.ts` proves create → set text → set matrix → insert → generate → save → reopen → extract for regular, bold, italic and Courier faces; a second test proves a grown paragraph exports `in-place`. Embedded/custom faces and styled growth still use the declared overlay. The bundled binary was not replaced and no memory workaround was added. PDF-core 657+1 expected fail; `text-ux` 56/56 (adds a native paragraph-growth scenario). |
| 2026-11-21 | **Sprint 5 bug-fix session.** Partial deletions now report the exact removed glyph box, so C-07 patches the word rather than whiteout-ing the whole line; covers use the page's own paper colour, ignore shades/inline images, are drawn below user objects, and a background-read failure is a warning rather than a failed export. Multi-line rotation rotates the whole block around one pivot in both native and overlay paths (native multi-line rotation falls back explicitly). Styled size divides out an existing matrix scale; word-by-word positions advance in squeezed space; alignment/family are sent only when changed and overlay text drops the document `fontKey` when weight/family changes so the chosen face is real. Insert Pages invalidates page-index-keyed caches, remaps through `live` (not undo), drops objects on pages the rail removed, and clears stale outcomes. Find & replace no longer pays for colour renders, and untrusted layout style values are validated before any PDFium work. |
| 2026-11-22 | **Sprint 6 landed.** O-01..O-05, X-01..X-05 and H-04 complete. New `ocr/textLayer.ts` + `ocr-text-layer` job append invisible text to existing pages (no rebuild) with per-page confidence/structure, a scan banner, session provenance and teardown. `warnings.ts` adds coded/deduped warnings across text-edit/OCR/redaction; receipts carry engine stats and every export renders one. Object-only and OCR-only saves run the real export gate; untouched-page fingerprint failures can be knowingly accepted and are receipted. Metadata preservation covers creator/producer/dates plus outline/page labels/AcroForm in edit/export; Save is disabled when nothing changed. Seeded fuzz found and fixed a stray-`>` scanner loop and runs as `pnpm test:fuzz` in CI. pdf-core 691+1 expected fail, web 310, api 243, mcp 19, agent 152, provider 375; build/bundle 150.4 kB / 0 engines; corpus 2/2; E2E `sprint6-trust` 21/21, `text-ux` 57/57, `text-edit` 7/7, `editor-quick-parity` 20/20, `ocr`, `keyboard`, `a11y` green. |
| 2026-11-22 | **Sprint 6 bug pass.** OCR coordinates now come from pdf.js's viewport inverse (`/Rotate 90/180/270` and CropBox offsets, not MediaBox guesses); the page cap applies to requested pages, so one page in a 101-page scan is allowed; an explicit missing page refuses instead of being silently dropped. Provenance survives a second OCR run and follows insert-page remapping; Save and OCR cannot overlap, a no-change Organize export can no longer slip through the keyboard path, and the beforeunload guard tracks source-only changes and clears after save. Receipts no longer call an OCR-only export an object/page-order change, count removed characters only for native consumption, and do not count invisible objects as drawn. Inspect dates are validated ISO strings (JSON-safe across the API). OCR empty-page copy is distinguished from "already has text"; the Save-disabled control explains itself. Fuzz now covers replacement planning and has explicit timeouts. PDF-core 691+1 expected fail, web 310, E2E `sprint6-trust` 21/21, text-ux 57/57. |
| 2026-11-22 | **Sprint 7 landed.** H-01..H-08 complete. One shortcut registry drives the handler, generated sheet and rail; roving rail focus, live regions and axe contexts for find/paragraph/ink/phone sheet; editor ceilings with a CI step; Chromium/Firefox/WebKit loop and a touch/palm-rejection suite; per-tool help copy; the 63-card parity report. The same pass rebuilt the editor UI: full-viewport document, top page/undo/find/details bar, no group headings or empty inspector column, ink-not-green primary, direct-manipulation selection (thin box, corner squares, side dots, attached move grip) and the reference-style inline text formatting bar. pdf-core 697+1 expected fail, web 318; text-ux 57/57, editor-parity 23/23, keyboard 31 checks, a11y all contexts, editor-touch 11/11, cross-browser all installed engines. |
| 2026-11-22 | **Sprint 7 UI/gesture bug pass.** Saving now freezes every mutating keyboard and chrome path (undo/redo/find/duplicate/cut/paste/delete/tool, Change/Start over/Back, mode tabs); page/object/move/resize gestures record their owning pointer so a second finger cannot steal them, and wide palm contacts are rejected on objects too; Document details clears the competing inspector and opens the phone sheet; Duplicate/Delete no longer enable for a detected text block while Properties does; top-bar page input and PageUp/PageDown use display order after a rail reorder; Escape cancels typed zoom/page/font/stamp/dimension values instead of committing through blur; direct organizer entry reopens the page rail; exact dimensions clamp at the 8 pt editor minimum; portal sheets inherit the editor ink tokens; dead dot/title/tool-group/keyboard-list CSS and `toolStatusLabel` removed. Re-ran typecheck, full unit, build, a11y, keyboard, text-ux, editor-parity, touch and smoke editor/tool sections. |
| 2026-11-22 | **Test hygiene.** `smoke.mjs` now writes generated `smoke-alpha.pdf`/`smoke-beta.pdf` instead of overwriting the tracked `tests/e2e/fixtures/alpha.pdf`; a smoke run no longer dirties the worktree or changes the fixture other suites read. |
