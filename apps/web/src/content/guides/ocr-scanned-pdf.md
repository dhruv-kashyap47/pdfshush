---
title: "OCR a Scanned PDF: What It Does and Its Limits"
description: "Understand what OCR adds to a scanned PDF, why scan quality decides the result, and how to check accuracy before you trust search, copy, or text export."
slug: "ocr-scanned-pdf"
category: "How-to"
publishedAt: "2026-11-26"
updatedAt: "2026-11-26"
relatedTools:
  - ocr-pdf
  - pdf-to-text
relatedGuides: []
faq:
  - "What does OCR add to a scanned PDF? :: A text layer that sits over the page image, so search, copy and screen readers can use the words. The image itself is not replaced."
  - "Why is OCR inaccurate on some scans? :: Skew, low resolution, faint ink and unusual fonts all reduce accuracy. A straight 300 dpi scan is the best starting point."
  - "Does OCR make a PDF accessible? :: Not by itself. Accessibility also needs tags, a reading order and alt text, which OCR does not add."
draft: false
---

You have a scanned PDF that looks fine on screen, but searching for a word finds nothing and selecting a sentence is impossible. OCR is supposed to fix that, and it often does. It also produces a text layer that can be wrong in ways you will not notice until you rely on it.

## What OCR actually adds to a scanned PDF

A scanned PDF is usually a container full of page images. The scanner captured light and dark pixels, not letters, so the file has no idea that a particular cluster of pixels spells a word. You can look at it, print it, and scroll through it, but you cannot search it, select a sentence, or copy a paragraph into another document. OCR, or optical character recognition, changes that by analyzing each page image and writing a text layer that sits behind or over the image.

The important word is layer. OCR does not replace the picture of the page with clean, editable text. The original image usually stays exactly where it was, and the recognized characters are placed in invisible text boxes at the positions where the engine thinks the words appear. That is why a searchable scanned PDF still looks like a scan: the visible page is the same image, and the text is there for the software to find. Selecting a line highlights the image area covered by the invisible text, which is why the highlight sometimes looks slightly off.

This has practical consequences. Searching works, copying works, and screen readers may be able to read the text if the file is structured well. But the layout is still a picture. If you need to reflow the content, edit a paragraph, or preserve a complex table as data, OCR alone will not give you that. You need a text export and then a careful cleanup, or a conversion tool that rebuilds the layout. Understanding the difference prevents a lot of disappointment.

## The scan quality matters more than the OCR engine

It is tempting to think that a better OCR engine will rescue a bad scan. In practice, the input decides most of the outcome. A clean, evenly lit page with sharp letters gives almost any modern engine an easy job. A gray, noisy, low-contrast image with speckles and a slight tilt gives even a good engine very little to work with. The engine can only recognize shapes that are present in the pixels.

The things that matter most are contrast, sharpness, and even lighting. Text should be clearly darker than the background, with no large shadows across the page. A phone photo taken under a desk lamp often has a bright pool in the middle and dark corners; the OCR may do well in the center and fail at the edges. A photocopy of a photocopy loses thin strokes and fills in the loops of small letters. Color scans of yellowed paper can be harder than a good grayscale scan because the background competes with the ink.

Resolution is the other big factor, but more is not automatically better. The useful rule of thumb is that the text needs enough pixels across the height of a character for the engine to see the difference between similar letters. For ordinary body text, a scan around 300 dpi is a common starting point; small print, footnotes, and dense forms benefit from more. Beyond a point, extra resolution mostly adds file size and noise, and upsampling a low-resolution scan does not create detail that was never captured. Treat these numbers as starting points, not universal requirements, and judge by a test crop.

File compression matters too. A heavily compressed JPEG can develop blocky artifacts around letters, especially on sharp black text against white paper. The artifacts look like tiny smudges and can turn an `e` into a `c` or close the gap in an `a`. If you control the scan settings, a clean grayscale or bilevel scan at a sensible resolution is often better for OCR than a highly compressed color photo.

## Language selection is not a cosmetic setting

OCR engines use a language model to decide which characters and words are likely. Telling the engine the wrong language does not just affect hyphenation and spell-check suggestions; it changes which characters the engine expects to see. English text processed with a language pack that lacks accented characters will lose accents. Text in a language with different letterforms may be mapped onto the closest Latin characters and produce nonsense. Numbers and punctuation can also be affected.

Choose the language of the document, not the language of your computer. For a file with pages in two languages, check whether the tool lets you select multiple languages or process pages separately. Running a mixed document through a single language model usually produces a text layer that is good in one language and poor in the other. If the tool has an option for a script rather than a country, use the script that matches the printed text.

A related trap is assuming that the language setting fixes spelling. It does not. OCR output is a transcription of shapes, not a corrected document. Names, technical terms, and words in another language will still come out wrong if the shapes are ambiguous. Do not run a global spell-check over OCR text and accept every change, because it will quietly rewrite product codes and proper nouns.

## Rotated pages, skew, and multi-column layouts

Many OCR tools try to detect page orientation automatically, and many do it well enough for a page that is upside down or rotated by a right angle. The detection is not perfect, especially on pages with a large image, a stamp, or very little text. If a page is consistently coming out garbled, check its orientation first. A page that is sideways when it reaches the recognizer will produce either nothing or a text layer full of noise.

Skew is a subtler problem. A page can be upright but tilted by a degree or two, which is enough to confuse line detection. The OCR may merge two lines, split one line, or assign words to the wrong column. Straightening the page before OCR is usually more effective than trying a different engine afterward. The article on [straightening a scanned PDF](/guides/straighten-scanned-pdf) covers the order of operations: rotate first, then deskew, then OCR.

Columns are a separate challenge. A two-column academic paper or newsletter has text that runs across the page in a way that the engine must untangle. Some engines handle columns well; others read straight across, mixing the left and right columns into one stream. The visible page still looks correct, so the failure is easy to miss until you copy a paragraph and find that the sentences jump between columns. Tables are worse, because the relationship between a row label and a cell value can be lost even when every character is recognized correctly.

Forms combine several problems at once. Labels sit close to values, checkboxes are graphics rather than text, and the filling may be handwritten. OCR can usually read printed labels and typed values, but it may not preserve which value belongs to which field. If the form matters, extract the text and check the field mapping by hand rather than trusting the reading order.

## Handwriting, signatures, and stamps

OCR is built for printed or typed text. It can sometimes read neat block handwriting, especially if the letters are separated and the scan is clean, but it is not reliable enough to treat as a transcript. Cursive is a different problem: the letters connect, the shapes vary from person to person, and the engine has little to anchor on. A signature is worse still. It is a stylized mark, not a sequence of letters, and any text the OCR produces for it is a guess.

Stamps create a similar issue. A rectangular stamp with text may be recognized, but the angle, the ink color, and the overlap with other content can turn it into fragments. If a document depends on a signature, a stamp, or a handwritten date, keep the image and treat the OCR text as a convenience, not as evidence. Do not let a searchable PDF create the impression that handwriting has been officially transcribed.

## Check accuracy before you trust the result

The most common mistake with OCR is assuming that a file with a text layer is a file with correct text. A searchable PDF can contain a text layer that is wrong in ways that are invisible until someone relies on it. Build a short verification routine and use it every time the output matters.

1. Open the OCR result and search for a distinctive phrase from the middle of a page, not the title. Titles are large and usually recognized well.
2. Search for a number that matters, such as an invoice total, a date, or an account reference. Numbers are where small recognition errors cause the most damage.
3. Select a paragraph and paste it into a plain text editor. Check the word order, the line breaks, and whether text from adjacent columns has been mixed in.
4. Compare the pasted text with the page image side by side. Look for missing lines, duplicated lines, and characters that changed shape.
5. Check the page count and the orientation of every page. A page that failed OCR may still be present as an image with no text layer.
6. If the document has a table, copy the table into a spreadsheet and check that the rows still line up.

For a long document, sample the first page, a middle page, and the last page, plus any page with a different layout. If the sample is clean, the rest is probably clean, but spot-check the pages you will actually quote or search.

## Why OCR can make a file bigger

Adding a text layer means adding data: the recognized characters, their positions, and often font information so the viewer can display selections correctly. Some tools also embed a subset of fonts. On a small, heavily compressed scan, that extra data can be a significant fraction of the original size. A file that was mostly one compressed image per page now has an image plus text plus positioning information.

The result depends on the tool and the settings. Some OCR tools recompress the page images while they work, which can make the output smaller or larger depending on the original compression and the new quality setting. Others preserve the images exactly and simply add the text layer. If size matters, compare the output with the original before deciding which one to keep. Compressing the OCR result afterward can reduce size, but aggressive compression can blur the image that the text layer depends on, so check the pages again after compressing.

Keep the original scan. The OCR file is a derived copy, and if the text layer turns out to be poor, you want to be able to go back and try again with a better input or a different language setting.

## A reliable OCR workflow

1. Save the original scan and work on a copy.
2. Fix orientation and skew before OCR. If the page is crooked, no engine setting will fully compensate.
3. Crop away dark borders and scanner edges that add noise without adding text.
4. Choose the correct language for the document, not the language of the interface.
5. Pick the output you need: a searchable PDF for reading and search, or a plain text export for editing and analysis. Use [PDF to Text](/tools/pdf-to-text) when you need the text as a separate file.
6. Run OCR on a small page range first if the tool allows it. Check the result before processing hundreds of pages.
7. Verify a sample as described above, then keep both the searchable file and the original.

## Common mistakes and when this fails

- **Scanning at low resolution and upscaling later.** Upscaling cannot recover detail that the scanner never captured.
- **Using the wrong language.** Accents, special characters, and letterforms suffer first.
- **Skipping straightening.** A tilted page can OCR poorly even when the print is sharp.
- **Trusting a successful run.** "OCR completed" means a text layer was written, not that the text is correct.
- **Assuming OCR equals accessibility.** A searchable PDF is not the same as a tagged PDF with a logical reading order. Screen reader behavior depends on the tags and the structure, not just on the presence of text.
- **Forgetting password-protected files.** Many tools cannot open an encrypted PDF. Remove the password from a copy first if you are authorized to do so.
- **Expecting handwriting and signatures to be transcribed.** Treat those as images.

When OCR fails completely, check the obvious causes in order: the page is rotated, the scan is too faint, the language is wrong, or the file is encrypted. If the text layer exists but is garbage, compare a crop of the original with the same crop after any preprocessing. If preprocessing removed strokes or filled in gaps, start again from the untouched scan and use a gentler setting.

## Related reading

- [OCR PDF](/tools/ocr-pdf) to add a searchable text layer to a scanned document.
- [Rotate and Straighten a Scanned PDF](/guides/straighten-scanned-pdf) for the preprocessing step that gives OCR its best chance.
