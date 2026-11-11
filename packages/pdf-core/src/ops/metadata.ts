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

/**
 * Semantic Info fields that describe the document rather than its producer.
 * Dates and `/Creator`/`/Producer` keep their existing policies.
 */
export interface DocumentMetadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
}

/** Reads the semantic fields, treating malformed or empty values as absent. */
export function readDocumentMetadata(doc: PDFDocument): DocumentMetadata {
  const pick = (value: unknown): string | undefined => {
    if (value === undefined || value === null) return undefined;
    const text = String(value).trim();
    return text.length > 0 ? text : undefined;
  };
  const safe = <T>(read: () => T): T | undefined => {
    try {
      return read();
    } catch {
      return undefined;
    }
  };
  const title = pick(safe(() => doc.getTitle()));
  const author = pick(safe(() => doc.getAuthor()));
  const subject = pick(safe(() => doc.getSubject()));
  const keywords = pick(safe(() => doc.getKeywords()));
  return {
    ...(title !== undefined ? { title } : {}),
    ...(author !== undefined ? { author } : {}),
    ...(subject !== undefined ? { subject } : {}),
    ...(keywords !== undefined ? { keywords } : {}),
  };
}

/**
 * Copies semantic metadata onto a freshly composed document. Fields absent
 * from the source stay absent (the new document never invents a title); dates
 * are deliberately handled by `applyDocumentDates`.
 */
export function applyDocumentMetadata(doc: PDFDocument, metadata: DocumentMetadata): void {
  if (metadata.title !== undefined) doc.setTitle(clampField(metadata.title));
  if (metadata.author !== undefined) doc.setAuthor(clampField(metadata.author));
  if (metadata.subject !== undefined) doc.setSubject(clampField(metadata.subject));
  if (metadata.keywords !== undefined) doc.setKeywords([clampField(metadata.keywords)]);
}

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
