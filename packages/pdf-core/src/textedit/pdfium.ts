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
import {
  geomFromBoxes,
  pdfRectToView,
  viewToPdf,
  type DisplayRect,
  type PageGeom,
} from '../ops/geometry.js';

/** `FPDF_PAGEOBJ_TEXT` from `fpdf_edit.h`. */
const FPDF_PAGEOBJ_TEXT = 1;

/** Affine matrix in PDF order `[a, b, c, d, e, f]`. */
export type PdfiumMatrix = readonly [number, number, number, number, number, number];

export interface PdfiumColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Font facts PDFium exposes for an existing text object. */
export interface PdfiumFontInfo {
  baseName: string;
  familyName: string;
  embedded: boolean;
  weight: number;
  italicAngle: number;
  flags: number;
  ascent: number;
  descent: number;
  monospace: boolean;
  serif: boolean;
}

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
  /** PDF text render mode (3 = invisible, the usual OCR-layer marker). */
  renderMode: number;
  /** Object matrix in PDF space. */
  matrix: PdfiumMatrix | null;
  /** Font pointer captured while the page's text page is open. */
  fontPtr: number;
  /** Font facts, or null when this build has no font introspection. */
  font: PdfiumFontInfo | null;
}

export class PdfiumTextDocument {
  private readonly m: WrappedPdfiumModule;
  private readonly docPtr: number;
  private readonly dataPtr: number;
  private readonly pagePtrs = new Map<number, number>();
  private readonly standardFontPtrs = new Map<string, number>();
  private closed = false;
  /** Last createTextObject failure, for a non-vague engine error. */
  lastCreateError = '';

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

  /** Count page objects by kind; used for scanned/OCR capability reports. */
  objectCounts(pageIndex: number): {
    text: number;
    image: number;
    path: number;
    form: number;
    unknown: number;
  } {
    const page = this.page(pageIndex);
    const counts = { text: 0, image: 0, path: 0, form: 0, unknown: 0 };
    const count = this.m.FPDFPage_CountObjects(page);
    for (let i = 0; i < count; i += 1) {
      const object = this.m.FPDFPage_GetObject(page, i);
      if (!object) {
        counts.unknown += 1;
        continue;
      }
      switch (this.m.FPDFPageObj_GetType(object)) {
        case 1: // FPDF_PAGEOBJ_TEXT
          counts.text += 1;
          break;
        case 2: // FPDF_PAGEOBJ_PATH
          counts.path += 1;
          break;
        case 3: // FPDF_PAGEOBJ_IMAGE
          counts.image += 1;
          break;
        case 5: // FPDF_PAGEOBJ_FORM
          counts.form += 1;
          break;
        default:
          counts.unknown += 1;
      }
    }
    return counts;
  }

  /** Every page object's display-space bounds, for collision checks. */
  listPageObjectBounds(pageIndex: number): {
    ptr: number;
    kind: 'text' | 'image' | 'path' | 'form' | 'unknown';
    bounds: PdfiumTextBounds;
  }[] {
    const page = this.page(pageIndex);
    const count = this.m.FPDFPage_CountObjects(page);
    const objects: {
      ptr: number;
      kind: 'text' | 'image' | 'path' | 'form' | 'unknown';
      bounds: PdfiumTextBounds;
    }[] = [];
    for (let i = 0; i < count; i += 1) {
      const ptr = this.m.FPDFPage_GetObject(page, i);
      if (!ptr) continue;
      const type = this.m.FPDFPageObj_GetType(ptr);
      const kind =
        type === 1 ? 'text' : type === 2 ? 'path' : type === 3 ? 'image' : type === 5 ? 'form' : 'unknown';
      objects.push({ ptr, kind, bounds: this.objectBounds(ptr) });
    }
    return objects;
  }

  /** Every non-empty text object on a page, in content-stream order. */
  listTextObjects(pageIndex: number): PdfiumTextObject[] {    const page = this.page(pageIndex);
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
          renderMode: this.objectRenderMode(ptr),
          matrix: this.objectMatrix(ptr),
          fontPtr: this.fontPtrOf(ptr),
          font: this.fontInfoOf(ptr),
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

  /** Font pointer for a text object, or 0. The pointer is owned by the document
   * and stays valid until close; it can be reused to create reflowed lines in
   * the original font.
   */
  fontPtrOf(objPtr: number): number {
    const raw = this.m as unknown as {
      FPDFTextObj_GetFont?: (obj: number) => number;
    };
    if (!raw.FPDFTextObj_GetFont) return 0;
    try {
      return raw.FPDFTextObj_GetFont(objPtr) || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Load one of PDFium's standard fonts for a **new** text object.
   *
   * A standard Type1 font may be usable for rewriting an existing object but
   * not for `FPDFPageObj_CreateTextObj` in every build; reloading the standard
   * font by base name is an exact font for the standard-14 case, not a
   * substitution. Returns 0 for non-standard/custom fonts.
   */
  loadStandardFont(name: string): number {
    const normalized = name.replace(/^[A-Z]{6}\+/, '');
    if (!/^(helvetica|times|courier)/i.test(normalized)) return 0;
    const cached = this.standardFontPtrs.get(normalized);
    if (cached) return cached;
    try {
      const ptr = this.m.FPDFText_LoadStandardFont(this.docPtr, normalized);
      if (ptr) this.standardFontPtrs.set(normalized, ptr);
      return ptr || 0;
    } catch {
      return 0;
    }
  }

  /** Font facts for a text object, or null when introspection is unavailable. */
  fontInfoOf(objPtr: number): PdfiumFontInfo | null {
    const font = this.fontPtrOf(objPtr);
    if (!font) return null;
    const raw = this.m as unknown as {
      FPDFFont_GetBaseFontName?: (font: number, buffer: number, length: number) => number;
      FPDFFont_GetFamilyName?: (font: number, buffer: number, length: number) => number;
      FPDFFont_GetIsEmbedded?: (font: number) => number;
      FPDFFont_GetWeight?: (font: number) => number;
      FPDFFont_GetItalicAngle?: (font: number, out: number) => boolean;
      FPDFFont_GetFlags?: (font: number) => number;
      FPDFFont_GetAscent?: (font: number, out: number) => boolean;
      FPDFFont_GetDescent?: (font: number, out: number) => boolean;
    };
    try {
      const readName = (
        method: ((font: number, buffer: number, length: number) => number) | undefined,
      ): string => {
        if (!method) return '';
        const length = method(font, 0, 0);
        if (length <= 1) return '';
        const buffer = this.alloc(length);
        try {
          method(font, buffer, length);
          return this.m.pdfium.UTF8ToString(buffer);
        } finally {
          this.free(buffer);
        }
      };
      const baseName = readName(raw.FPDFFont_GetBaseFontName).replace(/^[A-Z]{6}\+/, '');
      const familyName = readName(raw.FPDFFont_GetFamilyName);
      const readFloat = (
        method: ((font: number, out: number) => boolean) | undefined,
      ): number => {
        if (!method) return 0;
        const out = this.alloc(4);
        try {
          return method(font, out) ? this.m.pdfium.getValue(out, 'float') : 0;
        } finally {
          this.free(out);
        }
      };
      const flags = raw.FPDFFont_GetFlags?.(font) ?? 0;
      return {
        baseName,
        familyName,
        embedded: Boolean(raw.FPDFFont_GetIsEmbedded?.(font)),
        weight: raw.FPDFFont_GetWeight?.(font) || 400,
        italicAngle: readFloat(raw.FPDFFont_GetItalicAngle),
        flags,
        ascent: readFloat(raw.FPDFFont_GetAscent),
        descent: readFloat(raw.FPDFFont_GetDescent),
        // PDF font descriptor flags: bit 1 fixed-pitch, bit 2 serif,
        // bit 7 italic.
        monospace: (flags & 0x01) !== 0,
        serif: (flags & 0x02) !== 0,
      };
    } catch {
      return null;
    }
  }

  /**
   * Advance width of one charcode in the document's font, or null when the
   * glyph is not available. This is the metric native reflow must use: the
   * editor's CSS font is not the document's font.
   */
  glyphWidth(fontPtr: number, charcode: number, fontSize: number): number | null {
    const raw = this.m as unknown as {
      FPDFFont_GetGlyphWidth?: (
        font: number,
        code: number,
        size: number,
        out: number,
      ) => boolean;
    };
    if (!raw.FPDFFont_GetGlyphWidth || !fontPtr) return null;
    const out = this.alloc(4);
    try {
      if (!raw.FPDFFont_GetGlyphWidth(fontPtr, charcode, fontSize, out)) return null;
      return this.m.pdfium.getValue(out, 'float');
    } catch {
      return null;
    } finally {
      this.free(out);
    }
  }

  objectRenderMode(objPtr: number): number {
    const raw = this.m as unknown as {
      FPDFTextObj_GetTextRenderMode?: (obj: number) => number;
    };
    try {
      return raw.FPDFTextObj_GetTextRenderMode?.(objPtr) ?? 0;
    } catch {
      return 0;
    }
  }

  objectMatrix(objPtr: number): PdfiumMatrix | null {
    const out = this.alloc(24);
    try {
      if (!this.m.FPDFPageObj_GetMatrix(objPtr, out)) return null;
      const values = Array.from({ length: 6 }, (_, index) =>
        this.m.pdfium.getValue(out + index * 4, 'float'),
      ) as unknown as PdfiumMatrix;
      return values;
    } catch {
      return null;
    } finally {
      this.free(out);
    }
  }

  objectFillColor(objPtr: number): PdfiumColor {
    const out = [this.alloc(4), this.alloc(4), this.alloc(4), this.alloc(4)];
    try {
      if (!this.m.FPDFPageObj_GetFillColor(objPtr, out[0]!, out[1]!, out[2]!, out[3]!)) {
        return { r: 0, g: 0, b: 0, a: 1 };
      }
      return {
        r: this.m.pdfium.getValue(out[0]!, 'float'),
        g: this.m.pdfium.getValue(out[1]!, 'float'),
        b: this.m.pdfium.getValue(out[2]!, 'float'),
        a: this.m.pdfium.getValue(out[3]!, 'float'),
      };
    } catch {
      return { r: 0, g: 0, b: 0, a: 1 };
    } finally {
      for (const ptr of out) this.free(ptr);
    }
  }

  /** Display-space point -> PDF user-space point for this page. */
  viewPointToPdf(pageIndex: number, point: { x: number; y: number }): [number, number] {
    return viewToPdf(this.geom(pageIndex), point.x, point.y);
  }

  /**
   * Create a text object using an existing document font, position it with a
   * PDF matrix and append it to the page. Used by native reflow for lines that
   * are longer than the original paragraph. Returns 0 on failure.
   */
  createTextObject(
    pageIndex: number,
    fontPtr: number,
    fontSize: number,
    text: string,
    matrix: PdfiumMatrix,
    color?: PdfiumColor,
    renderMode = 0,
    charcodes?: number[] | null,
  ): number {
    this.lastCreateError = '';
    if (!fontPtr || text.length === 0) {
      this.lastCreateError = !fontPtr ? 'source font pointer is null' : 'line text is empty';
      return 0;
    }
    let obj = 0;
    try {
      // Create visible and switch the render mode afterwards: some PDFium
      // builds reject the third argument for an invisible text object.
      obj = this.m.FPDFPageObj_CreateTextObj(fontPtr, fontSize, 0);
      if (!obj) {
        this.lastCreateError = 'FPDFPageObj_CreateTextObj returned 0';
        return 0;
      }
      // Set the transform before writing: some builds derive the text object's
      // encoding context from the matrix.
      this.setObjectMatrix(obj, matrix);
      const written =
        this.setText(obj, text) ||
        (charcodes !== null && charcodes !== undefined && this.setCharcodes(obj, charcodes));
      if (!written) {
        this.lastCreateError = 'FPDFText_SetText refused the new line';
        this.m.FPDFPageObj_Destroy(obj);
        return 0;
      }
      if (color) this.m.FPDFPageObj_SetFillColor(obj, color.r, color.g, color.b, color.a);
      this.m.FPDFTextObj_SetTextRenderMode(obj, renderMode);
      this.m.FPDFPage_InsertObject(this.page(pageIndex), obj);
      return obj;
    } catch (error) {
      this.lastCreateError = error instanceof Error ? error.message : String(error);
      if (obj) {
        try {
          this.m.FPDFPageObj_Destroy(obj);
        } catch {
          /* already owned by the page */
        }
      }
      return 0;
    }
  }

  private setObjectMatrix(objPtr: number, matrix: PdfiumMatrix): boolean {
    const out = this.alloc(24);
    try {
      for (let index = 0; index < 6; index += 1) {
        this.m.pdfium.setValue(out + index * 4, matrix[index]!, 'float');
      }
      return Boolean(this.m.FPDFPageObj_SetMatrix(objPtr, out));
    } finally {
      this.free(out);
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
