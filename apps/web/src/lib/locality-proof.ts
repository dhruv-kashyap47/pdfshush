/**
 * The "prove it" runtime assertion behind D1 (PLAN.md §31.4).
 *
 * The claim is narrow enough to be checkable in a browser: a client-side job
 * does not upload the document, and it does not talk to another origin while it
 * runs. So the proof instruments every API a page can use to send data --
 * `fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket`, `EventSource` -- runs a
 * real job, and reports what happened.
 *
 * What this can and cannot see, stated plainly because the page repeats it:
 *  - it sees calls made through those five APIs by this tab, plus the resources
 *    the document itself loads (module chunks, worker scripts, WebAssembly),
 *    read from Resource Timing. A worker's own internal fetches are invisible to
 *    the page; they cannot leave the origin under the production CSP;
 *  - it records a request's body only as a boolean, never its contents, so the
 *    proof itself carries no document data;
 *  - `uploads` counts any request with a body. Zero is the claim. It cannot be
 *    gamed by labelling a POST something else.
 */

import { buildSamplePdf } from '@/lib/sample-pdf';

export type NetworkApi = 'fetch' | 'xhr' | 'beacon' | 'websocket' | 'eventsource';

export interface NetworkEvent {
  api: NetworkApi;
  url: string;
  method: string;
  crossOrigin: boolean;
  /** True when the request carried a body. The body itself is never stored. */
  body: boolean;
}

export interface LocalityProof {
  events: NetworkEvent[];
  /** Every instrumented request made while the job ran. */
  requests: number;
  sameOrigin: number;
  crossOrigin: number;
  /** Requests that carried a body, i.e. every possible document upload. */
  uploads: number;
  /**
   * Resources the browser loaded while the job ran (module chunks, workers,
   * WebAssembly). Read from Resource Timing, which is a different channel from
   * the five patched APIs; together they cover what a page can cause to load.
   */
  resources: number;
  crossOriginResources: number;
  pageCount: number;
  durationMs: number;
}

/**
 * Wraps the browser's network entry points and returns the undo function. All
 * five are restored in a `finally` in the caller, so a failed job cannot leave
 * the page permanently instrumented.
 */
export function instrumentNetwork(events: NetworkEvent[]): () => void {
  const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;

  const record = (api: NetworkApi, rawUrl: string, rawMethod: string, body: boolean): void => {
    const method = rawMethod.toUpperCase();
    let crossOrigin = true;
    try {
      crossOrigin = new URL(rawUrl, origin).origin !== origin;
    } catch {
      // An unparseable URL is still an attempted request; count it as external.
    }
    events.push({ api, url: rawUrl, method, crossOrigin, body });
  };

  const restore: Array<() => void> = [];

  /* ------------------------------------------------------------------ fetch */
  const originalFetch = window.fetch;
  window.fetch = function trackedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method =
      init?.method ?? (input instanceof Request ? input.method : 'GET');
    const hasBody =
      (init?.body !== undefined && init.body !== null) ||
      (input instanceof Request && input.body !== null);
    record('fetch', url, method, hasBody);
    return originalFetch(input, init);
  } as typeof fetch;
  restore.push(() => {
    window.fetch = originalFetch;
  });

  /* -------------------------------------------------------------------- xhr */
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const xhrMeta = new WeakMap<XMLHttpRequest, { url: string; method: string }>();

  XMLHttpRequest.prototype.open = function trackedOpen(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    xhrMeta.set(this, { url: String(url), method: String(method) });
    return (originalOpen as (...args: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof XMLHttpRequest.prototype.open;

  XMLHttpRequest.prototype.send = function trackedSend(
    this: XMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null,
  ) {
    const meta = xhrMeta.get(this);
    if (meta) record('xhr', meta.url, meta.method, body !== undefined && body !== null);
    return originalSend.call(this, body);
  };
  restore.push(() => {
    XMLHttpRequest.prototype.open = originalOpen;
    XMLHttpRequest.prototype.send = originalSend;
  });

  /* ---------------------------------------------------------------- beacon */
  if (typeof navigator.sendBeacon === 'function') {
    const originalBeacon = navigator.sendBeacon;
    navigator.sendBeacon = ((url: string | URL, data?: BodyInit | null) => {
      record('beacon', String(url), 'POST', data !== undefined && data !== null);
      return originalBeacon.call(navigator, url, data);
    }) as typeof navigator.sendBeacon;
    restore.push(() => {
      navigator.sendBeacon = originalBeacon;
    });
  }

  /* ------------------------------------------------------------- websocket */
  if (typeof WebSocket === 'function') {
    const OriginalWebSocket = WebSocket;
    class TrackedWebSocket extends OriginalWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        record('websocket', String(url), 'GET', false);
        super(url, protocols);
      }
    }
    window.WebSocket = TrackedWebSocket as unknown as typeof WebSocket;
    restore.push(() => {
      window.WebSocket = OriginalWebSocket;
    });
  }

  /* ----------------------------------------------------------- eventsource */
  if (typeof EventSource === 'function') {
    const OriginalEventSource = EventSource;
    class TrackedEventSource extends OriginalEventSource {
      constructor(url: string | URL, init?: EventSourceInit) {
        record('eventsource', String(url), 'GET', false);
        super(url, init);
      }
    }
    window.EventSource = TrackedEventSource as unknown as typeof EventSource;
    restore.push(() => {
      window.EventSource = OriginalEventSource;
    });
  }

  return () => {
    for (const undo of restore.reverse()) undo();
  };
}

/** Pure summary, so the arithmetic is testable without a browser. */
export function summarizeNetwork(
  events: NetworkEvent[],
  pageCount: number,
  durationMs: number,
  resources: { crossOrigin: boolean }[] = [],
): LocalityProof {
  const sameOrigin = events.filter((event) => !event.crossOrigin).length;
  return {
    events: [...events],
    requests: events.length,
    sameOrigin,
    crossOrigin: events.length - sameOrigin,
    uploads: events.filter((event) => event.body).length,
    resources: resources.length,
    crossOriginResources: resources.filter((resource) => resource.crossOrigin).length,
    pageCount,
    durationMs: Math.round(durationMs),
  };
}

export interface ProveLocalityOptions {
  /** Bytes to inspect. Defaults to the built-in one-page sample. */
  bytes?: Uint8Array;
  name?: string;
  timeoutMs?: number;
}

/**
 * Runs a real `inspect` job with the network instruments in place. The job is
 * deliberately the cheapest one in the engine: it proves the data path without
 * making the user wait for a rewrite, and it is the same job every tool runs
 * before it touches a document.
 */
export async function proveLocality(options: ProveLocalityOptions = {}): Promise<LocalityProof> {
  const bytes = options.bytes ?? buildSamplePdf();
  const name = options.name ?? 'locality-proof.pdf';
  const events: NetworkEvent[] = [];

  const restore = instrumentNetwork(events);
  const started = performance.now();
  const seenResources = new Set(
    performance.getEntriesByType('resource').map((entry) => `${entry.name}@${entry.startTime}`),
  );
  try {
    // Loaded lazily so the trust page does not pull the worker pool into its
    // initial chunk. The import itself is one of the same-origin requests the
    // proof reports, which is honest: it is the engine loading, not the file.
    const { jobPool } = await import('@/lib/job-pool');
    const result = await jobPool.run<{ documents: { pageCount: number }[] }>(
      'inspect',
      // `jobPool` transfers the buffer to the worker, which detaches it. A copy
      // keeps the caller's bytes usable.
      [{ name, type: 'application/pdf', data: bytes.slice() }],
      {},
      { timeoutMs: options.timeoutMs ?? 30_000 },
    );

    const resources = performance
      .getEntriesByType('resource')
      .filter((entry) => !seenResources.has(`${entry.name}@${entry.startTime}`))
      .map((entry) => ({
        crossOrigin: (() => {
          try {
            return new URL(entry.name).origin !== window.location.origin;
          } catch {
            return true;
          }
        })(),
      }));

    return summarizeNetwork(
      events,
      result.documents[0]?.pageCount ?? 0,
      performance.now() - started,
      resources,
    );
  } finally {
    restore();
  }
}
