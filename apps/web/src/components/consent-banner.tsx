import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  analyticsLoaded,
  browserStorage,
  browserTimeZone,
  decideMeasurement,
  loadAnalytics,
  onOpenConsentSettings,
  openConsentSettings,
  readChoice,
  writeChoice,
  type ConsentChoice,
} from '@/lib/consent';

/**
 * The measurement choice.
 *
 * It stays out of the prerendered HTML on purpose: the decision depends on a
 * stored answer and a clock, neither of which exists at build time. The panel
 * mounts after hydration, which is also why the container is injected from here
 * rather than written into `index.html`.
 */
export function ConsentBanner() {
  const [state, setState] = useState<'hidden' | 'asking' | 'saved'>('hidden');
  const [choice, setChoice] = useState<ConsentChoice | null>(null);

  useEffect(() => {
    const storage = browserStorage();
    const stored = readChoice(storage);
    setChoice(stored);

    const decision = decideMeasurement({ choice: stored, timeZone: browserTimeZone() });
    if (decision === 'load') {
      loadAnalytics();
    } else if (decision === 'ask') {
      setState('asking');
    }

    return onOpenConsentSettings(() => {
      setChoice(readChoice(browserStorage()));
      setState('asking');
    });
  }, []);

  const answer = (next: ConsentChoice) => {
    writeChoice(next, browserStorage());
    setChoice(next);

    if (next === 'granted') {
      loadAnalytics();
      setState('hidden');
      return;
    }

    // A container already on this page cannot be un-loaded. Reloading is the
    // only honest way to say "stopped": the next document reads `denied` and
    // never injects it.
    if (analyticsLoaded()) {
      window.location.reload();
      return;
    }
    setState('saved');
  };

  if (state === 'hidden') return null;

  return (
    <section
      aria-label="Measurement choice"
      className="fixed bottom-4 left-4 z-50 w-[min(24rem,calc(100vw-2rem))] rounded-lg border border-border bg-background/95 p-4 shadow-xl backdrop-blur"
    >
      {state === 'asking' ? (
        <>
          <h2 className="text-sm font-semibold text-foreground">Count this visit?</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
            One Google tag counts page views so the site knows which guides are read. It never
            receives a document, a filename or anything you open in a tool. Saying no changes
            nothing about the tools.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => answer('granted')}>
              Allow measurement
            </Button>
            <Button size="sm" variant="outline" onClick={() => answer('denied')}>
              No thanks
            </Button>
            <Link
              to="/privacy#analytics"
              className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              What is sent
            </Link>
          </div>
          {choice ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Currently {choice === 'granted' ? 'allowed' : 'off'}. Choosing again applies
              immediately.
            </p>
          ) : null}
        </>
      ) : (
        <>
          <h2 className="text-sm font-semibold text-foreground">Measurement is off</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
            This page will not load the Google tag. Every tool keeps working, and you can change
            your mind here or from the footer at any time.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => answer('granted')}>
              Turn measurement on
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setState('hidden')}>
              Close
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

/** Footer entry point: reopens the panel with the current answer. */
export function PrivacySettingsButton({ className }: { className?: string }) {
  return (
    <button type="button" onClick={openConsentSettings} className={className}>
      Privacy settings
    </button>
  );
}
