---
title: "How to Redact a PDF Properly — and Why Black Boxes Fail"
description: "Drawing a black box over text does not remove it. Learn what true redaction deletes, how to verify the file, and when to flatten before sharing."
slug: "redact-a-pdf-properly"
category: "Legal & compliance"
publishedAt: "2026-11-26"
updatedAt: "2026-11-26"
relatedTools:
  - redact-pdf
  - flatten-pdf
relatedGuides: []
draft: true
---

> **NEEDS HUMAN EDIT** — do not publish until every box is checked.
> - [ ] Verify: that the Redact tool's controls are actually labeled "mark" and "apply," and that flattening in this app renders annotations and form fields rather than deleting them.
> - [ ] Add: a screenshot of a redacted page beside the same page with the hidden text selected and copied, or a real before/after text dump from a test file you ran yourself.
> - [ ] Check: the sentences about privilege logs, litigation holds and spoliation. Have counsel read them before this goes live.

A settlement agreement goes out with the account numbers covered by neat black rectangles. The other side opens it, drags a cursor across one of those rectangles, copies, and pastes into a word processor. Every digit is there. The rectangle was a drawing. The numbers were never touched.

This happens in law firms, claims departments and HR offices every month, and it keeps happening because most PDF software makes the wrong action the easy one. Drawing a shape takes one click. Removing content takes a deliberate step, and the file gives you no warning when you skip it.

## Why a black box fails

A PDF is not a picture of a page. It is a set of instructions: place this glyph here, paint this line there, draw this rectangle on top. When you use a comment tool, a highlighter or a shape tool, you add a new instruction at the end of the list. The text underneath keeps its position, its characters and its encoding. The viewer simply paints over it.

That is why the failure is so consistent across tools:

- **A filled rectangle** is an annotation or a vector path layered above the text. The text is still selectable if the annotation is removed, and often even with the annotation in place depending on the viewer's text extraction order.
- **A black highlighter** is the same thing with a different opacity. Some viewers let the reader change highlight color or delete the annotation outright.
- **White text on a white background** hides the characters from a human reader but leaves them in the text layer, ready to be selected or extracted.
- **Cropping a page** changes the visible area, not the content. The cropped region can be restored by changing the crop box back.
- **Deleting a page and inserting a screenshot** of the redacted page does remove the text layer, but it also flattens the whole page to an image, which may violate accessibility or filing requirements and makes the document hard to search.

The common thread: none of these operations parse and rewrite the page content. They add, hide or cover. Redaction has to subtract.

## What true redaction removes

Real redaction works on the page's content streams. It finds the text-showing and painting operations inside the marked area, deletes them from the stream, and writes a new stream back into the file. The characters are gone, not covered. A copy-and-paste returns nothing because there is nothing left to return.

A correct implementation also has to handle the awkward cases:

### Text and vector content

Characters that only partly overlap a redaction box are the classic source of leaks. If the tool removes only glyphs fully inside the box, the first or last character of a name can survive, and a determined reader can reconstruct it. Good redaction removes any glyph that intersects the marked region, even if that means losing a visible character next to the box. Expect the edge of your box to eat a little more than you drew.

### Scanned pages and the OCR layer

A scanned page is an image. Covering part of that image with a black rectangle removes nothing from the pixels; it only changes what the screen shows. True redaction on a scan has to overwrite the pixel data in that region so the original image cannot be recovered.

Then there is the second layer most people forget. If the scan was OCR'd, the file also contains invisible text positioned over the image. Redacting the picture without redacting the OCR text leaves a searchable copy of the very thing you removed. Search for the term afterward and see whether the viewer still finds it. If it does, the job is not finished.

Order matters here. OCR before redaction means you must redact both the image and the text layer. OCR after redaction means the text engine only sees what is still visible, which is usually the safer sequence for a scan you are about to release.

### Metadata, annotations and everything attached

The visible page is a fraction of the file. A PDF can carry:

- Document information fields such as Author, Title, Subject, Keywords, Creator and Producer.
- XMP metadata, which can include the original file name, the software used, edit history and custom properties added by a case management system.
- Comments and sticky notes, including the author's name, timestamps and any text quoted from the page.
- Form field values, which live separately from the page content and survive visual flattening if not handled.
- Bookmarks and named destinations that spell out party names or document titles.
- Embedded files and attachments, sometimes the original Word version of the document you just redacted.
- Optional content groups, also called layers, which can be toggled on and off.
- Digital signatures that will break, and in breaking, may reveal that the file was altered.

A redaction that cleans the page and leaves the author field reading "J. Smith, Acme Litigation Support" has not done the job.

## A workflow that survives review

1. **Work from a copy.** Put the unredacted original in restricted storage and keep it there. Every later step happens on a duplicate. If you redact the only copy and remove too much, you cannot undo it.
2. **Write the list before you open the tool.** Spell out every string that has to go: full names, maiden names, initials, dates of birth, Social Security numbers, account and policy numbers, phone numbers, email addresses, street addresses, employer names, diagnosis codes, minor children's initials. The list is your test plan later.
3. **Search first, then mark.** Run each term through the viewer's search and note the pages where it appears. Searching before redaction tells you how many instances you should have; searching after tells you whether you got them all.
4. **Mark and apply in [Redact PDF](/tools/redact-pdf).** Open the tool, drop in the copy, draw a box over each instance, and then apply the redaction. Marking alone only queues the areas. The apply step is what rewrites the content. If the interface offers a preview, use it before you commit.
5. **Save as a new file.** Do not overwrite the working copy. Give the export a name that does not contain the sensitive term you just removed; "Smith_v_Acme_redacted.pdf" is fine, "Smith_SSN_removed.pdf" is not.
6. **Flatten if the file still has interactive parts.** Form fields, comments and annotations should be dealt with explicitly. Flattening is the last step before verification, not a substitute for it.
7. **Verify the export, not the working file.** Everything in the next section runs against the file you are about to send.

## Verifying the export

Verification is a five-minute habit that prevents most of the leaks that make the news.

- **Select all and copy.** Open the export, press Ctrl+A or Cmd+A, copy, and paste into a plain text editor with no formatting. Search the pasted text for each item on your list. This catches text that is hidden behind a shape.
- **Search inside the PDF.** Use the viewer's find function for the exact string and for fragments: last name only, first four digits of an account number, the initials of a minor.
- **Check document properties.** In Adobe Acrobat, go to File > Properties and read the Description and Custom tabs. In Preview on macOS, use Tools > Show Inspector and the information panel. Look for author names, company names, original file names and anything that reads like a case caption you did not intend to share.
- **Open the comments and attachments panels.** Comments can quote the exact sentence you redacted, and attachments can be the unredacted source. Delete them rather than hiding them.
- **Look at the page thumbnails.** A stale thumbnail or an odd blank area sometimes reveals that content was covered rather than removed.
- **Use command-line tools when you have them.** `pdftotext` from Poppler dumps the text layer without any GUI, and `pdfinfo` prints the metadata. Both are quick ways to confirm that a string is truly absent.

If any check fails, go back to the working copy and redo the step. Do not try to patch the export by drawing another box.

## When to flatten

Flattening bakes annotations, comments and form field appearances into the page image or content stream so they can no longer be edited, toggled or removed. It is useful, and it is frequently misunderstood.

Flatten **after** redaction, never instead of it. Flattening a comment that contains a client's name makes that name part of the page. It does not erase it. The same is true of a form field holding a diagnosis code: flattening turns the value into visible page content, which may be exactly what you do not want.

Flatten when you need a fixed appearance that cannot be altered by the recipient, when a court or agency requires a non-interactive file, or when you have filled and signed a form and want the entries to stay put. Use [Flatten PDF](/tools/flatten-pdf) for that final pass, then verify again, because flattening changes the file and can change what is extractable.

Do not flatten as a way to remove annotations that contain sensitive text. Remove those annotations first, confirm they are gone, and then flatten if the document still needs it.

## Common mistakes

- **Redacting in a PDF editor's comment layer.** The rectangle is an annotation and can be moved or deleted by anyone.
- **Redacting before OCR on a scan.** The OCR pass afterward can rebuild the text you thought you removed.
- **Redacting after OCR but forgetting the text layer.** The picture is black and the search still finds the name.
- **Leaving the original in a shared drive or synced folder.** The redacted file is clean; the folder next to it is not.
- **Sending a "reduced size" version generated from the original.** Compression tools can rebuild a file from source material that still contains the text.
- **Forgetting the exhibit or attachment.** The body of the letter is clean and the attached spreadsheet is not.
- **Assuming a password protects the content.** A password controls access to the file, not what is inside it once someone has the password.

## When this fails

Some files resist a clean pass. A password-protected PDF has to be unlocked before any tool can rewrite its content streams. A document with a digital signature will have that signature invalidated by redaction, which is expected but should be explained to whoever relies on it. Portfolio PDFs and files with embedded packages need each component checked separately. Very large scanned productions may need to be split before processing.

If the tool reports that it cannot process a page, do not fall back to drawing a box. Export that page as an image, redact the image, and rebuild the page, then verify the rebuilt file's metadata and text layer from scratch.

## Keep a record of what you removed

A redaction is a records decision, not just a file operation. Write down what was removed, from which pages, on what date, by whom, and under whose instruction. In litigation, the rules on privilege logs and protective orders may require a formal record, and those rules vary by jurisdiction. Generally, keeping a short internal log is cheaper than reconstructing one later.

Store that log apart from the released file, and restrict it the same way you restrict the unredacted original. A log that lists the removed account numbers is itself sensitive.

## Related reading

- [Redact PDF](/tools/redact-pdf) — remove text and images from the content stream, not just from view.
- [Bates Numbering for Legal Documents](/guides/bates-numbering-guide) — number the production correctly once the redactions are final.
