import { useEffect, useMemo } from 'react';
import { ChevronDown } from 'lucide-react';
import { faqsFor, type ToolFaqItem } from '@/tools/tool-faqs';
import { cn } from '@/lib/utils';

interface ToolFaqProps {
  slug: string;
  toolName: string;
  /** The AI studio is wider than the catalog chrome; keep this block readable. */
  studio?: boolean;
}

/**
 * The compact FAQ under a live tool.
 *
 * Native `<details>` rather than the landing page's Radix accordion: the answers
 * are then in the document even when collapsed, work without JavaScript, and
 * keep the tool chunk from pulling in another interactive primitive. The
 * FAQPage JSON-LD is managed in `<head>` so it matches the current route after
 * an SPA navigation instead of accumulating one schema per page visited.
 */
export function ToolFaq({ slug, toolName, studio = false }: ToolFaqProps) {
  const items = faqsFor(slug);
  if (items.length === 0) return null;
  return <ToolFaqSection slug={slug} toolName={toolName} studio={studio} items={items} />;
}

function ToolFaqSection({
  slug,
  toolName,
  studio,
  items,
}: ToolFaqProps & { items: readonly ToolFaqItem[] }) {
  const headingId = `faq-${slug}`;
  const schema = useMemo(
    () => ({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: items.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: { '@type': 'Answer', text: item.answer },
      })),
    }),
    [items],
  );

  useEffect(() => {
    // The prerendered tool page already carries this script for crawlers. Find
    // it by type and content rather than by a marker attribute: adding an
    // attribute to the static script would make the plain `<script type=
    // "application/ld+json">` crawler selector in the reach suite miss it.
    // Once found, mark it so a later navigation reuses the same node instead of
    // stacking a second FAQPage block.
    const existing = [
      ...document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]'),
    ].find(
      (candidate) =>
        candidate.dataset.toolFaqSchema === 'true' ||
        candidate.textContent?.includes('"@type":"FAQPage"'),
    );
    const script = existing ?? document.createElement('script');
    script.type = 'application/ld+json';
    script.dataset.toolFaqSchema = 'true';
    if (!existing) document.head.appendChild(script);
    script.textContent = JSON.stringify(schema);
    return () => script.remove();
  }, [schema]);

  return (
    <section
      id="faq"
      aria-labelledby={headingId}
      data-tool-faq={slug}
      data-testid="tool-faq"
      className={cn(
        'border-t border-border/60 text-left',
        studio
          ? 'mx-auto mt-8 w-full max-w-4xl pt-6'
          : 'mt-10 pt-6 sm:mt-12 sm:pt-8',
      )}
    >
      <div className="grid gap-5 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] sm:gap-10">
        <header>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            FAQ
          </p>
          <h2
            id={headingId}
            className="mt-1.5 text-lg font-semibold tracking-tight text-foreground sm:text-xl"
          >
            Frequently asked questions
          </h2>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">About {toolName}.</p>
        </header>

        <ul className="border-t border-border/50">
          {items.map((item) => (
            <li key={item.question} className="border-b border-border/50">
              <details className="group">
                <summary className="flex cursor-pointer list-none items-start justify-between gap-4 rounded-sm py-3.5 text-sm font-medium leading-snug text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
                  <h3 className="min-w-0">{item.question}</h3>
                  <ChevronDown
                    aria-hidden="true"
                    className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
                  />
                </summary>
                <p className="max-w-prose pb-4 pr-7 text-sm leading-relaxed text-muted-foreground">
                  {item.answer}
                </p>
              </details>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
