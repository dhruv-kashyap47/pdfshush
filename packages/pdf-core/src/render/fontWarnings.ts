/**
 * Detect non-embedded CJK fonts before rendering (PDF-RENDER-003).
 *
 * A dedicated worker has no `FontFaceSet`, and pdf.js is deliberately run with
 * `disableFontFace`/`useSystemFonts: false` for deterministic output. A Type0
 * font with no `/FontFile` therefore has no glyph program and paints `.notdef`
 * boxes even though extraction works. Session 6 decided not to bundle a CJK
 * fallback (size and licensing); the glyph repro stays `it.fails` and the
 * render jobs report the loss here instead of staying silent.
 */

import { PDFArray, PDFDict, PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { loadPdfDocument } from '../ops/pages.js';

function lookupDict(doc: PDFDocument, value: unknown): PDFDict | undefined {
  const looked = doc.context.lookup(value as never) as unknown;
  return looked instanceof PDFDict ? looked : undefined;
}

function isEmbedded(doc: PDFDocument, font: PDFDict): boolean {
  for (const key of ['FontFile', 'FontFile2', 'FontFile3']) {
    if (font.get(PDFName.of(key)) !== undefined) return true;
  }
  const descendants = doc.context.lookup(font.get(PDFName.of('DescendantFonts')));
  if (descendants instanceof PDFArray) {
    for (const entry of descendants.asArray()) {
      const descendant = lookupDict(doc, entry);
      if (!descendant) continue;
      for (const key of ['FontFile', 'FontFile2', 'FontFile3']) {
        if (descendant.get(PDFName.of(key)) !== undefined) return true;
      }
    }
  }
  return false;
}

function fontName(font: PDFDict): string | undefined {
  const base = font.get(PDFName.of('BaseFont'));
  const decoded = (base as { decodeText?: () => string } | undefined)?.decodeText?.();
  if (!decoded) return undefined;
  // A document-controlled name goes into a warning; keep it printable and short.
  // eslint-disable-next-line no-control-regex
  const clean = decoded.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 120);
  return clean.length > 0 ? clean : undefined;
}

function isCidFont(doc: PDFDocument, font: PDFDict): boolean {
  const subtype = font.get(PDFName.of('Subtype'))?.toString();
  if (subtype === '/Type0') return true;
  const descendants = doc.context.lookup(font.get(PDFName.of('DescendantFonts')));
  if (!(descendants instanceof PDFArray) || descendants.size() === 0) return false;
  const descendant = lookupDict(doc, descendants.get(0));
  const descendantSubtype = descendant?.get(PDFName.of('Subtype'))?.toString();
  return descendantSubtype === '/CIDFontType0' || descendantSubtype === '/CIDFontType2';
}

function warningsForDocument(doc: PDFDocument): string[] {
  const missing = new Set<string>();
  const seen = new Set<PDFDict>();
  const inspectFont = (font: PDFDict): void => {
    if (seen.has(font)) return;
    seen.add(font);
    if (!isCidFont(doc, font) || isEmbedded(doc, font)) return;
    missing.add(fontName(font) ?? 'an unnamed CID font');
  };

  for (const page of doc.getPages()) {
    const resources = page.node.getInheritableAttribute(PDFName.of('Resources'));
    const resourceDict = lookupDict(doc, resources);
    if (!resourceDict) continue;
    const fonts = doc.context.lookup(resourceDict.get(PDFName.of('Font')));
    if (!(fonts instanceof PDFDict)) continue;
    for (const value of fonts.values()) {
      const font = lookupDict(doc, value);
      if (font) inspectFont(font);
    }
  }

  return [...missing].map(
    (name) =>
      `Non-embedded CJK font "${name}" has no glyph program; rendered pages may show empty boxes. Install the font in your viewer or convert the text to outlines before rendering.`,
  );
}

/**
 * Warnings for every Type0/CID font the document references but does not embed.
 * Malformed or unreadable documents return no warnings rather than failing the
 * render that is about to produce the actual output.
 */
export async function nonEmbeddedFontWarnings(
  data: Uint8Array,
  password?: string,
): Promise<string[]> {
  try {
    const doc = await loadPdfDocument(data, { ...(password ? { password } : {}) });
    return warningsForDocument(doc);
  } catch {
    return [];
  }
}
