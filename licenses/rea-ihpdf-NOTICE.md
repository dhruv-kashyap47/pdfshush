pdfshush — `rea ihpdf` reference provenance
===========================================

`rea ihpdf/` is an owner-supplied, clean-room reference implementation of the
observable behaviour of `ihatepdf.cv/edit-pdf-text`, plus its own research
notes and retained third-party bundles. The source project ships no licence
file. The pdfshush project owner has explicitly authorised copying from it.

Copy policy (reaTask.md D10, 2026-11-17): **hybrid**.

- Pure algorithms (for example a content-stream lexer, font-metric resolver,
  OCR word-to-block grouping, signature crop) may be copied verbatim. They must
  carry the derived-code header and a ledger row below.
- Anything that touches pdfshush's engine, job contract, editor state or UI is
  rewritten in pdfshush style, even when the behaviour is taken from the
  reference.
- No target-site branding, assets, analytics or proprietary code is copied.

Three provenance categories are kept separate
----------------------------------------------

(a) **Studied, not copied.** The retained target bundles under
    `rea ihpdf/research/ihatepdf/assets/` were read for observed behaviour
    (for example the argument-stack parser and the removed-advance kerning).
    They are not copied into pdfshush.

(b) **Copied.** Reference files or algorithms moved into pdfshush. Each copied
    file carries the header below and appears in the ledger.

(c) **Generated data.** Tables derived from specifications or tools, for
    example AFM widths generated from pdf-lib's standard fonts. The generator
    is recorded in the ledger; the table is not a copy of the reference table.

Derived-code header
-------------------

    Derived from rea ihpdf/<path> (owner-authorised); modified for pdfshush.

The header must stay on the file. `pnpm test:provenance` fails if a file
contains the header and its source path is missing from the ledger.

Ledger
------

No copied code has landed yet. Add one row per copied file or algorithm block.

| Date | Category | Source in `rea ihpdf/` | Destination in pdfshush | Changes | Covering test |
| --- | --- | --- | --- | --- | --- |
| — | — | — | — | — | — |
