/**
 * `public-hygiene: fixture` — every key-shaped string below is synthetic and
 * exists only to prove the scrubber catches it. None is a real credential; the
 * marker keeps the pre-push secret grep from reading them as one.
 */
import { describe, expect, it } from 'vitest'
import { REDACTED, redactSecrets } from '../src/redact-secrets'

describe('redactSecrets', () => {
  it('removes the exact secret in hand, whatever its shape', () => {
    const key = 'zQ8~weird+shaped/secret=with.punct'
    expect(redactSecrets(`HTTP 401 from provider: ${key} rejected`, key)).toBe(
      `HTTP 401 from provider: ${REDACTED} rejected`,
    )
  })

  it('removes every occurrence of the exact secret', () => {
    const key = 'gsk_0123456789abcdef'
    expect(redactSecrets(`sent ${key} then echoed ${key}`, key)).toBe(
      `sent ${REDACTED} then echoed ${REDACTED}`,
    )
  })

  it('ignores a secret too short to distinguish from an ordinary word', () => {
    expect(redactSecrets('the cat sat on the mat', 'cat')).toBe('the cat sat on the mat')
  })

  it('scrubs the key prefixes this app actually ships', () => {
    const cases: [string, string][] = [
      ['use sk-abcdef1234567890abcdef', `use ${REDACTED}`],
      ['sk_live_51H8xYzAbCdEfGhIjKl', REDACTED],
      ['gsk_0123456789abcdef', REDACTED],
      ['xai-0123456789abcdef', REDACTED],
      ['ci_live_0123456789abcdef', REDACTED],
      ['ak-0123456789abcdef', REDACTED],
      ['apikey-0123456789abcdef', REDACTED],
      ['api-key-0123456789abcdef', REDACTED],
    ]
    for (const [input, expected] of cases) expect(redactSecrets(input)).toBe(expected)
  })

  it('scrubs an Authorization-header echo', () => {
    expect(redactSecrets('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc123')).toBe(
      `Authorization: Bearer ${REDACTED}`,
    )
    expect(redactSecrets('header was Basic dXNlcjpwYXNzd29yZA==')).toBe(
      `header was Basic ${REDACTED}`,
    )
  })

  it('scrubs vendor-shaped keys with no separator', () => {
    expect(redactSecrets('key AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q')).toBe(
      `key ${REDACTED}`,
    )
    expect(redactSecrets('id AKIAIOSFODNN7EXAMPLE seen')).toBe(`id ${REDACTED} seen`)
    expect(redactSecrets('token xoxb-1234567890-abcdefghijkl')).toBe(`token ${REDACTED}`)
  })

  it('leaves ordinary prose and technical limits untouched', () => {
    const prose = 'the task-management-dashboard-redesign spec is attached'
    expect(redactSecrets(prose)).toBe(prose)
    const limit = 'max_tokens: 32768 > 8192, which is the maximum allowed'
    expect(redactSecrets(limit)).toBe(limit)
  })
})
