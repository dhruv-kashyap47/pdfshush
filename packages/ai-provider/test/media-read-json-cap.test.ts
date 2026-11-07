import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateImageWithProvider } from '../src/media-protocols'

/**
 * `readJson` used to slurp the whole response with an uncapped `resp.text()`.
 * A hostile or broken endpoint could stream gigabytes into memory before the
 * parse ever ran. It now goes through `readCapped`, the same 50 MB download
 * ceiling the image-bytes path already enforced. A valid JSON body may carry a
 * multi-megabyte base64 image, so the cap is the download ceiling — not the
 * tiny error-body truncation cap.
 */

afterEach(() => {
  vi.unstubAllGlobals()
})

/** A body longer than the cap, declared up front so the cap fires before a byte is read. */
function overCapDeclared(): Response {
  const overCap = 50 * 1024 * 1024 + 1
  return new Response(new Uint8Array(1), {
    status: 200,
    headers: { 'content-type': 'application/json', 'content-length': String(overCap) },
  })
}

/** A body that sneaks past the declared length and streams over the cap. */
function overCapStream(): Response {
  let sent = 0
  const chunk = new Uint8Array(30 * 1024 * 1024)
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent < 2 * 30 * 1024 * 1024) {
          sent += chunk.byteLength
          controller.enqueue(chunk)
        } else {
          controller.close()
        }
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

async function messageOf(promise: Promise<unknown>): Promise<string> {
  const err = await promise.then(
    () => {
      throw new Error('expected the media call to fail')
    },
    (e: unknown) => e,
  )
  expect(err).toBeInstanceOf(Error)
  return (err as Error).message
}

describe('the media JSON read is capped', () => {
  it('refuses a body declared over the download ceiling before reading it', async () => {
    vi.stubGlobal('fetch', <T>(...args: unknown[]) => {
      void args
      return Promise.resolve(overCapDeclared()) as unknown as T
    })
    const message = await messageOf(
      generateImageWithProvider('openai', { apiKey: 'sk', imageModel: 'gpt-image-2', analysisModel: '' }, { prompt: 'a cat' }),
    )
    expect(message).toMatch(/download too large/)
    expect(message).toMatch(/^Image generation failed:/)
  })

  it('refuses a streaming body that exceeds the download ceiling mid-read', async () => {
    vi.stubGlobal('fetch', <T>(...args: unknown[]) => {
      void args
      return Promise.resolve(overCapStream()) as unknown as T
    })
    const message = await messageOf(
      generateImageWithProvider('openai', { apiKey: 'sk', imageModel: 'gpt-image-2', analysisModel: '' }, { prompt: 'a cat' }),
    )
    expect(message).toMatch(/download too large/)
  })
})
