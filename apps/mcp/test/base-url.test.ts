/**
 * The no-escape gate (§24.4) for the configured base URL, run over the same
 * `resolveBaseUrl` the binary uses: wrong scheme, unencrypted non-loopback,
 * userinfo, query/fragment garbage -- each refused before any fetch, each
 * with the reason an operator can act on.
 */

import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, resolveBaseUrl } from '../src/config.js';

const env = (over: Record<string, string>) => over;

describe('resolveBaseUrl', () => {
  it('accepts an https origin and normalises the trailing slash away', () => {
    expect(resolveBaseUrl('https://pdfshush.example.com/', env({})).toString()).toBe(
      'https://pdfshush.example.com/',
    );
    expect(resolveBaseUrl('https://host.co/deep/prefix', env({})).toString()).toBe(
      'https://host.co/deep/prefix',
    );
  });

  it('refuses non-http(s) schemes', () => {
    for (const raw of ['ftp://example.com', 'file:///etc', 'gopher://example.com']) {
      expect(() => resolveBaseUrl(raw, env({}))).toThrow(ConfigError);
    }
  });

  it('refuses unencrypted non-loopback http unless explicitly allowed', () => {
    expect(() => resolveBaseUrl('http://pdfshush.example.com', env({}))).toThrow(/unencrypted/);
    expect(() => resolveBaseUrl('http://pdfshush.example.com', env({ PDFSHUSH_ALLOW_HTTP: '0' }))).toThrow(
      ConfigError,
    );
    expect(
      resolveBaseUrl('http://pdfshush.example.com', env({ PDFSHUSH_ALLOW_HTTP: '1' })).hostname,
    ).toBe('pdfshush.example.com');
  });

  it('permits plain http on loopback only', () => {
    expect(resolveBaseUrl('http://localhost:8080', env({})).hostname).toBe('localhost');
    expect(resolveBaseUrl('http://127.0.0.1:8080', env({})).hostname).toBe('127.0.0.1');
    expect(() => resolveBaseUrl('http://10.0.0.14:8080', env({}))).toThrow(ConfigError);
    expect(() => resolveBaseUrl('http://internal.co:8080', env({ PDFSHUSH_ALLOW_HTTP: '1' }))).not.toThrow();
  });

  it('refuses userinfo, query strings, fragments and control characters', () => {
    expect(() => resolveBaseUrl('https://user:pass@example.com', env({}))).toThrow(/userinfo/);
    expect(() => resolveBaseUrl('https://example.com/?x=1', env({}))).toThrow(ConfigError);
    expect(() => resolveBaseUrl('https://example.com/#frag', env({}))).toThrow(ConfigError);
    expect(() => resolveBaseUrl('https://exa mple.com', env({}))).toThrow(ConfigError);
    expect(() => resolveBaseUrl('https://example.com/x\ny', env({}))).toThrow(ConfigError);
    expect(() => resolveBaseUrl('https://example.com/%00', env({}))).toThrow(ConfigError);
  });

  it('is honest about unparseable values', () => {
    expect(() => resolveBaseUrl('not a url', env({}))).toThrow(/absolute URL/);
  });
});

describe('loadConfig', () => {
  it('refuses to start without a key, with the repair hint', () => {
    try {
      loadConfig({ PDFSHUSH_API_KEY: '', PDFSHUSH_API_URL: 'https://example.com' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as Error).message).toContain('account dashboard');
    }
  });

  it('defaults the URL to the hosted deployment and passes the key through', () => {
    const config = loadConfig({ PDFSHUSH_API_KEY: 'pshk_test_key_0123456789' });
    expect(config.baseUrl.hostname).toBe('api.pdfshush.com');
    expect(config.baseUrl.protocol).toBe('https:');
    expect(config.apiKey).toBe('pshk_test_key_0123456789');
  });
});
