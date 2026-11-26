/**
 * Per-tool answers for the compact FAQ under each live tool.
 *
 * These are written for the question a visitor actually types — "how do I
 * merge PDFs", "does this upload my file", "what is the limit" — not for a
 * keyword list. Only live tools get an entry: a coming-soon page should explain
 * the decision, not answer questions about a tool that cannot run yet.
 *
 * The copy is also imported by `build/prerender.ts`, so the FAQ is present in
 * the HTML a crawler receives without JavaScript. Keep this module free of
 * React and registry imports for that reason.
 */

export interface ToolFaqItem {
  question: string;
  answer: string;
}

export const TOOL_FAQS: Record<string, readonly ToolFaqItem[]> = {
  'merge-pdf': [
    {
      question: 'How do I merge PDF files?',
      answer:
        'Add two or more PDFs, drag the rows into the order you want, then choose Merge PDF. You get one combined PDF to download.',
    },
    {
      question: 'Can I merge only some pages from each file?',
      answer:
        'Merge works on whole documents. To pick individual pages, use Extract Pages on each file first, then merge the extracts.',
    },
    {
      question: 'Does merging reduce the quality of my PDFs?',
      answer:
        'No. Pages are copied into the new document rather than re-rendered, so text stays selectable and images keep their original resolution.',
    },
    {
      question: 'Is there a limit on how many PDFs I can combine?',
      answer:
        'One run can hold up to 500 pages and 250 MB in total, with a 100 MB limit per file. The list shows the combined page count as you add files.',
    },
    {
      question: 'Are my PDFs uploaded when I merge them?',
      answer:
        'No. The files are read and combined by a worker inside this browser tab. Nothing is uploaded, stored, or seen by a server.',
    },
    {
      question: 'Is Merge PDF free to use?',
      answer:
        'Yes. There is no charge, account, watermark or per-task quota. The only ceiling is the 500-page and 250 MB browser limit stated above.',
    },
    {
      question: 'Does it work on a phone or tablet?',
      answer:
        'Yes, in any modern mobile browser. You can add files from the system picker and reorder them with touch, though very large documents are limited by the device’s memory.',
    },
  ],

  'organize-pdf': [
    {
      question: 'How do I reorder pages in a PDF?',
      answer:
        'Drop the PDF in, then drag page thumbnails into the order you want. Choose Save pages to download the reordered document.',
    },
    {
      question: 'Can I delete or duplicate a page?',
      answer:
        'Yes. Select a thumbnail and use the duplicate or delete action. Nothing is written until you save, so you can undo changes by leaving the page as it was.',
    },
    {
      question: 'Does reordering change the page content?',
      answer:
        'No. The tool copies pages into a new document, so text, links, images and forms keep their quality. The original file on your device is untouched.',
    },
    {
      question: 'How many pages can I organize at once?',
      answer:
        'Up to 500 pages per run, with no account or task quota. Very large files may be limited by the memory available to your browser.',
    },
    {
      question: 'Are my pages uploaded to a server?',
      answer:
        'No. Page parsing and the final rebuild happen inside a worker in this tab. Your document never leaves the device.',
    },
  ],

  'pdf-to-jpg': [
    {
      question: 'How do I convert a PDF to JPG?',
      answer:
        'Choose a PDF, pick JPG or PNG, set an image width and page range, then convert. Each page becomes its own image, and the download is a ZIP.',
    },
    {
      question: 'Should I choose JPG or PNG?',
      answer:
        'JPG is smaller and works well for photos and scans. PNG is lossless and is the better choice for text-heavy pages, charts or line art.',
    },
    {
      question: 'Can I convert only certain pages?',
      answer:
        'Yes. Enter a range such as 1-3, 7 or leave the field empty to render every page. The output counter shows how many images you will get.',
    },
    {
      question: 'What image width should I use?',
      answer:
        '1600 px is a good general default. Choose 960 px for web use, or 2560 px when you need print-quality images.',
    },
    {
      question: 'Are my PDFs uploaded during conversion?',
      answer:
        'No. The pages are rendered to images inside this browser tab. Nothing is uploaded, and the images are downloaded directly from your device.',
    },
  ],

  'delete-pages': [
    {
      question: 'How do I delete pages from a PDF?',
      answer:
        'Add the PDF, select the page thumbnails you want to remove, then save. The download contains only the pages you kept.',
    },
    {
      question: 'Can I delete several pages at once?',
      answer:
        'Yes. Select any number of thumbnails before removing them. You can also change your selection before saving if you pick the wrong page.',
    },
    {
      question: 'Does deleting pages affect the rest of the document?',
      answer:
        'No. The remaining pages are copied as they are, so text and images stay sharp. Your original file is never modified.',
    },
    {
      question: 'Is there a page limit for deleting pages?',
      answer:
        'Up to 500 pages and 250 MB per run, with a 100 MB limit per file. That covers ordinary reports, contracts and scanned documents.',
    },
    {
      question: 'Are my files uploaded?',
      answer:
        'No. The PDF is parsed and rebuilt in this browser tab, and the result is downloaded from memory. No server receives the document.',
    },
  ],

  'extract-pages': [
    {
      question: 'How do I extract pages from a PDF?',
      answer:
        'Add the PDF, enter the pages you want such as 1-3, 7, then extract. You get a new PDF containing those pages in document order.',
    },
    {
      question: 'Can I extract pages that are not next to each other?',
      answer:
        'Yes. Use commas and ranges together, for example 2, 5-7, 12. The preview confirms which pages matched before the job runs.',
    },
    {
      question: 'Can I extract each page into its own file?',
      answer:
        'Extract Pages produces one PDF from your selection. To get separate files, use Split by pages and choose a chunk size of 1.',
    },
    {
      question: 'Does extracting pages reduce quality?',
      answer:
        'No. Pages are copied into the new document, so text stays selectable and images keep their resolution. The source file is left untouched.',
    },
    {
      question: 'Are my PDFs uploaded when extracting pages?',
      answer:
        'No. The extraction runs in a worker in this browser tab, and the new PDF is assembled locally. Nothing is sent to a server.',
    },
  ],

  'rotate-pdf': [
    {
      question: 'How do I rotate a PDF?',
      answer:
        'Add the PDF and use the left or right arrow on a page, or rotate every page at once. Save to download the document with the new rotation.',
    },
    {
      question: 'Can I rotate only one page?',
      answer:
        'Yes. Each page has its own controls, so you can fix a single sideways scan without changing the rest of the document.',
    },
    {
      question: 'Is the rotation saved permanently?',
      answer:
        'It is saved in the PDF you download. Your original file is not changed, so you can always go back to it.',
    },
    {
      question: 'Does rotating a PDF reduce its quality?',
      answer:
        'No. The page’s rotation is updated rather than the page being re-rendered, so text and images stay as sharp as they were.',
    },
    {
      question: 'Are my files uploaded when rotating?',
      answer:
        'No. Rotation is applied inside this browser tab and the result is downloaded locally. Nothing is uploaded or stored.',
    },
  ],

  'split-by-pages': [
    {
      question: 'How do I split a PDF into multiple files?',
      answer:
        'Choose a PDF and a chunk size, such as every 5 pages. The tool creates a ZIP with one PDF per chunk, ready to download.',
    },
    {
      question: 'Can I split every 1, 5 or 10 pages?',
      answer:
        'Yes. Set the chunk size to the number of pages each output file should contain. The last file may be shorter if the pages do not divide evenly.',
    },
    {
      question: 'What happens if the split creates too many files?',
      answer:
        'One run can produce at most 100 output files. If your chunk size would exceed that, increase it or use Split by bookmarks for chapter-based splitting.',
    },
    {
      question: 'Does splitting change the pages?',
      answer:
        'No. Pages are copied into the new files, so text and images keep their quality. The original PDF stays untouched.',
    },
    {
      question: 'Are my PDFs uploaded?',
      answer:
        'No. The split and the ZIP are built in this browser tab. Your document never reaches a server.',
    },
  ],

  'alternate-mix': [
    {
      question: 'What does Alternate & Mix do?',
      answer:
        'It interleaves two PDFs page by page: A1, B1, A2, B2. It is useful for putting front and back scans of the same document back into reading order.',
    },
    {
      question: 'Which document should come first?',
      answer:
        'Choose File A or File B as the starting document. The other file’s pages follow it in each round, and any extra pages are appended at the end.',
    },
    {
      question: 'How many files can I mix at once?',
      answer:
        'Exactly two PDFs per run, up to 500 pages and 250 MB combined. Extra files added to the dropzone are ignored with a warning.',
    },
    {
      question: 'Does mixing preserve page quality?',
      answer:
        'Yes. Pages are copied, not re-rendered, so text remains selectable and images keep their original resolution.',
    },
    {
      question: 'Are my files uploaded?',
      answer:
        'No. Both PDFs are read and combined inside this browser tab. Nothing is uploaded or stored on a server.',
    },
  ],

  'split-in-half': [
    {
      question: 'What does Split in half do?',
      answer:
        'It cuts every page down the middle and gives you two PDFs: one with the left halves and one with the right halves, or top and bottom depending on the direction you choose.',
    },
    {
      question: 'When would I use this?',
      answer:
        'It is made for scanned book spreads and two-up documents, where each scanned page actually contains two pages side by side.',
    },
    {
      question: 'Can I choose vertical or horizontal cuts?',
      answer:
        'Yes. Vertical produces left and right halves; horizontal produces top and bottom halves. Choose the direction that matches your scan before running the split.',
    },
    {
      question: 'Is the original PDF changed?',
      answer:
        'No. The tool builds new documents and leaves your source file untouched. You can try the other direction and compare the results.',
    },
    {
      question: 'Are my files uploaded?',
      answer:
        'No. The pages are split locally in this browser tab. Nothing is uploaded, and both halves download directly from your device.',
    },
  ],

  'page-numbers': [
    {
      question: 'How do I add page numbers to a PDF?',
      answer:
        'Add the PDF, choose a number format or type your own, pick a position and margin, then apply. The numbers are drawn on every page.',
    },
    {
      question: 'Can I choose the number format?',
      answer:
        'Yes. Use a ready-made format or type a pattern with {n} for the current page and {N} for the total, such as Page {n} of {N}.',
    },
    {
      question: 'Can I start numbering from a page other than 1?',
      answer:
        'This tool numbers every page starting at 1. To number only a section, use Extract Pages to split out the pages you need and number that file separately.',
    },
    {
      question: 'Do page numbers affect the document’s text?',
      answer:
        'The numbers are added as real vector text, so they stay sharp and searchable. The rest of the page content is not re-rendered.',
    },
    {
      question: 'Are my files uploaded?',
      answer:
        'No. The numbering is applied inside this browser tab. Nothing is uploaded and no account is required.',
    },
  ],

  'crop-pdf': [
    {
      question: 'How do I crop a PDF?',
      answer:
        'Add the PDF, set the top, bottom, left and right margins, check the preview on page 1, then apply. Every page is cropped to the same rectangle.',
    },
    {
      question: 'Can I crop a different area on each page?',
      answer:
        'Not in this tool: the same margins are applied to all pages. If pages need different crops, crop them in separate runs and merge the results.',
    },
    {
      question: 'Does cropping cut off content permanently?',
      answer:
        'The crop hides everything outside the rectangle, and the downloaded file is cropped. Your original PDF is not modified, so keep it if you may need the full page later.',
    },
    {
      question: 'Does cropping reduce quality?',
      answer:
        'No. Cropping sets a smaller visible area rather than rasterizing the page, so text stays vector and selectable.',
    },
    {
      question: 'Are my PDFs uploaded when cropping?',
      answer:
        'No. The preview and the cropped output are produced in this browser tab. Nothing is uploaded or stored.',
    },
  ],

  'header-footer': [
    {
      question: 'How do I add a header or footer to a PDF?',
      answer:
        'Add the PDF, type the header and footer text, choose positions and a margin, then apply. The text is added to every page.',
    },
    {
      question: 'Can I include the page number and total?',
      answer:
        'Yes. Use {n} for the current page and {N} for the total number of pages, for example Confidential · {n} / {N}.',
    },
    {
      question: 'Can I add a header without a footer?',
      answer:
        'Yes. Fill in only the header field and leave the footer empty, or the other way around. The tool only draws what you enter.',
    },
    {
      question: 'Will the header cover the document’s content?',
      answer:
        'The text is placed in the margin you set. If a page has content very close to the edge, increase the margin so the header or footer does not overlap it.',
    },
    {
      question: 'Are my files uploaded?',
      answer:
        'No. The header and footer are drawn locally in this browser tab. Nothing is uploaded and no account is required.',
    },
  ],

  'n-up': [
    {
      question: 'What is N-up printing?',
      answer:
        'N-up puts several PDF pages onto one sheet: 2, 4 or 8 pages per page. It saves paper when you print a long document or want a quick overview.',
    },
    {
      question: 'How do I put 2 or 4 pages on one sheet?',
      answer:
        'Add the PDF, choose 2-up, 4-up or 8-up, pick a paper size, then create the new PDF. The output pages are arranged in reading order.',
    },
    {
      question: 'Can I choose the sheet size?',
      answer:
        'Yes. A4 and Letter landscape presets are available, and the pages are fitted into each slot without being stretched.',
    },
    {
      question: 'Does N-up keep text selectable?',
      answer:
        'Yes. Pages are embedded into the sheet rather than rasterized, so text stays selectable and searchable, just smaller. The layout and reading order change, so keep the source if you need full-size pages.',
    },
    {
      question: 'Are my files uploaded?',
      answer:
        'No. The imposition runs in this browser tab. Nothing is uploaded and the result downloads directly from your device.',
    },
  ],

  'edit-pdf': [
    {
      question: 'How do I edit a PDF in the browser?',
      answer:
        'Open the PDF in the editor, add text, images, shapes or annotations, then save. Edits are previewed on the real page before you export.',
    },
    {
      question: 'Can I edit existing text in a PDF?',
      answer:
        'Yes. Click a text run to change it, or add a new text box over the page. Use the inspector to adjust size, colour and alignment.',
    },
    {
      question: 'Can I move or delete pages in the editor?',
      answer:
        'Yes. The page rail lets you reorder, duplicate and delete pages, and the changes are applied when you export.',
    },
    {
      question: 'Will editing flatten my whole PDF?',
      answer:
        'No. Text edits and new objects are written into the document without turning every page into an image, so unaffected text stays sharp and selectable.',
    },
    {
      question: 'Can I undo a change?',
      answer:
        'Yes. Use undo and redo in the editor toolbar. The history covers your editing session; the original file on disk is never changed until you download the result.',
    },
    {
      question: 'Are my files uploaded while I edit?',
      answer:
        'No. The document is parsed and edited in this browser tab. Nothing is uploaded and no account is required.',
    },
  ],

  'redact-pdf': [
    {
      question: 'How do I redact a PDF?',
      answer:
        'Open the PDF, draw a box over each area to remove, then review the marks and apply redaction. The tool rebuilds the pages without the hidden content.',
    },
    {
      question: 'Is the content really deleted, or just covered?',
      answer:
        'It is rebuilt without the marked content. A black rectangle drawn over text would still leave the text in the file; this tool removes it and verifies the result before export.',
    },
    {
      question: 'Can I redact text that appears on many pages?',
      answer:
        'Yes. Mark each occurrence, or use the search and AI assist to find likely sensitive regions. Every region is reviewed before the destructive run.',
    },
    {
      question: 'What are the redaction limits?',
      answer:
        'Up to 150 pages and 500 regions per run, and the rebuilt output must stay under 100 MB. Redacted pages become images, so the page cap is lower than ordinary editing.',
    },
    {
      question: 'How can I prove a redaction worked?',
      answer:
        'The export includes a receipt, and the Verify page can independently check any redacted PDF. It searches the file for the marked text rather than trusting the preview.',
    },
    {
      question: 'Are my files uploaded during redaction?',
      answer:
        'No. Redaction runs locally in this browser tab. Your document is never uploaded, which matters most for the files people usually redact.',
    },
  ],

  'summarize-pdf': [
    {
      question: 'How do I summarize a PDF?',
      answer:
        'Open the PDF, connect an AI provider, then run the summary. You get a short overview with page citations you can click to check the source.',
    },
    {
      question: 'Is the summary grounded in the document?',
      answer:
        'Yes. The assistant reads the page text and cites the pages it used. It is still a model output, so use the citations to verify important claims.',
    },
    {
      question: 'Do I need my own API key?',
      answer:
        'You can bring a key from a supported provider, or use the managed trial where available. With a key, the request goes from this browser to the provider you chose.',
    },
    {
      question: 'Does it work on scanned PDFs?',
      answer:
        'Only if the pages already contain a text layer. For image-only scans, run OCR first to add searchable text, then summarize the result.',
    },
    {
      question: 'Is my PDF uploaded to pdfshush?',
      answer:
        'The file is parsed in this browser tab. The text you ask about goes to your chosen AI provider; pdfshush does not receive the document. The managed trial is the one path where that text reaches our server.',
    },
  ],

  'chat-with-pdf': [
    {
      question: 'How do I chat with a PDF?',
      answer:
        'Open the PDF, connect a model, then ask a question in the chat panel. Answers cite the pages they came from so you can jump straight to the evidence.',
    },
    {
      question: 'Can I ask follow-up questions?',
      answer:
        'Yes. The conversation keeps its context, so you can narrow a point, ask for dates or names, and keep the thread going without restarting.',
    },
    {
      question: 'Does it read the whole document?',
      answer:
        'It reads the document text in reading order and works within the 400,000-character context limit. Very long PDFs may need to be split into sections.',
    },
    {
      question: 'Which AI providers can I use?',
      answer:
        'Bring a key from a supported provider, or use the managed trial where available. Your key is stored in this browser only and is never sent to pdfshush.',
    },
    {
      question: 'Is my PDF uploaded when I chat with it?',
      answer:
        'The file itself is parsed locally. Only the text you ask about is sent, and it goes directly to the provider you configured. The managed trial is the exception and is labelled in the provider settings.',
    },
  ],

  'edit-pdf-with-ai': [
    {
      question: 'How does Edit PDF with AI work?',
      answer:
        'Describe the change you want in plain language. The assistant proposes marks on the page, and you review each one before applying anything to the document.',
    },
    {
      question: 'Does it change my PDF automatically?',
      answer:
        'No. Nothing is written until you review the proposed marks and apply them. You can reject individual changes and keep the original wording.',
    },
    {
      question: 'What kinds of edits can it make?',
      answer:
        'It can highlight, replace, erase or insert text. It is an editing assistant, not a layout designer, so large structural changes are better done in the full editor.',
    },
    {
      question: 'Do I need an AI key?',
      answer:
        'A bring-your-own key from a supported provider is the normal path, and a managed trial is available where configured. Your key stays in this browser.',
    },
    {
      question: 'Is my PDF uploaded?',
      answer:
        'The file is parsed locally and only the text needed for your request goes to the provider. pdfshush does not receive the document in BYOK mode.',
    },
  ],

  'fill-sign': [
    {
      question: 'How do I fill and sign a PDF?',
      answer:
        'Open the PDF, click a form field to type into it, then add your signature from the signature panel. Save to download the completed document.',
    },
    {
      question: 'Can I draw or type my signature?',
      answer:
        'Yes. Draw with a mouse or finger, type a name in a signature font, or reuse a signature you already saved in this browser.',
    },
    {
      question: 'Does filling a form flatten it?',
      answer:
        'The filled form stays editable in your download. If you need the values fixed as page content, run the saved file through Flatten PDF; flattening cannot be undone.',
    },
    {
      question: 'Are my signature and document uploaded?',
      answer:
        'No. Signatures are drawn or typed in this browser and stored locally, and the PDF is edited in the tab. Nothing is uploaded.',
    },
    {
      question: 'Does it work on a touch screen?',
      answer:
        'Yes. The signature pad supports touch, and the form fields work with a tap. A stylus gives the most natural result on a tablet.',
    },
  ],

  signature: [
    {
      question: 'How do I create a signature?',
      answer:
        'Draw your signature, or type your name and choose a handwriting style. You can adjust the pen, then download the signature as a PNG, JPG or PDF.',
    },
    {
      question: 'Can I reuse the signature later?',
      answer:
        'Yes. Saved signatures stay in this browser’s local IndexedDB. There is no account, no sync and no expiry.',
    },
    {
      question: 'Which file format should I download?',
      answer:
        'PNG with a transparent background works best for placing a signature on a document. JPG is smaller but has a solid background; PDF is useful for printing.',
    },
    {
      question: 'Is my signature uploaded or stored online?',
      answer:
        'No. It is created and stored in this browser only. Nothing is uploaded, and clearing your browser data removes it.',
    },
    {
      question: 'Can I use the signature on a PDF?',
      answer:
        'Yes. Create it here, then open Fill & Sign to place it on a document. The signature stays on your device throughout.',
    },
  ],

  'flip-pdf': [
    {
      question: 'How do I flip a PDF page?',
      answer:
        'Add the PDF and click the horizontal or vertical flip control on a page. Save to download the mirrored document.',
    },
    {
      question: 'What is the difference between horizontal and vertical flip?',
      answer:
        'Horizontal mirrors the page left to right, like a reflection in a mirror. Vertical flips it top to bottom.',
    },
    {
      question: 'Can I flip every page at once?',
      answer:
        'Yes. Use the flip-all control for the direction you want. You can still flip individual pages differently before saving.',
    },
    {
      question: 'Does flipping reduce quality?',
      answer:
        'No. The page is mirrored with a transform rather than re-rendered, so text stays selectable and images keep their detail.',
    },
    {
      question: 'Are my files uploaded?',
      answer:
        'No. Flipping happens in this browser tab. Nothing is uploaded or stored on a server.',
    },
  ],

  watermark: [
    {
      question: 'How do I add a watermark to a PDF?',
      answer:
        'Add the PDF, choose text or an image, adjust the size, angle, opacity and placement, then apply it to every page.',
    },
    {
      question: 'Can I use my company logo as a watermark?',
      answer:
        'Yes. Upload a PNG or JPG under 5 MB. A PNG with a transparent background usually looks best over a document.',
    },
    {
      question: 'Should I center or tile the watermark?',
      answer:
        'A centered mark is clearer and less intrusive. Tiling repeats it across the page and is harder to crop out, which suits draft or confidential documents.',
    },
    {
      question: 'Can I remove the watermark later?',
      answer:
        'The watermark is drawn over the page content, so it is not a separate layer you can toggle off. Keep the original PDF if you may need a clean copy.',
    },
    {
      question: 'Are my files uploaded?',
      answer:
        'No. The watermark is applied inside this browser tab. Nothing is uploaded and no account is required.',
    },
  ],

  'edit-metadata': [
    {
      question: 'How do I edit a PDF’s metadata?',
      answer:
        'Add the PDF, change the title, author, subject, keywords, creator or producer, then save. Only the fields you edit are changed.',
    },
    {
      question: 'Which metadata fields can I change?',
      answer:
        'Title, author, subject, keywords, creator and producer. Creation and modification dates are left untouched rather than invented.',
    },
    {
      question: 'Why does the PDF still show the old title somewhere?',
      answer:
        'Some viewers read the title from the document’s metadata, while others show the file name. Edit Metadata changes the document metadata; use Rename PDF to change the file name.',
    },
    {
      question: 'Does editing metadata change the pages?',
      answer:
        'No. The page content is not re-rendered. Only the document information dictionary is updated.',
    },
    {
      question: 'Are my files uploaded?',
      answer:
        'No. Metadata is read and written in this browser tab. Nothing is uploaded or stored.',
    },
  ],

  'remove-annotations': [
    {
      question: 'How do I remove comments and highlights from a PDF?',
      answer:
        'Add the PDF and run the removal. Comments, highlights, ink and other annotations are stripped from the output in one pass.',
    },
    {
      question: 'Does it delete the underlying page content?',
      answer:
        'No. It removes annotations and leaves the page text and images intact. Your original file is never modified.',
    },
    {
      question: 'Are form fields removed too?',
      answer:
        'This tool targets annotations. To turn form fields into fixed page content, use Flatten PDF; to remove fields entirely, use the editor.',
    },
    {
      question: 'Can I remove only some annotations?',
      answer:
        'This tool removes annotations in one pass rather than selecting them individually. Keep the original PDF if you may need to preserve any of the comments or highlights.',
    },
    {
      question: 'Are my files uploaded?',
      answer:
        'No. The PDF is cleaned inside this browser tab. Nothing is uploaded and the result downloads directly from your device.',
    },
  ],

  'pdf-to-text': [
    {
      question: 'How do I convert a PDF to text?',
      answer:
        'Add the PDF and extract the text. You get a .txt file with one line per visual text line and a blank line between pages.',
    },
    {
      question: 'Why is the extracted text empty?',
      answer:
        'The PDF is probably a scan with no text layer. Run OCR first to add searchable text, then extract it with this tool.',
    },
    {
      question: 'Does it preserve the original layout?',
      answer:
        'It preserves reading order and line breaks, not columns or exact positioning. Plain text cannot carry fonts, images or page geometry.',
    },
    {
      question: 'Can I convert only part of the document?',
      answer:
        'This tool extracts the whole document. To work on a section, use Extract Pages first and then convert the extract to text.',
    },
    {
      question: 'Is the text accurate?',
      answer:
        'It comes from the PDF’s own text layer, so accuracy depends on how the file was created. Scanned pages need OCR and may still contain recognition errors.',
    },
    {
      question: 'Are my PDFs uploaded?',
      answer:
        'No. The text is extracted in this browser tab. Nothing is uploaded and the .txt file is generated locally.',
    },
  ],

  'grayscale-pdf': [
    {
      question: 'How do I convert a PDF to black and white?',
      answer:
        'Add the PDF and run the conversion. Every page is rebuilt as a grayscale image, and you download the new document.',
    },
    {
      question: 'Does grayscale remove colour permanently?',
      answer:
        'The downloaded file is grayscale and the colour is gone from it. Your original PDF is not changed, so keep it if you may need the colour version.',
    },
    {
      question: 'Will the text still be selectable?',
      answer:
        'No. Pages are rasterized to remove colour cleanly, which means text becomes part of the image. Use this for printing or archiving, not for documents you still need to edit.',
    },
    {
      question: 'Why is the page limit lower than other tools?',
      answer:
        'The limit is 150 pages because every page becomes a full bitmap. That cap keeps a large document from exhausting the tab’s memory.',
    },
    {
      question: 'Are my files uploaded?',
      answer:
        'No. The conversion runs in this browser tab. Nothing is uploaded and no account is required.',
    },
  ],

  'resize-pdf': [
    {
      question: 'How do I resize a PDF to A4 or Letter?',
      answer:
        'Add the PDF, choose A4 or Letter, then apply. Each page is fitted to the paper size while keeping its proportions.',
    },
    {
      question: 'Can I scale a PDF by a percentage?',
      answer:
        'Yes. Choose a custom scale between 25% and 400%. The content is transformed rather than stretched, so text stays sharp.',
    },
    {
      question: 'Does resizing stretch my pages?',
      answer:
        'No. Pages keep their aspect ratio and are fitted into the new size, which may leave a margin. Nothing is distorted to fill the page.',
    },
    {
      question: 'Will the text still be selectable?',
      answer:
        'Yes. Resizing uses a real page transform, so text remains vector and searchable at any zoom.',
    },
    {
      question: 'Are my files uploaded?',
      answer:
        'No. The resize happens in this browser tab. Nothing is uploaded or stored on a server.',
    },
  ],

  'extract-images': [
    {
      question: 'How do I extract images from a PDF?',
      answer:
        'Add the PDF and run the extraction. Every embedded image is pulled out at its original resolution, previewed, and offered as a ZIP.',
    },
    {
      question: 'Are the extracted images the original quality?',
      answer:
        'Yes. JPEGs pass through untouched, and other supported formats are decoded at their stored resolution. Nothing is upscaled.',
    },
    {
      question: 'Why were some images skipped?',
      answer:
        'Some encodings, such as CMYK or JBIG2, cannot be decoded safely by the browser. The result tells you how many were skipped instead of silently dropping them.',
    },
    {
      question: 'Can I extract images from only one page?',
      answer:
        'This tool scans the whole document. To isolate a page first, use Extract Pages, then run the image extraction on that file.',
    },
    {
      question: 'Are my PDFs uploaded?',
      answer:
        'No. Images are decoded in this browser tab and packaged locally. Your document never leaves the device.',
    },
  ],

  'split-by-size': [
    {
      question: 'How do I split a PDF by file size?',
      answer:
        'Add the PDF and set a target size per part, such as 10 MB. The tool builds the parts and measures each one before packaging them in a ZIP.',
    },
    {
      question: 'Can I split a PDF to fit an email limit?',
      answer:
        'Yes. 25 MB is the classic email attachment cap and 2 MB fits most web forms. Choose the limit your recipient enforces.',
    },
    {
      question: 'Are the part sizes exact?',
      answer:
        'They are measured after building, not estimated beforehand. Sizes can drift a little between parts, so leave a small margin under a hard upload limit.',
    },
    {
      question: 'What is the minimum target size?',
      answer:
        'The target must be at least 0.1 MB, and one run can produce at most 100 parts. A very small target on a large document may need a larger limit.',
    },
    {
      question: 'Are my files uploaded?',
      answer:
        'No. The split runs in this browser tab and the ZIP is assembled locally. Nothing is uploaded.',
    },
  ],

  'flatten-pdf': [
    {
      question: 'What does flattening a PDF do?',
      answer:
        'It bakes form fields and annotations into the page content, so the document renders the same everywhere and can no longer be edited as a form.',
    },
    {
      question: 'When should I flatten a PDF?',
      answer:
        'Flatten before sending a completed form or a signed document if you want the values fixed. Keep the original if the recipient may need to edit it.',
    },
    {
      question: 'Can I undo flattening?',
      answer:
        'Not in the flattened file: the fields are no longer separate objects. Your original PDF is untouched, so keep it as the editable copy.',
    },
    {
      question: 'Does flattening change how the PDF looks?',
      answer:
        'The visible result should match what you saw, because the field values become page content. Appearance differences can occur if the original form relied on viewer-specific rendering.',
    },
    {
      question: 'Are my files uploaded?',
      answer:
        'No. Flattening happens in this browser tab. Nothing is uploaded and no account is required.',
    },
  ],

  'unlock-pdf': [
    {
      question: 'How do I remove a password from a PDF?',
      answer:
        'Add the PDF and enter the password you already use, then unlock. The result is a copy that opens without a password.',
    },
    {
      question: 'Can this tool crack a password I do not know?',
      answer:
        'No. It removes protection from a file you can already open, or from an owner-restricted PDF with no open password. It does not guess passwords.',
    },
    {
      question: 'What is an owner-restricted PDF?',
      answer:
        'It is a file that opens without a password but restricts printing, copying or editing. Those restrictions can be removed here; a file with an open password still needs that password.',
    },
    {
      question: 'Does unlocking change the document?',
      answer:
        'It creates a decrypted copy and leaves the content intact. The original protected file is not modified.',
    },
    {
      question: 'Are my files uploaded?',
      answer:
        'No. Decryption happens in this browser tab, so your password and document never reach a server.',
    },
  ],

  'jpg-to-pdf': [
    {
      question: 'How do I convert JPG images to a PDF?',
      answer:
        'Add your JPG or PNG images, drag them into order, then create the PDF. Each image becomes one page in the sequence you set.',
    },
    {
      question: 'Can I mix JPG and PNG images?',
      answer:
        'Yes. Both formats are accepted in the same PDF. Transparent PNG areas are placed on a white page background.',
    },
    {
      question: 'Can I control the page size and orientation?',
      answer:
        'Yes. Choose A4, US Letter or a page that matches each image, then set the orientation and margin. The images are fitted without being stretched or cropped.',
    },
    {
      question: 'How many images can I combine?',
      answer:
        'Up to 100 images per PDF. Each image can be up to 12 MB and 8192 pixels per edge, which covers phone photos and ordinary scans.',
    },
    {
      question: 'Are my images uploaded?',
      answer:
        'No. The PDF is assembled in this browser tab. Your photos and scans never leave the device.',
    },
  ],

  'rename-pdf': [
    {
      question: 'How do I rename a PDF?',
      answer:
        'Add one or more PDFs, type a naming pattern, preview the result, then rename. A single file downloads directly; multiple files come as a ZIP.',
    },
    {
      question: 'Can I use the PDF’s title in the file name?',
      answer:
        'Yes. Use the {title} token to pull the document’s metadata title. If a PDF has no title, use {name} or another token instead.',
    },
    {
      question: 'Does renaming change the PDF content?',
      answer:
        'No. The bytes are copied, not re-encoded, so the document is unchanged. Only the file name is different.',
    },
    {
      question: 'How many files can I rename at once?',
      answer:
        'Up to 50 files per run, with a pattern of up to 120 characters. The live preview shows every resulting name before you apply it.',
    },
    {
      question: 'Are my files uploaded?',
      answer:
        'No. Names are computed in this browser tab and the files are repackaged locally. Nothing is uploaded.',
    },
  ],

  'bates-numbering': [
    {
      question: 'What is Bates numbering used for?',
      answer:
        'It gives every page a unique, sequential identifier for legal and discovery documents, such as ABC-000123. The number makes a page easy to cite and track across a set.',
    },
    {
      question: 'How do I add Bates numbers to a PDF?',
      answer:
        'Add the PDF, set the prefix, starting number and digit padding, then apply. The same sequence runs across every page in the document.',
    },
    {
      question: 'How do I continue numbering in the next document?',
      answer:
        'The result shows the last number used. Start the next document at the number after it to keep one continuous sequence across the set.',
    },
    {
      question: 'Does Bates numbering change the page content?',
      answer:
        'It adds a small text stamp to each page. The rest of the page is not re-rendered, and your original PDF is untouched.',
    },
    {
      question: 'Are my files uploaded?',
      answer:
        'No. The numbering is applied in this browser tab. Nothing is uploaded and no account is required.',
    },
  ],

  'split-by-text': [
    {
      question: 'How do I split a PDF at a certain phrase?',
      answer:
        'Add the PDF and enter the text that starts each new section. Every page where that text appears becomes the first page of a new file.',
    },
    {
      question: 'Is the matching case-sensitive?',
      answer:
        'You choose. Leave case sensitivity off for ordinary matching, or turn it on when the exact capitalisation matters.',
    },
    {
      question: 'Why did the split find no matches?',
      answer:
        'The phrase must exist as real text in the PDF. A scanned page has no text layer until it is OCR’d, and line breaks can split a phrase across lines.',
    },
    {
      question: 'What do I get at the end?',
      answer:
        'A ZIP with one PDF per section, in page order. The original document is not changed.',
    },
    {
      question: 'Are my files uploaded?',
      answer:
        'No. The text is matched and the parts are built in this browser tab. Nothing is uploaded.',
    },
  ],

  'compress-pdf': [
    {
      question: 'How do I compress a PDF?',
      answer:
        'Add the PDF, choose Smart or Strong compression, then run it. You see the original and new size before downloading the smaller file.',
    },
    {
      question: 'What is the difference between Smart and Strong compression?',
      answer:
        'Smart re-encodes images while keeping text, links and forms. Strong rebuilds pages as JPEGs, which shrinks scans more but turns text into pixels.',
    },
    {
      question: 'Will compression make my text blurry?',
      answer:
        'Smart compression keeps text as text, so it stays sharp. Strong compression rasterizes pages and is meant for scans or photo-heavy files, not documents you still need to edit.',
    },
    {
      question: 'Why did my file barely get smaller?',
      answer:
        'A PDF that is already optimised may have little to remove. Try Strong compression for scans, or lower the image quality and DPI settings if the tool offers them.',
    },
    {
      question: 'What is the page limit for compression?',
      answer:
        'Smart compression handles up to 500 pages. Strong compression stops at 150 pages because every page becomes a bitmap.',
    },
    {
      question: 'Are my files uploaded?',
      answer:
        'No. Compression runs in this browser tab. Nothing is uploaded and no account is required.',
    },
  ],

  'batch-run': [
    {
      question: 'What does Batch run do?',
      answer:
        'It applies one operation to many PDFs at once, then packages the results in a single ZIP. It is useful for compressing, flattening or cleaning up a whole folder.',
    },
    {
      question: 'How many files can I process in one batch?',
      answer:
        'Up to 100 files, because the results are packed into one ZIP. Each file still has to fit the normal 500-page and 250 MB client limit.',
    },
    {
      question: 'Can I use different settings for each file?',
      answer:
        'No. A batch shares one operation and one set of settings. For per-file decisions, run the tool individually or use a workflow with separate steps.',
    },
    {
      question: 'Where are the results?',
      answer:
        'They download as a ZIP with one output per input file. The result panel lists every file so you can check that nothing was skipped.',
    },
    {
      question: 'Are my files uploaded?',
      answer:
        'No. Batch run uses the same in-browser engine as the individual tools. The ZIP is assembled locally and nothing is uploaded.',
    },
  ],

  stamp: [
    {
      question: 'How do I add an APPROVED or DRAFT stamp to a PDF?',
      answer:
        'Add the PDF, choose a preset or type your own stamp text, then adjust the size, angle, opacity and placement before applying it.',
    },
    {
      question: 'Can I stamp every page?',
      answer:
        'Yes. The stamp is applied to every page in the document. The preview on page 1 shows how the mark will sit before you commit.',
    },
    {
      question: 'Can I use my own wording instead of a preset?',
      answer:
        'Yes. The presets are shortcuts; the text field accepts any label, such as CONFIDENTIAL, PAID or RECEIVED.',
    },
    {
      question: 'Can I remove a stamp later?',
      answer:
        'The stamp is drawn over the page content, so it is not a separate layer you can switch off. Keep the original PDF if you may need a clean copy.',
    },
    {
      question: 'Are my files uploaded?',
      answer:
        'No. The stamp is applied in this browser tab. Nothing is uploaded or stored on a server.',
    },
  ],

  'repair-pdf': [
    {
      question: 'Can this tool repair a damaged PDF?',
      answer:
        'It rebuilds the cross-reference table and trailer, which fixes many files that will not open or show the wrong page count. It does not reconstruct missing content streams or fonts.',
    },
    {
      question: 'What kinds of damage can it fix?',
      answer:
        'Broken cross-reference tables, incorrect offsets and truncated trailers are the usual targets. If the page content itself is gone, no repair tool can invent it back.',
    },
    {
      question: 'Will repairing change the document?',
      answer:
        'The visible pages should be preserved while the file structure is rebuilt. Keep the original if the repaired copy is incomplete; the source is never modified.',
    },
    {
      question: 'What if the repair fails?',
      answer:
        'A badly damaged file may not contain enough structure to rebuild. Try opening it in another reader to confirm the damage, and keep a backup before experimenting.',
    },
    {
      question: 'Are my files uploaded?',
      answer:
        'No. The repair runs in this browser tab. Nothing is uploaded, which also means no third party sees the damaged document.',
    },
  ],

  'combine-pdf': [
    {
      question: 'How is Combine files different from Merge PDF?',
      answer:
        'Merge PDF combines PDFs. Combine files also accepts images and adds each one as a page, so you can put a scanned cover photo in front of a contract in one document.',
    },
    {
      question: 'Can I combine PDFs with JPG or PNG images?',
      answer:
        'Yes. Images become pages in the order you arrange them. Office files such as Word or Excel are refused by name rather than silently dropped.',
    },
    {
      question: 'How many files can I combine?',
      answer:
        'Up to 50 files per run, with a total of 500 pages and 250 MB. The list shows every item before you build the PDF.',
    },
    {
      question: 'Does combining reduce quality?',
      answer:
        'PDF pages are copied and images are placed at their stored resolution, so quality is preserved. The original files are left untouched.',
    },
    {
      question: 'Are my files uploaded?',
      answer:
        'No. The combined PDF is assembled in this browser tab. Nothing is uploaded or stored on a server.',
    },
  ],

  'image-editor': [
    {
      question: 'What can I do in the image editor?',
      answer:
        'Crop, rotate, flip and apply basic filters to an image, then export a new copy. It is designed for preparing images that will become PDF pages.',
    },
    {
      question: 'Which image formats are supported?',
      answer:
        'Common browser-decodable formats such as JPEG, PNG and WebP. Very large images are bounded by the same memory guard as the PDF tools.',
    },
    {
      question: 'Can I send the edited image straight to a PDF?',
      answer:
        'Export the image, then use JPG to PDF or Combine files to place it in a document. Keeping the steps separate means you can redo one without the other.',
    },
    {
      question: 'Does editing reduce image quality?',
      answer:
        'Crop, rotate and flip do not resample the whole image. Filters re-encode the exported bitmap, so export at the quality you need for the final PDF.',
    },
    {
      question: 'Are my images uploaded?',
      answer:
        'No. The editor runs in this browser tab. Your image never leaves the device.',
    },
  ],

  'split-by-bookmarks': [
    {
      question: 'How do I split a PDF by its bookmarks?',
      answer:
        'Add a PDF that has an outline, then run the split. Each section becomes its own PDF, and the result lists the parts and their page ranges.',
    },
    {
      question: 'Which bookmark level does it use?',
      answer:
        'It uses the shallowest level that actually contains sections, so a nested chapter tree does not produce empty files. The result shows the level it chose.',
    },
    {
      question: 'What if my PDF has no bookmarks?',
      answer:
        'There is nothing for this tool to split on. Use Create Bookmarks to generate an outline from headings, or Split by pages for fixed-size chunks.',
    },
    {
      question: 'How many parts can it produce?',
      answer:
        'Up to 200 parts from an outline of at most 2,000 bookmarks. Very large outlines are refused with the actual count rather than silently cut short.',
    },
    {
      question: 'Are my files uploaded?',
      answer:
        'No. The outline is read and the parts are built in this browser tab. Nothing is uploaded.',
    },
  ],

  'create-forms': [
    {
      question: 'How do I make a PDF fillable?',
      answer:
        'Open the PDF, choose the text-field or checkbox tool, draw the field on the page, name it, then export. The result is a PDF with real form fields.',
    },
    {
      question: 'Can I add text fields and checkboxes?',
      answer:
        'Yes. Those two types cover most forms. Each field needs a unique name of up to 64 characters, which is also used as its label.',
    },
    {
      question: 'Can I edit an existing form?',
      answer:
        'You can add new fields to a PDF that already has a form. To change the underlying field definitions, use a dedicated form editor; this tool is for creating fields.',
    },
    {
      question: 'Will the form work in every PDF reader?',
      answer:
        'It uses standard AcroForm fields, which mainstream readers support. A few viewers handle field appearance differently, so test the exported file in the app your recipients use.',
    },
    {
      question: 'Are my files uploaded?',
      answer:
        'No. The fields are added in this browser tab. Nothing is uploaded and no account is required.',
    },
  ],

  'create-bookmarks': [
    {
      question: 'How do I add bookmarks to a PDF?',
      answer:
        'Add the PDF and let the tool detect headings, or add bookmarks manually. Review the titles and page numbers, then write the outline to the document.',
    },
    {
      question: 'How does automatic detection work?',
      answer:
        'It looks for heading-like lines in the page text, such as short lines that stand out from body copy. Detection is a suggestion: every title and page can be corrected before export.',
    },
    {
      question: 'Can I create a bookmark for every page?',
      answer:
        'Yes. The page mode creates one bookmark per page, which is useful for forms, catalogs and short documents that have no headings.',
    },
    {
      question: 'Will the bookmarks show in my PDF reader?',
      answer:
        'They are written as a standard PDF outline, so readers with a bookmarks or contents panel will show them. Some minimal viewers hide that panel by default.',
    },
    {
      question: 'Are my files uploaded?',
      answer:
        'No. The text is read and the outline is written in this browser tab. Nothing is uploaded.',
    },
  ],

  'protect-pdf': [
    {
      question: 'How do I password-protect a PDF?',
      answer:
        'Add the PDF, enter an open password, then protect it. The output uses AES-256 encryption and asks for the password before it opens.',
    },
    {
      question: 'What kind of encryption is used?',
      answer:
        'AES-256, with an open password of 8 to 127 characters. Multibyte characters count as more than one byte, so a short non-English password may hit the byte limit.',
    },
    {
      question: 'Can I recover the password if I forget it?',
      answer:
        'No. There is no recovery key and no back door. Store the password somewhere safe before you close the original; a lost password means a lost document.',
    },
    {
      question: 'Does protecting a PDF change how it looks?',
      answer:
        'No. The pages and content are unchanged; encryption is applied to the file. Printing and copying permissions are a separate concern from the open password.',
    },
    {
      question: 'Are my files uploaded?',
      answer:
        'No. Encryption happens in this browser tab, so the document and the password never reach a server.',
    },
  ],

  'dark-mode-pdf': [
    {
      question: 'How do I convert a PDF to dark mode?',
      answer:
        'Add the PDF, choose a theme, then convert. Every page is rebuilt for night reading, and the preview shows the result before you download.',
    },
    {
      question: 'Does it just invert the colours?',
      answer:
        'No. A raw negative turns photos and diagrams into strange colours. This tool remaps lightness and preserves images and accents within the chosen theme.',
    },
    {
      question: 'Will the text still be selectable?',
      answer:
        'No. Pages are rebuilt as images, so text becomes part of the picture. Keep the original PDF if you need to search, copy or edit the document.',
    },
    {
      question: 'Why is the page limit 150?',
      answer:
        'Every page becomes a full bitmap, so the cap protects the tab’s memory. Split a longer document into parts and convert them separately.',
    },
    {
      question: 'Are my files uploaded?',
      answer:
        'No. The conversion runs in this browser tab. Nothing is uploaded and no account is required.',
    },
  ],

  deskew: [
    {
      question: 'How do I straighten a crooked scanned PDF?',
      answer:
        'Add the scan and let auto-detection estimate the angle, or enter a manual angle. The pages are straightened and rebuilt as a new PDF.',
    },
    {
      question: 'What angle range does auto-detect handle?',
      answer:
        'It searches from −10° to +10°, which covers most scanner and phone skew. For a more extreme tilt, use the manual override, which accepts up to ±45°.',
    },
    {
      question: 'Does deskewing make the text selectable?',
      answer:
        'No. Pages are rasterized and rebuilt, so any existing text layer becomes part of the image. Run OCR after deskewing if you need searchable text.',
    },
    {
      question: 'Can I deskew only some pages?',
      answer:
        'The tool processes the document as one run. For a mixed scan, split out the crooked pages first, deskew them, then merge them back.',
    },
    {
      question: 'Are my files uploaded?',
      answer:
        'No. The skew detection and rebuild happen in this browser tab. Nothing is uploaded.',
    },
  ],

  'ocr-pdf': [
    {
      question: 'How do I make a scanned PDF searchable?',
      answer:
        'Add the scan, choose a quality preset, then run OCR. The tool adds an invisible text layer over the original page, so searching and copy-paste work.',
    },
    {
      question: 'Does OCR change how the page looks?',
      answer:
        'No. The visible page is kept and the recognized text is placed underneath it. The document still looks like your scan.',
    },
    {
      question: 'Which languages are supported?',
      answer:
        'English only in the browser build. The first run downloads about 15 MB of recognizer and language data once, and it works offline afterwards.',
    },
    {
      question: 'How accurate is the recognition?',
      answer:
        'Accuracy depends on scan quality and is probabilistic. Clean, straight, high-contrast text works best; always check names, numbers and dates in the output.',
    },
    {
      question: 'What is the page limit for OCR?',
      answer:
        'Up to 100 pages per run. Pages that already have a real text layer are copied untouched, so re-running OCR does not degrade them.',
    },
    {
      question: 'Are my scans uploaded?',
      answer:
        'No. Recognition runs in this browser tab with a local WebAssembly model. Your scan never leaves the device.',
    },
  ],
};

/** The FAQ for a slug, or an empty list when the tool has not shipped yet. */
export function faqsFor(slug: string): readonly ToolFaqItem[] {
  return TOOL_FAQS[slug] ?? [];
}
