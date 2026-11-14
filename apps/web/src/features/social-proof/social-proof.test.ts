/**
 * Testimonials: pure data rules plus a dependency-free render check.
 *
 * The web app's Vitest environment is Node-only, so markup assertions use
 * `react-dom/server`. The marquee is CSS-only; the reduced-motion and pause
 * contracts are asserted against the stylesheet at the bottom.
 */

import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SocialProofSection } from './social-proof';
import {
  enabledTestimonials,
  initialsFor,
  splitTestimonialRows,
  type SocialProofContent,
  type Testimonial,
} from './socialProof.data';

function testimonial(id: string, overrides: Partial<Testimonial> = {}): Testimonial {
  return {
    id,
    quote: `Quote ${id}`,
    name: 'Alex Rivera',
    role: 'Counsel',
    enabled: true,
    ...overrides,
  };
}

function content(testimonials: Testimonial[]): SocialProofContent {
  return { testimonials };
}

const SIX = [
  testimonial('a'),
  testimonial('b'),
  testimonial('c'),
  testimonial('d'),
  testimonial('e'),
  testimonial('f'),
];

function render(entry: SocialProofContent): string {
  return renderToStaticMarkup(createElement(SocialProofSection, { content: entry }));
}

describe('testimonial data', () => {
  it('filters disabled entries', () => {
    const entry = content([
      testimonial('shown'),
      testimonial('hidden', { enabled: false }),
    ]);

    expect(enabledTestimonials(entry).map((item) => item.id)).toEqual(['shown']);
  });

  it('splits testimonials into two balanced rows in authored order', () => {
    const rows = splitTestimonialRows(SIX);
    expect(rows[0].map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(rows[1].map((item) => item.id)).toEqual(['d', 'e', 'f']);
  });

  it('derives initials from the first two name parts', () => {
    expect(initialsFor('Tom B.')).toBe('TB');
    expect(initialsFor('  hana   toki  ')).toBe('HT');
    expect(initialsFor('')).toBe('');
  });
});

describe('testimonial render', () => {
  it('is a labelled landmark with one accessible heading', () => {
    const markup = render(content([testimonial('a')]));

    expect(markup).toContain('aria-labelledby="social-proof-title"');
    expect(markup).toContain('id="social-proof-title"');
    expect(markup).toContain('class="sr-only"');
    expect(markup.match(/<h2/g)).toHaveLength(1);
  });

  it('restores the two opposite marquee rows at the original timings', () => {
    const markup = render(content(SIX));

    expect(markup.match(/class="sp-marquee"/g)).toHaveLength(1);
    expect(markup.match(/class="sp-marquee sp-marquee--reverse"/g)).toHaveLength(1);
    expect(markup).toContain('--sp-duration:60s');
    expect(markup).toContain('--sp-duration:75s');
    expect(markup.match(/sp-marquee--reverse/g)).toHaveLength(1);
    expect(markup).toContain('Customer reviews, first row');
    expect(markup).toContain('Customer reviews, second row');
  });

  it('renders each testimonial once in the accessible copy', () => {
    const markup = render(content(SIX));
    const accessible = markup.replace(
      /<ul class="sp-marquee__group sp-marquee__group--dup"[\s\S]*?<\/ul>/g,
      '',
    );

    expect(accessible.match(/Quote a/g)).toHaveLength(1);
    expect(accessible.match(/Quote f/g)).toHaveLength(1);
    expect(markup.match(/Quote a/g)).toHaveLength(2);
    expect(markup.match(/class="sp-card"/g)).toHaveLength(12);
  });

  it('marks the seamless-loop copies aria-hidden and inert', () => {
    const markup = render(content(SIX));
    const duplicates = markup.match(/<ul class="sp-marquee__group sp-marquee__group--dup"[^>]*>/g);

    expect(duplicates).toHaveLength(2);
    for (const tag of duplicates ?? []) {
      expect(tag).toContain('aria-hidden="true"');
      expect(tag).toContain('inert');
    }
  });

  it('renders initials, an optional role and no image', () => {
    const markup = render(
      content([
        testimonial('a', { name: 'Tom B.', role: 'Accountant' }),
        testimonial('b', { name: 'Priya N.', role: undefined }),
      ]),
    );
    const accessible = markup.replace(
      /<ul class="sp-marquee__group sp-marquee__group--dup"[\s\S]*?<\/ul>/g,
      '',
    );

    expect(accessible).toContain('TB');
    expect(accessible).toContain('Accountant');
    expect(accessible).toContain('sp-avatar');
    expect(accessible.match(/sp-person__meta/g)).toHaveLength(1);
    expect(markup).not.toContain('<img');
  });

  it('does not render sample banners, company names, logos, stats or ratings', () => {
    const markup = render(content(SIX));

    expect(markup).not.toContain('sp-badge');
    expect(markup).not.toContain('PLACEHOLDER');
    expect(markup).not.toContain('Organizations using');
    expect(markup).not.toContain('sp-logos');
    expect(markup).not.toContain('sp-stats');
    expect(markup).not.toContain('Rated');
  });

  it('renders nothing when every testimonial is disabled', () => {
    expect(render(content([testimonial('a', { enabled: false })]))).toBe('');
  });

  it('keeps the CSS loop, pause and reduced-motion contracts', () => {
    const css = readFileSync(new URL('./social-proof.css', import.meta.url), 'utf8');
    const reduced =
      css.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/)?.[0] ?? '';

    expect(css).toContain('translate3d(-50%, 0, 0)');
    expect(css).toContain('.sp-marquee:hover .sp-marquee__track');
    expect(css).toContain('.sp-marquee:focus-within .sp-marquee__track');
    expect(css).toContain('animation-play-state: paused');
    expect(reduced).toContain('animation: none');
    expect(reduced).toContain('display: none');
    expect(reduced).toContain('mask-image: none');
  });
});
