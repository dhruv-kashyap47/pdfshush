/**
 * Guide content: frontmatter parsing and a deliberately small markdown renderer.
 *
 * The site prerenders every route to static HTML, so the same article body has
 * to be producible in two places — the Vite bundle and the Node build script.
 * Keeping the parser dependency-free and React-free is what makes that possible:
 * `build/guides.ts` reads the same files with `node:fs` and calls the same
 * functions.
 *
 * The renderer supports the subset the articles are written in: headings,
 * paragraphs, lists, blockquotes, fenced code, emphasis, inline code and links.
 * Anything else is treated as text. That is a security property, not a
 * limitation: raw HTML in a content file can never become markup, because the
 * input is escaped before any tag is produced.
 */

export interface GuideFaq {
  question: string;
  answer: string;
}

export interface GuideFrontmatter {
  title: string;
  description: string;
  slug: string;
  category: string;
  publishedAt: string;
  updatedAt: string;
  relatedTools: string[];
  relatedGuides: string[];
  /**
   * Questions the article answers, used for the visible FAQ block and the
   * FAQPage schema. Written in frontmatter as `- "Question :: Answer"` because
   * the parser deliberately supports only flat keys and string lists.
   */
  faq: GuideFaq[];
  draft: boolean;
}

export interface GuideHeading {
  id: string;
  title: string;
  level: 2 | 3;
}

export interface Guide {
  frontmatter: GuideFrontmatter;
  /** Raw markdown body, without the frontmatter block. */
  body: string;
  /** Rendered HTML. Safe to inject: every character is escaped first. */
  html: string;
  headings: GuideHeading[];
  wordCount: number;
  minutes: number;
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ESCAPES[char] ?? char);
}

/** Stable, readable anchor. Never empty, never starts with a digit. */
export function headingId(text: string): string {
  const base = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return /^[a-z]/.test(base) ? base : `section-${base}`.replace(/-$/, '');
}

function renderInline(escaped: string): string {
  // Code spans first: their contents must not be read as emphasis or a link.
  const codes: string[] = [];
  let text = escaped.replace(/`([^`]+)`/g, (_match, code: string) => {
    codes.push(code);
    return `\u0000${codes.length - 1}\u0000`;
  });

  text = text.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (match, label: string, href: string) => {
      // Only site paths and https are link targets. `javascript:` and protocol
      // relative URLs are dropped rather than sanitised.
      if (!(href.startsWith('/') || href.startsWith('https://'))) return match;
      return `<a href="${href}">${label}</a>`;
    },
  );

  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');

  return text.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => `<code>${codes[Number(index)] ?? ''}</code>`);
}

/**
 * Renders the article body. Blocks are separated by blank lines; a list ends at
 * the first non-list line. Headings collect ids so the table of contents can
 * link to them without re-parsing.
 */
export function renderMarkdown(markdown: string): { html: string; headings: GuideHeading[] } {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  const headings: GuideHeading[] = [];
  const used = new Map<string, number>();

  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let quote: string[] = [];
  let code: string[] | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    out.push(`<p>${renderInline(escapeHtml(paragraph.join(' ')))}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!list) return;
    const tag = list.ordered ? 'ol' : 'ul';
    out.push(
      `<${tag}>${list.items
        .map((item) => `<li>${renderInline(escapeHtml(item))}</li>`)
        .join('')}</${tag}>`,
    );
    list = null;
  };

  const flushQuote = () => {
    if (quote.length === 0) return;
    out.push(`<blockquote><p>${renderInline(escapeHtml(quote.join(' ')))}</p></blockquote>`);
    quote = [];
  };

  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (const line of lines) {
    if (code) {
      if (line.startsWith('```')) {
        out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
        code = null;
      } else {
        code.push(line);
      }
      continue;
    }

    if (line.startsWith('```')) {
      flushAll();
      code = [];
      continue;
    }

    if (line.trim() === '') {
      flushParagraph();
      flushList();
      flushQuote();
      continue;
    }

    const heading = /^(#{2,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      const level = heading[1]!.length as 2 | 3;
      const title = heading[2]!.trim();
      const base = headingId(title);
      const seen = used.get(base) ?? 0;
      used.set(base, seen + 1);
      const id = seen === 0 ? base : `${base}-${seen}`;
      headings.push({ id, title, level });
      out.push(`<h${level} id="${id}">${renderInline(escapeHtml(title))}</h${level}>`);
      continue;
    }

    const quoteLine = /^>\s?(.*)$/.exec(line);
    if (quoteLine) {
      flushParagraph();
      flushList();
      quote.push(quoteLine[1]!);
      continue;
    }

    const ordered = /^\d+\.\s+(.*)$/.exec(line);
    if (ordered) {
      flushParagraph();
      flushQuote();
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(ordered[1]!);
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph();
      flushQuote();
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(bullet[1]!);
      continue;
    }

    // A continuation line inside a list item or a blockquote stays with it.
    if (list && /^\s{2,}\S/.test(line)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    if (quote.length > 0 && /^\s{2,}\S/.test(line)) {
      quote[quote.length - 1] += ` ${line.trim()}`;
      continue;
    }

    flushList();
    flushQuote();
    paragraph.push(line.trim());
  }

  if (code) out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
  flushAll();

  return { html: out.join('\n'), headings };
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Parses the YAML subset the guides use: `key: value` plus `key:` followed by
 * `- item` lines. Nested structures, multi-line strings and anchors are not
 * supported — and are not needed.
 */
export function parseFrontmatter(source: string): { data: Record<string, unknown>; body: string } {
  const normalised = source.replace(/\r\n/g, '\n');
  if (!normalised.startsWith('---\n')) return { data: {}, body: normalised };

  const end = normalised.indexOf('\n---', 3);
  if (end < 0) return { data: {}, body: normalised };

  const block = normalised.slice(4, end).split('\n');
  const body = normalised.slice(normalised.indexOf('\n', end + 1) + 1);
  const data: Record<string, unknown> = {};
  let currentKey: string | null = null;

  for (const line of block) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;

    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && currentKey) {
      const existing = data[currentKey];
      const list = Array.isArray(existing) ? existing : [];
      list.push(unquote(item[1]!));
      data[currentKey] = list;
      continue;
    }

    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (pair) {
      currentKey = pair[1]!;
      const value = pair[2]!.trim();
      data[currentKey] = value === '' ? [] : unquote(value);
    }
  }

  return { data, body };
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/**
 * `- "Question :: Answer"` pairs. The separator is chosen so neither a question
 * nor an answer has to escape anything; a guide that needs to use it can put the
 * literal question and answer in the body instead.
 */
function faqList(value: unknown): GuideFaq[] {
  return stringList(value)
    .map((entry) => {
      const separator = entry.indexOf(' :: ');
      if (separator < 0) return null;
      const question = entry.slice(0, separator).trim();
      const answer = entry.slice(separator + 4).trim();
      return question && answer ? { question, answer } : null;
    })
    .filter((entry): entry is GuideFaq => entry !== null);
}

function requiredString(data: Record<string, unknown>, key: string, where: string): string {
  const value = data[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${where}: frontmatter is missing a non-empty "${key}"`);
  }
  return value.trim();
}

/** Parses one content file. Throws on a missing required field rather than shipping a blank page. */
export function parseGuide(source: string, where = 'guide'): Guide {
  const { data, body } = parseFrontmatter(source);
  const { html, headings } = renderMarkdown(body);
  const words = body
    .replace(/[#>*`\-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;

  const draftValue = data.draft;
  const draft = draftValue === true || draftValue === 'true';

  return {
    frontmatter: {
      title: requiredString(data, 'title', where),
      description: requiredString(data, 'description', where),
      slug: requiredString(data, 'slug', where),
      category: requiredString(data, 'category', where),
      publishedAt: requiredString(data, 'publishedAt', where),
      updatedAt: typeof data.updatedAt === 'string' && data.updatedAt ? data.updatedAt : requiredString(data, 'publishedAt', where),
      relatedTools: stringList(data.relatedTools),
      relatedGuides: stringList(data.relatedGuides),
      faq: faqList(data.faq),
      draft,
    },
    body,
    html,
    headings,
    wordCount: words,
    minutes: Math.max(1, Math.round(words / 220)),
  };
}

export function guidePath(slug: string): string {
  return `/guides/${slug}`;
}

/** Newest first; ties broken by title so the order is stable between builds. */
export function byNewest(a: Guide, b: Guide): number {
  return b.frontmatter.publishedAt.localeCompare(a.frontmatter.publishedAt) ||
    a.frontmatter.title.localeCompare(b.frontmatter.title);
}
