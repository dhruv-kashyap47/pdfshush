/**
 * Editor write path -- turns display-space overlay objects into page content.
 *
 * Objects live in *display space* (top-left origin, y down -- the frame the UI
 * sees), and this module is the only place that converts back to PDF user
 * space. Rotation-sensitive primitives (text, images) carry the display-x
 * angle so they read upright in the viewer even on /Rotate 90 pages; boxes and
 * lines are rotation-symmetric once their corners are mapped.
 *
 * The save path re-parses its own output (`validateExport`) so a corrupt
 * document can never be offered for download.
 */

import {
  PDFDocument,
  StandardFonts,
  degrees,
  rgb,
  type PDFImage,
  type PDFFont,
  type PDFPage,
  type RGB,
} from '@cantoo/pdf-lib';
import { createProgressReporter, type JobContext } from '../job.js';
import { pageGeom, viewRectToPdf, viewToPdf, type PageGeom } from './geometry.js';

export interface EditObjectBase {
  id: string;
  /** Zero-based page index in the source document. */
  pageIndex: number;
  /** Display-space box (top-left origin, y down, PDF points at 100% zoom). */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EditTextObject extends EditObjectBase {
  kind: 'text';
  text: string;
  fontSize: number;
  bold?: boolean;
  /** `#rrggbb`. Defaults to near-black. */
  color?: string;
  align?: 'left' | 'center' | 'right';
}

export interface EditImageObject extends EditObjectBase {
  kind: 'image';
  data: Uint8Array | ArrayBuffer;
  mimeType: string;
}

export interface EditRectObject extends EditObjectBase {
  kind: 'rect' | 'ellipse';
  /** `#rrggbb`; absent = no fill. */
  fill?: string;
  /** `#rrggbb`; absent = no border. */
  stroke?: string;
  strokeWidth?: number;
}

export interface EditLineObject extends EditObjectBase {
  kind: 'line' | 'arrow';
  stroke?: string;
  strokeWidth?: number;
  /** true = bottom-left → top-right instead of top-left → bottom-right. */
  reverse?: boolean;
}

export interface EditMarkObject extends EditObjectBase {
  kind: 'highlight' | 'strikeout' | 'underline' | 'whiteout';
  color?: string;
  strokeWidth?: number;
}

export type EditorObject =
  | EditTextObject
  | EditImageObject
  | EditRectObject
  | EditLineObject
  | EditMarkObject;

const TEXT_LINE_HEIGHT = 1.2;
/** Helvetica sits on the baseline ~0.8em below the box top; whiteouts cover the rest. */
const TEXT_ASCENT = 1.0;
const MAX_FONT_SIZE = 72;
const MIN_FONT_SIZE = 4;

/** Parses `#rgb` / `#rrggbb` (clamped); anything unparseable falls back. */
export function parseHexColor(value: string | undefined, fallback: RGB): RGB {
  if (!value) return fallback;
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return fallback;
  let hex = match[1]!;
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  const n = Number.parseInt(hex, 16);
  return rgb(
    Math.min(1, ((n >> 16) & 0xff) / 255),
    Math.min(1, ((n >> 8) & 0xff) / 255),
    Math.min(1, (n & 0xff) / 255),
  );
}

/**
 * Greedy word wrap against the real embedded font, so what the PDF shows is
 * exactly what was measured. Explicit newlines force breaks; a single word
 * wider than the box is hard-broken by character.
 */
export function wrapTextToWidth(
  font: PDFFont,
  text: string,
  fontSize: number,
  maxWidth: number,
): string[] {
  const measure = (s: string): number => {
    try {
      return font.widthOfTextAtSize(s, fontSize);
    } catch {
      return s.length * fontSize * 0.5;
    }
  };
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      const candidate = line.length === 0 ? word : `${line} ${word}`;
      if (measure(candidate) <= maxWidth || line.length === 0) {
        line = candidate;
        // A single word wider than the box: hard-break what fits.
        while (line.length > 1 && measure(line) > maxWidth) {
          let cut = line.length - 1;
          while (cut > 1 && measure(line.slice(0, cut)) > maxWidth) cut -= 1;
          lines.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      } else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

/**
 * The angle (CCW degrees) that makes drawn content read left-to-right *in
 * display space*: display +x mapped into PDF space.
 */
function displayAngle(g: PageGeom): number {
  switch (g.rot) {
    case 90:
      return 90;
    case 180:
      return 180;
    case 270:
      return -90;
    default:
      return 0;
  }
}

/** Throws for any object whose page does not exist (fail before drawing). */
export function validateEditObjects(objects: EditorObject[], pageCount: number): void {
  const kinds = new Set([
    'text',
    'image',
    'rect',
    'ellipse',
    'line',
    'arrow',
    'highlight',
    'strikeout',
    'underline',
    'whiteout',
  ]);
  for (const object of objects) {
    if (!Number.isInteger(object.pageIndex) || object.pageIndex < 0 || object.pageIndex >= pageCount) {
      throw new Error(`Page ${object.pageIndex + 1} does not exist (document has ${pageCount} pages)`);
    }
    if (!object.id) throw new Error('Every edit object needs an id');
    if (!kinds.has(object.kind)) throw new Error(`Unknown object kind "${object.kind}"`);
  }
}

/** Draws every object onto its page, in array order (later = on top). */
export async function applyEdits(
  doc: PDFDocument,
  objects: EditorObject[],
  ctx: JobContext,
): Promise<void> {
  if (objects.length === 0) return;
  const progress = createProgressReporter(ctx);
  const pages = doc.getPages();
  validateEditObjects(objects, pages.length);

  const needsText = objects.some((o) => o.kind === 'text');
  const regular = needsText ? await doc.embedFont(StandardFonts.Helvetica) : undefined;
  const bold = needsText ? await doc.embedFont(StandardFonts.HelveticaBold) : undefined;

  const geomCache = new Map<number, PageGeom>();
  const geomFor = (pageIndex: number): PageGeom => {
    let geom = geomCache.get(pageIndex);
    if (!geom) {
      geom = pageGeom(pages[pageIndex]!);
      geomCache.set(pageIndex, geom);
    }
    return geom;
  };

  for (let i = 0; i < objects.length; i += 1) {
    ctx.throwIfAborted();
    const object = objects[i]!;
    const page = pages[object.pageIndex]!;
    const geom = geomFor(object.pageIndex);
    await drawObject(page, geom, object, { regular, bold });
    progress.step(i, objects.length, 'Applying edits');
  }
}

interface FontSet {
  regular?: PDFFont;
  bold?: PDFFont;
}

async function drawObject(
  page: PDFPage,
  geom: PageGeom,
  object: EditorObject,
  fonts: FontSet,
): Promise<void> {
  switch (object.kind) {
    case 'text':
      drawText(page, geom, object, fonts);
      return;
    case 'image':
      await drawImage(page, geom, object);
      return;
    case 'rect':
      drawRect(page, geom, object);
      return;
    case 'ellipse':
      drawEllipse(page, geom, object);
      return;
    case 'line':
    case 'arrow':
      drawLine(page, geom, object);
      return;
    case 'highlight': {
      const box = viewRectToPdf(geom, object);
      page.drawRectangle({
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        color: parseHexColor(object.color, rgb(1, 0.88, 0.4)),
        opacity: 0.45,
      });
      return;
    }
    case 'whiteout': {
      const box = viewRectToPdf(geom, object);
      page.drawRectangle({
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        color: rgb(1, 1, 1),
      });
      return;
    }
    case 'strikeout':
    case 'underline': {
      // The bar is placed in display y first (through the middle of the box, or
      // on its bottom edge), then both endpoints are mapped -- so it lands
      // exactly where the UI drew it on any rotation.
      const barY =
        object.kind === 'strikeout'
          ? object.y + object.height / 2
          : object.y + object.height - 1;
      const thickness = clamp(object.strokeWidth ?? 1.5, 0.5, 24);
      const color = parseHexColor(
        object.color,
        object.kind === 'strikeout' ? rgb(0.85, 0.17, 0.17) : rgb(0.1, 0.34, 0.9),
      );
      const [sx, sy] = viewToPdf(geom, object.x, barY);
      const [ex, ey] = viewToPdf(geom, object.x + object.width, barY);
      page.drawLine({ start: { x: sx, y: sy }, end: { x: ex, y: ey }, thickness, color });
      return;
    }
  }
}

function drawText(page: PDFPage, geom: PageGeom, object: EditTextObject, fonts: FontSet): void {
  const font = (object.bold ? fonts.bold : fonts.regular) ?? fonts.regular;
  if (!font || object.text.length === 0) return;
  const fontSize = clamp(object.fontSize, MIN_FONT_SIZE, MAX_FONT_SIZE);
  const color = parseHexColor(object.color, rgb(0.07, 0.07, 0.07));
  const angle = degrees(displayAngle(geom));
  const align = object.align ?? 'left';

  const lines = wrapTextToWidth(font, object.text, fontSize, Math.max(1, object.width));

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (line.length === 0) continue;
    let lineWidth = 0;
    try {
      lineWidth = font.widthOfTextAtSize(line, fontSize);
    } catch {
      lineWidth = line.length * fontSize * 0.5;
    }
    const offset =
      align === 'center'
        ? (object.width - lineWidth) / 2
        : align === 'right'
          ? object.width - lineWidth
          : 0;
    // Baseline of line i in display space, then mapped -- each line anchors in
    // display coordinates so rotation and alignment compose correctly.
    const [ax, ay] = viewToPdf(
      geom,
      object.x + offset,
      object.y + fontSize * TEXT_ASCENT + i * fontSize * TEXT_LINE_HEIGHT,
    );
    page.drawText(line, { x: ax, y: ay, size: fontSize, font, color, rotate: angle });
  }
}

async function drawImage(page: PDFPage, geom: PageGeom, object: EditImageObject): Promise<void> {
  const raw = object.data instanceof Uint8Array ? object.data : new Uint8Array(object.data);
  if (raw.byteLength === 0) return;
  const isPng = object.mimeType === 'image/png';
  const image: PDFImage = isPng ? await page.doc.embedPng(raw) : await page.doc.embedJpg(raw);
  // Anchor = the image's bottom-left *in display space*, rotated into PDF space
  // so the bitmap reads upright after the viewer applies /Rotate.
  const [ax, ay] = viewToPdf(geom, object.x, object.y + object.height);
  page.drawImage(image, {
    x: ax,
    y: ay,
    width: Math.max(1, object.width),
    height: Math.max(1, object.height),
    rotate: degrees(displayAngle(geom)),
  });
}

function drawRect(page: PDFPage, geom: PageGeom, object: EditRectObject): void {
  const box = viewRectToPdf(geom, object);
  const stroke = object.stroke ? parseHexColor(object.stroke, rgb(0, 0, 0)) : undefined;
  page.drawRectangle({
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    ...(object.fill ? { color: parseHexColor(object.fill, rgb(1, 1, 1)) } : {}),
    ...(stroke
      ? {
          borderColor: stroke,
          borderWidth: clamp(object.strokeWidth ?? 1.5, 0.5, 24),
        }
      : {}),
  });
}

function drawEllipse(page: PDFPage, geom: PageGeom, object: EditRectObject): void {
  const box = viewRectToPdf(geom, object);
  const stroke = object.stroke ? parseHexColor(object.stroke, rgb(0, 0, 0)) : undefined;
  page.drawEllipse({
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
    xScale: Math.max(0.5, box.width / 2),
    yScale: Math.max(0.5, box.height / 2),
    ...(object.fill ? { color: parseHexColor(object.fill, rgb(1, 1, 1)) } : {}),
    ...(stroke
      ? {
          borderColor: stroke,
          borderWidth: clamp(object.strokeWidth ?? 1.5, 0.5, 24),
        }
      : {}),
  });
}

function drawLine(page: PDFPage, geom: PageGeom, object: EditLineObject): void {
  const thickness = clamp(object.strokeWidth ?? 1.5, 0.5, 24);
  const color = parseHexColor(object.stroke, rgb(0.12, 0.16, 0.23));
  const startDisplay = object.reverse
    ? { x: object.x, y: object.y + object.height }
    : { x: object.x, y: object.y };
  const endDisplay = object.reverse
    ? { x: object.x + object.width, y: object.y }
    : { x: object.x + object.width, y: object.y + object.height };
  const [sx, sy] = viewToPdf(geom, startDisplay.x, startDisplay.y);
  const [ex, ey] = viewToPdf(geom, endDisplay.x, endDisplay.y);
  page.drawLine({ start: { x: sx, y: sy }, end: { x: ex, y: ey }, thickness, color });

  if (object.kind === 'arrow') {
    const angle = Math.atan2(ey - sy, ex - sx);
    const barb = Math.max(6, thickness * 4);
    for (const delta of [0.45, -0.45]) {
      page.drawLine({
        start: { x: ex, y: ey },
        end: {
          x: ex - Math.cos(angle + delta) * barb,
          y: ey - Math.sin(angle + delta) * barb,
        },
        thickness,
        color,
      });
    }
  }
}

/**
 * Re-parses saved bytes before the UI is allowed to offer a download. A
 * document that does not load -- or whose page count moved -- is a failed
 * export, never a silent one.
 */
export async function validateExport(bytes: Uint8Array, expectedPages: number): Promise<void> {
  let reloaded: PDFDocument;
  try {
    reloaded = await PDFDocument.load(bytes, { throwOnInvalidObject: true, updateMetadata: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Export validation failed: ${message}`);
  }
  const pages = reloaded.getPageCount();
  if (pages !== expectedPages) {
    throw new Error(`Export validation failed: expected ${expectedPages} pages, found ${pages}`);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(value, min), max) : min;
}
