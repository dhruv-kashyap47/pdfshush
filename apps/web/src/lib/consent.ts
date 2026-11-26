/**
 * Analytics consent.
 *
 * The site ships exactly one third-party script: a Google Tag Manager
 * container that counts page views. It never sees a document, a filename or a
 * job result, and no tool depends on it. It does set cookies, so a visitor in
 * the EEA or the UK has to opt in before it loads.
 *
 * There is no geo lookup and no request: the region test is the browser's own
 * IANA time zone, which is how Chrome, Firefox and Safari label "a European
 * city". It is deliberately conservative. A visitor whose clock is set to
 * Berlin is asked even if they are in New York for the week, and an unknown
 * zone is treated as European rather than assumed safe.
 *
 * The container is loaded from JavaScript rather than a static `<script>` tag
 * in `index.html`, because a tag in the HTML runs before any consent decision
 * can be read.
 */

export const ANALYTICS_CONTAINER_ID = 'GTM-W5QPVR3Z';
export const CONSENT_STORAGE_KEY = 'pdfshush.analytics-consent';
export const CONSENT_OPEN_EVENT = 'pdfshush:consent-open';

export type ConsentChoice = 'granted' | 'denied';
export type MeasurementDecision = 'load' | 'ask' | 'skip';

/**
 * Zones that belong to the EEA, the UK or Switzerland, plus the European
 * islands whose clocks are usually reported under an Atlantic name. `Europe/`
 * covers the continent including the UK, Ireland, Switzerland, Norway, Iceland
 * is listed separately because its zone is `Atlantic/Reykjavik`.
 */
const CONSENT_REQUIRED_ZONES: ReadonlySet<string> = new Set([
  'Atlantic/Canary',
  'Atlantic/Faroe',
  'Atlantic/Madeira',
  'Atlantic/Reykjavik',
  'Arctic/Longyearbyen',
  'Africa/Ceuta',
  'Asia/Nicosia',
  'Asia/Famagusta',
]);

const CONSENT_REQUIRED_PREFIXES = ['Europe/'] as const;

/** Minimal storage surface, so this module stays testable without a DOM. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * True when the visitor's clock names a European city. An unknown or empty zone
 * is treated as requiring consent: asking is the failure mode that cannot
 * break the law.
 */
export function requiresConsent(timeZone: string | null | undefined): boolean {
  if (!timeZone) return true;
  if (CONSENT_REQUIRED_ZONES.has(timeZone)) return true;
  return CONSENT_REQUIRED_PREFIXES.some((prefix) => timeZone.startsWith(prefix));
}

/** The stored choice, or null when the visitor has not answered yet. */
export function readChoice(storage: StorageLike | null | undefined): ConsentChoice | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(CONSENT_STORAGE_KEY);
  } catch {
    return null;
  }
  return raw === 'granted' || raw === 'denied' ? raw : null;
}

export function writeChoice(
  choice: ConsentChoice,
  storage: StorageLike | null | undefined,
): void {
  if (!storage) return;
  try {
    storage.setItem(CONSENT_STORAGE_KEY, choice);
  } catch {
    /* Private mode with storage disabled: the choice applies to this page. */
  }
}

/**
 * What to do on page load. Rest-of-world visitors are measured without asking,
 * which keeps the site's own numbers usable; they can still opt out from the
 * footer. EEA/UK visitors are only measured after they say yes.
 */
export function decideMeasurement(input: {
  choice: ConsentChoice | null;
  timeZone: string | null | undefined;
}): MeasurementDecision {
  if (input.choice === 'granted') return 'load';
  if (input.choice === 'denied') return 'skip';
  return requiresConsent(input.timeZone) ? 'ask' : 'load';
}

export function gtmScriptUrl(): string {
  return `https://www.googletagmanager.com/gtm.js?id=${ANALYTICS_CONTAINER_ID}`;
}

let loaded = false;

/** True once this page has injected the container. A revoke needs a reload. */
export function analyticsLoaded(): boolean {
  return loaded;
}

/**
 * Inject the container once. Idempotent: React StrictMode mounts effects twice
 * in development, and a second script tag would double every page view.
 */
export function loadAnalytics(doc: Document | null | undefined = globalThis.document): boolean {
  if (loaded) return true;
  if (!doc) return false;
  if (doc.querySelector('script[data-analytics="gtm"]')) {
    loaded = true;
    return true;
  }

  const view = doc.defaultView as (Window & { dataLayer?: unknown[] }) | null;
  if (!view) return false;

  view.dataLayer = view.dataLayer ?? [];
  view.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });

  const script = doc.createElement('script');
  script.async = true;
  script.src = gtmScriptUrl();
  script.dataset.analytics = 'gtm';
  doc.head.appendChild(script);

  loaded = true;
  return true;
}

/** Open the consent panel from anywhere (the footer link uses this). */
export function openConsentSettings(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(CONSENT_OPEN_EVENT));
}

export function onOpenConsentSettings(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(CONSENT_OPEN_EVENT, listener);
  return () => window.removeEventListener(CONSENT_OPEN_EVENT, listener);
}

/** The browser's zone, or null where `Intl` is unavailable. */
export function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

/**
 * Playwright, Selenium and headless Chrome set `navigator.webdriver`. Automated
 * visits are not people, they are not who measurement is for, and a benchmark
 * must not pay for a third-party script's execution while it measures the
 * product's own work. So: no tag and no prompt in automation.
 */
export function isAutomatedBrowser(
  nav: { webdriver?: boolean } | null | undefined = globalThis.navigator,
): boolean {
  return Boolean(nav?.webdriver);
}

/** `localStorage`, or null where it throws (some private-mode browsers). */
export function browserStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
