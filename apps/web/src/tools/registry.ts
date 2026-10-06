/**
 * Tool registry -- the information architecture of the product.
 *
 * Mirrors the Sejda catalog one-to-one (categories, slugs, naming) so every
 * URL and menu entry we ship on day one is final. `status: 'live'` tools are
 * wired to real jobs; 'planned' tools render a landing page that explains what
 * is coming, which keeps SEO/internal links stable across phases.
 */

import type { LucideIcon } from 'lucide-react';
import {
  ArrowRightLeft,
  Bookmark,
  Combine,
  Columns2,
  Contrast,
  Crop,
  Droplets,
  Eraser,
  FileCode,
  FileImage,
  FileOutput,
  FileSpreadsheet,
  FileText,
  Files,
  FlipHorizontal,
  Gauge,
  Hash,
  Highlighter,
  Image,
  LayoutGrid,
  Link2,
  Lock,
  Mail,
  Merge,
  Minimize2,
  PenTool,
  Presentation,
  Printer,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Rows2,
  Ruler,
  ScanText,
  Scissors,
  Signature,
  Sparkles,
  Stamp,
  Trash2,
  Type,
  Unlock,
  Wand2,
  Wrench,
  Workflow,
} from 'lucide-react';

export type ToolStatus = 'live' | 'planned';

export interface ToolDef {
  slug: string;
  name: string;
  /** One-line description shown on cards and tool pages. */
  description: string;
  category: string;
  status: ToolStatus;
  icon: LucideIcon;
  /** Accent color key used by tool cards (theme palette). */
  accent: Accent;
}

export type Accent = 'green' | 'blue' | 'amber' | 'rose' | 'violet' | 'cyan' | 'orange';

export interface ToolCategory {
  id: string;
  label: string;
  tools: ToolDef[];
}

const t = (
  slug: string,
  name: string,
  description: string,
  category: string,
  icon: LucideIcon,
  accent: Accent,
  status: ToolStatus = 'planned',
): ToolDef => ({ slug, name, description, category, status, icon, accent });

/**
 * The three Phase 0 pilots. Everything else is 'planned' until its phase lands.
 */
const LIVE = new Set(['merge-pdf', 'organize-pdf', 'pdf-to-jpg']);

const tool = (
  slug: string,
  name: string,
  description: string,
  category: string,
  icon: LucideIcon,
  accent: Accent,
): ToolDef => t(slug, name, description, category, icon, accent, LIVE.has(slug) ? 'live' : 'planned');

export const TOOL_CATEGORIES: ToolCategory[] = [
  {
    id: 'merge',
    label: 'Merge',
    tools: [
      tool('alternate-mix', 'Alternate & Mix', 'Interleave pages from two PDFs into one document.', 'merge', ArrowRightLeft, 'violet'),
      tool('merge-pdf', 'Merge PDF files', 'Combine multiple PDFs into a single document, in any order.', 'merge', Merge, 'green'),
      tool('organize-pdf', 'Organize pages', 'Reorder, duplicate and delete pages with drag and drop.', 'merge', LayoutGrid, 'green'),
    ],
  },
  {
    id: 'split',
    label: 'Split',
    tools: [
      tool('extract-pages', 'Extract Pages', 'Pull specific pages out into a brand-new PDF.', 'split', FileOutput, 'blue'),
      tool('split-by-pages', 'Split by pages', 'Break a PDF into fixed-size chunks (every 1, 5, 10 pages).', 'split', Scissors, 'blue'),
      tool('split-by-bookmarks', 'Split by bookmarks', 'Use the document outline to cut it into chapters.', 'split', Bookmark, 'blue'),
      tool('split-in-half', 'Split in half', 'Cut every page down the middle into two documents.', 'split', Columns2, 'cyan'),
      tool('split-by-size', 'Split by size', 'Split into parts under a target file size.', 'split', Gauge, 'cyan'),
      tool('split-by-text', 'Split by text', 'Break the document where matching text appears.', 'split', Type, 'violet'),
    ],
  },
  {
    id: 'edit-sign',
    label: 'Edit & Sign',
    tools: [
      tool('edit-pdf', 'Edit PDF', 'Add text, images, shapes and annotations directly on the page.', 'edit-sign', PenTool, 'green'),
      tool('fill-sign', 'Fill & Sign', 'Fill forms and sign documents with a drawn or typed signature.', 'edit-sign', Signature, 'amber'),
      tool('create-forms', 'Create Forms', 'Turn any PDF into a fillable form with text fields and checkboxes.', 'edit-sign', Highlighter, 'amber'),
      tool('delete-pages', 'Delete Pages', 'Remove pages you do not need — drag to select, done.', 'edit-sign', Trash2, 'rose'),
    ],
  },
  {
    id: 'compress',
    label: 'Compress',
    tools: [
      tool('compress-pdf', 'Compress PDF', 'Shrink file size while keeping text sharp and images readable.', 'compress', Minimize2, 'orange'),
    ],
  },
  {
    id: 'security',
    label: 'Security',
    tools: [
      tool('protect-pdf', 'Protect PDF', 'Encrypt with a password so only the holder can open it.', 'security', Lock, 'blue'),
      tool('unlock-pdf', 'Unlock PDF', 'Remove a password from a PDF you own.', 'security', Unlock, 'blue'),
      tool('watermark', 'Watermark', 'Stamp text or an image over every page — tiled or centered.', 'security', Droplets, 'cyan'),
      tool('flatten-pdf', 'Flatten PDF', 'Fuse form fields and annotations into static page content.', 'security', Eraser, 'violet'),
    ],
  },
  {
    id: 'convert-from',
    label: 'Convert from PDF',
    tools: [
      tool('pdf-to-word', 'PDF to Word', 'Convert PDF to an editable .docx file.', 'convert-from', FileText, 'blue'),
      tool('pdf-to-excel', 'PDF to Excel', 'Extract tables from a PDF into a spreadsheet.', 'convert-from', FileSpreadsheet, 'green'),
      tool('pdf-to-ppt', 'PDF to PowerPoint', 'Turn each page into an editable slide deck.', 'convert-from', Presentation, 'orange'),
      tool('pdf-to-jpg', 'PDF to JPG', 'Render every page as an image — JPG or PNG.', 'convert-from', Image, 'amber'),
      tool('pdf-to-text', 'PDF to Text', 'Strip a PDF down to plain text.', 'convert-from', FileText, 'violet'),
    ],
  },
  {
    id: 'convert-to',
    label: 'Convert to PDF',
    tools: [
      tool('jpg-to-pdf', 'JPG to PDF', 'Bundle photos and scans into a single PDF.', 'convert-to', FileImage, 'amber'),
      tool('word-to-pdf', 'Word to PDF', 'Convert .docx files to PDF.', 'convert-to', FileText, 'blue'),
      tool('html-to-pdf', 'HTML to PDF', 'Render any web page into a print-perfect PDF.', 'convert-to', FileCode, 'orange'),
    ],
  },
  {
    id: 'other',
    label: 'Other',
    tools: [
      tool('bates-numbering', 'Bates Numbering', 'Sequential legal page numbering across a whole set.', 'other', Hash, 'violet'),
      tool('create-bookmarks', 'Create Bookmarks', 'Generate an outline from page content automatically.', 'other', Bookmark, 'blue'),
      tool('crop-pdf', 'Crop PDF', 'Trim margins or crop to a custom region on every page.', 'other', Crop, 'green'),
      tool('edit-metadata', 'Edit Metadata', 'Change title, author, subject and keywords.', 'other', Wrench, 'cyan'),
      tool('extract-images', 'Extract Images', 'Pull every embedded image out of a PDF.', 'other', Files, 'amber'),
      tool('flip-pdf', 'Flip PDF', 'Mirror pages horizontally or vertically.', 'other', FlipHorizontal, 'violet'),
      tool('grayscale-pdf', 'Grayscale PDF', 'Convert color pages to clean black and white.', 'other', Contrast, 'rose'),
      tool('header-footer', 'Header & Footer', 'Add repeating headers and footers with page numbers.', 'other', Printer, 'blue'),
      tool('n-up', 'N-up', 'Arrange 2, 4 or 8 pages onto one sheet for printing.', 'other', Rows2, 'cyan'),
      tool('page-numbers', 'Page Numbers', 'Insert page numbers anywhere on the page.', 'other', Hash, 'green'),
      tool('rename-pdf', 'Rename PDF', 'Batch-rename files from metadata or a pattern.', 'other', Type, 'amber'),
      tool('repair-pdf', 'Repair PDF', 'Rebuild a damaged PDF into a readable file.', 'other', RefreshCw, 'rose'),
      tool('resize-pdf', 'Resize PDF', 'Scale pages to A4, Letter or a custom size.', 'other', Ruler, 'blue'),
      tool('rotate-pdf', 'Rotate PDF', 'Rotate pages 90° and keep the rotation saved.', 'other', RotateCw, 'green'),
      tool('remove-annotations', 'Remove Annotations', 'Strip comments, highlights and ink in one pass.', 'other', Eraser, 'violet'),
    ],
  },
  {
    id: 'scans',
    label: 'Scans',
    tools: [
      tool('deskew', 'Deskew', 'Straighten crooked scans so text lines up with the page.', 'scans', RotateCcw, 'orange'),
      tool('ocr-pdf', 'OCR', 'Make scanned documents searchable and selectable with OCRmyPDF.', 'scans', ScanText, 'green'),
    ],
  },
  {
    id: 'automate', // "Workflows" on Sejda, renamed: Sejda's brand word, not their feature
    label: 'Automate',
    tools: [
      tool('workflows', 'Workflows', 'Chain tools together and re-run them on new files automatically.', 'automate', Workflow, 'violet'),
      tool('batch-run', 'Batch run', 'Apply one operation to a whole folder of PDFs.', 'automate', Sparkles, 'amber'),
      tool('api', 'REST API', 'Call every tool from your own code with a public API key.', 'automate', Link2, 'blue'),
      tool('mcp', 'MCP server', 'Drive PDFShush from any AI agent over the Model Context Protocol.', 'automate', Wand2, 'cyan'),
      tool('sign-workflow', 'Sign & route', 'Collect signatures in order, then file the finished document.', 'automate', Mail, 'rose'),
      tool('convert-batch', 'Batch convert', 'Convert many files at once with shared settings.', 'automate', Combine, 'green'),
    ],
  },
  {
    id: 'editors',
    label: 'Editors',
    tools: [
      tool('image-editor', 'Image Editor', 'Crop, rotate and filter images before they become a PDF.', 'editors', Image, 'amber'),
      tool('signature', 'Signature', 'Create and save a reusable handwritten signature.', 'editors', Signature, 'green'),
      tool('stamp', 'Stamp', 'Apply APPROVED / DRAFT stamps across pages.', 'editors', Stamp, 'rose'),
      tool('combine-pdf', 'Combine files', 'Merge PDFs with images and Office files in between.', 'editors', Combine, 'blue'),
    ],
  },
];

export const ALL_TOOLS: ToolDef[] = TOOL_CATEGORIES.flatMap((category) => category.tools);

export const TOOLS_BY_SLUG: Record<string, ToolDef> = Object.fromEntries(
  ALL_TOOLS.map((def) => [def.slug, def]),
);

/** Homepage "Most popular" row, mirroring the Sejda landing grid. */
export const POPULAR_SLUGS = [
  'edit-pdf',
  'compress-pdf',
  'delete-pages',
  'merge-pdf',
  'split-by-pages',
  'crop-pdf',
  'fill-sign',
  'pdf-to-word',
  'extract-pages',
];

export function popularTools(): ToolDef[] {
  return POPULAR_SLUGS.map((slug) => TOOLS_BY_SLUG[slug]).filter((def): def is ToolDef => Boolean(def));
}

export function getTool(slug: string | undefined): ToolDef | undefined {
  return slug ? TOOLS_BY_SLUG[slug] : undefined;
}

export function liveTools(): ToolDef[] {
  return ALL_TOOLS.filter((def) => def.status === 'live');
}
