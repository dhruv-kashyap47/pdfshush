import { Link } from 'react-router-dom';
import { getTool, liveTools, type ToolDef } from '@/tools/registry';
import { TOOL_SEO, toolSeoFor } from '@/seo/tool-seo';
import { LANDING_PAGES } from '@/seo/landing-pages';
import { limitNoteFor } from '@/lib/tool-limits';

const REMOTE_TOOLS = new Set(['workflows', 'api', 'mcp']);

/**
 * The 300+ word explanatory body under a live tool.
 *
 * A tool page should answer three questions before the FAQ: what the tool does,
 * who it is for, and the exact steps. The copy comes from `seo/tool-seo.ts`,
 * which the prerenderer also uses, so a crawler and a visitor read the same
 * words.
 */
export function ToolSeoContent({ tool }: { tool: ToolDef }) {
  if (tool.status !== 'live') return null;
  const copy = TOOL_SEO[tool.slug] ?? toolSeoFor(tool.slug, tool.name, tool.description);
  const remote = REMOTE_TOOLS.has(tool.slug);

  // Related tools: the success-screen suggestions first, then the SEO module's
  // set, then any live tool from the same category. Only live links render.
  const relatedSlugs = [
    ...(Array.isArray(copy.related) ? copy.related : []),
    ...liveTools()
      .filter((entry) => entry.category === tool.category && entry.slug !== tool.slug)
      .map((entry) => entry.slug),
  ];
  const related = [...new Set(relatedSlugs)]
    .map((slug) => getTool(slug))
    .filter((entry): entry is ToolDef => Boolean(entry) && entry?.status === 'live')
    .slice(0, 4);

  const guides = LANDING_PAGES.filter(
    (page) => page.toolSlug === tool.slug || page.related.some((link) => link.href === `/tools/${tool.slug}`),
  ).slice(0, 3);

  return (
    <section
      aria-labelledby={`about-${tool.slug}`}
      className="mt-10 border-t border-border/60 pt-8 text-left sm:mt-12"
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,18rem)] lg:gap-12">
        <div>
          <h2
            id={`about-${tool.slug}`}
            className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl"
          >
            What is {copy.h1}?
          </h2>
          <p className="mt-3 max-w-prose text-sm leading-relaxed text-muted-foreground sm:text-base">
            {copy.summary}
          </p>
          <p className="mt-3 max-w-prose text-sm leading-relaxed text-muted-foreground sm:text-base">
            {copy.audience}
          </p>

          <h3 className="mt-7 text-base font-semibold text-foreground sm:text-lg">
            How to use this tool
          </h3>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground sm:text-base">
            {copy.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>

          <h3 className="mt-7 text-base font-semibold text-foreground sm:text-lg">
            Good to know
          </h3>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground sm:text-base">
            {remote
              ? 'This surface is server-run by design, with a stated quota and retention window. The file is uploaded for the job, not processed in the browser, and the API deletes it on the schedule described on the page.'
              : 'The file is processed inside this browser tab, so there is no upload and no account. '}
            {limitNoteFor(tool.slug)}
          </p>
        </div>

        <aside aria-label="Related PDF tools" className="lg:border-l lg:border-border/60 lg:pl-8">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Related PDF tools
          </h2>
          <ul className="mt-3 space-y-3">
            {related.map((entry) => (
              <li key={entry.slug}>
                <Link
                  to={`/tools/${entry.slug}`}
                  className="text-sm font-medium text-foreground underline-offset-4 hover:text-primary hover:underline"
                >
                  {entry.name}
                </Link>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {entry.description}
                </p>
              </li>
            ))}
          </ul>

          {guides.length > 0 ? (
            <>
              <h2 className="mt-6 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Guides
              </h2>
              <ul className="mt-3 space-y-2">
                {guides.map((guide) => (
                  <li key={guide.path}>
                    <Link
                      to={guide.path}
                      className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                    >
                      {guide.h1}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
