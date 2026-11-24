import type { ReactNode } from 'react';

/**
 * Shared shell for the public information pages (privacy, terms, about,
 * contact, status). These pages are deliberately plain: no cards, no motion,
 * no conversion surface. A policy is read, not skimmed.
 */
export function InfoPage({
  eyebrow,
  title,
  summary,
  updated,
  children,
}: {
  eyebrow: string;
  title: string;
  summary: string;
  updated?: string;
  children: ReactNode;
}) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {eyebrow}
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
      <p className="mt-3 text-base leading-relaxed text-muted-foreground">{summary}</p>
      {updated ? (
        <p className="mt-3 text-xs text-muted-foreground">Last updated: {updated}</p>
      ) : null}
      <div className="mt-10 space-y-8">{children}</div>
    </article>
  );
}

export function InfoSection({
  id,
  title,
  children,
}: {
  id?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="text-lg font-semibold text-foreground">
        {title}
      </h2>
      <div className="space-y-3 text-sm leading-7 text-muted-foreground">{children}</div>
    </section>
  );
}
