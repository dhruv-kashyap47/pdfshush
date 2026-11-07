/**
 * The service worker's navigation strategy has to keep per-route prerendered
 * HTML correctly keyed: each route builds its own title/canonical/OG tags, so a
 * single `/index.html` cache key would serve the wrong document offline. These
 * tests evaluate the actual emitted worker script with stubbed globals and
 * drive its fetch handler directly.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ORIGIN = 'https://pdfshush.test';

type CacheEntry = { body: string; status: number };

function makeCache(initial: Record<string, CacheEntry> = {}) {
  const entries = new Map(Object.entries(initial));
  return {
    entries,
    async put(key: string | { url: string }, response: Response) {
      // CacheStorage keys a Request/URL/string by URL; the worker puts by path
      // string, so keep both forms normalizable.
      const url = typeof key === 'object' && 'url' in key ? key.url : key;
      entries.set(url.startsWith('/') ? `${ORIGIN}${url}` : url, {
        body: await response.clone().text(),
        status: response.status,
      });
    },
    async match(key: string | { url: string }) {
      const url = typeof key === 'object' && 'url' in key ? key.url : key;
      const entry = entries.get(url.startsWith('/') ? `${ORIGIN}${url}` : url);
      if (!entry) return undefined;
      return new Response(entry.body, { status: entry.status });
    },
  };
}

/** Evaluates the real worker source and returns its fetch event listener. */
async function loadWorker(
  cache: ReturnType<typeof makeCache>,
  fetchImpl: (request: unknown, init?: unknown) => Promise<Response> = async () => {
    throw new Error('network down');
  },
) {
  const source = await readFile(
    fileURLToPath(new URL('../../service-worker.js', import.meta.url)),
    'utf8',
  );
  const listeners = new Map<string, (event: unknown) => void>();
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      listeners.set(type, handler);
    },
    skipWaiting: () => undefined,
    clients: { claim: async () => undefined },
  };
  const evaluate = new Function('self', 'caches', 'fetch', 'Response', source);
  evaluate(self, { open: async () => cache }, fetchImpl, Response);
  const fetchHandler = listeners.get('fetch');
  if (!fetchHandler) throw new Error('the worker did not register a fetch listener');
  return fetchHandler;
}

/** A 200 HTML response, standing in for the prerendered route document. */
const okHtml = (title: string) => new Response(`<!doctype html><title>${title}</title>`, { status: 200 });

/** Drives the handler the way the browser does and captures respondWith. */
function navigationEvent(handler: (event: unknown) => void, path: string): Promise<Response> {
  // TS cannot track the closure assignment, so keep the promise in a holder
  // object whose property is not flow-narrowed.
  const capture = { responded: null as Promise<Response> | null };
  const request = new Request(`${ORIGIN}${path}`, { cache: 'no-store' });
  Reflect.defineProperty(request, 'mode', { value: 'navigate' });
  handler({
    request,
    respondWith: (promise: Promise<Response>) => {
      capture.responded = promise;
    },
  });
  if (!capture.responded) throw new Error('the worker did not respond to the fetch event');
  return capture.responded;
}

describe('service worker navigation caching', () => {
  it('stores a route HTML under the route path, not under /index.html', async () => {
    const cache = makeCache({ [`${ORIGIN}/index.html`]: { body: '<title>Shell</title>', status: 200 } });
    const handler = await loadWorker(cache, async () => okHtml('Merge'));
    const response = await navigationEvent(handler, '/tools/merge-pdf');
    expect(response.status).toBe(200);
    expect(cache.entries.has(`${ORIGIN}/tools/merge-pdf`)).toBe(true);
    // The shell must not be overwritten by a per-route copy.
    expect(cache.entries.get(`${ORIGIN}/index.html`)?.body).toBe('<title>Shell</title>');
  });

  it('caches per route instead of moving every navigation into one key', async () => {
    const cache = makeCache();
    const handler = await loadWorker(cache, async () => okHtml('page'));
    await navigationEvent(handler, '/');
    await navigationEvent(handler, '/tools/merge-pdf');
    await navigationEvent(handler, '/trust');
    expect(cache.entries.has(`${ORIGIN}/`)).toBe(true);
    expect(cache.entries.has(`${ORIGIN}/tools/merge-pdf`)).toBe(true);
    expect(cache.entries.has(`${ORIGIN}/trust`)).toBe(true);
  });

  it('strips the query from the cache key so variants share one entry', async () => {
    const cache = makeCache();
    const handler = await loadWorker(cache, async () => okHtml('page'));
    await navigationEvent(handler, '/tools/protect-pdf?reason=cancelled');
    expect([...cache.entries.keys()]).toEqual([`${ORIGIN}/tools/protect-pdf`]);
  });

  it('serves the visited route offline, and the shell for unvisited routes', async () => {
    const cache = makeCache({
      [`${ORIGIN}/`]: { body: '<title>PDFShush home</title>', status: 200 },
      [`${ORIGIN}/tools/merge-pdf`]: { body: '<title>Merge — merge-pdf</title>', status: 200 },
    });
    const handler = await loadWorker(cache);
    const visited = await navigationEvent(handler, '/tools/merge-pdf');
    expect(await visited.text()).toContain('merge-pdf');
    const shell = await navigationEvent(handler, '/tools/never-visited');
    expect(await shell.text()).toContain('PDFShush home');
  });

  it('answers a fully cold offline navigation with 503, not a hang', async () => {
    const cache = makeCache();
    const handler = await loadWorker(cache);
    const response = await navigationEvent(handler, '/tools/merge-pdf');
    expect(response.status).toBe(503);
  });
});
