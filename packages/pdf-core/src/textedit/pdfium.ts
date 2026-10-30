/**
 * Low-level PDFium text-object access.
 *
 * PDFium keeps a page's text as *objects*, and `FPDFText_SetText` / 
 * `FPDFText_SetCharcodes` rewrite one object's glyph string while leaving its
 * font, matrix, size and colour untouched. That is the whole basis of genuine
 * in-place editing, and it is a capability pdf-lib does not offer: pdf-lib can
 * append operators, not re-encode an existing run.
 *
 * Everything here is deliberately narrow -- open, enumerate text objects, read
 * text, rewrite one, regenerate, serialise, close. It owns the WASM heap
 * lifetimes so callers never touch a raw pointer that outlives its document.
 *
 * All object pointers returned by `listTextObjects` are valid only until the
 * next `generate` on that page; `generate` rebuilds the content stream and
 * PDFium invalidates the old objects.
 */

import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { geomFromBoxes, pdfRectToView, type DisplayRect, type PageGeom } from '../ops/geometry.js';

/** `FPDF_PAGEOBJ_TEXT` from `fpdf_edit.h`. */
const FPDF_PAGEOBJ_TEXT = 1;

/**
 * The WASM linear-memory view. The emscripten type surface does not declare
 * `HEAPU8`, and the view must be re-read after any allocation (a heap grow
 * detaches the old one), so it is never cached on the instance.
 */
function heapOf(m: WrappedPdfiumModule): Uint8Array {
  return (m.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8;
}

export interface PdfiumTextBounds {
  left: number;
  bottom: number;
  right: number;
  top: number;
}

export interface PdfiumTextObject {
  ptr: number;
  text: string;
  /** PDF user-space bounds (y up, unrotated page space). */
  bounds: PdfiumTextBounds;
  /** Nominal font size in points, or 0 when the font reports none. */
  fontSize: number;
}

export class PdfiumTextDocument {
  private readonly m: WrappedPdfiumModule;
  private readonly docPtr: number;
  private readonly dataPtr: number;
  private readonly pagePtrs = new Map<number, number>();
  private closed = false;

  private constructor(m: WrappedPdfiumModule, docPtr: number, dataPtr: number) {
    this.m = m;
    this.docPtr = docPtr;
    this.dataPtr = dataPtr;
  }

  /**
   * `FPDF_LoadMemDocument` does NOT copy the bytes -- it borrows the buffer for
   * the document's lifetime. The buffer therefore lives in the WASM heap and is
   * freed only in `close`, never by the caller.
   */
  static open(m: WrappedPdfiumModule, bytes: Uint8Array, password = ''): PdfiumTextDocument {
    const dataPtr = m.pdfium.wasmExports.malloc(Math.max(1, bytes.length));
    heapOf(m).set(bytes, dataPtr);
    const docPtr = m.FPDF_LoadMemDocument(dataPtr, bytes.length, password);
    if (!docPtr) {
      m.pdfium.wasmExports.free(dataPtr);
      throw new Error(`PDFium could not open the document (error ${m.FPDF_GetLastError()})`);
    }
    return new PdfiumTextDocument(m, docPtr, dataPtr);
  }

  pageCount(): number {
    return this.m.FPDF_GetPageCount(this.docPtr);
  }

  private page(pageIndex: number): number {
    const existing = this.pagePtrs.get(pageIndex);
    if (existing) return existing;
    const ptr = this.m.FPDF_LoadPage(this.docPtr, pageIndex);
    if (!ptr) throw new Error(`PDFium could not load page ${pageIndex + 1}`);
    this.pagePtrs.set(pageIndex, ptr);
    return ptr;
  }

  /** Display-space geometry of a page, matching the editor's frame. */
  geom(pageIndex: number): PageGeom {
    const page = this.page(pageIndex);
    const crop = this.readBox(page, 'FPDFPage_GetCropBox');
    const media = this.readBox(page, 'FPDFPage_GetMediaBox');
    // No CropBox is the common case (pdf-lib writes none): a `false` return
    // must fall through to the MediaBox, not hand `geomFromBoxes` whatever
    // bytes lay in the freshly-allocated buffer.
    return geomFromBoxes(
      crop ?? { x: Number.NaN, y: Number.NaN, width: Number.NaN, height: Number.NaN },
      this.m.FPDFPage_GetRotation(page) * 90,
      media ?? undefined,
    );
  }

  /** Full extracted text of a page, in reading order. Empty for image-only pages. */
  pageText(pageIndex: number): string {
    const textPage = this.m.FPDFText_LoadPage(this.page(pageIndex));
    if (!textPage) return '';
    try {
      const count = this.m.FPDFText_CountChars(textPage);
      if (count <= 0) return '';
      const byteLength = (count + 1) * 2;
      const buffer = this.alloc(byteLength);
      try {
        this.m.FPDFText_GetText(textPage, 0, count, buffer);
        return this.m.pdfium.UTF16ToString(buffer);
      } finally {
        this.free(buffer);
      }
    } finally {
      this.m.FPDFText_ClosePage(textPage);
    }
  }

  /** Every non-empty text object on a page, in content-stream order. */
  listTextObjects(pageIndex: number): PdfiumTextObject[] {
    const page = this.page(pageIndex);
    const textPage = this.m.FPDFText_LoadPage(page);
    if (!textPage) return [];
    try {
      const count = this.m.FPDFPage_CountObjects(page);
      const objects: PdfiumTextObject[] = [];
      for (let i = 0; i < count; i += 1) {
        const ptr = this.m.FPDFPage_GetObject(page, i);
        if (!ptr) continue;
        if (this.m.FPDFPageObj_GetType(ptr) !== FPDF_PAGEOBJ_TEXT) continue;
        const text = this.objectText(ptr, textPage);
        if (text.length === 0) continue;
        objects.push({
          ptr,
          text,
          bounds: this.objectBounds(ptr),
          fontSize: this.objectFontSize(ptr),
        });
      }
      return objects;
    } finally {
      this.m.FPDFText_ClosePage(textPage);
    }
  }

  /** Metadata for a single object, e.g. to confirm a write before regenerating. */
  objectText(objPtr: number, textPagePtr: number): string {
    // 0/0 asks PDFium for the required length in UTF-16 units (including NUL).
    const needed = this.m.FPDFTextObj_GetText(objPtr, textPagePtr, 0, 0);
    if (needed <= 0) return '';
    const buffer = this.alloc(needed * 2);
    try {
      this.m.FPDFTextObj_GetText(objPtr, textPagePtr, buffer, needed * 2);
      return this.m.pdfium.UTF16ToString(buffer);
    } finally {
      this.free(buffer);
    }
  }

  /**
   * Rewrite an object's glyph string in place. PDFium re-encodes the Unicode
   * against the object's own font; a font that cannot represent a character
   * yields filler glyphs rather than throwing, which is why the caller must
   * verify the serialized result instead of trusting this return value.
   */
  setText(objPtr: number, text: string): boolean {
    const ptr = this.writeUtf16(text);
    try {
      return Boolean(this.m.FPDFText_SetText(objPtr, ptr));
    } catch {
      return false;
    } finally {
      this.free(ptr);
    }
  }

  /**
   * Rewrite an object's charcodes directly, bypassing PDFium's reverse
   * Unicode→CID lookup. Returns false when the build has no such entry point
   * or the list is empty. The caller must supply codes the document itself
   * uses (see `charcodes.ts`); the return value still carries no guarantee
   * that the right glyphs came out.
   */
  setCharcodes(objPtr: number, charcodes: number[]): boolean {
    if (charcodes.length === 0) return false;
    const setCharcodes = (this.m as unknown as {
      FPDFText_SetCharcodes?: (obj: number, ptr: number, count: number) => boolean;
    }).FPDFText_SetCharcodes;
    if (typeof setCharcodes !== 'function') return false;
    const ptr = this.alloc(charcodes.length * 4);
    try {
      new Uint32Array(heapOf(this.m).buffer, ptr, charcodes.length).set(
        charcodes.map((code) => code >>> 0),
      );
      return Boolean(setCharcodes(objPtr, ptr, charcodes.length));
    } catch {
      return false;
    } finally {
      this.free(ptr);
    }
  }

  /**
   * The subset-tag-stripped base font name of a text object, or null when this
   * build exposes no such entry point. Used only to select a document-derived
   * charcode map; a name the document does not carry yields no map and no write.
   */
  fontNameOf(objPtr: number): string | null {
    const raw = this.m as unknown as {
      FPDFTextObj_GetFont?: (obj: number) => number;
      FPDFFont_GetBaseFontName?: (font: number, buffer: number, length: number) => number;
    };
    if (!raw.FPDFTextObj_GetFont || !raw.FPDFFont_GetBaseFontName) return null;
    try {
      const font = raw.FPDFTextObj_GetFont(objPtr);
      if (!font) return null;
      const length = raw.FPDFFont_GetBaseFontName(font, 0, 0);
      if (length <= 1) return null;
      const buffer = this.alloc(length);
      try {
        raw.FPDFFont_GetBaseFontName(font, buffer, length);
        return this.m.pdfium.UTF8ToString(buffer).replace(/^[A-Z]{6}\+/, '');
      } finally {
        this.free(buffer);
      }
    } catch {
      return null;
    }
  }

  /**
   * Remove a page object outright. This is how an in-place *deletion* works:
   * `FPDFText_SetText(object, "")` is refused, and covering the run with a
   * whiteout would leave the text recoverable. Removing the object deletes the
   * glyphs from the content stream, which is what "delete" has to mean.
   */
  removeObject(pageIndex: number, objPtr: number): boolean {
    try {
      return Boolean(this.m.FPDFPage_RemoveObject(this.page(pageIndex), objPtr));
    } catch {
      return false;
    }
  }

  /** Flush accumulated object changes into the page's content stream. */
  generate(pageIndex: number): boolean {
    return Boolean(this.m.FPDFPage_GenerateContent(this.page(pageIndex)));
  }

  /** Display-space rect of an object, for matching against the editor's runs. */
  objectDisplayRect(pageIndex: number, bounds: PdfiumTextBounds): DisplayRect {
    return pdfRectToView(this.geom(pageIndex), {
      x: bounds.left,
      y: bounds.bottom,
      width: bounds.right - bounds.left,
      height: bounds.top - bounds.bottom,
    });
  }

  serialize(): Uint8Array {
    const writer = this.m.PDFiumExt_OpenFileWriter();
    try {
      if (!this.m.PDFiumExt_SaveAsCopy(this.docPtr, writer)) {
        throw new Error('PDFium could not serialise the edited document');
      }
      const size = this.m.PDFiumExt_GetFileWriterSize(writer);
      const out = this.alloc(Math.max(1, size));
      try {
        this.m.PDFiumExt_GetFileWriterData(writer, out, size);
        const view = new Uint8Array(size);
        view.set(new Uint8Array(heapOf(this.m).buffer, out, size));
        return view;
      } finally {
        this.free(out);
      }
    } finally {
      this.m.PDFiumExt_CloseFileWriter(writer);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const ptr of this.pagePtrs.values()) {
      try {
        this.m.FPDF_ClosePage(ptr);
      } catch {
        /* already released with the document */
      }
    }
    this.pagePtrs.clear();
    try {
      this.m.FPDF_CloseDocument(this.docPtr);
    } finally {
      this.free(this.dataPtr);
    }
  }

  private objectBounds(ptr: number): PdfiumTextBounds {
    const left = this.alloc(4);
    const bottom = this.alloc(4);
    const right = this.alloc(4);
    const top = this.alloc(4);
    try {
      if (!this.m.FPDFPageObj_GetBounds(ptr, left, bottom, right, top)) {
        return { left: 0, bottom: 0, right: 0, top: 0 };
      }
      return {
        left: this.m.pdfium.getValue(left, 'float'),
        bottom: this.m.pdfium.getValue(bottom, 'float'),
        right: this.m.pdfium.getValue(right, 'float'),
        top: this.m.pdfium.getValue(top, 'float'),
      };
    } finally {
      this.free(left);
      this.free(bottom);
      this.free(right);
      this.free(top);
    }
  }

  private objectFontSize(ptr: number): number {
    const out = this.alloc(4);
    try {
      if (!this.m.FPDFTextObj_GetFontSize(ptr, out)) return 0;
      return this.m.pdfium.getValue(out, 'float');
    } catch {
      return 0;
    } finally {
      this.free(out);
    }
  }

  private readBox(
    page: number,
    method: 'FPDFPage_GetCropBox' | 'FPDFPage_GetMediaBox',
  ): { x: number; y: number; width: number; height: number } | null {
    const left = this.alloc(4);
    const bottom = this.alloc(4);
    const right = this.alloc(4);
    const top = this.alloc(4);
    try {
      // The API reports which box it actually wrote: `false` means the page
      // carries none, and the four one-float allocations still hold whatever
      // previous heap activity left there. Return null and let the caller
      // fall back -- never read out a box the document does not have.
      if (!this.m[method](page, left, bottom, right, top)) return null;
      const l = this.m.pdfium.getValue(left, 'float');
      const b = this.m.pdfium.getValue(bottom, 'float');
      const r = this.m.pdfium.getValue(right, 'float');
      const t = this.m.pdfium.getValue(top, 'float');
      return { x: l, y: b, width: r - l, height: t - b };
    } finally {
      this.free(left);
      this.free(bottom);
      this.free(right);
      this.free(top);
    }
  }

  private writeUtf16(str: string): number {
    const byteLength = (str.length + 1) * 2;
    const ptr = this.alloc(byteLength);
    this.m.pdfium.stringToUTF16(str, ptr, byteLength);
    return ptr;
  }

  private alloc(bytes: number): number {
    const ptr = this.m.pdfium.wasmExports.malloc(Math.max(1, bytes));
    if (!ptr) throw new Error('PDFium heap allocation failed');
    return ptr;
  }

  private free(ptr: number): void {
    if (ptr) this.m.pdfium.wasmExports.free(ptr);
  }
}
