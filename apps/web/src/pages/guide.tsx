/**
 * One guide.
 *
 * The body is rendered by `content/guide-format.ts`, which escapes every
 * character before emitting a tag; `dangerouslySetInnerHTML` is therefore
 * feeding the page HTML this codebase produced from a text file, not markup a
 * contributor supplied.
 *
 * Ads sit in the content flow after the 2nd and 5th H2, which is the agreed
 * density for articles. They are components that return `null` until every gate
 * passes, so the flow is unchanged when ads are off.
 */

import { Fragment } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AdSlot } from '@/components/ads/ad-slot';
import { GUIDES, getGuide, type Guide } from '@/content/guides';
import { guidePath } from '@/content/guide-format';
import { NotFoundPage } from '@/pages/not-found';
import { articleSchema } from '@/seo/article';
import { breadcrumbSchema } from '@/seo/schema';
import { SITE_ORIGIN } from '@/seo/site';
import { usePageHead } from '@/seo/head';
import { getTool } from '@/tools/registry';

/** Splits before each `<h2`, so the intro is index 0 and sections follow. */
function splitAtSections(html: string): string[] {
  return html.split(/(?=<h2\b)/).filter((chunk) => chunk.trim() !== '');
}

export function GuidePage() {
  const { slug = '' } = useParams();
  const guide = getGuide(slug);

  if (!guide) return <NotFoundPage />;

  return <GuideArticle guide={guide} />;
}

/**
 * Split from the route on purpose. Calling `usePageHead` after the early return
 * above would break the rules of hooks: navigating from a valid article to an
 * unknown slug keeps the same component instance, so React would see fewer hooks
 * than the previous render and throw. The route decides; this component renders.
 */
function GuideArticle({ guide }: { guide: Guide }) {
  const { frontmatter, headings, minutes, html } = guide;
  const route = guidePath(frontmatter.slug);
  const toc = headings.filter((heading) => heading.level === 2);
  const chunks = splitAtSections(html);

  const relatedTools = frontmatter.relatedTools
    .map((toolSlug) => ({ slug: toolSlug, tool: getTool(toolSlug) }))
    .filter((entry): entry is { slug: string; tool: NonNullable<ReturnType<typeof getTool>> } =>
      Boolean(entry.tool),
    );

  const relatedGuides = (
    frontmatter.relatedGuides.length > 0
      ? frontmatter.relatedGuides.map((relatedSlug) => getGuide(relatedSlug))
      : GUIDES.filter((entry) => entry.frontmatter.slug !== frontmatter.slug).slice(0, 2)
  ).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  usePageHead({
    title: `${frontmatter.title} | PDFShush`,
    description: frontmatter.description,
    route,
    // A draft is previewable in development but must never be indexed.
    indexable: !frontmatter.draft,
    keywords: [frontmatter.category.toLowerCase(), 'pdf'],
    jsonLd: [
      articleSchema(
        {
          title: frontmatter.title,
          description: frontmatter.description,
          route,
          publishedAt: frontmatter.publishedAt,
          updatedAt: frontmatter.updatedAt,
          section: frontmatter.category,
        },
        SITE_ORIGIN,
      ),
      breadcrumbSchema(
        [
          { name: 'Home', route: '/' },
          { name: 'Guides', route: '/guides' },
          { name: frontmatter.title, route },
        ],
        SITE_ORIGIN,
      ),
    ],
  });

  return (
    <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span aria-hidden="true"> / </span>
        <Link to="/guides" className="hover:text-foreground">
          Guides
        </Link>
        <span aria-hidden="true"> / </span>
        <span className="text-foreground">{frontmatter.category}</span>
      </nav>

      {frontmatter.draft ? (
        <p className="mt-6 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          Draft preview — not indexed, not in the sitemap, excluded from production builds.
        </p>
      ) : null}

      <h1 className="mt-4 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
        {frontmatter.title}
      </h1>
      <p className="mt-3 text-lg leading-relaxed text-muted-foreground">
        {frontmatter.description}
      </p>
      <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{frontmatter.category}</span>
        <span aria-hidden="true">·</span>
        <time dateTime={frontmatter.publishedAt}>
          {new Date(frontmatter.publishedAt).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </time>
        <span aria-hidden="true">·</span>
        <span>{minutes} min read</span>
        {frontmatter.updatedAt !== frontmatter.publishedAt ? (
          <>
            <span aria-hidden="true">·</span>
            <span>Updated {frontmatter.updatedAt}</span>
          </>
        ) : null}
      </p>

      {toc.length >= 3 ? (
        <nav
          aria-label="Table of contents"
          className="mt-8 rounded-xl border border-border/60 p-5"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            On this page
          </p>
          <ol className="mt-3 space-y-1.5 text-sm">
            {toc.map((heading, index) => (
              <li key={heading.id} className="flex gap-2">
                <span className="tabular-nums text-muted-foreground">{index + 1}.</span>
                <a href={`#${heading.id}`} className="hover:text-primary">
                  {heading.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      ) : null}

      <div className="mt-10 space-y-6 text-[15px] leading-7 text-foreground/90 [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[13px] [&_h2]:mt-10 [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:tracking-tight [&_h3]:mt-8 [&_h3]:text-lg [&_h3]:font-semibold [&_li]:mt-1.5 [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6">
        {chunks.map((chunk, index) => (
          <Fragment key={index}>
            <div dangerouslySetInnerHTML={{ __html: chunk }} />
            {index === 2 ? <AdSlot surface="top" /> : null}
            {index === 5 ? <AdSlot surface="end" /> : null}
          </Fragment>
        ))}
      </div>

      {relatedTools.length > 0 ? (
        <section aria-labelledby="related-tools" className="mt-12 rounded-xl border border-border/60 p-5">
          <h2 id="related-tools" className="text-base font-semibold">
            Do it now, in your browser
          </h2>
          <ul className="mt-3 space-y-2">
            {relatedTools.map(({ slug: toolSlug, tool }) => (
              <li key={toolSlug}>
                <Link
                  to={`/tools/${toolSlug}`}
                  className="text-sm font-medium text-primary underline underline-offset-2"
                >
                  {tool.name}
                </Link>
                <span className="ml-2 text-sm text-muted-foreground">{tool.description}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {relatedGuides.length > 0 ? (
        <section aria-labelledby="related-guides" className="mt-8">
          <h2 id="related-guides" className="text-base font-semibold">
            Related reading
          </h2>
          <ul className="mt-3 space-y-2">
            {relatedGuides.map((entry) => (
              <li key={entry.frontmatter.slug}>
                <Link
                  to={guidePath(entry.frontmatter.slug)}
                  className="text-sm text-primary underline underline-offset-2"
                >
                  {entry.frontmatter.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}
