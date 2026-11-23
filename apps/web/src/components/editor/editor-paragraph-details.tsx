/**
 * Detection details for one paragraph.
 *
 * The point of this panel is honesty: every value comes from the same model the
 * editor used, and "unknown" is said out loud instead of guessed. Post-save
 * outcome is attached by paragraph id, so the panel can answer "what actually
 * happened to this paragraph?" rather than describing the preview.
 */

import { useMemo, useState } from 'react';
import { ArrowLeft, Copy, PencilLine, RotateCcw } from 'lucide-react';
import type {
  PageLayout,
  Paragraph,
  PageTextCapability,
  TextEditOutcome,
} from '@pdfshush/pdf-core';
import { Button } from '@/components/ui/button';
import type { ParagraphEditRecord } from '@/lib/text-editing';
import { CAPABILITY_SNAPSHOT_NOTE, textLayerLabel } from '@/lib/page-capability-copy';

export interface EditorParagraphDetailsProps {
  paragraph: Paragraph;
  layout: PageLayout;
  capability: PageTextCapability | null;
  record: ParagraphEditRecord | null;
  outcome: TextEditOutcome | null;
  /** O-04: session confidence when this page was OCR'd here. */
  ocrConfidence?: number | null;
  onBack: () => void;
  onEdit: () => void;
  onRevert: () => void;
  disabled?: boolean;
}

const ROLE_LABELS: Record<Paragraph['role'], string> = {
  body: 'Body',
  heading: 'Heading',
  'list-item': 'List item',
  caption: 'Caption',
  footnote: 'Footnote',
  'table-cell': 'Table cell',
  header: 'Header',
  footer: 'Footer',
  unknown: 'Unknown',
};

function outcomeLabel(outcome: TextEditOutcome | null, record: ParagraphEditRecord | null): string {
  if (!outcome) {
    if (!record) return 'Not saved yet';
    return record.styled
      ? 'Will be drawn as an overlay (requested style)'
      : 'Will use the native reflow path';
  }
  if (outcome.mode === 'in-place') return 'Rewritten in place';
  if (outcome.mode === 'content-stream') return 'Rewritten through the content stream';
  if (outcome.mode === 'fallback') {
    return `Overlay${outcome.reason ? ` — ${outcome.reason}` : ''}`;
  }
  return 'Left for manual review';
}

function fact(label: string, value: string): [string, string] {
  return [label, value];
}

export function EditorParagraphDetails({
  paragraph,
  layout,
  capability,
  record,
  outcome,
  ocrConfidence,
  onBack,
  onEdit,
  onRevert,
  disabled,
}: EditorParagraphDetailsProps) {
  const [copied, setCopied] = useState(false);
  const firstLine = useMemo(
    () => layout.lines.find((line) => line.id === paragraph.lineIds[0]) ?? null,
    [layout.lines, paragraph.lineIds],
  );
  const facts = useMemo(
    () => [
      fact('Page', String(paragraph.pageIndex + 1)),
      fact(
        'Box',
        `${paragraph.bbox.x.toFixed(1)}, ${paragraph.bbox.y.toFixed(1)} · ${paragraph.bbox.width.toFixed(
          1,
        )} × ${paragraph.bbox.height.toFixed(1)} pt`,
      ),
      fact('Lines', String(paragraph.lineIds.length)),
      fact('First baseline', firstLine ? `${firstLine.baseline.toFixed(1)} pt` : 'Not reported'),
      fact(
        'Font',
        `${paragraph.typography.fontFamilyLabel || paragraph.typography.fontFamily} · ${paragraph.typography.fontFamily}`,
      ),
      fact('Size', `${paragraph.typography.fontSize.toFixed(1)} pt`),
      fact('Rotation', `${Math.round(paragraph.typography.rotationDeg)}°`),
      fact('Bold', paragraph.typography.bold ? 'Yes' : 'No'),
      fact('Italic', paragraph.typography.italic ? 'Yes' : 'No'),
      fact('Alignment', paragraph.alignment),
      fact('Role', ROLE_LABELS[paragraph.role]),
      fact(
        'Confidence',
        `${Math.round(paragraph.confidence * 100)}%${paragraph.ambiguous ? ' · ambiguous grouping' : ''}`,
      ),
      fact('Text layer', textLayerLabel(capability)),
      fact('Colour', paragraph.typography.color ?? 'Not detected'),
      fact(
        'Source',
        capability?.textLayer === 'ocr' || capability?.textLayer === 'mixed'
          ? ocrConfidence !== undefined && ocrConfidence !== null
            ? `OCR · ${Math.round(ocrConfidence)}% page confidence (check the text)`
            : 'OCR text layer · confidence not recorded in this session'
          : 'Page-level model',
      ),
      fact('Char spacing', paragraph.typography.charSpacing !== undefined ? `${paragraph.typography.charSpacing.toFixed(2)} pt` : 'Not reported'),
      fact('Paragraph id', paragraph.id),
    ],
    [capability, firstLine, ocrConfidence, paragraph],
  );

  const copyText = `Paragraph ${paragraph.id}\n${facts
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n')}\nOutcome: ${outcomeLabel(outcome, record)}\n${CAPABILITY_SNAPSHOT_NOTE}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto px-4 py-4" data-testid="editor-paragraph-details">
      <div className="flex items-start gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          aria-label="Back to text block"
          data-testid="editor-paragraph-details-back"
          onClick={onBack}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Detection details</p>
          <p className="truncate text-xs text-muted-foreground">
            {ROLE_LABELS[paragraph.role]} · {paragraph.lineIds.length} line
            {paragraph.lineIds.length === 1 ? '' : 's'} · {Math.round(paragraph.confidence * 100)}%
            confidence
          </p>
        </div>
      </div>

      {record ? (
        <p
          className="rounded-md border border-blue-200 bg-blue-50 px-2.5 py-2 text-[11px] leading-relaxed text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-100"
          data-testid="editor-paragraph-details-styled"
        >
          {outcomeLabel(outcome, record)}. The paragraph currently exports{' '}
          {record.styled ? 'as styled overlay text' : 'through the native reflow path'}.
        </p>
      ) : null}

      <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-[11px] leading-relaxed">
        {facts.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="break-words text-foreground">{value}</dd>
          </div>
        ))}
      </dl>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {CAPABILITY_SNAPSHOT_NOTE}
      </p>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Post-save: {outcomeLabel(outcome, record)}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          data-testid="editor-paragraph-details-edit"
          disabled={disabled}
          onClick={onEdit}
        >
          <PencilLine className="mr-1.5 size-3.5" /> Edit text
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="editor-paragraph-details-revert"
          disabled={disabled || !record}
          onClick={onRevert}
        >
          <RotateCcw className="mr-1.5 size-3.5" /> Revert
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid="editor-paragraph-details-copy"
          onClick={() => void copy()}
        >
          <Copy className="mr-1.5 size-3.5" /> {copied ? 'Copied' : 'Copy details'}
        </Button>
      </div>
      <span className="sr-only" aria-live="polite">
        {copied ? 'Paragraph details copied to the clipboard.' : ''}
      </span>
    </div>
  );
}
