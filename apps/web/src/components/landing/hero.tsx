import { ArrowRight, Lock, Star, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { DotPattern } from '@/components/dot-pattern';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-background to-background/80 pt-14 pb-14 sm:pt-20 sm:pb-16">
      <div className="absolute inset-0" aria-hidden="true">
        <DotPattern className="opacity-100" size="md" fadeStyle="ellipse" />
      </div>

      <div className="container relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-6 flex justify-center">
            <Badge variant="outline" className="px-3 py-1.5">
              <Star className="mr-1.5 h-3 w-3 fill-current text-primary" />
              Free forever · No sign-up · No watermarks
            </Badge>
          </div>

          <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl">
            Every PDF tool you need,
            <br />
            <span className="text-primary">without the upload.</span>
          </h1>

          <p className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground sm:text-lg">
            Merge, organize, convert and edit PDF files right in your browser. Your documents are
            processed on this device — they never touch a server. No “3 tasks per hour”, no
            account, no catch.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button size="lg" className="h-11 px-6 text-base" asChild>
              <Link to="/tools/merge-pdf">
                Merge PDFs — it’s free
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" className="h-11 px-6 text-base" asChild>
              <Link to="/tools/pdf-to-jpg">PDF to JPG</Link>
            </Button>
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground sm:text-sm">
            <span className="flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5 text-primary" />
              Files never leave your device
            </span>
            <span className="flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-primary" />
              Local processing — results in seconds
            </span>
            <span className="flex items-center gap-1.5">
              <Star className="h-3.5 w-3.5 text-primary" />
              40+ tools shipping, open source
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
