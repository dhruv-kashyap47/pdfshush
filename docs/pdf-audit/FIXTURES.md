# PDF audit — fixture corpus

Two kinds of fixture are used:

1. **Generated** — committed under `tests/fixtures/pdf-audit/`, produced
   deterministically by `generate.mjs` (no timestamps, no randomness; re-running
   reproduces byte-identical files).
2. **Reused** — already committed elsewhere in the repo. These are referenced by
   path rather than duplicated, so the audit does not grow the repo with copies
   of large binaries. Provenance is recorded below.

Regenerate the generated set:

```powershell
node tests/fixtures/pdf-audit/generate.mjs
```

Rendering references used by `packages/pdf-core/test/render-regression.test.ts`
live in `packages/pdf-core/test/pdf-audit/render/`. They are PNG renders of the
fixtures at fixed scales (1x, and 2x where the orientation/crop is the point):
`tiny-1page`, `rotated-90` pages 1–2, `cropbox-offset`, `nonembedded-rtl-arabic`,
`image-only` and `acroform`. `nonembedded-cjk` deliberately has **no** reference:
it currently renders `.notdef` boxes (finding `PDF-RENDER-003`, needs decision),
so the suite carries a known-failing repro instead of enshrining the wrong
pixels. Regenerate references only for a deliberate rendering change, look at
them first, and commit them in the same change that proves the new output.

Validation facts were observed with
`node docs/pdf-audit/.baseline/validate-fixtures.mjs`, which loads every fixture
through both `@cantoo/pdf-lib` and `pdfjs-dist` (legacy build, the same
configuration the app uses: `isEvalSupported: false`, `disableFontFace: true`).
The table quotes what those loaders reported, not assumptions.

## Generated fixtures

| File | Bytes | What it exercises | Observed with pdf-lib | Observed with pdf.js |
| --- | --- | --- | --- | --- |
| `tiny-1page.pdf` | 1304 | Smallest happy path; one page, one line, standard non-embedded Helvetica. | 1 page, 595×842 | 1 page, text `pdfshush audit fixture — page 1 of 1` |
| `multi-5page.pdf` | 3457 | Page identity and order. Each page has a unique marker (`Distinct marker A1`…`E5`). Also the base for the truncated fixture. | 5 pages | 5 pages; page 1 text ends `Distinct marker A1`, page 2 `B2`, page 3 `C3` |
| `long-120page.pdf` | 63114 | 100+ page documents; per-page numbering (`PAGE-NUMBER-1`…`120`) for split/reorder/thumbnail checks. | 120 pages | 120 pages |
| `rotated-90.pdf` | 1932 | Page rotation. Page 1 `/Rotate 90`, page 2 `/Rotate 0`; a red probe and `ROTATED-90` text sit at known PDF coordinates. | page 1 rotate = 90 | page 1 rotate = 90; text extracted `ROTATED-90` |
| `cropbox-offset.pdf` | 1457 | Non-zero `CropBox` origin. `MediaBox` 612×792, `CropBox` x=50 y=40 w=500 h=700. Probes at the crop origin and top-right. | crop 50,40,500,700; media 0,0,612,792 | view `[50, 40, 550, 740]`; both probes extracted |
| `metadata.pdf` | 1558 | Info-dictionary round-trip: Title, Author, Subject, Keywords, Creator, Producer, fixed dates. | all six fields present | all six fields present |
| `acroform.pdf` | 9548 | AcroForm widgets: text field (filled), checkbox (checked), radio group (selected), dropdown (selected), option list (selected). | 5 fields: `PDFTextField`, `PDFCheckBox`, `PDFRadioGroup`, `PDFDropdown`, `PDFOptionList`; 6 widget annots | `IsAcroFormPresent: true`; 6 `Widget` annots |
| `annotations.pdf` | 2679 | Annotation subtypes: Highlight, Square, FreeText, Link (URI). | 4 annots on page 1 | `Highlight`, `Square`, `FreeText`, `Link` |
| `image-only.pdf` | 2056 | Scanned-style page: one PNG, no text layer. | 1 page, no text | 1 page, extracted text is empty |
| `nonembedded-cjk.pdf` | 1959 | Type0/CIDFontType0 CJK font (`STSong-Light`) with **no `FontFile`**, plus an explicit `ToUnicode` CMap. Text `你好，世界`. Models the common real-world case where the viewer must substitute a font. | 1 page | text extracts as `你好，世界` |
| `nonembedded-rtl-arabic.pdf` | 1973 | Type0 font (`Tahoma`) not embedded, `ToUnicode` CMap, Arabic stored in logical order (`مرحبا بالعالم`). | 1 page | extracts as `ابحرم| |علاب` — pdf.js returns bidi-reordered runs, not the logical string. Useful for asserting extraction order explicitly. |
| `corrupt-truncated.pdf` | 2074 | `multi-5page.pdf` cut at 60% of its bytes: xref is gone, cross-reference recovery required. | recovers **3 of 5** pages by scanning | throws `Invalid PDF structure.` |

### Notes on the generated fixtures

- Standard-14 fonts (`Helvetica`) are intentionally **not embedded** in the
  text fixtures, which mirrors most real uploads.
- The CJK/RTL fixtures have no embedded font at all. That is deliberate: they
  exercise the fallback path, and they carry no font-licensing obligation.
- `corrupt-truncated.pdf` exposes a real loader divergence: pdf-lib repairs and
  returns a partial document while pdf.js rejects it outright. That behaviour is
  recorded as data, not as a finding.
- RTL extraction order is pdf.js's bidi ordering. Do not treat
  `ابحرم| |علاب` as corrupted text when writing assertions.

## Reused fixtures (referenced, not copied)

| Path | Bytes | Role in this audit | Provenance |
| --- | --- | --- | --- |
| `packages/pdf-core/test/corpus/real/irs-1040.pdf` | 220237 | **Linearized** real-world PDF (`/Linearized` present in the header; `IsLinearized` is the pdf.js metadata flag to assert). | Committed corpus, see `packages/pdf-core/test/corpus/real.ts`. |
| `packages/pdf-core/test/corpus/real/arxiv-1409.0473.pdf` | 444482 | Dense multi-font academic paper; text extraction and layout realism. | Committed corpus, see `packages/pdf-core/test/corpus/real.ts`. |
| `packages/pdf-core/test/corpus/real/arxiv-1810.04805.pdf` | 775166 | Second dense paper; cross-document regression checks. | Committed corpus, see `packages/pdf-core/test/corpus/real.ts`. |
| `packages/pdf-core/test/fixtures/encrypted-aes128.pdf` | 1268 | **User-password** encrypted, AES-128, user `shush123`, owner `owner-secret`. | Generated by `scripts/make-encrypted-fixtures.py`; the same bytes are embedded in `packages/pdf-core/test/encryptedFixtures.ts`. |
| `packages/pdf-core/test/fixtures/encrypted-owner-only.pdf` | 1268 | **Owner-only** encryption (empty user password, prints/copies restricted). | Same script / module as above. |
| `tests/benchmarks/.corpus/malformed.pdf` | 364 | Hard-corrupt input, smaller than the truncated fixture. | Benchmark corpus. |
| `tests/benchmarks/.corpus/empty.pdf` | 0 | Zero-byte upload. | Benchmark corpus. |
| `tests/benchmarks/.corpus/many-pages-2000.pdf` | 565048 | 2000 pages, for long-document ceilings. | Benchmark corpus. |
| `tests/benchmarks/.corpus/oversize-200mb.pdf` | 209715216 | Upload-size ceiling. Not loaded by repros. | Benchmark corpus. |
| `tests/e2e/fixtures/ocr-scan.pdf` | 61107 | Real scanned document with no text layer, for OCR paths. | E2E fixture. |
| `tests/e2e/fixtures/ocr-encrypted-owner.pdf` | 61894 | Owner-restricted scan: OCR must still be reachable where permitted. | E2E fixture. |
| `tests/e2e/fixtures/ocr-password.pdf` | 61894 | Password-protected scan; unlock is required before OCR. | E2E fixture. |
| `tests/e2e/fixtures/forms-e2e.pdf` | 880 | Small AcroForm doc used by the existing forms e2e. | E2E fixture. |
| `tests/e2e/fixtures/with-image.pdf` | 738 | Page mixing text and an image. | E2E fixture. |

## Coverage against the audit checklist

| Category | Fixture |
| --- | --- |
| Tiny | `tiny-1page.pdf` |
| Multi-page | `multi-5page.pdf` |
| 100+ pages | `long-120page.pdf`, `many-pages-2000.pdf` |
| Scanned / image-only | `image-only.pdf`, `ocr-scan.pdf` |
| Rotated | `rotated-90.pdf` |
| CropBox / MediaBox mismatch | `cropbox-offset.pdf` |
| Non-embedded fonts | `tiny-1page.pdf` (Helvetica), `nonembedded-cjk.pdf`, `nonembedded-rtl-arabic.pdf` |
| CJK | `nonembedded-cjk.pdf` |
| RTL | `nonembedded-rtl-arabic.pdf` |
| AcroForm | `acroform.pdf`, `forms-e2e.pdf` |
| Annotations | `annotations.pdf` |
| Metadata | `metadata.pdf` |
| User-password encrypted | `encrypted-aes128.pdf`, `ocr-password.pdf` |
| Owner-only encrypted | `encrypted-owner-only.pdf`, `ocr-encrypted-owner.pdf` |
| Corrupt / truncated | `corrupt-truncated.pdf`, `malformed.pdf`, `empty.pdf` |
| Linearized | `irs-1040.pdf` |
| Oversize | `oversize-200mb.pdf` (not loaded) |
