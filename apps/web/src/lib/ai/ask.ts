/**
 * One-shot "ask" abstraction.
 *
 * The streaming tools use an `AgentTransport`; the redaction proposal needs a
 * single non-streaming reply. Both BYOK and managed mode can answer one, so this
 * picks the right one and normalizes the failure shape (never throws).
 */

import {
  activeProvider,
  chatForProvider,
  redactSecrets,
  type AiSettings,
} from '@pdfshush/ai-provider/browser';
import { streamManaged } from './managed';

export interface AiAskResult {
  ok: boolean;
  content?: string;
  error?: string;
}

export type AiAsk = (system: string, user: string, signal?: AbortSignal) => Promise<AiAskResult>;

/** The BYOK one-shot: straight to the provider with the user's key. */
export function byokAsk(settings: AiSettings): AiAsk {
  return async (system, user, signal) => {
    const provider = activeProvider(settings);
    const config = settings.providers[provider];
    if (!config) return { ok: false, error: 'No AI provider is configured.' };
    const result = await chatForProvider(provider, config, system, user, signal);
    if (result.ok || !result.error) return result;
    // The streaming path redacts in ./transport; this one-shot path is the
    // other way a provider error reaches the screen, so it must scrub too.
    return { ...result, error: redactSecrets(result.error, config.apiKey) };
  };
}

/** The managed one-shot: consumed from the SSE endpoint, joined into one string. */
export const managedAsk: AiAsk = async (system, user, signal) => {
  let content = '';
  try {
    await streamManaged(
      { system, messages: [{ role: 'user', text: user }], tools: [] },
      { onDelta: (text) => { content += text; } },
      signal,
    );
    return { ok: true, content };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: redactSecrets(message) };
  }
};
