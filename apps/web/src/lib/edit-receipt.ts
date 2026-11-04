/**
 * D3 (PLAN.md §31.4): the honest editing ladder, made visible after export.
 *
 * The engine already records how each edit was actually applied and says so per
 * edit. Until now that information existed for one toast and then vanished. A
 * receipt is the durable form: what was rewritten, what was merely drawn over
 * the original, and what still needs a human.
 *
 * Two rules make it honest rather than decorative:
 *
 *  - `fallback` is never softened. The original text is still in the file under
 *    the overlay, so a receipt that said "edited" would be a lie the user could
 *    disprove by selecting the text. The sentence names the consequence.
 *  - the receipt has no timestamp. The same export always produces the same
 *    text, so two receipts can be compared byte for byte.
 */

import type { TextEditJobReport, TextEditMode } from '@pdfshush/pdf-core';
import { formatBytes } from '@/lib/format';

export interface EditModeSummary {
  mode: TextEditMode;
  count: number;
  /** Short label for a chip or a heading. */
  label: string;
  /** What this mode means for the document the user just downloaded. */
  detail: string;
}

/**
 * The copy is the product promise, so it lives next to the test that pins it.
 * `fallback` and `manual-review` are deliberately blunt.
 */
export const EDIT_MODE_COPY: Record<TextEditMode, { label: string; detail: string }> = {
  'in-place': {
    label: 'Rewritten in place',
    detail:
      "The document's own text object was replaced. Font, size, colour and position are the original's.",
  },
  'content-stream': {
    label: 'Rewritten in the content stream',
    detail:
      "The page's text-drawing operator was rewritten with the same font. The old glyphs are no longer in the content stream.",
  },
  fallback: {
    label: 'Drawn over the original',
    detail:
      'New text was drawn on top; the original text is still in the file underneath it, so it remains selectable, searchable and recoverable. Use Redact if the old words must be gone.',
  },
  'manual-review': {
    label: 'Left for manual review',
    detail: 'Nothing was changed for these edits: fidelity could not be guaranteed.',
  },
};

/** Most-degraded first is the wrong order for a receipt; read it like a story. */
const MODE_ORDER: TextEditMode[] = ['in-place', 'content-stream', 'fallback', 'manual-review'];

/** Only the modes that actually occurred, in a stable order. */
export function summarizeEditModes(report: TextEditJobReport): EditModeSummary[] {
  const counts: Record<TextEditMode, number> = {
    'in-place': report.inPlace,
    'content-stream': report.contentStream,
    fallback: report.fallback,
    'manual-review': report.manualReview,
  };
  return MODE_ORDER.filter((mode) => counts[mode] > 0).map((mode) => ({
    mode,
    count: counts[mode],
    label: EDIT_MODE_COPY[mode].label,
    detail: EDIT_MODE_COPY[mode].detail,
  }));
}

export function totalEdits(report: TextEditJobReport): number {
  return report.inPlace + report.contentStream + report.fallback + report.manualReview;
}

/**
 * True when at least one edit left the original words recoverable. The UI uses
 * this to decide whether the receipt deserves the warning treatment rather than
 * a quiet line.
 */
export function hasRecoverableOriginal(report: TextEditJobReport): boolean {
  return report.fallback > 0;
}

export interface EditReceiptInput {
  fileName: string;
  pageCount: number;
  sizeBytes: number;
  report: TextEditJobReport;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;
}

/**
 * Plain text, stable, no timestamp. This is what Copy puts on the clipboard and
 * what Download saves as `.txt` beside the PDF.
 */
export function formatEditReceipt(input: EditReceiptInput): string {
  const { fileName, pageCount, sizeBytes, report } = input;
  const summaries = summarizeEditModes(report);
  const total = totalEdits(report);
  const checks = report.verification.checks;
  const failedChecks = checks.filter((check) => !check.ok);

  const lines: string[] = [
    'PDFShush edit receipt',
    `File: ${fileName}`,
    `Pages: ${pageCount.toLocaleString('en-US')}`,
    `Size: ${formatBytes(sizeBytes)}`,
    '',
  ];

  if (total === 0) {
    lines.push('Text edits: none. This export changed objects, forms or page order only.');
  } else {
    lines.push(`Text edits: ${plural(total, 'edit')}`);
    for (const summary of summaries) {
      lines.push(`  ${summary.count} × ${summary.label.toLowerCase()} — ${summary.detail}`);
    }
  }

  lines.push('');
  if (checks.length === 0) {
    lines.push('Verification: no checks were run for this export.');
  } else if (report.verification.ok) {
    lines.push(
      `Verification: ${checks.length} of ${checks.length} checks passed. The exported bytes were`
        + ' reopened and re-extracted before the download was offered.',
    );
  } else {
    lines.push(
      `Verification: ${failedChecks.length} of ${plural(checks.length, 'check')} failed.`,
    );
    for (const check of failedChecks) lines.push(`  ${check.name}: ${check.detail}`);
  }

  if (report.warnings.length > 0) {
    lines.push('', 'Warnings:');
    for (const warning of report.warnings) lines.push(`  ${warning}`);
  }

  lines.push(
    '',
    'Proof: the file was never uploaded. This receipt was produced on this device from the exported bytes.',
  );

  return `${lines.join('\n')}\n`;
}

/** `report.pdf` → `report-edit-receipt.txt`. Deterministic, no date. */
export function receiptFileNameFor(pdfName: string): string {
  const stem = pdfName.replace(/\.pdf$/i, '') || 'document';
  return `${stem}-edit-receipt.txt`;
}
