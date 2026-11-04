/**
 * The parity-debt gate (PLAN.md §31.5, M5.7).
 *
 * The old failure mode was a permanent "in development" page. The new rule is
 * narrower and testable: every catalog entry is either live or explicitly
 * declined with a reason, and a declined entry must name a live alternative
 * where one exists. Adding a tool to the catalog without a decision fails here.
 */

import { describe, expect, it } from 'vitest';
import { ALL_TOOLS, POPULAR_SLUGS, getTool, liveTools, popularTools } from './registry';
import { DECLINED_COPY } from './declined';

describe('catalog decisions', () => {
  it('has no entry in an unresolved state', () => {
    expect(ALL_TOOLS.every((tool) => tool.status === 'live' || tool.status === 'declined')).toBe(
      true,
    );
    const statuses = new Set(ALL_TOOLS.map((tool) => tool.status));
    expect([...statuses].sort()).toEqual(['declined', 'live']);
  });

  it('accounts for every declined tool, and only declined tools', () => {
    const declined = ALL_TOOLS.filter((tool) => tool.status === 'declined').map((tool) => tool.slug);
    expect(declined.sort()).toEqual(Object.keys(DECLINED_COPY).sort());
  });

  it('keeps the published counts stable', () => {
    expect(ALL_TOOLS).toHaveLength(58);
    expect(liveTools()).toHaveLength(49);
    expect(ALL_TOOLS.filter((tool) => tool.status === 'declined')).toHaveLength(9);
  });

  it('gives every decision a real reason, not a placeholder', () => {
    for (const [slug, copy] of Object.entries(DECLINED_COPY)) {
      expect(copy.what.length, slug).toBeGreaterThan(30);
      expect(copy.why.length, slug).toBeGreaterThan(80);
      expect(copy.why.toLowerCase(), slug).not.toContain('coming soon');
    }
  });

  it('points a declined tool at a live alternative when it names one', () => {
    for (const [slug, copy] of Object.entries(DECLINED_COPY)) {
      if (!copy.alternative || !('slug' in copy.alternative)) continue;
      const alternative = getTool(copy.alternative.slug);
      expect(alternative, `${slug} -> ${copy.alternative.slug}`).toBeDefined();
      expect(alternative?.status, `${slug} -> ${copy.alternative.slug}`).toBe('live');
    }
  });

  it('never advertises a declined tool in the popular row', () => {
    expect(popularTools().length).toBeGreaterThan(0);
    expect(popularTools().every((tool) => tool.status === 'live')).toBe(true);
    for (const slug of POPULAR_SLUGS) {
      expect(getTool(slug)?.status, slug).toBe('live');
    }
  });
});
