/**
 * Combine files: one PDF out of a mixed, user-ordered list.
 *
 * A PDF contributes all of its pages; a JPEG or PNG contributes one page laid
 * out by the same `planImagePlacement` maths JPG-to-PDF uses (so the preview the
 * user already trusts stays truthful). Everything else is refused by name --
 * Office files are a conversion job, not a merge, and silently ignoring them
 * would hand back a document missing pages the user selected.
 *
 * Order is the input order. This op exists instead of "run jpg-to-pdf, then
 * merge" so a combined file is built once, with no intermediate documents and
 * no second generation of image bytes.
 */

import { PDFDocument } from '@cantoo/pdf-lib';
import { createProgressReporter, type JobContext } from '../job.js';
import { LIMITS } from '../limits.js';
import {
  detectImageKind,
  planImagePlacement,
  type ImagesToPdfOptions,
} from './imageDocs.js';
import { loadPdfDocument } from './pages.js';

export interface CombineSource {
  name: string;
  data: Uint8Array;
  password?: string;
}

export type CombineOptions = ImagesToPdfOptions;

export interface CombinePart {
  name: string;
  kind: 'pdf' | 'image';
  pageCount: number;
}

export interface CombineResult {
  data: Uint8Array;
  pageCount: number;
  parts: CombinePart[];
}

/** `%PDF-` -- the only reliable discriminator; extensions lie. */
export function isPdfBytes(data: Uint8Array): boolean {
  return (
    data.length >= 5 &&
    data[0] === 0x25 &&
    data[1] === 0x50 &&
    data[2] === 0x44 &&
    data[3] === 0x46 &&
    data[4] === 0x2d
  );
}

export async function combineToPdf(
  sources: CombineSource[],
  options: CombineOptions,
  ctx: JobContext,
): Promise<CombineResult> {
  if (sources.length === 0) throw new Error('Add at least one file');

  const progress = createProgressReporter(ctx);
  const out = await PDFDocument.create();
  const parts: CombinePart[] = [];
  let pageCount = 0;

  for (let index = 0; index < sources.length; index += 1) {
    ctx.throwIfAborted();
    const source = sources[index]!;
    progress.report(
      'Assembling the document',
      index / Math.max(1, sources.length),
      `Adding ${index + 1} of ${sources.length}`,
    );

    if (isPdfBytes(source.data)) {
      const doc = await loadPdfDocument(source.data, {
        ...(source.password !== undefined ? { password: source.password } : {}),
      });
      const indexes = doc.getPageIndices();
      if (pageCount + indexes.length > LIMITS.client.maxPages) {
        throw new Error(
          `That would produce ${pageCount + indexes.length} pages; the limit is ${LIMITS.client.maxPages}`,
        );
      }
      const copied = indexes.length > 0 ? await out.copyPages(doc, indexes) : [];
      for (const page of copied) out.addPage(page);
      pageCount += copied.length;
      parts.push({ name: source.name, kind: 'pdf', pageCount: copied.length });
      continue;
    }

    const kind = detectImageKind(source.data);
    if (!kind) {
      throw new Error(
        `"${source.name}" is neither a PDF nor a JPEG/PNG image. ` +
          'Convert Office or other formats to PDF first.',
      );
    }
    if (pageCount + 1 > LIMITS.client.maxPages) {
      throw new Error(`That would produce more than ${LIMITS.client.maxPages} pages`);
    }

    let embedded;
    try {
      embedded = kind === 'jpeg' ? await out.embedJpg(source.data) : await out.embedPng(source.data);
    } catch {
      throw new Error(
        `"${source.name}" has image headers but could not be decoded as ${kind === 'jpeg' ? 'JPEG' : 'PNG'}`,
      );
    }

    const placement = planImagePlacement(embedded.width, embedded.height, options);
    const page = out.addPage([placement.pageWidthPt, placement.pageHeightPt]);
    page.drawImage(embedded, {
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
    });
    pageCount += 1;
    parts.push({ name: source.name, kind: 'image', pageCount: 1 });
  }

  if (pageCount === 0) throw new Error('No pages were produced from those files');

  progress.report('Writing the combined PDF', 0.97);
  const data = await out.save({ useObjectStreams: false });
  progress.report('Done', 1);
  return { data, pageCount, parts };
}
