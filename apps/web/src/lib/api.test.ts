import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api response handling', () => {
  it('returns undefined for a 204 without trying to parse a body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
    await expect(api('/api/auth/me')).resolves.toBeUndefined();
  });

  it('turns a non-JSON success body into a typed ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>proxy error</html>', { status: 200 })),
    );
    await expect(api('/api/tools')).rejects.toMatchObject({
      name: 'ApiError',
      status: 200,
      code: 'invalid_response',
    });
  });

  it('preserves structured error details for callers that render validation issues', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: 'That workflow is not valid.',
              code: 'validation_failed',
              details: [{ field: 'steps', message: 'Add at least one step' }],
            }),
            { status: 400 },
          ),
      ),
    );
    const error = await api('/api/account/workflows').catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 400,
      code: 'validation_failed',
      details: [{ field: 'steps', message: 'Add at least one step' }],
    });
  });
});
