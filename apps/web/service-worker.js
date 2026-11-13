/**
 * pdfshush service worker.
 *
 * This file is not served as-is: `vite.config.ts` replaces the build-id
 * placeholder with a hash of the emitted asset names and writes the result to
 * `/sw.js`. The build id
 * is the cache version, so a deploy that changes any chunk installs a fresh
 * cache and deletes the old one. A stale engine can never be served under a new
 * build, which is the correctness risk PWA caching usually introduces.
 *
 * What it caches, and why:
 *  - the shell: the prerendered per-route HTML pages (each keyed by its own
 *    path, so title, canonical and OG tags stay correct offline);
 *  - hashed assets under `/assets/` so a tool you have already opened keeps
 *    working offline, including its worker and WebAssembly;
 *  - the manifest and icons so the installed app still looks like itself.
 *
 * What it deliberately does not touch:
 *  - `/api/*` and any non-GET request: server state is never cached and never
 *    replayed offline;
 *  - cross-origin requests: AI provider traffic and everything else outside
 *    this origin passes straight through, so the service worker cannot become a
 *    proxy for document data.
 *
 * Navigation is network-first (a deploy is picked up immediately), everything
 * else is cache-first (the hashed name is the content hash). The cache list is
 * bounded by that same build id, not by an eviction policy that could silently
 * drop the one worker the current page needs.
 */

const BUILD_ID = '__BUILD_ID__';
const CACHE_PREFIX = 'pdfshush-shell-';
const CACHE = `${CACHE_PREFIX}${BUILD_ID}`;

/** Small, stable shell. Hashed assets are cached on first use instead. */
const PRECACHE = [
  '/',
  '/index.html',
  '/favicon.svg',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Add one by one: `addAll` rejects the whole install when a single URL is
      // missing (an icon renamed in a hurry would disable offline entirely).
      await Promise.all(
        PRECACHE.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: 'reload' }));
          } catch {
            /* A missing optional shell file must not fail the install. */
          }
        }),
      );
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
          .map((key) => caches.delete(key)),
      );
      // Take over open tabs on the first install so the page that registered
      // this worker is controlled without a mandatory reload.
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  // Sent by the page when the user accepts the "new version ready" prompt.
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/** Same-origin, immutable build output that is safe to cache by URL. */
function isCacheableAsset(url) {
  if (url.origin !== self.location.origin) return false;
  return (
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/icons/') ||
    // The OCR language model: same-origin, versioned by the dependency, and
    // ~11 MB, so a reload must not fetch it again.
    url.pathname.startsWith('/tessdata/') ||
    url.pathname === '/favicon.svg' ||
    url.pathname === '/manifest.webmanifest'
  );
}

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // A service worker must never intercept a document upload. Only GET is
  // cacheable; everything else goes to the network untouched.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Cross-origin (AI providers, anything else) and the API are not ours to
  // cache or replay. Passing them through also keeps `/api` failing honestly
  // when offline instead of returning a stale response.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (isCacheableAsset(url)) {
    event.respondWith(cacheFirst(request));
  }
});

/**
 * Network-first for navigations. A successful response replaces the cached
 * copy for that route, so returning online after an offline session picks up
 * the deploy without waiting for the next service-worker update.
 *
 * The cache key is the navigation's path with the query and hash stripped: the
 * build prerenders per-route HTML (each with its own title, canonical and OG
 * tags), so storing every route under one `/index.html` key would serve the
 * wrong document offline. `/index.html` remains the fallback for routes the
 * user never visited online.
 */
function navigationCacheKey(request) {
  const url = new URL(request.url);
  return `${url.origin}${url.pathname}`;
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE);
  const url = new URL(request.url);
  try {
    // `no-store` matters on a deploy: a route HTML cached by the browser can
    // point at hashed assets the new build deleted. Always ask the network;
    // the cache remains the offline fallback.
    const response = await fetch(request, { cache: 'no-store' });
    if (response && response.ok) {
      await cache.put(navigationCacheKey(request), response.clone());
    }
    return response;
  } catch {
    const cached =
      (await cache.match(request)) ??
      (await cache.match(`${url.origin}${url.pathname}`)) ??
      (await cache.match('/index.html')) ??
      (await cache.match('/'));
    if (cached) return cached;
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>Offline</title><body style="font-family:system-ui;padding:3rem"><h1>Not available offline</h1><p>Open this tool once while online, then it will work with the network off.</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response && response.ok) {
    await cache.put(request, response.clone());
  }
  return response;
}
