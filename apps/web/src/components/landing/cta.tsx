import { ArrowRight, Bot, Lock, Merge } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export function CtaSection() {
  return (
    <section className="bg-muted/15 py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-card px-6 py-12 text-center shadow-xs sm:px-12 sm:py-16">
          <div className="mx-auto max-w-2xl">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-muted/30 px-3 py-1 text-xs font-mono text-muted-foreground">
              <Lock className="h-3.5 w-3.5 text-primary" />
              <span>PRIVATE BY ARCHITECTURE</span>
            </div>

            <h2 className="mt-4 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Start working on your PDFs with complete confidence.
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
              Try your most sensitive documents in PDFShush. Every byte remains in this browser tab;
              inspect your browser's DevTools Network panel at any time to verify.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button size="lg" className="h-11 px-6 text-sm font-semibold shadow-xs" asChild>
                <Link to="/tools/merge-pdf">
                  <Merge className="mr-2 h-4 w-4" />
                  Open Merge Tool
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="h-11 px-6 text-sm font-medium" asChild>
                <Link to="/tools/chat-with-pdf">
                  <Bot className="mr-2 h-4 w-4 text-primary" />
                  Chat with a PDF
                </Link>
              </Button>
              <Button size="lg" variant="ghost" className="h-11 px-4 text-sm text-muted-foreground" asChild>
                <a href="#all-tools">
                  Explore full catalog
                </a>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
