---
title: "Sending Tax Documents as PDFs Without Exposing Your SSN"
description: "Which identifiers appear on W-2s and returns, how to redact rather than mask, and how to send a protected PDF to a preparer without using email."
slug: "send-tax-documents-safely"
category: "Tax & finance"
publishedAt: "2026-11-26"
updatedAt: "2026-11-26"
relatedTools:
  - redact-pdf
  - protect-pdf
relatedGuides: []
draft: true
---

> **NEEDS HUMAN EDIT** — do not publish until every box is checked.
> - [ ] Verify: the box references on the W-2, 1099, 1040, and 1098 against the current-year forms, since box numbers and layouts change.
> - [ ] Add: a screenshot of the same page before and after true redaction, with the text selected in the "before" version to show the digits were still there.
> - [ ] Check: the IRS recordkeeping periods, the e-file signature rules, and the claim that altering a statement can constitute fraud with a qualified tax professional or attorney.

A W-2 is one page, but it carries the two identifiers that matter most for identity theft: your Social Security number and your employer's tax ID. Sending it to a preparer should be routine. Sending it through the wrong channel turns a routine errand into a copy of your tax return sitting in two mailboxes, a backup, and a spam filter you cannot inspect.

## What is actually printed on the forms

Before you decide what to hide, know what is there. The exact layout changes between years, so check the form in front of you rather than a remembered version.

- **Form W-2.** Box a holds your SSN. Box b holds the employer's EIN. Boxes 1 through 14 hold wages, withholding, Social Security and Medicare amounts, and coded items. Box 12 codes can reveal retirement contributions or health coverage.
- **Form 1099-NEC and 1099-MISC.** The recipient's TIN is usually an SSN for a sole proprietor and an EIN for a company. The payer's TIN is also present. Nonemployee compensation appears in a box near the top.
- **Form 1040.** Your SSN and your spouse's SSN appear at the top. Dependents' SSNs appear in the dependent section. Direct deposit routing and account numbers appear near the refund line.
- **Form 1098.** The borrower's SSN, the loan number, and the property address appear together, which makes a single page enough to link a person to a mortgage.
- **Schedules and statements.** Schedule C can include a business EIN and a home address. Brokerage 1099-B summaries can include account numbers.

The preparer usually needs your name, SSN, and the income figures. They do not need your bank account number unless you are setting up direct deposit through them. They rarely need a dependents' full SSN unless those dependents are being claimed.

## Redacting is not the same as covering

This is the mistake that matters most. Drawing a black rectangle with a comment or markup tool hides the digits on screen. It does not remove them from the file. The text is still underneath, selectable and copyable, and any text extraction will find it.

True redaction removes the underlying characters and image content in the marked area, then typically flattens that region into an image so nothing remains to select. Some tools also remove hidden metadata, which is worth doing.

To tell the difference, test your output rather than trusting the label:

1. Open the redacted file in a PDF reader.
2. Press `Ctrl+F` and search for the last four digits of the number you redacted.
3. Try to select the black box with the text tool and copy it into a plain text editor.
4. Check the document properties for author, title, and subject fields that may still contain the number.
5. If the file has attachments or layers, check those too.

If the search finds a hit, the redaction failed. A black box is a visual cover, not a removal.

## Redacting a tax form step by step

1. Open [Redact PDF](/tools/redact-pdf) and load the document. Work on a copy, never the only file.
2. Identify every instance of the identifier, not just the first page. A W-2 may repeat the SSN in a summary section, and a return may repeat it on every schedule.
3. Draw a box that fully covers the digits, with a little margin. Partial coverage is how the first and last digits survive.
4. Apply the redaction, not just an annotation. The tool should mark the area as permanently removed.
5. Export and download the result under a new filename.
6. Reopen the exported file and repeat the search test above.
7. Only then send it.

If you are masking for your own records rather than sending, a black box is fine, because the file stays with you. The distinction matters the moment the file leaves your machine.

## Masking versus redacting for a preparer

There is a real tension here. A paid preparer who e-files your return generally needs the full SSN to submit it, and a masked form may be rejected by their software or by the IRS. A bookkeeper who only needs to categorize expenses may need nothing more than the last four digits and the amounts.

Ask one question before you send anything: "Which identifiers do you need, and through which portal should I send them?" A good preparer answers immediately and points you at a client portal. A preparer who asks you to text a photo of your W-2 is telling you something about their process.

A workable split looks like this:

- Send the full form through the preparer's encrypted portal when they need it to file.
- Send a redacted version by email only when they have confirmed that a masked copy is enough.
- Never send both versions in the same thread, because the redacted one creates a false sense of safety.
- Keep the unredacted originals at home in an encrypted archive.

## Why email is the wrong channel

Email is convenient, which is exactly the problem. A message with a W-2 attached creates copies in your Sent folder, the recipient's inbox, both providers' backups, and any mail gateway that scans attachments. It survives forwarding, auto-replies, and shared inboxes. If either account is compromised later, the attachment may still be there.

Transport encryption protects the message in transit. It does not control what happens at either end. A mistyped address, an autocomplete suggestion, or a reply-all can expose the file to someone who should never have seen it. The subject line and filename often carry more than people realize.

Use the preparer's portal when one exists. If it does not, use a shared folder with an expiry date and access limited to the preparer's address. If email is the only option, protect the file first and send the password through a different channel.

## Protecting a PDF and sharing the password out of band

A password-protected PDF encrypts the contents at rest. Someone who intercepts the file still needs the password. That is a meaningful improvement over a plain attachment.

1. Open [Protect PDF](/tools/protect-pdf) and load the file.
2. Set an open password, meaning the password required to view the document. Use a long random phrase, not a birth year or a pet name.
3. Set permissions if the tool offers them. Restricting printing and copying is a speed bump, not a guarantee, because anyone who can view the page can photograph it.
4. Save the protected copy under a neutral filename.
5. Send the file through email or the portal.
6. Send the password by phone call, text message, or a separate message to a different address. Never in the same email, and never in the subject line.

Two practical cautions. First, some tax software and some portals cannot open encrypted PDFs, so ask before you protect. Second, an old reader may not support the encryption level the tool used. If the preparer says the file will not open, export with a more widely supported setting or fall back to the portal.

## File naming that does not leak

The filename travels with the file into email subjects, cloud sync logs, backup catalogs, print queues, and support tickets. A file called `SSN-123-45-6789.pdf` defeats every other precaution.

Use a pattern that identifies the document without identifying the person:

- `2025-w2-acme-employer.pdf`
- `2025-1099-nec-client-name.pdf`
- `2025-return-draft-v2.pdf`

Avoid the full SSN, the account number, and the words "tax return" combined with a year and a full name in a public folder. If you need to distinguish family members, use initials rather than full names.

## What to keep and what to send

Keep the complete set at home: every W-2, every 1099, the return as filed, and the acknowledgment. Send only the documents the preparer asked for. Sending everything "just in case" multiplies the exposure without helping the return.

Record retention is a tax question, not a PDF question. The IRS publishes guidance on how long to keep records, and the period depends on the situation, including whether you claimed a loss or omitted income. Check the current IRS guidance rather than relying on a number you heard once. Store the archive encrypted, and keep a second copy somewhere that is not the same laptop.

## Common mistakes

- Drawing black rectangles and assuming the digits are gone.
- Redacting the first page and missing a repeated SSN on a schedule.
- Emailing the password in the same message as the file.
- Using a weak password that can be guessed from public information.
- Sending the unredacted original "for reference" after sending a redacted copy.
- Naming the file after the SSN.
- Protecting a PDF that the preparer's software cannot open, then missing the filing deadline.
- Photographing a form on a phone, which adds location metadata and reduces legibility.
- Sending prior-year returns that nobody asked for.

## When this fails

Redaction can fail silently when the tool only adds an annotation. Search the output before sending. It can also fail when the PDF is a scan with an OCR text layer, because covering the visible digits may leave the recognized text in place; flattening the page or running OCR again on the redacted version helps. Password protection can fail when the recipient's software does not support the encryption, when the password is sent through the same compromised mailbox, or when the file is forwarded along with the password in the thread. And sometimes the real failure is procedural: the preparer needed the full identifier, you sent a masked copy, and the return was delayed. Ask first, then redact to that answer.

## Related reading

- [Protect a PDF with a password](/tools/protect-pdf)
- [Is it safe to upload a PDF to an online tool?](/guides/is-it-safe-to-upload-a-pdf)
