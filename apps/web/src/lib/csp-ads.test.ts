import { describe, expect, it } from 'vitest';
import { buildCsp, adsCspHosts } from './csp';

describe('buildCsp with ads', () => {
  it('keeps frames closed and adds no Google hosts by default', () => {
    const policy = buildCsp();
    expect(policy).toContain("frame-src 'none'");
    expect(policy).not.toContain('googlesyndication');
    expect(policy).not.toContain('doubleclick');
  });

  it('opens exactly the ad directives when ads are on', () => {
    const policy = buildCsp([], { ads: true });
    expect(policy).toContain('frame-src');
    expect(policy).not.toContain("frame-src 'none'");
    for (const host of adsCspHosts()) {
      expect(policy, host).toContain(host);
    }
  });

  it('keeps the AI origins and self in connect-src under both policies', () => {
    for (const policy of [buildCsp(), buildCsp([], { ads: true })]) {
      expect(policy).toContain("connect-src 'self'");
      expect(policy).toContain('https://openrouter.ai');
    }
  });

  it('still honours the self-hoster extra origin alongside ads', () => {
    const policy = buildCsp(['https://ai.internal.example/v1'], { ads: true });
    expect(policy).toContain('https://ai.internal.example');
    expect(policy).toContain('https://pagead2.googlesyndication.com');
  });
});
