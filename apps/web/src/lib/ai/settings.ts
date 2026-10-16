/**
 * BYOK AI settings.
 *
 * The API key never leaves the device: the tab talks to the provider directly
 * (see ./transport). Where the settings live, how they are validated, and how
 * the key is kept out of everything else is ./storage's job — this module is the
 * synchronous face the components use.
 */

import {
  activeProvider,
  AI_PROVIDERS,
  defaultAiSettings,
  type AiProviderId,
  type AiSettings,
} from '@pdfshush/ai-provider/browser';
import { aiState, forgetAiKey, hydrateAiState, setAiState, type AiState } from './storage';

/** The settings this session is using (defaults until hydrated). */
export function loadAiSettings(): AiSettings {
  return aiState().settings;
}

/** Sanitize and persist; returns the cleaned settings the caller should hold. */
export function saveAiSettings(settings: AiSettings): AiSettings {
  return setAiState({ settings }).settings;
}

/** Drop the stored credentials (and the trial choice) and return to defaults. */
export async function clearAiSettings(): Promise<AiSettings> {
  return (await forgetAiKey()).settings;
}

/**
 * Load the stored AI state once at startup. Callers adopt both halves, so the
 * mode and the settings can never come from different generations of the record.
 */
export function loadAiState(): Promise<AiState> {
  return hydrateAiState();
}

/**
 * Whether any provider slot holds a key worth erasing. Used by the settings
 * card's "forget key" affordance, which must appear even when the *active*
 * provider is a keyless local endpoint.
 */
export function storedKeyPresent(settings: AiSettings): boolean {
  return Object.values(settings.providers).some((config) => Boolean(config?.apiKey?.trim()));
}

/** Whether a specific provider slot is complete enough to issue a request. */
export function providerUsable(settings: AiSettings, id: AiProviderId): boolean {
  const meta = AI_PROVIDERS.find((m) => m.id === id);
  const config = settings.providers[id];
  if (!meta || !config) return false;
  if (!config.model?.trim()) return false;
  // Custom/self-hosted endpoints accept anonymous requests; everything else needs a key.
  if (meta.needsBaseUrl) return Boolean(config.baseUrl?.trim());
  return Boolean(config.apiKey?.trim());
}

/**
 * Scrub a secret (and anything that looks like a bearer token) out of a message
 * before it is shown or logged.
 *
 * The implementation lives in `@pdfshush/ai-provider` because it is pure,
 * dependency-free logic that both runtimes need — the browser (BYOK) and the
 * API's managed gateway — and because a package is where it can be unit-tested
 * (`apps/web` has no runner of its own). Re-exported here so the existing
 * `./settings` import site keeps working.
 */
export { redactSecrets } from '@pdfshush/ai-provider/browser';

/** The provider the next request would use (falls back to a sane default). */
export function resolvedProvider(settings: AiSettings): AiProviderId {
  return activeProvider(settings);
}

/** A provider's default settings, for copy and reset affordances. */
export const defaultSettings = defaultAiSettings;

/** True when a request can actually be sent right now. */
export function aiReady(settings: AiSettings): boolean {
  return providerUsable(settings, activeProvider(settings));
}
