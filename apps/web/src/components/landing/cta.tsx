import { ArrowRight, Bot, Merge } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export function CtaSection() {
  return (
    <section className="bg-muted/15 py-16 sm:py-24 dark:bg-[oklch(0.05_0_0)]">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* The designed close: one field of the accent colour, one action, */}
        {/* and the copied DevTools proof as the supporting line. */}
        <div className="rounded-2xl bg-primary px-6 py-14 text-center sm:px-12 sm:py-20" data-reveal>
          <div className="mx-auto max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight text-primary-foreground sm:text-4xl">
              Open a PDF. Nothing leaves this tab.
            </h2>
            <p className="mt-3 text-base leading-relaxed text-primary-foreground/90 sm:text-lg">
              Try your most sensitive documents. Every byte is processed in your browser; open
              DevTools at any time and watch nothing being sent.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button
                size="lg"
                className="h-11 bg-background px-6 text-sm font-semibold text-foreground shadow-none hover:bg-background/90"
                asChild
              >
                <Link to="/tools/merge-pdf">
                  <Merge className="mr-2 h-4 w-4" />
                  Open Merge Tool
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button
                size="lg"
                className="h-11 px-4 text-sm font-medium text-primary-foreground shadow-none hover:bg-primary/85"
                asChild
              >
                <Link to="/tools/chat-with-pdf">
                  <Bot className="mr-2 h-4 w-4" />
                  Chat with a PDF
                </Link>
              </Button>
              <a
                href="#all-tools"
                className="text-sm font-medium text-primary-foreground/90 underline-offset-4 transition-opacity hover:underline hover:opacity-100"
              >
                Browse the catalog
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
