import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export function CtaSection() {
  return (
    <section className="mx-auto max-w-7xl px-4 pb-14 pt-4 sm:px-6 lg:px-8">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary via-primary to-emerald-700 px-6 py-10 text-center sm:px-10 sm:py-12">
        <div className="mx-auto max-w-2xl text-primary-foreground">
          <h2 className="text-2xl font-bold sm:text-3xl">Try it on your most annoying PDF</h2>
          <p className="mt-2 text-sm opacity-90 sm:text-base">
            Drop a file into the merge tool and watch it happen in this tab. Nothing is sent
            anywhere — check your network tab while you are at it.
          </p>
          <div className="mt-6">
            <Button size="lg" variant="secondary" className="h-11 px-6" asChild>
              <Link to="/tools/merge-pdf">
                Open the merge tool
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
