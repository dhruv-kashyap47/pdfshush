import { PDFDocument } from '@cantoo/pdf-lib';

export interface PageInfo {
  /** Zero-based index within its source document. */
  index: number;
  widthPt: number;
  heightPt: number;
  rotation: number;
  cropBox: { x: number; y: number; width: number; height: number };
}

export interface PdfInfo {
  pageCount: number;
  pages: PageInfo[];
  encrypted: boolean;
  version: string;
  metadata: {
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string;
    creator?: string;
    producer?: string;
    creationDate?: Date;
  };
}

/** Thrown when a document is encrypted and no (or a wrong) password was given. */
export class EncryptedDocumentError extends Error {
  constructor(message = 'This PDF is password protected') {
    super(message);
    this.name = 'EncryptedDocumentError';
  }
}

export interface LoadOptions {
  password?: string;
}

export async function loadPdfDocument(
  data: Uint8Array,
  options: LoadOptions = {},
): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(data, {
      ...(options.password !== undefined ? { password: options.password } : {}),
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
  } catch (error) {
    if (error instanceof Error && /encrypt/i.test(error.message)) {
      throw new EncryptedDocumentError(
        options.password ? 'Incorrect password for this PDF' : 'This PDF is password protected',
      );
    }
    throw error;
  }
}

export async function inspectPdf(data: Uint8Array, options: LoadOptions = {}): Promise<PdfInfo> {
  const doc = await loadPdfDocument(data, options);
  const pages = doc.getPages();

  const info: PageInfo[] = pages.map((page, index) => {
    const size = page.getSize();
    const box = page.getCropBox();
    return {
      index,
      widthPt: round2(size.width),
      heightPt: round2(size.height),
      rotation: page.getRotation().angle,
      cropBox: {
        x: round2(box.x),
        y: round2(box.y),
        width: round2(box.width),
        height: round2(box.height),
      },
    };
  });

  return {
    pageCount: pages.length,
    pages: info,
    encrypted: isEncrypted(doc),
    version: readVersion(doc),
    metadata: readMetadata(doc),
  };
}

/** Cheap page count probe -- avoids building the full page info array. */
export async function probePageCount(data: Uint8Array, options: LoadOptions = {}): Promise<number> {
  const doc = await loadPdfDocument(data, options);
  return doc.getPageCount();
}

/** `isEncrypted` is a public property on the loaded document, not a method. */
function isEncrypted(doc: PDFDocument): boolean {
  return Boolean((doc as unknown as { isEncrypted?: boolean }).isEncrypted);
}

/** Header version, e.g. "1.7". Falls back gracefully on odd documents. */
function readVersion(doc: PDFDocument): string {
  const header = (
    doc as unknown as { context?: { header?: { getVersionString?: () => string } } }
  ).context?.header;
  try {
    return header?.getVersionString?.() ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function readMetadata(doc: PDFDocument): PdfInfo['metadata'] {
  const pick = (value: unknown): string | undefined => {
    if (value === undefined || value === null) return undefined;
    const text = String(value).trim();
    return text.length > 0 ? text : undefined;
  };

  const title = pick(safe(() => doc.getTitle()));
  const author = pick(safe(() => doc.getAuthor()));
  const subject = pick(safe(() => doc.getSubject()));
  const keywords = pick(safe(() => doc.getKeywords()));
  const creator = pick(safe(() => doc.getCreator()));
  const producer = pick(safe(() => doc.getProducer()));
  const creation = safe(() => doc.getCreationDate());

  return {
    ...(title !== undefined ? { title } : {}),
    ...(author !== undefined ? { author } : {}),
    ...(subject !== undefined ? { subject } : {}),
    ...(keywords !== undefined ? { keywords } : {}),
    ...(creator !== undefined ? { creator } : {}),
    ...(producer !== undefined ? { producer } : {}),
    ...(creation instanceof Date ? { creationDate: creation } : {}),
  };
}

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}