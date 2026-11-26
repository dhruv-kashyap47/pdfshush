/**
 * The catalog-decision gate (PLAN.md §31.5, M5.7 and §44.5).
 *
 * Every catalog entry is either live, explicitly declined with a reason, or
 * archived with a deployment reason. A declined or archived entry must name a
 * live alternative where one exists. Adding a tool without a decision fails here.
 */

import { describe, expect, it } from 'vitest';
import {
  ALL_TOOLS,
  POPULAR_SLUGS,
  catalogTools,
  getTool,
  liveTools,
  popularTools,
} from './registry';
import { DECLINED_COPY } from './declined';
import { ARCHIVED_COPY } from './archived';

describe('catalog decisions', () => {
  it('has no entry in an unresolved state', () => {
    expect(
      ALL_TOOLS.every(
        (tool) => tool.status === 'live' || tool.status === 'declined' || tool.status === 'archived',
      ),
    ).toBe(true);
    const statuses = new Set(ALL_TOOLS.map((tool) => tool.status));
    expect([...statuses].sort()).toEqual(['archived', 'declined', 'live']);
  });

  it('accounts for every declined tool, and only declined tools', () => {
    const declined = ALL_TOOLS.filter((tool) => tool.status === 'declined').map((tool) => tool.slug);
    expect(declined.sort()).toEqual(Object.keys(DECLINED_COPY).sort());
  });

  it('accounts for every archived surface, and only archived surfaces', () => {
    const archived = ALL_TOOLS.filter((tool) => tool.status === 'archived').map((tool) => tool.slug);
    expect(archived.sort()).toEqual(Object.keys(ARCHIVED_COPY).sort());
  });

  it('keeps the published counts stable', () => {
    expect(ALL_TOOLS).toHaveLength(58);
    expect(liveTools()).toHaveLength(48);
    expect(ALL_TOOLS.filter((tool) => tool.status === 'declined')).toHaveLength(7);
    expect(ALL_TOOLS.filter((tool) => tool.status === 'archived')).toHaveLength(3);
  });

  it('keeps archived surfaces out of the visitor catalog', () => {
    expect(catalogTools().some((tool) => tool.status === 'archived')).toBe(false);
    expect(catalogTools()).toHaveLength(55);
  });

  it('gives every decision a real reason, not a placeholder', () => {
    for (const [slug, copy] of Object.entries(DECLINED_COPY)) {
      expect(copy.what.length, slug).toBeGreaterThan(30);
      expect(copy.why.length, slug).toBeGreaterThan(80);
      expect(copy.why.toLowerCase(), slug).not.toContain('coming soon');
    }
    for (const [slug, copy] of Object.entries(ARCHIVED_COPY)) {
      expect(copy.what.length, slug).toBeGreaterThan(30);
      expect(copy.why.length, slug).toBeGreaterThan(80);
      expect(copy.why.toLowerCase(), slug).not.toContain('coming soon');
    }
  });

  it('points a declined or archived tool at a live alternative when it names one', () => {
    for (const [slug, copy] of [...Object.entries(DECLINED_COPY), ...Object.entries(ARCHIVED_COPY)]) {
      if (!copy.alternative || !('slug' in copy.alternative)) continue;
      const alternative = getTool(copy.alternative.slug);
      expect(alternative, `${slug} -> ${copy.alternative.slug}`).toBeDefined();
      expect(alternative?.status, `${slug} -> ${copy.alternative.slug}`).toBe('live');
    }
  });

  it('never advertises a declined or archived tool in the popular row', () => {
    expect(popularTools().length).toBeGreaterThan(0);
    expect(popularTools().every((tool) => tool.status === 'live')).toBe(true);
    for (const slug of POPULAR_SLUGS) {
      expect(getTool(slug)?.status, slug).toBe('live');
    }
  });
});
