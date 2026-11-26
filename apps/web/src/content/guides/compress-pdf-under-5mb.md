---
title: "Compress a PDF Under 5 MB for a Portal Upload"
description: "Why portals cap file size, what makes a PDF large, the right order for downsampling and re-saving, and how to check the result before you submit the file."
slug: "compress-pdf-under-5mb"
category: "Tax & finance"
publishedAt: "2026-11-26"
updatedAt: "2026-11-26"
relatedTools:
  - compress-pdf
  - resize-pdf
relatedGuides: []
faq:
  - "Why is my PDF still too large after compressing? :: Most compressors downsample images. A file full of scanned pages needs lower resolution or fewer pages, while a file that is large because of embedded fonts or metadata needs a different fix."
  - "Does compressing a PDF reduce quality? :: Usually some images are re-encoded at a lower resolution, so yes for scan-heavy files. Text stays sharp, while photos and fine detail soften first."
  - "Can I hit an exact size like 5 MB? :: Not reliably in one pass. Compress, check the size, then adjust the resolution or split the document until it fits under the limit."
draft: false
---

You have filled in the application, attached the supporting documents, and the upload box rejects your PDF with a four-word message: file too large. The deadline is close and the portal will not tell you which page is the problem. Compressing the file is usually the fix, but doing it in the wrong order can produce a file that is still too big or too blurry to read.

## Why portals cap file size

A public-facing upload form is a piece of software with physical limits. The server has to accept the request, buffer it somewhere, scan it, store it, and back it up. Every one of those steps costs memory and disk, and a portal that accepts anything from anyone has to defend against someone sending a file that fills the disk or ties up a worker.

Caps also come from procurement. A vendor sells "up to a certain storage per applicant," and the cap is passed down to the upload form. Email gateways add their own limits when a notification with an attachment is generated. Some systems convert every upload to images and store the images, which multiplies the space needed.

The limits vary widely. One portal may allow a single file of a few megabytes; another may allow a total of tens of megabytes across all attachments. Some count megabytes as 1,000,000 bytes and some count mebibytes as 1,048,576 bytes, which is enough to make a file that looks under the cap fail anyway. Read the portal's stated limit, then leave a margin.

## What is actually inside a large PDF

A PDF is not one compressed blob. It is a set of objects: page descriptions, content streams, fonts, images, color profiles, metadata, and sometimes attachments. Most of the size sits in a few predictable places.

- **Images.** In a scanned document, each page is usually a single image, and the image dominates the file. This is the most common cause by a wide margin.
- **Fonts.** A PDF can embed a full font family even when the page uses three characters from it. Subsetting helps; a generator that does not subset can add hundreds of kilobytes per font.
- **Duplicate objects.** Poorly built PDFs can embed the same logo or background image once per page instead of once per document.
- **Text and OCR layers.** Usually small, but an OCR layer over a high-resolution scan can add up across hundreds of pages.
- **Transparency and effects.** Gradients, drop shadows, and soft masks may be stored in a form that requires more data than a flattened equivalent.
- **Unreferenced objects and incremental saves.** Each edit can append a new version while leaving the old objects in place. A file that has been edited ten times can be much larger than its content requires.
- **Attachments and thumbnails.** Embedded files, portfolio items, and preview images all count toward the total.

## Measure before you compress

Open the file's properties and note two numbers: total size and page count. Divide one by the other. A text-only page is usually tens of kilobytes. A color scan at 300 dpi is often several hundred kilobytes, and a 600 dpi scan can be a megabyte or more per page before any compression. If your average is in the high hundreds of kilobytes and the document is mostly text, the images are the problem.

On Windows, right-click the file and choose Properties, then Details, to see the size and page count. In Adobe Acrobat or Reader, use File, then Properties, or `Ctrl+D`. On macOS, open the file in Preview and press `Cmd+I` for the inspector.

## The order of operations

Compression works best when you fix the biggest causes first. Re-saving with a generic "optimize" button before downsampling is like mopping a floor while the tap is running.

1. **Remove pages you do not need.** A statement bundle with an advertising insert, a terms page, or a duplicate cover sheet can be dropped before anything else. Fewer pages means less to compress.
2. **Check the image resolution.** If the scan is 600 dpi, downsample to 300 dpi for documents that will be read on screen or printed at normal size. For a portal that only displays pages in a viewer, 150 to 200 dpi is often enough.
3. **Decide whether color is needed.** A color scan of black text on white paper can usually become grayscale with no loss of meaning. Keep color if the document has charts, stamps, or highlighted figures that matter.
4. **Set JPEG quality deliberately.** Around 70 to 80 is a reasonable starting point for scanned text. Below that, thin strokes start to smear.
5. **Re-save the file once, with those settings.** Repeated save cycles compound JPEG artifacts without shrinking the file much further.
6. **Run structural optimization.** This removes duplicate objects, unused resources, and redundant metadata. It is safe and does not touch image quality.
7. **Check the result before uploading.** Page count, legibility, searchability, and file size.

The distinction between steps 5 and 6 matters. Downsampling changes the pixels. Structural optimization rearranges the file. A tool that only does the second will barely help a 600 dpi scan, and a tool that only does the first may leave avoidable bloat behind.

## Doing it with the compress tool

1. Open [Compress PDF](/tools/compress-pdf) and load the file.
2. Choose the compression level. A moderate setting that downsamples images is usually the right first attempt; the most aggressive setting is for cases where the portal cap is tight and the document is mostly pictures.
3. Run the compression and note both the input and output sizes. If the output is barely smaller, the images were not the cause and you need a different fix.
4. Download the result under a new name so the original stays intact.
5. Open the result and check it before you go anywhere near the portal.

If the pages themselves are the wrong dimensions, [Resize PDF](/tools/resize-pdf) changes the page size. That is a layout operation, not a size reducer. Shrinking a Letter page to A4 does not remove image data, and it can make margins look wrong. Do not expect it to solve a file-size problem.

## What compression costs

Text drawn as text stays crisp. Text that exists only as pixels in a scan is where the damage shows up. At moderate settings, the difference is usually invisible at 100 percent zoom. At aggressive settings, you get gray halos around letters, broken thin strokes, and smeared signatures.

Three specific risks are worth naming:

- **Small print.** Footnote text and the fine print on a statement can become unreadable before the main body does.
- **Stamps and signatures.** A handwritten signature is a set of thin, low-contrast strokes, which is exactly what JPEG compression handles badly.
- **OCR accuracy.** If you compress a searchable scan by rasterizing and re-encoding the pages, the text layer may no longer align with the image, and future text searches or automated extraction can degrade.

Keep the original. Compress a copy. If the portal rejects the compressed version, you still have a clean file to work from.

## How to check the result

Do these checks in order, before the upload, not after:

1. Open the compressed file and confirm the page count matches the original.
2. Look at the first and last page. Truncated files often lose the end.
3. Zoom to 200 percent on the densest block of text and read a full sentence.
4. Search for a word you know appears in the document. If it was searchable before, it should still be searchable.
5. Confirm the file size against the portal's stated limit, with a margin.
6. Open the file in a second reader if you have one, such as a browser tab or a phone.
7. If the portal offers a preview before final submission, use it. The preview is generated by the same system that will judge the file.

## Portal pitfalls

The upload box is only one part of the submission. A few behaviors catch people repeatedly.

- **Session timeouts.** A large upload on a slow connection can outlast the session. Sign in, go straight to the upload step, and have the file ready before you start.
- **Limits on the total, not the file.** The portal may accept a 4 MB file but reject the submission because the combined attachments exceed a separate cap. Check the total.
- **Filename characters.** Spaces, ampersands, and hash marks can break older upload handlers. Rename to letters, numbers, and hyphens.
- **The spinner that is not progress.** Some portals show an animation with no real progress. If nothing changes for several minutes, the request may already have failed. Do not refresh mid-upload unless the page tells you to.
- **Mobile browsers.** A phone can suspend a background tab and kill the upload. Use a desktop if the file is large.
- **Extensions and VPNs.** Ad blockers and privacy extensions can interfere with the request. Try a clean browser profile if an upload fails without a clear error.
- **Duplicate submissions.** After a timeout, the first attempt may still have landed. Check for a confirmation number before uploading again.

## Common mistakes

- Running "optimize" on a 600 dpi scan and expecting a big drop.
- Compressing the same file five times, losing quality at each step.
- Dropping color when the document uses color to convey meaning.
- Compressing a password-protected file that the tool cannot open, then wondering why nothing changed.
- Forgetting that a scanned PDF with a single giant image may need that image resampled, not the page resized.
- Hitting the per-file cap but exceeding the total attachment cap.
- Uploading the compressed file without opening it first.
- Deleting the original after a successful upload.

## When this fails

If the compressed file is still too large, the cause is usually one of three things. The images are already low quality and the tool cannot shrink them without visible damage, in which case splitting the document is the better answer. The file contains a small number of enormous images, such as a fold-out map or a high-resolution photo, which need targeted resampling rather than whole-document compression. Or the document has hundreds of pages and simply cannot fit under the cap at readable quality, in which case send only the pages the portal asked for.

If the portal rejects a file that meets the size limit, the problem is probably the format, the filename, or the total attachment size rather than the bytes. Read the exact error text, change one variable at a time, and keep a screenshot of the confirmation once it goes through.

## Related reading

- [Compress a PDF in the browser](/tools/compress-pdf)
- [Why is my PDF so large? Seven causes and the fix for each](/guides/why-is-my-pdf-so-large)
