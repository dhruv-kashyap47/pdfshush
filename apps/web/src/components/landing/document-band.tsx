/**
 * The page's one deliberate poster moment between the catalog and the pitch:
 * a full-bleed brand strip. stem-3 is white dots on black, the one plate the
 * dark-only site serves: the folder, wordmark and peak geometry hold dead
 * centre while the dot peaks run past the frame edges. The crop is
 * deliberate. No scrim, no credit line; the type sits in the void below.
 *
 * The plate is alive in normal scrolling, not just on a refresh: the one-time
 * settle zoom arms the first time the band enters the viewport, and a shallow
 * scroll-linked drift on a wrapper layer gives the dot field depth against
 * the page (transform-only). The plate's own canvas *is* the page ground, so
 * there is no visible panel edge at all.
 */
import { useEffect, useRef } from 'react';
import { prefersReducedMotion } from '@/lib/motion';

export function DocumentBand() {
  const sectionRef = useRef<HTMLElement>(null);
  const plateRef = useRef<HTMLDivElement>(null);
  const reducedMotion = prefersReducedMotion();

  useEffect(() => {
    if (reducedMotion) return;
    const section = sectionRef.current;
    const plate = plateRef.current;
    if (!section || !plate) return;
    const imgs = section.querySelectorAll<HTMLImageElement>('.band-photo');

    /* Arm the one-time settle the first time the band is actually on screen.
       A load-timed take is over before a normal scroll ever arrives. Both
       theme plates share the same beat, so whichever one is visible settles. */
    const settleObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          for (const img of imgs) img.setAttribute('data-settle', '');
          settleObserver.disconnect();
          break;
        }
      },
      { threshold: 0.25 },
    );
    settleObserver.observe(section);

    /* The living layer: progress 0 (band top at viewport bottom) through 1
       (band bottom past viewport top) maps to a ±26px vertical drift. A
       rAF-throttled scroll handler beats anime's onScroll here: the drift
       must track the band's exact on-screen span, deterministically. */
    const BAND_DRIFT_PX = 26;
    let raf = 0;
    const drift = () => {
      raf = 0;
      const rect = section.getBoundingClientRect();
      const span = window.innerHeight + rect.height;
      const progress = span > 0 ? (window.innerHeight - rect.top) / span : 0;
      const clamped = Math.max(0, Math.min(1, progress));
      plate.style.transform = `translate3d(0, ${BAND_DRIFT_PX - 2 * BAND_DRIFT_PX * clamped}px, 0)`;
    };
    const scheduleDrift = () => {
      if (!raf) raf = requestAnimationFrame(drift);
    };
    drift();
    addEventListener('scroll', scheduleDrift, { passive: true });
    addEventListener('resize', scheduleDrift, { passive: true });

    return () => {
      settleObserver.disconnect();
      removeEventListener('scroll', scheduleDrift);
      removeEventListener('resize', scheduleDrift);
      cancelAnimationFrame(raf);
      plate.style.transform = '';
    };
  }, [reducedMotion]);

  return (
    <section
      ref={sectionRef}
      aria-label="Private document processing"
      className="overflow-hidden bg-background dark:bg-black"
    >
      <div
        ref={plateRef}
        className={`band-plate ${reducedMotion ? '' : 'will-change-transform'}`}
      >
        {/* The dark plate is the one and only plate: the site is dark-only and
            the strip paints pure black, so it melts into --background with no
            visible rectangle and the wording below shares the same ground.
            `data-bleed` is read by tests/sweep.mjs: the settle zoom scales the
            photo past the viewport and the plate clips it, so it must not be
            reported as page overflow. */}
        <picture>
          <img
            src="/brand/stem-3.png"
            width={1854}
            height={848}
            alt="The pdfshush mark: a blue folder with its wordmark, held between two halftone peaks drawn in white dots on black"
            loading="lazy"
            decoding="async"
            draggable={false}
            data-bleed
            className="band-photo hidden h-[320px] w-full object-cover sm:block sm:h-[440px] lg:h-[500px]"
            style={{ objectPosition: '50% 46%' }}
          />
        </picture>
      </div>
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:pb-24 sm:pt-20 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <p
            className="text-balance text-2xl font-semibold leading-snug tracking-tight text-foreground dark:text-white sm:text-4xl"
            data-reveal
          >
            The tools stay powerful. The document stays yours.
          </p>
          <p
            className="mx-auto mt-4 max-w-xl text-balance text-[15px] leading-relaxed text-muted-foreground dark:text-white/70 sm:mt-5 sm:text-base"
            data-reveal
            data-reveal-delay="120"
          >
            Every merge, convert, redact and sign runs locally in this tab, so sensitive files
            never touch a server and never leave your control.
          </p>
        </div>
      </div>
    </section>
  );
}
