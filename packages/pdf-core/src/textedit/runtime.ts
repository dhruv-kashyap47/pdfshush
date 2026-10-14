/**
 * PDFium runtime bootstrap.
 *
 * PDFium is a second engine alongside pdf-lib and pdf.js, used only for text
 * mutation (pdf-lib can add operators; it cannot rewrite an existing text
 * object's glyphs in the document's own font). It is a ~4.6 MB WASM binary, so
 * it is never imported at module load: the `init` import below is dynamic, and
 * the host injects the asset URL once, exactly like `configurePdfjsRuntime`.
 *
 * The module is instantiated at most once per worker and cached. There is no
 * safe concurrent use of one PDFium heap, so callers serialise through the job
 * pool, which already bounds worker concurrency.
 */

import type { WrappedPdfiumModule } from '@embedpdf/pdfium';

export interface PdfiumRuntimeConfig {
  /** URL of `pdfium.wasm`, injected by the host build (browser worker). */
  wasmUrl?: string;
  /** Pre-read WASM bytes for environments without a fetchable URL (Node/tests). */
  wasmBinary?: Uint8Array | ArrayBuffer;
}

let config: PdfiumRuntimeConfig = {};
let modulePromise: Promise<WrappedPdfiumModule> | null = null;

export function configurePdfiumRuntime(next: PdfiumRuntimeConfig): void {
  config = { ...config, ...next };
}

/**
 * True when a module could be instantiated: either a URL or bytes were
 * configured. Callers use this to choose the fallback path *before* starting,
 * rather than after a failed import.
 */
export function isPdfiumConfigured(): boolean {
  return Boolean(config.wasmUrl || config.wasmBinary);
}

/** Lazily instantiate PDFium. A failure is not cached, so a transient fetch retries. */
export function loadPdfiumModule(): Promise<WrappedPdfiumModule> {
  if (!modulePromise) {
    modulePromise = instantiate().catch((error: unknown) => {
      modulePromise = null;
      throw error;
    });
  }
  return modulePromise;
}

async function instantiate(): Promise<WrappedPdfiumModule> {
  if (!isPdfiumConfigured()) {
    throw new Error(
      'PDFium runtime not configured: call configurePdfiumRuntime({ wasmUrl }) first',
    );
  }
  // Dynamic on purpose: a static import would pull the WASM glue into every
  // bundle that touches pdf-core, violating the "main bundle carries no parser"
  // invariant in PLAN.md §3.
  const { init } = await import('@embedpdf/pdfium');
  const overrides = config.wasmBinary
    ? { wasmBinary: toArrayBuffer(config.wasmBinary) }
    : { locateFile: () => config.wasmUrl! };
  const module = await init(overrides as Parameters<typeof init>[0]);
  // Extensions (file-writer, form fill) are not wired up by `init` alone.
  try {
    module.PDFiumExt_Init();
  } catch {
    /* already initialised */
  }
  return module;
}

function toArrayBuffer(value: Uint8Array | ArrayBuffer): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value;
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

/** Test-only: drop the cached module so a fresh instance is built next call. */
export function resetPdfiumRuntime(): void {
  modulePromise = null;
}
