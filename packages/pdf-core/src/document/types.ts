/**
 * Structured document model -- the framework-independent representation the
 * editor reasons about.
 *
 * A page is a six-level hierarchy:
 *
 *   glyph → word → line → paragraph → block → region
 *
 * Every level is plain serializable data (no classes, no DOM, no pdf-lib, no
 * Fabric) because the model crosses a worker boundary and is persisted in
 * history snapshots. Geometry is stored twice on purpose:
 *
 *   - `pdfBox` / `pdfQuad`: PDF user space, y up, the frame a future native
 *     content-stream editor (PDFium) needs.
 *   - `bbox` / `quad`: display space, top-left origin, y down, PDF points at
 *     100% zoom -- the frame the editor overlay and hit testing use.
 *
 * IDs are deterministic (derived from page index, content and quantized
 * coordinates), so re-extracting the same page yields the same identities and
 * an edit made before a re-read still points at the same logical object.
 * Editing state lives outside this model; the model is the immutable original.
 */

export interface Point {
  x: number;
  y: number;
}

/** Axis-aligned box in whatever space the containing type documents. */
export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A four-corner quad, ordered baseline start → baseline end → top end → top start. */
export interface Quad {
  p0: Point;
  p1: Point;
  p2: Point;
  p3: Point;
}

export type TextDirection = 'ltr' | 'rtl' | 'ttb';

export type FontFamily = 'helvetica' | 'times' | 'courier' | 'other';

/** Typography shared by glyphs, words, lines and paragraphs (dominant values). */
export interface TextTypography {
  /** PDF.js font resource name (`g_d0_f1`); empty for synthetic models. */
  fontName: string;
  fontFamily: FontFamily;
  /** Human-readable family as reported by pdf.js (`Helvetica`, `Times-Roman`, ...). */
  fontFamilyLabel: string;
  /** Effective size in PDF points. */
  fontSize: number;
  /** CSS-style weight (400 / 700, or the real 100-900 value when known). */
  fontWeight: number;
  bold: boolean;
  italic: boolean;
  direction: TextDirection;
  /** Baseline angle in display space, degrees clockwise from +x. */
  rotationDeg: number;
  /** Extra letter spacing in points when the extractor reports it. */
  charSpacing?: number;
}

/** How a block/paragraph participates in the page's structure. */
export type BlockKind =
  | 'body'
  | 'heading'
  | 'list'
  | 'table'
  | 'caption'
  | 'header'
  | 'footer'
  | 'figure'
  | 'unknown';

export type ParagraphRole =
  | 'body'
  | 'heading'
  | 'list-item'
  | 'caption'
  | 'table-cell'
  | 'header'
  | 'footer'
  | 'unknown';

export type TextAlignment = 'left' | 'center' | 'right' | 'justify' | 'unknown';

export type RegionKind =
  | 'content'
  | 'header'
  | 'footer'
  | 'column'
  | 'table'
  | 'margin';

export interface ListInfo {
  ordered: boolean;
  /** 1-based nesting level. */
  level: number;
  /** The literal marker (`•`, `1.`, `(a)`, ...) including trailing punctuation. */
  marker: string;
  /** Marker text removed from the item text. */
  body: string;
  /** Marker left edge relative to the paragraph's column left. */
  indentPt: number;
}

export interface Glyph {
  id: string;
  pageIndex: number;
  /** The glyph's Unicode text (usually one code point; ligatures can be longer). */
  text: string;
  /** Number of Unicode code points in `text`. */
  length: number;
  /** Content-stream order, used as a stable tie-breaker. */
  index: number;
  /** Index of the pdf.js text item this glyph came from. */
  itemIndex: number;
  /** Index inside that item. */
  itemGlyphIndex: number;
  bbox: BBox;
  pdfBox: BBox;
  quad: Quad;
  pdfQuad: Quad;
  baselineStart: Point;
  baselineEnd: Point;
  rotationDeg: number;
  direction: TextDirection;
  typography: TextTypography;
  whitespace: boolean;
  /** 1 = position came directly from the extractor; lower = inferred. */
  confidence: number;
}

export interface Word {
  id: string;
  pageIndex: number;
  text: string;
  glyphIds: string[];
  bbox: BBox;
  pdfBox: BBox;
  baselineStart: Point;
  baselineEnd: Point;
  rotationDeg: number;
  direction: TextDirection;
  typography: TextTypography;
  confidence: number;
}

export interface Line {
  id: string;
  pageIndex: number;
  text: string;
  glyphIds: string[];
  wordIds: string[];
  bbox: BBox;
  pdfBox: BBox;
  /** Baseline cross-coordinate in display space (y for horizontal text). */
  baseline: number;
  /** Projected advance range along the baseline. */
  advanceStart: number;
  advanceEnd: number;
  rotationDeg: number;
  direction: TextDirection;
  typography: TextTypography;
  alignment: TextAlignment;
  /** Left edge relative to the column/content left edge, in points. */
  indentPt: number;
  /** Row that produced this line, when the line is a table/grid cell. */
  rowId: string;
  /** Cell index inside its row (0 = leftmost). */
  cellIndex: number;
  /** Set when the line is a cell of a detected table. */
  tableId?: string;
  confidence: number;
}

/** A paragraph's line, with its offsets in `Paragraph.text`. */
export interface ParagraphLineSpan {
  lineId: string;
  start: number;
  end: number;
  /** Text inserted after this line when building the paragraph's logical text. */
  separatorAfter: string;
}

export interface Paragraph {
  id: string;
  pageIndex: number;
  lineIds: string[];
  /** Logical text: soft-wrapped lines joined by spaces, hard breaks by newline. */
  text: string;
  lineSpans: ParagraphLineSpan[];
  bbox: BBox;
  pdfBox: BBox;
  typography: TextTypography;
  alignment: TextAlignment;
  indentPt: number;
  role: ParagraphRole;
  headingLevel?: number;
  list?: ListInfo;
  tableId?: string;
  cell?: { row: number; column: number; rowSpan: number; colSpan: number };
  /** 0..1; below ~0.65 the grouping is preserved but flagged as ambiguous. */
  confidence: number;
  /** true when a heuristic had to choose between two plausible structures. */
  ambiguous: boolean;
}

export interface BlockStyle {
  typography: TextTypography;
  alignment: TextAlignment;
}

export interface TextBlock {
  id: string;
  pageIndex: number;
  paragraphIds: string[];
  bbox: BBox;
  pdfBox: BBox;
  kind: BlockKind;
  /** 0-based column index, when the block belongs to a detected column. */
  columnIndex: number;
  style: BlockStyle;
  headingLevel?: number;
  list?: ListInfo;
  tableId?: string;
  confidence: number;
  ambiguous: boolean;
}

export interface Region {
  id: string;
  pageIndex: number;
  blockIds: string[];
  bbox: BBox;
  pdfBox: BBox;
  kind: RegionKind;
  columnIndex?: number;
  confidence: number;
}

export interface TableCell {
  paragraphId: string;
  lineId: string;
  text: string;
  bbox: BBox;
  pdfBox: BBox;
  row: number;
  column: number;
  rowSpan: number;
  colSpan: number;
}

export interface TableRow {
  index: number;
  bbox: BBox;
  cells: TableCell[];
}

export interface TableModel {
  id: string;
  pageIndex: number;
  bbox: BBox;
  pdfBox: BBox;
  rowCount: number;
  columnCount: number;
  /** Column gutters in display space. */
  columns: { x0: number; x1: number }[];
  rows: TableRow[];
  confidence: number;
}

export interface ColumnModel {
  index: number;
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  blockIds: string[];
  paragraphIds: string[];
  confidence: number;
}

export interface PageStats {
  medianFontSize: number;
  medianLineGap: number;
  lineHeight: number;
  wordGap: number;
  columnCount: number;
  glyphCount: number;
  wordCount: number;
  lineCount: number;
  paragraphCount: number;
  blockCount: number;
  textCoverage: number;
  /** Time spent building the page model, milliseconds (diagnostics only). */
  buildMs: number;
}

export interface PageLayout {
  id: string;
  index: number;
  widthPt: number;
  heightPt: number;
  rotation: 0 | 90 | 180 | 270;
  /** Visible page box in PDF user space, y up. */
  mediaBox: BBox;
  cropBox: BBox;
  geometry: { x0: number; y0: number; x1: number; y1: number; rot: number };
  glyphs: Glyph[];
  words: Word[];
  lines: Line[];
  paragraphs: Paragraph[];
  blocks: TextBlock[];
  regions: Region[];
  tables: TableModel[];
  columns: ColumnModel[];
  /** Paragraph IDs in reading order. */
  readingOrder: string[];
  /** Block IDs in reading order. */
  blockOrder: string[];
  stats: PageStats;
  confidence: number;
  warnings: string[];
}

export interface DocumentStats {
  medianFontSize: number;
  columnPages: number;
  tableCount: number;
  headingCount: number;
  listCount: number;
  repeatedHeaderFooterCount: number;
}

export interface DocumentLayout {
  id: string;
  pageCount: number;
  pages: PageLayout[];
  stats: DocumentStats;
  warnings: string[];
}

/** A page-local edit, the unit Phase 2's native rewrite consumes. */
export interface ParagraphTextEdit {
  id: string;
  pageIndex: number;
  paragraphId: string;
  before: string;
  after: string;
  bbox: BBox;
  pdfBox: BBox;
  typography: TextTypography;
  role: ParagraphRole;
}
