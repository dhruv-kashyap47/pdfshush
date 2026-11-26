/**
 * M1: the boot warning for an untrusted proxy.
 *
 * The warning is the whole fix, so the test is the whole contract: it must fire
 * in exactly the dangerous configuration (production, no trusted hops) and stay
 * quiet everywhere else, because a warning that cries wolf in development is one
 * operators learn to ignore.
 */

import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { trustProxyWarning } from '../src/http/trust-proxy.js';

describe('trustProxyWarning', () => {
  it('warns in production when no proxy hop is trusted', () => {
    const note = trustProxyWarning(loadConfig({ NODE_ENV: 'production' }));
    expect(note).toContain('TRUST_PROXY');
  });

  it('stays quiet in production once a hop count is set', () => {
    expect(trustProxyWarning(loadConfig({ NODE_ENV: 'production', TRUST_PROXY: '1' }))).toBeUndefined();
    expect(trustProxyWarning(loadConfig({ NODE_ENV: 'production', TRUST_PROXY: '2' }))).toBeUndefined();
  });

  it('stays quiet in development, where there is no proxy to trust', () => {
    expect(trustProxyWarning(loadConfig({ NODE_ENV: 'development' }))).toBeUndefined();
    expect(trustProxyWarning(loadConfig())).toBeUndefined();
  });

  it('treats an explicit opt-out as untrusted and still warns in production', () => {
    expect(trustProxyWarning(loadConfig({ NODE_ENV: 'production', TRUST_PROXY: '0' }))).toBeDefined();
    expect(
      trustProxyWarning(loadConfig({ NODE_ENV: 'production', TRUST_PROXY: 'false' })),
    ).toBeDefined();
  });
});
