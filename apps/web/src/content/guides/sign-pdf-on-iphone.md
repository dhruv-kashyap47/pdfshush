---
title: "Sign a PDF on an iPhone: Built-in Tools and Gaps"
description: "Sign a PDF on an iPhone with the built-in Markup tools, save a copy safely, and learn when a drawn signature is not legally or practically enough for portals."
slug: "sign-pdf-on-iphone"
category: "How-to"
publishedAt: "2026-11-26"
updatedAt: "2026-11-26"
relatedTools:
  - signature
  - fill-sign
relatedGuides: []
faq:
  - "Can I sign a PDF on an iPhone without an app? :: Yes, with the Files app and the Markup tools. The signature is added as an annotation, which some portals accept and some do not."
  - "Is an iPhone signature legally binding? :: Usually yes for ordinary agreements, but not for documents that need a witness, a notary or a qualified signature."
  - "Why does the portal reject my signed file? :: The signature may still be an annotation, or the file may need flattening. Flatten a copy before you upload it."
draft: false
---

An agreement arrives by email while you are on a train. It is one page, it needs a signature, and the sender wants it back today. The iPhone can do it in about a minute with the Files app, no extra software and no subscription. The result, however, is an annotation rather than a flattened signature, and that difference matters when the recipient's upload portal is picky.

## What the built-in Markup tool actually does

The Files app includes a preview mode with a Markup toolbar. It lets you draw, add text, highlight, and place a saved signature on a PDF. The signature is stored on the device so you can reuse it, and you can keep more than one, which is useful for a full signature and a set of initials.

Under the hood, Markup adds PDF annotations. It does not rewrite the page content. That is why the signature can be moved, resized, or deleted later, and why a viewer that ignores annotations may show a blank signature line. It also means Markup is not a digital signature in the cryptographic sense. There is no certificate, no tamper-evident seal, and no audit trail. It is a picture of your signature placed on a page, which is fine for most routine paperwork and not fine for documents that require certified signing.

## Sign with Markup: step by step

1. Save the attachment to Files first. In Mail, tap the attachment, then the share button, then **Save to Files**. Choose a folder you can find again. Do not sign from the mail preview if you can avoid it.
2. Open the Files app and tap the PDF once. It opens in a preview with a toolbar at the top.
3. Tap the Markup button, which looks like a pen tip. If the toolbar is hidden, tap the page once to bring it back.
4. Tap the **plus** button in the Markup toolbar, then choose **Signature**.
5. If you have no saved signature, tap **Add or Remove Signature**, then the **plus** button, and sign with a finger or an Apple Pencil. Tap **Done** when the signature looks right. Sign larger than you think you need; a tiny signature becomes a blur when printed.
6. Drag the signature onto the signature line. Use the corner handles to resize it. Keep it inside the line rather than covering the printed text above it.
7. If the form asks for a printed name, date, or initials, tap **plus** again and choose **Text**. Type the value, then drag the text box into place. For initials, create a second saved signature containing only your initials.
8. Tap **Done** in the top corner. Markup writes the annotations into the file you opened.

If the document has several signature lines, place the signature on the correct one. On a two-party agreement, signing above the other party's name is a common and embarrassing mistake. Zoom in before you drag.

## Save a copy, do not overwrite the only version

Markup saves changes into the open file when you tap Done. There is no Save As inside the Markup screen, and there is no version history you can rely on. If you sign the only copy and then notice the signature is crooked or on the wrong line, you may have to request a fresh copy from the sender.

Before you start:

1. In Files, touch and hold the PDF and choose **Duplicate**. A second copy appears with "copy" in the name.
2. Rename the copy before opening it. Something like `agreement-signed.pdf` is clearer than `agreement copy 2.pdf`.
3. Sign the copy and leave the original untouched.
4. After saving, open the file again and confirm the signature is visible. Then check the file's modification time in the Files list.

If the PDF lives in iCloud Drive, wait for the upload to finish before you close the app or switch devices. The Files app shows a cloud icon while a file is still syncing. Sending a version that has not finished syncing can produce an empty or older attachment on the recipient's side.

## When the signature needs to be flattened

Flattening means converting annotations into page content. After flattening, the signature is no longer a separate object that can be moved or removed. Every viewer shows it, including simple viewers that ignore annotation layers, and print pipelines cannot drop it.

You need to flatten when:

- The recipient's portal strips annotations on upload. Some government and HR systems do this, and the signature disappears even though it looked fine on your phone.
- The document will be printed by someone else, and you cannot confirm which application they use.
- The file is going into an archive or a records system that requires a fixed appearance.
- A reviewer might otherwise move or delete the signature by accident.
- The receiving workflow rejects files that still contain annotation objects.

There are two practical routes on an iPhone. The first is to print the signed file and save the print output as a PDF: tap the share button, choose **Print**, then use the share option on the print preview to send the rendered document back to Files. This re-renders the page, which can soften images and may drop links, so check the result at full size. The second is to move the file to a computer and run it through a flattening tool, which is more reliable for anything important.

The [Fill & Sign tool](/tools/fill-sign) handles the whole sequence in one place on a larger screen: type into fields, add a signature, then produce a document with the values fixed as page content. That is a better fit than Markup when the form has real fields and the recipient expects them filled.

## When a drawn or typed signature is not enough

A drawn signature on a PDF is usually acceptable for everyday business: a lease, a permission slip, a vendor form, an internal approval. Electronic signature law in the United States and the European Union generally treats a signature made on a screen as valid when the parties intend it to be, with exceptions.

It is not enough when:

- The document requires a wet-ink signature. Some deeds, court filings, and agency forms still say so explicitly.
- The document is excluded from electronic signature rules. Wills, adoption papers, divorce decrees, and certain court orders are common examples in the United States. Rules vary by state and country.
- The recipient requires a certified e-signature platform with identity checks, a timestamp, and an audit trail. A finger drawing has none of those.
- The form has a signature field that validates cryptographically, not just visually.
- A notary must witness the signing. Remote notarization exists, but it is a separate process with its own requirements.
- Your employer, bank, or insurer has told you to use their system.

If any of those apply, ask the sender before you spend time on a signature that will be rejected. A quick reply now is cheaper than a redo later.

## Common mistakes

- Signing the mail attachment preview instead of saving the file first. Edits can be lost when the preview closes.
- Signing the wrong copy because the duplicate was not renamed.
- Placing the signature over the printed signature line but also over the date or title text.
- Using a very thin, faint signature that disappears when printed in black and white.
- Forgetting initials on pages that have an initials box at the bottom.
- Assuming a typed name in a text box counts as a signature when the form asks for one. It may, but a drawn signature is harder to dispute.
- Flattening before adding the date, so the date has to be added as a separate annotation later.
- Sending the file before iCloud finishes syncing.

## When this fails

If the Markup button does not appear, the file may be open in a read-only location or provided by an app that does not support editing. Copy it to **On My iPhone** and try again. If it is inside a ZIP, extract it first; Markup does not work on a file inside an archive.

If the PDF is password-protected, Files may open it in a read-only preview. Unlock it in a viewer that supports editing, remove the protection if you have permission, and then sign.

If the signature will not stick after you tap Done, check whether you tapped Done in the signature editor rather than the Markup toolbar. Also confirm the file is not locked or stored on a read-only volume.

If the form is a dynamic XFA form, the iPhone may render it poorly or show only a message asking for Adobe software. Signing that kind of form on a phone is unreliable. Use a desktop viewer or ask the sender for a flattened version.

If the recipient says the signature is missing, the file was probably flattened incorrectly or the portal stripped the annotation. Re-send a flattened copy and ask them to confirm before the deadline.

## Related reading

- [Signature generator](/tools/signature)
- [Fill out a PDF form without printing](/guides/fill-pdf-form-without-printing)
