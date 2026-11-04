/**
 * Deterministic document dates.
 *
 * `PDFDocument.create()` stamps `/Producer`, `/ModDate` and (when absent)
 * `/CreationDate` from the wall clock in its constructor. That is fine for a
 * document a user creates by hand, and wrong for a tool: running the same merge
 * twice produced different bytes, which breaks reproducible output, stable
 * hashes, cache validation and any "same input, same output" promise.
 *
 * Two policies cover every synthetic document in the engine:
 *
 *  - **inherit** -- a document assembled from source PDFs keeps the *earliest*
 *    `/CreationDate` and the *latest* `/ModDate` found among its sources. The
 *    output is derived from them, so it inherits their provenance instead of
 *    inventing a new moment.
 *  - **omit** -- a document rebuilt from pixels (or from images alone) has no
 *    source PDF to inherit from, so both keys are removed rather than stamped
 *    with a fabricated timestamp.
 *
 * Only the two date keys are touched. `/Producer` and `/Creator` are constants
 * written by the library, so they do not vary between runs.
 */

import { PDFDict, PDFDocument, PDFName } from '@cantoo/pdf-lib';

export interface DocumentDates {
  creationDate?: Date;
  modificationDate?: Date;
}

function validDate(value: Date | undefined): Date | undefined {
  return value && Number.isFinite(value.getTime()) ? value : undefined;
}

/**
 * Reads the Info-dictionary dates from an open document.
 *
 * Malformed values are treated as absent: a broken `/ModDate` must not make a
 * tool fail, and it must not be re-emitted as a different date.
 */
export function readDocumentDates(doc: PDFDocument): DocumentDates {
  let creationDate: Date | undefined;
  let modificationDate: Date | undefined;
  try {
    creationDate = validDate(doc.getCreationDate());
  } catch {
    creationDate = undefined;
  }
  try {
    modificationDate = validDate(doc.getModificationDate());
  } catch {
    modificationDate = undefined;
  }
  return {
    ...(creationDate ? { creationDate } : {}),
    ...(modificationDate ? { modificationDate } : {}),
  };
}

/** Earliest creation date and latest modification date across `sources`. */
export function combineDocumentDates(sources: readonly DocumentDates[]): DocumentDates {
  let creationDate: Date | undefined;
  let modificationDate: Date | undefined;

  for (const source of sources) {
    const created = validDate(source.creationDate);
    if (created && (!creationDate || created.getTime() < creationDate.getTime())) {
      creationDate = created;
    }
    const modified = validDate(source.modificationDate);
    if (modified && (!modificationDate || modified.getTime() > modificationDate.getTime())) {
      modificationDate = modified;
    }
  }

  return {
    ...(creationDate ? { creationDate } : {}),
    ...(modificationDate ? { modificationDate } : {}),
  };
}

function removeInfoEntry(doc: PDFDocument, key: string): void {
  const info = doc.context.lookup(doc.context.trailerInfo.Info);
  if (info instanceof PDFDict) info.delete(PDFName.of(key));
}

/**
 * Applies a date policy to a freshly created document, replacing whatever
 * `PDFDocument.create()` stamped. A missing date removes the key.
 */
export function applyDocumentDates(doc: PDFDocument, dates: DocumentDates): void {
  const creationDate = validDate(dates.creationDate);
  if (creationDate) doc.setCreationDate(creationDate);
  else removeInfoEntry(doc, 'CreationDate');

  const modificationDate = validDate(dates.modificationDate);
  if (modificationDate) doc.setModificationDate(modificationDate);
  else removeInfoEntry(doc, 'ModDate');
}
