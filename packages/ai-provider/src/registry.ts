import { ANTHROPIC_BASE_URL } from './protocols/anthropic'
import { GEMINI_BASE_URL } from './protocols/gemini'
import { AI_PROVIDERS, DEEPSEEK_V41_FLASH } from './providers'
import {
  customProtocolBaseUrl,
  normalizeCustomProfile,
  resolveCustomProfile,
} from './custom-profile'
import { normalizeBaseUrl } from './url-compose'
import { modelHasFixedSampling, modelLacksVision } from './model-heuristics'
import type { AiProviderConfig, AiProviderId, AiProviderMeta } from './types'

/** The shipped model-family guesses live in ./model-heuristics; re-exported for callers. */
export { normalizeBaseUrl } from './url-compose'
export { modelEchoesReasoning, modelHasFixedSampling, modelLacksVision } from './model-heuristics'

/** Wire protocols every provider maps onto. */
export type AiProtocol = 'anthropic' | 'gemini' | 'openai-compatible'

export interface ProviderCapabilities {
  /** How the provider authenticates: a user-supplied API key. */
  auth: 'api-key'
  /** chat models accept image input (declarative; for custom endpoints it is assumed, not known) */
  vision: boolean
}

export interface ResolvedEndpoint {
  protocol: AiProtocol
  baseUrl: string
  /** the endpoint fixes its sampling and rejects a temperature field (Kimi K3: "only 1 is allowed") */
  omitTemperature?: boolean
  /** the endpoint wants the output cap as OpenAI's renamed `max_completion_tokens` (GPT-5.x/o-series 400 on `max_tokens`) */
  useMaxCompletionTokens?: boolean
  /** vendor-specific request fields merged into the chat-completions body */
  bodyExtras?: Record<string, unknown>
  /** id to put on the wire when the vendor spells the configured model differently */
  model?: string
  /** the endpoint wants `reasoning_content` echoed back on assistant tool turns */
  echoReasoning?: boolean
  /** static headers the user's endpoint needs (tenant id, gateway routing key) */
  headers?: Record<string, string>
  /** stream idle budget override for this endpoint (slow local servers need minutes) */
  idleTimeoutMs?: number
  /** the configured model's declared output ceiling, honored over the global cap */
  maxTokens?: number
  /** images may be sent to this endpoint (custom: from the profile, else the heuristic) */
  vision?: boolean
}

export interface ProviderAdapter {
  meta: AiProviderMeta
  capabilities: ProviderCapabilities
  /** pick the wire protocol and base URL for one request (may depend on the configured model) */
  resolveEndpoint(config: AiProviderConfig): ResolvedEndpoint
}

function metaOf(id: AiProviderId): AiProviderMeta {
  return AI_PROVIDERS.find((m) => m.id === id)!
}

/**
 * The direct API 400s on the versioned pool spelling we list (verified
 * 2026-09-21: GET /v1/models serves only `deepseek-flash` and `deepseek-v4-pro`).
 */
const DEEPSEEK_WIRE_IDS: Record<string, string> = { [DEEPSEEK_V41_FLASH]: 'deepseek-flash' }

/** a stored baseUrl overrides the default endpoint (regional mirrors, e.g. api.moonshot.cn vs .ai) */
function fixedEndpoint(
  protocol: AiProtocol,
  baseUrl: string,
  extras?: {
    omitTemperature?: boolean
    useMaxCompletionTokens?: boolean
    bodyExtras?: Record<string, unknown>
  },
) {
  return (config: AiProviderConfig): ResolvedEndpoint => {
    const omit = extras?.omitTemperature || modelHasFixedSampling(config.model)
    return {
      protocol,
      baseUrl: config.baseUrl ? normalizeBaseUrl(config.baseUrl, baseUrl) : baseUrl,
      ...(omit ? { omitTemperature: true } : {}),
      ...(extras?.useMaxCompletionTokens ? { useMaxCompletionTokens: true } : {}),
      ...(extras?.bodyExtras ? { bodyExtras: extras.bodyExtras } : {}),
    }
  }
}

export const AI_PROVIDER_ADAPTERS: Record<AiProviderId, ProviderAdapter> = {
  anthropic: {
    meta: metaOf('anthropic'),
    capabilities: { auth: 'api-key', vision: true },
    resolveEndpoint: fixedEndpoint('anthropic', ANTHROPIC_BASE_URL),
  },
  gemini: {
    meta: metaOf('gemini'),
    capabilities: { auth: 'api-key', vision: true },
    resolveEndpoint: fixedEndpoint('gemini', GEMINI_BASE_URL),
  },
  deepseek: {
    meta: metaOf('deepseek'),
    capabilities: { auth: 'api-key', vision: true },
    resolveEndpoint(config) {
      const wire = DEEPSEEK_WIRE_IDS[config.model]
      // thinking stays on (vendor default); the transcript echoes reasoning_content for tool turns
      return {
        ...fixedEndpoint('openai-compatible', 'https://api.deepseek.com/v1')(config),
        ...(wire ? { model: wire } : {}),
      }
    },
  },
  openai: {
    meta: metaOf('openai'),
    capabilities: { auth: 'api-key', vision: true },
    // every current OpenAI model accepts the renamed field, so it is safe endpoint-wide;
    // other openai-compatible vendors (and the LiteLLM-backed Genspark proxy) still expect `max_tokens`
    resolveEndpoint: fixedEndpoint('openai-compatible', 'https://api.openai.com/v1', {
      useMaxCompletionTokens: true,
    }),
  },
  kimi: {
    meta: metaOf('kimi'),
    capabilities: { auth: 'api-key', vision: true },
    resolveEndpoint: fixedEndpoint('openai-compatible', 'https://api.moonshot.ai/v1', {
      omitTemperature: true,
    }),
  },
  glm: {
    meta: metaOf('glm'),
    capabilities: { auth: 'api-key', vision: false },
    resolveEndpoint: fixedEndpoint('openai-compatible', 'https://open.bigmodel.cn/api/paas/v4'),
  },
  qwen: {
    meta: metaOf('qwen'),
    capabilities: { auth: 'api-key', vision: false },
    resolveEndpoint: fixedEndpoint(
      'openai-compatible',
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
    ),
  },
  doubao: {
    meta: metaOf('doubao'),
    capabilities: { auth: 'api-key', vision: true },
    resolveEndpoint: fixedEndpoint('openai-compatible', 'https://ark.cn-beijing.volces.com/api/v3'),
  },
  mimo: {
    meta: metaOf('mimo'),
    // the V2.6 series is omni-modal: text, image, video and audio in, text out
    capabilities: { auth: 'api-key', vision: true },
    resolveEndpoint: fixedEndpoint('openai-compatible', 'https://api.xiaomimimo.com/v1'),
  },
  hunyuan: {
    meta: metaOf('hunyuan'),
    // conservative: the chat models are documented for text first, so we do not
    // hand them screenshots until a model card says otherwise
    capabilities: { auth: 'api-key', vision: false },
    // mainland TokenHub host; the intl one (tokenhub-intl.tencentcloudmaas.com)
    // is reachable by storing a base URL on this provider
    resolveEndpoint: fixedEndpoint('openai-compatible', 'https://tokenhub.tencentcloudmaas.com/v1'),
  },
  ling: {
    meta: metaOf('ling'),
    capabilities: { auth: 'api-key', vision: true },
    resolveEndpoint: fixedEndpoint('openai-compatible', 'https://api.ant-ling.com/v1'),
  },
  spark: {
    meta: metaOf('spark'),
    capabilities: { auth: 'api-key', vision: false },
    // endpointUrl() appends chat/completions to this documented /v2 base
    resolveEndpoint: fixedEndpoint(
      'openai-compatible',
      'https://maas-api.cn-huabei-1.xf-yun.com/v2',
    ),
  },
  longcat: {
    meta: metaOf('longcat'),
    capabilities: { auth: 'api-key', vision: true },
    resolveEndpoint: fixedEndpoint('openai-compatible', 'https://api.longcat.chat/openai/v1'),
  },
  minimax: {
    meta: metaOf('minimax'),
    capabilities: { auth: 'api-key', vision: true },
    resolveEndpoint: fixedEndpoint('openai-compatible', 'https://api.minimax.io/v1'),
  },
  xai: {
    meta: metaOf('xai'),
    capabilities: { auth: 'api-key', vision: true },
    resolveEndpoint: fixedEndpoint('openai-compatible', 'https://api.x.ai/v1'),
  },
  groq: {
    meta: metaOf('groq'),
    // Conservative on vision: the production catalogue is text-first (gpt-oss
    // took reasoning tool turns, not images), so screenshots never go to it
    // even for vision ids someone types in — the endpoint 400s those it misses.
    capabilities: { auth: 'api-key', vision: false },
    // Groq wants the OpenAI-renamed output cap and answers 400 on plain
    // max_tokens for its newer endpoints (verified against the docs,
    // 2026-10-21).
    resolveEndpoint: fixedEndpoint('openai-compatible', 'https://api.groq.com/openai/v1', {
      useMaxCompletionTokens: true,
    }),
  },
  mistral: {
    meta: metaOf('mistral'),
    capabilities: { auth: 'api-key', vision: false },
    resolveEndpoint: fixedEndpoint('openai-compatible', 'https://api.mistral.ai/v1'),
  },
  openrouter: {
    meta: metaOf('openrouter'),
    capabilities: { auth: 'api-key', vision: true },
    resolveEndpoint: fixedEndpoint('openai-compatible', 'https://openrouter.ai/api/v1'),
  },
  requesty: {
    meta: metaOf('requesty'),
    capabilities: { auth: 'api-key', vision: true },
    // a stored base URL selects a regional router (https://router.eu.requesty.ai/v1 for the EU)
    resolveEndpoint: fixedEndpoint('openai-compatible', 'https://router.requesty.ai/v1'),
  },
  opper: {
    meta: metaOf('opper'),
    capabilities: { auth: 'api-key', vision: true },
    // one chat-completions endpoint for every pool and vendor route; the model id picks it
    resolveEndpoint: fixedEndpoint('openai-compatible', 'https://api.opper.ai/v3/compat'),
  },
  cheaperinference: {
    meta: metaOf('cheaperinference'),
    capabilities: { auth: 'api-key', vision: true },
    // one chat-completions endpoint for every model; the model id picks the lab
    resolveEndpoint: fixedEndpoint('openai-compatible', 'https://api.cheaperinference.com/v1'),
  },
  atlascloud: {
    meta: metaOf('atlascloud'),
    capabilities: { auth: 'api-key', vision: true },
    // one chat-completions endpoint for every lab; the namespaced model id picks it
    resolveEndpoint: fixedEndpoint('openai-compatible', 'https://api.atlascloud.ai/v1'),
  },
  custom: {
    meta: metaOf('custom'),
    capabilities: { auth: 'api-key', vision: true },
    resolveEndpoint(config) {
      if (!config.baseUrl) throw new Error('A custom provider requires a Base URL')
      const profile = normalizeCustomProfile(config.profile)
      // Resolve against the id the user configured: an alias rewrites the wire
      // value but must not hide the declaration that produced it.
      const resolved = resolveCustomProfile(profile, config.model ?? '')
      return {
        protocol: resolved.protocol,
        baseUrl: customProtocolBaseUrl(resolved.protocol, config.baseUrl),
        ...(resolved.omitTemperature ? { omitTemperature: true } : {}),
        ...(resolved.useMaxCompletionTokens ? { useMaxCompletionTokens: true } : {}),
        ...(resolved.echoReasoning !== undefined ? { echoReasoning: resolved.echoReasoning } : {}),
        ...(resolved.bodyExtras ? { bodyExtras: resolved.bodyExtras } : {}),
        ...(resolved.wireModel ? { model: resolved.wireModel } : {}),
        ...(resolved.headers ? { headers: resolved.headers } : {}),
        ...(resolved.idleTimeoutMs !== undefined ? { idleTimeoutMs: resolved.idleTimeoutMs } : {}),
        ...(resolved.maxTokens !== undefined ? { maxTokens: resolved.maxTokens } : {}),
        ...(resolved.vision !== undefined ? { vision: resolved.vision } : {}),
      }
    },
  },
}

/** Throws on ids not in the registry — settings files are user data and can carry anything. */
export function getProviderAdapter(provider: AiProviderId): ProviderAdapter {
  const adapter = AI_PROVIDER_ADAPTERS[provider]
  if (!adapter) throw new Error(`Unknown provider: ${provider}`)
  return adapter
}

/**
 * Whether images may be sent to the active provider's configured model.
 *
 * A custom endpoint answers from its declared profile when it carries one
 * (the whole point: the user knows what their server takes, the shipped
 * heuristics do not); otherwise the provider capability plus the text-only
 * model list decide, exactly as before. Anything the registry rejects — an
 * unknown provider id in a hand-edited file — is treated as text-only, the
 * same conservative answer callers made before profiles existed.
 */
export function endpointSupportsVision(settings: {
  provider: AiProviderId
  providers?: Partial<Record<AiProviderId, AiProviderConfig>> | undefined
}): boolean {
  try {
    const adapter = getProviderAdapter(settings.provider)
    if (!adapter.capabilities.vision) return false
    const config = settings.providers?.[settings.provider]
    if (!config) return false
    return adapter.resolveEndpoint(config).vision ?? !modelLacksVision(config.model)
  } catch {
    return false
  }
}
