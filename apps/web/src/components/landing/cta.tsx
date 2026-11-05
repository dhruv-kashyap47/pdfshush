import { ArrowRight, Bot, Merge } from 'lucide-react';
import { Link } from 'react-router-dom';
import GradientWaves from '@/components/GradientWaves';
import { RevealText } from '@/components/landing/reveal-text';
import { Button } from '@/components/ui/button';

export function CtaSection() {
  return (
    <section className="bg-muted/15 py-16 sm:py-24 dark:bg-[oklch(0.05_0_0)]">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* The designed close: a living field of the accent colour, one action,
            and the DevTools proof as the supporting line. */}
        <div
          className="cta-field relative isolate overflow-hidden rounded-2xl bg-primary px-6 py-16 text-center sm:px-12 sm:py-24"
          data-reveal
        >
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
            <GradientWaves
              horizonColor="#064e3b"
              waveColor="#022c22"
              crestColor="#34d399"
              lightMode
              speed={0.28}
              amplitude={2.4}
              waveScale={0.75}
              waveRatio={0.9}
              swell={30}
              turbulence={18}
              tilt={60}
              zoom={0.92}
              height={4.5}
              fogDepth={18}
              relief={0.9}
              sheen={0.35}
              brightness={1}
              opacity={0.7}
              grain={0.08}
              quality="medium"
              parallaxStrength={0.35}
            />
          </div>
          <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-primary/25 via-primary/10 to-primary/50" />
          <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_50%_0%,oklch(1_0_0/0.16),transparent_60%)]" />

          <div className="relative mx-auto max-w-2xl">
            <RevealText
              as="h2"
              text="Open a PDF. Nothing leaves this tab."
              className="text-3xl font-bold tracking-tight text-primary-foreground sm:text-4xl lg:text-5xl"
            />
            <p className="mx-auto mt-3 max-w-xl text-base leading-relaxed text-primary-foreground/90 sm:text-lg">
              Try your most sensitive documents. Every byte stays in this browser, and DevTools
              can prove it.
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
                className="cta-secondary h-11 px-4 text-sm font-medium text-primary-foreground shadow-none hover:bg-primary/85"
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
