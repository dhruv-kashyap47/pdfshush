/**
 * The edge is part of the privacy claim, and it is the one part a commit cannot
 * switch off from code: Cloudflare injects its own Web Analytics beacon
 * (`static.cloudflareinsights.com/beacon.min.js`) into any HTML it is allowed to
 * modify. The document CSP blocks it, which is why nobody sees a violation in
 * dev -- but on the deployed site that leaves a CSP error in every visitor's
 * console and makes the policy the only thing between the claim and the edge.
 *
 * The fix is not a wider `script-src`. It is `Cache-Control: no-transform` on
 * the documents: Cloudflare may not rewrite a payload it is told not to
 * transform, so the script tag is never added. These assertions pin that, plus
 * the standard PWA meta name Chrome asks for.
 *
 * https://developers.cloudflare.com/web-analytics/faq/
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type Rule = { path: string; headers: { name: string; value: string }[]; detached: string[] };

/** `_headers` is a flat format: a path line, then indented `Name: value` lines. */
function parseHeaders(source: string): Rule[] {
  const rules: Rule[] = [];
  let current: Rule | null = null;

  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      current = { path: line, headers: [], detached: [] };
      rules.push(current);
      continue;
    }
    if (!current) continue;
    const detach = /^!\s+([^:\s]+):?$/.exec(line);
    if (detach?.[1]) {
      current.detached.push(detach[1]);
      continue;
    }
    const colon = line.indexOf(':');
    if (colon > 0) {
      current.headers.push({
        name: line.slice(0, colon).trim(),
        value: line.slice(colon + 1).trim(),
      });
    }
  }

  return rules;
}

const headersSource = readFileSync(new URL('../../public/_headers', import.meta.url), 'utf8');
const rules = parseHeaders(headersSource);
const indexHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

function cacheControl(rule: Rule): string | undefined {
  return rule.headers.find((header) => header.name.toLowerCase() === 'cache-control')?.value;
}

describe('edge headers', () => {
  it('forbids Cloudflare from rewriting a document', () => {
    const catchAll = rules.find((rule) => rule.path === '/*');
    expect(catchAll, 'a /* rule must exist to cover the SPA fallback').toBeDefined();
    // The SPA fallback serves index.html at an unmatched path, so the policy has
    // to sit on the catch-all; per-route rules would leave that path uncovered.
    expect(cacheControl(catchAll!)).toContain('no-transform');
  });

  it('never lets two Cache-Control values join', () => {
    // Cloudflare joins the same header across matching rules, and a joined
    // Cache-Control is a conflicting one. A rule either carries no-transform
    // with the document policy, or detaches before setting its own value.
    for (const rule of rules) {
      const value = cacheControl(rule);
      if (value === undefined) continue;
      const setsOwnValue = rule.detached.some((name) => name.toLowerCase() === 'cache-control');
      if (!setsOwnValue) expect(value, rule.path).toContain('no-transform');
    }
  });

  it('still caches hashed assets for a year, and may transform them', () => {
    const assets = rules.find((rule) => rule.path === '/assets/*');
    expect(assets, 'the /assets/* rule must exist').toBeDefined();
    expect(assets!.detached.map((name) => name.toLowerCase())).toContain('cache-control');
    expect(cacheControl(assets!)).toBe('public, max-age=31536000, immutable');
  });

  it('declares the standard PWA meta alongside the Apple-prefixed one', () => {
    // Chrome warns on a document that only has apple-mobile-web-app-capable;
    // iOS Safari is the only reader of the prefixed name, so both stay.
    expect(indexHtml).toContain('<meta name="mobile-web-app-capable" content="yes" />');
    expect(indexHtml).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />');
  });
});
