/**
 * Social proof: pure data rules, plus a dependency-free render check.
 *
 * The web app's Vitest environment is Node-only (no jsdom/testing-library), so
 * the render assertions use `react-dom/server`. That covers the accessibility
 * contract in the markup: one landmark, one accessible copy of each review, and
 * loop copies that are impossible to focus. The reduced-motion contract is a
 * CSS one, so the last test reads the stylesheet and asserts the static-grid
 * fallback is still present.
 */

import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SocialProofSection } from './social-proof';
import {
  countEnabledPlaceholders,
  enabledLogos,
  enabledReviews,
  enabledStats,
  initialsFor,
  splitReviewRows,
  usesPersonaFallback,
  type LogoEntry,
  type Review,
  type SocialProofContent,
} from './socialProof.data';

function review(id: string, overrides: Partial<Review> = {}): Review {
  return {
    id,
    quote: `Quote ${id}`,
    name: 'Alex Rivera',
    role: 'Counsel',
    company: 'Fictional Legal',
    enabled: true,
    placeholder: true,
    ...overrides,
  };
}

function logo(id: string, overrides: Partial<LogoEntry> = {}): LogoEntry {
  return {
    id,
    name: `Company ${id}`,
    enabled: true,
    placeholder: true,
    ...overrides,
  };
}

function content(overrides: Partial<SocialProofContent> = {}): SocialProofContent {
  return {
    logos: [logo('one')],
    stats: [{ label: 'Uploaded', value: '0', enabled: true, placeholder: true }],
    reviews: [review('a'), review('b'), review('c')],
    ...overrides,
  };
}

function render(entry: SocialProofContent): string {
  return renderToStaticMarkup(createElement(SocialProofSection, { content: entry }));
}

describe('social proof data', () => {
  it('filters disabled entries from every collection', () => {
    const entry: SocialProofContent = {
      logos: [logo('on'), logo('off', { enabled: false })],
      stats: [
        { label: 'Shown', value: '1', enabled: true },
        { label: 'Hidden', value: '2', enabled: false },
      ],
      reviews: [review('shown'), review('hidden', { enabled: false })],
    };

    expect(enabledLogos(entry).map((item) => item.id)).toEqual(['on']);
    expect(enabledStats(entry).map((item) => item.label)).toEqual(['Shown']);
    expect(enabledReviews(entry).map((item) => item.id)).toEqual(['shown']);
  });

  it('counts only enabled placeholder entries', () => {
    const entry = content({
      logos: [logo('on'), logo('off', { enabled: false }), logo('real', { placeholder: false })],
      reviews: [review('one'), review('real', { placeholder: false })],
    });

    expect(countEnabledPlaceholders(entry)).toBe(3);
  });

  it('splits reviews into two balanced rows in authored order', () => {
    const rows = splitReviewRows([review('1'), review('2'), review('3')]);
    expect(rows[0].map((item) => item.id)).toEqual(['1', '2']);
    expect(rows[1].map((item) => item.id)).toEqual(['3']);
  });

  it('falls back below three enabled reviews', () => {
    expect(usesPersonaFallback([review('1'), review('2')])).toBe(true);
    expect(usesPersonaFallback([review('1'), review('2'), review('3')])).toBe(false);
  });

  it('derives initials from the first two name parts', () => {
    expect(initialsFor('Maya R.')).toBe('MR');
    expect(initialsFor('  hana   toki  ')).toBe('HT');
    expect(initialsFor('')).toBe('');
  });
});

describe('social proof render', () => {
  it('is a labelled landmark with one heading', () => {
    const markup = render(content());
    expect(markup).toContain('aria-labelledby="social-proof-title"');
    expect(markup).toContain('id="social-proof-title"');
    expect(markup.match(/<h2/g)).toHaveLength(1);
  });

  it('marks the seamless-loop copies aria-hidden and inert', () => {
    const markup = render(content());

    // One visible group and one loop copy for each row and for the logo strip.
    expect(markup.match(/class="sp-marquee__group"/g)).toHaveLength(3);
    expect(markup.match(/sp-marquee__group--dup/g)).toHaveLength(3);

    const duplicates = markup.match(/<ul class="sp-marquee__group sp-marquee__group--dup"[^>]*>/g);
    expect(duplicates).toHaveLength(3);
    for (const tag of duplicates ?? []) {
      expect(tag).toContain('aria-hidden="true"');
      expect(tag).toContain('inert');
    }
  });

  it('renders each review quote once in the accessible copy', () => {
    const markup = render(content());
    // Drop the loop copies exactly as assistive tech ignores them.
    const accessible = markup.replace(
      /<ul class="sp-marquee__group sp-marquee__group--dup"[\s\S]*?<\/ul>/g,
      '',
    );

    expect(accessible.match(/Quote a/g)).toHaveLength(1);
    expect(accessible.match(/Quote b/g)).toHaveLength(1);
    expect(accessible.match(/Quote c/g)).toHaveLength(1);
    expect(markup.match(/Quote a/g)).toHaveLength(2);
  });

  it('gives a sourced review a descriptive external link', () => {
    const markup = render(
      content({
        reviews: [
          review('a', {
            name: 'Maya R.',
            sourceUrl: 'https://example.com/review',
            sourceLabel: 'Product Hunt',
          }),
          review('b'),
          review('c'),
        ],
      }),
    );

    expect(markup).toContain('href="https://example.com/review"');
    expect(markup).toContain('rel="noreferrer noopener"');
    expect(markup).toContain(
      'aria-label="Read Maya R.’s review on Product Hunt (opens in a new tab)"',
    );
  });

  it('omits the logo strip and stats when every entry is disabled', () => {
    const markup = render(
      content({
        logos: [logo('hidden', { enabled: false })],
        stats: [{ label: 'Hidden', value: '0', enabled: false }],
      }),
    );

    expect(markup).not.toContain('sp-marquee--logos');
    expect(markup).not.toContain('sp-stats');
  });

  it('renders anonymous persona cards below the review minimum', () => {
    const markup = render(content({ reviews: [review('a'), review('b')] }));

    expect(markup).toContain('sp-personas');
    for (const label of ['Legal', 'HR', 'Finance', 'Students']) {
      expect(markup).toContain(`>${label}<`);
    }
    expect(markup).not.toContain('sp-marquee--reviews');
    expect(markup).not.toContain('Alex Rivera');
  });

  it('keeps the CSS reduced-motion static-grid fallback', () => {
    const css = readFileSync(new URL('./social-proof.css', import.meta.url), 'utf8');
    const block = css.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/)?.[0] ?? '';

    expect(block).toContain('.sp-marquee__track');
    expect(block).toContain('animation: none');
    expect(block).toContain('.sp-marquee__group--dup');
    expect(block).toContain('display: none');
    expect(block).toContain('mask-image: none');
    expect(block).toContain('min-width: 0');

    expect(css).toContain('.sp-marquee:focus-within .sp-marquee__track');
    expect(css).toContain('animation-play-state: paused');
  });
});
