---
title: "Flatten a PDF: What It Means and When You Actually Need It"
description: "Learn the three meanings of flattening a PDF, which one an upload portal expects, what flattening does to signatures and forms, and how to keep a usable copy."
slug: "flatten-a-pdf"
category: "How-to"
publishedAt: "2026-11-26"
updatedAt: "2026-11-26"
relatedTools:
  - flatten-pdf
  - compress-pdf
relatedGuides: []
draft: true
---

> **NEEDS HUMAN EDIT** — do not publish until every box is checked.
> - [ ] Verify: what the shipped Flatten PDF tool actually flattens by default (form fields, annotations, layers, or a combination) and whether it offers separate options.
> - [ ] Add: screenshots of a form before and after flattening, including the fields panel and the comments panel, plus a note on what happened to the file size.
> - [ ] Check: the statements about digital signatures and accessibility, because the result depends on the signing method and the PDF structure.
> - [ ] Check: the recommendation to keep both the original and the flattened copy for records.

The upload form says the PDF must be flattened, and you are not sure what that means. It might want the form fields locked, the comments removed, or the whole page turned into a picture. Each one is a different operation, and the wrong choice can cost you a signature or an editable copy you still need.

## Three different things people mean by flatten

"Flatten" is one of those words that sounds precise until you try to use it. In PDF work it describes at least three different operations, and the right one depends on what you are trying to fix. If you flatten the wrong thing, you can lose editability you still need, break a signature, or hand in a file that still gets rejected by the portal.

The first meaning is flattening form fields. A fillable PDF has interactive fields layered over the page. You type into a field, and the value is stored as field data. Flattening merges the field values into the page content and removes the interactive fields, so the document looks the same but can no longer be typed into. This is what most people mean when they say they need to flatten a form before uploading it. It prevents the recipient from editing the answers and makes sure the values display even in a viewer that handles forms poorly.

The second meaning is flattening annotations and comments. Review tools let people add highlights, sticky notes, stamps, drawing markups, and replies. These are separate objects with their own properties, and they can be hidden, filtered, or deleted. Flattening merges the visible markups into the page and removes the comment objects. The page looks the same, but the comments are no longer separate items in a review panel. This is common when a marked-up document needs to become a clean final copy.

The third meaning is flattening layers, transparency, or optional content. A PDF can contain layers that can be shown or hidden, and it can contain transparent objects that are composited when displayed. Flattening this kind of file combines the visible layers and transparency into a single visual result. Some print workflows ask for this because their software handles flattened pages more predictably. A related but more drastic operation is rasterizing: rendering each page to an image and rebuilding the PDF. Rasterizing definitely removes layers and transparency, but it also removes selectable text, so it is a different tradeoff.

## Which one does the portal mean?

Upload portals rarely explain which definition they are using. The wording around the upload button is the best clue. "Flatten form fields" or "make fields non-editable" points to the first meaning. "Remove annotations" or "no comments" points to the second. "Flatten transparency" or "no layers" points to the third. "Print to PDF" usually means the portal wants a simple, consistent file and may accept a flattened or rasterized version, but it can also mean the portal will process the file itself.

A practical test is to upload a copy and see whether the preview shows the values and markups correctly. If the preview is blank where the form values should be, the portal's viewer is not rendering the fields, and flattening the values into the page will fix it. If the preview shows the values but the portal still rejects the file, the problem may be annotations, layers, or file size rather than the fields.

When the instructions are ambiguous and the deadline is real, ask the recipient. A short question about whether they need fields flattened or the whole page rasterized can save you from submitting a file that looks right to you and wrong to their system. If you cannot ask, submit the least destructive version that satisfies the visible requirement: flatten the fields first, check the preview, and only rasterize if the portal still refuses the file.

## Flattening a signed document

Signatures are where flattening causes the most confusion. There are two very different things called a signature in a PDF. One is a visual signature: an image of a handwritten signature, a typed name, or a drawing placed on the page. The other is a digital signature: a cryptographic signature that covers the file contents and can be validated later. Many e-signature workflows use both, placing a visible mark and attaching a certificate.

Flattening a document with a visual signature usually keeps the mark, because the mark becomes part of the page. Flattening a document with a digital signature is riskier. The flattening process changes the file, and a digital signature is designed to detect changes. Some tools preserve the signature and report it as valid because they update the signed byte range in a supported way; others invalidate it. You should not assume either result. Check the signature panel after flattening, and keep the original signed file.

The order matters. Fill the form, apply the signature, and then flatten only if the recipient requires it. Flattening before signing removes the fields you need to sign, and flattening in the wrong tool can make the document impossible to sign again. If the recipient accepts a normal signed PDF, do not flatten it just because the word appears somewhere in the instructions. A valid digital signature is usually more valuable than a flattened page.

## What you lose when you flatten

Flattening form fields removes the ability to edit the answers. That is the point, but it also removes calculations, validation rules, and the tab order that made the form easy to fill. If the recipient later needs a correction, they cannot make it in the flattened file; they need the original or a new copy. Keep the filled but unflattened version if there is any chance the answers will change.

Flattening annotations removes the comment threads and review status. A highlight becomes ink on the page; a reply disappears or becomes part of the flattened visual, depending on the tool. If the comments contain instructions, approvals, or a record of who changed what, export or save that information before flattening. The visual markup is not a substitute for the discussion that produced it.

Accessibility is the part people forget. A well-built PDF can carry tags, alternative text, a logical reading order, and form field labels that assistive technology uses. Flattening fields can remove the field structure that a screen reader relies on, and rasterizing removes everything except the picture. A flattened file may look perfect and still be much harder to use with a screen reader. If accessibility matters, keep an accessible original and treat the flattened file as a submission copy, not as the record copy.

Text search usually survives flattening because the page content is still text. It does not survive rasterizing, which replaces the text with pixels. If a portal asks for a flattened file and you later need to search it, check that the result still has selectable text. If it does not, you have a rasterized file, not just a flattened one.

## Step by step: flatten without losing the original

1. Identify what needs flattening. Open the file, click a form field, open the comments panel, and check the layers panel if your viewer has one. Write down what you find.
2. Save a copy of the original with a clear name, such as `application-original.pdf`. Do not flatten your only copy.
3. Fill in every field and apply any signatures before flattening. Once the fields are gone, you cannot add a value in the same file.
4. Open [Flatten PDF](/tools/flatten-pdf) and load the copy.
5. Choose the operation that matches the requirement. If the tool offers separate options for fields and annotations, select only what the recipient asked for. Flattening annotations when only fields were requested removes review information for no reason.
6. Run the flatten and download the result as a new file, such as `application-flattened.pdf`.
7. Inspect the result. Try to click a field. Open the comments panel. Check that the values are visible, the markups are in the right place, and the page count has not changed.
8. Search for a word that should be in the document. If search fails, the tool may have rasterized the pages.
9. If the file has a digital signature, open the signature panel and check whether it is still reported as valid.
10. Upload the flattened copy and keep both files until the submission is accepted.

## File size and compression are separate issues

Flattening can make a file larger. Merging annotations and field appearances into the page adds content, and some tools re-embed fonts or images in the process. If the portal has a size limit, do not assume that flattening will solve it. Check the size after flattening, and if it is still too large, use [Compress PDF](/tools/compress-pdf) on a copy. Compression and flattening do different jobs: flattening changes the structure, while compression reduces the amount of data used to represent the pages.

Be careful about compressing a file that contains a digital signature. Compression changes the file and can invalidate the signature. If the signature must remain valid, find out whether the portal accepts the original size before you touch it.

## Common mistakes and when this fails

- **Flattening before filling.** The fields disappear and the answers go with them. Fill first, then flatten.
- **Flattening the original instead of a copy.** Keep an editable version for corrections and records.
- **Assuming flatten means compress.** They solve different problems. Flattening can increase size.
- **Flattening every annotation when only fields were requested.** You lose review history that nobody asked you to remove.
- **Trusting the thumbnail.** Check the actual pages at full size, especially signatures and small form values.
- **Assuming a signature survived.** Open the signature panel. A visual mark can remain while the cryptographic signature is broken.
- **Rasterizing to fix a picky portal.** It usually works, but it destroys selectable text and accessibility structure. Use it as a last resort.

When flattening fails, the cause is often that the tool flattened only the appearance and left the fields interactive, or that the portal is rejecting something else entirely. Test the file in a second viewer. If the fields are still clickable, the flatten did not do what you needed. If the fields are gone but the portal still rejects the file, check the size, the file extension, and whether the portal requires a specific PDF version. Do not keep flattening the same file repeatedly; each pass can degrade the content without fixing the real cause.

## Related reading

- [Flatten PDF](/tools/flatten-pdf) to merge form values and annotations into the page.
- [Password-Protect a PDF](/guides/password-protect-a-pdf) for the difference between restricting edits and actually encrypting a file.
