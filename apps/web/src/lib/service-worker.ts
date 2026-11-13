/**
 * Service-worker registration, kept out of the render path.
 *
 * Offline support is an enhancement: if registration fails, every tool still
 * works exactly as before. Registration therefore happens after `load`, never
 * competes with first paint, and never surfaces an error dialog.
 *
 * Update policy: a new build installs in the background and **waits**. It is
 * activated only when the user accepts the prompt, because `skipWaiting` on the
 * previous service worker could hand an open tool page assets from two builds.
 */

const SW_URL = '/sw.js';

export interface ServiceWorkerStatus {
  supported: boolean;
  registered: boolean;
  active: boolean;
  waiting: boolean;
  /** True when this page is already served by the worker (offline capable). */
  controlled: boolean;
  scriptUrl?: string;
  scope?: string;
}

/** Set by `registerServiceWorker` so the trust page can await the same attempt. */
let registrationAttempt: Promise<ServiceWorkerRegistration> | null = null;

/**
 * The waiting worker, if any. The update notice is rendered in the page flow by
 * `UpdateBanner`, not as an infinite toast: a toast at the bottom covers real
 * controls on small screens and cannot be dismissed without losing the only
 * convenient path to the update.
 */
let waitingUpdate: ServiceWorkerRegistration | null = null;
const updateListeners = new Set<() => void>();

export function getWaitingServiceWorker(): ServiceWorkerRegistration | null {
  return waitingUpdate;
}

export function subscribeServiceWorkerUpdate(listener: () => void): () => void {
  updateListeners.add(listener);
  return () => {
    updateListeners.delete(listener);
  };
}

function announceWaiting(registration: ServiceWorkerRegistration): void {
  waitingUpdate = registration;
  for (const listener of [...updateListeners]) {
    try {
      listener();
    } catch {
      // One bad subscriber must not hide the update from the others.
    }
  }
}

/**
 * Tells the waiting worker to take over, then reloads once it controls the page.
 * The `controllerchange` listener is registered before the message so a fast
 * activation cannot reload twice or miss the event.
 */
export function activateWaiting(registration: ServiceWorkerRegistration): void {
  const waiting = registration.waiting;
  if (!waiting) {
    window.location.reload();
    return;
  }
  let reloaded = false;
  navigator.serviceWorker.addEventListener(
    'controllerchange',
    () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    },
    { once: true },
  );
  waiting.postMessage({ type: 'SKIP_WAITING' });
}

/** `UpdateBanner`'s action: activate the waiting build, or reload if it vanished. */
export function applyServiceWorkerUpdate(): void {
  if (waitingUpdate) activateWaiting(waitingUpdate);
  else window.location.reload();
}

/**
 * Registers the worker in production builds. Dev is deliberately excluded: the
 * dev server's module graph changes on every edit, and a cache in front of it
 * produces exactly the stale-module bugs this worker is designed to avoid.
 *
 * The registration itself is scheduled for idle time, after the page has had a
 * chance to paint and run its first job. Offline support must not cost a
 * measurable amount of the Q3 tool-ready budget.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  const start = () => {
    registrationAttempt = navigator.serviceWorker.register(SW_URL, {
      scope: '/',
      // Revalidate `sw.js` on every navigation instead of trusting the HTTP
      // cache for up to 24 hours, so a deploy is noticed on the next visit.
      updateViaCache: 'none',
    });

    registrationAttempt
      .then((registration) => {
        if (registration.waiting) announceWaiting(registration);

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state !== 'installed') return;
            // No controller means this is the first install: there is nothing to
            // update away from, so prompting would be noise.
            if (navigator.serviceWorker.controller) announceWaiting(registration);
          });
        });
      })
      .catch((error) => {
        console.warn('[sw] registration failed; tools continue to work online:', error);
      });
  };

  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(start, { timeout: 3_000 });
  } else {
    window.setTimeout(start, 1_000);
  }
}

/** Snapshot for the trust page. Resolves once the registration attempt settles. */
export async function getServiceWorkerStatus(): Promise<ServiceWorkerStatus> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return { supported: false, registered: false, active: false, waiting: false, controlled: false };
  }

  const first = navigator.serviceWorker.controller !== null;
  try {
    const fromAttempt = registrationAttempt ? await registrationAttempt.catch(() => null) : null;
    const registration = fromAttempt ?? (await navigator.serviceWorker.getRegistration('/'));
    return {
      supported: true,
      registered: registration !== undefined && registration !== null,
      active: Boolean(registration?.active),
      waiting: Boolean(registration?.waiting),
      controlled: first || navigator.serviceWorker.controller !== null,
      ...(registration?.active?.scriptURL ? { scriptUrl: registration.active.scriptURL } : {}),
      ...(registration?.scope ? { scope: registration.scope } : {}),
    };
  } catch {
    return { supported: true, registered: false, active: false, waiting: false, controlled: first };
  }
}

/**
 * True only in a build that shipped the worker. The offline e2e suite and the
 * trust page both use this to avoid claiming offline support on the dev server.
 */
export function isOfflineCapableBuild(): boolean {
  return import.meta.env.PROD && typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
}
