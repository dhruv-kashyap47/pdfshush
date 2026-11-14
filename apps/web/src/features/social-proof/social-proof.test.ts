/**
 * Testimonials: pure data rules plus a dependency-free render check.
 *
 * The web app's Vitest environment is Node-only, so markup assertions use
 * `react-dom/server`. Animation is a browser effect and is verified manually
 * in the dev server (including the reduced-motion path).
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SocialProofSection } from './social-proof';
import {
  enabledTestimonials,
  initialsFor,
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
    expect(markup).toContain('aria-label="Testimonials"');
    expect(markup).toContain('tabindex="0"');
    expect(markup.match(/<h2/g)).toHaveLength(1);
  });

  it('renders one card per enabled testimonial with initials, not an image', () => {
    const markup = render(
      content([
        testimonial('a', { name: 'Tom B.', role: 'Accountant' }),
        testimonial('b', { name: 'Priya N.', role: 'Law student' }),
        testimonial('c'),
      ]),
    );

    expect(markup.match(/class="sp-card"/g)).toHaveLength(3);
    expect(markup.match(/data-float/g)).toHaveLength(3);
    expect(markup).toContain('Quote a');
    expect(markup).toContain('TB');
    expect(markup).toContain('Accountant');
    expect(markup).toContain('sp-avatar');
    expect(markup).not.toContain('<img');
  });

  it('omits an optional role without leaving an empty line', () => {
    const markup = render(content([testimonial('a', { role: undefined })]));
    expect(markup).not.toContain('sp-person__meta');
  });

  it('does not render sample banners, company names, logos, stats or ratings', () => {
    const markup = render(content([testimonial('a'), testimonial('b')]));

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
});
