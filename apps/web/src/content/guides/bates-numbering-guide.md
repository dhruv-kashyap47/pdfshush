---
title: "Bates Numbering for Legal Documents: A Practical Guide"
description: "Bates numbering for legal teams: how to choose a prefix, start number and position, number a merged production, and avoid the errors that get files rejected."
slug: "bates-numbering-guide"
category: "Legal & compliance"
publishedAt: "2026-11-26"
updatedAt: "2026-11-26"
relatedTools:
  - bates-numbering
  - combine-pdf
relatedGuides: []
draft: true
---

> **NEEDS HUMAN EDIT** — do not publish until every box is checked.
> - [ ] Verify: the exact Acrobat menu path (Tools > Bates Numbering > Add) against the current version, and the numbering controls and labels in our own Bates Numbering tool.
> - [ ] Add: a screenshot of a stamped page showing the number position, plus one real production range log with the case details removed.
> - [ ] Check: the statements about local rules, standing orders and confidentiality designations. Confirm them against the jurisdictions you actually serve before publishing.

A production is due at noon. Two vendors have already scanned the files, one paralegal merged them in a hurry, and the first page of the combined PDF is stamped 000001 while the fourth document in the stack also starts at 000001. The clerk's office rejects it, or worse, accepts it and the other side spends the afternoon arguing that your production is unreliable.

Bates numbering is one of the few parts of document production that is entirely mechanical. It is also one of the easiest to get wrong, because the mistakes are invisible until someone checks.

## What Bates numbering actually does

Bates numbering stamps a unique, sequential identifier on every page of a production. The classic format is a short prefix followed by a zero-padded number, placed in the same spot on every page:

`ACME000001`, `ACME000002`, `ACME000003`

The number is not a page number in the usual sense. It does not restart at 1 for each document and it does not reset when the topic changes. The whole production shares one sequence, so any page can be cited as "ACME004517" and everyone can find it without describing the document.

That single property is the point. A Bates number gives every page a stable address. It survives merging, splitting, renaming and re-scanning. When a witness is asked about a page, the transcript can cite the number. When a production is supplemented later, the new pages continue the sequence instead of colliding with the old ones.

## Who asks for it

You will see Bates numbers requested in several settings, and the specific rules come from the forum rather than from a single national standard:

- **Civil litigation.** Discovery productions are commonly numbered, and many courts address the format in local rules, standing orders or a scheduling order. Some judges require it; some merely expect it. Check the order in your case rather than assuming.
- **Insurance claims and subrogation.** Claim files exchanged between carriers are often numbered so that individual pages can be referenced in correspondence and in claim notes.
- **Loan files and mortgage servicing transfers.** Large file transfers frequently use a Bates-style identifier so that a page can be traced back to a specific loan and custodian.
- **Medical record productions.** Records exchanged in personal injury and workers' compensation matters are often numbered so that treaters and dates of service can be cited precisely.
- **Government investigations and regulatory responses.** Submissions frequently require a sequential identifier and a production log.

The format itself is usually negotiable. The requirement that every page has one unique number is not.

## Choosing the four settings

Most numbering tools ask for the same handful of choices. Decide them before you start, because changing a prefix halfway through a production is far more work than choosing it correctly once.

### Prefix

The prefix should identify the source or the production without being cryptic. Common choices are a party abbreviation, a custodian code, a case short name or a vendor code. Keep it short, use uppercase letters and digits, and avoid spaces, slashes and punctuation that can break a file name or a load file.

If you are producing for several custodians, a per-custodian prefix is easier to audit than one shared prefix, but it makes the numbering look segmented. Many teams use a single prefix for the whole case and record custodian ranges in a log instead. Either approach works if it is consistent and documented.

Do not put a date, a version number or the word "final" in the prefix. Those things change, and they make the identifier unstable.

### Starting number

Start at 1 unless you have a reason not to. Continuing from a prior production is the main reason: if the last page of the previous production was ACME004200, this one starts at ACME004201. Starting over at 1 creates duplicate identifiers across the case, which is the exact problem Bates numbering exists to prevent.

If a prior production used a different prefix, do not silently continue that sequence with a new prefix. Either keep the old prefix or start a clearly separate sequence and note the break in the log.

### Digits and padding

Padding keeps the numbers the same width, which keeps them aligned and sortable. Six digits is common for a production that will stay under a million pages; seven or eight is safer for very large matters. The number of digits should be fixed for the whole production. If you start with four digits and the production grows past 9,999, the identifiers change width mid-stream and sorting breaks.

Estimate the total page count first, then add a margin. Choosing eight digits costs nothing and avoids a rebuild later.

### Position and margin

The usual position is the bottom right corner, inside the printable area. Bottom center and top right are also common. What matters is that the number appears in the same place on every page, does not overlap text, and stays clear of the binding edge.

Leave at least half an inch from the paper edge and check pages with footers, signatures or stamps that already occupy that space. A number printed over a notary's seal or a date stamp creates a legibility problem that will be raised later.

Set the font size large enough to read on a printed page and in a scan, but small enough not to dominate. Ten or eleven point in a plain font is typical. Check one page at 100 percent zoom before you commit to the whole run.

## Numbering a merged production

The order of operations matters more than any individual setting.

1. **Collect every file.** Get the complete set from each custodian before you begin, including exhibits, attachments and cover letters that will be part of the production.
2. **Deduplicate first.** Identify exact duplicates and near-duplicates and decide which copy is the production copy. Numbering before deduplication means you will either produce duplicates with different numbers or pull numbered pages and leave gaps.
3. **Decide the order.** Chronological, by custodian, by document type or by exhibit number are all defensible. Write the order down. The other side will ask why document 14 sits between documents 3 and 9.
4. **Combine the files into one working PDF.** Use [Combine PDF](/tools/combine-pdf) so that the page order you chose is the page order that gets stamped.
5. **Number once, continuously.** Apply [Bates Numbering](/tools/bates-numbering) to the combined file with the prefix, start number, digit count and position you settled on. Do not number the individual files first and then merge them. In Adobe Acrobat Pro, the equivalent command is under Tools > Bates Numbering > Add.
6. **Record the ranges.** For each document, log the title, the first Bates number and the last Bates number. This range log is the index everyone will use later.
7. **Verify the output.** Spot-check the first and last page of every document, confirm the total page count matches the combined file, and search the prefix to make sure no page was missed.

If the production includes documents that arrived already numbered from a prior production, do not stamp over the old number. Leave the existing number in place, add the new number in a different position, and note both in the log. Double-stamping in the same corner makes both numbers hard to read.

## Exhibits, confidentiality and supplemental productions

Exhibits are usually numbered as part of the continuous production rather than as a separate sequence. A separate exhibit sequence sounds tidy, but it creates two identifiers for the same page and invites citation errors.

Confidential pages get the same Bates number as everything else. Confidentiality is a designation, not a numbering scheme. If a page is later pulled from the production, the number is not reused; the range simply has a gap, and the log explains why. Renumbering to close the gap is worse than leaving it, because every citation made before the change becomes wrong.

Supplemental productions continue the sequence. They get their own range log entry, their own date and their own cover note. Never renumber an earlier production to make room.

## Common mistakes

- **Numbering before deduplication.** You end up producing the same document twice under two numbers, or leaving holes where a duplicate was removed after stamping.
- **Restarting at 1 for each document.** The production loses its shared address space, and page citations become ambiguous.
- **Numbering each file separately and merging afterward.** The sequence jumps backward at every file boundary.
- **Skipping exhibits or attachments.** The body is numbered and the exhibit tabs are not, so the exhibit cannot be cited.
- **Stamping in the binding margin.** The number disappears into the gutter when the production is printed and bound.
- **Stamping over existing content.** Dates, signatures and prior numbers become unreadable.
- **Changing the prefix or digit count mid-production.** Sorting and cross-referencing break, and the other side notices.
- **Failing to keep the range log.** The numbers exist but nobody can map them back to documents without opening every file.
- **Renumbering after a page is pulled.** Earlier citations become wrong, which is worse than a gap.

## Checking the output before it goes out

A five-minute check catches nearly every numbering error:

1. Open the production and confirm the first page carries the expected starting number.
2. Jump to the last page and confirm the final number equals the start number plus the page count minus one.
3. Check the first page of each document in the range log against the number recorded there.
4. Search for the prefix and confirm the hit count matches the total page count.
5. Print one page at actual size and confirm the number is inside the margin and legible.
6. Open the file in a second viewer. Some tools render stamps differently, and a number that looks fine in one application can be clipped in another.
7. Confirm the file name and the range log use the same prefix and dates.

If any check fails, fix the source and renumber the whole production. Patching a single page by hand creates a number that no log accounts for.

## When this fails

Very large productions can exceed the memory or page limit of a browser-based tool. Split the production into volumes, number each volume as a separate sequence with its own prefix, and log the break. Do not split a volume in the middle of a document if you can avoid it.

Scanned pages that are rotated or have uneven margins can push the stamp off the page. Normalize orientation before numbering, then check a sample of landscape pages, which often need a different position than portrait pages.

Encrypted or permission-restricted files must be unlocked before stamping. A PDF that allows printing but not editing will reject the stamp even though it looks fine on screen.

If the recipient's system requires a specific format, such as a fixed number of digits or a particular position, get that requirement in writing before you begin. Rebuilding a numbered production is a day of work; asking is a two-minute email.

## Related reading

- [Bates Numbering](/tools/bates-numbering) — apply a continuous, padded identifier to a merged production.
- [How to Redact a PDF Properly](/guides/redact-a-pdf-properly) — finish redactions before the numbers are stamped, not after.
