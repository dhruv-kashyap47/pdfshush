/**
 * Long-form landing pages for low-competition keyword clusters.
 *
 * These are not duplicate tool pages: each one is a guide with its own title,
 * H1, steps, FAQ and structured data, and it links into the working tool. The
 * tool page stays the utility; this page answers the search intent behind
 * phrases such as "compress pdf to 200kb for exam form upload".
 *
 * React-free: `build/prerender.ts` imports the same data to emit static HTML.
 */

export interface LandingSection {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
}

export interface LandingFaq {
  question: string;
  answer: string;
}

export interface LandingRelated {
  label: string;
  href: string;
}

export interface LandingPage {
  path: string;
  title: string;
  description: string;
  h1: string;
  keywords: string[];
  image: string;
  intro: string[];
  sections: LandingSection[];
  steps: string[];
  faqs: LandingFaq[];
  related: LandingRelated[];
  /** The working tool this guide sends people to. */
  toolSlug: string;
  toolCta: string;
}

export const LANDING_PAGES: LandingPage[] = [
  {
    path: '/compress-pdf',
    title: 'PDF Compressor Online Free – Compress PDF | PDFShush',
    description:
      "Compress PDF online free and see the exact new size before downloading. Reduce a PDF to 200 KB, 100 KB or under 1 MB without losing readable quality. No upload.",
    h1: 'PDF Compressor Online Free',
    keywords: [
      'pdf compressor',
      'pdf compressor online free',
      'compress pdf',
      'pdf compressor 200kb',
      'pdf compressor to 100kb',
      'pdf under 500kb',
      'pdf under 1 mb',
      'pdf under 2mb',
      'reduce pdf size in kb online',
      'pdf size reducer without losing quality',
    ],
    image: '/og/compress-pdf.png',
    intro: [
      'A PDF compressor makes a document small enough to upload, email or archive. The hard part is not shrinking the file — it is shrinking it without turning a readable page into a blurry image. PDFShush gives you two modes so you can choose the trade-off instead of guessing: Smart compression re-encodes the images while keeping text, links and form fields intact, and Strong compression rebuilds each page as a JPEG for a much smaller scan.',
      'The tool shows the original size and the new size side by side before you download. That matters on an exam portal that rejects anything over 200 KB: you can try Smart first, see the number, and only move to Strong if the portal still refuses the file. Everything runs in your browser, so a document with an address, a signature or an ID number is not uploaded to a compressor service.',
    ],
    sections: [
      {
        heading: 'How to compress a PDF to 200 KB, 100 KB or under 1 MB',
        paragraphs: [
          'There is no universal “200 KB” button, because the result depends on what is inside the file. A scanned certificate is mostly images, so it can shrink a long way. A text-only PDF that is already optimised may barely move without becoming an image. The right sequence is always the same: compress with the gentler mode, check the measured size, and only use the stronger mode when the target is still out of reach.',
        ],
        bullets: [
          'Under 2 MB or 1 MB: Smart compression usually gets a scanned document there while keeping text selectable.',
          'Under 500 KB: try Smart first; if the portal still refuses, Strong compression on a scan is the reliable path.',
          'Under 200 KB: Strong compression, or reduce the page count first with Delete Pages or Extract Pages.',
          'Under 100 KB: compress, then split the file if a single PDF cannot reach the limit without becoming unreadable.',
        ],
      },
      {
        heading: 'Smart compression vs Strong compression',
        paragraphs: [
          'Smart compression is the one to use for a contract, a resume, an application form or any document you may still need to edit or search. It leaves the text as text and works on the embedded images, so the page stays sharp at any zoom. Strong compression rasterizes pages: it is designed for scans and photo-heavy files, and it is honest about the cost, because the output text is no longer selectable.',
          'If you only need a smaller file to send once and the recipient will print it, Strong is fine. If the recipient may search the text, copy a clause or fill a field, stay with Smart and reduce the page count instead.',
        ],
      },
      {
        heading: 'Why a PDF sometimes refuses to get smaller',
        paragraphs: [
          'A PDF can be large for three different reasons: big images, embedded fonts, or a lot of page content. Compression targets the first. If a file contains a single 12 MB photo at 600 DPI, shrinking that image is where the gain is. If the file is mostly vector text with subset fonts, there is much less to remove, and a tool that promises “90% smaller” is usually about to rasterize the pages.',
          'The measured size is the honest answer. Check it before you upload, and keep the original file so you can try a different mode if the first result is not accepted.',
        ],
      },
      {
        heading: 'Reducing PDF quality vs improving it',
        paragraphs: [
          'A compressor is a quality reducer: it removes image detail so the file gets smaller. That is the right trade for an upload cap, and the wrong one for a document that will be printed at full size. If the compressed page looks soft, go back to the original and try Smart compression, or reduce the page count instead of pushing the quality lower.',
          'A browser tool cannot honestly “enhance” a blurry scan and add detail that was never captured. If a source is unreadable, the fix is a better scan: 300 DPI, straight, evenly lit, and saved as a colour image before it becomes a PDF. PDF to JPG can render a clean page at that resolution, but it cannot invent sharpness.',
        ],
      },
    ],
    steps: [
      'Open Compress PDF and choose the file from your device.',
      'Pick Smart compression for text documents or Strong compression for scans.',
      'Compare the measured sizes, then download the smaller PDF.',
    ],
    faqs: [
      {
        question: 'Can I compress a PDF to exactly 200 KB?',
        answer:
          'You can compress toward a target and see the measured result before downloading. Whether a file reaches 200 KB depends on its content; Strong compression on a scan usually gets close, while an already-optimised text PDF may not without losing quality.',
      },
      {
        question: 'Does compression reduce PDF quality?',
        answer:
          'Smart compression keeps text as text and only re-encodes images, so the page remains readable. Strong compression rebuilds pages as JPEGs and lowers image quality further; use it for scans you do not need to edit or search.',
      },
      {
        question: 'Is this PDF compressor really free?',
        answer:
          'Yes. There is no charge, account, watermark or per-task quota. The only ceiling is the browser limit stated on the tool page, and a refusal names the reason.',
      },
      {
        question: 'Are my files uploaded when I compress a PDF?',
        answer:
          'No. Compression runs inside a worker in this browser tab. The document is not sent to a server, and the smaller file is downloaded from memory.',
      },
      {
        question: 'What if the portal still says the file is too large?',
        answer:
          'Check the exact limit, then either use Strong compression or reduce the page count. Splitting the document with Split by Size can also produce parts that each fit the cap.',
      },
      {
        question: 'Can this tool improve PDF quality?',
        answer:
          'No. Compression reduces image detail to make the file smaller. A browser tool cannot add detail that was never captured, so a blurry scan needs a better source scan rather than a quality enhancer.',
      },
    ],
    related: [
      { label: 'Compress to 200 KB for exam forms', href: '/pdf-under-200kb' },
      { label: 'Compress to 100 KB for SSC / UPSC', href: '/pdf-under-100kb' },
      { label: 'Open the Compress PDF tool', href: '/tools/compress-pdf' },
      { label: 'Split a PDF by size', href: '/tools/split-by-size' },
    ],
    toolSlug: 'compress-pdf',
    toolCta: 'Compress a PDF now',
  },

  {
    path: '/pdf-under-200kb',
    title: 'Compress PDF to 200 KB Online Free – Exam Forms | PDFShush',
    description:
      'Compress a PDF to under 200 KB for exam and government form uploads. Free, no signup, works in your browser, and shows the exact size before you download.',
    h1: 'Compress PDF to 200 KB Online Free',
    keywords: [
      'compress pdf to 200kb for exam form upload',
      'pdf under 200kb',
      'compress pdf for government form upload',
      'pdf compressor 200kb',
      'jpg to pdf under 200kb',
      'reduce pdf size in kb online',
    ],
    image: '/og/compress-pdf.png',
    intro: [
      'Many exam and government portals cap an uploaded PDF at 200 KB. The field may ask for a certificate, a photo ID, a signature or a merged set of documents, and the upload button simply refuses anything larger. This page is about getting under 200 KB without making the document unreadable, and about what to do when a single PDF cannot reach the limit.',
      'PDFShush compresses in your browser and reports the measured output size before you download. You do not need to sign up, install software or send a document with personal details to a third-party server just to make an upload field accept it.',
    ],
    sections: [
      {
        heading: 'Why 200 KB is such a common limit',
        paragraphs: [
          'A 200 KB cap is a compromise from an older generation of form software: small enough to keep the storage bill down, large enough for a scanned certificate. Modern phone cameras produce images several megabytes in size, so a single photo of a document can exceed the cap by twenty times. The fix is usually to reduce the image resolution and re-encode it, not to delete content.',
        ],
      },
      {
        heading: 'The practical path to under 200 KB',
        paragraphs: [
          'Start with Smart compression, which keeps text sharp and reduces the images. If the measured size is still above 200 KB, use Strong compression; on a scan it usually drops well below the cap, at the cost of turning the page into an image. If the document is many pages, a 200 KB target may be impossible without splitting it, because each page has a minimum size.',
          'For a photo or signature, it is often better to create the PDF from a properly sized image in the first place. JPG to PDF lets you fit a photo onto an A4 or Letter page, and a modest image width produces a much smaller file than a full-resolution camera photo.',
        ],
        bullets: [
          'One or two scanned pages: Strong compression is usually enough.',
          'A long certificate bundle: compress first, then split into parts if needed.',
          'A photo or signature: resize the image before making the PDF.',
          'A text-only form: keep Smart compression so the fields stay usable.',
        ],
      },
      {
        heading: 'What to check before uploading',
        paragraphs: [
          'Download the compressed file, open it once, and zoom in on the part that matters: the certificate number, the photograph, the signature. A file that fits the cap but cannot be read is a rejected application waiting to happen. Check the portal’s other rules too — some ask for a specific page size, a colour scan or a maximum number of pages, and compression does not change any of those.',
        ],
      },
    ],
    steps: [
      'Open Compress PDF and add the document that must fit 200 KB.',
      'Choose Strong compression if the file is a scan; try Smart first for a text form.',
      'Confirm the measured size is under 200 KB before downloading and uploading it.',
    ],
    faqs: [
      {
        question: 'Can every PDF be compressed under 200 KB?',
        answer:
          'No. A single page has a practical minimum size, and a long document may not fit without splitting. If the measured result stays above the cap, reduce the page count or split the file.',
      },
      {
        question: 'Will the exam portal accept a compressed scan?',
        answer:
          'That depends on the portal, not the compressor. Check its accepted format, page count and dimensions, and make sure the text is still readable after compression before you submit.',
      },
      {
        question: 'Is it safe to compress an ID or certificate here?',
        answer:
          'The file is processed in your browser and is not uploaded to PDFShush. That is the main reason to use a local compressor for documents with an ID number, address or signature.',
      },
      {
        question: 'Can I make a JPG under 200 KB and then convert it to PDF?',
        answer:
          'Yes. Resize the image first, then use JPG to PDF. A modest image width and a standard page size usually produce a PDF far below 200 KB.',
      },
    ],
    related: [
      { label: 'Compress PDF to 100 KB', href: '/pdf-under-100kb' },
      { label: 'PDF tools for exam forms', href: '/pdf-tools-for-exam-forms' },
      { label: 'Open the Compress PDF tool', href: '/tools/compress-pdf' },
      { label: 'Convert a JPG to PDF', href: '/tools/jpg-to-pdf' },
    ],
    toolSlug: 'compress-pdf',
    toolCta: 'Compress to 200 KB',
  },

  {
    path: '/pdf-under-100kb',
    title: 'Compress PDF to 100 KB Online Free – SSC, UPSC | PDFShush',
    description:
      "Make a PDF under 100 KB for SSC, UPSC, NEET or IBPS uploads. Free online size reducer in your browser with no signup and no watermark. No upload, no watermark.",
    h1: 'Compress PDF to 100 KB Online Free',
    keywords: [
      'pdf under 100kb',
      'pdf under 100kb for SSC',
      'pdf under 100kb for UPSC',
      'pdf under 100kb for NEET',
      'pdf under 100kb for IBPS',
      'pdf compressor to 100kb',
      'reduce pdf size in kb online',
    ],
    image: '/og/compress-pdf.png',
    intro: [
      'A 100 KB cap is the strictest common upload limit on Indian recruitment and admission portals. SSC, UPSC, NEET and IBPS forms often ask for a photograph, a signature or a certificate in a small window, and a phone photo can be twenty times over the limit. Getting under 100 KB is possible, but it needs a smaller image and a simpler page, not just a different button.',
      'This guide covers the realistic path: compress the PDF, reduce the image dimensions when the file is a photo, and split a multi-page bundle when one file cannot reach the target. The compressor runs locally in your browser, and the measured output size is shown before you download.',
    ],
    sections: [
      {
        heading: 'What usually fits under 100 KB',
        paragraphs: [
          'A single-page document with one modest photo or a clean scan can fit. A four-page certificate bundle at full camera resolution usually cannot, no matter which compressor you use. The trick is to reduce the information the PDF has to carry: fewer pages, a smaller image, or a lower-resolution scan.',
        ],
        bullets: [
          'One photo or signature page: resize the image, then convert to PDF.',
          'One scanned certificate: Strong compression on a grayscale scan is the smallest honest result.',
          'Several pages: split the document and upload the pages the form actually asks for.',
          'A text-only page: keep it as text and compress gently; rasterizing text rarely helps enough to justify the loss.',
        ],
      },
      {
        heading: 'Do not sacrifice the part the reviewer checks',
        paragraphs: [
          'If the portal asks for a signature, the reviewer needs to see the signature, not a grey smudge. If it asks for a photograph, the face must be recognisable. Compress, then open the file at 100% and check the details that matter. A slightly larger file that is accepted is better than a 60 KB file that gets rejected for being illegible.',
          'Some portals also enforce pixel dimensions rather than file size. Check the instructions; if a photo must be 200×230 pixels, resize it before making the PDF instead of compressing a much larger image.',
        ],
      },
      {
        heading: 'When the file will not go below 100 KB',
        paragraphs: [
          'Use Split by Size to produce parts under the cap, or Extract Pages to keep only the page the form asks for. If the portal accepts a JPG, converting a single page to an image can be smaller than a PDF of the same page. The important thing is to fit the actual requirement rather than repeatedly compressing an already-small file.',
        ],
      },
    ],
    steps: [
      'Open Compress PDF and add the document.',
      'Use Strong compression for a scan, or resize the source image first for a photo.',
      'Check that the measured size is under 100 KB and that the details are still readable.',
    ],
    faqs: [
      {
        question: 'Can I make a PDF under 100 KB for an SSC or UPSC form?',
        answer:
          'Often, if the document is one page and the image is modest. Use Strong compression on a scan, or resize the image before converting it to PDF. A long multi-page bundle may need to be split.',
      },
      {
        question: 'Why is my compressed PDF still above 100 KB?',
        answer:
          'The document may contain several pages, high-resolution images or content that cannot be removed without rasterizing. Reduce the page count or the image dimensions, then compress again.',
      },
      {
        question: 'Does a 100 KB PDF stay readable?',
        answer:
          'A single scan or photo can remain readable at that size. Text-heavy pages may become soft if they are rasterized, so check the part the reviewer will inspect before uploading.',
      },
      {
        question: 'Can I compress a PDF without uploading it?',
        answer:
          'Yes. The compressor runs in this browser tab. Documents with an ID number or signature are not sent to a server.',
      },
    ],
    related: [
      { label: 'Compress PDF to 200 KB', href: '/pdf-under-200kb' },
      { label: 'PDF tools for exam forms', href: '/pdf-tools-for-exam-forms' },
      { label: 'Open the Compress PDF tool', href: '/tools/compress-pdf' },
      { label: 'Split a PDF by size', href: '/tools/split-by-size' },
    ],
    toolSlug: 'compress-pdf',
    toolCta: 'Compress to 100 KB',
  },

  {
    path: '/merge-pdf',
    title: 'Merge PDF Online Free – Combine PDF Files | PDFShush',
    description:
      "Merge PDF files online free. Combine documents, certificates and photos into one PDF, reorder the pages, and download without a watermark or signup. No upload.",
    h1: 'Merge PDF Online Free',
    keywords: ['merge pdf', 'pdf merger', 'combine pdf', 'pdf combiner', 'merge pdf files online free'],
    image: '/og/merge-pdf.png',
    intro: [
      'Merge PDF combines several documents into one file. It is the tool for a job application that accepts a single attachment, a college portal that wants the assignment and the receipt together, or an office pack that should arrive as one PDF instead of six. Add the files, drag them into the order a reader expects, and download the combined document.',
      'Pages are copied into the new file rather than re-rendered, so text stays selectable and images keep their resolution. The original files are untouched, and the merge happens in your browser: a resume with a phone number and address is not uploaded to a merging service.',
    ],
    sections: [
      {
        heading: 'Merge PDF vs Combine files',
        paragraphs: [
          'Merge PDF is for PDFs. Combine files accepts PDFs plus JPG and PNG images, which is useful when a cover page is a photo or a signature is an image. If everything you have is already a PDF, Merge is the simpler choice; if the set is mixed, Combine saves a conversion step.',
        ],
      },
      {
        heading: 'Put the pages in the order a reader expects',
        paragraphs: [
          'A merged file is judged in the order it opens. For a job application, the usual sequence is resume, cover letter, then certificates. For a grant pack, put the application form first and the evidence after it. Drag the rows before merging; fixing the order afterwards means another tool and another download. If a single file needs its internal pages reordered, use Organize PDF before merging.',
        ],
      },
      {
        heading: 'Keep the quality and the privacy',
        paragraphs: [
          'A merge should not flatten or recompress the pages, and this one does not. Text remains searchable, links keep working and images stay at their original resolution. Nothing is uploaded, so the combined file is assembled from bytes that never left your device. If the result is too large for an upload field, compress it afterwards rather than merging lower-quality copies.',
        ],
      },
    ],
    steps: [
      'Add two or more PDFs to the merge list.',
      'Drag the rows into the order you want.',
      'Merge and download the single combined PDF.',
    ],
    faqs: [
      {
        question: 'How many PDFs can I merge at once?',
        answer:
          'One run accepts up to 500 pages and 250 MB in total, with a 100 MB limit per file. The list shows the combined page count as you add documents.',
      },
      {
        question: 'Does merging reduce PDF quality?',
        answer:
          'No. Pages are copied into the new document rather than re-rendered, so text stays selectable and images keep their original resolution.',
      },
      {
        question: 'Can I merge only certain pages from each file?',
        answer:
          'Merge works on whole documents. Use Extract Pages on each file first, then merge the extracts if you need a page-level selection.',
      },
      {
        question: 'Are my PDFs uploaded when I merge them?',
        answer:
          'No. The files are combined by a worker inside this browser tab. Nothing is uploaded or stored on a server.',
      },
      {
        question: 'Can I merge a PDF and a JPG?',
        answer:
          'Use Combine files instead. It accepts PDFs plus JPG and PNG images and places them in the order you arrange.',
      },
    ],
    related: [
      { label: 'Split a PDF', href: '/split-pdf' },
      { label: 'Open the Merge PDF tool', href: '/tools/merge-pdf' },
      { label: 'Combine PDFs and images', href: '/tools/combine-pdf' },
      { label: 'Organize PDF pages', href: '/tools/organize-pdf' },
    ],
    toolSlug: 'merge-pdf',
    toolCta: 'Merge PDF files',
  },

  {
    path: '/split-pdf',
    title: "Split Your PDF Online Free – Separate Pages | PDFShush",
    description:
      "Split a PDF online free into separate files. Also delete, extract or reorder pages in your browser. No signup, no watermark and no upload. No upload or signup.",
    h1: 'Split PDF Online Free',
    keywords: [
      'split pdf',
      'pdf page remover',
      'pdf page delete',
      'pdf page extractor',
      'delete pages from pdf online free',
      'extract pages from pdf free',
    ],
    image: '/og/split-by-pages.png',
    intro: [
      'Split PDF turns one document into the files you actually need. A combined bank statement becomes one PDF per month, a scanned workbook becomes one file per chapter, and a packet of applications becomes one file per candidate. Choose a page count and download a ZIP with every part.',
      'The same family of tools also covers the smaller page jobs: delete a blank page, pull out a signed page, or reorder a scan. All of them copy pages into a new document instead of re-rendering, so the text you keep stays searchable and the images keep their quality.',
    ],
    sections: [
      {
        heading: 'Four ways to split a PDF',
        paragraphs: [
          'Pick the split that matches how the document is organised rather than forcing every file through a page count. If the sections are a fixed length, split by pages. If the document is one long export with a repeating heading, split by text. If it has a proper outline, split by bookmarks. If the recipient enforces a size limit, split by size.',
        ],
        bullets: [
          'Split by pages: every 1, 5 or 10 pages becomes a file.',
          'Split by text: a new file starts wherever a chosen phrase appears.',
          'Split by bookmarks: each outline chapter becomes a file.',
          'Split by size: each part is built and measured against a target such as 10 MB.',
        ],
      },
      {
        heading: 'Delete pages, extract pages or reorder them',
        paragraphs: [
          'Not every page job needs a split. Delete Pages removes the blank scan or the internal memo and keeps the rest as one document. Extract Pages pulls a range such as 1-3 and 7 into a new PDF. Organize PDF gives you a visual rail for reordering, duplicating and removing pages before saving. Each tool leaves the original file alone.',
        ],
      },
      {
        heading: 'Why split in the browser',
        paragraphs: [
          'A split document often contains exactly the pages people do not want to upload: a statement, a signed contract, a medical certificate. Running the split locally means those pages are never sent to a file-processing service. The output ZIP is assembled from memory in the tab, and the original stays on your disk.',
        ],
      },
    ],
    steps: [
      'Choose the split tool that matches the document structure.',
      'Set the page count, phrase, bookmark level or target size.',
      'Run the split and download the ZIP of parts.',
    ],
    faqs: [
      {
        question: 'How do I split a PDF into separate files?',
        answer:
          'Open Split by pages, choose a chunk size such as 5, and download the ZIP. Every part is a normal PDF you can open on its own.',
      },
      {
        question: 'Can I delete pages instead of splitting?',
        answer:
          'Yes. Delete Pages removes selected pages and keeps the rest as one document, which is faster when you only need to drop a page or two.',
      },
      {
        question: 'Can I extract non-consecutive pages?',
        answer:
          'Yes. Extract Pages accepts ranges and commas, such as 2, 5-7, 12, and builds one PDF from the selection.',
      },
      {
        question: 'Does splitting reduce quality?',
        answer:
          'No. Pages are copied into the new files, so text remains selectable and images keep their original resolution.',
      },
      {
        question: 'Are my files uploaded when I split a PDF?',
        answer:
          'No. The split and the ZIP are built in this browser tab. The document never reaches a server.',
      },
    ],
    related: [
      { label: 'Merge PDF files', href: '/merge-pdf' },
      { label: 'Open the Split PDF tool', href: '/tools/split-by-pages' },
      { label: 'Delete PDF pages', href: '/tools/delete-pages' },
      { label: 'Extract PDF pages', href: '/tools/extract-pages' },
    ],
    toolSlug: 'split-by-pages',
    toolCta: 'Split a PDF',
  },

  {
    path: '/pdf-editor-online-free',
    title: "PDF Editor Online Free – Edit Your PDF Text | PDFShush",
    description:
      "Edit a PDF online free: change text, add images, fill forms, sign and reorder pages in your browser. No signup, no watermark, no upload. No upload needed.",
    h1: 'PDF Editor Online Free',
    keywords: [
      'pdf editor online free',
      'free pdf editor',
      'pdf editor online free edit text',
      'edit pdf text online',
      'pdf filler',
    ],
    image: '/og/edit-pdf.png',
    intro: [
      'A free PDF editor should let you do the small, urgent job: correct a date, replace an address, add a note, place a signature or delete a page. PDFShush opens the document in a full editor inside your browser, with a page rail, text editing, images, shapes and annotations. There is no account, no watermark and no upload step.',
      'The editor writes changes into the PDF without flattening every page. Unaffected text stays sharp and selectable, which matters when the file is a contract or a report rather than a scan. If you only need to fill a form and sign it, Fill & Sign is the shorter path; the full editor is there when the change is more than a field value.',
    ],
    sections: [
      {
        heading: 'Edit existing text, not just add a box',
        paragraphs: [
          'Click a text run on the page to change it, or add a new text box over an area. The inspector controls size, colour and alignment, and undo covers the session. This is the difference between a real editor and a “add text on top” tool: a date can be corrected in place, without a white rectangle and a mismatched font sitting over the original.',
        ],
      },
      {
        heading: 'Add images, shapes and annotations',
        paragraphs: [
          'Place a logo, a signature image or a photograph, then resize and position it on the page. Shapes and annotations are useful for marking a clause, drawing attention to a figure or adding a note for a reviewer. Everything is previewed on the real page before export, so what you see is what the PDF will contain.',
        ],
      },
      {
        heading: 'Fill, sign and manage pages in the same session',
        paragraphs: [
          'Fill & Sign handles form fields and signatures without leaving the editor family. Organize PDF mode gives you the page rail for reordering, duplicating and deleting pages. A common flow is to delete an outdated annexure, add a new page, then sign the result, all before one export. The original file is never modified, so a bad edit is a discarded download rather than a lost document.',
        ],
      },
      {
        heading: 'A PDF editor that does not upload the document',
        paragraphs: [
          'Most free editors upload the file to a server, process it there and send back a download. That is a reasonable trade for a public poster, and a poor one for a contract, an ID or a medical letter. PDFShush parses and edits the file in the tab, and the Content-Security-Policy has no origin a document could be uploaded to. The trade-off is that very large documents are limited by the memory of the device, not by a paywall.',
        ],
      },
    ],
    steps: [
      'Open Edit PDF and choose the document from your device.',
      'Change text, add an image or shape, or switch to Fill & Sign.',
      'Review the page, export, and download the edited PDF.',
    ],
    faqs: [
      {
        question: 'Can I edit text in a PDF for free?',
        answer:
          'Yes. Click a text run in the editor to change it, or add a new text box. There is no charge, account or watermark.',
      },
      {
        question: 'Will editing flatten my PDF?',
        answer:
          'No. Edits and new objects are written into the document without turning every page into an image, so unaffected text stays sharp and selectable.',
      },
      {
        question: 'Can I fill and sign a PDF here?',
        answer:
          'Yes. Fill & Sign is part of the same editor family. Click a form field to type, then add a drawn, typed or saved signature.',
      },
      {
        question: 'Does the editor work on a phone?',
        answer:
          'Yes. The layout is responsive and the tools accept touch input. A larger screen is more comfortable for precise text edits, and a stylus helps with signatures.',
      },
      {
        question: 'Is my PDF uploaded while I edit?',
        answer:
          'No. The document is parsed and edited in this browser tab. Nothing is uploaded and no account is required.',
      },
    ],
    related: [
      { label: 'Open the PDF editor', href: '/tools/edit-pdf' },
      { label: 'Fill and sign a PDF', href: '/tools/fill-sign' },
      { label: 'PDF tools with no signup', href: '/pdf-tools-no-signup' },
      { label: 'Convert a PDF to JPG', href: '/pdf-to-jpg' },
    ],
    toolSlug: 'edit-pdf',
    toolCta: 'Open the PDF editor',
  },

  {
    path: '/unlock-pdf',
    title: 'Unlock PDF Online Free – Remove Password | PDFShush',
    description:
      "Unlock a PDF online free without software. Remove a password you own or clear owner restrictions in your browser, then download an unlocked copy. No upload.",
    h1: 'Unlock PDF Online Free',
    keywords: [
      'pdf unlocker',
      'pdf password remove',
      'pdf password remover online',
      'remove password from pdf without software',
      'unlock pdf without password online',
    ],
    image: '/og/unlock-pdf.png',
    intro: [
      'Unlock PDF removes protection from a document you already have the right to open. There are two common cases: a file that opens without a prompt but blocks printing or copying, and a file that needs a password you know. The tool handles both locally, then gives you a new copy without the restriction.',
      'It does not guess or crack a password you do not know. That is a deliberate limit, not a missing feature: a PDF password remover that breaks unknown passwords is an attack tool, and the honest version of this job is “remove protection from my own file”.',
    ],
    sections: [
      {
        heading: 'Owner restrictions vs an open password',
        paragraphs: [
          'An owner-restricted PDF opens without a password but carries permission flags that stop printing, copying or editing. Those flags can be cleared here, which is useful for a vendor file you need to print or a form you need to fill. A file with an open password is different: it is encrypted with a secret, and the tool needs that secret once to decrypt your copy.',
        ],
      },
      {
        heading: 'Remove a password from a PDF without software',
        paragraphs: [
          'You do not need Acrobat, a desktop utility or a command-line tool. Open the file, enter the password you already use, and download an unlocked copy. The password and the document are processed in this browser tab, so neither is sent to a server. That matters because the password may also protect other files.',
          'The original encrypted file is not modified. Keep it if you may need the protected version later, or delete it once the unlocked copy is safely stored.',
        ],
      },
      {
        heading: 'When unlocking is the wrong tool',
        paragraphs: [
          'If you do not know the password, the correct next step is to ask the sender or recover it through the service that created the file. If the file is restricted because it contains sensitive content, consider redacting it before sharing rather than simply removing the password. Unlocking changes the protection, not the information inside.',
        ],
      },
    ],
    steps: [
      'Open Unlock PDF and add the protected document.',
      'Enter the password if the file asks for one.',
      'Download the unlocked copy; the original stays untouched.',
    ],
    faqs: [
      {
        question: 'Can I remove a PDF password without software?',
        answer:
          'Yes, if you know the password or the file only has owner restrictions. The tool runs in your browser and produces a new unlocked copy without installing anything.',
      },
      {
        question: 'Can this tool crack a password I do not know?',
        answer:
          'No. It does not guess passwords. A file with an open password needs that password once before it can be decrypted.',
      },
      {
        question: 'What is an owner-restricted PDF?',
        answer:
          'It is a file that opens without a password but restricts printing, copying or editing. Those restrictions can be cleared here; an open password is a separate protection.',
      },
      {
        question: 'Does unlocking change the document content?',
        answer:
          'It creates a decrypted copy and leaves the pages intact. The original protected file is not modified.',
      },
      {
        question: 'Is it safe to enter my password here?',
        answer:
          'The password is used in this browser tab and is not sent to PDFShush. Use the tool on a device you trust, as you would for any password entry.',
      },
    ],
    related: [
      { label: 'Open the Unlock PDF tool', href: '/tools/unlock-pdf' },
      { label: 'Protect a PDF with a password', href: '/tools/protect-pdf' },
      { label: 'Redact sensitive content', href: '/tools/redact-pdf' },
      { label: 'PDF tools with no signup', href: '/pdf-tools-no-signup' },
    ],
    toolSlug: 'unlock-pdf',
    toolCta: 'Unlock a PDF',
  },

  {
    path: '/pdf-to-jpg',
    title: 'PDF to JPG Online Free – 300 DPI Converter | PDFShush',
    description:
      "Convert PDF to JPG or PNG online free. Render pages at 300 DPI, choose a page range, and download high-quality images without uploading the file. No upload.",
    h1: 'PDF to JPG Online Free – 300 DPI',
    keywords: [
      'pdf to jpg',
      'pdf to jpg high quality 300 dpi',
      'pdf to png',
      'convert pdf to image',
      'pdf to jpg online free',
    ],
    image: '/og/pdf-to-jpg.png',
    intro: [
      'PDF to JPG renders each page as an image so you can post it, paste it into a slide, send it through a chat app or use it where only an image is accepted. Choose JPG for a smaller photo-like file, or PNG when the page is text-heavy and you need clean, lossless edges.',
      'The converter runs in your browser, so a page from a contract or a certificate is not uploaded to an image service. You can set the output width and a page range, which keeps a forty-page report from turning into forty full-resolution files when you only needed the chart on page six.',
    ],
    sections: [
      {
        heading: 'JPG or PNG: which should I choose?',
        paragraphs: [
          'JPG is smaller and works well for photographs, scans and pages with lots of colour. PNG is lossless and is the better choice for text, charts, line art and anything with a transparent background. If the image will be read on screen, JPG at a reasonable width is usually enough. If it will be printed or zoomed, PNG avoids the soft edges that JPEG compression introduces around letters.',
        ],
      },
      {
        heading: 'What 300 DPI means for a PDF page',
        paragraphs: [
          'DPI is a print measure: 300 DPI is roughly the resolution a print shop expects for a sharp page. For an A4 page, that is about 2480 pixels across. The tool lets you set the image width directly, so choose 2480 px when the output must be print quality, 1600 px for a good general image, or 960 px for a web preview. Higher settings produce larger files and take longer, which is why the page range matters.',
        ],
        bullets: [
          '960 px: quick web preview, chat sharing, small thumbnails.',
          '1600 px: a good default for slides and most uploads.',
          '2480 px: roughly 300 DPI for an A4 page.',
          '2560 px and above: print-quality output for posters or detailed figures.',
        ],
      },
      {
        heading: 'Convert only the pages you need',
        paragraphs: [
          'Enter a range such as 1-3, 7 or leave the field empty for the whole document. The output is a ZIP with one image per page, named in page order. If you need to pull an embedded photo at its original resolution rather than a rendered page, use Extract Images instead; that tool recovers the stored image, not a picture of the page.',
        ],
      },
    ],
    steps: [
      'Open PDF to JPG and add the document.',
      'Choose JPG or PNG, set the width (2480 px for about 300 DPI), and enter a page range.',
      'Convert and download the ZIP of images.',
    ],
    faqs: [
      {
        question: 'How do I convert a PDF to JPG at 300 DPI?',
        answer:
          'Set the image width to about 2480 px for an A4 page, which corresponds to roughly 300 DPI, then convert. The exact pixel count depends on the page size.',
      },
      {
        question: 'Should I use JPG or PNG?',
        answer:
          'JPG is smaller and suits photos and scans. PNG is lossless and is better for text, charts and line art where sharp edges matter.',
      },
      {
        question: 'Can I convert only some pages?',
        answer:
          'Yes. Enter a range such as 1-3 or 7, or leave it empty to render every page. The output counter shows how many images you will get.',
      },
      {
        question: 'Are my PDFs uploaded during conversion?',
        answer:
          'No. The pages are rendered to images inside this browser tab. Nothing is uploaded and the ZIP is downloaded directly from your device.',
      },
    ],
    related: [
      { label: 'Open the PDF to JPG tool', href: '/tools/pdf-to-jpg' },
      { label: 'Extract embedded images', href: '/tools/extract-images' },
      { label: 'Convert JPG to PDF', href: '/jpg-to-pdf' },
      { label: 'PDF converter guide', href: '/pdf-converter' },
    ],
    toolSlug: 'pdf-to-jpg',
    toolCta: 'Convert PDF to JPG',
  },

  {
    path: '/jpg-to-pdf',
    title: 'JPG to PDF Online Free – Convert Images to PDF | PDFShush',
    description:
      "Convert JPG, PNG or photos to PDF online free. Reorder images, choose A4 or Letter, and download one PDF without a watermark or signup. No upload or signup.",
    h1: 'JPG to PDF Online Free',
    keywords: [
      'jpg to pdf',
      'png to pdf',
      'image to pdf',
      'jpg to pdf under 200kb',
      'convert images to pdf online free',
    ],
    image: '/og/jpg-to-pdf.png',
    intro: [
      'JPG to PDF turns photos and scans into a single document. It is the standard way to submit a photographed ID, a set of receipts or an assignment captured with a phone: add the images, drag them into the order a reader expects, and choose a page size. Each image becomes one page, fitted without being stretched or cropped.',
      'The conversion runs in your browser. Photos of an ID or a signed page are not uploaded to a conversion service, which is the main reason to make the PDF locally rather than through a website that asks for an email address first.',
    ],
    sections: [
      {
        heading: 'Choose a sensible page size',
        paragraphs: [
          'A4 is the default for most Indian and European paperwork; US Letter is the common choice in the United States. You can also choose a page that matches each image, which avoids white margins around a photo but produces a document with mixed page sizes. For an upload portal, a standard A4 or Letter page is usually the safest choice.',
        ],
      },
      {
        heading: 'Keep the file under 200 KB',
        paragraphs: [
          'A camera photo can be several megabytes, and a PDF made from it inherits that size. If the portal caps the upload at 200 KB, resize the image before converting: a width around 1000–1400 px is usually enough for a readable document page. Then convert to PDF and, if needed, run the result through Compress PDF and check the measured size. A smaller source image is almost always better than repeatedly compressing a huge one.',
        ],
      },
      {
        heading: 'Order, orientation and transparency',
        paragraphs: [
          'Drag the images into reading order before conversion. A sideways phone photo should be rotated first; the Image Editor can fix it without an upload. Transparent PNG areas are placed on a white background so the page does not show a black or checkered fill. Up to 100 images can go into one PDF, which covers a receipt bundle or a photographed assignment.',
        ],
      },
    ],
    steps: [
      'Open JPG to PDF and add your JPG or PNG images.',
      'Drag them into order and choose A4, Letter or a matching page size.',
      'Create the PDF and download it.',
    ],
    faqs: [
      {
        question: 'How do I convert a JPG to PDF for free?',
        answer:
          'Add the image to JPG to PDF, choose a page size, and download the result. There is no charge, account or watermark.',
      },
      {
        question: 'Can I combine JPG and PNG images in one PDF?',
        answer:
          'Yes. Both formats are accepted in the same document. Transparent PNG areas sit on a white page background.',
      },
      {
        question: 'How do I make a JPG to PDF under 200 KB?',
        answer:
          'Resize the image before converting, then compress the PDF and check the measured size. A source image around 1000–1400 px wide is usually enough for a readable page.',
      },
      {
        question: 'Are my photos uploaded?',
        answer:
          'No. The PDF is assembled in this browser tab. Your photos and scans never leave the device.',
      },
    ],
    related: [
      { label: 'Open the JPG to PDF tool', href: '/tools/jpg-to-pdf' },
      { label: 'Compress a PDF to 200 KB', href: '/pdf-under-200kb' },
      { label: 'Convert PDF to JPG', href: '/pdf-to-jpg' },
      { label: 'Edit an image before converting', href: '/tools/image-editor' },
    ],
    toolSlug: 'jpg-to-pdf',
    toolCta: 'Convert JPG to PDF',
  },

  {
    path: '/pdf-tools-no-signup',
    title: 'PDF Tools No Signup, No Watermark, Private | PDFShush',
    description:
      "Free PDF tools with no signup and no watermark. Compress, merge, split, edit and convert in your browser, without uploading files to a server. No upload.",
    h1: 'PDF Tools With No Signup and No Watermark',
    keywords: [
      'pdf tools no signup',
      'pdf tools no watermark',
      'private pdf tools in browser',
      'ilovepdf alternative',
      'smallpdf alternative',
      'pdf candy alternative',
    ],
    image: '/og/home.png',
    intro: [
      'Most free PDF sites ask for something: an account, an email, a “free trial” that ends after two files, or a watermark on the download. PDFShush is built around the opposite trade. The tools open without an account, the output has no branding, and the file is processed in your browser instead of on an upload server.',
      'That combination is useful for the documents people actually handle: a resume, a bank statement, an ID, a medical certificate, a signed contract. None of those should need an account on a file-conversion website just to be compressed or merged.',
    ],
    sections: [
      {
        heading: 'What “no signup” actually means here',
        paragraphs: [
          'There is no email wall and no account requirement on any client-side tool. An account exists for optional preference and workflow sync, but it is not a condition for opening a PDF, running a job or downloading the result. If a page asks you to sign in before a local edit, it is the wrong page.',
        ],
      },
      {
        heading: 'No watermark on the output',
        paragraphs: [
          'The download is your document, not an advertisement. The Watermark tool exists because you may want to add a mark, not because the product adds its own. A watermarked “free” export is a paid upgrade in disguise, and it is worth checking before you trust a free PDF site with a contract.',
        ],
      },
      {
        heading: 'Private PDF tools in the browser',
        paragraphs: [
          'Client-side tools parse and rebuild the file in a worker inside the tab. There is no upload request for the document, and the Content-Security-Policy has no origin a client tool could send it to. You can check this yourself in the browser Network tab: run a merge and watch that no file body leaves the page. The trust page and the verifier exist so the claim can be tested rather than believed.',
          'The exceptions are stated, not hidden: Workflows, the REST API and the MCP server are server-run by design and say so on their pages, with a quota and a one-hour deletion window.',
        ],
      },
      {
        heading: 'PDFShush vs iLovePDF, Smallpdf and PDF Candy',
        paragraphs: [
          'The established services are polished and cover some conversions this origin does not, especially Office formats produced on a server. If you need a Word or Excel conversion and the local path is not available, a server-side service is the honest answer. For compress, merge, split, delete pages, JPG to PDF, PDF to JPG, fill and sign, the local path is usually enough, and it keeps the document on your device.',
          'The practical comparison is not “more tools” but “where does the file go”. A local tool is slower on a very large scan because your device does the work, and it is limited by the memory of that device. In exchange, there is no upload, no retention window and no account.',
        ],
      },
    ],
    steps: [
      'Pick the tool for the job from the catalog.',
      'Open the file; it is read in this browser tab.',
      'Set the options, run the job, and download without an account or watermark.',
    ],
    faqs: [
      {
        question: 'Are these PDF tools really free with no signup?',
        answer:
          'Yes. The client-side tools have no account requirement, no task quota and no watermark. Server-run surfaces such as workflows and the API have stated quotas but are clearly labelled.',
      },
      {
        question: 'Do PDFShush tools add a watermark?',
        answer:
          'No. The output has no product branding. You can add your own watermark with the Watermark tool if you want one.',
      },
      {
        question: 'Are my files uploaded to a server?',
        answer:
          'Not for client-side tools. The document is processed in the browser. Workflows, the REST API and MCP are server-run and state their retention window on their own pages.',
      },
      {
        question: 'Is PDFShush an iLovePDF or Smallpdf alternative?',
        answer:
          'For the common tools, yes, with a different data path: the file stays in your browser instead of being uploaded. Some server-side Office conversions are not offered here.',
      },
      {
        question: 'How can I verify that a file is not uploaded?',
        answer:
          'Open the browser Network tab, run a client-side tool, and check that no request carries the file body. The trust page explains the policy and the verifier lets you check redaction output.',
      },
      {
        question: 'Does PDFShush have a PDF QR code generator?',
        answer:
          'No. A QR code generator is not part of the catalog, and this page will not pretend otherwise. The tools here focus on editing, converting, compressing and securing existing PDFs.',
      },
      {
        question: 'Can I translate a PDF from English to Hindi?',
        answer:
          'There is no dedicated PDF translator. PDF to Text extracts the document text, which you can then translate with a tool you trust; Chat with PDF can also answer questions about the content in your own words.',
      },
    ],
    related: [
      { label: 'Compress a PDF', href: '/compress-pdf' },
      { label: 'Merge PDF files', href: '/merge-pdf' },
      { label: 'PDF editor online free', href: '/pdf-editor-online-free' },
      { label: 'How privacy is proven', href: '/trust' },
    ],
    toolSlug: 'compress-pdf',
    toolCta: 'Open a free PDF tool',
  },

  {
    path: '/pdf-dark-mode',
    title: "PDF Dark Mode Converter Free – Invert Colors | PDFShush",
    description:
      "Convert a PDF to dark mode or invert its colors online free. A night-reading theme with a before-and-after preview, no signup and no upload. No upload.",
    h1: 'PDF Dark Mode Converter Online Free',
    keywords: [
      'pdf dark mode converter',
      'pdf dark mode for reading',
      'pdf dark to light converter',
      'invert pdf colors online',
      'pdf night mode converter',
    ],
    image: '/og/dark-mode-pdf.png',
    intro: [
      'PDF Dark Mode rewrites a bright document for night reading. Instead of a raw colour negative that turns a chart into a strange poster, it offers a theme remap and a hue-preserving mode, with a before-and-after slider so you can judge the result before downloading. It is the tool for a long reading session on a phone in a dim room, or for a PDF that glares on an e-reader.',
      'The conversion happens in your browser. A document you are reading at night may be a contract, a medical report or a paper you do not want to upload, so the local path is the point rather than a bonus.',
    ],
    sections: [
      {
        heading: 'Dark mode vs invert colors',
        paragraphs: [
          'Inverting every colour is simple and often wrong: white text on a black page is fine, but a coloured diagram can become unreadable and a photograph can look like a negative. A theme remap keeps the structure of the page and darkens the paper while preserving readable contrast. The hue-preserving mode is the middle ground for documents with charts or coloured headings.',
        ],
      },
      {
        heading: 'Dark to light, and back again',
        paragraphs: [
          'The same pixel remap can turn a dark PDF into a light one for printing: a dark slide deck or a night-mode export often wastes ink on paper. Use the light theme, preview the page, and print the result. Keep the original if you may need the exact colours later, because the converted pages are rebuilt as images.',
        ],
      },
      {
        heading: 'What you give up',
        paragraphs: [
          'Rebuilding pages as images is what makes a clean dark version possible, and it also means the text stops being selectable and searchable. Keep the original for copying, searching or editing, and use the dark copy for reading. The page limit is lower than the ordinary tools for the same reason: every page becomes a full bitmap, and the cap keeps a large document from exhausting the tab.',
        ],
      },
    ],
    steps: [
      'Open Dark Mode PDF and add the bright document.',
      'Choose a theme and compare the before-and-after preview.',
      'Download the dark copy for night reading.',
    ],
    faqs: [
      {
        question: 'How do I make a PDF dark mode for reading?',
        answer:
          'Open Dark Mode PDF, choose a night theme, check the preview, and download the converted copy. The original file is not changed.',
      },
      {
        question: 'Does it invert every color?',
        answer:
          'You can choose an invert mode, but the theme and hue-preserving modes are usually more readable for pages with diagrams, images or coloured headings.',
      },
      {
        question: 'Can I convert a dark PDF back to light?',
        answer:
          'Yes. Choose a light theme in the same tool and preview the result before downloading, which is useful before printing a dark document.',
      },
      {
        question: 'Will the text still be selectable?',
        answer:
          'No. Pages are rebuilt as images, so text becomes part of the picture. Keep the original if you need to search, copy or edit the words.',
      },
      {
        question: 'Are my files uploaded?',
        answer:
          'No. The conversion runs in this browser tab, and the document is not sent to a server.',
      },
    ],
    related: [
      { label: 'Open the Dark Mode PDF tool', href: '/tools/dark-mode-pdf' },
      { label: 'Convert a PDF to grayscale', href: '/tools/grayscale-pdf' },
      { label: 'Compress a PDF', href: '/compress-pdf' },
      { label: 'PDF tools with no signup', href: '/pdf-tools-no-signup' },
    ],
    toolSlug: 'dark-mode-pdf',
    toolCta: 'Convert to dark mode',
  },

  {
    path: '/pdf-converter',
    title: 'PDF Converter Online Free – JPG, Text & Images | PDFShush',
    description:
      "Convert PDF files online free: PDF to JPG, PNG, text, or images to PDF. Honest status for Word and Excel, with no signup and no watermark. No upload needed.",
    h1: 'PDF Converter Online Free',
    keywords: [
      'pdf converter',
      'pdf to word',
      'convert pdf to word',
      'pdf to jpg',
      'pdf to png',
      'pdf to excel',
      'word to pdf',
      'image to pdf',
    ],
    image: '/og/pdf-to-jpg.png',
    intro: [
      'A PDF converter is really a family of directions: PDF to an image, PDF to text, images to PDF, and Office documents to PDF. PDFShush covers the directions that can run well in a browser and is honest about the ones that do not. There is no signup, no watermark, and the file is not uploaded for a local conversion.',
      'This page explains which conversions are live, which are not, and what to use instead. That matters because a search for “PDF to Word” often lands on a page that promises an editable .docx and then asks for a subscription before the download.',
    ],
    sections: [
      {
        heading: 'Conversions that work right now',
        paragraphs: [
          'These paths run in the browser and produce a real file you can download immediately. They cover the most common conversion jobs: getting a page out as an image, getting the words out as text, and turning photos into a PDF.',
        ],
        bullets: [
          'PDF to JPG or PNG: one image per page, with a width suitable for web or roughly 300 DPI print.',
          'PDF to text: the document’s own text layer into a clean .txt file.',
          'JPG or PNG to PDF: photos and scans into one ordered document.',
          'PDF to images: extract the embedded photos at their stored resolution.',
          'Images to PDF with a PDF plus JPG: Combine files mixes both in one document.',
        ],
      },
      {
        heading: 'PDF to Word and PDF to Excel: the honest status',
        paragraphs: [
          'A high-fidelity PDF to Word conversion needs a layout engine that reconstructs paragraphs, tables and styles, and it is normally a server-side job. On this origin, PDF to Word, PDF to Excel and PDF to PowerPoint are not live, and their pages say so instead of pretending to capture an email. If you need an editable document today, use PDF to Text for the words, or a service that explicitly supports the conversion.',
          'Word to PDF has the same constraint in reverse: a browser cannot render a .docx with full fidelity without an Office engine. The page explains the gap and points at the closest working path rather than offering a broken conversion.',
        ],
      },
      {
        heading: 'How to choose the right output',
        paragraphs: [
          'Choose the output the next step actually accepts. A job portal that wants an image needs JPG or PNG, not a PDF. A CMS that wants plain text needs PDF to text. A printer wants a PDF, so images should go the other way. Converting to a format the recipient cannot use is the most common wasted download.',
        ],
      },
    ],
    steps: [
      'Decide the output format the recipient accepts.',
      'Choose the matching tool: PDF to JPG, PDF to Text or JPG to PDF.',
      'Run the conversion and download the file from your browser.',
    ],
    faqs: [
      {
        question: 'Can I convert a PDF to Word for free here?',
        answer:
          'Not on this origin. PDF to Word is not live, and the page says so rather than promising a date. Use PDF to Text for the words, or a service that supports the conversion.',
      },
      {
        question: 'How do I convert a PDF to JPG?',
        answer:
          'Open PDF to JPG, choose JPG or PNG, set the width and page range, and download the ZIP of page images.',
      },
      {
        question: 'How do I convert a JPG to PDF?',
        answer:
          'Open JPG to PDF, add the images in order, choose a page size, and download the PDF.',
      },
      {
        question: 'Is the PDF converter free and watermark-free?',
        answer:
          'Yes for the conversions that are live. There is no charge, account or watermark on the output.',
      },
      {
        question: 'Are converted files uploaded?',
        answer:
          'No for the local conversions. The file is processed in this browser tab. Server-run surfaces such as workflows state their own data path.',
      },
    ],
    related: [
      { label: 'Convert PDF to JPG', href: '/pdf-to-jpg' },
      { label: 'Convert JPG to PDF', href: '/jpg-to-pdf' },
      { label: 'PDF to text tool', href: '/tools/pdf-to-text' },
      { label: 'Compress a PDF', href: '/compress-pdf' },
    ],
    toolSlug: 'pdf-to-jpg',
    toolCta: 'Open a PDF converter',
  },

  {
    path: '/pdf-tools-for-exam-forms',
    title: 'PDF Tools for Exam & Government Form Uploads | PDFShush',
    description:
      'Prepare PDFs for SSC, UPSC, NEET, IBPS and government portals: compress to 100 KB or 200 KB, merge certificates, and resize photos, all in your browser.',
    h1: 'PDF Tools for Exam and Government Form Uploads',
    keywords: [
      'compress pdf for government form upload',
      'compress pdf to 200kb for exam form upload',
      'pdf under 100kb for SSC',
      'pdf under 200kb',
      'exam form pdf upload',
    ],
    image: '/og/compress-pdf.png',
    intro: [
      'An exam or government form usually asks for the same handful of files: a photograph, a signature, a certificate and sometimes a merged set of documents. Each field has a size limit, and the portal rejects a file that misses it without explaining much. This page is a checklist for preparing those files locally, without a cyber café or an upload service.',
      'The tools linked here run in your browser. That matters for an ID, a signature and a certificate, which are exactly the documents you should not be sending to an unknown server just to make a form accept them.',
    ],
    sections: [
      {
        heading: 'The usual upload limits',
        paragraphs: [
          'Limits vary by portal, so read the instructions on the form itself. The common pattern is a photograph and a signature under 100 KB, and a certificate or document under 200 KB. Some portals ask for 500 KB or 1 MB for a merged document, and some enforce pixel dimensions rather than file size.',
        ],
        bullets: [
          'Photograph and signature: often 20–100 KB, with fixed pixel dimensions.',
          'Certificate or ID: often 100–200 KB as a PDF or JPG.',
          'Merged documents: often 500 KB to 2 MB.',
          'Scanned pages: check whether colour is required and whether the page must be A4.',
        ],
      },
      {
        heading: 'A practical checklist',
        paragraphs: [
          'Start with the source image or scan, not with a PDF that is already too large. Resize the image to a sensible width, convert it to PDF if the field wants a PDF, then compress and check the measured size. If the field wants a JPG, stop at the image stage. If the form wants one merged file, merge first and compress the result, because compressing each part separately can leave the combined file over the cap.',
        ],
        bullets: [
          'Resize or crop the photo before converting it.',
          'Make the PDF with a standard page size.',
          'Compress and confirm the measured size against the field limit.',
          'Merge certificates first, then compress the merged file.',
          'Open the final file and check that names, numbers and the photograph are readable.',
        ],
      },
      {
        heading: 'If the portal still rejects the file',
        paragraphs: [
          'Check whether the limit is size, page count, dimensions or format. A file can be under 200 KB and still fail because it is a PNG where the portal wants a JPG, or because it has three pages where the portal wants one. Reduce the page count with Extract Pages, split the document, or convert the single relevant page to an image. Repeating the same compression on an already-small file rarely helps.',
        ],
      },
    ],
    steps: [
      'Read the exact limit and accepted format for each field.',
      'Prepare the file with Compress PDF, JPG to PDF or Merge PDF.',
      'Verify the measured size and readability before submitting the form.',
    ],
    faqs: [
      {
        question: 'How do I compress a PDF for a government form?',
        answer:
          'Use Compress PDF, choose Strong for a scan or Smart for a text form, and confirm the measured size is under the portal limit before uploading.',
      },
      {
        question: 'Why does the portal reject a file that is under the limit?',
        answer:
          'The rule may be about format, page count or pixel dimensions rather than size. Check the instructions and convert to the requested format before compressing again.',
      },
      {
        question: 'Can I prepare these files without uploading them?',
        answer:
          'Yes. The compress, merge, split and image tools run in your browser, so the documents are not sent to a server.',
      },
      {
        question: 'Can I merge certificates and then compress the result?',
        answer:
          'Yes. Merge first, then compress the combined file. That avoids compressing each part separately and still ending up over the limit.',
      },
    ],
    related: [
      { label: 'Compress to 200 KB', href: '/pdf-under-200kb' },
      { label: 'Compress to 100 KB', href: '/pdf-under-100kb' },
      { label: 'Merge PDF files', href: '/merge-pdf' },
      { label: 'JPG to PDF', href: '/jpg-to-pdf' },
    ],
    toolSlug: 'compress-pdf',
    toolCta: 'Prepare an upload-ready PDF',
  },

  {
    path: '/pdfshush',
    title: 'PDFShush – Free Online PDF Tools, No Signup | PDFShush',
    description:
      'PDFShush is a free online PDF toolkit that runs in your browser. Compress, merge, split, edit and convert PDFs with no signup, no watermark and no upload.',
    h1: 'PDFShush – Free Online PDF Tools',
    keywords: ['pdf shush', 'pdfshush', 'pdfshush pdf tools', 'free pdf tools no signup'],
    image: '/og/home.png',
    intro: [
      'PDFShush is an independent PDF workspace for the ordinary document job: compress a file for a form, merge a resume and certificates, split a scan, edit a date, sign a page or convert a PDF to an image. It is free, needs no account and adds no watermark, and the client-side tools run inside your browser rather than on an upload server.',
      'The name is a small joke about the upload step people have learned to expect. There is no upload for the browser tools, so there is no retention window to read and no third party holding the file. The product is open source, and the privacy claim is written so it can be checked rather than taken on faith.',
    ],
    sections: [
      {
        heading: 'What you can do here',
        paragraphs: [
          'The catalog is organised by job rather than by marketing category: merge, split, edit and sign, compress, security, convert from PDF, convert to PDF, AI, scans and automate. The most-used tools are a PDF compressor, a free PDF editor, merge PDF, split PDF, PDF to JPG and JPG to PDF.',
        ],
        bullets: [
          'Compress a PDF to 200 KB, 100 KB or under 1 MB and see the measured size.',
          'Merge, split, delete, extract and reorder pages without re-rendering.',
          'Edit text, fill forms, sign, watermark, stamp and number pages.',
          'Convert PDF to JPG, PNG or text, and JPG or PNG to PDF.',
          'Redact, protect, unlock and flatten documents you own.',
          'Read at night with a dark mode converter, or OCR a scan to make it searchable.',
        ],
      },
      {
        heading: 'Why PDFShush exists',
        paragraphs: [
          'The ordinary PDF task should not require an account on a file-conversion website. A resume, a bank statement or a medical certificate is exactly the kind of document that should stay on the device where it already exists. The browser can now do the work, so the upload is a choice rather than a necessity.',
          'That principle also sets the limits. Very large documents are limited by the memory of the device, and some Office conversions need a server engine and are not offered. Those gaps are stated on the page instead of hidden behind a spinner or a fake “coming soon” date.',
        ],
      },
      {
        heading: 'Privacy that can be checked',
        paragraphs: [
          'The Content-Security-Policy is part of the build and has no origin a client tool could upload to. The service worker keeps the shell available offline, the trust page reports the live policy, and the redaction verifier prints a SHA-256 receipt for the output. If a surface is server-run — workflows, the REST API, the MCP server — its page says so and gives the quota and deletion window.',
        ],
      },
    ],
    steps: [
      'Open the tool for the job from the catalog.',
      'Choose the file; it is read in this browser tab.',
      'Set the options and download the result without an account or watermark.',
    ],
    faqs: [
      {
        question: 'What is PDFShush?',
        answer:
          'A free online PDF toolkit that runs the common tools in your browser: compress, merge, split, edit, sign, convert, redact and more, with no signup and no watermark.',
      },
      {
        question: 'Is PDFShush free?',
        answer:
          'Yes. The browser tools have no charge, task quota or account requirement. Server-run surfaces such as workflows and the API have stated quotas and are labelled as such.',
      },
      {
        question: 'Does PDFShush upload my files?',
        answer:
          'Not for client-side tools. The document is processed in the browser. Workflows, the REST API and MCP are server-run by design and state their retention window.',
      },
      {
        question: 'Is PDFShush open source?',
        answer:
          'Yes, under AGPL-3.0-or-later. The source can be inspected, forked and self-hosted, which is what makes the privacy claim auditable.',
      },
    ],
    related: [
      { label: 'Compress a PDF', href: '/compress-pdf' },
      { label: 'PDF editor online free', href: '/pdf-editor-online-free' },
      { label: 'PDF tools with no signup', href: '/pdf-tools-no-signup' },
      { label: 'About PDFShush', href: '/about' },
    ],
    toolSlug: 'merge-pdf',
    toolCta: 'Browse the PDF tools',
  },
];

export const LANDING_BY_PATH: Record<string, LandingPage> = Object.fromEntries(
  LANDING_PAGES.map((page) => [page.path, page]),
);

/** Paths used by the router and the sitemap; no React import needed. */
export const LANDING_PATHS = LANDING_PAGES.map((page) => page.path);
