/**
 * The guides index. Grouped by category, newest first inside each group.
 *
 * This route is lazy in `App.tsx`, so the article content and its metadata are
 * not part of the home page's entry chunk.
 */

import { Link } from 'react-router-dom';
import { guideCategories, GUIDES } from '@/content/guides';
import { guidePath } from '@/content/guide-format';
import { breadcrumbSchema, webPageSchema } from '@/seo/schema';
import { SITE_ORIGIN } from '@/seo/site';
import { usePageHead } from '@/seo/head';

const TITLE = 'PDF Guides — Practical, No-Fluff How-Tos | PDFShush';
const DESCRIPTION =
  'Step-by-step guides for redacting, merging, signing and compressing PDFs, written for people who need the file to be right the first time. No filler at all.';

export function GuidesPage() {
  const categories = guideCategories();

  usePageHead({
    title: TITLE,
    description: DESCRIPTION,
    route: '/guides',
    keywords: ['pdf guides', 'how to edit pdf', 'pdf how-to'],
    indexable: GUIDES.length > 0,
    jsonLd: [
      webPageSchema({ name: TITLE, description: DESCRIPTION, route: '/guides' }, SITE_ORIGIN),
      breadcrumbSchema(
        [
          { name: 'Home', route: '/' },
          { name: 'Guides', route: '/guides' },
        ],
        SITE_ORIGIN,
      ),
    ],
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
        Guides
      </p>
      <h1 className="mt-2 max-w-3xl text-3xl font-bold tracking-tight sm:text-4xl">
        PDF guides for work that has to be right
      </h1>
      <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
        Redaction that actually removes text, numbering a court production, filling a form a portal
        will accept. No listicles, no 400-word pages.
      </p>

      {categories.length === 0 ? (
        <p className="mt-10 text-sm text-muted-foreground">
          Guides are being written. Check back shortly.
        </p>
      ) : null}

      <div className="mt-12 space-y-14">
        {categories.map((category) => (          <section key={category.name} aria-labelledby={`cat-${category.name}`}>
            <h2
              id={`cat-${category.name}`}
              className="text-lg font-semibold tracking-tight"
            >
              {category.name}
            </h2>
            <ul className="mt-4 grid gap-4 sm:grid-cols-2">
              {category.guides.map((guide) => (
                <li key={guide.frontmatter.slug}>
                  <Link
                    to={guidePath(guide.frontmatter.slug)}
                    className="group flex h-full flex-col rounded-xl border border-border/60 p-5 transition-colors hover:border-border hover:bg-muted/30"
                  >
                    <span className="text-base font-semibold leading-snug group-hover:text-primary">
                      {guide.frontmatter.title}
                    </span>
                    <span className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">
                      {guide.frontmatter.description}
                    </span>
                    <span className="mt-3 text-xs text-muted-foreground">
                      {guide.minutes} min read
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
