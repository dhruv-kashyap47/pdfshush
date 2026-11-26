import { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowRight, ChevronRight, ShieldCheck, Zap } from 'lucide-react';
import { LANDING_BY_PATH } from '@/seo/landing-pages';
import { usePageHead } from '@/seo/head';
import {
  breadcrumbSchema,
  faqPageSchema,
  webPageSchema,
} from '@/seo/schema';
import { SITE_ORIGIN } from '@/seo/site';
import { NotFoundPage } from '@/pages/not-found';

/**
 * A keyword landing page.
 *
 * The route is a guide, not a second copy of the tool: it answers the search
 * intent, then sends the visitor into the working tool. Every page has one H1,
 * its own title and description, a FAQ, a breadcrumb and a link cluster to
 * related tools and guides.
 */
export function LandingPage() {
  const { pathname } = useLocation();
  const page = LANDING_BY_PATH[pathname.replace(/\/$/, '') || '/'];

  if (!page) return <NotFoundPage />;

  return <LandingPageView page={page} />;
}

function LandingPageView({ page }: { page: (typeof LANDING_BY_PATH)[string] }) {
  const toolHref = `/tools/${page.toolSlug}`;
  const imageAlt = `${page.h1} – PDFShush guide`;

  const jsonLd = useMemo(
    () => [
      webPageSchema(
        {
          name: page.title,
          description: page.description,
          route: page.path,
          image: page.image,
          type: 'Article',
        },
        SITE_ORIGIN,
      ),
      breadcrumbSchema(
        [
          { name: 'Home', route: '/' },
          { name: 'PDF tools', route: '/#all-tools' },
          { name: page.h1, route: page.path },
        ],
        SITE_ORIGIN,
      ),
      faqPageSchema(page.faqs, SITE_ORIGIN, page.path),
    ],
    [page],
  );

  usePageHead({
    title: page.title,
    description: page.description,
    route: page.path,
    image: page.image,
    imageAlt,
    type: 'article',
    keywords: page.keywords,
    jsonLd,
  });

  return (
    <article className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link to="/" className="transition-colors hover:text-foreground">
          Home
        </Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        <span>PDF tools</span>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="text-foreground/80">{page.h1}</span>
      </nav>

      <header className="mt-6 max-w-3xl" data-reveal>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
          Free · no signup · in your browser
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl lg:text-5xl">
          {page.h1}
        </h1>
        {page.intro.map((paragraph, index) => (
          <p
            key={paragraph.slice(0, 40)}
            className={
              index === 0
                ? 'mt-4 text-base leading-relaxed text-foreground sm:text-lg'
                : 'mt-3 text-base leading-relaxed text-muted-foreground'
            }
          >
            {paragraph}
          </p>
        ))}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link
            to={toolHref}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {page.toolCta}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            Files are processed on your device
          </span>
        </div>
      </header>

      <div className="mt-12 space-y-10">
        {page.sections.map((section) => (
          <section key={section.heading} data-reveal>
            <h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
              {section.heading}
            </h2>
            {section.paragraphs?.map((paragraph) => (
              <p
                key={paragraph.slice(0, 40)}
                className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base"
              >
                {paragraph}
              </p>
            ))}
            {section.bullets ? (
              <ul className="mt-3 max-w-3xl list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted-foreground sm:text-base">
                {section.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}

        <section data-reveal>
          <h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            How it works in three steps
          </h2>
          <ol className="mt-4 grid gap-4 sm:grid-cols-3">
            {page.steps.map((step, index) => (
              <li key={step} className="rounded-xl border border-border/60 bg-card p-4">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
                  <Zap className="h-3 w-3" aria-hidden="true" />
                  Step {index + 1}
                </span>
                <p className="mt-2 text-sm leading-relaxed text-foreground">{step}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="faq" aria-labelledby="landing-faq" data-reveal>
          <h2
            id="landing-faq"
            className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl"
          >
            Frequently asked questions
          </h2>
          <ul className="mt-4 border-t border-border/60">
            {page.faqs.map((faq) => (
              <li key={faq.question} className="border-b border-border/60">
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-start justify-between gap-4 py-3.5 text-sm font-medium text-foreground transition-colors hover:text-primary [&::-webkit-details-marker]:hidden">
                    <h3 className="min-w-0">{faq.question}</h3>
                    <ChevronRight
                      className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
                      aria-hidden="true"
                    />
                  </summary>
                  <p className="max-w-3xl pb-4 pr-6 text-sm leading-relaxed text-muted-foreground">
                    {faq.answer}
                  </p>
                </details>
              </li>
            ))}
          </ul>
        </section>

        <section data-reveal>
          <h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            Keep going
          </h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {page.related.map((link) => (
              <li key={link.href}>
                <Link
                  to={link.href}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:text-primary"
                >
                  {link.label}
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </article>
  );
}
