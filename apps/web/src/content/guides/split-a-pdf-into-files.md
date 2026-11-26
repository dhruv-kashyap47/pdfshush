---
title: "How to Split a PDF into Separate Files (Windows and Mac)"
description: "Split a PDF into separate files on Windows or Mac: choose the boundary, split every page or a range, and keep file names in the right order."
slug: "split-a-pdf-into-files"
category: "How-to"
publishedAt: "2026-11-26"
updatedAt: "2026-11-26"
relatedTools:
  - split-by-pages
  - split-in-half
relatedGuides: []
draft: true
---

> **NEEDS HUMAN EDIT** — do not publish until every box is checked.
> - [ ] Verify: the current chunk options and part limit in the Split by pages tool (the UI accepts any whole number and caps the run at 200 parts) and the exact ZIP naming pattern on download.
> - [ ] Add: a screenshot of the finished ZIP with renamed, zero-padded files, plus the naming convention your office actually uses for scanned bundles.
> - [ ] Check: the statement about how each output file inherits bookmarks and page labels. The behavior depends on the splitting code and should be tested with a document that has a multi-level outline and roman-numeral front matter.

A ninety-page bundle lands in your inbox. One agency wants the first three pages, another wants the middle section, and the invoices need to go out as individual files. Splitting a PDF is easy. Splitting it at the right boundary, with names that sort correctly, is the part that goes wrong.

## Decide the boundary before you touch the file

Write the boundaries down before you open any tool. A sticky note with "1-3, 4-60, 61-90" is more reliable than deciding as you scroll, because a split produces new files and the original page numbers stop being visible.

The trap is that a PDF has at least two page numbering systems. The physical page index runs from 1 to the last page in the file. Page labels are what the viewer displays, and they can start at 1 on a cover, use roman numerals for front matter, or follow a custom scheme such as "A-1." A file with twelve physical pages can display "Page 1 of 10" because the first two pages are labeled differently.

Always count physical pages from the first page of the file when you choose a boundary. Use thumbnails, not the number printed at the bottom of the paper. A scanned report whose printed page 1 is actually the sixth image in the file will split in the wrong place if you trust the printed number.

## Split every page into its own file

This is the invoice, receipt, or signed-form case: one PDF contains many documents, and each page needs to travel separately.

1. Open [Split by pages](/tools/split-by-pages).
2. Add the PDF. The tool reports the total page count after it inspects the file.
3. Set the chunk size to 1. The tool shows how many files the split will create before you run it.
4. Run the split and download the ZIP archive.
5. Extract the archive into a new folder, not into the folder that holds the original.
6. Compare the number of extracted PDFs with the page count you noted. If they differ, stop and check before sending anything.

The same tool handles fixed-size chunks. Set the chunk size to 5 for five pages per file, or 10 for ten. That is useful for study packs, meeting minutes, and portals that limit how many pages a single upload may contain. Very large page counts produce many parts, so the tool caps a run at 200 files. If you need more, split in two passes.

There is a manual macOS alternative for one or two pages. Open the PDF in Preview, choose **View > Thumbnails**, select a single thumbnail, and drag it to the Desktop or into a Finder folder. Preview writes that page out as a new PDF. Repeat for each page. It works, but it does not scale, and the file names are generated for you.

Windows has no equivalent built-in gesture. Edge can print a page range to PDF, one range at a time, which re-renders the page and loses links. For anything more than a couple of pages, a browser tool is faster and keeps the original page content.

## Split at page ranges

Chunk splitting cuts at fixed intervals: every page, every five pages, every ten. Real documents rarely divide that evenly. A contract may need pages 1-3, 4-11, and 12-14, with a different recipient for each.

For a handful of ranges on a Mac, Preview is the most direct tool:

1. Open the PDF in Preview and show thumbnails with **View > Thumbnails**.
2. Click the first page of the range, then **Shift-click** the last page to select the whole range.
3. Drag the selection to a Finder folder. Preview creates a new PDF containing just those pages.
4. Rename the new file immediately, while you still remember which range it holds.
5. Repeat for each range. Keep the original open so you can confirm the boundaries.

For many ranges, or on Windows, split the document into single pages first, then regroup. That sounds like extra work, but it gives you a clean set of one-page files that you can combine in any order. The alternative, deleting pages from a copy of the whole document for each output, is slower and easier to get wrong.

When you specify ranges, check whether the endpoints are inclusive. In most tools, "4-11" means pages 4 and 11 are both included, which is seven pages. Confirm the count before you download. Overlapping ranges create duplicates, and a gap quietly drops a page.

## Split in half

"Split in half" means two different things, and the tool you need depends on which one you mean.

The first meaning is a document divided into two files at the midpoint. For a 40-page report, that is pages 1-20 and 21-40. With a chunk tool, set the chunk size to half the page count. If the page count is odd, decide whether the extra page belongs to the first or second file, and write that down. Do not split between a heading and the text that follows it just because the math lands there. Pick a section boundary and adjust the chunk size or use ranges instead.

The second meaning is a scanned book spread. One PDF page contains two facing pages, so every page is twice as wide as it should be. Reading it on a phone means zooming and panning, and printing it wastes half a sheet. [Split in half](/tools/split-in-half) cuts every page down the middle and produces two documents: one with the left halves and one with the right halves. A horizontal option handles top-and-bottom layouts, such as a form scanned with two receipts on one sheet.

1. Open [Split in half](/tools/split-in-half).
2. Add the two-up PDF. The tool rejects password-protected files, so unlock first if needed.
3. Choose **Vertical (left / right)** for a book spread or **Horizontal (top / bottom)** for a stacked layout.
4. Run the cut and download the ZIP.
5. Open both outputs. Each file contains every other page of the book: one holds the left-hand pages, the other holds the right-hand pages.
6. If you need a single document in reading order, interleave the two halves with an alternate-and-mix step. If you only needed to trim blank margins from a one-sided scan, keep the half that contains the content.

Do not use the two-up cut on an ordinary single-page-per-sheet document. It will slice every page in half and produce two unreadable files. Check the page dimensions first: a two-up scan is usually much wider than it is tall, or much taller than it is wide.

## Keep file names sortable

A split produces names like `document-1.pdf`, `document-2.pdf`, and `document-10.pdf`. Sorted alphabetically, page 10 lands between pages 1 and 2. Anyone assembling the files later will get the order wrong.

Use zero-padded numbers that match the highest part count. For fewer than 100 parts, two digits are enough: `lease-01.pdf`, `lease-02.pdf`, `lease-10.pdf`. For 100 or more, use three digits. Keep the base name identical across the set and put the number at the end, where sorting tools expect it.

Avoid spaces, parentheses, and the word "final." A name like `Smith application final FINAL (2).pdf` is hard to sort, hard to search, and easy to confuse with an earlier version. Use a date in ISO form if the set is versioned: `statement-2026-11-01-01.pdf` sorts by date and then by part.

If the ZIP extracts into a folder with a generic name, rename the folder to match the set before you file it. When a portal asks you to upload parts one at a time, the sortable name is the only thing keeping the order straight.

## What happens to bookmarks, links, and page labels

Splitting rebuilds the document structure, and not every tool rebuilds it the same way.

Bookmarks are outline entries that point at page objects. When a document is split, a tool can copy the entries that fall inside each new file, drop the outline entirely, or leave every entry pointing at the original page index. The third case is the dangerous one: the bookmark panel looks populated, but clicking an entry jumps to the wrong page or does nothing.

Internal links have the same problem. A link on page 2 that jumps to page 70 cannot work in a file that now ends at page 20. Some tools rewrite the link to the new location if both pages landed in the same output; many simply leave a dead link. External web links usually survive intact.

Page labels are metadata, and they often reset. A file that displayed "i, ii, 1, 2" may come out of a split displaying "1, 2, 3, 4," with the roman numerals gone. That is cosmetic until someone cites "page iii" in a covering letter and the recipient cannot find it.

After splitting, do three checks:

1. Open each output and look at the page count. It should match the range you intended.
2. Open the bookmarks panel and click two entries per file. If the outline is wrong, rebuild it or remove it rather than shipping a broken one.
3. Check the page label shown in the viewer against the number printed on the page. If they disagree, decide whether to fix the labels or warn the recipient.

## After the split: a short verification routine

1. Keep the original PDF untouched in its own folder until every output has been opened.
2. Count the files and compare with the expected part count.
3. Open the first and last page of every file that will be sent externally.
4. Check for pages that were duplicated at a boundary or dropped between ranges.
5. Rename the set with zero-padded numbers before uploading or emailing.
6. Record the ranges in a small text file or in the covering email, so the recipient knows what each part contains.
7. If the files will be rejoined later, test that the merge produces the original page sequence.

## Common mistakes

- Splitting on the printed page number instead of the physical page index.
- Setting a chunk size that cuts through the middle of a section because the number looked neat.
- Overlapping ranges, which duplicate pages, or gaps, which lose them.
- Using the two-up cut on ordinary pages and destroying the layout.
- Splitting a password-protected PDF without unlocking it first. Most tools refuse the file outright.
- Deleting the original before the outputs are verified.
- Leaving browser-generated names such as `split (1).pdf` in place.
- Forgetting that a split form can duplicate field names across files, so values collide if the files are merged again.

## When this fails

If the tool rejects the file, check for password protection and permissions first. A PDF that opens without a password can still be encrypted with an owner password that blocks editing and splitting.

If the output page count is wrong, the range syntax is the usual cause. Try a single range first, confirm the count, then add the rest. If a range produces an empty file, the start page was probably after the end page.

If a large scan takes too long, the browser may be running out of memory. Split the job into two smaller documents, or work on a desktop rather than a phone. Splitting does not reduce image size, so a 300 MB scan stays large in every output.

If the split pages look blank, open the original in another viewer before blaming the split. A malformed source can render in one application and not another, and the split simply copied the problem.

## Related reading

- [Split PDF by pages](/tools/split-by-pages)
- [Remove pages from a PDF](/guides/remove-pages-from-pdf)
