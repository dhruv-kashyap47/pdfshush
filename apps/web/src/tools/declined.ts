/**
 * The parity-debt decisions (PLAN.md §31.5, M5.7).
 *
 * These eight URLs stay reachable, but the pages say **not built** and explain
 * the real blocker. They are not "in development": there is no date, no email
 * capture and no roadmap CTA. Each names the closest live path instead. When a
 * tool ships, its entry moves to `LIVE` in the registry and this record loses a
 * row; the test next to this file fails if a non-live tool has no reason.
 */

export interface DeclinedCopy {
  what: string;
  why: string;
  alternative?: { slug: string; note: string } | { note: string };
}

export const DECLINED_COPY: Record<string, DeclinedCopy> = {
  'pdf-to-word': {
    what: 'would convert a PDF into an editable Word document, keeping headings, paragraphs and reading order.',
    why: 'The engine has a measured reading-order model, but a faithful .docx also needs styles, lists, tables and font mapping. A naive export would open in Word looking nothing like the original, so it is not shipped.',
    alternative: {
      slug: 'pdf-to-text',
      note: 'extracts the same text and labels it as plain text instead of pretending to be a Word file.',
    },
  },
  'pdf-to-excel': {
    what: 'would detect tables in a PDF and write the rows and columns into a spreadsheet.',
    why: 'Table detection and cell de-duplication are a separate problem from text extraction. A text dump into cells produces wrong numbers, which is worse than no tool.',
    alternative: {
      slug: 'pdf-to-text',
      note: 'gives you the cell text in reading order; you keep the column structure yourself.',
    },
  },
  'pdf-to-ppt': {
    what: 'would turn each page into an editable slide.',
    why: '“Editable” means reconstructing the page as text, shapes and images. A JPEG wrapped in a .pptx is a picture of a slide, not an editable one, and we will not label it otherwise.',
    alternative: {
      slug: 'pdf-to-jpg',
      note: 'renders one image per page at a width you choose, ready to drop into a deck.',
    },
  },
  'word-to-pdf': {
    what: 'would render a .docx file into a PDF.',
    why: 'Word layout needs a full office text engine — fonts, floating tables, section breaks. Running that in a tab is not realistic, and a half-rendered document is a broken export.',
    alternative: {
      note: 'No live tool converts Office files today. Print the document to PDF from Word or Google Docs, then use any tool here on the result.',
    },
  },
  'html-to-pdf': {
    what: 'would render a URL or an HTML file into a print-perfect PDF.',
    why: 'It needs a headless browser on a server, plus SSRF protection and a network policy. That is a server product, not a browser tool, so it cannot sit behind the “nothing is uploaded” promise.',
    alternative: {
      note: 'Use your browser’s Print → Save as PDF, then bring the result here to edit, sign or compress it.',
    },
  },
  'ocr-pdf': {
    what: 'would add a searchable, selectable text layer to scanned pages with OCR.',
    why: 'OCR needs Tesseract or OCRmyPDF, a large server-side dependency. Without it, “searchable” would be a false claim, and this tool will not make one.',
    alternative: {
      slug: 'pdf-to-text',
      note: 'extracts an existing text layer; on a scan it returns empty, which is the honest answer.',
    },
  },
  'sign-workflow': {
    what: 'would send a document to several signers in order, then file the completed copy.',
    why: 'Routing needs accounts, stored documents, email delivery and an audit trail — a server product with a retention policy, not something a tab can honestly promise.',
    alternative: {
      slug: 'fill-sign',
      note: 'signs locally with a drawn or typed signature, and the file never leaves the browser.',
    },
  },
  'convert-batch': {
    what: 'would convert many files at once with shared settings.',
    why: 'A batch is only useful once the converters exist; the missing ones are exactly the Word, Excel, PowerPoint, HTML and OCR conversions above.',
    alternative: {
      slug: 'batch-run',
      note: 'applies a live tool — compress, grayscale, flatten, repair and more — to a whole folder today.',
    },
  },
};
