/**
 * Tesseract adapter for the OCR contract.
 *
 * This is the only file that imports a recognizer. `pdf-core` owns the
 * pipeline (render, place, rebuild) and takes an `OcrEngine` from the host, so
 * the engine can stay browser-only without leaking a WebAssembly dependency
 * into the server or the Node test suite.
 *
 * Everything it fetches is same-origin: the worker script, the recognizer
 * core, and the English traineddata all ship with the app. Tesseract caches the
 * decompressed language data in IndexedDB, so the ~15 MB first run is paid once
 * per origin, and the service worker keeps the gzip copy for offline use.
 */

import { OEM, createWorker, type Worker } from 'tesseract.js';
import type {
  OcrEngine,
  OcrEngineProgress,
  OcrLine,
  OcrPage,
  OcrRecognizeOptions,
  OcrWord,
} from '@pdfshush/pdf-core';
import tesseractWorkerUrl from 'tesseract.js/dist/worker.min.js?url';
import tesseractCoreUrl from 'tesseract.js-core/tesseract-core-lstm.wasm.js?url';

/** Tesseract wants absolute URLs; the app may be deployed under a sub-path. */
function absolute(path: string): string {
  const base = typeof self !== 'undefined' && self.location ? self.location.origin : undefined;
  return new URL(path, base).toString();
}

/** Same-origin directory Tesseract appends `/eng.traineddata.gz` to. */
const LANG_PATH = absolute(`${import.meta.env.BASE_URL}tessdata`).replace(/\/$/, '');

interface TesseractBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * A fresh recognizer. `terminate()` is called in a `finally` by the job, and
 * also on abort: recognition is synchronous inside Tesseract's worker, so
 * killing the worker is the only way to stop it.
 */
export class TesseractOcrEngine implements OcrEngine {
  private worker: Worker | null = null;
  private creating: Promise<Worker> | null = null;
  private terminated = false;
  private onProgress: ((progress: OcrEngineProgress) => void) | undefined;

  private async ensureWorker(): Promise<Worker> {
    if (this.worker) return this.worker;
    if (this.creating) return this.creating;

    this.creating = createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: absolute(tesseractWorkerUrl),
      corePath: absolute(tesseractCoreUrl),
      // `langPath` is a directory; Tesseract appends `/eng.traineddata.gz`.
      // gzip stays true because the asset is shipped compressed.
      langPath: LANG_PATH,
      gzip: true,
      // The blob-worker path would work, but a direct URL keeps the nested
      // worker same-origin and avoids a second CSP surface.
      workerBlobURL: false,
      logger: (message) => {
        if (!this.onProgress) return;
        const progress: OcrEngineProgress = { status: message.status };
        if (/recogniz/i.test(message.status) && typeof message.progress === 'number') {
          progress.ratio = message.progress;
        }
        this.onProgress(progress);
      },
    })
      .then(async (worker) => {
        // An abort while the engine was downloading still has to release the
        // worker: it was created after `terminate()` had already run.
        if (this.terminated) {
          await worker.terminate().catch(() => undefined);
          throw abortError();
        }
        this.worker = worker;
        return worker;
      })
      .finally(() => {
        this.creating = null;
      });

    return this.creating;
  }

  async recognize(image: Blob, options: OcrRecognizeOptions = {}): Promise<OcrPage> {
    if (options.signal?.aborted) throw abortError();

    this.onProgress = options.onProgress;
    const work = (async () => {
      const worker = await this.ensureWorker();
      // v7 defaults `blocks` to false; word boxes live only in the block tree.
      const { data } = await worker.recognize(image, {}, { blocks: true });
      return toOcrPage(data);
    })();

    // A rejected `work` must not become an unhandled rejection when the abort
    // branch wins the race below.
    const settled = work.finally(() => {
      this.onProgress = undefined;
    });
    settled.catch(() => undefined);

    const signal = options.signal;
    if (!signal) return settled;

    return new Promise<OcrPage>((resolve, reject) => {
      const onAbort = () => {
        void this.terminate();
        reject(abortError());
      };
      signal.addEventListener('abort', onAbort, { once: true });
      settled.then(resolve, reject).finally(() => {
        signal.removeEventListener('abort', onAbort);
      });
    });
  }

  async terminate(): Promise<void> {
    if (this.terminated) return;
    this.terminated = true;
    const worker = this.worker;
    this.worker = null;
    if (worker) await worker.terminate().catch(() => undefined);
  }
}

/** Admits one recognizer; the job owns it and terminates it when finished. */
export async function createTesseractOcrEngine(): Promise<OcrEngine> {
  return new TesseractOcrEngine();
}

/**
 * Tesseract's block tree -> the engine-neutral page shape.
 *
 * Reading order is Tesseract's own (blocks, paragraphs, lines, words). Words
 * with no text are dropped here rather than in the layout code, because a
 * boxless empty word would otherwise create a placement with no width.
 */
function toOcrPage(data: {
  blocks: readonly {
    paragraphs: readonly {
      lines: readonly {
        text: string;
        confidence: number;
        bbox: TesseractBox;
        baseline?: TesseractBox;
        words: readonly { text: string; confidence: number; bbox: TesseractBox }[];
      }[];
    }[];
  }[] | null;
  confidence: number;
}): OcrPage {
  const lines: OcrLine[] = [];

  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        const words: OcrWord[] = line.words
          .filter((word) => word.text.trim().length > 0)
          .map((word) => ({
            text: word.text,
            confidence: word.confidence,
            box: toBox(word.bbox),
          }));
        if (words.length === 0) continue;

        lines.push({
          text: line.text,
          confidence: line.confidence,
          box: toBox(line.bbox),
          ...(line.baseline ? { baseline: toBox(line.baseline) } : {}),
          words,
        });
      }
    }
  }

  return { lines, confidence: data.confidence };
}

function toBox(box: TesseractBox): { x0: number; y0: number; x1: number; y1: number } {
  return { x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 };
}

function abortError(): Error {
  try {
    return new DOMException('The OCR job was cancelled', 'AbortError');
  } catch {
    const error = new Error('The OCR job was cancelled');
    error.name = 'AbortError';
    return error;
  }
}
