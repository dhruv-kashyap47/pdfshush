/**
 * Ad configuration and the gating rules, in one testable place.
 *
 * Everything here is a pure function of build-time config and the current
 * route/plan/consent. The component that renders a unit must not invent its own
 * conditions, because the rules that matter — never on a result screen, never
 * for Pro, never before the plan is known — are exactly the ones that are easy
 * to forget in a JSX branch.
 *
 * Ads are OFF unless `VITE_ADS_ENABLED=true` AND a publisher id is present. An
 * empty or placeholder id is treated as "off", so a half-configured deployment
 * serves no script at all rather than a broken slot.
 */

export type AdPlacement = 'home' | 'tool' | 'article';

export interface AdSlotIds {
  home: string;
  tool: string;
  articleTop: string;
  articleEnd: string;
}

export interface AdConfig {
  enabled: boolean;
  /** `ca-pub-…`. Never invented; empty means no ads. */
  client: string;
  /** Google CMP publication id. Empty means the CMP is not wired. */
  cmpId: string;
  slots: AdSlotIds;
}

export type AdConsent = 'granted' | 'denied' | 'unknown';

interface AdEnv {
  [key: string]: string | boolean | undefined;
  VITE_ADS_ENABLED?: string;
  VITE_ADSENSE_CLIENT?: string;
  VITE_ADSENSE_CMP_ID?: string;
  VITE_ADSENSE_SLOT_HOME?: string;
  VITE_ADSENSE_SLOT_TOOL?: string;
  VITE_ADSENSE_SLOT_ARTICLE_TOP?: string;
  VITE_ADSENSE_SLOT_ARTICLE_END?: string;
}

const PLACEHOLDER = /^ca-pub-0+$/;

export function adConfig(env: AdEnv): AdConfig {
  const client = (env.VITE_ADSENSE_CLIENT ?? '').trim();
  return {
    enabled: env.VITE_ADS_ENABLED === 'true' && client !== '' && !PLACEHOLDER.test(client),
    client,
    cmpId: (env.VITE_ADSENSE_CMP_ID ?? '').trim(),
    slots: {
      home: (env.VITE_ADSENSE_SLOT_HOME ?? '').trim(),
      tool: (env.VITE_ADSENSE_SLOT_TOOL ?? '').trim(),
      articleTop: (env.VITE_ADSENSE_SLOT_ARTICLE_TOP ?? '').trim(),
      articleEnd: (env.VITE_ADSENSE_SLOT_ARTICLE_END ?? '').trim(),
    },
  };
}

/**
 * Which placement a route allows, or `undefined` for "no ads here".
 *
 * An allowlist rather than a blocklist: a new route (checkout, login, an error
 * page) is ad-free by default, which is the direction that cannot go wrong.
 */
export function adPlacementFor(pathname: string): AdPlacement | undefined {
  if (pathname === '/') return 'home';
  if (/^\/tools\/[a-z0-9-]+\/?$/.test(pathname)) return 'tool';
  if (/^\/guides\/[a-z0-9-]+\/?$/.test(pathname)) return 'article';
  return undefined;
}

export function slotIdFor(config: AdConfig, placement: AdPlacement, surface: 'top' | 'end'): string {
  if (placement === 'home') return config.slots.home;
  if (placement === 'tool') return config.slots.tool;
  return surface === 'top' ? config.slots.articleTop : config.slots.articleEnd;
}

export interface AdDecision {
  config: AdConfig;
  pathname: string;
  /** The account plan, once known. `undefined` means the answer has not arrived. */
  plan?: 'free' | 'pro';
  consent: AdConsent;
}

/**
 * Everything except consent: is this slot allowed to exist on this page for this
 * visitor?
 *
 * It is separate from `shouldRenderAd` because of an ordering problem that is
 * easy to miss: the consent state can only become known by loading the CMP, and
 * it would be a deadlock to load the CMP only after consent is granted. The slot
 * uses this to decide whether to *ask*, and `shouldRenderAd` to decide whether to
 * *serve*.
 */
export function adEligible({
  config,
  pathname,
  plan,
}: Pick<AdDecision, 'config' | 'pathname' | 'plan'>): boolean {
  if (!config.enabled) return false;
  if (!config.client) return false;
  if (!adPlacementFor(pathname)) return false;
  // `undefined` while the session is loading: wait rather than flash ads at Pro.
  if (plan === undefined || plan === 'pro') return false;
  return true;
}

/** Whether consent permits an ad request under this configuration. */
export function consentPermits(config: AdConfig, consent: AdConsent): boolean {
  return config.cmpId ? consent === 'granted' : true;
}

/**
 * The single gate. Every false branch is a requirement:
 *
 *  - flag or publisher id missing  → nothing loads at all;
 *  - plan unknown                  → wait, so a Pro user never sees a flash;
 *  - plan pro                      → nothing, not even the script;
 *  - route not allowlisted         → nothing on results, account, status, errors;
 *  - consent denied                → nothing, where a CMP is configured;
 *  - CMP configured but undecided  → wait rather than serve.
 */
export function shouldRenderAd(decision: AdDecision): boolean {
  return adEligible(decision) && consentPermits(decision.config, decision.consent);
}
