/**
 * Page-level geometric transforms -- Flip PDF and Resize PDF.
 *
 * Both transforms rebuild every page as an embedded copy redrawn under a
 * transformation matrix: the source content stays fully vector (text stays
 * selectable, images keep their resolution), and the matrix does the work.
 * Verified against the emitted operators: a horizontal flip produces
 * `q 1 0 0 1 <w> 0 cm -1 0 0 1 0 0 cm /Form Do Q` -- an exact mirror inside
 * the page box.
 *
 * Embedding detail discovered in prototyping: `embedPage` throws
 * "Can't embed page with missing Contents" on a page with no content stream
 * at all. A blank page is geometrically identical under any mirror or
 * resize, so those pages are rebuilt as genuinely blank replacements and
 * never touch the embedder.
 */

import {
  degrees,
  drawPage as drawPageOperators,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRef,
  PDFStream,
  rgb,
  StandardFonts,
  type PDFFont,
  type PDFPage,
} from '@cantoo/pdf-lib';
import { createProgressReporter, type JobContext } from '../job.js';

interface PageBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A page has no own content until /Contents exists (pdf-lib fills it lazily on draw). */
function hasDirectContents(page: PDFPage): boolean {
  return page.node.Contents() !== undefined;
}

/**
 * The box the viewer displays: CropBox with a MediaBox fallback. Content is
 * embedded relative to this box's origin, exactly like split-in-half maths.
 */
function embeddedBox(page: PDFPage): PageBox {
  const crop = page.getCropBox();
  const media = page.getSize();
  return {
    x: crop.x,
    y: crop.y,
    width: crop.width || media.width,
    height: crop.height || media.height,
  };
}

function normalisedRotation(page: PDFPage): number {
  return ((page.getRotation().angle % 360) + 360) % 360;
}

/* ----------------------------------------------------- annotation flattening */

interface FlattenState {
  font?: Promise<PDFFont>;
  flattened: number;
  skipped: number;
  widgets: number;
}

function lookupDict(doc: PDFDocument, value: unknown): PDFDict | undefined {
  const looked = doc.context.lookup(value as never) as unknown;
  return looked instanceof PDFDict ? looked : undefined;
}

function readNumbers(doc: PDFDocument, value: unknown): number[] | undefined {
  const looked = doc.context.lookup(value as never);
  if (!(looked instanceof PDFArray)) return undefined;
  const numbers = looked.asArray().map((entry) => {
    const n = (entry as { asNumber?: () => number }).asNumber?.();
    return typeof n === 'number' && Number.isFinite(n) ? n : Number.NaN;
  });
  return numbers.some((n) => !Number.isFinite(n)) ? undefined : numbers;
}

function readRect(doc: PDFDocument, dict: PDFDict): { x: number; y: number; width: number; height: number } | undefined {
  const numbers = readNumbers(doc, dict.get(PDFName.of('Rect')));
  if (!numbers || numbers.length < 4) return undefined;
  const x0 = Math.min(numbers[0]!, numbers[2]!);
  const y0 = Math.min(numbers[1]!, numbers[3]!);
  return {
    x: x0,
    y: y0,
    width: Math.abs(numbers[2]! - numbers[0]!),
    height: Math.abs(numbers[3]! - numbers[1]!),
  };
}

function readColor(doc: PDFDocument, value: unknown): ReturnType<typeof rgb> | undefined {
  const numbers = readNumbers(doc, value);
  if (!numbers || numbers.length === 0) return undefined;
  if (numbers.length === 1) return rgb(numbers[0]!, numbers[0]!, numbers[0]!);
  if (numbers.length === 3) return rgb(numbers[0]!, numbers[1]!, numbers[2]!);
  if (numbers.length === 4) {
    // CMYK -> RGB is only a visual approximation here; the appearance is a
    // flattened copy, and a naive conversion is better than dropping the mark.
    const [c, m, y, k] = numbers as [number, number, number, number];
    return rgb((1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k));
  }
  return undefined;
}

function readBorderWidth(doc: PDFDocument, dict: PDFDict): number {
  const border = readNumbers(doc, dict.get(PDFName.of('Border')));
  if (border && border.length >= 3 && border[2]! > 0) return border[2]!;
  const bs = lookupDict(doc, dict.get(PDFName.of('BS')));
  const width = bs && (bs.get(PDFName.of('W')) as { asNumber?: () => number } | undefined);
  const value = width?.asNumber?.();
  return typeof value === 'number' && value > 0 ? value : 1;
}

/** The normal appearance stream, following `/AS` for checkbox/radio states. */
function readAppearance(
  doc: PDFDocument,
  dict: PDFDict,
): { ref: PDFRef; stream: PDFStream } | undefined {
  const ap = lookupDict(doc, dict.get(PDFName.of('AP')));
  if (!ap) return undefined;
  let value = ap.get(PDFName.of('N'));
  let looked = doc.context.lookup(value);
  if (looked instanceof PDFDict) {
    const state = dict.get(PDFName.of('AS'))?.toString();
    let chosen: unknown;
    for (const [key, entry] of looked.entries()) {
      if (state && key.toString() === state) {
        chosen = entry;
        break;
      }
      if (!chosen && key.toString() !== '/Off') chosen = entry;
    }
    value = chosen as never;
    looked = doc.context.lookup(value);
  }
  if (!(looked instanceof PDFStream)) return undefined;
  const ref = value instanceof PDFRef ? value : doc.context.register(looked);
  return { ref, stream: looked };
}

function paintAppearance(
  page: PDFPage,
  doc: PDFDocument,
  appearance: { ref: PDFRef; stream: PDFStream },
  rect: { x: number; y: number; width: number; height: number },
): void {
  const bbox = readNumbers(doc, appearance.stream.dict.get(PDFName.of('BBox')));
  const box = bbox && bbox.length >= 4
    ? {
        x: bbox[0]!,
        y: bbox[1]!,
        width: Math.abs(bbox[2]! - bbox[0]!) || rect.width,
        height: Math.abs(bbox[3]! - bbox[1]!) || rect.height,
      }
    : { x: 0, y: 0, width: rect.width, height: rect.height };
  const scaleX = rect.width / box.width;
  const scaleY = rect.height / box.height;
  const name = page.node.newXObject('FlattenedAnnotation', appearance.ref);
  page.pushOperators(
    ...drawPageOperators(name, {
      x: rect.x - box.x * scaleX,
      y: rect.y - box.y * scaleY,
      xScale: scaleX,
      yScale: scaleY,
      rotate: degrees(0),
      xSkew: degrees(0),
      ySkew: degrees(0),
    }),
  );
}

async function synthesiseAppearance(
  page: PDFPage,
  doc: PDFDocument,
  dict: PDFDict,
  subtype: string,
  rect: { x: number; y: number; width: number; height: number },
  state: FlattenState,
): Promise<boolean> {
  if (rect.width <= 0 || rect.height <= 0) return false;
  const color = readColor(doc, dict.get(PDFName.of('C'))) ?? rgb(0.2, 0.2, 0.2);

  if (subtype === '/Highlight' || subtype === '/Underline' || subtype === '/StrikeOut' || subtype === '/Squiggly') {
    page.drawRectangle({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: subtype === '/Highlight' ? rect.height : Math.max(1, rect.height * 0.12),
      color,
      opacity: subtype === '/Highlight' ? 0.35 : 0.9,
    });
    return true;
  }
  if (subtype === '/Square' || subtype === '/Circle' || subtype === '/Polygon') {
    page.drawRectangle({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      borderColor: color,
      borderWidth: readBorderWidth(doc, dict),
    });
    return true;
  }
  if (subtype === '/FreeText') {
    const contents = dict.get(PDFName.of('Contents'));
    const text = (contents as { decodeText?: () => string } | undefined)?.decodeText?.();
    if (!text) return false;
    state.font ??= doc.embedFont(StandardFonts.Helvetica);
    const font = await state.font;
    const size = Math.min(14, Math.max(8, rect.height * 0.5));
    page.drawText(text, {
      x: rect.x + 2,
      y: Math.max(rect.y, rect.y + rect.height - size - 2),
      size,
      font,
      color,
      maxWidth: Math.max(1, rect.width - 4),
      lineHeight: size * 1.15,
    });
    return true;
  }
  return false;
}

/**
 * Paints every annotation on `page` into the page's content stream. The caller
 * then embeds that content, so the mark survives the mirror/resize transform
 * without staying a live annotation (whose rectangle and quad points would
 * otherwise point at geometry that no longer exists).
 */
async function flattenPageAnnotations(
  doc: PDFDocument,
  page: PDFPage,
  state: FlattenState,
): Promise<void> {
  const annots = page.node.Annots();
  if (!annots || annots.size() === 0) return;
  for (let i = 0; i < annots.size(); i += 1) {
    const dict = lookupDict(doc, annots.get(i));
    if (!dict) continue;
    const subtype = dict.get(PDFName.of('Subtype'))?.toString() ?? '';
    if (subtype === '/Widget') state.widgets += 1;
    const rect = readRect(doc, dict);
    if (!rect) {
      state.skipped += 1;
      continue;
    }
    const appearance = readAppearance(doc, dict);
    if (appearance) {
      paintAppearance(page, doc, appearance, rect);
      state.flattened += 1;
      continue;
    }
    if (await synthesiseAppearance(page, doc, dict, subtype, rect, state)) {
      state.flattened += 1;
    } else if (subtype !== '/Link') {
      // Links have no visible appearance; anything else that could not be
      // painted is reported rather than silently dropped.
      state.skipped += 1;
    }
  }
}

/**
 * Flip and Resize rewrite geometry, so a live digital signature cannot stay
 * valid. Refusing is the honest outcome; flattening would still invalidate it.
 */
export function assertNoSignatureFields(doc: PDFDocument): void {
  const seen = new Set<PDFDict>();
  const visit = (node: unknown): void => {
    const dict = lookupDict(doc, node);
    if (!dict || seen.has(dict)) return;
    seen.add(dict);
    if (
      dict.get(PDFName.of('FT'))?.toString() === '/Sig' ||
      dict.get(PDFName.of('Subtype'))?.toString() === '/Sig'
    ) {
      throw new Error(
        'This document contains a digital signature. Flip and Resize cannot preserve a valid signature; remove it and try again.',
      );
    }
    const kids = doc.context.lookup(dict.get(PDFName.of('Kids')));
    if (kids instanceof PDFArray) for (const kid of kids.asArray()) visit(kid);
  };

  const form = lookupDict(doc, doc.catalog.get(PDFName.of('AcroForm')));
  if (form) {
    const fields = doc.context.lookup(form.get(PDFName.of('Fields')));
    if (fields instanceof PDFArray) for (const field of fields.asArray()) visit(field);
  }
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (annots) for (let i = 0; i < annots.size(); i += 1) visit(annots.get(i));
  }
}

function flattenWarnings(state: FlattenState): string[] {
  if (state.flattened === 0 && state.skipped === 0) return [];
  const warnings: string[] = [];
  if (state.flattened > 0) {
    warnings.push(
      `Flattened ${state.flattened} annotation${state.flattened === 1 ? '' : 's'} into the page content.`,
    );
  }
  if (state.widgets > 0) {
    warnings.push('Form fields were flattened: this output is no longer fillable.');
  }
  if (state.skipped > 0) {
    warnings.push(
      `${state.skipped} annotation${state.skipped === 1 ? '' : 's'} had no visible appearance and were removed.`,
    );
  }
  return warnings;
}

export type FlipAxis = 'horizontal' | 'vertical';

/**
 * Mirrors pages in place (the document must already be composed or loaded).
 * `perPage[i]` is the flip for output page i in DISPLAY space -- the axis is
 * translated into the page's unrotated frame so it behaves like the on-screen
 * flip the user performs, exactly as the rotate override does.
 *
 * Replacements are appended and originals removed after the loop, so page
 * indexes stay stable while iterating.
 */
export async function mirrorPages(
  doc: PDFDocument,
  perPage: (FlipAxis | null)[],
  ctx: JobContext,
): Promise<string[]> {
  assertNoSignatureFields(doc);
  const progress = createProgressReporter(ctx);
  const pages = doc.getPages();
  const state: FlattenState = { flattened: 0, skipped: 0, widgets: 0 };

  for (let i = 0; i < pages.length; i += 1) {
    ctx.throwIfAborted();
    const axis = perPage[i] ?? null;
    const page = pages[i]!;
    await flattenPageAnnotations(doc, page, state);
    const box = embeddedBox(page);
    const rotation = normalisedRotation(page);

    let axisFlip: FlipAxis | null = axis;
    if (axisFlip && rotation % 180 === 90) {
      // On a sideways page the display axes swap: flipping horizontally on
      // screen mirrors the unrotated content vertically (and vice versa).
      axisFlip = axisFlip === 'horizontal' ? 'vertical' : 'horizontal';
    }

    const replacement = doc.addPage([box.width, box.height]);
    if (axisFlip && hasDirectContents(page)) {
      const embedded = await doc.embedPage(page, {
        left: box.x,
        bottom: box.y,
        right: box.x + box.width,
        top: box.y + box.height,
      });
      replacement.drawPage(
        embedded,
        axisFlip === 'horizontal'
          ? { x: box.width, y: 0, xScale: -1, yScale: 1 }
          : { x: 0, y: box.height, xScale: 1, yScale: -1 },
      );
    }
    if (rotation !== 0) replacement.setRotation(degrees(rotation));
    progress.step(i, pages.length, 'Flipping pages');
  }

  for (let i = pages.length - 1; i >= 0; i -= 1) {
    doc.removePage(i);
  }
  // Widgets are page content now; a form tree pointing at removed widgets
  // would be a broken registration rather than a usable form.
  if (state.widgets > 0) doc.catalog.delete(PDFName.of('AcroForm'));
  return flattenWarnings(state);
}

export type ResizeRequest =
  | { kind: 'preset'; preset: 'a4' | 'letter' }
  | { kind: 'percent'; percent: number };

export interface ResizePlan {
  /** Output box width/height in points. */
  width: number;
  height: number;
  /** Uniform scale from source to output. */
  scale: number;
}

/** Resolve a resize request into an exact plan for one page. */
export function planResize(box: { width: number; height: number }, request: ResizeRequest): ResizePlan {
  const target =
    request.kind === 'percent'
      ? { width: (box.width * request.percent) / 100, height: (box.height * request.percent) / 100 }
      : request.preset === 'a4'
        ? { width: 595.28, height: 841.89 }
        : { width: 612, height: 792 };
  // Uniform scale keeps the aspect ratio; the result is centred. For paper
  // sizes this is "fit", so a small page scales up to the sheet.
  const scale = Math.min(target.width / box.width, target.height / box.height);
  return { width: target.width, height: target.height, scale };
}

/**
 * Rescales every page to its own plan (uniform scale, centred). Content is
 * embedded and redrawn -- vectors preserved, page boxes exact.
 */
export async function resizePages(
  doc: PDFDocument,
  plans: ResizePlan[],
  ctx: JobContext,
): Promise<string[]> {
  assertNoSignatureFields(doc);
  const progress = createProgressReporter(ctx);
  const pages = doc.getPages();
  const state: FlattenState = { flattened: 0, skipped: 0, widgets: 0 };

  for (let i = 0; i < pages.length; i += 1) {
    ctx.throwIfAborted();
    const plan = plans[i]!;
    const page = pages[i]!;
    await flattenPageAnnotations(doc, page, state);
    const box = embeddedBox(page);
    const replacement = doc.addPage([plan.width, plan.height]);
    if (hasDirectContents(page)) {
      const embedded = await doc.embedPage(page, {
        left: box.x,
        bottom: box.y,
        right: box.x + box.width,
        top: box.y + box.height,
      });
      const drawWidth = box.width * plan.scale;
      const drawHeight = box.height * plan.scale;
      replacement.drawPage(embedded, {
        x: (plan.width - drawWidth) / 2,
        y: (plan.height - drawHeight) / 2,
        width: drawWidth,
        height: drawHeight,
      });
    }
    const rotation = normalisedRotation(page);
    if (rotation !== 0) replacement.setRotation(degrees(rotation));
    progress.step(i, pages.length, 'Resizing pages');
  }

  for (let i = pages.length - 1; i >= 0; i -= 1) {
    doc.removePage(i);
  }
  if (state.widgets > 0) doc.catalog.delete(PDFName.of('AcroForm'));
  return flattenWarnings(state);
}
