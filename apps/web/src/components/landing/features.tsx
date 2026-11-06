import { useEffect, useRef, useState } from 'react';
import { Check, Play, ShieldCheck, X } from 'lucide-react';
import { AsciiLoop } from '@/components/landing/ascii-loop';
import { RevealText } from '@/components/landing/reveal-text';
import { useIsDark } from '@/hooks/use-is-dark';

const CLAIMS = [
  {
    title: 'Nothing is ever uploaded.',
    body: 'Your file goes straight into memory and into a Web Worker. Watch DevTools during a merge.',
  },
  {
    title: 'No quotas, no watermarks.',
    body: 'The work runs on your hardware, so there is no hourly cap and no sign-up.',
  },
  {
    title: 'Deletion you can verify.',
    body: 'Redaction wipes the pixels and text layer, then reopens the file to check.',
  },
];

const COMPARISON_ROWS = [
  {
    feature: 'File uploads to server',
    traditional: 'Required for every action',
    pdfshush: 'Zero uploads, runs locally',
  },
  {
    feature: 'Free task quota',
    traditional: 'Capped (e.g. 3 tasks / hour)',
    pdfshush: 'Unlimited client-side tasks',
  },
  {
    feature: 'AI key storage',
    traditional: 'Stored on vendor database',
    pdfshush: 'Local browser storage only',
  },
  {
    feature: 'Source code auditability',
    traditional: 'Proprietary black box',
    pdfshush: 'AGPL-3.0, open source',
  },
  {
    feature: 'Account requirement',
    traditional: 'Mandatory for most exports',
    pdfshush: 'Never required for local tools',
  },
];

/**
 * Dark-mode loop for the section's second visual: luminous data fragments
 * reassemble into a rooted silver tree. Silent and self-contained: playback
 * arms only when the frame is near the viewport (IntersectionObserver with
 * edge hysteresis), and the browser pauses it offscreen. Visitors whose
 * system asks for reduced motion, or whose browser denies autoplay, get the
 * matching poster still plus a small one-click play control, so the motion
 * preference is respected without ever leaving dead content.
 *
 * Light mode swaps this medium for the ASCII drawing (AsciiLoop): same slot,
 * same 3:4 frame, so the theme flips the artwork and never the layout.
 */
function DocumentLoopVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  // True whenever the automatic start is withheld (reduced motion or a
  // blocked autoplay promise); a durable play control is offered instead.
  const [gated, setGated] = useState(true);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    let observer: IntersectionObserver | null = null;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');

    const armAutoplay = () => {
      observer?.disconnect();
      if (mql.matches) {
        setGated(true);
        return;
      }
      // Hysteresis so the loop never stutters at the viewport edge: playback
      // starts once a fifth of the frame is visible, and pauses only when the
      // frame has fully left (the 240px lead warms the fetch before arrival).
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.intersectionRatio >= 0.2) {
              void el
                .play()
                .then(() => setGated(false))
                .catch(() => setGated(true));
            } else if (entry.intersectionRatio === 0) {
              el.pause();
            }
          }
        },
        { threshold: [0, 0.2], rootMargin: '0px 0px 240px 0px' },
      );
      observer.observe(el);
    };

    armAutoplay();
    mql.addEventListener('change', armAutoplay);
    return () => {
      observer?.disconnect();
      mql.removeEventListener('change', armAutoplay);
      el.pause();
    };
  }, []);

  useEffect(() => {
    // React sets the `muted` attribute after the element mounts, which lets
    // Safari play a frame of audio on first load; force the DOM property.
    if (videoRef.current) videoRef.current.muted = true;
  }, []);

  // One quiet gesture starts the loop whenever the browser withheld it.
  const startLoop = () => {
    void videoRef.current
      ?.play()
      .then(() => setGated(false))
      .catch(() => {});
  };

  return (
    <div className="relative overflow-hidden rounded-lg">
      <video
        ref={videoRef}
        // Fast-start MP4 (moov first): ~2.6 MB, H.264, 720x1280, 10 s loop.
        // preload only fetches the header; the body arrives when playback is armed.
        preload="metadata"
        poster="/brand/pindown-tree-poster.jpg"
        loop
        muted
        playsInline
        aria-label="Fragments of luminous data reassembling into a silver tree with deep roots, looping on black"
        className="aspect-[3/4] w-full object-cover"
        style={{ objectPosition: '50% 40%' }}
        src="/brand/pindown-tree.mp4"
      />
      {gated && (
        <button
          type="button"
          onClick={startLoop}
          aria-label="Play the document loop"
          className="absolute bottom-5 left-1/2 flex h-12 w-12 -translate-x-1/2 items-center justify-center rounded-full bg-white/12 text-white ring-1 ring-white/25 transition-colors hover:bg-white/25 hover:ring-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        >
          <Play className="ml-0.5 h-4.5 w-4.5" />
        </button>
      )}
    </div>
  );
}

export function FeaturesSection() {
  const isDark = useIsDark();

  return (
    <section id="architecture" className="bg-muted/15 py-16 sm:py-24 dark:bg-[oklch(0.05_0_0)]">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Narrative left, the subject's own material right */}
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-14">
          <div className="lg:col-span-7" data-reveal>
            <RevealText
              as="h2"
              text="Why it runs on your machine."
              className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl"
            />
            <p className="mt-3 max-w-2xl text-base text-foreground sm:text-lg">
              Most PDF sites take your file. This one keeps it in the tab.
            </p>

            <div className="mt-9 space-y-8">
              {CLAIMS.map((claim, index) => (
                <div key={claim.title} data-reveal data-reveal-delay={index * 90}>
                  <RevealText
                    as="h3"
                    text={claim.title}
                    stagger={20}
                    className="text-lg font-semibold tracking-tight text-foreground"
                  />
                  <p className="mt-1.5 max-w-2xl text-[15px] leading-relaxed text-foreground sm:text-base">
                    {claim.body}
                  </p>
                </div>
              ))}
            </div>

            <p className="mt-10 max-w-2xl text-base leading-relaxed text-muted-foreground">
              Your AI key stays in browser storage, purgeable in one click. The stack is AGPL-3.0
              and self-hostable, so you can audit it.
            </p>
          </div>

          <figure className="feature-loop hidden lg:col-span-5 lg:block" data-reveal data-reveal-delay="120">
            {/* One deliberate loop, no caption: the section's second visual.
                The medium follows the theme; the frame never moves. */}
            {isDark ? <DocumentLoopVideo /> : <AsciiLoop />}
          </figure>
        </div>

        {/* Side-by-side comparison: the local column is the only one tinted,
            so the eye reads the contrast before it reads the labels. */}
        <div
          className="trust-table mt-16 overflow-hidden rounded-2xl border border-border/60 bg-card"
          data-reveal
          data-reveal-delay="100"
        >
          <div className="flex flex-col gap-3 border-b border-border/60 px-6 py-6 sm:flex-row sm:items-end sm:justify-between sm:px-8">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
                The difference
              </p>
              <h3 className="mt-1.5 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                Cloud tools vs. your browser
              </h3>
            </div>
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
              <ShieldCheck className="h-3.5 w-3.5" />
              Local by default
            </span>
          </div>

          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  <th className="px-6 py-3.5 font-medium sm:px-8">Capability</th>
                  <th className="px-6 py-3.5 font-medium">Standard online tools</th>
                  <th className="border-x border-primary/10 bg-primary/[0.05] px-6 py-3.5 font-semibold text-foreground">
                    PDFShush
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {COMPARISON_ROWS.map((row) => (
                  <tr key={row.feature} className="group transition-colors hover:bg-muted/25">
                    <td className="px-6 py-4 font-medium text-foreground sm:px-8">{row.feature}</td>
                    <td className="px-6 py-4 text-muted-foreground">
                      <span className="flex items-center gap-2">
                        <X className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                        {row.traditional}
                      </span>
                    </td>
                    <td className="border-x border-primary/10 bg-primary/[0.05] px-6 py-4 font-medium text-foreground transition-colors group-hover:bg-primary/[0.08]">
                      <span className="flex items-center gap-2">
                        <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        {row.pdfshush}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phones stack the comparison: all three values stay visible
              without a horizontal scroll. */}
          <div className="divide-y divide-border/50 sm:hidden">
            {COMPARISON_ROWS.map((row) => (
              <div key={row.feature} className="px-5 py-4">
                <p className="text-sm font-medium text-foreground">{row.feature}</p>
                <p className="mt-2 flex items-start gap-2 text-xs text-muted-foreground">
                  <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                  {row.traditional}
                </p>
                <p className="mt-1.5 flex items-start gap-2 rounded-md bg-primary/[0.06] px-2 py-1.5 text-xs font-medium text-foreground">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  {row.pdfshush}
                </p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 px-6 py-4 text-xs text-muted-foreground sm:px-8">
            <span>No account. No upload. Nothing to cancel.</span>
            <span>AGPL-3.0, auditable</span>
          </div>
        </div>
      </div>
    </section>
  );
}
