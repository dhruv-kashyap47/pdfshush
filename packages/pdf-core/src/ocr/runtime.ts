/**
 * OCR runtime injection.
 *
 * The engine is configured by the host worker exactly once, the same way
 * pdf.js and PDFium are. Nothing here imports Tesseract, so a Node build or the
 * main-thread bundle can import these helpers without carrying a recognizer.
 */

import { OcrUnavailableError, type OcrEngine, type OcrEngineFactory } from './types.js';

let factory: OcrEngineFactory | null = null;

export interface OcrRuntimeConfig {
  /** `null` disables OCR for this environment. */
  createEngine: OcrEngineFactory | null;
}

export function configureOcrRuntime(next: OcrRuntimeConfig): void {
  factory = next.createEngine;
}

export function hasOcrRuntime(): boolean {
  return factory !== null;
}

/**
 * Creates one recognizer. Callers own its lifetime and must `terminate()` it;
 * a job creates it lazily so a document that already has a text layer never
 * downloads the engine data.
 */
export async function createOcrEngine(): Promise<OcrEngine> {
  if (factory === null) throw new OcrUnavailableError();
  return factory();
}
