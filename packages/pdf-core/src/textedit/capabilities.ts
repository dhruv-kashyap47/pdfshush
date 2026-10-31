/**
 * Capability inspection for text editing.
 *
 * "Can this paragraph be edited?" must be answered before the user types, not
 * discovered after a save. This module asks PDFium what the page actually
 * contains (text objects, render modes, fonts, images) and combines that with
 * the document-derived charcode maps to classify each edit:
 *
 *   native-object          reuse the document's own text object/font
 *   content-stream         rewrite the show operator when the native path is
 *                          unavailable but the encoding is understood
 *   localized-reconstruction  cover/redraw the paragraph with a declared
 *                          substitute font (never silently)
 *   manual-review          fidelity cannot be guaranteed
 *
 * It is intentionally read-only: no page is generated or serialised.
 */

import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import type { FontCharcodesByPage } from './charcodes.js';
import { missingGlyphs, substituteStandardFont, fontLikeFromPdfium, type FontFidelity } from './fonts.js';
import { PdfiumTextDocument, type PdfiumFontInfo } from './pdfium.js';
import type {
  DocumentTextCapability,
  EditCapability,
  PageTextCapability,
  TextEdit,
  TextFontDescriptor,
  TextLayerKind,
  TextObjectInfo,
} from './types.js';

export interface CapabilityInspectionOptions {
  /** Instantiates PDFium; injected so Node tests use the real WASM bytes. */
  module: WrappedPdfiumModule;
  pageIndexes?: number[];
  password?: string;
}

function descriptor(info: PdfiumFontInfo | null): TextFontDescriptor | null {
  if (!info) return null;
  return {
    baseName: info.baseName,
    familyName: info.familyName,
    embedded: info.embedded,
    weight: info.weight,
    italicAngle: info.italicAngle,
    flags: info.flags,
    ascent: info.ascent,
    descent: info.descent,
    monospace: info.monospace,
    serif: info.serif,
  };
}

function editFidelity(fidelity: FontFidelity): EditCapability['fidelity'] {
  if (fidelity === 'exact') return 'exact';
  if (fidelity === 'metric-compatible') return 'high';
  if (fidelity === 'substitute') return 'approximate';
  return 'none';
}

function uniqueFonts(objects: TextObjectInfo[]): TextFontDescriptor[] {
  const seen = new Map<string, TextFontDescriptor>();
  for (const object of objects) {
    if (!object.font) continue;
    const key = `${object.font.baseName}|${object.font.weight}|${object.font.italicAngle}`;
    if (!seen.has(key)) seen.set(key, object.font);
  }
  return [...seen.values()];
}

function layerKind(objects: TextObjectInfo[]): TextLayerKind {
  if (objects.length === 0) return 'none';
  const invisible = objects.filter((object) => object.renderMode === 3).length;
  if (invisible === objects.length) return 'ocr';
  if (invisible > 0) return 'mixed';
  return 'native';
}

/** Inspect the real PDFium object graph for the requested pages. */
export function inspectDocumentCapabilities(
  data: Uint8Array,
  options: CapabilityInspectionOptions,
): DocumentTextCapability {
  const doc = PdfiumTextDocument.open(options.module, data, options.password ?? '');
  const warnings: string[] = [];
  try {
    const pageCount = doc.pageCount();
    const pages =
      options.pageIndexes && options.pageIndexes.length > 0
        ? options.pageIndexes
        : Array.from({ length: pageCount }, (_, index) => index);
    const output: PageTextCapability[] = [];
    for (const pageIndex of pages) {
      if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pageCount) {
        warnings.push(`capability inspection skipped page ${pageIndex + 1}: out of range`);
        continue;
      }
      const geom = doc.geom(pageIndex);
      const counts = doc.objectCounts(pageIndex);
      const objects: TextObjectInfo[] = doc.listTextObjects(pageIndex).map((object) => {
        const rect = doc.objectDisplayRect(pageIndex, object.bounds);
        return {
          text: object.text,
          box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          fontSize: object.fontSize,
          renderMode: object.renderMode,
          font: descriptor(object.font),
        };
      });
      const layer = layerKind(objects);
      output.push({
        pageIndex,
        widthPt: geom.x1 - geom.x0,
        heightPt: geom.y1 - geom.y0,
        rotation: geom.rot,
        objectCounts: counts,
        textObjects: objects,
        fonts: uniqueFonts(objects),
        textLayer: layer,
        likelyScanned: counts.image > 0 && layer === 'none',
      });
    }
    if (output.some((page) => page.likelyScanned)) {
      warnings.push(
        'image-only page(s) detected: no text layer exists, so native and content-stream text editing are unavailable; use OCR or localized reconstruction',
      );
    }
    if (output.some((page) => page.textLayer === 'ocr' || page.textLayer === 'mixed')) {
      warnings.push('invisible OCR text layer detected; edits preserve its render mode');
    }
    return { pages: output, pdfium: true, warnings };
  } finally {
    doc.close();
  }
}

function normalized(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function pageFontMap(
  fonts: FontCharcodesByPage | undefined,
  pageIndex: number,
  font: TextFontDescriptor | null,
): ReadonlyMap<number, number> | null {
  if (!fonts || !font) return null;
  return fonts.get(pageIndex)?.get(font.baseName.replace(/^[A-Z]{6}\+/, '')) ?? null;
}

/**
 * Classifies one edit against a page capability snapshot. This is used by the
 * engine's strategy ladder and can also be returned to the frontend before a
 * save so the UI can show native/content-stream/review status.
 */
export function analyzeEditCapability(
  edit: TextEdit,
  page: PageTextCapability,
  fonts?: FontCharcodesByPage,
): EditCapability {
  const reasons: string[] = [];
  const target = normalized(edit.find);
  const matches = page.textObjects.filter(
    (object) => normalized(object.text) === target || object.text.replace(/\s+/gu, '') === edit.find.replace(/\s+/gu, ''),
  );
  const font = matches[0]?.font ?? page.fonts[0] ?? null;
  const map = pageFontMap(fonts, edit.pageIndex, font);
  const mapKnown = map !== null;
  const missing = mapKnown && edit.replace.length > 0 ? missingGlyphs(map, edit.replace) : [];
  const substitute = font ? substituteStandardFont(fontLikeFromPdfium({
    baseName: font.baseName,
    familyName: font.familyName,
    weight: font.weight,
    italicAngle: font.italicAngle,
    flags: font.flags,
    monospace: font.monospace,
    serif: font.serif,
    embedded: font.embedded,
  })) : null;

  const fontFidelity = font
    ? font.embedded
      ? 'exact'
      : /^(helvetica|times|courier)/i.test(font.baseName)
        ? 'exact'
        : 'high'
    : 'none';

  if (page.likelyScanned) {
    reasons.push('page is image-only: there is no text object to rewrite');
    return {
      strategy: edit.fallback?.length ? 'localized-reconstruction' : 'manual-review',
      fidelity: edit.fallback?.length ? 'approximate' : 'none',
      missingGlyphs: [],
      reasons,
      font: { descriptor: font, substitute: substitute?.family ?? null, fidelity: substitute ? editFidelity(substitute.fidelity) : 'none' },
    };
  }

  if (matches.length > 0 && edit.strategy !== 'content-stream') {
    if (missing.length === 0) {
      reasons.push(
        `${matches.length} matching text object(s); replacement reuses the document font`,
      );
      if (!mapKnown) {
        reasons.push('font encoding map unavailable; the native write is verified after export');
      }
      if (matches.some((object) => object.renderMode === 3)) {
        reasons.push('invisible OCR text: render mode is preserved');
      }
      if (edit.layout) reasons.push('multi-line reflow uses the original font metrics');
      return {
        strategy: 'native-object',
        fidelity: fontFidelity === 'exact' ? 'exact' : 'high',
        missingGlyphs: [],
        reasons,
        font: { descriptor: font, substitute: substitute?.family ?? null, fidelity: fontFidelity === 'exact' ? 'exact' : 'high' },
      };
    }
    reasons.push(`replacement uses glyph(s) the original font does not encode: ${missing.join(' ')}`);
  } else if (matches.length === 0) {
    reasons.push('no exact text-object match; native rewrite cannot be anchored');
  }

  const contentStreamEligible =
    edit.layout === undefined &&
    page.textObjects.length > 0 &&
    map !== null &&
    edit.replace.length > 0 &&
    missing.length === 0;
  if (contentStreamEligible) {
    reasons.push('encoding is fully understood; content-stream replacement is available');
    return {
      strategy: 'content-stream',
      fidelity: 'high',
      missingGlyphs: [],
      reasons,
      font: { descriptor: font, substitute: substitute?.family ?? null, fidelity: 'high' },
    };
  }

  if (edit.fallback?.length) {
    reasons.push(
      substitute
        ? `fallback overlay will use ${substitute.family} (${substitute.fidelity})`
        : 'fallback overlay requested',
    );
    return {
      strategy: 'localized-reconstruction',
      fidelity: substitute?.fidelity === 'metric-compatible' ? 'approximate' : 'approximate',
      missingGlyphs: missing,
      reasons,
      font: {
        descriptor: font,
        substitute: substitute?.family ?? null,
        fidelity: substitute ? editFidelity(substitute.fidelity) : 'none',
      },
    };
  }

  reasons.push('fidelity cannot be guaranteed and no reviewed fallback was supplied');
  return {
    strategy: 'manual-review',
    fidelity: 'none',
    missingGlyphs: missing,
    reasons,
    font: {
      descriptor: font,
      substitute: substitute?.family ?? null,
      fidelity: substitute ? editFidelity(substitute.fidelity) : 'none',
    },
  };
}
