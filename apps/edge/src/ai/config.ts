/**
 * Managed AI configuration.
 *
 * OpenRouter is the only integration point, deliberately: one key and one
 * OpenAI-compatible endpoint front a catalogue of models, so changing model is a
 * one-line variable change rather than an adapter. `@pdfshush/ai-provider`
 * already ships a first-class `openrouter` entry (completions at
 * `https://openrouter.ai/api/v1`), so nothing here re-implements a protocol.
 */

import type { AiProviderId } from '@pdfshush/ai-provider';
import type { Env } from '../env.js';

export interface ManagedAiConfig {
  apiKey: string;
  model: string;
  provider: AiProviderId;
  maxOutputTokens: number;
}

const MIN_OUTPUT_TOKENS = 256;
const MAX_OUTPUT_TOKENS = 8_192;

/** Present only when both a key and a model resolve; otherwise AI stays off. */
export function managedAiConfig(env: Env): ManagedAiConfig | undefined {
  const apiKey = env.AI_MANAGED_API_KEY?.trim();
  const model = env.AI_MANAGED_MODEL?.trim();
  if (!apiKey || !model) return undefined;

  const requested = Number.parseInt(env.AI_MANAGED_MAX_OUTPUT_TOKENS ?? '', 10);
  const maxOutputTokens = Number.isFinite(requested)
    ? Math.min(Math.max(requested, MIN_OUTPUT_TOKENS), MAX_OUTPUT_TOKENS)
    : 4_096;

  return {
    apiKey,
    model,
    // An unknown id is a configuration error, and the provider registry throws
    // on it at request time rather than silently falling back to another vendor.
    provider: (env.AI_MANAGED_PROVIDER?.trim() || 'openrouter') as AiProviderId,
    maxOutputTokens,
  };
}
