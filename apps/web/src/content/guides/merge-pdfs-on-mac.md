---
title: "Merge PDFs on a Mac Without Paying for Acrobat"
description: "Merge PDFs on a Mac with Preview: drag pages between files, see what the method breaks, and learn when a free browser tool is the safer choice for the job."
slug: "merge-pdfs-on-mac"
category: "How-to"
publishedAt: "2026-11-26"
updatedAt: "2026-11-26"
relatedTools:
  - merge-pdf
  - organize-pdf
relatedGuides: []
faq:
  - "Can Preview merge PDFs? :: Yes, by dragging page thumbnails from one document into another. It works for simple files but can drop outlines and damage form fields."
  - "Does merging in Preview keep bookmarks? :: Often not. The dragged document outline is usually lost, and entries from the first file can point at the wrong page."
  - "What is the fastest way to merge several PDFs on a Mac? :: A browser tool with a file list is quicker for more than a few files, because you can order everything before the merge and check the result once."
draft: false
---

You have a signed lease, a photo of your ID, and a cover letter, and the upload portal accepts exactly one file. Acrobat will merge them for a monthly fee. macOS will do it for free with a tool you already own, as long as you accept a few limits and check the result before you send it.

## What Preview can and cannot do

Preview is the PDF viewer that ships with macOS. It is not a document assembler, but it can open several PDFs at once and move pages between them by dragging thumbnails. That one feature covers most everyday merges: two to ten ordinary files, a handful of pages each, no complicated navigation inside them.

It cannot merge a folder of forty scans in a single pass, and it has no dialog where you line up the files before they combine. It also does not repair the structural parts of a PDF. Bookmarks, named destinations, cross-document links, and form fields can be damaged by a merge, and Preview will not warn you.

If your files are simple, keep reading. If they contain a clickable table of contents, fillable fields that must survive, or a mix of Letter, A4, and landscape pages, skip ahead to the browser method near the end.

## Route A: open both files and drag thumbnails

This is the built-in method. It works the same way whether you are combining two files or ten, and it gives you exact control over where the inserted pages land.

1. Put the PDFs in one Finder folder. Name them in the order you expect to use them, because a clear name makes the drag order easier to track. Finder's sort order does not control the merge; your drop position does.
2. Double-click the PDF that should come first. It opens in Preview.
3. Choose **View > Thumbnails**. The sidebar appears with one thumbnail per page. If the sidebar is already visible, skip this step.
4. Double-click the second PDF in Finder. Preview opens it in a second window. Keep both windows visible so you can drag between them.
5. In the second window, choose **View > Thumbnails**, then select the pages you want to move. Press **Cmd+A** for every page, **Shift-click** for a continuous range, or **Cmd-click** to pick individual pages.
6. Drag the selected thumbnails into the first window's thumbnail sidebar. Hold the pointer over the sidebar until a blue horizontal line appears between two thumbnails. That line is the insertion point. Drop above or below the page where the new pages should go.
7. Check the order in the sidebar. If the pages landed in the wrong place, press **Cmd+Z** immediately and drag again.
8. Choose **File > Save** to write the change into the open document, or **File > Export** to save a separate copy. Export is the safer choice when you want to keep the original untouched.

There is a shortcut version of the same move. Drag the second PDF's file icon from Finder directly onto the first window's thumbnail sidebar. Preview inserts all of its pages at the drop point. This is faster, but you get no chance to select a subset first.

Aim carefully. If you drop the pages on the page canvas instead of the sidebar, Preview may do nothing or open the dragged file in a new window. The thumbnail strip is the only drop target that inserts pages.

## Keep an untouched original

Preview's **File > Save** writes into the document you opened. If you started with the lease and merged the ID into it, the lease file now contains both. That is fine when you intended it, and annoying when you did not.

Before you begin, duplicate the first file with **File > Duplicate** or copy it in Finder. Work on the copy and leave the original in place until the recipient confirms the upload. Preview does keep some version history through **File > Revert To > Browse All Versions**, but it depends on how the file is stored and is not a substitute for a backup.

## What breaks when you merge in Preview

### Bookmarks and outlines

A PDF's outline is a document-level list of entries, and each entry points at a page object. When Preview combines two documents, the outline of the file you dragged from is usually dropped. Entries from the first file may survive but can point at the wrong page after insertions, especially if you inserted pages before an existing bookmark target.

Preview has no outline editor. The merged file may open perfectly and still have a table of contents that does nothing when clicked. If navigation matters, plan to rebuild the outline afterward or use an organizer that understands outlines.

### Links and named destinations

Internal links in the second document were written against that document's own page tree. After the merge they may continue to work, point at a page in the first document, or do nothing at all. Ordinary web links usually survive because they are absolute URLs. Links that jump from page 3 to page 40 of a separate file will not survive, because there is no longer a separate file.

### Form fields

Form fields are stored at the document level, not on the page. Two documents that both contain a field named "Name" can collide when merged. One value may overwrite the other, or both fields may display the same text. Radio button groups with identical names can merge into a single group, so checking a box on page four unchecks one on page twenty.

Filled values can also disappear if the viewer does not regenerate the field's appearance. Preview is not a form editor, so test every field after a merge. If the fields have to remain usable, merge with a tool that preserves AcroForm structure, then open the result in a full PDF editor and click through each field.

### Page sizes and orientation

Preview preserves each page's original dimensions. That is good for fidelity and awkward for reading. A Letter cover followed by A4 pages followed by a landscape spreadsheet will print with inconsistent margins, and some print drivers scale each page differently.

Preview offers no "fit all pages to one size" option during the merge. If uniformity matters, normalize the pages before merging or use a tool that can scale them. At minimum, rotate sideways pages before you combine anything, so the rotation applies to the correct page.

### Metadata and file size

The merged file usually inherits the title, author, and creation date of the first document. Preview does not offer a metadata dialog at merge time. That matters if the file goes to a client or a public records request and the title still says "Draft 3."

File size is roughly the sum of the inputs, minus any shared resources. Scanned pages are images, so ten 5 MB scans become a file close to 50 MB. Nothing is compressed. Check your upload limit before you start, not after.

## Check the merge before you send it

1. Count the pages. The thumbnail sidebar shows the total. Compare it with the sum of the input files; a missing page is easier to catch now than after submission.
2. Scroll the entire document. Watch for rotated pages, upside-down scans, and pages that landed one position off.
3. Open the first and last page. Confirm the cover and the signature page are where you expect them.
4. Open the outline panel if the document has one. Click two or three entries and see where they land.
5. Click every form field if the document has fields. Type a character, tab away, and confirm it stays.
6. Check the file size in Finder with **Cmd+I**.
7. Open the result in a second viewer, such as a browser, to catch anything Preview renders but other viewers do not.
8. Rename the file clearly and keep the source files until the recipient confirms.

## When a browser tool is the better choice

Reach for a browser tool when you have many files, when the order must be set before merging, when page sizes need normalizing, when bookmarks must survive, or when you are on a phone or a Windows machine.

Privacy deserves a moment. Some browser tools upload your file to a server; others process it inside the tab with no upload. Read the note on the page and decide based on the document. A holiday itinerary is a different risk from a tax return or a medical record.

1. Open [Merge PDF](/tools/merge-pdf).
2. Add the files with the picker or by dragging them onto the page.
3. Reorder the list before merging. This is the step Preview makes awkward, because you have to judge position from a thumbnail sidebar.
4. Choose any output options the tool offers, then run the merge.
5. Download the result and run the same checks listed above.

A dedicated merge screen also solves the "which window is which" problem. Every input file is visible in one list, in order, before anything is written.

If you need to do more than combine files, [Organize PDF](/tools/organize-pdf) lets you reorder, rotate, and delete pages in one view. That is often faster than merging first and repairing afterward.

## If you are on Windows

Windows has no bundled equivalent to Preview's thumbnail merge. Edge opens PDFs and can print them, but it cannot drag pages from one document into another. Printing both files to the **Microsoft Print to PDF** printer produces a single PDF, but it re-renders the pages: links and bookmarks are lost, form fields are flattened, and page dimensions can shift.

For a quick two-file merge, a browser tool is less work and easier to verify. The steps are the same: add, order, merge, then check the page count and the first and last pages. Readers who switch between macOS and Windows should keep the browser method in mind, because it behaves the same on both.

## Common mistakes

- Saving over the original. Use **File > Duplicate** first, or **File > Export** at the end.
- Dropping pages on the page canvas instead of the thumbnail strip, then assuming Preview cannot merge at all.
- Merging password-protected PDFs and assuming the protection carries over cleanly. Unlock them first. A merged file may inherit the first document's permissions or none at all.
- Rotating pages after merging instead of before, so the rotation lands on the wrong page.
- Assuming bookmarks survived because the outline panel still lists something.
- Combining a fillable form with a scan and expecting the fields to keep working.
- Sending a 50 MB file to a portal that caps uploads at 10 MB. Compress or split before uploading.

## When this fails

If Preview refuses to save, the file may be locked, stored on a read-only volume, or open in another app that holds it. Close the other app and try **File > Duplicate** to a local folder.

If thumbnails will not drag, confirm that the pages are selected in the source window and that the destination sidebar is visible. Some users find it easier to drag from Finder onto the sidebar than between two Preview windows. If dragging still fails, print one document to PDF and then insert pages into the printed copy.

If pages appear blank after merging, open the source file in another viewer before assuming data was lost. Preview occasionally fails to render a resource that another viewer handles, and the merged file may be fine.

If the job is enormous or slow, Preview is holding the entire document in memory. Split the merge into batches of five or ten files, then combine the batches.

## Related reading

- [Merge PDF](/tools/merge-pdf)
- [Split a PDF into separate files](/guides/split-a-pdf-into-files)
