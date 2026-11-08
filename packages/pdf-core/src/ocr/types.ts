/**
 * OCR contracts.
 *
 * The engine is injected by the host rather than imported here: pdf-core runs
 * in the browser worker, on the server and in Node tests, and only the browser
 * has a Tesseract build with the WebAssembly and language assets it needs.
 * Keeping the contract in the engine means the job, the layout code and the
 * UI all agree on one shape regardless of who implements recognition.
 *
 * Coordinates are image pixels throughout this module. Conversion to PDF
 * points happens once, in `layout.ts`, so a future engine that reports a
 * different pixel origin can be adapted at the boundary instead of leaking
 * into the text layer.
 */

/** Axis-aligned box in image pixels, origin at the image's top-left. */
export interface OcrBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrWord {
  text: string;
  /** Engine confidence 0..100. */
  confidence: number;
  box: OcrBox;
}

export interface OcrLine {
  text: string;
  confidence: number;
  box: OcrBox;
  /**
   * Baseline segment reported by Tesseract, when available. The midpoint is a
   * better vertical anchor than the box bottom: descenders make the box bottom
   * sit below the baseline by a font-dependent amount.
   */
  baseline?: OcrBox;
  words: OcrWord[];
}

export interface OcrPage {
  lines: OcrLine[];
  /** Page-level confidence 0..100. */
  confidence: number;
}

export interface OcrEngineProgress {
  /** Engine status, e.g. "recognizing text" or "loading language traineddata". */
  status: string;
  /** 0..1 for the current recognition pass when the engine exposes it. */
  ratio?: number;
}

export interface OcrRecognizeOptions {
  signal?: AbortSignal;
  onProgress?: (progress: OcrEngineProgress) => void;
}

/**
 * One recognizer instance. The job creates it lazily (a document that already
 * has text never pays for the engine) and terminates it in a `finally`.
 */
export interface OcrEngine {
  recognize(image: Blob, options?: OcrRecognizeOptions): Promise<OcrPage>;
  terminate(): Promise<void>;
}

export type OcrEngineFactory = () => Promise<OcrEngine> | OcrEngine;

/** Thrown when the host did not configure an OCR implementation. */
export class OcrUnavailableError extends Error {
  constructor(
    message = 'OCR is not available in this build. Open PDFShush in a browser to use it.',
  ) {
    super(message);
    this.name = 'OcrUnavailableError';
  }
}
