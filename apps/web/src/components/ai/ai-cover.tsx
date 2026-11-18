/**
 * The editor's frontispiece.
 *
 * Before a document is open, the page is a cover: one display sentence, one
 * folio-shaped drop target, and the marks this editor can make. It is not a
 * marketing hero inside a tool — every line here is true of the surface one
 * click later, and the target is the real input.
 *
 * The horizon at the lower right is the only atmosphere on the page; it is
 * masked before it can reach the copy or the drop target.
 */

import { useLayoutEffect, useRef } from 'react';
import {
  ArrowUpDown,
  Eraser,
  Highlighter,
  Printer,
  Quote,
  Replace,
  ScanText,
  Sparkles,
  Type,
  type LucideIcon,
} from 'lucide-react';
import { createTimeline } from 'animejs';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { StudioWaves } from '@/components/ai/studio-waves';
import { useMotionScope } from '@/hooks/use-motion';
import { DUR, EASE, dur, prefersReducedMotion, staggerUI } from '@/lib/motion';

export interface CoverMark {
  icon: 'highlight' | 'replace' | 'erase' | 'insert' | 'reorder' | 'stamp' | 'read' | 'cite' | 'ask';
  label: string;
  detail: string;
}

const MARK_ICON: Record<CoverMark['icon'], LucideIcon> = {
  highlight: Highlighter,
  replace: Replace,
  erase: Eraser,
  insert: Type,
  reorder: ArrowUpDown,
  stamp: Printer,
  read: ScanText,
  cite: Quote,
  ask: Sparkles,
};

interface AiCoverProps {
  title: [string, string];
  lead: string;
  quote: string;
  marginTitle: string;
  marks: CoverMark[];
  onFiles(files: File[]): void;
  note: string;
}

export function AiCover({
  title,
  lead,
  quote,
  marginTitle,
  marks,
  onFiles,
  note,
}: AiCoverProps) {
  const motion = useMotionScope();
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const parts = Array.from(root.querySelectorAll<HTMLElement>('[data-cover-enter]'));
    if (parts.length === 0 || prefersReducedMotion()) return;
    for (const part of parts) part.style.opacity = '0';
    const lines = root.querySelectorAll<HTMLElement>('[data-cover-line]');
    const lead = root.querySelector<HTMLElement>('[data-cover-lead]');
    const drop = root.querySelector<HTMLElement>('[data-cover-drop]');
    const marks = root.querySelectorAll<HTMLElement>('[data-cover-mark]');
    const quote = root.querySelector<HTMLElement>('[data-cover-quote]');
    const marginTitle = root.querySelector<HTMLElement>('.studio-cover-margin-title');
    const timeline = createTimeline({ defaults: { ease: EASE.out } });
    motion.park(timeline);
    timeline.add(
      lines,
      {
        opacity: [0, 1],
        translateY: [26, 0],
        duration: dur(DUR.slow + 120),
        delay: staggerUI(95),
      },
      0,
    );
    if (lead) {
      timeline.add(
        lead,
        { opacity: [0, 1], translateY: [14, 0], duration: dur(620) },
        dur(180),
      );
    }
    if (drop) {
      timeline.add(
        drop,
        { opacity: [0, 1], translateY: [16, 0], duration: dur(680) },
        dur(300),
      );
    }
    timeline.add(
      marks,
      {
        opacity: [0, 1],
        translateY: [10, 0],
        duration: dur(420),
        delay: staggerUI(55),
      },
      dur(360),
    );
    if (marginTitle) {
      timeline.add(marginTitle, { opacity: [0, 1], duration: dur(360) }, dur(330));
    }
    if (quote) {
      timeline.add(quote, { opacity: [0, 1], duration: dur(700) }, dur(520));
    }
    return () => {
      timeline.pause();
    };
  }, [motion]);

  return (
    <div ref={rootRef} className="studio-cover studio-plate">
      <div className="studio-cover-waves" aria-hidden>
        <StudioWaves />
      </div>

      <div className="studio-cover-grid">
        <div className="studio-cover-main">
          <h1 className="studio-cover-title">
            <span data-cover-enter data-cover-line className="block">
              {title[0]}
            </span>
            <span data-cover-enter data-cover-line className="block">
              {title[1]}
            </span>
          </h1>
          <p data-cover-enter data-cover-lead className="studio-cover-lead">
            {lead}
          </p>

          <div data-cover-enter data-cover-drop className="studio-cover-drop">
            <FileDropzone
              files={[]}
              onFiles={onFiles}
              multiple={false}
              appearance="studio"
              hint=""
              note={note}
            />
          </div>
        </div>

        <aside className="studio-cover-margin" aria-label="What the editor can do">
          <p data-cover-enter className="studio-cover-margin-title">
            <Sparkles className="h-3 w-3" aria-hidden />
            {marginTitle}
          </p>
          <ul className="mt-4 space-y-3.5">
            {marks.map((mark) => {
              const Icon = MARK_ICON[mark.icon];
              return (
                <li key={mark.label} data-cover-enter data-cover-mark className="studio-mark-row">
                  <span className="studio-mark-glyph" aria-hidden>
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0">
                    <p className="studio-mark-label">{mark.label}</p>
                    <p className="studio-mark-detail">{mark.detail}</p>
                  </div>
                </li>
              );
            })}
          </ul>
          <p data-cover-enter data-cover-quote className="studio-cover-quote">
            {quote}
          </p>
        </aside>
      </div>
    </div>
  );
}
