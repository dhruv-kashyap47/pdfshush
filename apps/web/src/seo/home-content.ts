/**
 * Home-page SEO copy, shared by the React landing page and the prereferrer.
 *
 * Kept React-free so `build/prerender.ts` can import it directly (same reason
 * as `tools/tool-faqs.ts`). Editing a sentence here changes both the visible
 * page and the HTML a crawler receives, so the two cannot drift.
 */

import { SITE_DESCRIPTION, SITE_NAME, SITE_ORIGIN } from './site.ts';

export const HOME_TITLE =
  'Free Online PDF Tools – Compress, Merge, Edit | PDFShush';

export const HOME_DESCRIPTION = SITE_DESCRIPTION;

export const HOME_KEYWORDS = [
  'free online pdf tools',
  'pdf compressor',
  'pdf compressor online free',
  'compress pdf',
  'pdf editor online free',
  'merge pdf',
  'split pdf',
  'pdf to word',
  'pdf to jpg',
  'pdf converter',
  'pdf unlocker',
  'pdf filler',
  'pdf tools no signup',
];

export const HOME_INTRO = [
  `${SITE_NAME} is a free online PDF toolkit for anyone who needs to fix a document quickly: students uploading assignments, job applicants attaching a resume, office teams preparing invoices, and candidates filling exam or government forms. Every tool runs inside your browser tab, so the file you open is the file you keep. Nothing is uploaded, nothing is stored on a server, and there is no account to create.`,
  `The catalog covers the everyday jobs: a PDF compressor for shrinking a file to 200 KB or 100 KB before an upload, a PDF editor online free for typing on a page, merge and split tools for reorganising pages, and converters such as PDF to JPG, JPG to PDF and PDF to text. There are also privacy tools: redact, protect, unlock and flatten, plus a dark mode converter for night reading. ${SITE_ORIGIN.replace('https://', '')} is built so the ordinary task never needs an upload button.`,
];

export interface HomeBenefit {
  slug: string;
  name: string;
  benefit: string;
}

/**
 * One benefit line per live tool. The list is keyed by registry slug, so the
 * home page can render the catalog in registry order without keeping a second
 * copy of names or categories. A slug missing here falls back to the registry
 * description rather than disappearing from the page.
 */
export const TOOL_BENEFITS: Record<string, string> = {
  'merge-pdf': 'Combine several PDFs into one tidy document, in any order.',
  'organize-pdf': 'Drag pages into a new order, duplicate them or delete them.',
  'pdf-to-jpg': 'Turn every page into a sharp JPG or PNG image.',
  'delete-pages': 'Remove unwanted pages without touching the rest of the file.',
  'extract-pages': 'Pull selected pages into a brand-new PDF.',
  'rotate-pdf': 'Fix sideways scans and save the rotation permanently.',
  'split-by-pages': 'Break a long PDF into chunks of 1, 5 or 10 pages.',
  'alternate-mix': 'Interleave two PDFs so front and back scans read in order.',
  'split-in-half': 'Cut two-up scans down the middle into separate pages.',
  'page-numbers': 'Add page numbers in a format and position you choose.',
  'crop-pdf': 'Trim white margins or crop every page to one clean area.',
  'header-footer': 'Repeat a header, footer or confidentiality line on each page.',
  'n-up': 'Print 2, 4 or 8 pages on a single sheet to save paper.',
  'edit-pdf': 'Add text, images, shapes and annotations directly on the page.',
  'redact-pdf': 'Permanently remove sensitive text and pixels before sharing.',
  'summarize-pdf': 'Get a short summary with page citations from your own AI key.',
  'chat-with-pdf': 'Ask questions about a document and see the pages used.',
  'edit-pdf-with-ai': 'Describe an edit in plain English, review it, then apply.',
  'fill-sign': 'Fill form fields and add a drawn or typed signature.',
  signature: 'Create a reusable signature and download it as PNG, JPG or PDF.',
  api: 'Call the PDF tools from your own code with a documented REST API.',
  mcp: 'Drive PDFShush from an AI agent through the Model Context Protocol.',
  'flip-pdf': 'Mirror pages horizontally or vertically for a quick correction.',
  watermark: 'Stamp text or a logo over every page, centred or tiled.',
  'edit-metadata': 'Change the title, author, subject and keywords of a PDF.',
  'remove-annotations': 'Strip comments, highlights and ink in one pass.',
  'pdf-to-text': 'Extract the document text into a clean .txt file.',
  'grayscale-pdf': 'Convert colour pages to clean black and white for printing.',
  'resize-pdf': 'Scale pages to A4, US Letter or a custom percentage.',
  'extract-images': 'Pull every embedded image out at its original resolution.',
  'split-by-size': 'Split a PDF into parts under a target file size.',
  'flatten-pdf': 'Bake form fields and annotations into fixed page content.',
  'unlock-pdf': 'Remove a password from a PDF you already own.',
  'jpg-to-pdf': 'Bundle photos and scans into one PDF in the order you choose.',
  'rename-pdf': 'Batch-rename files from a pattern or the document title.',
  'bates-numbering': 'Add sequential legal page numbers across a document set.',
  'split-by-text': 'Start a new file wherever chosen text appears.',
  'compress-pdf': 'Shrink a PDF while keeping text sharp and images readable.',
  workflows: 'Chain several tools into one recipe and re-run it on new files.',
  'batch-run': 'Apply one operation to a whole folder of PDFs at once.',
  stamp: 'Apply APPROVED, DRAFT or custom stamps across pages.',
  'repair-pdf': 'Rebuild a damaged cross-reference table so the file opens again.',
  'combine-pdf': 'Merge PDFs with images into a single mixed document.',
  'image-editor': 'Crop, rotate and filter images before they become a PDF.',
  'split-by-bookmarks': 'Use the document outline to cut it into chapters.',
  'create-forms': 'Turn any PDF into a fillable form with text fields and boxes.',
  'create-bookmarks': 'Generate a navigable outline from the page content.',
  'protect-pdf': 'Encrypt a PDF with AES-256 so only the password holder can open it.',
  'dark-mode-pdf': 'Rewrite light pages for night reading without a raw negative.',
  deskew: 'Straighten crooked scans so every text line sits level.',
  'ocr-pdf': 'Add a searchable, selectable text layer to scanned pages.',
};

export const WHY_CHOOSE = [
  {
    title: 'Free, with no trial counter',
    body: 'Every browser tool is free. There is no task quota, no “3 free files per hour” and no premium button hiding the download. Compress, merge, split and convert as often as the job needs.',
  },
  {
    title: 'No signup and no watermark',
    body: 'Open the tool and start. There is no email wall and no logo stamped onto your document. The output is your file, not an advertisement for ours.',
  },
  {
    title: 'Private by construction',
    body: 'The PDF is parsed by a worker inside your browser tab. There is no upload step for client-side tools, and the Content-Security-Policy has no origin a document could be sent to.',
  },
  {
    title: 'Fast, because the work is local',
    body: 'A local engine avoids the upload-wait-download loop. Small edits finish in seconds, and once the app shell is cached the core tools keep working offline.',
  },
  {
    title: 'Works on mobile and desktop',
    body: 'The same tools run on a phone, tablet, laptop or office desktop. Buttons are touch-sized, the layout reflows, and the file picker uses the device you are already holding.',
  },
  {
    title: 'Honest limits, stated up front',
    body: 'Client tools allow up to 100 MB per file, 250 MB per run and 500 pages, with lower caps for page-raster tools such as redaction and dark mode. A refusal names the reason and the next step.',
  },
];

export const USE_CASES = [
  {
    title: 'Exam and government form uploads',
    body: 'Portals for SSC, UPSC, NEET, IBPS and state recruitment often cap a photo or certificate at 100 KB or 200 KB. Compress the PDF, check the size on screen, and download a copy that fits the field.',
  },
  {
    title: 'Job applications and resumes',
    body: 'Merge a resume, cover letter and certificates into one PDF, then rename it cleanly. Because nothing is uploaded, a resume with a phone number and address stays on your own device.',
  },
  {
    title: 'College and university submissions',
    body: 'Combine assignment pages, add page numbers, and split a scanned bundle by chapter. Students can finish on a shared laptop or a phone without installing software.',
  },
  {
    title: 'Office paperwork and invoices',
    body: 'Compress a scanned invoice for email, remove blank pages, unlock a file you own, or fill and sign a form before sending it back. No document leaves the machine.',
  },
];

export const HOW_IT_WORKS = [
  {
    title: 'Pick the tool for the job',
    body: 'Choose Compress PDF, Merge PDF, PDF to JPG or any other tool from the catalog. Each one has a permanent page that explains its limits before you start.',
  },
  {
    title: 'Open or drop your file',
    body: 'Select a PDF from your device or drag it onto the page. The file is read locally; there is no upload progress bar because there is no upload.',
  },
  {
    title: 'Set the options and download',
    body: 'Choose the size, page range or quality you need, run the job, then download the result. The original on your disk is never modified.',
  },
];

export const HOME_FAQS = [
  {
    question: 'Are PDFShush tools really free?',
    answer:
      'Yes. The browser tools are free with no task quota, no watermark and no account. Server-run surfaces such as workflows and the REST API have their own stated quotas, but the everyday tools on this page do not.',
  },
  {
    question: 'Do I need to sign up to use these PDF tools?',
    answer:
      'No. Every client-side tool opens and runs without an account. An account is optional and only syncs preferences and workflow recipes; it is never a condition for editing a local file.',
  },
  {
    question: 'Are my PDF files uploaded to a server?',
    answer:
      'No for the client-side tools. The file is parsed and rebuilt by a worker inside your browser tab. Workflows, the REST API and MCP are server-run by design, and those pages say so instead of claiming otherwise.',
  },
  {
    question: 'Can I compress a PDF to 200 KB or 100 KB?',
    answer:
      'You can compress as far as the content allows and see the exact output size before downloading. A scanned document usually shrinks well; a text-only PDF that is already optimised may not reach a very small target without becoming an image, so the tool tells you which mode you are using.',
  },
  {
    question: 'Does PDFShush add a watermark?',
    answer:
      'No. There is no watermark on any output. The Watermark tool exists because you may want to add one, not because the product adds its own.',
  },
  {
    question: 'Do these PDF tools work on a phone?',
    answer:
      'Yes. The site is responsive and the tools use the system file picker, so they work in a modern mobile browser. Very large documents are still limited by the memory available to that device.',
  },
];

/** A short, human paragraph used above the tool list. */
export const HOME_TOOL_INTRO = `Every tool below has a permanent page and a plain statement of its limits. The most-used jobs are a free PDF compressor, a PDF editor online free, merge PDF, split PDF, PDF to JPG and JPG to PDF; the rest of the catalog covers page cleanup, security, conversion and scanning.`;
