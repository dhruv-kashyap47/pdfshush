/**
 * Home-page SEO copy, shared by the React landing page and the prerenderer.
 *
 * Kept React-free so `build/prerender.ts` can import it directly (same reason
 * as `tools/tool-faqs.ts`). Editing a sentence here changes both the visible
 * page and the HTML a crawler receives, so the two cannot drift.
 *
 * Copy rules for this file:
 *  - short, common action verbs (make, combine, cut, turn, add, remove, save)
 *  - no em-dashes; a full stop is almost always clearer
 *  - keyword coverage stays natural, never repeated for density
 */

import { SITE_DESCRIPTION, SITE_NAME } from './site.ts';

export const HOME_TITLE =
  'Free Online PDF Tools: Compress, Merge, Edit | PDFShush';

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
  `${SITE_NAME} is a free online PDF toolkit for people who need to fix a file fast. Students upload assignments. Job seekers send a resume. Offices share invoices. Candidates fill exam and government forms. Every tool runs in your browser tab, so the file you open stays with you. Nothing is uploaded, nothing is stored on a server, and you do not need an account.`,
  `Use it to make a PDF smaller for a 200 KB or 100 KB upload, type on a page with a free PDF editor, combine files into one PDF, cut a long PDF into parts, or turn a PDF into JPG, PNG or text. You can also remove private details, lock a file with a password, open a file you own, fill a form, sign it, or read it in dark mode. The everyday job never needs an upload button.`,
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
  'merge-pdf': 'Combine several PDFs into one file, in any order.',
  'organize-pdf': 'Move pages into a new order, copy a page or delete one.',
  'pdf-to-jpg': 'Turn every page into a sharp JPG or PNG image.',
  'delete-pages': 'Remove pages you do not need and keep the rest.',
  'extract-pages': 'Save selected pages as a new PDF.',
  'rotate-pdf': 'Turn sideways pages the right way and save the change.',
  'split-by-pages': 'Cut a long PDF into smaller files of 1, 5 or 10 pages.',
  'alternate-mix': 'Mix two PDFs page by page so front and back scans read in order.',
  'split-in-half': 'Cut a page with two sides into two separate pages.',
  'page-numbers': 'Add page numbers in a format and position you choose.',
  'crop-pdf': 'Cut white space from the edges of every page.',
  'header-footer': 'Add the same header or footer to every page.',
  'n-up': 'Put 2, 4 or 8 pages on one sheet to save paper.',
  'edit-pdf': 'Add text, images and shapes on the page.',
  'redact-pdf': 'Remove private text and images before you share a file.',
  'summarize-pdf': 'Get a short summary with page links from your own AI key.',
  'chat-with-pdf': 'Ask questions about a document and see the pages used.',
  'edit-pdf-with-ai': 'Describe a change in plain words, check it, then apply it.',
  'fill-sign': 'Fill a form and add a drawn or typed signature.',
  signature: 'Create a reusable signature and download it as PNG, JPG or PDF.',
  api: 'Use the PDF tools from your own code with a documented API.',
  mcp: 'Let an AI agent use PDFShush through the Model Context Protocol.',
  'flip-pdf': 'Flip pages left to right or top to bottom.',
  watermark: 'Add text or a logo to every page, in the center or repeated.',
  'edit-metadata': 'Change the title, author, subject and keywords of a PDF.',
  'remove-annotations': 'Remove comments, highlights and ink in one pass.',
  'pdf-to-text': 'Save the document text as a .txt file.',
  'grayscale-pdf': 'Turn color pages into black and white for printing.',
  'resize-pdf': 'Change the page size to A4, US Letter or a custom scale.',
  'extract-images': 'Save every image inside the PDF at its original size.',
  'split-by-size': 'Cut a PDF into parts under a set file size.',
  'flatten-pdf': 'Lock form fields and notes into the page.',
  'unlock-pdf': 'Remove a password from a PDF you already own.',
  'jpg-to-pdf': 'Put photos and scans into one PDF in the order you choose.',
  'rename-pdf': 'Rename many files with a pattern or the document title.',
  'bates-numbering': 'Add numbers in order across a set of legal pages.',
  'split-by-text': 'Start a new file wherever chosen text appears.',
  'compress-pdf': 'Make a PDF smaller while keeping text clear and images readable.',
  workflows: 'Use several tools in one go and run them again on new files.',
  'batch-run': 'Use one tool on many PDFs at once.',
  stamp: 'Add APPROVED, DRAFT or your own stamp to every page.',
  'repair-pdf': 'Fix a damaged PDF so it opens again.',
  'combine-pdf': 'Put PDFs and images into one file.',
  'image-editor': 'Crop, turn and filter images before you make a PDF.',
  'split-by-bookmarks': 'Use the PDF bookmarks to cut it into chapters.',
  'create-forms': 'Turn a PDF into a form you can fill on screen.',
  'create-bookmarks': 'Add a clickable outline from the page content.',
  'protect-pdf': 'Lock a PDF with a password so only you can open it.',
  'dark-mode-pdf': 'Make bright pages dark for night reading.',
  deskew: 'Straighten a crooked scan so the text sits level.',
  'ocr-pdf': 'Add text you can search to a scanned page.',
};

/** One short line per catalog category, used by the compact tool index. */
export const CATEGORY_BLURBS: Record<string, string> = {
  merge: 'Put two or more files together.',
  split: 'Cut one file into pages or parts.',
  'edit-sign': 'Change a page, fill a form or add a signature.',
  compress: 'Make a file smaller for upload.',
  security: 'Remove private details, lock a file or open one you own.',
  'convert-from': 'Turn a PDF into images, text or a spreadsheet.',
  'convert-to': 'Make a PDF from photos or a document.',
  ai: 'Ask questions or make changes with your own key.',
  other: 'Fix pages, metadata and layout.',
  scans: 'Straighten a scan or make it searchable.',
  automate: 'Run the same steps on many files.',
  editors: 'Make a signature, stamp or image PDF.',
};

export const WHY_CHOOSE = [
  {
    title: 'Free to use',
    body: 'Every browser tool is free. There is no task limit, no trial count and no paid button hiding the download.',
  },
  {
    title: 'No signup, no watermark',
    body: 'Open a tool and start. You do not need an email address, and we do not put our logo on your file.',
  },
  {
    title: 'Your file stays with you',
    body: 'The PDF is read inside your browser tab. There is no upload step, and the page blocks any outside server.',
  },
  {
    title: 'Fast, because the work is here',
    body: 'You do not wait to upload and download. Small edits finish in seconds, and the main tools work offline.',
  },
  {
    title: 'Works on phone and computer',
    body: 'Use the same tools on a phone, tablet, laptop or office computer. Buttons are easy to tap and the page fits the screen.',
  },
  {
    title: 'Clear limits before you start',
    body: 'Browser tools allow up to 100 MB per file, 250 MB per run and 500 pages. Image tools have a lower page limit.',
  },
];

export const USE_CASES = [
  {
    title: 'Exam and government forms',
    body: 'SSC, UPSC, NEET and IBPS forms often cap a photo or certificate at 100 KB or 200 KB. Make the PDF smaller, check the size and download it.',
  },
  {
    title: 'Job applications',
    body: 'Put your resume, cover letter and certificates into one PDF. Give the file a clean name before you send it.',
  },
  {
    title: 'College work',
    body: 'Put assignment pages together, add page numbers and cut a scanned bundle into chapters. It works on a shared laptop or a phone.',
  },
  {
    title: 'Office files',
    body: 'Make a scanned invoice smaller for email, remove blank pages, open a file you own, or fill and sign a form before you send it back.',
  },
];

export const HOW_IT_WORKS = [
  {
    title: 'Pick a tool',
    body: 'Choose Compress PDF, Merge PDF, PDF to JPG or any other tool. Each page shows the limits before you start.',
  },
  {
    title: 'Open your file',
    body: 'Pick a PDF from your device or drag it onto the page. The file is read on your device, so there is no upload bar.',
  },
  {
    title: 'Choose and save',
    body: 'Set the size, page range or quality you need. Run the tool and download the result. Your original file stays as it was.',
  },
];

export const HOME_FAQS = [
  {
    question: 'Are PDFShush tools really free?',
    answer:
      'Yes. All 48 browser tools are free with no task limit, no watermark and no account. Workflows, the REST API and MCP are archived with the server tier, so they are not offered here.',
  },
  {
    question: 'Do I need to sign up to use these PDF tools?',
    answer:
      'No. Every browser tool opens and runs without an account. An account is optional and only syncs settings and history. It is never required to edit a local file.',
  },
  {
    question: 'Are my PDF files uploaded to a server?',
    answer:
      'No. The file is read and rebuilt inside your browser tab. Workflows, the REST API and MCP need a server tier that is archived, so those surfaces are not available here and their pages say so.',
  },
  {
    question: 'Can I compress a PDF to 200 KB or 100 KB?',
    answer:
      'You can make a PDF smaller and see the exact size before you download. A scanned document usually gets much smaller. A text-only PDF that is already optimized may not reach a very small target without becoming an image, so the tool shows you the result first.',
  },
  {
    question: 'Does PDFShush add a watermark?',
    answer:
      'No. There is no watermark on any output. The Watermark tool exists because you may want to add one, not because the product adds its own.',
  },
  {
    question: 'Do these PDF tools work on a phone?',
    answer:
      'Yes. The site fits a phone screen and the tools use the system file picker. Very large documents are still limited by the memory on that device.',
  },
];

/** A short, human paragraph used above the tool index. */
export const HOME_TOOL_INTRO = `Every tool has its own page and a clear list of limits. The most used tools make a PDF smaller, edit a PDF, combine PDFs, split a PDF, turn a PDF into JPG and turn JPG into PDF. The rest help you clean pages, protect a file, convert it or scan it.`;
