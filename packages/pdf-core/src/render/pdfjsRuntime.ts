/**
 * pdf.js bootstrap.
 *
 * pdf.js normally wants to spawn its own worker. That is fine inside our worker
 * (browsers support nested workers), but the asset URL is build-tool specific,
 * so the host application injects it once at startup via
 * `configurePdfjsRuntime`.
 */

import { getDocument, GlobalWorkerOptions, type PDFDocumentLoadingTask, type PDFDocumentProxy } from 'pdfjs-dist';
import { hasOffscreenCanvas, PdfjsCanvasFactory } from './canvas.js';

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
    // Where rendering happens in a Web Worker. pdf.js needs to allocate canvases
    // of its own while painting (image downscaling, soft masks, tiling patterns,
    // shadings, transparency groups) and defaults to a DOM-backed factory whose
    // `globalThis.document` does not exist here. Left to that default, every
    // page painting an image died with "Cannot read properties of undefined
    // (reading 'createElement')".
    //
    // It must go to `getDocument`, not `page.render`: `PDFPageProxy.render`
    // overrides the factory with the one the transport built.
    //
    // Omitted under Node so pdf.js keeps its `NodeCanvasFactory` there -- which is
    // also why this cannot be set unconditionally, as `isNodeJS` decides the
    // default and we must not override it with OffscreenCanvas.
    //
    // pdf.js also builds a `DOMFilterFactory` from the same `globalThis.document`,
    // so it carries the identical latent hazard. It was checked rather than
    // assumed: across a corpus including image-heavy, alpha/soft-mask and scanned
    // documents, display rendering only ever calls its base `destroy`, and every
    // method that touches a DOM is a colour-management/selection path we never
    // take (`intent: "display"`, no annotation selection). Left alone on purpose:
    // a no-op filter factory would silently drop filter effects, which is a worse
    // failure than a loud one. Revisit if print intent or selection styling lands.
    ...(hasOffscreenCanvas() ? { CanvasFactory: PdfjsCanvasFactory } : {}),
    ...(options.password !== undefined ? { password: options.password } : {}),
    ...(config.cMapUrl
      ? { cMapUrl: config.cMapUrl, cMapPacked: config.cMapPacked ?? true, useWorkerFetch: true }
      : {}),
    ...(config.standardFontDataUrl
      ? { standardFontDataUrl: config.standardFontDataUrl, useWorkerFetch: true }
      : {}),
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
