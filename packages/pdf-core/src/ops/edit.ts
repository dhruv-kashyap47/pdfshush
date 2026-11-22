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
  LineCapStyle,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFStream,
  StandardFonts,
  decodePDFRawStream,
  degrees,
  rgb,
  setCharacterSqueeze,
  type PDFImage,
  type PDFFont,
  type PDFPage,
  type RGB,
} from '@cantoo/pdf-lib';
import { createProgressReporter, type JobContext } from '../job.js';
import { LIMITS, formatBytes } from '../limits.js';
import { pageGeom, viewRectToPdf, viewToPdf, displaySize, type PageGeom } from './geometry.js';
import { collectFontPrograms, DocumentFontResolver } from './fontPrograms.js';
import { rasteriseTextLine } from './textRaster.js';
import {
  TEXT_ASCENT,
  TEXT_LINE_HEIGHT,
  fitTextToWidth,
} from './textMetrics.js';
import { defaultCanvasFactory, type CanvasFactory } from '../render/canvas.js';

export { TEXT_ASCENT, TEXT_LINE_HEIGHT } from './textMetrics.js';

export type EditObjectRole = 'content' | 'decoration' | 'redaction';

export interface EditObjectBase {
  id: string;
  /** Zero-based page index in the source document. */
  pageIndex: number;
  /** Display-space box (top-left origin, y down, PDF points at 100% zoom). */
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * What the object is for. `content` is a normal edit (text, image, shape);
   * `decoration` is markup (highlight/underline/strikeout/whiteout); `redaction`
   * is review geometry for the destructive redaction pipeline. The redaction
   * pipeline must never infer this from the shape: a decorative rectangle is
   * not a redaction mark. Absent means `content` for older documents.
   */
  role?: EditObjectRole;
}

export type EditorTextFontFamily = 'helvetica' | 'times' | 'courier';

/**
 * Native paragraph edit intent carried by a text overlay object.
 *
 * The overlay is still the visual preview and the fallback, but the save path
 * can promote the object into a layout-aware PDFium edit: the original line
 * objects are matched, the new text is measured in the original font and
 * extra lines are created/removed. Kept as plain data so it survives the
 * worker boundary and history snapshots.
 */
export interface EditTextNativePlan {
  paragraphId?: string;
  before: string;
  after: string;
  fontFamily?: 'helvetica' | 'times' | 'courier';
  beforeLines: { text: string; box: { x: number; y: number; width: number; height: number } }[];
  /** Whiteout ids created for this paragraph (excluded from the overlay when native wins). */
  coverIds?: string[];
  reflow: {
    width: number;
    lineHeight: number;
    firstBaselineY: number;
    x: number;
    maxLines?: number;
    /** The replacement was deliberately moved; native rewrite follows it. */
    moved?: boolean;
  };
  /**
   * Paragraph alignment before the edit. The save path only sends `align` when
   * it actually changed, so choosing "left" on an originally centred paragraph
   * repositions it instead of silently doing nothing.
   */
  originalAlign?: 'left' | 'center' | 'right';
  /**
   * Standard family the editor resolved for the original paragraph. A requested
   * family is only sent when it differs from this, so an unknown document face
   * does not look like an explicit substitution.
   */
  originalFontFamily?: 'helvetica' | 'times' | 'courier';
  strategy?: 'native-object' | 'content-stream' | 'localized-reconstruction' | 'manual-review';
  /**
   * T-06 native style controls. When present the engine makes these true on the
   * rewritten text objects; a face it cannot reproduce is substituted and
   * receipted. `styled` remains for draft compatibility and means "this edit
   * requests a style", not "demote to overlay".
   */
  style?: {
    fontSize?: number;
    color?: string;
    bold?: boolean;
    italic?: boolean;
    fontFamily?: 'helvetica' | 'times' | 'courier';
    align?: 'left' | 'center' | 'right';
    rotationDeg?: number;
  };
  styled?: boolean;
  /** C-07: engine-generated patch over a completed removal. */
  coverPolicy?: 'leftover-cover';
}

export interface EditTextObject extends EditObjectBase {
  kind: 'text';
  text: string;
  fontSize: number;
  bold?: boolean;
  italic?: boolean;
  /** Standard font family used for the exported text. */
  fontFamily?: EditorTextFontFamily;
  /** `#rrggbb`. Defaults to near-black. */
  color?: string;
  align?: 'left' | 'center' | 'right';
  /**
   * Set when this text box is replacing an existing run rather than adding new
   * text. The `text-edit` job then attempts a genuine in-place rewrite of the
   * original text object, and only draws this box (plus its `coverId` whiteout)
   * when that is not possible or does not survive verification.
   */
  inPlace?: { find: string; box: { x: number; y: number; width: number; height: number }; coverId?: string };
  /** Multi-line paragraph edit intent for the native reflow path. */
  native?: EditTextNativePlan;
  /**
   * BaseFont / FamilyName of the document font this text should use when the
   * editor can identify it. The draw path tries the embedded programme first,
   * then a standard face, then fails loudly rather than mangling glyphs.
   */
  fontKey?: string;
  /**
   * Clockwise rotation in display degrees (T-07). Absent/0 reads horizontally.
   * The text is still anchored at (x, y + first baseline), so a rotated block
   * follows the same box contract as an upright one.
   */
  rotationDeg?: number;
  /**
   * C-09: draw unencodable text as a raster image instead of refusing it. The
   * export report says `glyph-rasterised`; the pixels are local to the worker.
   */
  rasterFallback?: boolean;
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
  /** Paragraph deletion intent; only meaningful on a whiteout cover. */
  native?: EditTextNativePlan;
}

/** A freehand stroke point, relative to the object box (0..width, 0..height). */
export interface EditInkPoint {
  x: number;
  y: number;
}

/**
 * Freehand ink. Points are stored relative to the object box so moving the
 * object is a pure `x`/`y` change and resizing scales the stroke without
 * re-sampling it. Exported as vector segments with round caps/joins -- never
 * rasterised.
 */
export interface EditInkObject extends EditObjectBase {
  kind: 'ink';
  points: EditInkPoint[];
  stroke?: string;
  strokeWidth?: number;
  /** 0..1; default 1. */
  opacity?: number;
}

/** A check or cross mark: one object drawn as two stroked segments. */
export interface EditCheckObject extends EditObjectBase {
  kind: 'check' | 'cross';
  stroke?: string;
  strokeWidth?: number;
}

/**
 * A rubber stamp: a bordered box with one bold label. Kept as one object so a
 * stamp is one undo step and can never be mistaken for a redaction mark.
 */
export interface EditStampObject extends EditObjectBase {
  kind: 'stamp';
  text: string;
  color?: string;
  fontSize?: number;
}

export type EditorObject =
  | EditTextObject
  | EditImageObject
  | EditRectObject
  | EditLineObject
  | EditMarkObject
  | EditInkObject
  | EditCheckObject
  | EditStampObject;

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
/** One stroke is a gesture, not a trace of every pointer sample forever. */
const MAX_INK_POINTS = 5_000;
/** Stamps are short labels, not paragraphs. */
const MAX_STAMP_CHARS = 80;
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
      } else {
        lines.push(line);
        line = word;
      }
      // A word wider than the box is hard-broken wherever it landed -- at the
      // start of a line (the first word) or after other words (a long URL that
      // follows a short word used to overflow).
      while (line.length > 1 && measure(line) > maxWidth) {
        let cut = line.length - 1;
        while (cut > 1 && measure(line.slice(0, cut)) > maxWidth) cut -= 1;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
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
export function displayAngle(g: PageGeom): number {
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
    'ink',
    'check',
    'cross',
    'stamp',
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
    const role = (object as { role?: unknown }).role;
    if (role !== undefined && !['content', 'decoration', 'redaction'].includes(role as string)) {
      throw new Error(`${at} (${kind}): role must be content, decoration or redaction`);
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
        if (
          text.fontFamily !== undefined &&
          !['helvetica', 'times', 'courier'].includes(text.fontFamily)
        ) {
          throw new Error(`${at} (text): fontFamily must be helvetica, times or courier`);
        }
        if (text.italic !== undefined && typeof text.italic !== 'boolean') {
          throw new Error(`${at} (text): italic must be a boolean`);
        }
        if (text.rasterFallback !== undefined && typeof text.rasterFallback !== 'boolean') {
          throw new Error(`${at} (text): rasterFallback must be a boolean`);
        }
        if (
          text.rotationDeg !== undefined &&
          (!Number.isFinite(text.rotationDeg) || Math.abs(text.rotationDeg) > 360)
        ) {
          throw new Error(`${at} (text): rotationDeg must be a finite angle between -360 and 360`);
        }
        if (text.fontKey !== undefined) {
          if (typeof text.fontKey !== 'string' || text.fontKey.length === 0 || text.fontKey.length > 200) {
            throw new Error(`${at} (text): fontKey must be a non-empty string under 200 characters`);
          }
        }
        assertHexColor(at, kind, 'color', text.color);
        // A document font programme can encode glyphs the standard-14 faces
        // cannot. The draw path verifies the programme actually covers the
        // text. C-09 allows the caller to opt into a rasterised word instead of
        // a hard refusal; without that opt-in the old mangling guard stays.
        if (text.fontKey === undefined && text.rasterFallback !== true) {
          assertEncodable(at, text.text);
        }
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
      case 'ink': {
        const ink = object as EditInkObject;
        if (!Array.isArray(ink.points) || ink.points.length === 0) {
          throw new Error(`${at} (ink): a stroke needs at least one point`);
        }
        if (ink.points.length > MAX_INK_POINTS) {
          throw new Error(`${at} (ink): ${ink.points.length} points exceeds the ${MAX_INK_POINTS} point limit`);
        }
        for (const point of ink.points) {
          if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) {
            throw new Error(`${at} (ink): every point needs finite x and y`);
          }
        }
        if (ink.opacity !== undefined && (!Number.isFinite(ink.opacity) || ink.opacity < 0 || ink.opacity > 1)) {
          throw new Error(`${at} (ink): opacity must be between 0 and 1`);
        }
        assertHexColor(at, kind, 'stroke', ink.stroke);
        assertStrokeWidth(at, kind, ink.strokeWidth);
        break;
      }
      case 'check':
      case 'cross': {
        const mark = object as EditCheckObject;
        assertHexColor(at, kind, 'stroke', mark.stroke);
        assertStrokeWidth(at, kind, mark.strokeWidth);
        break;
      }
      case 'stamp': {
        const stamp = object as EditStampObject;
        if (typeof stamp.text !== 'string' || stamp.text.trim().length === 0) {
          throw new Error(`${at} (stamp): a stamp needs a label`);
        }
        if (stamp.text.length > MAX_STAMP_CHARS) {
          throw new Error(`${at} (stamp): label is too long (max ${MAX_STAMP_CHARS} characters)`);
        }
        if (
          stamp.fontSize !== undefined &&
          (!Number.isFinite(stamp.fontSize) || stamp.fontSize <= 0 || stamp.fontSize > MAX_FONT_SIZE)
        ) {
          throw new Error(`${at} (stamp): font size must be between 0 and ${MAX_FONT_SIZE}`);
        }
        assertHexColor(at, kind, 'color', stamp.color);
        // Stamps draw with a standard face, so they inherit the WinAnsi rule.
        assertEncodable(at, stamp.text);
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

/**
 * Refuses text the embedded standard font cannot represent.
 *
 * `drawText` into a WinAnsi standard font does **not** throw on characters it
 * cannot encode -- it writes them silently mangled, or drops them. That is the
 * worst possible failure for an editor: the user sees "saved, 3 pages" and only
 * discovers later that a name came out as mojibake. Losing the edit loudly at
 * validation time costs the user one retry; losing it silently costs them the
 * document. (Same principle as verifying output bytes before offering a
 * download -- caught here, where it is cheap, rather than after the write.)
 */
function assertEncodable(at: string, text: string): void {
  const unsupported = findUnencodable(text);
  if (unsupported === undefined) return;
  throw new Error(
    `${at} (text): "${unsupported}" (U+${unsupported.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}) ` +
      'cannot be drawn with the standard font. Use plain Latin text, or flatten it to an image first.',
  );
}

/** First character WinAnsi cannot encode, or undefined when all are fine. */
function findUnencodable(text: string): string | undefined {
  for (const char of text) {
    // Line breaks and tabs are structural, not glyphs: `wrapTextToWidth` splits
    // on them before anything reaches the font. Rejecting them made every
    // multi-line text box fail validation even though the draw path supports it.
    if (char === '\n' || char === '\r' || char === '\t') continue;
    const codePoint = char.codePointAt(0)!;
    if (isWinAnsi(codePoint)) continue;
    return char;
  }
  return undefined;
}

/**
 * WinAnsi (PDF Annex D), beyond ASCII.
 *
 * Built from code points rather than literal glyphs on purpose: the high range
 * is a checklist of single characters, and a list of them written out is both
 * unreviewable and trivially corrupted by an editor. U+00A0-U+00FF is Latin-1;
 * 0x80-0x9F is the typographic block PDF maps explicitly. Everything else --
 * emoji, CJK, Cyrillic, Greek -- is excluded deliberately: those are the common
 * cases, and the ones where silent mangling does the most damage.
 */
const WIN_ANSI_TYPOGRAPHIC = [
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039,
  0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122,
  0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
];

const WIN_ANSI_EXTRA = new Set(WIN_ANSI_TYPOGRAPHIC.map((cp) => String.fromCodePoint(cp)));

function isWinAnsi(codePoint: number): boolean {
  return (
    (codePoint >= 0x20 && codePoint <= 0x7e) ||
    (codePoint >= 0xa0 && codePoint <= 0xff) ||
    WIN_ANSI_EXTRA.has(String.fromCodePoint(codePoint))
  );
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

export interface ApplyEditsStats {
  /** Objects the final pass drew (covers and generated patches included). */
  objectsDrawn: number;
  /** Of those, images (including rasterised text lines). */
  imagesDrawn: number;
  /** Distinct fonts embedded by this pass. */
  fontsEmbedded: number;
}

export interface ApplyEditsOptions {
  /** Collected fidelity warnings (`text-squeeze`, `glyph-rasterised`). */
  warnings?: string[];
  /** Object ids whose text was rasterised, so verification can skip them. */
  rasterisedObjectIds?: Set<string>;
  /** Canvas used by the C-09 raster fallback; defaults to the environment's. */
  canvasFactory?: CanvasFactory;
}

/** Draws every object onto its page, in array order (later = on top). */
export async function applyEdits(
  doc: PDFDocument,
  objects: EditorObject[],
  ctx: JobContext,
  options: ApplyEditsOptions = {},
): Promise<ApplyEditsStats> {
  if (objects.length === 0) return { objectsDrawn: 0, imagesDrawn: 0, fontsEmbedded: 0 };
  const progress = createProgressReporter(ctx);
  const pages = doc.getPages();
  const isolated = new Set<number>();

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

  // The same logo pasted 200 times must be stored once: pdf-lib has no image
  // cache, so key our own on the bytes. Fonts are cached by their standard-font
  // key for the same reason (and so italic/bold variants are embedded once).
  const imageCache = new Map<string, PDFImage>();
  const fontCache = new Map<string, PDFFont>();
  const embeddedFonts = new Set<string>();
  let imagesDrawn = 0;
  const warnings = options.warnings ?? [];
  const rasterisedObjectIds = options.rasterisedObjectIds ?? new Set<string>();
  const fontPages = new Set(
    objects.flatMap((object) =>
      object.kind === 'text' && object.fontKey ? [object.pageIndex] : [],
    ),
  );
  const documentFonts =
    fontPages.size > 0
      ? new DocumentFontResolver(
          doc,
          collectFontPrograms(
            doc,
            [...fontPages].map((index) => pages[index]).filter((page): page is PDFPage => Boolean(page)),
          ),
        )
      : undefined;

  for (let i = 0; i < objects.length; i += 1) {
    ctx.throwIfAborted();
    const object = objects[i]!;
    const page = pages[object.pageIndex]!;
    if (!isolated.has(object.pageIndex)) {
      isolatePageContent(page);
      isolated.add(object.pageIndex);
    }
    const geom = geomFor(object.pageIndex);
    await drawObject(page, geom, object, {
      imageCache,
      fontCache,
      embeddedFonts,
      documentFonts,
      warnings,
      rasterisedObjectIds,
      canvasFactory: options.canvasFactory,
      onImageDrawn: () => {
        imagesDrawn += 1;
      },
    });
    progress.step(i, objects.length, 'Applying edits');
  }
  return { objectsDrawn: objects.length, imagesDrawn, fontsEmbedded: embeddedFonts.size };
}

/**
 * C-06: wrap the page's existing content in `q … Q` before appending draws.
 *
 * PDF state is saved and restored by `q/Q`. A source stream that opens a clip
 * (or changes the CTM/colour) and never closes it would otherwise apply that
 * state to everything pdf-lib appends afterwards — the classic "new text is
 * clipped away" failure. Wrapping the original in its own graphics-state scope
 * guarantees the appended objects start from the page's initial state without
 * changing a single drawing operator the source performed.
 */
function isolatePageContent(page: PDFPage): void {
  const { Contents } = page.node.normalizedEntries();
  if (!Contents || Contents.size() === 0) return;
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < Contents.size(); i += 1) {
    const value = Contents.lookup(i);
    if (!(value instanceof PDFStream)) continue;
    const filtered = value.dict.get(PDFName.of('Filter')) !== undefined;
    let decoded: Uint8Array;
    if (value instanceof PDFRawStream) {
      try {
        decoded = decodePDFRawStream(value).decode();
      } catch {
        // A filter pdf-lib cannot decode must not be "decoded" by handing back
        // its still-encoded bytes: that would splice compressed data into a raw
        // content stream. Leave the page alone instead.
        if (filtered) return;
        decoded = value.getContents();
      }
    } else if (
      'getUnencodedContents' in value &&
      typeof (value as { getUnencodedContents?: () => Uint8Array }).getUnencodedContents ===
        'function'
    ) {
      try {
        // pdf-lib's own content streams are PDFFlateStreams: getContents() is the
        // compressed payload, while getUnencodedContents() is the operators.
        decoded = (value as { getUnencodedContents(): Uint8Array }).getUnencodedContents();
      } catch {
        return;
      }
    } else {
      if (filtered) return;
      decoded = value.getContents();
    }
    chunks.push(decoded, Uint8Array.of(0x0a));
  }
  if (chunks.length === 0) return;
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const wrapped = new Uint8Array(total + 4);
  wrapped[0] = 0x71; // q
  wrapped[1] = 0x0a;
  let offset = 2;
  for (const chunk of chunks) {
    wrapped.set(chunk, offset);
    offset += chunk.length;
  }
  wrapped[offset] = 0x51; // Q
  wrapped[offset + 1] = 0x0a;

  // Compress the wrapped stream so isolation does not inflate large pages. The
  // /Filter is set by pdf-lib; the bytes are the decoded operators we just read.
  const stream = page.doc.context.flateStream(wrapped);
  // Keep /Contents an array: pdf-lib's own appender pushes into it. A bare
  // stream reference was normalised once already, so it would not be re-wrapped.
  page.node.set(
    PDFName.of('Contents'),
    page.doc.context.obj([page.doc.context.register(stream)]),
  );
  // pdf-lib caches the page's writable content stream on first draw. Replacing
  // /Contents behind that cache would make later draws land in an unreferenced
  // stream, so clear it and let the next draw create a fresh one in our array.
  const cached = page as unknown as {
    contentStream?: unknown;
    contentStreamRef?: unknown;
  };
  delete cached.contentStream;
  delete cached.contentStreamRef;
}

interface FontSet {
  /** Standard-font key (family:bold:italic) → embedded font, so repeats cost nothing. */
  fontCache: Map<string, PDFFont>;
  /** Keys of every font this pass actually embedded, for the receipt. */
  embeddedFonts: Set<string>;
  /** Image hit/miss callback, counted once per drawn object. */
  onImageDrawn?: () => void;
  /** mime + content hash → embedded image, so repeats cost nothing. */
  imageCache: Map<string, PDFImage>;
  /** Document programmes extracted from the source, when a text object asks for one. */
  documentFonts?: DocumentFontResolver;
  /** Fidelity warnings collected for the export receipt. */
  warnings: string[];
  /** Object ids whose text was drawn as pixels. */
  rasterisedObjectIds: Set<string>;
  /** Canvas for the C-09 raster fallback. */
  canvasFactory?: CanvasFactory;
}

async function drawObject(
  page: PDFPage,
  geom: PageGeom,
  object: EditorObject,
  fonts: FontSet,
): Promise<void> {
  switch (object.kind) {
    case 'text':
      await drawText(page, geom, object, fonts);
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
    case 'ink':
      drawInk(page, geom, object);
      return;
    case 'check':
    case 'cross':
      drawCheck(page, geom, object);
      return;
    case 'stamp':
      await drawStamp(page, geom, object, fonts);
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

function canDrawText(font: PDFFont, isStandard: boolean, text: string): boolean {
  return isStandard ? findUnencodable(text) === undefined : canEncodeDocumentText(font, text);
}

function measureLine(font: PDFFont, line: string, fontSize: number): number {
  try {
    return font.widthOfTextAtSize(line, fontSize);
  } catch {
    return line.length * fontSize * 0.5;
  }
}

async function drawText(page: PDFPage, geom: PageGeom, object: EditTextObject, fonts: FontSet): Promise<void> {
  if (object.text.length === 0) return;
  const fontFamily = object.fontFamily ?? 'helvetica';
  const standard = await embedStandardFont(page.doc, fonts.fontCache, fontFamily, Boolean(object.bold), Boolean(object.italic));
  if (standard) fonts.embeddedFonts.add(`standard:${fontFamily}:${Boolean(object.bold)}:${Boolean(object.italic)}`);
  let font = standard;
  if (object.fontKey && fonts.documentFonts) {
    const documentFont = await fonts.documentFonts.embed(object.fontKey);
    if (documentFont && canEncodeDocumentText(documentFont, object.text)) {
      font = documentFont;
      fonts.embeddedFonts.add(`document:${object.fontKey}`);
    }
  }
  if (!font) return;
  const fontSize = clamp(object.fontSize, MIN_FONT_SIZE, MAX_FONT_SIZE);
  const color = parseHexColor(object.color, rgb(0.07, 0.07, 0.07));
  // Display clockwise rotation maps to the opposite PDF angle (PDF y is up,
  // display y is down). The page's own /Rotate angle is already folded in.
  const angle = degrees(displayAngle(geom) - (object.rotationDeg ?? 0));
  const align = object.align ?? 'left';

  let lines = wrapTextToWidth(font, object.text, fontSize, Math.max(1, object.width));
  const chosenCanDrawLines =
    font === standard
      ? findUnencodable(lines.join('\n')) === undefined
      : canEncodeDocumentText(font, lines.join('\n'));
  if (!chosenCanDrawLines) {
    if (font !== standard && standard && findUnencodable(object.text) === undefined) {
      font = standard;
      lines = wrapTextToWidth(font, object.text, fontSize, Math.max(1, object.width));
    } else if (object.rasterFallback !== true) {
      throw new Error(
        `The document font for "${object.text.slice(0, 40)}" cannot encode this text, and no standard font can draw it.`,
      );
    }
  }
  const usingStandard = font === standard;
  let canvasFactory = fonts.canvasFactory;
  const rasterCanvas = (): CanvasFactory => {
    canvasFactory ??= defaultCanvasFactory();
    return canvasFactory;
  };
  const lineHeight = fontSize * TEXT_LINE_HEIGHT;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (line.length === 0) continue;
    const baselineY = object.y + fontSize * TEXT_ASCENT + i * lineHeight;
    let lineWidth = measureLine(font, line, fontSize);
    const encodable = canDrawText(font, usingStandard, line);

    // C-09: a line no available face can encode becomes pixels, not mojibake.
    if (!encodable) {
      if (object.rasterFallback !== true) {
        throw new Error(
          `The document font for "${object.text.slice(0, 40)}" cannot encode this text, and no standard font can draw it.`,
        );
      }
      const raster = await rasteriseTextLine({
        text: line,
        fontSize,
        color: { r: color.red, g: color.green, b: color.blue },
        family: object.fontFamily ?? 'helvetica',
        ...(object.bold ? { bold: true } : {}),
        ...(object.italic ? { italic: true } : {}),
        width: Math.max(1, object.width),
        canvasFactory: rasterCanvas(),
      });
      if (!raster) {
        throw new Error(
          `The document font for "${object.text.slice(0, 40)}" cannot encode this text and it could not be rasterised.`,
        );
      }
      const image = await page.doc.embedPng(raster.data);
      const offset =
        align === 'center'
          ? (object.width - raster.width) / 2
          : align === 'right'
            ? object.width - raster.width
            : 0;
      // Rotate the bitmap's top-left anchor with the same block pivot used for
      // drawn lines, so a rasterised line does not jump on a rotated block.
      const radians = ((object.rotationDeg ?? 0) * Math.PI) / 180;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      const pivotX = object.x;
      const pivotY = object.y + fontSize * TEXT_ASCENT;
      const rawX = offset;
      const rawY = baselineY - raster.height + fontSize * TEXT_ASCENT - pivotY;
      const [ax, ay] = viewToPdf(
        geom,
        pivotX + rawX * cos - rawY * sin,
        pivotY + rawX * sin + rawY * cos,
      );
      page.drawImage(image, {
        x: ax,
        y: ay,
        width: raster.width,
        height: raster.height,
        rotate: angle,
      });
      fonts.onImageDrawn?.();
      fonts.rasterisedObjectIds.add(object.id);
      fonts.warnings.push(
        `glyph-rasterised: "${line.slice(0, 40)}" was drawn as an image because no available font can encode it; the text is not selectable.`,
      );
      continue;
    }

    // C-08: preserve the run's right edge with horizontal scaling. A normal
    // line stays at 100%; only one that would overflow is squeezed.
    const fit = fitTextToWidth(lineWidth, Math.max(1, object.width));
    if (fit.percent !== 100) {
      lineWidth = fit.width;
      fonts.warnings.push(
        `text-squeeze: "${line.slice(0, 40)}" was drawn at ${Math.round(fit.percent)}% width` +
          (fit.unreadable ? ' (outside the readable 70-140% band)' : ''),
      );
    }
    const offset =
      align === 'center'
        ? (object.width - lineWidth) / 2
        : align === 'right'
          ? object.width - lineWidth
          : 0;

    const rotation = object.rotationDeg ?? 0;
    const pivotX = object.x;
    const pivotY = object.y + fontSize * TEXT_ASCENT;
    const drawLine = (value: string, dx: number): void => {
      // Rotate the whole text block: line 2's baseline offset must follow the
      // rotated perpendicular, not stay horizontal underneath line 1.
      const radians = (rotation * Math.PI) / 180;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      const rawX = offset + dx;
      const rawY = baselineY - pivotY;
      const x = pivotX + rawX * cos - rawY * sin;
      const y = pivotY + rawX * sin + rawY * cos;
      const [pdfX, pdfY] = viewToPdf(geom, x, y);
      if (fit.percent !== 100) page.pushOperators(setCharacterSqueeze(fit.percent));
      page.drawText(value, {
        x: pdfX,
        y: pdfY,
        size: fontSize,
        font,
        color,
        rotate: angle,
      });
      if (fit.percent !== 100) page.pushOperators(setCharacterSqueeze(100));
    };

    // A document subset can omit U+0020. Drawing words at measured positions
    // keeps the line readable without asking the font for a space glyph; a
    // space-less run extracts as separate words rather than `wordword`.
    const spaceEncodable = canDrawText(font, usingStandard, ' ');
    if (spaceEncodable || !line.includes(' ')) {
      drawLine(line, 0);
      continue;
    }
    const words = line.split(/\s+/).filter((word) => word.length > 0);
    const spaceWidth = fontSize * 0.28;
    const scale = fit.percent / 100;
    let cursor = 0;
    for (const word of words) {
      drawLine(word, cursor);
      // Positions advance in the drawn (squeezed) space, or the words walk
      // past the line's right edge when `Tz` is active.
      cursor += (measureLine(font, word, fontSize) + spaceWidth) * scale;
    }
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
  fonts.onImageDrawn?.();
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
  // Neither fill nor stroke means the object is invisible, not an opaque black box:
  // pdf-lib's default fill colour is black.
  if (!object.fill && !object.stroke) return;
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
  if (!object.fill && !object.stroke) return;
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
 * Freehand ink as vector segments. Round caps make each join round without a
 * second join pass, and a single-point stroke is a dot rather than an invisible
 * zero-length line. Points are relative to the object box, so a move is just a
 * new `x`/`y` and a resize scales the stroke with the box.
 */
function drawInk(page: PDFPage, geom: PageGeom, object: EditInkObject): void {
  if (object.points.length === 0) return;
  const thickness = clamp(object.strokeWidth ?? 1.5, 0.5, 24);
  const color = parseHexColor(object.stroke, rgb(0.12, 0.16, 0.23));
  const opacity = clamp(object.opacity ?? 1, 0, 1);
  const map = (point: EditInkPoint): [number, number] =>
    viewToPdf(geom, object.x + point.x, object.y + point.y);

  if (object.points.length === 1) {
    const [x, y] = map(object.points[0]!);
    page.drawCircle({ x, y, size: thickness / 2, color, opacity });
    return;
  }

  for (let i = 1; i < object.points.length; i += 1) {
    const [sx, sy] = map(object.points[i - 1]!);
    const [ex, ey] = map(object.points[i]!);
    page.drawLine({
      start: { x: sx, y: sy },
      end: { x: ex, y: ey },
      thickness,
      color,
      opacity,
      lineCap: LineCapStyle.Round,
    });
  }
}

/** Two stroked segments in the object box: a tick or a cross. */
function drawCheck(page: PDFPage, geom: PageGeom, object: EditCheckObject): void {
  const thickness = clamp(object.strokeWidth ?? 2, 0.5, 24);
  const color = parseHexColor(object.stroke, rgb(0.09, 0.55, 0.3));
  const point = (fx: number, fy: number): [number, number] =>
    viewToPdf(geom, object.x + object.width * fx, object.y + object.height * fy);
  const segments: Array<[[number, number], [number, number]]> =
    object.kind === 'check'
      ? [
          [point(0.18, 0.52), point(0.42, 0.8)],
          [point(0.42, 0.8), point(0.86, 0.22)],
        ]
      : [
          [point(0.2, 0.2), point(0.8, 0.8)],
          [point(0.8, 0.2), point(0.2, 0.8)],
        ];
  for (const [[sx, sy], [ex, ey]] of segments) {
    page.drawLine({
      start: { x: sx, y: sy },
      end: { x: ex, y: ey },
      thickness,
      color,
      lineCap: LineCapStyle.Round,
    });
  }
}

/**
 * A bordered stamp with one bold label, centred in the box and shrunk to fit.
 * Vector plus a real text run: the label stays selectable/editable, unlike the
 * raster stamps in the reference.
 */
async function drawStamp(
  page: PDFPage,
  geom: PageGeom,
  object: EditStampObject,
  fonts: FontSet,
): Promise<void> {
  const color = parseHexColor(object.color, rgb(0.09, 0.55, 0.3));
  const box = viewRectToPdf(geom, object);
  const border = clamp(Math.min(object.width, object.height) * 0.07, 1, 5);
  page.drawRectangle({
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    borderColor: color,
    borderWidth: border,
  });

  const font = await embedStandardFont(page.doc, fonts.fontCache, 'helvetica', true, false);
  if (font) fonts.embeddedFonts.add('standard:helvetica:true:false');
  if (!font || object.text.length === 0) return;
  // Draw the label exactly as stored. Uppercasing here could turn a valid
  // WinAnsi code point into a non-WinAnsi one (µ -> Greek Mu) after validation
  // had already passed; presets are authored uppercase instead.
  const text = object.text;
  let size = clamp(object.fontSize ?? object.height * 0.42, MIN_FONT_SIZE, MAX_FONT_SIZE);
  // Never let the label outgrow the box vertically; a short stamp would
  // otherwise draw its text past the border.
  size = Math.min(size, Math.max(MIN_FONT_SIZE, object.height * 0.72));
  let width = font.widthOfTextAtSize(text, size);
  const maxWidth = Math.max(1, object.width - border * 4);
  if (width > maxWidth && width > 0) {
    size = clamp((size * maxWidth) / width, MIN_FONT_SIZE, MAX_FONT_SIZE);
    width = font.widthOfTextAtSize(text, size);
  }
  const [ax, ay] = viewToPdf(
    geom,
    object.x + (object.width - width) / 2,
    object.y + object.height / 2 + size * 0.35,
  );
  page.drawText(text, {
    x: ax,
    y: ay,
    size,
    font,
    color,
    rotate: degrees(displayAngle(geom)),
  });
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

function canEncodeDocumentText(font: PDFFont, text: string): boolean {
  for (const char of text) {
    if (char === '\r' || char === '\n' || char === '\t') continue;
    try {
      const encoded = font.encodeText(char).toString().replace(/[<>]/g, '');
      // Glyph 0 is .notdef: the font parsed, but cannot draw this character.
      if (encoded.length === 0 || /^0+$/.test(encoded)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

async function embedStandardFont(
  doc: PDFDocument,
  cache: Map<string, PDFFont>,
  family: EditorTextFontFamily,
  bold: boolean,
  italic: boolean,
): Promise<PDFFont | undefined> {
  const key = `${family}:${bold}:${italic}`;
  const cached = cache.get(key);
  if (cached) return cached;

  let fontName: StandardFonts;
  if (family === 'times') {
    fontName = bold && italic
      ? StandardFonts.TimesRomanBoldItalic
      : bold
        ? StandardFonts.TimesRomanBold
        : italic
          ? StandardFonts.TimesRomanItalic
          : StandardFonts.TimesRoman;
  } else if (family === 'courier') {
    fontName = bold && italic
      ? StandardFonts.CourierBoldOblique
      : bold
        ? StandardFonts.CourierBold
        : italic
          ? StandardFonts.CourierOblique
          : StandardFonts.Courier;
  } else {
    fontName = bold && italic
      ? StandardFonts.HelveticaBoldOblique
      : bold
        ? StandardFonts.HelveticaBold
        : italic
          ? StandardFonts.HelveticaOblique
          : StandardFonts.Helvetica;
  }

  try {
    const font = await doc.embedFont(fontName);
    cache.set(key, font);
    return font;
  } catch {
    return undefined;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(value, min), max) : min;
}
