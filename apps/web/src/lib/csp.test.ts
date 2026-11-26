/**
 * The CSP is the load-bearing claim on the trust page, so its shape is pinned:
 * a future feature that adds an origin has to add it here, deliberately.
 */

import { describe, expect, it } from 'vitest';
import {
  AI_PROVIDER_ORIGINS,
  ANALYTICS_CONNECT_ORIGINS,
  ANALYTICS_IMAGE_ORIGINS,
  PROFILE_IMAGE_ORIGINS,
  buildCsp,
  isAnalyticsOrigin,
  isConnectOriginListed,
  parseConnectSrc,
} from './csp';

describe('content security policy', () => {
  const policy = buildCsp();

  it('locks the document down to this origin by default', () => {
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("frame-src 'none'");
    // The only way to POST a file off-origin, closed.
    expect(policy).toContain("form-action 'self'");
  });

  it('allows WebAssembly, which the PDF engines need', () => {
    expect(policy).toContain("'wasm-unsafe-eval'");
    expect(policy).toContain("worker-src 'self' blob:");
  });

  it('allows the analytics tag and no other third-party script origin', () => {
    // The beacon Cloudflare injects at the edge is stopped by `no-transform` in
    // public/_headers, not by an exception here. A `script-src` that names any
    // other host is how that exception would get added back in.
    const scriptSrc = policy
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('script-src '));
    expect(scriptSrc).toBe(
      "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://www.googletagmanager.com",
    );
  });

  it('lists the measurement origins the page-load tag uses', () => {
    const connect = parseConnectSrc(policy);
    for (const origin of ANALYTICS_CONNECT_ORIGINS) {
      expect(connect.filter((entry) => entry === origin), origin).toHaveLength(1);
    }
    // The tag is page-view measurement, not an open egress path.
    expect(connect).not.toContain('https:');
    expect(connect).not.toContain('*');
  });

  it('never widens connect-src to all HTTPS', () => {
    const connect = parseConnectSrc(policy);
    expect(connect).not.toContain('https:');
    expect(connect).not.toContain('*');
    expect(connect).toContain("'self'");
  });

  it('lists every shipped AI provider origin exactly once', () => {
    const connect = parseConnectSrc(policy);
    for (const origin of AI_PROVIDER_ORIGINS) {
      expect(connect.filter((entry) => entry === origin), origin).toHaveLength(1);
    }
  });

  it('permits the Google avatar CDN and no other remote image host', () => {
    const imgSrc = policy
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('img-src '));
    expect(imgSrc).toBe(
      `img-src 'self' data: blob: ${PROFILE_IMAGE_ORIGINS.join(' ')} ${ANALYTICS_IMAGE_ORIGINS.join(' ')}`,
    );
    const sources = (imgSrc ?? '').slice('img-src '.length).split(/\s+/);
    // The avatar origin is Google's CDN, not a general HTTPS or wildcard
    // allowance: `https:` and a bare `*` would re-open the egress the policy
    // exists to close.
    expect(sources).toContain('https://*.googleusercontent.com');
    expect(sources).not.toContain('https:');
    expect(sources).not.toContain('*');
  });

  it('keeps loopback model servers reachable without opening the internet', () => {
    const connect = parseConnectSrc(policy);
    expect(connect).toContain('http://localhost:*');
    expect(connect).toContain('http://127.0.0.1:*');
  });

  it('normalises a self-hoster extra origin and drops nonsense', () => {
    const widened = buildCsp(['https://ai.internal.example/v1/chat', 'not a url']);
    const connect = parseConnectSrc(widened);
    expect(connect).toContain('https://ai.internal.example');
    expect(connect).not.toContain('https://ai.internal.example/v1/chat');
    expect(connect).not.toContain('not a url');
  });

  it('answers whether a custom endpoint would be blocked', () => {
    expect(isConnectOriginListed('https://api.openai.com/v1', policy)).toBe(true);
    expect(isConnectOriginListed('https://api.openai.com', policy)).toBe(true);
    expect(isConnectOriginListed('http://localhost:11434/v1', policy)).toBe(true);
    expect(isConnectOriginListed('https://my-proxy.example/v1', policy)).toBe(false);
    // An unparseable value is not a claim that it is blocked.
    expect(isConnectOriginListed('', policy)).toBe(true);
  });

  it('recognises the page-load measurement hosts and nothing else', () => {
    expect(isAnalyticsOrigin('https://www.googletagmanager.com/gtm.js?id=GTM-W5QPVR3Z')).toBe(true);
    expect(isAnalyticsOrigin('https://region1.google-analytics.com/g/collect')).toBe(true);
    expect(isAnalyticsOrigin('https://www.analytics.google.com/analytics/web/')).toBe(true);
    expect(isAnalyticsOrigin('https://api.openai.com/v1/chat')).toBe(false);
    expect(isAnalyticsOrigin('https://my-proxy.example/v1')).toBe(false);
    expect(isAnalyticsOrigin('not a url')).toBe(false);
  });
});
