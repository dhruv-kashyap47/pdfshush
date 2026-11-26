import { describe, expect, it } from 'vitest';
import { headingId, parseGuide, renderMarkdown } from './guide-format';

const SOURCE = `---
title: "A guide"
description: "What the reader gets."
slug: "a-guide"
category: "How-to"
publishedAt: "2026-11-26"
updatedAt: "2026-11-27"
relatedTools:
  - merge-pdf
  - split-by-pages
relatedGuides: []
draft: true
---

> **NEEDS HUMAN EDIT** — check the facts.

## First section

Some **bold** text with a [tool link](/tools/merge-pdf) and \`code\`.

- one
- two

1. first
2. second
`;

describe('parseGuide', () => {
  const guide = parseGuide(SOURCE, 'test.md');

  it('reads the frontmatter it needs', () => {
    expect(guide.frontmatter.title).toBe('A guide');
    expect(guide.frontmatter.slug).toBe('a-guide');
    expect(guide.frontmatter.category).toBe('How-to');
    expect(guide.frontmatter.relatedTools).toEqual(['merge-pdf', 'split-by-pages']);
  });

  it('reads draft as a boolean', () => {
    expect(guide.frontmatter.draft).toBe(true);
    expect(parseGuide(SOURCE.replace('draft: true', 'draft: false')).frontmatter.draft).toBe(false);
  });

  it('collects level-2 headings for the table of contents', () => {
    expect(guide.headings).toEqual([{ id: 'first-section', title: 'First section', level: 2 }]);
  });

  it('throws rather than shipping a page with no title', () => {
    expect(() => parseGuide(SOURCE.replace('title: "A guide"', 'title: ""'), 'bad.md')).toThrow(
      /title/,
    );
  });
});

describe('renderMarkdown', () => {
  it('renders the supported blocks', () => {
    const { html } = renderMarkdown(SOURCE.split('---')[2] ?? '');
    expect(html).toContain('<h2 id="first-section">');
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(html).toContain('<ol><li>first</li><li>second</li></ol>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<a href="/tools/merge-pdf">tool link</a>');
    expect(html).toContain('<code>code</code>');
  });

  it('escapes raw HTML instead of executing it', () => {
    const { html } = renderMarkdown('Hello <img src=x onerror=alert(1)> world');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('refuses a javascript: link but keeps the text', () => {
    const { html } = renderMarkdown('[click](javascript:alert(1))');
    expect(html).not.toContain('href="javascript');
  });

  it('de-duplicates repeated heading ids', () => {
    const { headings } = renderMarkdown('## Same\n\ntext\n\n## Same\n');
    expect(headings.map((heading) => heading.id)).toEqual(['same', 'same-1']);
  });
});

describe('headingId', () => {
  it('produces a stable anchor', () => {
    expect(headingId('Why black boxes fail')).toBe('why-black-boxes-fail');
    expect(headingId('1. Start here')).toBe('section-1-start-here');
  });
});
