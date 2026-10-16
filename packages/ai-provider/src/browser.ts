/**
 * Browser-safe entry point. Everything reachable from here must run in a
 * renderer: no Node built-ins, no process.env. This is the surface the web app
 * imports for BYOK (the browser talks to the provider directly, key in tow).
 */
export type {
  AiChatResponse,
  AiCustomCompat,
  AiCustomEndpoint,
  AiCustomModelProfile,
  AiCustomProfile,
  AiCustomProtocol,
  AiProviderConfig,
  AiProviderId,
  AiProviderMeta,
  AiSettings,
  AiStreamChunk,
  AiTokenUsage,
  LegacyAiSettings,
} from './types'
export {
  AI_PROVIDERS,
  DEFAULT_AI_PROVIDER,
  activeProvider,
  cloudToolsEnabled,
  DEFAULT_MAX_OUTPUT_TOKENS,
  MAX_MAX_OUTPUT_TOKENS,
  MIN_MAX_OUTPUT_TOKENS,
  clampMaxOutputTokens,
  defaultAiSettings,
  maxOutputTokensOf,
  resolveAiSettings,
} from './providers'
export {
  activeCustomEndpoint,
  customEndpointLabel,
  newCustomEndpointId,
  removeCustomEndpoint,
  resolveCustomEndpoints,
  selectCustomEndpoint,
  upsertCustomEndpoint,
} from './custom-endpoints'
export {
  AI_CUSTOM_PROTOCOLS,
  declaredModelProfile,
  normalizeCustomProfile,
  resolveCustomProfile,
} from './custom-profile'
export type { ResolvedCustomProfile } from './custom-profile'
export {
  AI_PROVIDER_ADAPTERS,
  endpointSupportsVision,
  getProviderAdapter,
  modelLacksVision,
  normalizeBaseUrl,
} from './registry'
export type { AiProtocol, ProviderAdapter, ProviderCapabilities, ResolvedEndpoint } from './registry'
export { sanitizeAiSettings } from './ai-settings-guard'
export { chatForProvider } from './chat'
export { streamForProvider } from './stream'
export type { StreamCallbacks } from './stream'
export { isAiNetworkError } from './network-error'
export { isAiOverloadedError } from './overload-error'
export {
  AI_CHAT_RESPONSE_TIMEOUT_MS,
  AI_CONNECT_TIMEOUT_MS,
  AI_IDLE_TIMEOUT_MS,
  AiTimeoutError,
} from './watchdog'
