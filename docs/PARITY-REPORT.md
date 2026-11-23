# Parity report: rea uplift vs `ihatepdf`

Published 2026-11-22 for Gate D (H-08); updated 2026-11-23 when G-02, G-05, F-01 and E-10 closed. The reference checkout is gitignored and
absent from this repository, so this report compares against `reaTask.md`'s
recorded behaviour rather than re-reading the target. Every `Reproduced` or
`Improved` row names the shipped evidence; `Partial` and `Declined` rows say
what is actually missing.

Legend: **R** reproduced, **I** improved, **N** invented (not in the target),
**P** partial, **D** declined.

## Gates

| Gate | State | Evidence |
| --- | --- | --- |
| A - foundation + parity | met | `pnpm test:e2e:editor-parity`, `editor-rail`, `signature-upload`, `keyboard`; `text-model`; `pnpm test:guardrails` |
| B - text UX + recovery | met | `pnpm test:e2e:text-ux`, `text-edit`, `text-model`; `lib/editor-draft.test.ts` |
| C - stream v2 safe to default | met 2026-11-21 | `pnpm test:corpus` 2/2, `test:streamSurgery`, `test:streamVerification` |
| D - ship | met by this sprint | H rows below; S-06 route blocker; `pnpm test:editor-perf`, `test:e2e:cross-browser`, `test:e2e:editor-touch`, `test:e2e:editor-cancel`; a11y axe contexts |

## Task matrix

| ID | Task | Verdict | Evidence |
| --- | --- | --- | --- |
| G-01 | Provenance, notice, copy header | R | `licenses/rea-ihpdf-NOTICE.md`, `scripts/check-provenance.mjs`, `pnpm test:provenance` |
| G-02 | Corpus v2 | I | `textSurgery.ts` covers partial-word, kerned TJ, 90/180/270, nested arrays, inline image, Form XObject and unclosed clip; `fontFixtures.ts` adds Type3, Type0 Identity/non-Identity and a hash-pinned vendored CFF/OTF; deterministic fixture builds; `textCorpus` + `g02FontFixtures` |
| G-03 | Golden export harness | I | `test/golden.ts` adds rotation, text fingerprints, pdf-lib/pdf.js reopen; `pnpm test:corpus` |
| G-04 | Validated job-level strategy | R | `TextEngineStrategy` validation + `native-only` refusal tests |
| G-05 | Guardrail scripts | I | `tests/guardrails.mjs` scans logs, drafts, off-origin URLs, OCR vendoring and registry truth; `pnpm test:guardrails` runs the scan plus planted negative self-tests in CI |
| F-01 | Fontkit + document-font embedding | I | `@cantoo/fontkit` 2.0.12, `fontPrograms.ts`, TTF + CFF/OTF round-trip tests, `font-substituted` receipt, fontkit-in-worker bundle gate |
| E-00 | Object role discriminator | R | typed roles, redaction filter, `role === 'redaction'` tests |
| E-01 | Pen / ink | I | vector ink, round caps, 5,000-point cap, `lib/ink.ts`, E2E draw/undo |
| E-02 | Check / cross | I | one object, two segments, one undo step; redaction count stays zero |
| E-03 | Date stamp | I | editable text object, en-GB long date, `lib/stamp-date.ts` |
| E-04 | Stamp presets | I | seven presets, editable label/colour/size, redaction isolation |
| E-05 | Signature crop/aspect/upload | I | luminance→alpha, trimmed capture, IHDR aspect, `signature-upload` E2E |
| E-06 | Fit page, percent, 400% | I | 25-400%, typed readout, fit width/page, `lib/zoom.ts` |
| E-07 | Snap guides + Alt | N | pure `lib/snap.ts`, 6 px threshold, guides only while snapped, Alt bypass |
| E-08 | Object clipboard + clamp | R | Ctrl/Cmd+C/X/V, offsets, `lib/object-placement.ts` |
| E-09 | Insert pages | I | compose + remap objects/paragraphs/pages; E2E appends a page |
| E-10 | Rail/inspector capability truth | I | registry-driven rail with exact workspace lists, no dead capability metadata, `editor-rail` E2E walks every entry, capability copy is explicitly "as inspected" with a snapshot note |
| T-01 | Revert paragraph | I | reverse edit + records in snapshot; `text-ux` edit→revert→export |
| T-02 | Move paragraph | I | native reflow origin follows the dragged object; extraction x/y asserted |
| T-03 | Detection details | I | `editor-paragraph-details.tsx`, copy/back/edit/revert |
| T-04 | Outline detected text | R | debug block/paragraph/line layer, pointer-transparent, off by default |
| T-05 | Inline editing legibility | I | transparent editor, per-line covers, caret, screenshot alignment |
| T-06 | Formatting reaches native | I | native size/colour/bold/italic/align/rotation; fallbacks receipted |
| T-07 | Rotate text block | I | numeric + 15° steps + 0/90/180/270; E2E extracts at -90° |
| S-01 | Find engine | I | dependency-free folding, overlap, whole-word, snippets, RTL-safe replace |
| S-02 | Find UI | I | Ctrl+F, toggles, count, jump list, Escape ownership, 40-page budget |
| S-03 | Draft autosave | I | IndexedDB v4, 60 MB cap, debounce, strict restore, `resetTo` baseline |
| S-04 | Restore/discard banner | I | restore survives reload and first undo; discard survives reload |
| S-05 | Error taxonomy | I | `empty`, `not-a-pdf`, `out-of-memory` with own copy; negative controls |
| S-06 | Data-loss guards | I | in-app leave sheet, beforeunload, draft guard and a data-router `useBlocker` for browser Back/Forward; `editor-cancel-save` proves cancel and confirm |
| C-01 | Lexer + emitter v2 | I | byte-identical tokenise→emit, inline images, byte ranges, fuzz |
| C-02 | Metrics, ToUnicode, AFM | R | Type0 `/W`, simple `/Widths`, Type3 matrix, base-14 AFM, reliable flag |
| C-03 | Per-glyph removal | I | only the owning show run rewrites; glyph quads; duplicate needle refused |
| C-04 | Advance compensation | I | negative `TJ` kerns, `Tj→TJ`, `'`/`"` line moves, four decimals |
| C-05 | Partial-run deletion | I | `singleRunDeletion` routes one-line word deletion through surgery |
| C-06 | Stream isolation | I | `q…Q` wrapper, flate, `/Contents` array, no unclosed-clip leak |
| C-07 | Leftover-cover policy | I | fill/image walker, paper colour, glyph box, skipped on panels/images |
| C-08 | `Tz` fit + word-by-word | I | 40-250%, readable band, squeezed advances, space fallback |
| C-09 | Raster-word fallback | I | local render, bounded 6×/4 MP, PNG embed, `glyph-rasterised` |
| C-10 | Rotated glyphs | I | 90/180/270 stream quads and native rotation around one pivot |
| C-11 | Ink colour sampling | I | 720 px render, paper/ink distance, strongest 40% averaged |
| C-12 | Post-write verification | I | rotation, untouched-page fingerprints, discard a failed rewrite |
| C-13 | Edit coverage invariant | I | no-outcome refusal, coverage warning, geometry validation |
| C-14 | XObject/Type3/inline honesty | I | explicit `stream-incomplete`, inline images parsed, no silent rewrite |
| O-01 | Scan affordance | I | explicit read page/pages banner; no automatic OCR |
| O-02 | Text-layer-only OCR | I | `ocr/textLayer.ts`; pages keep objects, fonts, annotations, metadata |
| O-03 | OCR layout + confidence | P | per-page mean, words, lines, proximity paragraphs, 40 blocks; not a layout-engine claim |
| O-04 | Provenance + banner | I | session confidence, OCR paragraphs editable, honest reload copy |
| O-05 | Cache, teardown, privacy | I | lazy recognizer, terminate in `finally`, same-origin tessdata, zero egress E2E |
| X-01 | Warning registry | N | typed `WarningCode`, dedupe by code+detail, 40 cap, legacy accessor |
| X-02 | Receipt stats | I | real `EditStats`, object-only and OCR-only receipts, no contradiction |
| X-03 | Untouched fingerprints | I | part of the artifact gate, one knowingly acceptable class |
| X-04 | Metadata + document objects | I | creator/producer/subject/keywords/dates; outline/page labels/forms in-place |
| X-05 | Download guard | I | no-change save disabled with explanation; keyboard/mobile guarded |
| X-06 | Progress/cancel assertion | I | opt-in pool stats; cancel terminates worker, edits survive |
| H-01 | Keyboard parity + registry | I | one `lib/editor-shortcuts.ts` drives handler, sheet and rail; E2E every tool + find/copy/duplicate |
| H-02 | Accessibility for new controls | I | roving tool tabindex, live regions, neutral focus/guide/caret; axe for find, paragraph editor, ink, phone sheet |
| H-03 | Editor performance ceilings | N | `test/editorBench.test.ts` + `tests/benchmarks/editor-ceilings.md`, CI step |
| H-04 | Fuzz lexer/emitter | N | seeded mulberry32 fuzz, byte identity, bounded planning, named CI step |
| H-05 | Firefox + Safari | I | `test:e2e:cross-browser` runs Chromium/Firefox/WebKit and records feature probes; `docs/CROSS-BROWSER.md` |
| H-06 | Touch/mobile pen/snap/find | I | pointer capture, palm rejection, touch-action, bottom-sheet find, `test:e2e:editor-touch` |
| H-07 | Help copy | I | `TOOL_HELP`/`TOOL_LIMITS`, tooltip copy, generated shortcut sheet, text-tool hint fixed |
| H-08 | Parity report | this file | linked from `README.md`; every row names evidence |

## Invented, not ported

- Direct-manipulation selection chrome: thin neutral box, attached move grip and
  side dots. The target showed the pattern; the implementation is ours.
- Keyboard registry and generated sheet, coded warning registry, editor
  ceilings, cross-browser record, touch/palm-rejection suite.
- The whole-document "Document details" drawer is explicit instead of a
  permanent empty inspector.

## Declined

| Item | Why |
| --- | --- |
| Reference editor shell | dead model fields, silent edit loss, no cancel, single page |
| Reference export cancel/validation | worse than ours; self-attested `opens:true` |
| Microsoft Clarity / CDN assets | privacy and supply chain |
| Whiteout as redaction | text remains; our whiteout says it is cosmetic |
| Metadata clobbering | we preserve it |
| `?` for missing glyphs | warned raster fallback instead |
| Main-thread export | workers stay |
| Shape-based redaction marks | explicit role required |
| Automatic OCR on load | user-initiated, local, disclosed |

## Remaining risk

| Risk | Mitigation / status |
| --- | --- |
| G-02 Type3/non-Identity shapes are readable but not rewritable | Type3 is read and extracted, then refused for stream rewriting; a non-Identity CMap reports `reliable:false` and is never guessed |
| G-05 has no pixel-table vision gate | the script gate covers logs, drafts, egress, OCR vendoring and registry truth; page pixels remain region assertions, not a screenshot corpus |
| F-01 embedded/custom face creation still overlays | receipt names `font-substituted`; the CFF/OTF programme is embedded when reproducible, not claimed as in-place creation |
| E-10 capability truth is snapshot-based | every per-page status says "as inspected" and the panel carries the snapshot note; no permanent document promise |
| S-06 browser back/forward | closed 2026-11-23: data-router `useBlocker` stops history traversal with the leave sheet; cancel restores, confirm proceeds |
| S-06 test hygiene | `smoke` now writes generated `smoke-alpha.pdf`/`smoke-beta.pdf`, not the tracked `alpha.pdf` |
| O-03 paragraph counts are proximity summaries | copy says so; confidence is session-local |
| X-04 composition preserves metadata/dates, not outlines/labels | in-place export preserves them; recomposition does not claim to |
| Touch tests use a Chromium phone profile | a physical iOS/Android pass is still the right next check |
| Firefox/WebKit results depend on installed Playwright binaries | the script records SKIP rather than claiming a pass |
