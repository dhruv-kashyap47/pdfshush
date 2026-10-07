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
import { LIMITS, formatBytes } from '../limits.js';
import { pageGeom, viewRectToPdf, viewToPdf, displaySize, type PageGeom } from './geometry.js';
import { TEXT_ASCENT, TEXT_LINE_HEIGHT } from './textMetrics.js';

export { TEXT_ASCENT, TEXT_LINE_HEIGHT } from './textMetrics.js';

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

/**
 * Text metrics shared with the UI live in a dependency-free module (see
 * `textMetrics.ts`) -- both because the preview must agree with the exporter
 * and because the web app imports these numbers without wanting pdf-lib.
 */
const MAX_FONT_SIZE = 72;
const MIN_FONT_SIZE = 4;
/** Anything further than this from the page is a bug, not an edit. */
const MAX_EXTENT_PT = 200_000;
/** Objects may hang off an edge, but not a whole page away in any direction. */
const OFF_PAGE_MARGIN_PAGES = 2;
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg']);

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

/**
 * Validates every object before a single operator is emitted.
 *
 * The editor is the only caller today, but this path becomes the public API in
 * P6 -- so it treats its input as untrusted: NaN coordinates would otherwise
 * become NaN PDF operators (a corrupt download), and an oversized image would
 * take the worker's heap with it. Failures name the offending object.
 */
export function validateEditObjects(
  objects: EditorObject[],
  pageCount: number,
  pageSizeAt?: (pageIndex: number) => { width: number; height: number } | undefined,
): void {
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
  const seenIds = new Set<string>();

  objects.forEach((object, index) => {
    const at = `Object ${index + 1}`;
    if (!object || typeof object !== 'object') {
      throw new Error(`${at}: not an object`);
    }
    const kind = (object as { kind?: unknown }).kind;
    if (typeof kind !== 'string' || !kinds.has(kind)) {
      throw new Error(`Unknown object kind "${String(kind)}"`);
    }
    if (typeof object.id !== 'string' || object.id.length === 0) {
      throw new Error(`${at} (${kind}): every edit object needs an id`);
    }
    if (seenIds.has(object.id)) {
      throw new Error(`${at} (${kind}): duplicate object id "${object.id}"`);
    }
    seenIds.add(object.id);
    if (
      !Number.isInteger(object.pageIndex) ||
      object.pageIndex < 0 ||
      object.pageIndex >= pageCount
    ) {
      throw new Error(`Page ${(object.pageIndex as number) + 1} does not exist (document has ${pageCount} pages)`);
    }

    // Geometry: finite, non-negative, and not absurdly far from the page.
    const { x, y, width, height } = object;
    if (![x, y, width, height].every((value) => Number.isFinite(value))) {
      throw new Error(`${at} (${kind}): coordinates must be finite numbers`);
    }
    if (width < 0 || height < 0) {
      throw new Error(`${at} (${kind}): width and height cannot be negative`);
    }
    if (width > MAX_EXTENT_PT || height > MAX_EXTENT_PT) {
      throw new Error(`${at} (${kind}): object is larger than ${MAX_EXTENT_PT} pt`);
    }
    const page = pageSizeAt?.(object.pageIndex);
    if (page) {
      const marginX = page.width * OFF_PAGE_MARGIN_PAGES;
      const marginY = page.height * OFF_PAGE_MARGIN_PAGES;
      if (
        x + width < -marginX ||
        x > page.width + marginX ||
        y + height < -marginY ||
        y > page.height + marginY
      ) {
        throw new Error(`${at} (${kind}): object sits entirely off page ${object.pageIndex + 1}`);
      }
    }

    switch (kind) {
      case 'text': {
        const text = object as EditTextObject;
        if (typeof text.text !== 'string') {
          throw new Error(`${at} (text): "text" must be a string`);
        }
        if (text.text.length > LIMITS.tool.maxTextObjectChars) {
          throw new Error(
            `${at} (text): text is too long (${text.text.length} characters, max ${LIMITS.tool.maxTextObjectChars})`,
          );
        }
        if (
          !Number.isFinite(text.fontSize) ||
          text.fontSize <= 0 ||
          text.fontSize > 4 * MAX_FONT_SIZE
        ) {
          throw new Error(`${at} (text): font size must be between 0 and ${4 * MAX_FONT_SIZE}`);
        }
        if (text.align !== undefined && !['left', 'center', 'right'].includes(text.align)) {
          throw new Error(`${at} (text): align must be left, center or right`);
        }
        assertHexColor(at, kind, 'color', text.color);
        break;
      }
      case 'image': {
        const image = object as EditImageObject;
        if (!ALLOWED_MIME.has(image.mimeType)) {
          throw new Error(`${at} (image): unsupported type "${String(image.mimeType)}" (PNG or JPEG only)`);
        }
        const bytes =
          image.data instanceof Uint8Array ? image.data : new Uint8Array(image.data ?? new ArrayBuffer(0));
        if (bytes.byteLength === 0) {
          throw new Error(`${at} (image): image data is empty`);
        }
        if (bytes.byteLength > LIMITS.tool.maxImageBytes) {
          throw new Error(
            `${at} (image): image is ${formatBytes(bytes.byteLength)}, over the ${formatBytes(LIMITS.tool.maxImageBytes)} limit`,
          );
        }
        const pixels = imagePixelSize(bytes, image.mimeType);
        if (pixels && Math.max(pixels.width, pixels.height) > LIMITS.tool.maxImagePixels) {
          throw new Error(
            `${at} (image): ${pixels.width}x${pixels.height} px exceeds the ${LIMITS.tool.maxImagePixels} px limit`,
          );
        }
        break;
      }
      case 'rect':
      case 'ellipse': {
        const shape = object as EditRectObject;
        assertHexColor(at, kind, 'fill', shape.fill);
        assertHexColor(at, kind, 'stroke', shape.stroke);
        assertStrokeWidth(at, kind, shape.strokeWidth);
        break;
      }
      case 'line':
      case 'arrow': {
        const line = object as EditLineObject;
        assertHexColor(at, kind, 'stroke', line.stroke);
        assertStrokeWidth(at, kind, line.strokeWidth);
        break;
      }
      default: {
        const mark = object as EditMarkObject;
        assertHexColor(at, kind, 'color', mark.color);
        assertStrokeWidth(at, kind, mark.strokeWidth);
        break;
      }
    }
  });
}

function assertHexColor(at: string, kind: string, field: string, value: string | undefined): void {
  if (value === undefined) return;
  if (!/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim())) {
    throw new Error(`${at} (${kind}): ${field} must be a hex colour like #1a57e6`);
  }
}

function assertStrokeWidth(at: string, kind: string, value: number | undefined): void {
  if (value === undefined) return;
  if (!Number.isFinite(value) || value < 0 || value > 200) {
    throw new Error(`${at} (${kind}): stroke width must be between 0 and 200 pt`);
  }
}

/** Pixel dimensions from the file header, without decoding the image. */
export function imagePixelSize(
  bytes: Uint8Array,
  mimeType: string,
): { width: number; height: number } | null {
  try {
    if (mimeType === 'image/png' && bytes.length >= 24) {
      const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
      if (!signature.every((byte, index) => bytes[index] === byte)) return null;
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return { width: view.getUint32(16), height: view.getUint32(20) };
    }
    if (mimeType === 'image/jpeg' && bytes.length >= 4) {
      if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
      let offset = 2;
      while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const marker = bytes[offset + 1]!;
        // Standalone markers carry no length payload.
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          offset += 2;
          continue;
        }
        const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
        const isStartOfFrame =
          marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (isStartOfFrame) {
          return {
            height: (bytes[offset + 5]! << 8) | bytes[offset + 6]!,
            width: (bytes[offset + 7]! << 8) | bytes[offset + 8]!,
          };
        }
        offset += 2 + Math.max(2, length);
      }
    }
  } catch {
    return null;
  }
  return null;
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

  const geomCache = new Map<number, PageGeom>();
  const geomFor = (pageIndex: number): PageGeom => {
    let geom = geomCache.get(pageIndex);
    if (!geom) {
      geom = pageGeom(pages[pageIndex]!);
      geomCache.set(pageIndex, geom);
    }
    return geom;
  };

  validateEditObjects(objects, pages.length, (pageIndex) => displaySize(geomFor(pageIndex)));

  const needsText = objects.some((o) => o.kind === 'text');
  const regular = needsText ? await doc.embedFont(StandardFonts.Helvetica) : undefined;
  const bold = needsText ? await doc.embedFont(StandardFonts.HelveticaBold) : undefined;

  // The same logo pasted 200 times must be stored once: pdf-lib has no image
  // cache, so key our own on the bytes.
  const imageCache = new Map<string, PDFImage>();

  for (let i = 0; i < objects.length; i += 1) {
    ctx.throwIfAborted();
    const object = objects[i]!;
    const page = pages[object.pageIndex]!;
    const geom = geomFor(object.pageIndex);
    await drawObject(page, geom, object, { regular, bold, imageCache });
    progress.step(i, objects.length, 'Applying edits');
  }
}

interface FontSet {
  regular?: PDFFont;
  bold?: PDFFont;
  /** mime + content hash → embedded image, so repeats cost nothing. */
  imageCache: Map<string, PDFImage>;
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
      await drawImage(page, geom, object, fonts);
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

async function drawImage(page: PDFPage, geom: PageGeom, object: EditImageObject, fonts: FontSet): Promise<void> {
  const raw = object.data instanceof Uint8Array ? object.data : new Uint8Array(object.data);
  if (raw.byteLength === 0) return;
  const cacheKey = `${object.mimeType}:${raw.byteLength}:${hashBytes(raw)}`;
  let image = fonts.imageCache.get(cacheKey);
  if (!image) {
    image =
      object.mimeType === 'image/png'
        ? await page.doc.embedPng(raw)
        : await page.doc.embedJpg(raw);
    fonts.imageCache.set(cacheKey, image);
  }
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

/** FNV-1a over the bytes: cheap identity for "same image, second paste". */
function hashBytes(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i]!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16);
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
