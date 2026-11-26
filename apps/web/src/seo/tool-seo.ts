/**
 * Per-tool on-page SEO copy.
 *
 * React-free so `build/prerender.ts` can import it with plain Node. The React
 * tool page imports the same object, which keeps the visible page and the
 * crawler HTML identical.
 *
 * Each live tool gets its own title (50–60 characters), description (150–160),
 * H1, three steps and three related tools. The page renderer adds the FAQ,
 * limits and trust copy that already live in the product.
 */

export interface ToolSeo {
  /** 50–60 characters, primary keyword near the start. */
  title: string;
  /** 150–160 characters with a call to action. */
  description: string;
  h1: string;
  keywords: string[];
  /** One line used on the home-page catalog. */
  benefit: string;
  /** What the tool does, in the page's own words. */
  summary: string;
  /** Who the tool is for. */
  audience: string;
  steps: [string, string, string];
  related: string[];
}

export const TOOL_SEO: Record<string, ToolSeo> = {
  'merge-pdf': {
    title: 'Merge PDF Files Online Free – Combine PDFs | PDFShush',
    description:
      "Merge PDF files online free in your browser. Drag PDFs into order, combine them into one document, and download it without a watermark or signup. No upload.",
    h1: 'Merge PDF Files Online Free',
    keywords: ['merge pdf', 'pdf merger', 'combine pdf', 'pdf combiner', 'merge pdf online free'],
    benefit: 'Combine several PDFs into one tidy document, in any order.',
    summary:
      'Merge PDF is the tool for the moment a form asks for one upload but your evidence is spread across four files: a resume, a degree certificate, an ID and a cover letter. Add the PDFs, drag the rows into the order the reader expects, and the tool copies every page into a single document. Pages are copied rather than re-rendered, so text stays selectable and images keep their original resolution.',
    audience:
      'Job applicants bundling documents, students submitting one assignment file, and office teams assembling a contract with its annexures.',
    steps: [
      'Add two or more PDFs from your device; the combined page count appears as you go.',
      'Drag the file rows into the order you want the reader to see.',
      'Choose Merge PDF, check the result, and download the single combined file.',
    ],
    related: ['split-by-pages', 'combine-pdf', 'organize-pdf'],
  },

  'organize-pdf': {
    title: 'Organize PDF Pages Online Free – Reorder PDF | PDFShush',
    description:
      "Organize PDF pages online free: drag thumbnails to reorder, duplicate or delete pages, then download the rebuilt file. No signup, no upload and no watermark.",
    h1: 'Organize PDF Pages Online Free',
    keywords: ['organize pdf', 'reorder pdf pages', 'rearrange pdf', 'sort pdf pages'],
    benefit: 'Drag pages into a new order, duplicate them or delete them.',
    summary:
      'Organize PDF gives you a visual page rail instead of a page-range syntax. A scan may have arrived out of order, an appendix may belong before the conclusion, or a blank page may be sitting between two chapters. Drag the thumbnails into the sequence you want, duplicate a page when a form needs two copies, and remove pages that do not belong. Nothing is written until you save.',
    audience:
      'Anyone repairing a scanned bundle, assembling a report in the right order, or removing separator pages before sending a document.',
    steps: [
      'Open the PDF and wait for the page thumbnails to load.',
      'Drag pages to reorder them, then duplicate or delete any page that needs it.',
      'Choose Save pages and download the rebuilt document.',
    ],
    related: ['delete-pages', 'extract-pages', 'merge-pdf'],
  },

  'pdf-to-jpg': {
    title: 'PDF to JPG Converter Online Free – High Quality | PDFShush',
    description:
      "Convert PDF to JPG online free in your browser. Render each page as a high-quality image, choose 300 DPI output, and download PNG or JPG files. No upload.",
    h1: 'PDF to JPG Converter Online Free',
    keywords: ['pdf to jpg', 'pdf to png', 'pdf to image', 'pdf to jpg high quality 300 dpi'],
    benefit: 'Turn every page into a sharp JPG or PNG image.',
    summary:
      'PDF to JPG renders each page as an image you can post, paste into a slide or send through a chat app that will not preview a PDF. Pick JPG for smaller photo-like files or PNG when the page is text-heavy and you need lossless edges. You can set the output width and a page range, so a 40-page report can become a handful of 300 DPI images without exporting the rest.',
    audience:
      'People uploading a page preview to a portal, sharing a poster on social media, or pulling figures out of a report for a presentation.',
    steps: [
      'Choose a PDF and select JPG or PNG as the output format.',
      'Set the image width (1600 px is a good default) and an optional page range.',
      'Convert, then download the ZIP containing one image per page.',
    ],
    related: ['extract-images', 'jpg-to-pdf', 'pdf-to-text'],
  },

  'delete-pages': {
    title: 'Delete PDF Pages Online Free – Remove Pages | PDFShush',
    description:
      "Delete pages from a PDF online free. Select the pages you do not need, remove them in one pass, and download a clean copy without uploading the file. No signup.",
    h1: 'Delete PDF Pages Online Free',
    keywords: ['pdf page remover', 'pdf page delete', 'delete pages from pdf', 'remove pages from pdf'],
    benefit: 'Remove unwanted pages without touching the rest of the file.',
    summary:
      'Delete Pages removes the blank scan, the duplicate cover sheet or the internal memo that should not travel with the contract. Select the thumbnails you want gone and save; the remaining pages are copied into a fresh document. Because the pages are copied rather than flattened, the text you keep stays searchable and the images keep their resolution. The original file on your disk is not modified.',
    audience:
      'Office workers cleaning a scan before emailing it, students trimming a submission, and anyone who needs a shorter PDF in a hurry.',
    steps: [
      'Add the PDF and review the page thumbnails.',
      'Select every page you want to remove; you can change the selection before saving.',
      'Choose Save and download the PDF that contains only the pages you kept.',
    ],
    related: ['extract-pages', 'organize-pdf', 'split-by-pages'],
  },

  'extract-pages': {
    title: 'Extract PDF Pages Online Free – Save Pages | PDFShush',
    description:
      "Extract pages from a PDF online free. Enter page ranges such as 1-3 or 7, pull them into a new document, and download it without a watermark. No signup needed.",
    h1: 'Extract PDF Pages Online Free',
    keywords: ['pdf page extractor', 'extract pages from pdf', 'save pdf pages', 'pdf page extract'],
    benefit: 'Pull selected pages into a brand-new PDF.',
    summary:
      'Extract Pages is for taking the useful part of a large document without carrying the rest: one chapter from a handbook, the signed page from a contract, or the two pages a portal actually asked for. Type ranges such as 1-3, 7, 12, and the selected pages are copied into a new PDF in document order. The output keeps selectable text and original image quality.',
    audience:
      'Applicants uploading only the required pages, teachers sharing one chapter, and teams separating a signed page from a long agreement.',
    steps: [
      'Add the PDF and enter the pages you need, for example 1-3, 7.',
      'Check the preview to confirm which pages matched.',
      'Extract and download the new PDF containing just those pages.',
    ],
    related: ['delete-pages', 'split-by-pages', 'organize-pdf'],
  },

  'rotate-pdf': {
    title: 'Rotate PDF Online Free – Fix Sideways Pages | PDFShush',
    description:
      'Rotate a PDF online free and save the rotation permanently. Turn one page or every page 90 degrees, then download the corrected file from your browser.',
    h1: 'Rotate PDF Online Free',
    keywords: ['rotate pdf', 'rotate pdf online free', 'turn pdf pages', 'fix sideways pdf'],
    benefit: 'Fix sideways scans and save the rotation permanently.',
    summary:
      'Rotate PDF fixes the sideways page that appears every time a scanned document is opened. Each page has its own left and right control, so you can correct one bad scan without disturbing the rest, or rotate every page at once when the whole file arrived landscape. The rotation is stored in the downloaded PDF rather than re-rendered, which keeps text sharp and the file size close to the original.',
    audience:
      'Anyone whose scanner or phone camera saved pages in the wrong orientation, and offices preparing a document for printing.',
    steps: [
      'Add the PDF and find the page that is facing the wrong way.',
      'Use the left or right arrow on that page, or rotate every page together.',
      'Save to download the document with the new rotation stored in the file.',
    ],
    related: ['organize-pdf', 'deskew', 'crop-pdf'],
  },

  'split-by-pages': {
    title: 'Split PDF Online Free – Separate PDF Pages | PDFShush',
    description:
      "Split a PDF online free into smaller files. Choose chunks of 1, 5 or 10 pages and download a ZIP with every part, all inside your browser. No upload, no signup.",
    h1: 'Split PDF Online Free',
    keywords: ['split pdf', 'split pdf online free', 'separate pdf pages', 'pdf splitter'],
    benefit: 'Break a long PDF into chunks of 1, 5 or 10 pages.',
    summary:
      'Split by pages turns one long document into a set of smaller files. Choose a chunk size, such as one page per file for individual invoices or ten pages per file for a study pack, and the tool builds a ZIP with each part. It is the fastest way to separate a combined bank statement, a scanned workbook or a packet of applications that arrived as a single PDF.',
    audience:
      'Accounts teams separating invoices, teachers dividing a workbook, and anyone whose upload portal accepts only a small page count per file.',
    steps: [
      'Add the PDF and choose how many pages each output file should contain.',
      'Run the split; the tool shows how many parts it will create.',
      'Download the ZIP containing one PDF per chunk.',
    ],
    related: ['split-by-size', 'extract-pages', 'merge-pdf'],
  },

  'alternate-mix': {
    title: "Alternate & Mix PDFs Online Free – Interleave | PDFShush",
    description:
      "Interleave two PDFs page by page with Alternate & Mix. Put front and back scans back into reading order in your browser, free and without an upload or signup.",
    h1: 'Alternate & Mix PDF Pages Online Free',
    keywords: ['alternate mix pdf', 'interleave pdf', 'merge scans in order', 'mix two pdfs'],
    benefit: 'Interleave two PDFs so front and back scans read in order.',
    summary:
      'Alternate & Mix solves a scanner problem: when the front sides are saved as one PDF and the back sides as another, a normal merge produces all the fronts followed by all the backs. This tool interleaves the pages instead, A1, B1, A2, B2, so the document reads correctly. Any extra pages in the longer file are appended at the end rather than dropped.',
    audience:
      'People digitising double-sided paperwork, archivists fixing a batch scan, and offices that use a sheet-fed scanner without duplex mode.',
    steps: [
      'Add the front-side PDF and the back-side PDF.',
      'Choose which file supplies the first page of each round.',
      'Run the mix and download the correctly interleaved document.',
    ],
    related: ['merge-pdf', 'split-in-half', 'organize-pdf'],
  },

  'split-in-half': {
    title: 'Split PDF in Half Online Free – Two-Up Scans | PDFShush',
    description:
      "Split a PDF in half online free. Cut every two-up page down the middle or across, then download both halves as separate documents in your browser. No upload.",
    h1: 'Split PDF in Half Online Free',
    keywords: ['split pdf in half', 'split two-up scan', 'cut pdf page in half', 'split book scan'],
    benefit: 'Cut two-up scans down the middle into separate pages.',
    summary:
      'Split in half is built for the scanned book spread: one image contains two facing pages, so reading it on a phone means zooming and panning. The tool cuts every page down the middle and gives you two documents, one with the left halves and one with the right. A horizontal option handles top-and-bottom layouts, such as a form scanned with two receipts on one sheet.',
    audience:
      'Students digitising a textbook, researchers scanning a journal, and anyone who received a PDF where each sheet contains two pages.',
    steps: [
      'Add the two-up PDF and choose a vertical or horizontal cut.',
      'Run the split; both halves are built in the browser.',
      'Download the half that reads in the correct order, or both for comparison.',
    ],
    related: ['split-by-pages', 'crop-pdf', 'organize-pdf'],
  },

  'page-numbers': {
    title: "Add Page Numbers to Your PDF Online Free | PDFShush",
    description:
      "Add page numbers to a PDF online free. Choose the format, position and margin, apply the numbers to every page, and download the file with no signup. Free.",
    h1: 'Add Page Numbers to a PDF Online Free',
    keywords: ['add page numbers to pdf', 'pdf page numbering', 'number pdf pages', 'pdf page numbers'],
    benefit: 'Add page numbers in a format and position you choose.',
    summary:
      'Add page numbers to a PDF before printing, filing or submitting it. Choose a ready-made format or write a pattern with {n} for the current page and {N} for the total, such as Page {n} of {N}. Pick a corner or the bottom centre and set a margin so the number does not collide with a footer. The numbers are drawn as real vector text, so they stay sharp and searchable at any zoom.',
    audience:
      'Students submitting a paged assignment, offices preparing a printable report, and legal teams making a bundle easier to cite.',
    steps: [
      'Add the PDF and choose a number format or type your own pattern.',
      'Pick the position and margin, then check the preview on page one.',
      'Apply the numbering and download the updated PDF.',
    ],
    related: ['header-footer', 'bates-numbering', 'edit-pdf'],
  },

  'crop-pdf': {
    title: 'Crop PDF Online Free – Trim PDF Margins | PDFShush',
    description:
      'Crop a PDF online free. Trim white margins or cut every page to a custom rectangle, preview the result, and download the cropped file from your browser.',
    h1: 'Crop PDF Online Free',
    keywords: ['pdf crop', 'crop pdf online free', 'trim pdf margins', 'pdf cropper'],
    benefit: 'Trim white margins or crop every page to one clean area.',
    summary:
      'Crop PDF removes the empty border that makes a scanned page look small on screen and wastes space when printed. Set the top, bottom, left and right margins, check the preview, and every page is cropped to the same rectangle. Cropping changes the visible area rather than rasterizing the page, so text remains vector, selectable and sharp.',
    audience:
      'People preparing a scan for printing, offices fitting a document into a fixed layout, and anyone tired of huge white margins on a phone.',
    steps: [
      'Add the PDF and set the margins you want to remove.',
      'Review the preview on the first page.',
      'Apply the crop and download the trimmed document.',
    ],
    related: ['resize-pdf', 'split-in-half', 'rotate-pdf'],
  },

  'header-footer': {
    title: 'Add a Header & Footer to PDF Online Free | PDFShush',
    description:
      "Add a header or footer to a PDF online free. Insert repeating text, page numbers and confidentiality lines, then download the updated document. No upload.",
    h1: 'Add a Header & Footer to a PDF Online Free',
    keywords: ['add header to pdf', 'add footer to pdf', 'pdf header footer', 'pdf running header'],
    benefit: 'Repeat a header, footer or confidentiality line on each page.',
    summary:
      'Header & Footer puts the same line on every page: a document title, a client name, a date, or a confidentiality warning. Use {n} and {N} to include the current page and the total, so a footer can read “Acme Ltd · Confidential · {n} / {N}”. Headers and footers are drawn in the margin you choose, and the page content underneath is left alone.',
    audience:
      'Offices preparing a client-ready document, students adding a name and roll number, and legal teams marking every page confidential.',
    steps: [
      'Add the PDF and type the header and footer text you need.',
      'Choose the position and margin, using {n} and {N} for page numbers.',
      'Apply the text and download the updated file.',
    ],
    related: ['page-numbers', 'watermark', 'bates-numbering'],
  },

  'n-up': {
    title: 'N-Up PDF Online Free – 2, 4 or 8 Pages per Sheet | PDFShush',
    description:
      "Put 2, 4 or 8 PDF pages on one sheet with N-up. Choose A4 or Letter, create a print-ready PDF in your browser, and save paper without an upload. No signup.",
    h1: 'N-Up PDF Online Free – 2, 4 or 8 Pages per Sheet',
    keywords: ['n-up pdf', '2 pages per sheet pdf', '4 pages per sheet', 'print multiple pdf pages'],
    benefit: 'Print 2, 4 or 8 pages on a single sheet to save paper.',
    summary:
      'N-up arranges several PDF pages onto one sheet: two for a handout, four for a revision sheet, eight for a quick overview of a long report. Choose the pages per sheet and a paper size, and the tool fits each page into its slot without stretching it. Pages are embedded rather than rasterized, so text stays selectable, just smaller; the source file remains unchanged.',
    audience:
      'Teachers printing handouts, students making compact revision packs, and offices cutting a long report down to a few printable sheets.',
    steps: [
      'Add the PDF and choose 2-up, 4-up or 8-up.',
      'Pick A4 or US Letter in the orientation you need.',
      'Create the new PDF and download the print-ready sheet layout.',
    ],
    related: ['resize-pdf', 'page-numbers', 'crop-pdf'],
  },

  'edit-pdf': {
    title: 'PDF Editor Online Free – Edit PDF Text & Images | PDFShush',
    description:
      "Use a free PDF editor online to edit text, add images and shapes, sign, and reorder pages. Runs in your browser with no signup, watermark or upload. Free.",
    h1: 'PDF Editor Online Free',
    keywords: ['pdf editor online free', 'free pdf editor', 'pdf editor online free edit text', 'edit pdf text'],
    benefit: 'Add text, images, shapes and annotations directly on the page.',
    summary:
      'PDF Editor is the full workspace: click existing text to change it, add a new text box, place an image, draw a shape or annotate a clause. A page rail lets you reorder, duplicate and delete pages in the same session, and undo covers the changes you make. Export writes the edits into the document rather than flattening every page, so unaffected text stays sharp and selectable.',
    audience:
      'Anyone correcting a form, updating a date on a contract, adding a note to a report, or building a clean document from a rough PDF.',
    steps: [
      'Open the PDF in the editor and choose the page you want to change.',
      'Click text to edit it, or add a text box, image, shape or annotation.',
      'Review the page, then export and download the edited PDF.',
    ],
    related: ['fill-sign', 'organize-pdf', 'edit-pdf-with-ai'],
  },

  'redact-pdf': {
    title: 'Redact PDF Online Free – Remove Sensitive Text | PDFShush',
    description:
      'Redact a PDF online free. Mark sensitive text and images, permanently remove them, and verify the result before you download. Files stay on your device.',
    h1: 'Redact PDF Online Free',
    keywords: ['redact pdf', 'pdf redaction', 'remove sensitive text from pdf', 'black out pdf text'],
    benefit: 'Permanently remove sensitive text and pixels before sharing.',
    summary:
      'Redact PDF does the destructive work that a black rectangle cannot: it rebuilds the page without the marked content, then verifies the exported file for the text and carriers it was meant to remove. Use it for account numbers, addresses, names in a medical record or anything that must not survive in a copy. Because redacted pages become images, the page cap is lower, and the tool says so before you start.',
    audience:
      'Legal and HR teams sharing a file with third parties, people publishing documents with personal data, and anyone who has been told to “black out” a detail.',
    steps: [
      'Open the PDF and draw a box over every area that must be removed.',
      'Review the marks and run the redaction; the pages are rebuilt without them.',
      'Check the receipt, then download the verified redacted PDF.',
    ],
    related: ['remove-annotations', 'protect-pdf', 'flatten-pdf'],
  },

  'summarize-pdf': {
    title: "Summarize Your PDF Online for Free with AI | PDFShush",
    description:
      "Summarize a PDF online with your own AI key. Get a short overview and key points with page citations, without uploading the document to PDFShush. No upload.",
    h1: 'Summarize a PDF Online Free with AI',
    keywords: ['summarize pdf', 'pdf summary generator', 'ai pdf summarizer', 'summarize pdf free'],
    benefit: 'Get a short summary with page citations from your own AI key.',
    summary:
      'Summarize PDF reads the document text and returns a short overview plus the points that matter, with citations such as [page 4] so you can check the source. You connect your own model key, which stays in this browser, and the document is parsed locally; only the text needed for the request goes to the provider you chose. For a scanned file, run OCR first so there is a text layer to read.',
    audience:
      'Students revising a long reading, professionals triaging a contract, and anyone who needs the gist before deciding whether to read the whole file.',
    steps: [
      'Open the PDF and connect a supported AI provider with your own key.',
      'Run the summary and wait for the overview and key points.',
      'Use the page citations to check any claim before relying on it.',
    ],
    related: ['chat-with-pdf', 'ocr-pdf', 'pdf-to-text'],
  },

  'chat-with-pdf': {
    title: 'Chat with PDF Online Free – Ask Your Document | PDFShush',
    description:
      'Chat with a PDF online free. Ask questions, get answers with page citations, and keep the document on your device while your AI key stays in the browser.',
    h1: 'Chat with PDF Online Free',
    keywords: ['chat with pdf', 'ask pdf questions', 'pdf chatbot', 'talk to pdf'],
    benefit: 'Ask questions about a document and see the pages used.',
    summary:
      'Chat with PDF turns a document into a conversation: ask for a date, a clause, a definition or a comparison, and the answer cites the pages it used. Follow-up questions keep the context, so you can narrow a point without restating the whole brief. The file is parsed in the browser and your provider key is stored locally, with the request going directly to the model you configured.',
    audience:
      'People checking a long policy, students testing their understanding, and office teams hunting for one detail in a hundred-page report.',
    steps: [
      'Open the PDF and connect your AI provider.',
      'Ask a question in the chat panel and read the cited answer.',
      'Follow up or jump to the cited page to verify the detail.',
    ],
    related: ['summarize-pdf', 'edit-pdf-with-ai', 'pdf-to-text'],
  },

  'edit-pdf-with-ai': {
    title: 'Edit PDF with AI Online – Review Before Apply | PDFShush',
    description:
      "Edit a PDF with AI in plain English. The assistant proposes changes, you review each mark, then apply only what you want. No upload to PDFShush. No upload.",
    h1: 'Edit PDF with AI Online',
    keywords: ['edit pdf with ai', 'ai pdf editor', 'natural language pdf edit', 'ai edit pdf text'],
    benefit: 'Describe an edit in plain English, review it, then apply.',
    summary:
      'Edit PDF with AI lets you describe the change instead of hunting for the right text box: “replace the old address with the new one”, “highlight every payment date”, “remove the draft watermark note”. The assistant proposes marks on the page and nothing is written until you review them. It is an editing assistant rather than a layout designer, so large structural changes still belong in the full editor.',
    audience:
      'People making a small correction without learning a design tool, and reviewers who want a proposed change set before touching the document.',
    steps: [
      'Open the PDF and connect a supported AI provider.',
      'Describe the edit in plain language and wait for the proposed marks.',
      'Accept the marks you want, reject the rest, and export the PDF.',
    ],
    related: ['edit-pdf', 'summarize-pdf', 'redact-pdf'],
  },

  'fill-sign': {
    title: 'Fill & Sign PDF Online Free – PDF Filler | PDFShush',
    description:
      "Fill and sign a PDF online free. Type into form fields, draw or reuse a signature, and download the completed document without printing or uploading. No signup.",
    h1: 'Fill & Sign PDF Online Free',
    keywords: ['pdf filler', 'fill pdf online free', 'sign pdf online', 'fill and sign pdf'],
    benefit: 'Fill form fields and add a drawn or typed signature.',
    summary:
      'Fill & Sign is the PDF filler for forms that arrive as a file rather than a web page. Click a field to type into it, tick checkboxes, then add a signature you draw with a mouse or finger, type in a handwriting style, or reuse from this browser. The filled form stays editable in the download; run it through Flatten PDF if the recipient needs the values fixed as page content.',
    audience:
      'Applicants completing a downloaded form, employees signing a policy acknowledgement, and anyone without a printer or scanner at hand.',
    steps: [
      'Open the PDF and click each form field to fill it in.',
      'Add your signature from the signature panel or create a new one.',
      'Save and download the completed, signed document.',
    ],
    related: ['signature', 'flatten-pdf', 'create-forms'],
  },

  signature: {
    title: 'Free Signature Generator – Create a Signature | PDFShush',
    description:
      "Create a free signature online. Draw or type your name, choose a style, and download a transparent PNG, JPG or PDF signature for any document. No upload.",
    h1: 'Free Signature Generator',
    keywords: ['signature generator', 'create signature online free', 'digital signature maker', 'signature png'],
    benefit: 'Create a reusable signature and download it as PNG, JPG or PDF.',
    summary:
      'Signature Generator creates a signature once and keeps it ready for the next document. Draw with a mouse or finger, or type your name and pick a handwriting style, then adjust the pen and download a transparent PNG for placing on a PDF, a JPG for a form, or a PDF for printing. Saved signatures live in this browser only: no account, no sync and no expiry.',
    audience:
      'Freelancers signing invoices, applicants signing offer letters, and anyone who needs a clean signature image without a scanner.',
    steps: [
      'Draw your signature or type your name and choose a style.',
      'Adjust the pen and preview the result.',
      'Download as PNG, JPG or PDF, or save it in this browser for reuse.',
    ],
    related: ['fill-sign', 'edit-pdf', 'protect-pdf'],
  },

  api: {
    title: 'PDF API – Merge, Compress & Convert with REST | PDFShush',
    description:
      "A documented PDF REST API for merge, compress, convert and more. Create a key, submit a job, poll the result, and delete files on a stated schedule. Free.",
    h1: 'PDF REST API for Merge, Compress and Convert',
    keywords: ['pdf api', 'pdf rest api', 'merge pdf api', 'compress pdf api'],
    benefit: 'Call the PDF tools from your own code with a documented REST API.',
    summary:
      'The PDFShush REST API exposes the same tool catalog to your own code: create a key, POST a file to /api/v1/jobs, poll the job, and download the result. Each key carries explicit scopes and a stated daily quota, and uploaded files are deleted within an hour of the job finishing. This is a server-side path by design, and the docs page says so rather than borrowing the browser tools’ privacy language.',
    audience:
      'Developers adding PDF processing to an app, automation teams replacing a desktop step, and self-hosters who need a documented contract.',
    steps: [
      'Create an API key with the scopes your integration needs.',
      'Submit a job with POST /api/v1/jobs and keep the job id.',
      'Poll the job, then download the result before the retention window closes.',
    ],
    related: ['mcp', 'workflows', 'compress-pdf'],
  },

  mcp: {
    title: 'PDF MCP Server – PDF Tools for AI Agents | PDFShush',
    description:
      "Connect PDF tools to Claude or another AI agent with the PDFShush MCP server. A local stdio process calls the documented API for each tool run. Uses the API.",
    h1: 'PDF MCP Server for AI Agents',
    keywords: ['pdf mcp server', 'mcp pdf tools', 'ai agent pdf', 'model context protocol pdf'],
    benefit: 'Drive PDFShush from an AI agent through the Model Context Protocol.',
    summary:
      'The PDFShush MCP server is a local stdio process that lets an AI agent call PDF tools. The agent sends a tool call, the server sends the file to the documented API for that job, and the result comes back for the agent to use. It ships no PDF engine and keeps no document store; the API deletes each upload within an hour, and the same per-key quota applies.',
    audience:
      'Developers wiring PDF steps into an agent workflow, and teams that want a documented tool interface instead of screen automation.',
    steps: [
      'Install the server and add its command to your MCP client configuration.',
      'Provide a PDFShush API key as an environment variable.',
      'Ask the agent to call a PDF tool; the server handles the API job.',
    ],
    related: ['api', 'workflows', 'batch-run'],
  },

  'flip-pdf': {
    title: 'Flip PDF Online Free – Mirror PDF Pages | PDFShush',
    description:
      "Flip a PDF online free. Mirror one page or every page horizontally or vertically, then download the corrected document from your browser. No signup. No upload.",
    h1: 'Flip PDF Online Free',
    keywords: ['flip pdf', 'mirror pdf page', 'flip pdf horizontally', 'flip pdf vertically'],
    benefit: 'Mirror pages horizontally or vertically for a quick correction.',
    summary:
      'Flip PDF mirrors a page left to right or top to bottom. It is the fix for a scan captured through the wrong side of a transparent sheet, a design proof that needs a mirror view, or a print transfer that has to be reversed. The page is transformed rather than re-rendered, so text remains selectable and images keep their detail. Flip one page or apply the direction to the whole document.',
    audience:
      'People correcting a mirrored scan, designers checking a transfer, and offices preparing a reversed print.',
    steps: [
      'Add the PDF and choose horizontal or vertical flip.',
      'Apply it to a single page or every page.',
      'Save and download the mirrored document.',
    ],
    related: ['rotate-pdf', 'organize-pdf', 'crop-pdf'],
  },

  watermark: {
    title: "Add a Watermark to Your PDF Online Free | PDFShush",
    description:
      "Add a watermark to a PDF online free. Stamp text, a logo, APPROVED or CONFIDENTIAL over every page, centred or tiled, with no signup, watermark or upload.",
    h1: 'Add a Watermark to a PDF Online Free',
    keywords: ['add watermark to pdf', 'pdf watermark', 'watermark pdf online free', 'confidential watermark'],
    benefit: 'Stamp text or a logo over every page, centred or tiled.',
    summary:
      'Watermark puts a visible mark over every page: a company name, a logo, “DRAFT”, “CONFIDENTIAL” or a client reference. Text watermarks can be centred for a clean look or tiled to make cropping harder, and image watermarks accept a PNG or JPG up to 5 MB. Size, angle, opacity and placement are yours to set, and the mark is drawn over the page content rather than replacing it.',
    audience:
      'Freelancers protecting a proposal, offices marking a draft, and teams adding a client logo to a shared report.',
    steps: [
      'Add the PDF and choose text or an image watermark.',
      'Adjust the size, angle, opacity and placement, then preview page one.',
      'Apply the watermark and download the marked document.',
    ],
    related: ['stamp', 'header-footer', 'protect-pdf'],
  },

  'edit-metadata': {
    title: 'Edit PDF Metadata Online Free – Title & Author | PDFShush',
    description:
      "Edit PDF metadata online free. Change the title, author, subject, keywords, creator and producer, then download the file without altering its pages. No upload.",
    h1: 'Edit PDF Metadata Online Free',
    keywords: ['edit pdf metadata', 'change pdf title', 'pdf author metadata', 'pdf properties editor'],
    benefit: 'Change the title, author, subject and keywords of a PDF.',
    summary:
      'Edit Metadata changes what a reader sees in the document properties panel and what some search tools index: title, author, subject, keywords, creator and producer. It is useful when a PDF was exported with “Untitled” as its title or a previous employer as the author. Only the fields you edit change; creation and modification dates are left untouched rather than invented, and the pages are not re-rendered.',
    audience:
      'Authors publishing a report, offices cleaning a template, and anyone preparing a document for a searchable archive.',
    steps: [
      'Add the PDF and review the current metadata.',
      'Edit the title, author, subject, keywords, creator or producer.',
      'Save and download the file with the updated properties.',
    ],
    related: ['rename-pdf', 'create-bookmarks', 'organize-pdf'],
  },

  'remove-annotations': {
    title: 'Remove Annotations from a PDF Online Free | PDFShush',
    description:
      'Remove annotations from a PDF online free. Strip comments, highlights and ink in one pass, keep the page content, and download the cleaned file locally.',
    h1: 'Remove Annotations from a PDF Online Free',
    keywords: ['remove pdf annotations', 'remove comments from pdf', 'remove highlights from pdf', 'clean pdf'],
    benefit: 'Strip comments, highlights and ink in one pass.',
    summary:
      'Remove Annotations gives you a clean copy of a reviewed document. Comments, highlights, ink and other annotations are stripped in one pass, while the underlying page text and images stay intact. It is the right tool before sending a client a file that came back covered in internal notes, or before archiving a draft whose markup is no longer useful. Form fields are a separate concern and can be handled with Flatten PDF.',
    audience:
      'Offices cleaning a reviewed contract, authors preparing a final draft, and anyone who received a PDF full of markup.',
    steps: [
      'Add the annotated PDF.',
      'Run the removal; the output keeps the page content and drops the annotations.',
      'Download the cleaned document.',
    ],
    related: ['flatten-pdf', 'redact-pdf', 'edit-metadata'],
  },

  'pdf-to-text': {
    title: 'Convert PDF to Text Online Free – Extract Text | PDFShush',
    description:
      "Convert a PDF to text online free. Extract the document's text into a clean .txt file with reading order and page breaks, all inside your browser. No upload.",
    h1: 'Convert PDF to Text Online Free',
    keywords: ['pdf to text', 'extract text from pdf', 'pdf to txt', 'convert pdf to text'],
    benefit: 'Extract the document text into a clean .txt file.',
    summary:
      'PDF to Text pulls the document’s own text layer into a .txt file, with reading order and a blank line between pages. It is the fast path for copying a report into a CMS, searching a batch of documents, or feeding text to a script. If the result is empty, the PDF is probably a scan with no text layer; run OCR first, then extract the recognised text.',
    audience:
      'Writers repurposing a report, developers building a text corpus, and anyone who needs the words without the layout.',
    steps: [
      'Add the PDF and run the extraction.',
      'Check the preview for reading order and page breaks.',
      'Download the .txt file.',
    ],
    related: ['ocr-pdf', 'pdf-to-jpg', 'summarize-pdf'],
  },

  'grayscale-pdf': {
    title: "Convert Your PDF to Grayscale Online Free | PDFShush",
    description:
      'Convert a PDF to black and white online free. Rebuild colour pages as clean grayscale images for printing, then download the result without an upload.',
    h1: 'Convert a PDF to Grayscale Online Free',
    keywords: ['grayscale pdf', 'pdf to black and white', 'convert pdf to grayscale', 'bw pdf'],
    benefit: 'Convert colour pages to clean black and white for printing.',
    summary:
      'Grayscale PDF turns colour pages into black and white for a cheaper print, a photocopy-friendly handout or an archive that does not need colour. Every page is rebuilt as a grayscale image, which removes colour cleanly but also turns text into pixels, so keep the original if you still need to edit or search the document. The page cap is lower than the ordinary tools because each page becomes a bitmap.',
    audience:
      'Teachers printing handouts, offices cutting colour print costs, and anyone preparing a document for a black-and-white photocopier.',
    steps: [
      'Add the colour PDF.',
      'Run the conversion; every page is rebuilt in grayscale.',
      'Download the black-and-white document.',
    ],
    related: ['dark-mode-pdf', 'compress-pdf', 'pdf-to-jpg'],
  },

  'resize-pdf': {
    title: 'Resize PDF Online Free – A4, Letter & Scale | PDFShush',
    description:
      'Resize a PDF online free. Fit pages to A4, US Letter or a custom scale while keeping proportions, then download the resized document from your browser.',
    h1: 'Resize PDF Online Free – A4, Letter and Custom Scale',
    keywords: ['pdf resize', 'resize pdf online free', 'pdf to a4', 'scale pdf pages'],
    benefit: 'Scale pages to A4, US Letter or a custom percentage.',
    summary:
      'Resize PDF fits a document to the paper you actually have. Choose A4 or US Letter, or a custom scale between 25% and 400%, and every page is fitted into the new size while keeping its aspect ratio. Nothing is stretched to fill the sheet, so a slightly different page shape may leave a margin. Resizing uses a real page transform, which keeps text vector and searchable.',
    audience:
      'People printing a US Letter file on A4 paper, offices standardising a document set, and anyone fixing a page that is slightly too large.',
    steps: [
      'Add the PDF and choose A4, US Letter or a custom scale.',
      'Check the preview to see how the page fits.',
      'Apply the resize and download the new document.',
    ],
    related: ['n-up', 'crop-pdf', 'organize-pdf'],
  },

  'extract-images': {
    title: "Extract Images from Your PDF Online Free | PDFShush",
    description:
      "Extract images from a PDF online free. Pull every embedded photo out at its original resolution, preview it, and download the set as a ZIP file. No upload.",
    h1: 'Extract Images from a PDF Online Free',
    keywords: ['extract images from pdf', 'pdf image extractor', 'get images from pdf', 'save pdf images'],
    benefit: 'Pull every embedded image out at its original resolution.',
    summary:
      'Extract Images pulls the photos and graphics embedded in a PDF out into separate files. JPEGs pass through untouched, and supported formats are decoded at their stored resolution rather than upscaled. The result previews what was found and tells you how many images were skipped when an encoding cannot be decoded safely. It is the practical way to recover a logo, a chart or a photo from a document someone sent you.',
    audience:
      'Designers recovering an asset, researchers reusing a figure, and anyone who needs a photo out of a PDF without a screenshot.',
    steps: [
      'Add the PDF and run the extraction.',
      'Review the preview and the count of images found.',
      'Download the images as a ZIP.',
    ],
    related: ['pdf-to-jpg', 'image-editor', 'jpg-to-pdf'],
  },

  'split-by-size': {
    title: 'Split PDF by Size Online Free – Under a Limit | PDFShush',
    description:
      "Split a PDF by file size online free. Set a target such as 200 KB or 10 MB, build the parts, and download a ZIP that fits an email or upload limit. No signup.",
    h1: 'Split PDF by Size Online Free',
    keywords: ['split pdf by size', 'pdf splitter by size', 'split pdf under 200kb', 'pdf file size split'],
    benefit: 'Split a PDF into parts under a target file size.',
    summary:
      'Split by Size answers a portal or an inbox rather than a page count: “attachment must be under 10 MB”, “each part must be below 2 MB”. Set the target, and the tool builds the parts and measures each one before packaging them in a ZIP. Sizes are measured after building, not estimated, so leave a small margin under a hard limit. This is a split, not a compression; use Compress PDF first if the whole document should be smaller.',
    audience:
      'People emailing a large scan, applicants fighting an upload cap, and offices sending a document set through a size-limited portal.',
    steps: [
      'Add the PDF and set the target size per part.',
      'Run the split; each part is built and measured.',
      'Download the ZIP and check the sizes before uploading.',
    ],
    related: ['compress-pdf', 'split-by-pages', 'merge-pdf'],
  },

  'flatten-pdf': {
    title: 'Flatten PDF Online Free – Lock Fields & Marks | PDFShush',
    description:
      'Flatten a PDF online free. Turn form fields and annotations into fixed page content so the document looks the same everywhere, with no upload or signup.',
    h1: 'Flatten PDF Online Free',
    keywords: ['flatten pdf', 'flatten pdf form', 'lock pdf fields', 'flatten annotations'],
    benefit: 'Bake form fields and annotations into fixed page content.',
    summary:
      'Flatten PDF bakes form fields and annotations into the page so the document renders the same in every viewer and can no longer be edited as a form. Send a completed application, a signed agreement or a reviewed proof without worrying that a field will look empty on the recipient’s machine. Flattening cannot be undone in the output, so keep the original if the recipient may still need to edit it.',
    audience:
      'Applicants submitting a completed form, offices sending a signed agreement, and teams locking a reviewed document before distribution.',
    steps: [
      'Add the filled or annotated PDF.',
      'Run Flatten PDF to turn fields and marks into page content.',
      'Download the flattened file and keep the original as the editable copy.',
    ],
    related: ['fill-sign', 'remove-annotations', 'protect-pdf'],
  },

  'unlock-pdf': {
    title: 'Unlock PDF Online Free – Remove PDF Password | PDFShush',
    description:
      "Unlock a PDF online free. Remove a password you own or clear owner restrictions in your browser, then download a copy that opens without a prompt. No upload.",
    h1: 'Unlock PDF Online Free',
    keywords: ['pdf unlocker', 'pdf password remove', 'pdf password remover online', 'unlock pdf without password'],
    benefit: 'Remove a password from a PDF you already own.',
    summary:
      'Unlock PDF removes protection from a file you can already open, or clears the owner restrictions that block printing and copying on a PDF with no open password. It does not guess or crack a password you do not know; a file with an open password needs that password once. Decryption happens in this browser tab, so neither the document nor the password reaches a server, and the output is a new unlocked copy.',
    audience:
      'People who saved an old bank statement with a password, offices dealing with an owner-restricted vendor file, and anyone who needs to print a document they own.',
    steps: [
      'Add the protected PDF and enter the password if it has one.',
      'Run the unlock; owner restrictions are removed and the copy is decrypted.',
      'Download the unlocked PDF.',
    ],
    related: ['protect-pdf', 'compress-pdf', 'merge-pdf'],
  },

  'jpg-to-pdf': {
    title: 'JPG to PDF Online Free – Convert Images | PDFShush',
    description:
      "Convert JPG to PDF online free. Add photos or PNG scans, drag them into order, choose the page size, and download one PDF without uploading images. No signup.",
    h1: 'JPG to PDF Online Free',
    keywords: ['jpg to pdf', 'png to pdf', 'image to pdf', 'convert images to pdf'],
    benefit: 'Bundle photos and scans into one PDF in the order you choose.',
    summary:
      'JPG to PDF turns phone photos and scanned images into one document. Add JPG or PNG files, drag them into the order a reader expects, then choose A4, US Letter or a page that matches each image. Images are fitted without being stretched or cropped, and transparent PNG areas sit on a white background. It is the standard way to submit a photo ID, a set of receipts or a photographed assignment as a single PDF.',
    audience:
      'Applicants submitting photo documents, students sending photographed notes, and offices combining receipts into one file.',
    steps: [
      'Add the JPG or PNG images from your device.',
      'Drag them into order and choose the page size and orientation.',
      'Create the PDF and download it.',
    ],
    related: ['pdf-to-jpg', 'combine-pdf', 'image-editor'],
  },

  'rename-pdf': {
    title: 'Rename PDF Online Free – Batch Rename Files | PDFShush',
    description:
      "Rename PDF files online free. Build a naming pattern from the title, author or date, preview every name, and download the renamed files as a ZIP. No upload.",
    h1: 'Rename PDF Online Free',
    keywords: ['rename pdf', 'batch rename pdf', 'pdf file renamer', 'rename pdf files online'],
    benefit: 'Batch-rename files from a pattern or the document title.',
    summary:
      'Rename PDF fixes a folder full of scan_001.pdf, scan_002.pdf and Untitled-1.pdf. Write a pattern using tokens such as {title}, {author} or {name}, preview every resulting name, and download the renamed files. Only the file name changes; the bytes are copied, not re-encoded, so the document is untouched. Up to 50 files can be renamed in one run, which is enough for a month of invoices.',
    audience:
      'Offices filing invoices, students organising a semester of readings, and anyone preparing a clean upload set.',
    steps: [
      'Add one or more PDFs.',
      'Type a naming pattern and check the live preview.',
      'Apply the names and download the files or the ZIP.',
    ],
    related: ['edit-metadata', 'merge-pdf', 'organize-pdf'],
  },

  'bates-numbering': {
    title: 'Bates Numbering PDF Free – Legal Page Numbers | PDFShush',
    description:
      'Add Bates numbers to a PDF free. Set a prefix, start number and digit padding, then apply one continuous legal sequence across every page in the file.',
    h1: 'Bates Numbering PDF Free',
    keywords: ['bates numbering', 'bates stamp pdf', 'legal page numbers', 'bates numbering pdf free'],
    benefit: 'Add sequential legal page numbers across a document set.',
    summary:
      'Bates Numbering gives every page a unique, sequential identifier such as ABC-000123, so a page can be cited and tracked across a discovery set. Set the prefix, starting number and digit padding, and the sequence runs across every page in the file. The result shows the last number used, so the next document can continue the same sequence. The stamp is small vector text; the rest of the page is not re-rendered.',
    audience:
      'Law firms preparing discovery, paralegals building a hearing bundle, and compliance teams numbering a document set.',
    steps: [
      'Add the PDF and set the prefix, start number and digit padding.',
      'Apply the numbering across every page.',
      'Note the last number, then download the stamped document.',
    ],
    related: ['page-numbers', 'header-footer', 'split-by-pages'],
  },

  'split-by-text': {
    title: 'Split a PDF by Text Online Free – Find & Cut | PDFShush',
    description:
      "Split a PDF at a chosen phrase online free. Every page where the text appears starts a new file, and the parts download as a ZIP from your browser. No upload.",
    h1: 'Split a PDF by Text Online Free',
    keywords: ['split pdf by text', 'split pdf at phrase', 'pdf text splitter', 'cut pdf by keyword'],
    benefit: 'Start a new file wherever chosen text appears.',
    summary:
      'Split by Text cuts a document where the content changes rather than at a fixed page count. Enter the phrase that starts each section, such as “Invoice” or “Chapter”, and every page where it appears becomes the first page of a new file. Matching can be case-sensitive when exact capitalisation matters. It is ideal for a combined export of invoices, statements or chapters whose lengths vary.',
    audience:
      'Accounts teams separating a combined invoice export, publishers splitting chapters, and anyone whose sections do not start on a predictable page.',
    steps: [
      'Add the PDF and enter the phrase that marks a new section.',
      'Choose whether matching should be case-sensitive.',
      'Run the split and download the ZIP of section files.',
    ],
    related: ['split-by-bookmarks', 'split-by-pages', 'merge-pdf'],
  },

  'compress-pdf': {
    title: 'Compress PDF Online Free – Reduce PDF Size | PDFShush',
    description:
      "Compress a PDF online free and see the new size before you download. Smart compression keeps text sharp; strong compression shrinks scans further. No upload.",
    h1: 'Compress PDF Online Free',
    keywords: [
      'pdf compressor',
      'pdf compressor online free',
      'compress pdf',
      'pdf compressor 200kb',
      'pdf compressor to 100kb',
      'reduce pdf size',
      'pdf size reducer without losing quality',
    ],
    benefit: 'Shrink a PDF while keeping text sharp and images readable.',
    summary:
      'Compress PDF reduces a document before an upload, an email or an archive. Smart compression re-encodes images while keeping text, links and forms intact, so the words stay sharp and selectable. Strong compression rebuilds pages as JPEGs and shrinks scans much further, at the cost of turning text into pixels. The original and new sizes are shown before you download, so you can try the gentler mode first and only go stronger if the portal still refuses the file.',
    audience:
      'Candidates hitting an exam-form limit, offices emailing a large scan, and anyone preparing a document for a size-capped portal.',
    steps: [
      'Add the PDF and note the original file size.',
      'Choose Smart compression for text documents or Strong for scans.',
      'Compare the new size, then download the smaller PDF.',
    ],
    related: ['split-by-size', 'merge-pdf', 'split-by-pages'],
  },

  workflows: {
    title: 'PDF Workflows – Chain PDF Tools and Re-Run | PDFShush',
    description:
      "Chain PDF tools into one workflow recipe and re-run it on new files. Workflows are server-run, with a stated quota and one-hour file deletion window. Free.",
    h1: 'PDF Workflows – Chain Tools and Re-Run',
    keywords: ['pdf workflow', 'automate pdf tasks', 'pdf pipeline', 'batch pdf workflow'],
    benefit: 'Chain several tools into one recipe and re-run it on new files.',
    summary:
      'Workflows chain several steps into one recipe: merge, compress, add page numbers, then flatten, for example. Build the recipe once and run it again on new files instead of repeating each tool by hand. Each step uses the PDFShush API, so this is a server-run surface with a stated quota, and uploaded files are deleted within an hour of the job finishing. A recipe can hold up to 20 steps.',
    audience:
      'Operations teams with a repeating document process, and developers who want the same pipeline for every batch.',
    steps: [
      'Add the tools you need to a recipe, in order.',
      'Set the options for each step and save the workflow.',
      'Upload a file, run the recipe, and download the result.',
    ],
    related: ['batch-run', 'api', 'merge-pdf'],
  },

  'batch-run': {
    title: 'Batch PDF Tools – Process Many Files at Once | PDFShush',
    description:
      "Apply one PDF operation to a whole folder at once. Batch run processes up to 100 files in your browser and downloads every result in a single ZIP. No upload.",
    h1: 'Batch PDF Tools – Process Many Files at Once',
    keywords: ['batch pdf', 'bulk pdf tools', 'process multiple pdfs', 'batch compress pdf'],
    benefit: 'Apply one operation to a whole folder of PDFs at once.',
    summary:
      'Batch run applies one operation to many PDFs: compress a folder of scans, flatten a set of forms or add the same watermark to every file. Up to 100 files go in, one ZIP comes out, and every result is listed so you can see what was processed. The work still happens in this browser tab, so a batch of client documents is not uploaded anywhere. If the files need different settings, run them individually or build a workflow.',
    audience:
      'Offices processing a month of invoices, teachers preparing a class set, and anyone with a folder of files that need the same fix.',
    steps: [
      'Add up to 100 PDFs to the batch.',
      'Choose the operation and the shared settings.',
      'Run the batch and download the ZIP of results.',
    ],
    related: ['compress-pdf', 'workflows', 'merge-pdf'],
  },

  stamp: {
    title: 'Stamp PDF Online Free – APPROVED & DRAFT | PDFShush',
    description:
      "Stamp a PDF online free. Apply APPROVED, DRAFT, PAID or your own text across every page with a chosen angle, size and opacity. No signup required. No upload.",
    h1: 'Stamp PDF Online Free',
    keywords: ['stamp pdf', 'approved stamp pdf', 'draft stamp pdf', 'pdf stamp online'],
    benefit: 'Apply APPROVED, DRAFT or custom stamps across pages.',
    summary:
      'Stamp PDF puts a clear status mark across a document: APPROVED, DRAFT, PAID, RECEIVED or any wording your process uses. Choose a preset or type your own, then set the size, angle, opacity and placement and preview it on page one. The stamp is drawn over the page content, so it is not a separate layer you can switch off later; keep the original if you may need a clean copy.',
    audience:
      'Offices marking an approval, accounts stamping a paid invoice, and teams adding a received date to incoming paperwork.',
    steps: [
      'Add the PDF and choose a preset or enter custom stamp text.',
      'Adjust the size, angle, opacity and placement.',
      'Apply the stamp to every page and download the document.',
    ],
    related: ['watermark', 'page-numbers', 'header-footer'],
  },

  'repair-pdf': {
    title: 'Repair PDF Online Free – Fix a Damaged PDF | PDFShush',
    description:
      "Repair a damaged PDF online free. Rebuild a broken cross-reference table and trailer so the file opens again, all inside your browser, free and private.",
    h1: 'Repair PDF Online Free',
    keywords: ['repair pdf', 'fix damaged pdf', 'corrupted pdf repair', 'pdf repair online free'],
    benefit: 'Rebuild a damaged cross-reference table so the file opens again.',
    summary:
      'Repair PDF targets the common structural failure: a broken cross-reference table, wrong offsets or a truncated trailer that makes a reader refuse the file or report the wrong page count. The tool rebuilds that structure and leaves the visible pages in place. It cannot reconstruct a missing content stream, a font or an image that was never saved, so a badly damaged file may still be incomplete. The original is not modified.',
    audience:
      'People with a file that will not open, offices recovering an old archive, and anyone who received a truncated attachment.',
    steps: [
      'Add the damaged PDF.',
      'Run the repair to rebuild the file structure.',
      'Download the repaired copy and check the pages that matter.',
    ],
    related: ['compress-pdf', 'unlock-pdf', 'flatten-pdf'],
  },

  'combine-pdf': {
    title: "Combine Your PDF Files & Images Online Free | PDFShush",
    description:
      "Combine PDFs with JPG or PNG images into one document. Arrange the order, build the PDF in your browser, and download it with no signup or watermark. Free.",
    h1: 'Combine PDF Files and Images Online Free',
    keywords: ['combine pdf', 'combine pdf and images', 'merge pdf and jpg', 'pdf combiner'],
    benefit: 'Merge PDFs with images into a single mixed document.',
    summary:
      'Combine files is the mixed-media cousin of Merge PDF. It accepts PDFs plus JPG and PNG images and puts everything into one document in the order you arrange: a photographed cover page in front of a contract, a signature image before the annexure, or a set of receipts after an invoice. Office files such as Word or Excel are refused by name rather than silently dropped, so the result never quietly misses an input.',
    audience:
      'People assembling a submission from a PDF and phone photos, offices building a mixed evidence pack, and anyone who needs one file rather than several.',
    steps: [
      'Add PDFs and images to the list.',
      'Drag the items into the order you want.',
      'Build the combined PDF and download it.',
    ],
    related: ['merge-pdf', 'jpg-to-pdf', 'organize-pdf'],
  },

  'image-editor': {
    title: 'Free Image Editor Online – Crop & Rotate | PDFShush',
    description:
      "Crop, rotate and filter images free in your browser, then turn them into a PDF. No signup, no watermark, and your photos never leave the device. Free.",
    h1: 'Free Image Editor Online',
    keywords: ['image editor online free', 'crop image online', 'rotate image', 'image to pdf editor'],
    benefit: 'Crop, rotate and filter images before they become a PDF.',
    summary:
      'Image Editor prepares a photo before it becomes a PDF page: crop out the desk, rotate a sideways capture, or apply a simple filter so a scanned receipt is readable. The edited image can then go straight into JPG to PDF or Combine files. Everything runs in the browser, so photos of an ID or a signed page are not uploaded to an editor service just to be straightened.',
    audience:
      'People photographing documents for an upload, students cleaning a whiteboard photo, and offices preparing a receipt image.',
    steps: [
      'Open an image in the editor.',
      'Crop, rotate or apply a filter.',
      'Export the edited image, or send it on to JPG to PDF.',
    ],
    related: ['jpg-to-pdf', 'extract-images', 'combine-pdf'],
  },

  'split-by-bookmarks': {
    title: "Split a PDF by Its Bookmarks Online Free | PDFShush",
    description:
      "Split a PDF by its bookmarks online free. Turn each outline chapter into a separate file and download the set as a ZIP, all inside your browser. No upload.",
    h1: 'Split a PDF by Bookmarks Online Free',
    keywords: ['split pdf by bookmarks', 'pdf outline split', 'split pdf chapters', 'bookmark split pdf'],
    benefit: 'Use the document outline to cut it into chapters.',
    summary:
      'Split by bookmarks uses the document’s own outline instead of guessing where chapters begin. Each top-level bookmark becomes the start of a new file, which is exactly what a combined textbook, manual or legal bundle tends to need. The tool reports the parts it found and caps the work at a sensible number of outline entries, so a pathological bookmark tree does not produce hundreds of surprise files.',
    audience:
      'Students separating textbook chapters, offices dividing a manual, and publishers distributing a combined reference by section.',
    steps: [
      'Add a PDF that contains a bookmark outline.',
      'Review the parts the tool detected.',
      'Run the split and download the ZIP of chapter files.',
    ],
    related: ['split-by-text', 'split-by-pages', 'create-bookmarks'],
  },

  'create-forms': {
    title: "Create a Fillable PDF Form Online for Free | PDFShush",
    description:
      "Create a fillable PDF form online free. Add text fields and checkboxes to any PDF, then save a form that can be filled without printing it out. No upload.",
    h1: 'Create a Fillable PDF Form Online Free',
    keywords: ['create fillable pdf form', 'pdf form creator', 'add form fields to pdf', 'fillable pdf maker'],
    benefit: 'Turn any PDF into a fillable form with text fields and boxes.',
    summary:
      'Create Forms turns a flat PDF into something a recipient can fill on screen. Place text fields and checkboxes over the printed lines, name the fields so the data is usable, and save a form that opens with real input boxes. It is the practical alternative to emailing a form that has to be printed, filled by hand and scanned back. The limit is generous enough for an ordinary application or onboarding pack.',
    audience:
      'Offices sending an application form, teachers collecting details, and anyone who keeps receiving a printed form as a PDF.',
    steps: [
      'Open the flat PDF that should become a form.',
      'Place text fields and checkboxes over the areas to fill.',
      'Save and download the fillable PDF.',
    ],
    related: ['fill-sign', 'flatten-pdf', 'edit-pdf'],
  },

  'create-bookmarks': {
    title: 'Create PDF Bookmarks Online Free – Outline | PDFShush',
    description:
      "Create PDF bookmarks online free. Detect headings or add outline entries so readers can jump between sections, then download the updated document. No upload.",
    h1: 'Create PDF Bookmarks Online Free',
    keywords: ['create pdf bookmarks', 'pdf outline generator', 'add bookmarks to pdf', 'pdf navigation'],
    benefit: 'Generate a navigable outline from the page content.',
    summary:
      'Create Bookmarks adds a navigation outline to a document that has none. The tool can detect headings from the page content and propose a structure, which you can review before writing it into the PDF. Readers then get a clickable sidebar instead of scrolling through a hundred pages, and the document becomes much easier to use on a phone. The page content is not re-rendered.',
    audience:
      'Authors publishing a long report, offices making a manual navigable, and students turning a thesis into something a reader can jump around.',
    steps: [
      'Open the PDF and let the tool detect headings.',
      'Review the proposed outline and adjust the entries.',
      'Save and download the PDF with its new bookmarks.',
    ],
    related: ['split-by-bookmarks', 'edit-metadata', 'page-numbers'],
  },

  'protect-pdf': {
    title: 'Protect a PDF with a Password Online Free | PDFShush',
    description:
      "Protect a PDF with AES-256 encryption online. Set an open password and permission flags in your browser, then download the encrypted document. No upload.",
    h1: 'Protect a PDF with a Password Online Free',
    keywords: ['protect pdf', 'password protect pdf', 'encrypt pdf online', 'aes 256 pdf'],
    benefit: 'Encrypt a PDF with AES-256 so only the password holder can open it.',
    summary:
      'Protect PDF encrypts a document with AES-256 and an open password, so only someone with the password can read it. You can also set owner permissions for printing, copying and editing. Encryption happens in this browser tab, which means the password is never sent to a server and there is no recovery key to leak. Keep the password safe: without it, the encrypted copy cannot be opened, even by us.',
    audience:
      'People emailing a bank statement, offices sharing a contract, and anyone sending an ID document through a channel they do not fully trust.',
    steps: [
      'Add the PDF and choose an open password.',
      'Set the permissions the recipient should have.',
      'Encrypt and download the protected PDF.',
    ],
    related: ['unlock-pdf', 'redact-pdf', 'flatten-pdf'],
  },

  'dark-mode-pdf': {
    title: "PDF Dark Mode Converter Free – Night Reading | PDFShush",
    description:
      "Convert a PDF to dark mode online free. Choose a night-reading theme, preview before and after, and download a copy that is easier on the eyes. No upload.",
    h1: 'PDF Dark Mode Converter Online Free',
    keywords: [
      'pdf dark mode converter',
      'pdf dark mode for reading',
      'pdf dark to light converter',
      'invert pdf colors online',
      'pdf night mode converter',
    ],
    benefit: 'Rewrite light pages for night reading without a raw negative.',
    summary:
      'Dark Mode PDF rewrites light pages for night reading. Rather than a raw negative that turns diagrams and photos into strange colours, it offers a theme remap and a hue-preserving mode, with a before-and-after slider so you can judge the result first. It is useful for a long reading session on a phone at night, or for a PDF that glares in a dim room. Pages are rebuilt as images, so keep the original if you need selectable text.',
    audience:
      'Students reading at night, commuters on a dim screen, and anyone who wants a dark copy of a bright report without changing the original.',
    steps: [
      'Add the PDF and choose a dark theme.',
      'Compare the before-and-after preview.',
      'Download the dark-mode copy for reading.',
    ],
    related: ['grayscale-pdf', 'compress-pdf', 'pdf-to-jpg'],
  },

  deskew: {
    title: 'Deskew PDF Online Free – Straighten Scans | PDFShush',
    description:
      "Deskew a scanned PDF online free. Detect and correct crooked pages, review the rotation, and download a straighter document from your browser. No upload.",
    h1: 'Deskew PDF Online Free – Straighten Scanned Pages',
    keywords: ['deskew pdf', 'straighten scanned pdf', 'fix crooked scan', 'pdf deskew online'],
    benefit: 'Straighten crooked scans so every text line sits level.',
    summary:
      'Deskew finds the small tilt that a sheet-fed scanner or a phone photo leaves behind. It estimates the skew from the text lines, rotates each page back to level, and shows the correction so you can override it by hand. A straight scan is easier to read, crops more predictably and gives OCR a better chance. Pages are rebuilt as images, so the text stops being selectable, which the tool states before you run it.',
    audience:
      'People digitising a stack of paperwork, offices cleaning an archive, and anyone whose scan looks slightly tilted on every page.',
    steps: [
      'Add the scanned PDF and let the tool detect the skew.',
      'Review the suggested angle or set a manual rotation.',
      'Run the deskew and download the straightened document.',
    ],
    related: ['rotate-pdf', 'ocr-pdf', 'crop-pdf'],
  },

  'ocr-pdf': {
    title: 'OCR PDF Online Free – Make Scans Searchable | PDFShush',
    description:
      "OCR a PDF online free. Add a searchable, selectable text layer to scanned pages in your browser, with English recognition and no document upload. No signup.",
    h1: 'OCR PDF Online Free – Make Scans Searchable',
    keywords: ['ocr pdf', 'pdf ocr online free', 'searchable pdf', 'scanned pdf to text'],
    benefit: 'Add a searchable, selectable text layer to scanned pages.',
    summary:
      'OCR PDF adds a text layer to a scan so the words become searchable and selectable. Recognition runs in the browser with a self-hosted English model, so the document is not sent to a recognition service. Pages that already contain text are copied untouched, and the output keeps the original scan underneath the new layer. Recognition is probabilistic: check names, numbers and amounts before relying on them.',
    audience:
      'Students searching a scanned reading, offices making an old archive usable, and anyone who needs to copy text out of a paper document.',
    steps: [
      'Add the scanned PDF.',
      'Run OCR; the first run downloads the English model once.',
      'Download the searchable PDF and check the recognised text.',
    ],
    related: ['pdf-to-text', 'deskew', 'pdf-to-jpg'],
  },
};

/** Fallback so a newly registered live tool still gets a usable page. */
export function toolSeoFor(slug: string, name: string, description: string): ToolSeo {
  return (
    TOOL_SEO[slug] ?? {
      title: `${name} Online Free – PDFShush`.slice(0, 60),
      description: `${description} Free, no signup and no watermark, and the file stays in your browser.`.slice(0, 160),
      h1: `${name} Online Free`,
      keywords: [name.toLowerCase(), `${name.toLowerCase()} online free`],
      benefit: description,
      summary: `${name} runs in your browser. ${description} The tool explains its limits before you start, and the original file on your device is never modified.`,
      audience: 'Anyone who needs this PDF job done quickly without installing software or creating an account.',
      steps: [
        'Choose the file from your device.',
        'Set the options for the job.',
        'Run the tool and download the result.',
      ],
      related: ['compress-pdf', 'merge-pdf', 'edit-pdf'],
    }
  );
}
