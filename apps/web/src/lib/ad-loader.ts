/**
 * Loading the Consent Management Platform and the AdSense script.
 *
 * Both are lazy, both happen at most once, and neither runs until an allowed
 * slot asks for it. The order is fixed: Consent Mode defaults are set first, the
 * CMP is loaded second, and AdSense last — an ad request that fires before
 * consent is the one thing a publisher cannot take back.
 *
 * Every `window.googlefc` call is optional-chained: the CMP is a third-party
 * global whose shape is not ours to guarantee, and a missing method must degrade
 * to "no ad" rather than throw inside a route.
 */

import { adConfig, type AdConsent, type AdConfig } from './ads';

type GoogleFc = {
  callbackQueue?: { push(entry: Record<string, unknown>): void };
  showRevocationMessage?: () => void;
  getConsentData?: () => { consentDecision?: string } | undefined;
};

declare global {
  interface Window {
    adsbygoogle?: unknown[];
    googlefc?: GoogleFc;
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

let configCache: AdConfig | null = null;
let cmpPromise: Promise<void> | null = null;
let scriptPromise: Promise<void> | null = null;
let consent: AdConsent = 'unknown';
const listeners = new Set<(state: AdConsent) => void>();

export function adsConfig(): AdConfig {
  configCache ??= adConfig(import.meta.env);
  return configCache;
}

export function currentConsent(): AdConsent {
  return consent;
}

export function onConsentChange(listener: (state: AdConsent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setConsent(next: AdConsent): void {
  if (next === consent) return;
  consent = next;
  for (const listener of listeners) listener(next);
}

/**
 * Consent Mode v2 defaults, denied. They must be pushed before any Google tag
 * loads, which is why this runs from `initAds` and not from a React effect that
 * could be outrun by the CMP.
 */
function installConsentDefaults(): void {
  if (typeof window === 'undefined') return;
  window.dataLayer ??= [];
  if (!window.gtag) {
    window.gtag = (...args: unknown[]) => {
      window.dataLayer!.push(args);
    };
  }
  window.gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    wait_for_update: 500,
  });
}

function readConsent(): AdConsent {
  const api = window.googlefc;
  if (!api) return 'unknown';
  const data = api.getConsentData?.();
  const decision = data?.consentDecision;
  if (decision === 'CONSENT_GRANTED') return 'granted';
  if (decision === 'CONSENT_DENIED') return 'denied';
  return 'unknown';
}

/**
 * Loads Google's free CMP and resolves when it has made a decision (or when it
 * becomes clear that no decision is coming, e.g. a non-EEA visitor). The
 * `CONSENT_DATA_READY` callback is the documented hook; the timeout is a
 * belt-and-braces guard so a blocked CMP cannot stall the page forever.
 */
export function loadCmp(): Promise<void> {
  const config = adsConfig();
  if (!config.cmpId) {
    // No CMP configured: nothing to ask. Consent stays `unknown`, which the gate
    // permits only because `shouldRenderAd` skips the consent requirement when
    // no CMP exists.
    setConsent('granted');
    return Promise.resolve();
  }

  cmpPromise ??= new Promise<void>((resolve) => {
    installConsentDefaults();

    window.googlefc ??= {};
    window.googlefc.callbackQueue ??= [];
    window.googlefc.callbackQueue.push({
      CONSENT_DATA_READY: () => {
        setConsent(readConsent());
        resolve();
      },
    });

    const script = document.createElement('script');
    script.async = true;
    script.src = `https://fundingchoicesmessages.google.com/i/${config.cmpId}?ers=1`;
    script.onerror = () => resolve();
    document.head.appendChild(script);

    // Google's own guidance: if the callback never fires, proceed rather than
    // blocking the page.
    window.setTimeout(() => resolve(), 4_000);
  });

  return cmpPromise;
}

/** AdSense itself. Called only after the CMP has resolved and a slot is allowed. */
export function loadAdSense(): Promise<void> {
  const config = adsConfig();
  if (!config.enabled || !config.client) return Promise.resolve();

  if (!scriptPromise) {
    scriptPromise = new Promise<void>((resolve, reject) => {
      if (document.querySelector('script[data-pdfshush-adsense]')) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.dataset.pdfshushAdsense = 'true';
      script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(config.client)}`;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('AdSense script failed to load'));
      document.head.appendChild(script);
    });

    // Do not cache a failure: a blocker that is disabled, or a transient network
    // error, would otherwise disable ads for the rest of the session.
    void scriptPromise.catch(() => {
      scriptPromise = null;
    });
  }

  return scriptPromise;
}

/** Re-opens the CMP dialog. Wired to the footer's "Privacy settings" link. */
export function reopenConsent(): void {
  window.googlefc?.showRevocationMessage?.();
}

/** Queues one slot with AdSense. Safe to call repeatedly; AdSense ignores extras. */
export function pushSlot(): void {
  try {
    (window.adsbygoogle ??= []).push({});
  } catch {
    // A slot pushed twice, or a script that has not finished loading. Neither is
    // worth surfacing to a visitor.
  }
}
