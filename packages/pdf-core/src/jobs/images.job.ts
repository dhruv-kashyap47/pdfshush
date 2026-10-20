/**
 * Extract Images job.
 *
 * Runs the extraction on the loaded document and returns both the ZIP (what
 * the user downloads) and a per-file manifest with pixel sizes, so the result
 * panel can show a real grid with real numbers. The count of skipped images
 * rides along and the UI reports it honestly rather than hiding it.
 */

import { PDFDocument } from '@cantoo/pdf-lib';
import type { JobDefinition } from '../job.js';
import { EncryptedDocumentError, probePageCount } from '../ops/pages.js';
import { extractImages } from '../ops/images.js';
import { createZip, dedupeNames, stripExtension } from '../ops/zip.js';
import { baseName, toArrayBuffer, totalInputBytes } from './helpers.js';

export interface ImagesJobInput {
  files: { name: string; type?: string; data: Uint8Array; password?: string }[];
  options?: Record<string, unknown>;
}

export interface ImagesJobFile {
  name: string;
  ext: 'jpg' | 'png';
  size: number;
  width: number;
  height: number;
  alphaDropped: boolean;
  data: Uint8Array;
}

export interface ImagesJobOutput {
  zip: ArrayBuffer;
  zipName: string;
  files: ImagesJobFile[];
  extracted: number;
  skipped: number;
  pageCount: number;
}

export const imagesJob: JobDefinition<ImagesJobInput, ImagesJobOutput> = {
  slug: 'extract-images',
  label: 'Extract embedded images',

  validate(input) {
    const issues = [];
    if (input.files.length !== 1) issues.push({ message: 'Choose exactly one PDF' });
    return issues.length > 0 ? { ok: false, issues } : { ok: true };
  },

  estimate(input) {
    // Extracted images can exceed the source bytes once re-encoded.
    return { memoryBytes: Math.ceil(totalInputBytes(input) * 3) };
  },

  async run(input, ctx) {
    const file = input.files[0]!;
    const pageCount = await probePageCount(file.data, {
      ...(file.password ? { password: file.password } : {}),
    });

    let doc: PDFDocument;
    try {
      doc = await PDFDocument.load(file.data, {
        ...(file.password ? { password: file.password } : {}),
      });
    } catch (error) {
      if (error instanceof EncryptedDocumentError) {
        throw new Error('Extract images from a decrypted copy of this file');
      }
      throw error;
    }
    if (doc.isEncrypted) {
      // Property, not method (PLAN.md §7); even WITH a password the raw
      // stream bytes stay ciphered here, so refuse rather than return noise.
      throw new Error('Extract images from a decrypted copy of this file');
    }

    ctx.throwIfAborted();
    const stem = stripExtension(baseName(file.name));
    const { images, skipped } = extractImages(doc, stem);

    const files: ImagesJobFile[] = images.map((image) => ({
      name: image.name,
      ext: image.ext,
      size: image.data.length,
      width: image.width,
      height: image.height,
      alphaDropped: image.alphaDropped,
      data: image.data,
    }));

    const zip = createZip(
      dedupeNames(images.map((image) => image.name)).map((name, i) => ({
        name,
        data: images[i]!.data,
      })),
    );

    return {
      zip: toArrayBuffer(zip),
      zipName: `${stem || 'document'}-images.zip`,
      files,
      extracted: images.length,
      skipped,
      pageCount,
    };
  },
};
