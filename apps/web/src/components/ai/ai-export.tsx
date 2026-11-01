/**
 * The export receipt.
 *
 * The last state of the editor is not a toast and not a generic success card:
 * it is the proof, returned. One display line says what happened, the receipt
 * states the facts the engine verified (re-parsed, text extracted), and the
 * single commit action is Download. The stamp is the one flourish — it lands
 * like a press, then stays still.
 *
 * Keep editing / start over stay available; nothing here re-runs an edit.
 */

import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, Download } from 'lucide-react';
import { createTimeline } from 'animejs';
import { Button } from '@/components/ui/button';
import { StudioWaves } from '@/components/ai/studio-waves';
import { useMagnetic } from '@/hooks/use-magnetic';
import { useMotionScope } from '@/hooks/use-motion';
import { formatBytes } from '@/lib/format';
import { announceLocalProcessing } from '@/lib/privacy';
import { nextFor } from '@/tools/registry';
import { useToolSlug } from '@/tools/tool-context';
import { DUR, EASE, dur, prefersReducedMotion, staggerUI } from '@/lib/motion';

interface AiExportProps {
  fileName: string;
  pageCount: number;
  sizeBytes: number;
  onDownload(): void;
  onReset(): void;
  footerNote?: string;
}

export function AiExport({
  fileName,
  pageCount,
  sizeBytes,
  onDownload,
  onReset,
  footerNote,
}: AiExportProps) {
  const slug = useToolSlug();
  const next = slug ? nextFor(slug) : [];
  const motion = useMotionScope();
  const rootRef = useRef<HTMLElement>(null);
  const stampRef = useRef<HTMLSpanElement>(null);
  const downloadRef = useMagnetic<HTMLButtonElement>(5);

  // The apply replaces the whole surface. Move focus to the receipt so a
  // keyboard or screen-reader user lands on the result, not on the body.
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    announceLocalProcessing(pageCount);
  }, [pageCount]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const lines = Array.from(root.querySelectorAll<HTMLElement>('[data-export-enter]'));
    if (prefersReducedMotion()) {
      for (const line of lines) line.style.opacity = '1';
      if (stampRef.current) stampRef.current.style.opacity = '1';
      return;
    }
    for (const line of lines) line.style.opacity = '0';
    if (stampRef.current) stampRef.current.style.opacity = '0';
    const timeline = createTimeline({ defaults: { ease: EASE.out } });
    motion.park(timeline);
    timeline.add(
      lines,
      { opacity: [0, 1], translateY: [14, 0], duration: dur(DUR.slow), delay: staggerUI(70) },
      0,
    );
    if (stampRef.current) {
      timeline.add(
        stampRef.current,
        {
          opacity: [0, 1],
          scale: [1.5, 1],
          rotate: [-16, -6],
          duration: dur(560),
          ease: 'outExpo',
        },
        dur(320),
      );
    }
    return () => {
      timeline.pause();
    };
  }, [motion]);

  return (
    <section
      ref={rootRef}
      tabIndex={-1}
      className="studio-export studio-plate"
      aria-labelledby="studio-export-title"
    >
      <div className="studio-export-waves" aria-hidden>
        <StudioWaves />
      </div>

      <div className="studio-export-sheet">
        <div className="studio-export-copy">
          <h2 id="studio-export-title" data-export-enter className="studio-export-title">
            Applied, and <br className="hidden sm:block" />
            verified.
          </h2>
          <p data-export-enter className="studio-export-lead">
            The engine wrote the queued changes into the document, then re-parsed the result.
            Nothing left this browser.
          </p>

          {footerNote ? (
            <details data-export-enter className="studio-export-details">
              <summary>What was verified</summary>
              <p>{footerNote}</p>
            </details>
          ) : null}

          <div data-export-enter className="studio-export-actions">
            <Button ref={downloadRef} className="studio-download" onClick={onDownload}>
              <Download className="h-4 w-4" />
              Download
              <ArrowUpRight className="ml-1 h-3.5 w-3.5 opacity-70" />
            </Button>
            <button type="button" onClick={onReset} className="studio-text-link">
              <ArrowLeft className="h-3.5 w-3.5" />
              Start over
            </button>
          </div>
        </div>

        <div data-export-enter className="studio-receipt">
          <span ref={stampRef} className="studio-stamp" aria-hidden>
            Applied
          </span>
          <dl>
            <div>
              <dt>File</dt>
              <dd className="studio-receipt-file" title={fileName}>
                {fileName}
              </dd>
            </div>
            <div>
              <dt>Pages</dt>
              <dd className="tabular-nums">{pageCount.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd className="tabular-nums">{formatBytes(sizeBytes)}</dd>
            </div>
            <div>
              <dt>Checks</dt>
              <dd>Re-parsed, text extracted</dd>
            </div>
          </dl>
        </div>

        {next.length > 0 ? (
          <div data-export-enter className="studio-export-next">
            <p className="studio-export-next-label">Continue with</p>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {next.map((def) => (
                <Link key={def.slug} to={`/tools/${def.slug}`} className="studio-next-link">
                  {def.name}
                  <ArrowUpRight className="h-3 w-3" />
                </Link>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
