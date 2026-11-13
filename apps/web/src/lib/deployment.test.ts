/**
 * The deployment shape decides what the app may offer.
 *
 * Two things have to be true in a frontend-only build, and both are silent
 * failures if they break: the app must never *ask* for the API (a static host
 * would answer 404, and the browser console would fill with failures that look
 * like bugs), and a server-backed call must fail with a sentence that says why
 * rather than a status code.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadDeployment(env: string | undefined) {
  vi.resetModules();
  if (env === undefined) {
    vi.stubEnv('VITE_SERVER_API', '');
  } else {
    vi.stubEnv('VITE_SERVER_API', env);
  }
  return import('./deployment');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('deployment shape', () => {
  it('defaults to the server shape', async () => {
    const { deploymentShape, serverDeployed } = await loadDeployment(undefined);
    expect(deploymentShape).toBe('server');
    expect(serverDeployed).toBe(true);
  });

  it('is the frontend shape when the server is switched off', async () => {
    const { deploymentShape, serverDeployed } = await loadDeployment('off');
    expect(deploymentShape).toBe('frontend');
    expect(serverDeployed).toBe(false);
  });

  it('treats an unset or misspelled switch as the server shape', async () => {
    // Only the explicit `off` changes the deployment. A typo must not silently
    // disable half the product on a real server.
    for (const value of ['', 'on', 'true', 'frontend', 'of']) {
      const { serverDeployed } = await loadDeployment(value);
      expect(serverDeployed).toBe(true);
    }
  });

  it('accepts `off` whatever the case and surrounding space', async () => {
    for (const value of ['off', 'OFF', ' off ']) {
      const { serverDeployed } = await loadDeployment(value);
      expect(serverDeployed).toBe(false);
    }
  });
});

describe('api() in a frontend-only deployment', () => {
  it('rejects with an explanation and never touches the network', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_SERVER_API', 'off');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { api } = await import('./api');
    const { ApiError } = await import('./api');

    await expect(api('/api/auth/me')).rejects.toBeInstanceOf(ApiError);
    await expect(api('/api/jobs', { method: 'POST' })).rejects.toMatchObject({
      code: 'server_unavailable',
      status: 503,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
