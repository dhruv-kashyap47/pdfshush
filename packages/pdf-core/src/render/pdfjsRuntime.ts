/**
 * pdf.js bootstrap.
 *
 * pdf.js normally wants to spawn its own worker. That is fine inside our worker
 * (browsers support nested workers), but the asset URL is build-tool specific,
 * so the host application injects it once at startup via
 * `configurePdfjsRuntime`.
 */

import { getDocument, GlobalWorkerOptions, VerbosityLevel, type PDFDocumentLoadingTask, type PDFDocumentProxy } from 'pdfjs-dist';
import { hasOffscreenCanvas, PdfjsCanvasFactory } from './canvas.js';

export interface PdfjsRuntimeConfig {
  /** URL of the pdf.js worker bundle. Supplied by the host build. */
  workerSrc?: string;
  /** Standard fonts / CMap sources, needed for CJK and exotic encodings. */
  cMapUrl?: string;
  cMapPacked?: boolean;
  standardFontDataUrl?: string;
  /**
   * Console verbosity for this context's pdf.js copy. Only ever passed by a
   * host whose pdf.js runs inside a job worker, where pdf.js cannot spawn its
   * own nested worker and falls back to parsing in-thread over a `LoopbackPort`
   * (pdf.mjs's `#initialize` dereferences `window`, which does not exist in a
   * worker global). Errors-only keeps the per-document "Setting up fake
   * worker." warning quiet without hiding real failures.
   */
  verbosity?: (typeof VerbosityLevel)[keyof typeof VerbosityLevel];
}

let config: PdfjsRuntimeConfig = {};

/**
 * Node cannot `fetch()` a `file:` URL, so pdf.js must read cMap and standard
 * font data through its `FetchBinaryData` handler (which uses `fs`) instead of
 * fetching inside the worker. Browsers and browser workers can fetch the
 * bundled URLs directly. Left on in Node, every standard font load logged
 * "TypeError: fetch failed" and fell back to a system font.
 */
function isNodeRuntime(): boolean {
  const proc = (
    globalThis as {
      process?: { versions?: { node?: string }; getBuiltinModule?: unknown };
    }
  ).process;
  return (
    typeof proc?.versions?.node === 'string' && typeof proc.getBuiltinModule === 'function'
  );
}

/**
 * pdf.js' Node data factory hands the factory URL straight to `fs.readFile`.
 * A `file:///...` URL is a string there, not a path, so it resolves to a
 * nonexistent file. Convert it once at the boundary; browser workers keep the
 * URL they can fetch.
 */
function normalizeFactoryUrl(url: string | undefined): string | undefined {
  if (!url || !isNodeRuntime() || !url.startsWith('file:')) return url;
  const proc = (
    globalThis as unknown as { process: { getBuiltinModule(name: string): unknown } }
  ).process;
  const { fileURLToPath } = proc.getBuiltinModule('node:url') as {
    fileURLToPath(value: string): string;
  };
  // pdf.js requires a forward-slash trailing separator and simply concatenates
  // the filename. `fs.readFile` accepts forward slashes on Windows too.
  const path = fileURLToPath(url).replace(/\\/g, '/');
  return path.endsWith('/') ? path : `${path}/`;
}

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

/* ----------------------------------------------------------------- cache */

interface CacheEntry {
  key: string;
  doc: PDFDocumentProxy;
  destroy(): Promise<void>;
  users: number;
}

/**
 * Recently parsed documents.
 *
 * The editor re-reads one page at a time while the user scrolls, and every read
 * used to parse the whole file again and start a fresh pdf.js worker -- the
 * cost grew with the number of page reads, not with the document. Keeping a
 * couple of parsed documents alive fixes that. Three is enough for the editor's
 * "current document, previous document, next upload" pattern and bounds memory.
 */
const CACHE_LIMIT = 3;
const cache = new Map<string, CacheEntry>();

/**
 * SHA-256 over the bytes plus a digest of the password; identifies a document
 * without keeping a copy of it.
 *
 * Two properties the old 32-bit FNV-1a key could not give:
 *  - a collision is not a stability problem. FNV-1a is a 32-bit hash, so a
 *    collision would hand a *different* parsed document to the caller.
 *    SHA-256 makes that unreachable in practice.
 *  - the password never lives in the key. It used to be spliced in plaintext,
 *    so every password used with a parsed document sat in a long-lived Map
 *    key for the cache's lifetime. It now enters the key only as a digest.
 */

/** `subtle.digest` needs a real ArrayBuffer, not a view over a shared buffer. */
function asPlainBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

export async function documentKey(data: Uint8Array, password: string): Promise<string> {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle) {
    throw new Error(
      'This environment has no secure hashing, so parsed documents cannot be cached safely. Run pdfshush in a browser worker or a modern Node.',
    );
  }
  const [fileDigest, passwordDigest] = await Promise.all([
    cryptoApi.subtle.digest('SHA-256', asPlainBuffer(data)),
    password.length > 0
      ? cryptoApi.subtle.digest('SHA-256', asPlainBuffer(new TextEncoder().encode(password)))
      : Promise.resolve(new ArrayBuffer(0)),
  ]);
  const hex = (buffer: ArrayBuffer): string => {
    if (buffer.byteLength === 0) return '';
    return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join(
      '',
    );
  };
  return `${hex(fileDigest)}:${data.length}:${hex(passwordDigest)}`;
}

/** Releases every cached pdf.js document. Used by tests and by app shutdown. */
export async function resetPdfCache(): Promise<void> {
  const entries = [...cache.values()];
  cache.clear();
  await Promise.all(entries.map((entry) => entry.destroy().catch(() => undefined)));
}

function evictOne(): void {
  for (const [key, entry] of cache) {
    if (entry.users === 0) {
      cache.delete(key);
      void entry.destroy().catch(() => undefined);
      return;
    }
  }
}

function touch(key: string, entry: CacheEntry): void {
  // Map preserves insertion order; re-inserting makes this a tiny LRU.
  cache.delete(key);
  cache.set(key, entry);
}

export async function loadPdfForRender(
  data: Uint8Array,
  options: LoadPdfOptions = {},
): Promise<LoadedPdf> {
  if (!GlobalWorkerOptions.workerSrc) {
    throw new Error('pdf.js runtime not configured: call configurePdfjsRuntime({ workerSrc }) first');
  }

  const key = await documentKey(data, options.password ?? '');
  const cached = cache.get(key);
  if (cached) {
    cached.users += 1;
    touch(key, cached);
    return { doc: cached.doc, destroy: async () => release(cached) };
  }

  // pdf.js takes ownership of the buffer it is given and may transfer/detach it,
  // so it always gets its own copy. Cost: one extra allocation per document.
  const buffer = data.slice();
  const documentOptions = {
    data: buffer,
    // Dedicated workers have no document.fonts or FontFace installation
    // surface. Force deterministic glyph-path rendering from the PDF's font
    // data instead of allowing missing browser font APIs to produce tofu.
    disableFontFace: true,
    useSystemFonts: false,
    // Keep font execution/data handling deterministic for untrusted PDFs.
    isEvalSupported: false,
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
    ...(config.verbosity !== undefined ? { verbosity: config.verbosity } : {}),
    ...(config.cMapUrl
      ? {
          cMapUrl: normalizeFactoryUrl(config.cMapUrl),
          cMapPacked: config.cMapPacked ?? true,
          useWorkerFetch: !isNodeRuntime(),
        }
      : {}),
    ...(config.standardFontDataUrl
      ? {
          standardFontDataUrl: normalizeFactoryUrl(config.standardFontDataUrl),
          useWorkerFetch: !isNodeRuntime(),
        }
      : {}),
  } as Parameters<typeof getDocument>[0];
  const task: PDFDocumentLoadingTask = getDocument(documentOptions);
  let doc: PDFDocumentProxy;
  try {
    doc = await task.promise;
  } catch (error) {
    // A failed load (corrupt file, wrong password) must still release the pdf.js
    // worker it started, or every failed attempt leaks one for the tab's life.
    await task.destroy().catch(() => undefined);
    throw error;
  }

  const entry: CacheEntry = {
    key,
    doc,
    users: 1,
    async destroy() {
      // Destroying the loading task releases the worker too; destroying only
      // the document leaks it until the page unloads.
      await task.destroy().catch(() => undefined);
    },
  };
  if (cache.size >= CACHE_LIMIT) evictOne();
  if (cache.size < CACHE_LIMIT) cache.set(key, entry);

  return {
    doc,
    destroy: async () => {
      // The entry may or may not still be cached; releasing is always correct.
      await release(entry);
    },
  };
}

async function release(entry: CacheEntry): Promise<void> {
  entry.users = Math.max(0, entry.users - 1);
  if (entry.users > 0) return;
  // An uncached entry has nobody to reuse it, so it is torn down now.
  if (cache.get(entry.key) !== entry) {
    await entry.destroy().catch(() => undefined);
  }
}
