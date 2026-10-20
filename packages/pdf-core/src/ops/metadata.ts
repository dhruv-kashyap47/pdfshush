/**
 * Document metadata -- powers Edit Metadata.
 *
 * Operates on an open document. Only fields present (and different from the
 * current value) are written; an explicit empty string clears a field. Dates
 * are deliberately out of scope for v1: /ModDate semantics belong to the
 * producer and lying about them would corrupt provenance.
 */

import type { PDFDocument } from '@cantoo/pdf-lib';

export interface MetadataEdits {
  title?: string;
  author?: string;
  subject?: string;
  /** Comma-separated keywords (pdf-lib stores them as an array). */
  keywords?: string[];
  creator?: string;
  producer?: string;
}

const MAX_FIELD_CHARS = 500;

function clampField(value: string): string {
  // Control characters never belong in metadata; trim noise out.
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_FIELD_CHARS);
}

export function applyMetadataEdits(doc: PDFDocument, edits: MetadataEdits): void {
  if (edits.title !== undefined) doc.setTitle(clampField(edits.title));
  if (edits.author !== undefined) doc.setAuthor(clampField(edits.author));
  if (edits.subject !== undefined) doc.setSubject(clampField(edits.subject));
  if (edits.keywords !== undefined) {
    const keywords = edits.keywords.slice(0, 50).map((keyword) => clampField(keyword)).filter((k) => k.length > 0);
    doc.setKeywords(keywords);
  }
  if (edits.creator !== undefined) doc.setCreator(clampField(edits.creator));
  if (edits.producer !== undefined) doc.setProducer(clampField(edits.producer));
}
