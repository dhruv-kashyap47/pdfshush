import { Link } from 'react-router-dom';
import { ArrowRight, Check } from 'lucide-react';
import {
  CATEGORY_BLURBS,
  HOME_INTRO,
  HOME_TOOL_INTRO,
  HOW_IT_WORKS,
  USE_CASES,
  WHY_CHOOSE,
} from '@/seo/home-content';
import { TOOL_CATEGORIES } from '@/tools/registry';

/**
 * The long-form SEO body of the home page.
 *
 * The catalog above this section is the interactive directory. This section is
 * the reading layer: what PDFShush is, who it is for, and a compact index of
 * every tool. It is deliberately smaller than the sections above it so the
 * page does not grow another full screen of cards just to carry its copy.
 */
export function SeoHomeContent() {
  const categories = TOOL_CATEGORIES.map((category) => ({
    ...category,
    live: category.tools.filter((tool) => tool.status === 'live'),
  })).filter((category) => category.live.length > 0);
  const liveCount = categories.reduce((total, category) => total + category.live.length, 0);

  return (
    <section
      id="about-pdfshush"
      aria-labelledby="about-pdfshush-title"
      className="scroll-mt-16 border-t border-border/50 bg-background py-14 sm:py-20"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-8 lg:grid-cols-12 lg:gap-14" data-reveal>
          <div className="lg:col-span-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
              Free online PDF tools
            </p>
            <h2
              id="about-pdfshush-title"
              className="mt-2 max-w-md text-2xl font-bold tracking-tight text-foreground sm:text-3xl"
            >
              Free online PDF tools for everyday work
            </h2>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground sm:text-base">
              {HOME_INTRO[0]}
            </p>
            <Link
              to="/#all-tools"
              className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              Browse all {liveCount} tools
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:col-span-7">
            <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
              {HOME_INTRO[1]}
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
              {HOME_TOOL_INTRO}
            </p>
          </div>
        </div>

        {/* Dense tool index: category, one-line benefit, every live tool name. */}
        <div
          className="mt-10 overflow-hidden rounded-xl border border-border/60 bg-card/40"
          data-reveal
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/50 px-5 py-4 sm:px-6">
            <h3 className="text-sm font-semibold tracking-tight text-foreground">
              All free PDF tools
            </h3>
            <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              {liveCount} live tools
            </p>
          </div>
          <div className="columns-1 gap-x-10 px-5 py-5 sm:columns-2 sm:px-6 lg:columns-3">
            {categories.map((category) => (
              <div key={category.id} className="mb-6 break-inside-avoid">
                <h4 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary/80">
                  {category.label}
                </h4>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {CATEGORY_BLURBS[category.id] ?? 'Open a tool and start.'}
                </p>
                <p className="mt-2 text-[13px] leading-[1.65] text-muted-foreground">
                  {category.live.map((tool, index) => (
                    <span key={tool.slug}>
                      <Link
                        to={`/tools/${tool.slug}`}
                        className="text-foreground/85 underline-offset-2 hover:text-primary hover:underline"
                      >
                        {tool.name}
                      </Link>
                      {index < category.live.length - 1 ? ', ' : ''}
                    </span>
                  ))}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Why and who, side by side instead of two full-width sections. */}
        <div
          className="mt-10 grid gap-8 border-t border-border/50 pt-10 lg:grid-cols-12 lg:gap-14"
          data-reveal
        >
          <div className="lg:col-span-7">
            <h3 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
              Why people use PDFShush
            </h3>
            <ul className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">
              {WHY_CHOOSE.map((item) => (
                <li key={item.title} className="flex gap-2.5">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-medium text-foreground">{item.title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      {item.body}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="lg:col-span-5 lg:border-l lg:border-border/50 lg:pl-10">
            <h3 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
              What people use it for
            </h3>
            <ul className="mt-4 space-y-3.5">
              {USE_CASES.map((item) => (
                <li key={item.title}>
                  <p className="text-sm font-medium text-foreground">{item.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {item.body}
                  </p>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              Need a smaller file?{' '}
              <Link
                to="/pdf-under-200kb"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Compress PDF to 200 KB
              </Link>{' '}
              or{' '}
              <Link
                to="/pdf-under-100kb"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                100 KB
              </Link>
              .
            </p>
          </div>
        </div>

        {/* Three steps, one row, no cards. */}
        <div
          className="mt-10 grid gap-5 border-t border-border/50 pt-8 lg:grid-cols-[12rem_1fr] lg:gap-10"
          data-reveal
        >
          <h3 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
            How it works
          </h3>
          <ol className="grid gap-4 sm:grid-cols-3">
            {HOW_IT_WORKS.map((step, index) => (
              <li key={step.title} className="flex gap-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border/70 text-[11px] font-semibold text-primary">
                  {index + 1}
                </span>
                <div>
                  <p className="text-sm font-medium text-foreground">{step.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {step.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
