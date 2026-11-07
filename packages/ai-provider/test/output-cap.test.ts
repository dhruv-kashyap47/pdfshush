import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseOutputCapRejection, resetOutputCaps, withOutputCapFallback } from '../src/output-cap'
import { streamForProvider } from '../src/stream'
import { errorResponse, okResponse, sseStream } from './test-utils'

beforeEach(() => resetOutputCaps())
afterEach(() => vi.unstubAllGlobals())

describe('parseOutputCapRejection', () => {
  it('reads the ceiling out of each vendor phrasing', () => {
    expect(
      parseOutputCapRejection(
        'Claude HTTP 400: {"type":"error","error":{"type":"invalid_request_error","message":"max_tokens: 32768 > 8192, which is the maximum allowed number of output tokens for claude-3-5-sonnet-20241022"}}',
        32768,
      ),
    ).toBe(8192)
    expect(
      parseOutputCapRejection(
        'HTTP 400: {"error":{"message":"max_tokens is too large: 32768. This model supports at most 16384 completion tokens, whereas you provided 32768.","param":"max_tokens"}}',
        32768,
      ),
    ).toBe(16384)
    expect(
      parseOutputCapRejection(
        'HTTP 400: {"error":{"message":"Invalid max_tokens value, the valid range of max_tokens is [1, 8192]"}}',
        32768,
      ),
    ).toBe(8192)
    expect(
      parseOutputCapRejection(
        'HTTP 400: {"error":{"message":"max_completion_tokens is too large: 131072. This model supports at most 128,000 completion tokens."}}',
        131072,
      ),
    ).toBe(128000)
  })

  it('ignores unrelated 400s, other statuses, and model-name digits', () => {
    expect(
      parseOutputCapRejection(
        'HTTP 400: {"error":{"message":"Invalid model gpt-4o-2024-08-06"}}',
        32768,
      ),
    ).toBe(null)
    expect(parseOutputCapRejection('HTTP 429: rate limit, max_tokens 8192', 32768)).toBe(null)
    expect(
      parseOutputCapRejection('HTTP 400: max_tokens rejected for gpt-5-2025-08-07', 32768),
    ).toBe(null)
    expect(parseOutputCapRejection('HTTP 400: max_output_tokens must be <= 65536', 32768)).toBe(
      null,
    )
  })
})

describe('cap cache policy', () => {
  it('evicts the oldest entries and keeps the freshest ceiling', async () => {
    const capError = new Error(
      'HTTP 400: {"error":{"message":"max_tokens is too large. This model supports at most 8192 completion tokens."}}',
    )
    const seed = async (i: number): Promise<void> => {
      let first = true
      await withOutputCapFallback(`https://ep${i}.test`, 'm', 100000, async (maxTokens: number) => {
        if (first) {
          first = false
          throw capError
        }
        return maxTokens
      })
    }
    for (let i = 0; i < 600; i += 1) await seed(i)

    // The newest entry survives without a second 400.
    const fresh: number[] = []
    await withOutputCapFallback(`https://ep599.test`, 'm', 100000, async (maxTokens: number) => {
      fresh.push(maxTokens)
      return maxTokens
    })
    expect(fresh).toEqual([8192])

    // The oldest entry was evicted: the retry path runs again from the request.
    const evicted: number[] = []
    await withOutputCapFallback(`https://ep0.test`, 'm', 100000, async (maxTokens: number) => {
      evicted.push(maxTokens)
      if (evicted.length === 1) throw capError
      return maxTokens
    })
    expect(evicted).toEqual([100000, 8192])
  })
})

describe('streamForProvider: output cap fallback', () => {
  const okTurn = () =>
    okResponse(sseStream(['data: {"choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}]}']))
  const rejection = () =>
    errorResponse(
      400,
      '{"error":{"message":"max_tokens is too large: 32768. This model supports at most 16384 completion tokens, whereas you provided 32768."}}',
    )
  const cb = () => ({
    signal: new AbortController().signal,
    onDelta: () => {},
    onToolCall: () => {},
  })
  const bodies = (fetchMock: ReturnType<typeof vi.fn>) =>
    fetchMock.mock.calls.map((call) => JSON.parse((call[1] as RequestInit).body as string))

  it('retries once at the ceiling the provider named and remembers it for the model', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => Promise.resolve(rejection()))
      .mockImplementation(() => Promise.resolve(okTurn()))
    vi.stubGlobal('fetch', fetchMock)
    const config = { apiKey: 'k', model: 'kimi-k3' }
    await streamForProvider('kimi', config, 'sys', [], [], 32768, cb())
    await streamForProvider('kimi', config, 'sys', [], [], 32768, cb())
    const sent = bodies(fetchMock).map((b) => b.max_tokens)
    expect(sent).toEqual([32768, 16384, 16384])
  })

  it('keeps a user cap below the remembered ceiling and isolates models', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => Promise.resolve(rejection()))
      .mockImplementation(() => Promise.resolve(okTurn()))
    vi.stubGlobal('fetch', fetchMock)
    await streamForProvider('kimi', { apiKey: 'k', model: 'kimi-k3' }, 'sys', [], [], 32768, cb())
    await streamForProvider('kimi', { apiKey: 'k', model: 'kimi-k3' }, 'sys', [], [], 4096, cb())
    await streamForProvider('kimi', { apiKey: 'k', model: 'kimi-k4' }, 'sys', [], [], 32768, cb())
    expect(bodies(fetchMock).map((b) => b.max_tokens)).toEqual([32768, 16384, 4096, 32768])
  })

  it('surfaces a 400 that is not about the output cap unchanged', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(errorResponse(400, '{"error":{"message":"Invalid model kimi-k9"}}')),
      )
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      streamForProvider('kimi', { apiKey: 'k', model: 'kimi-k9' }, 'sys', [], [], 32768, cb()),
    ).rejects.toThrow(/HTTP 400/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
