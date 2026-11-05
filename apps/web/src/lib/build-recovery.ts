/**
 * Stale-build recovery.
 *
 * A hashed app is only coherent when the HTML and the chunks it references come
 * from the same build. A tab that outlives a deploy can hold an old shell whose
 * CSS or lazy chunks were deleted, which used to surface as an unstyled logo and
 * a route error. These helpers detect that state and fetch a fresh shell once,
 * clearing the old service worker/cache first.
 *
 * The reload is deliberately one-shot per 15 s. Without the guard, a genuinely
 * broken deployment (or an extension blocking a stylesheet) would reload-loop.
 */

const RELOAD_KEY = 'pdfshush-build-recovery';
const RELOAD_WINDOW_MS = 15_000;
const CACHE_PREFIX = 'pdfshush-';

let memoryLastReload = 0;

function readLastReload(): number {
  if (typeof window === 'undefined') return memoryLastReload;
  try {
    return Number(window.sessionStorage.getItem(RELOAD_KEY)) || 0;
  } catch {
    return memoryLastReload;
  }
}

function writeLastReload(value: number): void {
  memoryLastReload = value;
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(RELOAD_KEY, String(value));
  } catch {
    /* private mode / disabled storage: the module-level guard still works */
  }
}

/** True when a failed import or missing stylesheet looks like a build mismatch. */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /failed to fetch dynamically imported module|importing a module script failed|chunkloaderror|loading chunk .* failed/i.test(
    message,
  );
}

/** Returns true once, then refuses to reload again inside the cooldown window. */
export function shouldReloadForStaleBuild(now = Date.now()): boolean {
  const last = readLastReload();
  if (last > 0 && now - last < RELOAD_WINDOW_MS) return false;
  writeLastReload(now);
  return true;
}

/** Drops the worker and the app's own caches so the next request is the new build. */
async function clearBuildCaches(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      const ours = registrations.filter((registration) => {
        const script =
          registration.active?.scriptURL ??
          registration.waiting?.scriptURL ??
          registration.installing?.scriptURL ??
          '';
        try {
          const url = new URL(script);
          return url.origin === window.location.origin && url.pathname === '/sw.js';
        } catch {
          return false;
        }
      });
      await Promise.allSettled(ours.map((registration) => registration.unregister()));
    }
  } catch {
    /* no worker or a browser that refuses the call: the reload still helps */
  }
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.allSettled(
        keys.filter((key) => key.startsWith(CACHE_PREFIX)).map((key) => caches.delete(key)),
      );
    }
  } catch {
    /* cache storage can be unavailable in private contexts */
  }
}

/** Hard reload with a cache-busting parameter, after clearing the old app caches. */
export async function hardReload(): Promise<void> {
  // Clearing the offline shell while offline would turn a recoverable tab into
  // a dead one. Keep the cache when the network is unavailable.
  if (typeof navigator === 'undefined' || navigator.onLine !== false) {
    await clearBuildCaches();
  }
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.set('__build', Date.now().toString(36));
  window.location.replace(url.toString());
}

/** Auto-recovery path: guarded so a real outage cannot reload forever. */
export async function recoverFromStaleBuild(): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  if (!shouldReloadForStaleBuild()) return;
  await hardReload();
}

/** Call once from the entry point, before React renders. */
export function installBuildRecovery(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    void recoverFromStaleBuild();
  });

  window.addEventListener('unhandledrejection', (event) => {
    if (!isChunkLoadError(event.reason)) return;
    event.preventDefault();
    void recoverFromStaleBuild();
  });

  const sameOriginStylesheets = () =>
    [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].filter((link) => {
      try {
        return new URL(link.href, window.location.href).origin === window.location.origin;
      } catch {
        return false;
      }
    });

  /**
   * A missing hashed CSS file is not always a 404. A static server's SPA
   * fallback answers it with `index.html` and a 200, which leaves a stylesheet
   * object with zero rules: the page looks unstyled but no `error` event ever
   * fires. Treat zero rules as a failed stylesheet.
   */
  const stylesheetFailed = (link: HTMLLinkElement): boolean => {
    if (!link.sheet) return true;
    try {
      return link.sheet.cssRules.length === 0;
    } catch {
      // Cross-origin stylesheets hide cssRules; those are not ours to judge.
      return false;
    }
  };

  for (const link of sameOriginStylesheets()) {
    if (!stylesheetFailed(link)) continue;
    link.addEventListener('error', () => void recoverFromStaleBuild(), { once: true });
  }

  window.addEventListener(
    'load',
    () => {
      if (sameOriginStylesheets().some(stylesheetFailed)) void recoverFromStaleBuild();
    },
    { once: true },
  );
}
