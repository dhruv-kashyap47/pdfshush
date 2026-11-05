import { describe, expect, it } from 'vitest';
import { isChunkLoadError, shouldReloadForStaleBuild } from './build-recovery';

describe('build recovery', () => {
  it('recognizes the browser and bundler chunk failure messages', () => {
    expect(isChunkLoadError(new Error('Failed to fetch dynamically imported module: /assets/x.js'))).toBe(
      true,
    );
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('Loading chunk 42 failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('A normal render error'))).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });

  it('allows one recovery reload per cooldown window', () => {
    const start = 1_000_000;
    expect(shouldReloadForStaleBuild(start)).toBe(true);
    expect(shouldReloadForStaleBuild(start + 1_000)).toBe(false);
    expect(shouldReloadForStaleBuild(start + 16_000)).toBe(true);
  });
});
