---
title: "Rotate and Straighten a Scanned PDF: A Guide"
description: "Learn how rotation and skew differ, why a crooked scan breaks OCR, and how to straighten one page or a whole document, then check the result before OCR."
slug: "straighten-scanned-pdf"
category: "How-to"
publishedAt: "2026-11-26"
updatedAt: "2026-11-26"
relatedTools:
  - deskew
  - rotate-pdf
relatedGuides: []
faq:
  - "What is the difference between rotation and deskew? :: Rotation turns a whole page by 90 degrees. Deskew corrects a small tilt, often a degree or two, that a scanner introduced."
  - "Does deskewing help OCR? :: Yes, up to a point. Straight text is easier to recognise, but heavy correction can blur small type."
  - "Will deskewing reduce quality? :: It resamples the page, so some sharpness is lost. Keep the original scan and work on a copy."
draft: false
---

You scanned a stack of pages, opened the PDF, and saw that the text runs downhill on half of them. Or the pages are upright but sideways, and you are not sure which problem you are looking at. Straightening the file is usually a two-minute job, but only if you fix orientation and tilt in the right order.

## Rotation and skew are not the same problem

A scanned PDF can look wrong in two completely different ways, and the fix is different for each. Rotation means the page is turned by a right angle: the text runs sideways or upside down because the sheet went through the scanner in the wrong orientation, or because a phone photo was taken in landscape and saved as portrait. Skew means the page is almost upright but tilted by a small angle, usually a degree or two, because the paper was fed crooked or the book was not square against the platen.

That difference matters because the tools are not interchangeable. Rotating a page by 90 degrees will not fix a tilt, and straightening a tilt will not turn sideways text upright. If you apply the wrong correction first, you make the page harder to read and harder for OCR to process. The reliable order is to fix orientation first, then fix tilt.

It also helps to know what each operation does to the file. A PDF page has a rotation value that tells the viewer which way to display the content. Changing that value is a display change, not a redraw of the image, so it is clean and reversible. Deskew is different. The page content itself is tilted, so the software has to estimate the angle and transform the content, usually by resampling the page image. That is a real edit, and it can soften detail slightly. Treat rotation as a cheap correction and deskew as one you want to get right the first time.

## How a scanned page ends up crooked

Most crooked scans come from the paper path, not from the software. A sheet pulled into an automatic document feeder can enter at a slight angle and stay that way for the whole page. A flatbed scan can be crooked because the sheet was placed by hand and the edge of the glass is not a reliable guide. A book page is rarely square to the platen, and the curve near the spine makes the text lean differently at the top and bottom of the page. A phone photo adds its own problems: the camera was not parallel to the page, so the page has perspective distortion as well as rotation.

Combining files makes this worse. A document assembled from three sources might contain one page that is upside down, one that is tilted, and one that is perfectly straight. If you apply a single correction to the whole file, you fix one page and damage the others. This is why it is worth looking at every page before choosing a setting, not just the first one.

Faxed documents and older photocopies add noise, speckles, and uneven edges. They are still worth straightening, but expect the angle estimate to be less precise when the page has a dark border or a large block of graphics, because those features can confuse the detection.

## Why skew breaks OCR and search

OCR does not read a page the way a person does. It first finds text lines and word boundaries, then recognizes characters within those regions. A small tilt can cause the line detector to merge two lines, split one line into two, or place a word box over the gap between lines. The character recognizer then receives a badly framed image and produces plausible-looking nonsense. You may get a searchable PDF that opens fine and looks fine, but searching for a word on the page returns nothing because the text layer contains a garbled version of it.

Skew hurts some content more than others. Dense paragraphs with generous line spacing survive a small tilt better than tables, footnotes, and forms with boxes and labels close together. A tilted table is especially bad: columns drift across the page, so a value can be assigned to the wrong row in the extracted text. Small print is less forgiving than a large heading, because a tilt that moves a line by a fraction of its height is enough to blur the character shapes the engine depends on.

There is a second, quieter failure. The OCR may succeed, but the invisible text layer ends up slightly misaligned with the visible image. Selection highlighting then lands beside the word instead of on it, and copy-paste produces fragments in the wrong order. That is why checking the result matters even when the text looks correct at a glance.

## Decide what the page needs before touching a tool

Open the file and look at each page at a comfortable zoom. Use the window edge or a straight object on screen as a reference. If the lines of text run vertically or upside down, the page needs rotation. If the lines run left to right but rise or fall across the page, it needs deskew. If both are true, rotate first and then reassess, because a page that looked skewed at the wrong orientation may turn out to be close to straight once it is upright.

Look for pages that should not be changed. A cover with a large graphic, a blank page, or a page that is already straight can be skipped. Auto deskew applied to an already straight page may add a thin border or resample the image for no benefit. If the tool supports a page range, use it.

## Step by step: rotate, then straighten

1. Save a copy of the original file and give it a name you will recognize, such as `contract-original.pdf`. Do not work on your only copy.
2. Open [Rotate PDF](/tools/rotate-pdf) and load the copy.
3. Review the page thumbnails and note which pages are sideways or upside down. Rotate in 90-degree steps until the text reads normally. Most tools also offer a button to rotate every page at once, which is useful when the whole scan came in sideways.
4. Apply the rotation and download the result. Check the page count and orientation in a PDF viewer before continuing.
5. Open [Deskew PDF](/tools/deskew) and load the rotated file.
6. Preview the detection. If the tool offers automatic angle detection, compare the preview against the original. If it offers a manual angle, start with a small correction and increase it until the text baselines look level.
7. Choose whether to apply the correction to the current page, a page range, or the whole document. Use the whole document only when every page has the same tilt.
8. Apply the correction, download the file, and give it a new name such as `contract-straightened.pdf`. Keep the earlier version until you have confirmed the result.
9. Only now run OCR. Straightening before OCR gives the engine the best chance of finding lines correctly.

## One page or the whole document

Straightening a single page is the safer default when the pages came from different sources. It also lets you use a different angle for a page that was fed badly, without touching pages that are already correct. The cost is time: a long file with mixed pages takes more attention.

Applying one correction to the whole document works well when the pages came from a single pass through a document feeder and share the same tilt. It is faster and produces a consistent result. The risk is that the estimate is based on one page and then applied blindly to all of them, so a page with a large image, a blank margin, or a different layout can end up worse than before.

A middle path is to process the file in batches by source: pages from the feeder together, pages from the flatbed together, and photographed pages separately. That keeps the correction consistent within each group without pretending that every page in the file is the same.

## Check the result before you run OCR

Do not trust the thumbnail. Open the straightened file at a zoom level where individual characters are large enough to inspect. Check that the baselines are level, that the margins are still intact, and that no text has been clipped at the edges. Look at the corners, where resampling artifacts tend to show up first. If the page has a border or a stamp, confirm that it has not been rotated into the text area.

Then run a small test. OCR the first few pages, export the text, and read it against the image. Search for a distinctive phrase from the middle of a paragraph. If the search finds it and the selection highlight sits on the right words, the page is probably in good shape. If the text is garbled, go back to the straightened version and compare it with the original before trying a different angle. Sometimes the problem is not the angle at all but the resolution or contrast of the scan.

Finally, check the file in a second viewer. A page that looks correct in one application can display differently in another if the rotation value and the page content disagree. The PDF should open upright and level in both.

## Common mistakes and when this fails

- **Deskewing before rotating.** A sideways page has no reliable horizontal baseline, so the angle estimate is meaningless. Rotate first.
- **Applying auto deskew to every page.** Straight pages can be softened or given a border for no reason. Skip pages that do not need it.
- **Judging by the thumbnail.** Small previews hide clipping and softness. Inspect at full size.
- **Overwriting the original.** Keep the untouched scan until the OCR output has been checked.
- **Expecting deskew to fix perspective.** If a phone photo has a page that is wider at the top than at the bottom, the problem is perspective, not rotation. Deskew will level the text but the page will still be distorted. Crop and correct the photo first, or rescan it.
- **Expecting deskew to fix a curved book page.** Text near the spine bends by a different amount than text at the outer edge. A single rotation cannot correct a curve. Scan with the book pressed flat, or accept that OCR accuracy will be uneven.

If the straightened page still will not OCR, the cause may be low contrast, a colored background, or a resolution that is too low for the text size. Those are separate problems from skew, and no amount of rotating will solve them. Compare a small crop of the original with the same crop after processing. If the processing removed detail rather than adding clarity, start again from the original and use a gentler setting.

## Related reading

- [Deskew PDF](/tools/deskew) to straighten a tilted scan before OCR.
- [OCR a Scanned PDF](/guides/ocr-scanned-pdf) for what the text layer contains and where recognition still fails.
