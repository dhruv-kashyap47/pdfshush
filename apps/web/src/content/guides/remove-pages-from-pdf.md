---
title: "Remove Pages from a PDF Without Adobe"
description: "Remove pages from a PDF without Adobe: delete by number or thumbnail, catch page-label traps, and protect bookmarks and signed copies before you save."
slug: "remove-pages-from-pdf"
category: "How-to"
publishedAt: "2026-11-26"
updatedAt: "2026-11-26"
relatedTools:
  - delete-pages
  - organize-pdf
relatedGuides: []
draft: true
---

> **NEEDS HUMAN EDIT** — do not publish until every box is checked.
> - [ ] Verify: whether the Delete Pages tool exposes a page-number entry or only thumbnails in the current build, and whether it offers undo after a page is marked for removal.
> - [ ] Add: a screenshot showing a document whose displayed page label differs from its physical page index, with a note on how you confirmed the mismatch.
> - [ ] Check: the explanation of "hide from print" and optional content groups. The base PDF specification has no simple per-page print flag, and the wording should be reviewed so it does not imply one exists in every tool.

You scanned a thirty-page packet and got six blank backs. A contract arrived with two pages of exhibits you were told to drop. Deleting pages sounds trivial until you remove the wrong one, or the page numbers shown in the file do not match the numbers printed on the paper.

## Delete by page number or by thumbnail

Both methods work, and they fail in different ways.

Deleting by page number is fast when you already have a list, such as "remove 4, 5, and 12." The risk is that the number you type is not the number the tool counts. A viewer may show page labels, physical indices, or a mix, and a single off-by-one error shifts every deletion after it.

Deleting by thumbnail is slower but visual. You see the page you are about to remove, including the signature, the stamp, or the handwritten note that a page-number list would not reveal. For anything important, use thumbnails. For a long list of known blank pages, page numbers are fine only after you confirm how the tool counts.

A good compromise is to find the page by thumbnail, note its position in the filmstrip, and then confirm the count before deleting. If the tool shows a running total such as "3 of 30 selected," check that it matches what you intended.

## Why page labels lie

A PDF has two numbering systems. The physical index counts pages from the first page in the file: 1, 2, 3, and so on. Page labels are what the viewer displays at the top of the screen or in the page-number box. They can start at 1 on a cover, switch to roman numerals for front matter, or use a custom prefix such as "A-1."

A twelve-page file can display "Page 1 of 10" because the first two pages carry different labels. A scanned report can show "Page 7" on the page that is physically the ninth image, because the scanner added a cover and a separator sheet.

This is why "delete page 7" is an ambiguous instruction. Before you start, decide which numbering you mean and convert it to the physical index by counting thumbnails from the first page. Write the physical numbers down. If the document is long, use the thumbnail counter or a tool that displays both the index and the label.

The same trap applies after deletion. Removing a page does not always renumber the labels, so the file may still display "Page 7" on what is now the sixth page. Check the labels after saving, especially if anyone will cite page numbers in a covering letter.

## Delete pages with a browser tool

The [Delete Pages](/tools/delete-pages) tool copies the pages you keep into a fresh document. The original on your disk is not modified, which is the right default.

1. Put an untouched copy of the original in a separate folder. Do not work from the only copy.
2. Open the tool and add the PDF.
3. Switch to thumbnail view and scroll the whole document before selecting anything. You are looking for rotated pages, duplicates, and pages that look blank but are not.
4. Click each page you want to remove. Check the selection count against your list.
5. Review the remaining pages once more. It is easier to catch a misclick now than after download.
6. Run the deletion and download the result.
7. Rename it with a clear suffix such as `-edited`, then reopen it and check the page count, the first page, and the last page.
8. Keep the original until the recipient confirms.

If the tool offers undo, use it rather than starting over when you misclick. If it does not, remove the selection and rebuild it carefully.

## Delete a page range

Ranges are convenient and easy to get wrong. If you delete pages 12 through 18 from a 100-page file, you are removing seven pages, so 93 should remain. If the result has 94 pages, one page in the range was not selected. If it has 92, you removed one page too many.

Check three things before running a range deletion:

1. Whether both endpoints are inclusive. Most tools include the start and end page.
2. Whether the range is in physical index order, not page-label order.
3. Whether another range overlaps it. Overlapping ranges do not usually duplicate a deletion, but they make the count impossible to reason about.

For a long document, delete one range at a time and verify the page count between passes. It is slower, but it localizes a mistake.

## Remove blank pages from scans

Blank pages come from three places: duplex scanning where the back of a one-sided sheet is captured, separator sheets inserted by the scanner, and cover sheets that were never printed.

A page that looks blank in a thumbnail may not be blank. At 100 percent zoom, look for a stamp, a signature, a barcode, a page number, or faint handwriting. Scanners also produce a gray edge or a speck of dust that a thumbnail hides.

Be careful with pages that say "This page intentionally left blank." They are sometimes required for pagination, especially in legal and regulatory filings. Removing one can make the document non-compliant even though it looks cleaner.

Do not use automatic blank-page detection without reviewing its decisions. A detector that removes pages with little ink will happily remove a signature page, a cover with a small logo, or a page containing a single handwritten date. If you use it, review the flagged pages one by one before saving.

## Delete while preserving bookmarks

Bookmarks are outline entries that point at page objects. When you delete a page, one of three things happens to an entry that pointed at it:

- The tool drops the bookmark.
- The tool retargets the bookmark to the nearest remaining page.
- The tool leaves the bookmark pointing at the old index, so clicking it lands on the wrong page.

The third outcome is the most confusing because the outline looks intact. After any deletion, open the bookmarks panel and click every entry. Confirm that each one lands on the heading or section it names. If the document has a multi-level outline, check the nesting as well; some tools flatten it during a rewrite.

Deleting a page that carries a bookmark target is different from deleting an ordinary page. If the target page itself must go, decide where the bookmark should point before you edit, then fix the outline afterward. The [Organize PDF](/tools/organize-pdf) view is useful here because you can see thumbnails and reorder pages before committing, but it still deserves the same outline check.

There is a related risk with signed and certified PDFs. Removing a page changes the document bytes, which invalidates a digital signature or a certification seal. If the file has a signature, do not delete anything without understanding whether the signature must remain valid. In many workflows, a certified copy must be left alone and a separate working copy created.

## Delete versus "hide from print"

Deleting removes the page from the file. Anyone who opens the document will not see it, and the page content is gone from the saved copy.

Hiding keeps the page in the file but excludes it from some output. This is usually done with optional content groups, often called layers. A layer can be marked as not visible or not printable, so the page or its contents remain in the file for on-screen reference but do not appear on paper.

The distinction matters when the goal is "keep the internal notes with the file but do not send them to the client." Deleting the notes is permanent. Hiding them is reversible, which is both the advantage and the risk: anyone who opens the file can turn the layer back on.

The base PDF format does not provide a simple per-page "do not print" checkbox that every tool respects. Some authoring applications emulate the effect with layers or with separate output settings. If a document must never print a page, the reliable approach is to produce a separate print copy with the page removed, rather than trusting a visibility flag.

Do not confuse deleting with cropping. Cropping changes the visible area of a page; the content outside the crop box may still be in the file and can be recovered with another tool. If the content is sensitive, cropping is not redaction. Removing the page entirely is safer, and true redaction, which removes the underlying content, is safer still.

## Common mistakes

- Deleting before duplicating the original.
- Counting from the printed page number instead of the physical index.
- Removing a page that carries a signature, an exhibit stamp, or the only copy of a handwritten note.
- Deleting a cover page and making the remaining page labels even more confusing.
- Cropping content and assuming it is gone.
- Forgetting to update a table of contents after removing pages.
- Removing "intentionally blank" pages that were required for pagination.
- Saving over the original file name.
- Trusting a thumbnail without zooming in on a nearly blank page.

## When this fails

If the tool refuses to delete pages, the PDF may be encrypted with permissions that block editing, or it may be certified. Unlock it only if you have the right to do so, and keep a copy of the original.

If the deletion succeeds but the page count is wrong, recheck the selection. A common cause is deleting by label rather than index. Another is a range that included a page you thought was excluded.

If the output will not open, the source may be malformed or the tool may have run out of memory on a very large scan. Try a smaller document or a desktop browser, and keep the original safe.

If bookmarks break, rebuild the outline or remove it entirely. A document with no outline is less confusing than one whose entries jump to the wrong pages.

If a recipient says a page is missing that you meant to keep, compare the output against the original page by page. Do not delete the original until that comparison is done.

## Related reading

- [Delete pages](/tools/delete-pages)
- [How to split a PDF into separate files](/guides/split-a-pdf-into-files)
