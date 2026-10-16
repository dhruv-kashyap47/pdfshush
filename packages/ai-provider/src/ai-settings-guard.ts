/**
 * Schema check for user-supplied AI settings before they are persisted or
 * acted on. In the donor this ran in an Electron main process; here it guards
 * both the browser's local settings store and the settings the client sends
 * back to the server in managed mode, so a hand-edited file or a tampered
 * payload can neither plant a base URL that would receive a key nor smuggle an
 * unbounded string into a request. Dependency-free so it runs in any runtime.
 *
 * Coercion follows the donor's house style (String() narrowing, bounded
 * lengths, drop-what-is-invalid).
 */
import { normalizeCustomProfile } from './custom-profile'
import { AI_PROVIDER_ADAPTERS, normalizeBaseUrl } from './registry'
import type {
  AiCustomEndpoint,
  AiCustomProfile,
  AiProviderConfig,
  AiProviderId,
  AiSettings,
} from './types'

const PROVIDER_IDS = Object.keys(AI_PROVIDER_ADAPTERS) as AiProviderId[]

const MAX_API_KEY_LENGTH = 8192
const MAX_MODEL_LENGTH = 256
const MAX_ENDPOINT_ID_LENGTH = 64
const MAX_ENDPOINT_NAME_LENGTH = 128
const MAX_ENDPOINT_MODELS = 2000

/** http(s) URL with no embedded credentials, normalized like request time. */
function sanitizeBaseUrl(raw: unknown): string | undefined {
  try {
    return normalizeBaseUrl(typeof raw === 'string' ? raw : '', '')
  } catch {
    return undefined
  }
}

function sanitizeProviderConfig(input: unknown): AiProviderConfig {
  const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  const config: AiProviderConfig = {
    apiKey: String(raw.apiKey ?? '').slice(0, MAX_API_KEY_LENGTH),
    model: String(raw.model ?? '').slice(0, MAX_MODEL_LENGTH),
  }
  if (raw.baseUrl !== undefined && raw.baseUrl !== null && raw.baseUrl !== '') {
    const baseUrl = sanitizeBaseUrl(raw.baseUrl)
    if (baseUrl !== undefined) config.baseUrl = baseUrl
  }
  // A custom slot may carry a nested profile; normalizeCustomProfile bounds every
  // field (protocol, headers via the HTTP-legality gate, sizes) and drops the rest.
  const profile = normalizeCustomProfile(raw.profile)
  if (profile !== undefined) config.profile = profile
  return config
}

function sanitizeMediaSettings(raw: Record<string, unknown>): AiSettings['media'] {
  const media = { ...raw } as unknown as NonNullable<AiSettings['media']>
  if (typeof raw.providers !== 'object' || raw.providers === null || Array.isArray(raw.providers)) {
    return media
  }
  const providers: Record<string, unknown> = {}
  for (const [id, value] of Object.entries(raw.providers as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
    const config = { ...(value as Record<string, unknown>) }
    if (config.baseUrl !== undefined && config.baseUrl !== null && config.baseUrl !== '') {
      const baseUrl = sanitizeBaseUrl(config.baseUrl)
      if (baseUrl === undefined) delete config.baseUrl
      else config.baseUrl = baseUrl
    } else {
      delete config.baseUrl
    }
    providers[id] = config
  }
  media.providers = providers as NonNullable<AiSettings['media']>['providers']
  return media
}

function sanitizeCustomEndpoints(raw: unknown): AiCustomEndpoint[] {
  if (!Array.isArray(raw)) return []
  const out: AiCustomEndpoint[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
    const e = entry as Record<string, unknown>
    const id = String(e.id ?? '')
      .trim()
      .slice(0, MAX_ENDPOINT_ID_LENGTH)
    if (!id) continue
    const config = sanitizeProviderConfig(e)
    const models = Array.isArray(e.models)
      ? e.models
          .filter((m): m is string => typeof m === 'string')
          .slice(0, MAX_ENDPOINT_MODELS)
          .map((m) => m.slice(0, MAX_MODEL_LENGTH))
      : undefined
    // A stored entry carries its profile flat (api/headers/compat/… beside the
    // identity fields); the nested `profile` form is normalized too, so a
    // hand-edited file in either shape survives the gate.
    const flat = normalizeCustomProfile(e) ?? {}
    const nested: AiCustomProfile = config.profile ?? {}
    const profile: AiCustomProfile = { ...flat, ...nested }
    const endpoint: AiCustomEndpoint = {
      id,
      name: String(e.name ?? '').slice(0, MAX_ENDPOINT_NAME_LENGTH),
      baseUrl: config.baseUrl ?? '',
      apiKey: config.apiKey,
      model: config.model,
      ...(models && models.length > 0 ? { models } : {}),
    }
    for (const key of [
      'api',
      'apiKeyEnv',
      'headers',
      'idleTimeoutMs',
      'compat',
      'bodyExtras',
      'modelProfiles',
      'probedProfiles',
    ] as const) {
      if (profile[key] !== undefined) {
        ;(endpoint as unknown as Record<string, unknown>)[key] = profile[key]
      }
    }
    out.push(endpoint)
  }
  return out
}

/**
 * Returns a sanitized copy of `input`, or null when the payload is not even
 * the right shape (non-object, unknown provider). Invalid individual fields
 * are dropped rather than rejecting the whole payload, so a half-filled
 * provider config cannot brick the rest of the settings.
 */
export function sanitizeAiSettings(input: unknown): AiSettings | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null
  const raw = input as Record<string, unknown>
  const provider = raw.provider
  if (typeof provider !== 'string' || !PROVIDER_IDS.includes(provider as AiProviderId)) return null
  if (typeof raw.providers !== 'object' || raw.providers === null || Array.isArray(raw.providers)) {
    return null
  }
  const providers = {} as AiSettings['providers']
  for (const [id, config] of Object.entries(raw.providers as Record<string, unknown>)) {
    if (!PROVIDER_IDS.includes(id as AiProviderId)) continue
    ;(providers as Record<string, AiProviderConfig>)[id] = sanitizeProviderConfig(config)
  }
  const settings: AiSettings = {
    provider: provider as AiProviderId,
    providers,
  }
  if (typeof raw.gskToolsEnabled === 'boolean') settings.gskToolsEnabled = raw.gskToolsEnabled
  const customEndpoints = sanitizeCustomEndpoints(raw.customEndpoints)
  if (customEndpoints.length > 0) {
    settings.customEndpoints = customEndpoints
    if (typeof raw.customEndpoint === 'string') {
      settings.customEndpoint = raw.customEndpoint.slice(0, MAX_ENDPOINT_ID_LENGTH)
    }
  }
  if (
    typeof raw.maxOutputTokens === 'number' &&
    Number.isFinite(raw.maxOutputTokens) &&
    raw.maxOutputTokens > 0
  ) {
    settings.maxOutputTokens = Math.floor(raw.maxOutputTokens)
  }
  // media providers carry a baseUrl that receives their api key: same gate as
  // the chat providers; search carries only enums and api keys
  if (typeof raw.media === 'object' && raw.media !== null && !Array.isArray(raw.media)) {
    settings.media = sanitizeMediaSettings(raw.media as Record<string, unknown>)
  }
  if (typeof raw.search === 'object' && raw.search !== null && !Array.isArray(raw.search)) {
    settings.search = raw.search as AiSettings['search']
  }
  return settings
}
