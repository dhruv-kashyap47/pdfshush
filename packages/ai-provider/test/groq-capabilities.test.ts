import { afterEach, describe, expect, it, vi } from 'vitest'
import { AI_PROVIDERS, defaultAiSettings, resolveAiSettings } from '../src/providers'
import { AI_PROVIDER_ADAPTERS, endpointSupportsVision, getProviderAdapter } from '../src/registry'
import { streamForProvider } from '../src/stream'
import type { AiSettings } from '../src/types'
import { okResponse, sseStream } from './test-utils'

afterEach(() => {
  vi.unstubAllGlobals()
})

const groqSettings = (model: string): AiSettings => {
  const settings = resolveAiSettings(undefined, defaultAiSettings())
  settings.provider = 'groq'
  settings.providers.groq = { apiKey: 'gsk_test', model }
  return settings
}

const stubCompletion = () => {
  const fetchMock = vi.fn(
    async () =>
      okResponse(
        sseStream([
          'data: {"id":"1","choices":[{"delta":{"content":"hello"}}]}',
          'data: {"id":"1","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}',
          'data: [DONE]',
        ]),
      ),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('Groq provider registration', () => {
  it('is listed with the current production catalogue and a free-tier tag', () => {
    const meta = AI_PROVIDERS.find((m) => m.id === 'groq')!
    expect(meta.label).toBe('Groq')
    expect(meta.keyPlaceholder).toBe('gsk_...')
    expect(meta.tier).toBe('free')
    expect(meta.models).toContain('openai/gpt-oss-120b')
    expect(meta.models).toContain('llama-3.1-8b-instant')
    expect(meta.defaultModel).toBe('openai/gpt-oss-120b')
  })

  it('resolves onto the GroqCloud OpenAI-compatible endpoint', () => {
    const endpoint = getProviderAdapter('groq').resolveEndpoint({
      apiKey: 'gsk_test',
      model: 'openai/gpt-oss-120b',
    })
    expect(endpoint.protocol).toBe('openai-compatible')
    expect(endpoint.baseUrl).toBe('https://api.groq.com/openai/v1')
    expect(endpoint.useMaxCompletionTokens).toBe(true)
    expect(endpoint.omitTemperature).toBeUndefined()
  })

  it('honours a stored regional base URL', () => {
    const endpoint = getProviderAdapter('groq').resolveEndpoint({
      apiKey: 'gsk_test',
      model: 'llama-3.1-8b-instant',
      baseUrl: 'https://proxy.example.com/openai/v1',
    })
    expect(endpoint.baseUrl).toBe('https://proxy.example.com/openai/v1')
  })

  it('is registered for streaming and never receives screenshots', () => {
    expect(AI_PROVIDER_ADAPTERS['groq'].capabilities.vision).toBe(false)
    expect(
      endpointSupportsVision({ provider: 'groq', providers: { groq: { apiKey: 'k', model: 'openai/gpt-oss-120b' } } }),
    ).toBe(false)
  })

  it('a fresh settings file keeps its own default provider and carries an empty Groq key', () => {
    const settings = resolveAiSettings(undefined, defaultAiSettings())
    expect(settings.provider).toBe('openai')
    expect(settings.providers.groq).toMatchObject({ apiKey: '', model: 'openai/gpt-oss-120b' })
  })

  it('streams a chat turn as max_completion_tokens against /chat/completions', async () => {
    const fetchMock = stubCompletion()
    const chunks: string[] = []
    await streamForProvider(
      'groq',
      { apiKey: 'gsk_test', model: 'openai/gpt-oss-120b' },
      'You help with PDFs.',
      [{ role: 'user', text: 'Summarize this.' }],
      [],
      4096,
      { signal: new AbortController().signal, onDelta: (text) => chunks.push(text), onToolCall: () => {} },
    )
    expect(chunks.join('')).toBe('hello')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer gsk_test' })
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('openai/gpt-oss-120b')
    expect(body.max_completion_tokens).toBe(4096)
    expect(body.max_tokens).toBeUndefined()
  })
})
