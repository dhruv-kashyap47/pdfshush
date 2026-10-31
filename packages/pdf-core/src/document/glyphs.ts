/**
 * pdf.js text content → glyphs in both coordinate frames.
 *
 * pdf.js gives us a text *item*: a string, a text matrix, and its measured
 * width. It does not give per-character advances, so we distribute the item
 * width with a per-character weight table. That is the same approach used by
 * PdfZero's `estimateGlyphsForRun`, and it is good enough for caret placement,
 * word selection and highlighting; it is never used to claim glyph-exact
 * kerning. The `confidence` on these glyphs records that they are estimated
 * (1.0 for the item box, lower for the intra-item split).
 */

import type { BBox, Glyph, Point, Quad, TextDirection, TextTypography, FontFamily } from './types.js';
import type { PageGeometry } from './geometry.js';
import { bboxFromQuad, directionOfRotation, matrixRotation, normalizeAngle } from './geometry.js';
import { createIdFactory, quantize, textSeed } from './ids.js';

export interface RawTextStyle {
  fontFamily?: string;
  fontWeight?: string | number;
  fontStyle?: string;
  ascent?: number;
  descent?: number;
  vertical?: boolean;
}

export interface RawTextItem {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
  fontName?: string;
  dir?: string;
  hasEOL?: boolean;
}

export interface RawTextContent {
  items: readonly RawTextItem[];
  styles?: Record<string, RawTextStyle | undefined>;
}

export interface GlyphExtractionOptions {
  pageIndex: number;
  geometry: PageGeometry;
  /** Override for tests / custom extractors; defaults to `geometry.pdfToView`. */
  mapPoint?: (point: Point) => Point;
  /** Smallest confidence assigned to an intra-item glyph. */
  glyphConfidence?: number;
}

export interface ExtractedGlyphs {
  glyphs: Glyph[];
  skippedItems: number;
  warnings: string[];
}

/** Relative advance weights for a standard Latin font, in em. */
const NARROW = /[ilI.,:;|'`!\[\](){}]/;
const WIDE = /[mwMW@#%&]/;
const UPPERCASE = /[A-Z]/;
const DIGIT = /[0-9]/;
const CJK = /[\u2e80-\u9fff\uf900-\ufaff\uac00-\ud7af]/u;
const COMBINING = /^\p{M}$/u;

export function charAdvanceWeight(char: string): number {
  if (char === ' ' || char === '\u00a0') return 0.28;
  if (char === '\t') return 0.56;
  if (COMBINING.test(char)) return 0;
  if (CJK.test(char)) return 1;
  if (NARROW.test(char)) return 0.29;
  if (WIDE.test(char)) return 0.88;
  if (DIGIT.test(char)) return 0.56;
  if (UPPERCASE.test(char)) return 0.67;
  return 0.54;
}

export function normalizeFontFamily(name?: string): { family: FontFamily; label: string } {
  const label = (name ?? '').trim();
  const lower = label.toLowerCase();
  // `sans-serif` contains `serif`, so the sans branch has to run before the
  // serif branch or every generic sans-serif face is misclassified as a
  // Times-like serif. Monospace wins over both (`DejaVu Sans Mono`).
  if (lower.includes('courier') || lower.includes('mono') || lower.includes('consol')) {
    return { family: 'courier', label: label || 'Courier' };
  }
  if (
    lower.includes('sans') ||
    lower.includes('helvetica') ||
    lower.includes('arial') ||
    lower.includes('grotesk')
  ) {
    return { family: 'helvetica', label: label || 'Helvetica' };
  }
  if (lower.includes('times') || lower.includes('serif') || lower.includes('roman') || lower.includes('georgia')) {
    return { family: 'times', label: label || 'Times' };
  }
  return { family: 'other', label: label || 'Unknown' };
}

export function typographyFromStyle(
  style: RawTextStyle | undefined,
  fontName: string | undefined,
  fontSize: number,
  rotationDeg: number,
  itemDirection: string | undefined,
): TextTypography {
  const familySource = style?.fontFamily ?? fontName;
  const { family, label } = normalizeFontFamily(familySource);
  const weightText = `${style?.fontWeight ?? ''} ${style?.fontFamily ?? ''} ${fontName ?? ''}`;
  const numericWeight = Number(style?.fontWeight);
  const bold = /bold|black|heavy|semibold|demi/i.test(weightText) || (Number.isFinite(numericWeight) && numericWeight >= 600);
  const italic = /italic|oblique/i.test(`${style?.fontStyle ?? ''} ${style?.fontFamily ?? ''} ${fontName ?? ''}`);
  const direction: TextDirection =
    itemDirection === 'ttb' ? 'ttb' : directionOfRotation(rotationDeg);
  return {
    fontName: fontName ?? '',
    fontFamily: family,
    fontFamilyLabel: label,
    fontSize,
    fontWeight: bold ? 700 : 400,
    bold,
    italic,
    direction,
    rotationDeg: normalizeAngle(rotationDeg),
  };
}

function dominantTypography(a: TextTypography, b: TextTypography): TextTypography {
  return a.fontSize >= b.fontSize ? a : b;
}

/**
 * Converts one page's text content into glyphs. Items without a usable matrix
 * or with non-finite values are skipped and reported, never guessed.
 */
export function glyphsFromTextItems(
  content: RawTextContent,
  options: GlyphExtractionOptions,
): ExtractedGlyphs {
  const { pageIndex, geometry } = options;
  const mapPoint = options.mapPoint ?? ((point: Point) => geometry.pdfToView(point));
  const glyphConfidence = options.glyphConfidence ?? 0.85;
  const id = createIdFactory(pageIndex);
  const glyphs: Glyph[] = [];
  const warnings: string[] = [];
  let skippedItems = 0;
  let contentIndex = 0;

  content.items.forEach((item, itemIndex) => {
    if (typeof item.str !== 'string' || item.str.length === 0) return;
    if (!Array.isArray(item.transform) || item.transform.length < 6) {
      skippedItems += 1;
      return;
    }
    const [a, b, c, d, e, f] = item.transform as [number, number, number, number, number, number];
    if (![a, b, c, d, e, f].every(Number.isFinite)) {
      skippedItems += 1;
      return;
    }
    const xLength = Math.hypot(a, b);
    const upLength = Math.hypot(c, d);
    if (xLength <= 0 || upLength <= 0) {
      skippedItems += 1;
      return;
    }

    const dirX = a / xLength;
    const dirY = b / xLength;
    const upX = c / upLength;
    const upY = d / upLength;
    const fontSize = upLength;
    const width = Number.isFinite(item.width) ? Math.max(0, item.width ?? 0) : 0;
    const style = item.fontName ? content.styles?.[item.fontName] : undefined;
    const rotationDeg = matrixRotation([a, b, c, d, e, f]);
    const typography = typographyFromStyle(style, item.fontName, fontSize, rotationDeg, item.dir);

    const chars = Array.from(item.str);
    const weights = chars.map(charAdvanceWeight);
    const weightSum = weights.reduce((sum, value) => sum + value, 0);
    // An item with no measurable width still needs a plausible advance for
    // caret placement; fall back to the standard-font estimate.
    const scale = width > 0 && weightSum > 0 ? width / weightSum : fontSize;

    // Ascent/descent are model boxes, not typographic metrics: they only need
    // to contain the ink and give the overlay a consistent line height.
    const ascent = fontSize * 0.82;
    const descent = fontSize * 0.18;
    let offset = 0;

    chars.forEach((char, charIndex) => {
      const advance = (weights[charIndex] ?? 0) * scale;
      const startPdf: Point = { x: e + dirX * offset, y: f + dirY * offset };
      const endPdf: Point = { x: e + dirX * (offset + advance), y: f + dirY * (offset + advance) };
      const topEndPdf: Point = { x: endPdf.x + upX * ascent, y: endPdf.y + upY * ascent };
      const topStartPdf: Point = { x: startPdf.x + upX * ascent, y: startPdf.y + upY * ascent };
      const bottomStartPdf: Point = { x: startPdf.x - upX * descent, y: startPdf.y - upY * descent };
      const bottomEndPdf: Point = { x: endPdf.x - upX * descent, y: endPdf.y - upY * descent };

      const start = mapPoint(startPdf);
      const end = mapPoint(endPdf);
      const topEnd = mapPoint(topEndPdf);
      const topStart = mapPoint(topStartPdf);
      const bottomStart = mapPoint(bottomStartPdf);
      const bottomEnd = mapPoint(bottomEndPdf);

      const quad: Quad = { p0: start, p1: end, p2: topEnd, p3: topStart };
      const pdfQuad: Quad = {
        p0: startPdf,
        p1: endPdf,
        p2: topEndPdf,
        p3: topStartPdf,
      };
      const bbox: BBox = bboxFromQuad({
        p0: bottomStart,
        p1: bottomEnd,
        p2: topEnd,
        p3: topStart,
      });
      const pdfBox: BBox = bboxFromQuad({
        p0: bottomStartPdf,
        p1: bottomEndPdf,
        p2: topEndPdf,
        p3: topStartPdf,
      });
      const glyphRotation = normalizeAngle(
        (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI,
      );
      const unicodeLength = Array.from(char).length;
      const whitespace = /^\s$/u.test(char);
      const seed = `${textSeed(char, bbox)}|${quantize(start.x)},${quantize(start.y)}|${itemIndex}:${charIndex}`;
      glyphs.push({
        id: id('glyph', seed),
        pageIndex,
        text: char,
        length: unicodeLength,
        index: contentIndex,
        itemIndex,
        itemGlyphIndex: charIndex,
        bbox,
        pdfBox,
        quad,
        pdfQuad,
        baselineStart: start,
        baselineEnd: end,
        rotationDeg: glyphRotation,
        direction: typography.direction,
        typography: dominantTypography(typography, typography),
        whitespace,
        confidence: glyphConfidence,
      });
      contentIndex += 1;
      offset += advance;
    });
  });

  if (skippedItems > 0) {
    warnings.push(`${skippedItems} text item(s) had no usable matrix and were skipped`);
  }
  return { glyphs, skippedItems, warnings };
}
