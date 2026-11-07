/**
 * The legacy localStorage pair can be present but unreadable (tampered JSON).
 * The migration must consume the keys in that case too: leaving a plaintext
 * BYOK key in the flat localStorage map defeats the reason the store moved to
 * IndexedDB in the first place.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const LEGACY_SETTINGS_KEY = 'pdfshush.ai.settings.v1';
const LEGACY_MODE_KEY = 'pdfshush.ai.mode.v1';

/** Minimal enough of the Storage API for the module's read/clear paths. */
function storageShim(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
    setItem: (key: string, value: string) => void data.set(key, String(value)),
    removeItem: (key: string) => void data.delete(key),
  };
}

async function loadStorage(shim: ReturnType<typeof storageShim>) {
  vi.resetModules();
  vi.stubGlobal('localStorage', shim);
  vi.stubGlobal('indexedDB', undefined);
  return await import('./storage');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('legacy AI state migration', () => {
  it('adopts a valid legacy record and clears the legacy keys', async () => {
    const shim = storageShim({
      [LEGACY_SETTINGS_KEY]: JSON.stringify({
        provider: 'openrouter',
        providers: { openrouter: { apiKey: 'sk-test', model: 'openrouter/free' } },
      }),
      [LEGACY_MODE_KEY]: 'byok',
    });
    const storage = await loadStorage(shim);
    const state = await storage.hydrateAiState();
    expect(state.settings.providers.openrouter?.apiKey).toBe('sk-test');
    // The plaintext key no longer sits in localStorage.
    expect(shim.getItem(LEGACY_SETTINGS_KEY)).toBeNull();
    expect(shim.getItem(LEGACY_MODE_KEY)).toBeNull();
  });

  it('clears the legacy keys even when the stored JSON is corrupt', async () => {
    const shim = storageShim({
      [LEGACY_SETTINGS_KEY]: '{not valid json',
      [LEGACY_MODE_KEY]: 'byok',
    });
    const storage = await loadStorage(shim);
    await storage.hydrateAiState();
    // Before the fix the parse failure aborted the migration and the key was
    // left in localStorage for the life of the origin.
    expect(shim.getItem(LEGACY_SETTINGS_KEY)).toBeNull();
    expect(shim.getItem(LEGACY_MODE_KEY)).toBeNull();
  });

  it('clears the legacy keys when the payload shape is unusable', async () => {
    const shim = storageShim({ [LEGACY_SETTINGS_KEY]: '["the key is an array"]' });
    const storage = await loadStorage(shim);
    const state = await storage.hydrateAiState();
    // Unusable shape: the record falls back to defaults, keys still cleared.
    expect(state.settings.providers.openrouter?.apiKey).toBe('');
    expect(shim.getItem(LEGACY_SETTINGS_KEY)).toBeNull();
    expect(shim.getItem(LEGACY_MODE_KEY)).toBeNull();
  });

  it('leaves localStorage alone when there is no legacy data', async () => {
    const shim = storageShim({ unrelated: 'value' });
    const storage = await loadStorage(shim);
    await storage.hydrateAiState();
    expect(shim.getItem('unrelated')).toBe('value');
  });
});
