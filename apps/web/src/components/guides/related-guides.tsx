/**
 * "Guides for this tool", rendered under a tool page.
 *
 * The content module is imported dynamically: it carries every article body, and
 * the home page must not pay for that. The component therefore renders nothing
 * until the chunk arrives, which is cheaper than blocking the tool on prose.
 */

import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

interface Related {
  slug: string;
  title: string;
  description: string;
}

export function RelatedGuides() {
  const { pathname } = useLocation();
  const [related, setRelated] = useState<Related[]>([]);

  const match = /^\/tools\/([a-z0-9-]+)\/?$/.exec(pathname);
  const toolSlug = match?.[1] ?? '';

  useEffect(() => {
    if (!toolSlug) {
      setRelated([]);
      return;
    }
    let active = true;
    void import('@/content/guides').then(({ guidesForTool }) => {
      if (!active) return;
      setRelated(
        guidesForTool(toolSlug).slice(0, 3).map((guide) => ({
          slug: guide.frontmatter.slug,
          title: guide.frontmatter.title,
          description: guide.frontmatter.description,
        })),
      );
    });
    return () => {
      active = false;
    };
  }, [toolSlug]);

  if (related.length === 0) return null;

  return (
    <section aria-labelledby="tool-guides" className="mx-auto w-full max-w-3xl px-4 pb-10 sm:px-6 lg:px-8">
      <h2 id="tool-guides" className="text-base font-semibold">
        Guides for this tool
      </h2>
      <ul className="mt-3 space-y-2">
        {related.map((guide) => (
          <li key={guide.slug}>
            <Link
              to={`/guides/${guide.slug}`}
              className="text-sm font-medium text-primary underline underline-offset-2"
            >
              {guide.title}
            </Link>
            <span className="ml-2 hidden text-sm text-muted-foreground sm:inline">
              {guide.description}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
