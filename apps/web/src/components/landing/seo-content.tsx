import { Link } from 'react-router-dom';
import {
  HOME_INTRO,
  HOME_TOOL_INTRO,
  HOW_IT_WORKS,
  TOOL_BENEFITS,
  USE_CASES,
  WHY_CHOOSE,
} from '@/seo/home-content';
import { TOOL_CATEGORIES } from '@/tools/registry';

/**
 * The long-form SEO body of the home page.
 *
 * The catalog above this section is the interactive directory. This section is
 * the part a first-time visitor (and a crawler) can read to understand what the
 * product is, who it is for and why the local path matters. It is deliberately
 * plain prose plus linked lists, not another wall of cards.
 */
export function SeoHomeContent() {
  return (
    <section
      id="about-pdfshush"
      aria-labelledby="about-pdfshush-title"
      className="scroll-mt-16 border-t border-border/50 bg-background py-16 sm:py-24"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-14">
          <div className="lg:col-span-5" data-reveal>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
              Free online PDF tools
            </p>
            <h2
              id="about-pdfshush-title"
              className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl"
            >
              What is PDFShush?
            </h2>
            <p className="mt-4 text-base leading-relaxed text-foreground sm:text-lg">
              {HOME_INTRO[0]}
            </p>
          </div>
          <div className="lg:col-span-7" data-reveal data-reveal-delay="80">
            <p className="text-base leading-relaxed text-muted-foreground sm:text-lg">
              {HOME_INTRO[1]}
            </p>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground sm:text-lg">
              {HOME_TOOL_INTRO}
            </p>
          </div>
        </div>

        {/* Full catalog, grouped by category, with the benefit of each tool. */}
        <div className="mt-14" data-reveal>
          <h3 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            Every free PDF tool and what it does
          </h3>
          <div className="mt-6 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {TOOL_CATEGORIES.map((category) => {
              const live = category.tools.filter((tool) => tool.status === 'live');
              if (live.length === 0) return null;
              return (
                <div key={category.id}>
                  <h4 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    {category.label}
                  </h4>
                  <ul className="mt-3 space-y-2.5">
                    {live.map((tool) => (
                      <li key={tool.slug} className="text-sm leading-relaxed">
                        <Link
                          to={`/tools/${tool.slug}`}
                          className="font-medium text-foreground underline-offset-4 hover:text-primary hover:underline"
                        >
                          {tool.name}
                        </Link>{' '}
                        <span className="text-muted-foreground">
                          — {TOOL_BENEFITS[tool.slug] ?? tool.description}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>

        {/* Why choose */}
        <div className="mt-16 border-t border-border/50 pt-12" data-reveal>
          <h3 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            Why choose PDFShush for free PDF work?
          </h3>
          <div className="mt-6 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {WHY_CHOOSE.map((item) => (
              <div key={item.title}>
                <h4 className="text-base font-semibold text-foreground">{item.title}</h4>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Use cases */}
        <div className="mt-16 border-t border-border/50 pt-12" data-reveal>
          <h3 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            Common PDF jobs people finish here
          </h3>
          <div className="mt-6 grid gap-8 sm:grid-cols-2">
            {USE_CASES.map((item) => (
              <div key={item.title}>
                <h4 className="text-base font-semibold text-foreground">{item.title}</h4>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm text-muted-foreground">
            Preparing a form? Start with{' '}
            <Link to="/pdf-under-200kb" className="font-medium text-primary hover:underline">
              compress PDF to 200 KB
            </Link>{' '}
            or{' '}
            <Link to="/pdf-under-100kb" className="font-medium text-primary hover:underline">
              compress PDF to 100 KB
            </Link>
            . Combining documents? See{' '}
            <Link to="/merge-pdf" className="font-medium text-primary hover:underline">
              merge PDF
            </Link>{' '}
            and{' '}
            <Link to="/split-pdf" className="font-medium text-primary hover:underline">
              split PDF
            </Link>
            .
          </p>
        </div>

        {/* How it works */}
        <div className="mt-16 border-t border-border/50 pt-12" data-reveal>
          <h3 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            How it works in three steps
          </h3>
          <ol className="mt-6 grid gap-6 sm:grid-cols-3">
            {HOW_IT_WORKS.map((step, index) => (
              <li key={step.title} className="rounded-xl border border-border/60 bg-card p-5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
                  Step {index + 1}
                </span>
                <h4 className="mt-2 text-base font-semibold text-foreground">{step.title}</h4>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
