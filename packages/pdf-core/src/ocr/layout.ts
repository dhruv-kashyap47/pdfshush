/**
 * OCR layout: image pixels -> a PDF text layer.
 *
 * Two problems have to be solved here, and both are pure so they can be tested
 * without a browser or a recognizer:
 *
 *  1. **Encoding.** Tesseract returns whatever glyphs it saw. pdf-lib's
 *     built-in fonts speak WinAnsi, so a single unsupported code point makes
 *     `drawText` throw and fails the whole page. `sanitizeOcrText` maps the
 *     punctuation OCR commonly produces and drops characters the text layer
 *     cannot represent. Dropping is honest: an English-first recognizer would
 *     not have read those characters anyway.
 *
 *  2. **Extraction.** pdf.js rebuilds lines from text-item positions, and
 *     `clusterTextRuns` joins two items with no space when their gap is under
 *     15% of the font size. A word placed exactly inside its OCR box can
 *     therefore concatenate with its neighbour ("INVOICE2026"). Placements
 *     reserve a real gap and the draw step keeps every word inside its target
 *     width, so copy-and-paste reproduces the spaces.
 */

import type { OcrBox, OcrLine, OcrPage } from './types.js';

/** Characters OCR often emits that WinAnsi cannot encode or that read better as ASCII. */
const REPLACEMENTS: Readonly<Record<string, string>> = {
  '\u2018': "'",
  '\u2019': "'",
  '\u201a': "'",
  '\u201b': "'",
  '\u201c': '"',
  '\u201d': '"',
  '\u201e': '"',
  '\u201f': '"',
  '\u2013': '-',
  '\u2014': '-',
  '\u2015': '-',
  '\u2212': '-',
  '\u2026': '...',
  '\u2022': '-',
  '\u2044': '/',
  '\u00a0': ' ',
  '\u00ad': '',
  '\u200b': '',
  '\u200c': '',
  '\u200d': '',
  '\ufeff': '',
  '\ufb00': 'ff',
  '\ufb01': 'fi',
  '\ufb02': 'fl',
  '\ufb03': 'ffi',
  '\ufb04': 'ffl',
  '\ufb05': 'st',
  '\ufb06': 'st',
};

/**
 * Reduces recognized text to characters `StandardFonts.Helvetica` can encode.
 *
 * The accepted range is deliberately narrow: printable ASCII plus Latin-1
 * (minus the soft hyphen). WinAnsi adds a handful of typographic code points
 * above U+00FF; the ones OCR is likely to emit are mapped above, and the rest
 * are omitted rather than guessed at. Collapsing whitespace keeps one text
 * item per word, which is what the placement code expects.
 */
export function sanitizeOcrText(value: string): string {
  if (typeof value !== 'string' || value.length === 0) return '';
  let out = '';
  for (const char of value.normalize('NFC')) {
    const replacement = REPLACEMENTS[char];
    if (replacement !== undefined) {
      out += replacement;
      continue;
    }
    const code = char.codePointAt(0) ?? 0;
    if (char === '\t' || char === '\n' || char === '\r' || char === '\f' || char === '\v') {
      out += ' ';
      continue;
    }
    if (code >= 0x20 && code <= 0x7e) {
      out += char;
      continue;
    }
    if (code >= 0xa0 && code <= 0xff && code !== 0xad) {
      out += char;
    }
  }
  return out.replace(/\s+/g, ' ').trim();
}

export interface OcrPageMapping {
  /** Pixel dimensions of the raster the recognizer saw. */
  imageWidthPx: number;
  imageHeightPx: number;
  /** PDF point dimensions of the page that raster fills. */
  pageWidthPt: number;
  pageHeightPt: number;
}

/** One invisible text run, positioned in PDF points with a bottom-left origin. */
export interface OcrPlacement {
  text: string;
  /** Left edge. */
  x: number;
  /** Baseline, measured from the page bottom. */
  y: number;
  /** Width the run should occupy; the draw step stays inside it. */
  width: number;
  /** Shared by every word on a line, so baselines do not drift. */
  fontSize: number;
}

interface PointBox {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

function validMapping(mapping: OcrPageMapping): boolean {
  return (
    Number.isFinite(mapping.imageWidthPx) &&
    Number.isFinite(mapping.imageHeightPx) &&
    Number.isFinite(mapping.pageWidthPt) &&
    Number.isFinite(mapping.pageHeightPt) &&
    mapping.imageWidthPx > 0 &&
    mapping.imageHeightPx > 0 &&
    mapping.pageWidthPt > 0 &&
    mapping.pageHeightPt > 0
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Maps an image box (top-left origin) to PDF points (bottom-left origin). */
function toPointBox(box: OcrBox, mapping: OcrPageMapping): PointBox {
  const sx = mapping.pageWidthPt / mapping.imageWidthPx;
  const sy = mapping.pageHeightPt / mapping.imageHeightPx;
  const x0 = Math.min(box.x0, box.x1);
  const x1 = Math.max(box.x0, box.x1);
  const y0 = Math.min(box.y0, box.y1);
  const y1 = Math.max(box.y0, box.y1);
  return {
    left: clamp(x0 * sx, 0, mapping.pageWidthPt),
    right: clamp(x1 * sx, 0, mapping.pageWidthPt),
    bottom: clamp(mapping.pageHeightPt - y1 * sy, 0, mapping.pageHeightPt),
    top: clamp(mapping.pageHeightPt - y0 * sy, 0, mapping.pageHeightPt),
  };
}

/**
 * Converts recognized lines into positioned invisible runs.
 *
 * Reading order is preserved from the recognizer. Within a line, words are
 * ordered by their left edge and each one starts at least 0.2 em after the
 * previous box ends. That gap is larger than the 15% used by the text-run
 * merger, so extraction inserts a space even when OCR boxes touch.
 */
export function buildOcrPlacements(
  page: OcrPage,
  mapping: OcrPageMapping,
): OcrPlacement[] {
  if (!validMapping(mapping)) return [];

  const placements: OcrPlacement[] = [];
  const sy = mapping.pageHeightPt / mapping.imageHeightPx;

  for (const line of page.lines) {
    const words = [...line.words]
      .filter((word) => sanitizeOcrText(word.text).length > 0)
      .sort((a, b) => a.box.x0 - b.box.x0 || a.box.y0 - b.box.y0);
    if (words.length === 0) continue;

    const lineBox = toPointBox(line.box, mapping);
    const wordHeights = words
      .map((word) => {
        const box = toPointBox(word.box, mapping);
        return box.top - box.bottom;
      })
      .filter((height) => height > 0);
    const heightPt = Math.max(lineBox.top - lineBox.bottom, ...wordHeights, 0);
    if (!(heightPt > 0)) continue;

    // x-height plus ascender/descender is roughly 0.78 em for a normal face.
    // The text is invisible, so exact optical sizing matters less than keeping
    // every word on the line at one size.
    const fontSize = clamp(heightPt * 0.78, 3, 96);
    const baselineImageY =
      line.baseline !== undefined
        ? (line.baseline.y0 + line.baseline.y1) / 2
        : imageBaselineFromBox(line);
    const y = clamp(mapping.pageHeightPt - baselineImageY * sy, 0, mapping.pageHeightPt);

    let nextMinX = 0;
    for (const word of words) {
      const text = sanitizeOcrText(word.text);
      if (text.length === 0) continue;
      const box = toPointBox(word.box, mapping);
      const x = clamp(Math.max(box.left, nextMinX), 0, mapping.pageWidthPt - 0.5);
      const right = Math.max(x + 0.5, box.right);
      const width = Math.max(0.5, right - x);
      placements.push({ text, x, y, width, fontSize });
      nextMinX = Math.min(mapping.pageWidthPt, x + width + fontSize * 0.2);
    }
  }

  return placements;
}

/** Fallback baseline: 20% of the line height above the box bottom. */
function imageBaselineFromBox(line: OcrLine): number {
  const height = Math.max(0, line.box.y1 - line.box.y0);
  return line.box.y1 - height * 0.2;
}
