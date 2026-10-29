import { useEffect, useRef, useState } from 'react';
import { Check, Play, X } from 'lucide-react';

const CLAIMS = [
  {
    title: 'Nothing is ever uploaded.',
    body: 'Client tools read your file straight into memory in this tab and hand it to Web Workers; no network uploads occur. Open DevTools and watch the traffic during any merge.',
  },
  {
    title: 'No task quotas to hit.',
    body: 'The work runs on your own hardware, so there is no 3-tasks-per-hour ceiling, no watermark and no sign-up for anything browser-based.',
  },
  {
    title: 'Deletion you can verify.',
    body: 'Redaction is not a black rectangle: pages are rebuilt as sanitized rasters, the text layer is stripped, and the output is reopened and checked before you receive it.',
  },
];

const COMPARISON_ROWS = [
  {
    feature: 'File uploads to server',
    traditional: 'Required for every action',
    pdfshush: 'Zero uploads, runs locally',
    pdfshushOk: true,
  },
  {
    feature: 'Free task quota',
    traditional: 'Capped (e.g. 3 tasks / hour)',
    pdfshush: 'Unlimited client-side tasks',
    pdfshushOk: true,
  },
  {
    feature: 'AI key storage',
    traditional: 'Stored on vendor database',
    pdfshush: 'Local browser storage only',
    pdfshushOk: true,
  },
  {
    feature: 'Source code auditability',
    traditional: 'Proprietary black box',
    pdfshush: 'AGPL-3.0, open source',
    pdfshushOk: true,
  },
  {
    feature: 'Account requirement',
    traditional: 'Mandatory for most exports',
    pdfshush: 'Never required for local tools',
    pdfshushOk: true,
  },
];

/**
 * Cinematic loop for the section's second visual: luminous data fragments
 * reassemble into a rooted silver tree. Silent and self-contained: playback
 * arms only when the frame is near the viewport (IntersectionObserver with
 * edge hysteresis), and the browser pauses it offscreen. Visitors whose
 * system asks for reduced motion, or whose browser denies autoplay, get the
 * matching poster still plus a small one-click play control, so the motion
 * preference is respected without ever leaving dead content.
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
  return (
    <section id="architecture" className="bg-muted/15 py-16 sm:py-24 dark:bg-[oklch(0.05_0_0)]">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Narrative left, the subject's own material right */}
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-14">
          <div className="lg:col-span-7" data-reveal>
            <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Why it runs on your machine.
            </h2>
            <p className="mt-3 max-w-2xl text-base text-foreground sm:text-lg">
              Most PDF sites exist to take the file from you. This one exists to keep it where it
              is, and the architecture is the argument.
            </p>

            <div className="mt-9 space-y-8">
              {CLAIMS.map((claim) => (
                <div key={claim.title}>
                  <h3 className="text-lg font-semibold tracking-tight text-foreground">{claim.title}</h3>
                  <p className="mt-1.5 max-w-2xl text-[15px] leading-relaxed text-foreground sm:text-base">
                    {claim.body}
                  </p>
                </div>
              ))}
            </div>

            <p className="mt-10 max-w-2xl text-base leading-relaxed text-muted-foreground">
              Your AI key sits in local browser storage and can be purged in one click. The whole
              stack is AGPL-3.0 and self-hostable, so any of this can be audited rather than
              believed.
            </p>
          </div>

          <figure className="lg:col-span-5" data-reveal data-reveal-delay="120">
            {/* One deliberate loop, no caption: the section's second visual. */}
            <DocumentLoopVideo />
          </figure>
        </div>

        {/* Side-by-side comparison matrix — a real table keeps its rules. */}
        <div className="trust-table mt-16 overflow-hidden rounded-xl bg-card" data-reveal data-reveal-delay="100">
          <div className="bg-muted/30 px-6 py-4">
            <h3 className="text-[15px] font-semibold text-foreground">
              Traditional cloud tools vs. PDFShush
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              {/* taste-skill-ignore: real table */}
              <thead className="border-b border-border/60 bg-muted/10 font-semibold text-foreground">
                <tr>
                  <th className="px-6 py-3.5">Capability</th>
                  <th className="px-6 py-3.5 font-normal text-muted-foreground">Standard online PDF services</th>
                  <th className="px-6 py-3.5 font-bold text-primary">PDFShush</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {COMPARISON_ROWS.map((row) => (
                  <tr key={row.feature} className="transition-colors hover:bg-muted/10">
                    <td className="px-6 py-3.5 font-medium text-foreground">{row.feature}</td>
                    <td className="px-6 py-3.5 text-muted-foreground">
                      <span className="flex items-center gap-1.5 text-destructive/90">
                        <X className="h-3.5 w-3.5" />
                        {row.traditional}
                      </span>
                    </td>
                    <td className="px-6 py-3.5 font-medium text-foreground">
                      <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                        <Check className="h-3.5 w-3.5" />
                        {row.pdfshush}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
