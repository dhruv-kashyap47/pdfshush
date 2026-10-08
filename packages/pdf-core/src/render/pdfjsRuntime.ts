/**
 * pdf.js bootstrap.
 *
 * pdf.js normally wants to spawn its own worker. That is fine inside our worker
 * (browsers support nested workers), but the asset URL is build-tool specific,
 * so the host application injects it once at startup via
 * `configurePdfjsRuntime`.
 */

import { getDocument, GlobalWorkerOptions, type PDFDocumentLoadingTask, type PDFDocumentProxy } from 'pdfjs-dist';

export interface PdfjsRuntimeConfig {
  /** URL of the pdf.js worker bundle. Supplied by the host build. */
  workerSrc?: string;
  /** Standard fonts / CMap sources, needed for CJK and exotic encodings. */
  cMapUrl?: string;
  cMapPacked?: boolean;
  standardFontDataUrl?: string;
}

let config: PdfjsRuntimeConfig = {};

export function configurePdfjsRuntime(next: PdfjsRuntimeConfig): void {
  config = { ...config, ...next };
  if (config.workerSrc) {
    GlobalWorkerOptions.workerSrc = config.workerSrc;
  }
}

export interface LoadPdfOptions {
  password?: string;
}

export interface LoadedPdf {
  doc: PDFDocumentProxy;
  /** Destroys the document AND the pdf.js worker task it was loaded with. */
  destroy(): Promise<void>;
}

export async function loadPdfForRender(
  data: Uint8Array,
  options: LoadPdfOptions = {},
): Promise<LoadedPdf> {
  if (!GlobalWorkerOptions.workerSrc) {
    throw new Error('pdf.js runtime not configured: call configurePdfjsRuntime({ workerSrc }) first');
  }

  // pdf.js takes ownership of the buffer it is given and may transfer/detach it,
  // so it always gets its own copy. Cost: one extra allocation per document.
  const buffer = data.slice();
  const task: PDFDocumentLoadingTask = getDocument({
    data: buffer,
    ...(options.password !== undefined ? { password: options.password } : {}),
    ...(config.cMapUrl ? { cMapUrl: config.cMapUrl, cMapPacked: config.cMapPacked ?? true } : {}),
    ...(config.standardFontDataUrl ? { standardFontDataUrl: config.standardFontDataUrl } : {}),
  });
  let doc: PDFDocumentProxy;
  try {
    doc = await task.promise;
  } catch (error) {
    // A failed load (corrupt file, wrong password) must still release the pdf.js
    // worker it started, or every failed attempt leaks one for the tab's life.
    await task.destroy().catch(() => undefined);
    throw error;
  }
  return {
    doc,
    async destroy() {
      // Destroying the loading task releases the worker too; destroying only
      // the document leaks it until the page unloads.
      await task.destroy().catch(() => undefined);
    },
  };
}
