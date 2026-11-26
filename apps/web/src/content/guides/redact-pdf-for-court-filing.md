---
title: "Redacting a PDF for Court Filing: A Checklist"
description: "A pre-filing checklist for redacting documents: finding every instance, cleaning the text layer and metadata, flattening, verifying, and keeping a sealed copy."
slug: "redact-pdf-for-court-filing"
category: "Legal & compliance"
publishedAt: "2026-11-26"
updatedAt: "2026-11-26"
relatedTools:
  - redact-pdf
  - remove-annotations
relatedGuides: []
faq:
  - "What must be redacted before a court filing? :: Whatever the rules and the order in the case require: personal identifiers, names of minors, account numbers, and anything under a protective order."
  - "Do I need to redact metadata as well as text? :: Yes. Author names, file paths and earlier revisions can disclose more than the visible page, so remove them before filing."
  - "Should I keep an unredacted copy? :: Keep a sealed copy for your own record and for the court if it asks. Never file it by mistake, and label it clearly."
draft: false
---

The filing is due in twenty minutes. The brief is final, the exhibits are scanned, and someone notices that the minor's name is still in paragraph 14. A quick pass with the black rectangle tool, a save, an upload, and the deadline is met. Two days later the clerk's office calls.

Most sealed-information leaks are not caused by a lack of care about confidentiality. They are caused by a process that treats redaction as a formatting step done at the end, under time pressure, with a tool that makes covering easier than removing.

This checklist is built for that last hour. Work through it in order, and do not skip the verification step because the clock is short. A late filing can be fixed. A disclosure cannot.

## Before you open the file

1. **Read the order.** Identify what must be redacted in this case: minors' names, dates of birth, Social Security numbers, financial account numbers, home addresses, medical information, the identities of victims or informants, trade secrets. Local rules, the judge's standing order and any protective order may each add or remove items.
2. **Confirm the version.** Get the final document from the person who edited it last, not from an earlier email thread. Ask them to confirm that no tracked changes or comments remain.
3. **Set aside the unredacted source.** Copy it to a restricted location before you begin. The copy you work on from here is disposable; the source is the record.
4. **Check the deadline and the filing method.** If the document is being filed under seal, confirm the procedure for the sealed and public versions. Some courts require a motion to seal, some allow a notice, and some have a specific event in the filing system.

## The pre-filing checklist

### 1. Identify every instance

Do not rely on memory. Build a list of every term that has to go, then work through the document against that list:

- Full legal names, maiden names, former names, nicknames and initials.
- Dates of birth and, where required, full dates of treatment or incident.
- Social Security numbers in any format, including partial numbers.
- Account, policy, loan and card numbers.
- Street addresses, unit numbers and, where required, cities and ZIP codes.
- Phone numbers, email addresses and employer names.
- Medical diagnoses, treatment details and prescription information.
- Names of minors, and any combination of details that could identify them.
- Trade secrets and confidential business terms covered by a protective order.
- Any category named in the order that applies to this case.

Write the list into a separate working note. It becomes your test plan in step 6.

### 2. Search before you mark

Run each term through the viewer's search and note every page. Search for fragments as well as full strings: the last name alone, the first four digits of an account, the initial plus surname.

Scanned documents add a complication. OCR is imperfect, and a name that appears as "Srnith" in the text layer will not be found by a search for "Smith." Search for the digits and the distinctive parts separately, and plan to review every page visually as well. If the document is short, visual review may be faster and more reliable than search.

### 3. Check the text layer and the OCR layer

Open the file and try to select text on the page you intend to redact. If the text highlights, there is a text layer. If the page is a scan with OCR, there is a hidden text layer even when selection feels imprecise.

For a scan, decide the order of operations. If you redact the image and the OCR layer survives, the text is still there. If you re-OCR after redaction, the engine reads only what is visible, which is usually safer, but check the output anyway.

You can inspect the text layer without a GUI using `pdftotext` from Poppler. Dump the text, search it for each term, and keep the dump out of the filing folder.

### 4. Remove annotations, comments, attachments and bookmarks

Redaction removes page content. It does not necessarily remove everything else in the file:

- Comments and sticky notes, including any text quoted from the page.
- Highlight and markup annotations.
- Form fields and their values.
- Attachments and embedded files, including the original Word document.
- Bookmarks and named destinations that spell out a party's name.
- Hidden layers and optional content groups.
- Links and actions that point to an internal file path or a website.

Use [Remove Annotations](/tools/remove-annotations) for the comment and markup layer, then check the attachment and bookmark panels manually. Removing annotations is not a substitute for redaction, and redaction is not a substitute for removing annotations. Do both.

### 5. Apply true redaction

Open [Redact PDF](/tools/redact-pdf), load the working copy, and draw a box over every instance on your list. Then apply the redaction. Marking without applying leaves the content in place, which is the single most common cause of a leak.

Work page by page against your list. When you finish a page, check it off. Do not redact from memory while scrolling.

### 6. Flatten if the file needs it

Flattening bakes annotations, form fields and appearances into the page. It is useful for a file that must not change after filing, and for forms that were completed and signed. It is not a redaction method.

If you flatten, do it after the redaction and after the annotation removal, then verify again. Flattening changes the file, and some tools change what is extractable in the process.

### 7. Verify the export

This is the step that catches the mistakes. Run it against the file you are about to upload, not the working copy:

1. Select all, copy, and paste into a plain text editor. Search the pasted text for every term on your list.
2. Search inside the PDF for the same terms and for fragments.
3. Open File > Properties and check author, title, subject, keywords and any custom fields.
4. Open the comments, attachments and bookmarks panels and confirm they are empty.
5. Scroll every page at a readable zoom. Look for faint text, partially covered lines and content outside the visible page area.
6. Check the file size and page count against the original. A large drop can mean pages were lost; a large increase can mean an attachment was added.
7. Have a second person check a sample. A fresh reader sees what the drafter has stopped noticing.

If a term survives, return to the working copy, fix it, export again, and repeat the whole verification. Do not patch the export.

### 8. Name the file correctly

Follow the local rule or the filing system's convention. A common pattern is case number, document title and date, with no spaces or special characters. Avoid "final," "final2," "v3" and "redacted" in the name if the court's convention does not use them. The file name is visible to the clerk and often to the public docket.

Check the document's internal title field as well. A PDF exported from Word can carry the original file name, which may include a client name or a matter description.

### 9. Keep the unredacted sealed copy

Store the unredacted version in a restricted location with access limited to the people who need it. Record who has access, when the copy was created and where it is kept. If the court requires a sealed version, file it through the correct event and confirm that it is actually sealed, not merely labeled.

Keep the redaction list and the verification notes with the sealed copy, not with the public filing.

### 10. Download and check what you filed

After the upload, download the filed version from the court's system and open it. Confirm that it is the file you verified, that the page count matches and that the redactions are still in place. Filing systems sometimes reprocess PDFs, and a file that was clean on your desktop is not necessarily clean after the system touches it.

## Search terms people forget

- Maiden names and former married names.
- Hyphenated and unhyphenated versions of a surname.
- Nicknames and initials used in medical records.
- The names of the parties' children, even when the children are not parties.
- Employer names, which can identify a person in a small town.
- The name of a treatment facility or a specialist, combined with a date.
- Account numbers with and without dashes or spaces.
- The last four digits of a Social Security number.
- Street names without the house number.
- Email addresses and usernames.

Add case-specific terms as you find them. The list grows as you read.

## Common mistakes that cause leaks

- **Marking redactions and never applying them.** The file looks redacted on screen and is not.
- **Using the comment or shape tool.** A rectangle is an annotation, not a redaction.
- **Redacting one exhibit and not the others.** The main document is clean and Exhibit C is not.
- **Leaving the original in the same folder you upload from.** It is easy to grab the wrong file at 4:55 p.m.
- **Forgetting the metadata.** The author field names the client, or the title field contains the original file name.
- **Leaving a comment that quotes the redacted sentence.** The page is clean and the comment panel is not.
- **Missing the header or footer.** Names and account numbers repeat on every page of a scanned statement.
- **Relying on the filing portal to redact.** Some systems accept a redaction request; many do not, and none should be trusted to catch what you missed.
- **Filing the sealed and public versions in the wrong categories.** Confirm the event codes before you upload.
- **Not checking the filed copy.** The upload can fail silently or attach the wrong file.

## When the filing system rejects the file

Some courts cap file size, reject certain PDF versions or refuse files with specific fonts. If the upload fails, do not run the file through an online compressor that rebuilds it. A compressor can strip redactions or reintroduce content from the source. Use a local tool that preserves the page content, then verify the compressed file from scratch.

If the court requires a PDF/A version, convert a copy and check the redactions again. Conversion can flatten some elements and preserve others in ways that are hard to predict.

If the deadline is imminent and the file cannot be fixed, call the clerk's office. Many courts have a process for a corrective filing, and a phone call before the deadline is better than a silent disclosure after it.

## Related reading

- [Redact PDF](/tools/redact-pdf) — apply redactions that remove the text, not just the view.
- [HIPAA and PDFs: What Redaction Actually Requires](/guides/hipaa-pdf-redaction) — the same verification discipline for protected health information.
