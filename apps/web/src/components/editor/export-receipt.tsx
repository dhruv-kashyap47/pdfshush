/**
 * D3: the durable half of the editing ladder.
 *
 * The toast says what happened once; this card says it for as long as the
 * download is on screen, and lets the user keep the receipt beside the PDF. The
 * `fallback` row is the one that matters: it states that the original words are
 * still in the file, because a user who discovers that later has been misled.
 */

import { useState } from 'react';
import { toast } from 'sonner';
import { ClipboardCheck, ClipboardCopy, Download, TriangleAlert } from 'lucide-react';
import type { TextEditJobReport } from '@pdfshush/pdf-core';
import { Button } from '@/components/ui/button';
import { downloadBlob } from '@/lib/download';
import {
  formatEditReceipt,
  hasRecoverableOriginal,
  receiptFileNameFor,
  summarizeEditModes,
  totalEdits,
} from '@/lib/edit-receipt';

interface ExportReceiptProps {
  fileName: string;
  pageCount: number;
  sizeBytes: number;
  report: TextEditJobReport;
}

export function ExportReceipt({ fileName, pageCount, sizeBytes, report }: ExportReceiptProps) {
  const [copied, setCopied] = useState(false);
  const summaries = summarizeEditModes(report);
  const total = totalEdits(report);
  const recoverable = hasRecoverableOriginal(report);
  const text = formatEditReceipt({ fileName, pageCount, sizeBytes, report });
  const receiptName = receiptFileNameFor(fileName);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success('Edit receipt copied');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('The browser refused clipboard access. Download the receipt instead.');
    }
  };

  return (
    <section
      className={`editor-receipt${recoverable ? ' editor-receipt--warning' : ''}`}
      data-testid="edit-receipt"
      data-recoverable={recoverable ? 'true' : 'false'}
      aria-label="Export receipt"
    >
      <div className="editor-receipt-head">
        <div>
          <p className="editor-panel-kicker">Export receipt</p>
          <p className="editor-receipt-title">
            {total === 0
              ? 'No text was rewritten'
              : `${total.toLocaleString()} text edit${total === 1 ? '' : 's'}`}
          </p>
        </div>
        {recoverable && (
          <span className="editor-receipt-flag">
            <TriangleAlert className="size-3.5" aria-hidden />
            Original text remains
          </span>
        )}
      </div>

      {summaries.length > 0 && (
        <ul className="editor-receipt-modes">
          {summaries.map((summary) => (
            <li key={summary.mode} data-mode={summary.mode}>
              <div className="editor-receipt-mode-head">
                <span className="editor-receipt-count">{summary.count.toLocaleString()}</span>
                <span className="editor-receipt-mode-label">{summary.label}</span>
              </div>
              <p className="editor-receipt-detail">{summary.detail}</p>
            </li>
          ))}
        </ul>
      )}

      {total === 0 && (
        <p className="editor-receipt-detail">
          This export changed objects, forms or page order only. No text object was replaced.
        </p>
      )}

      <p className="editor-receipt-verification">
        {report.verification.checks.length === 0
          ? 'No verification checks were run for this export.'
          : report.verification.ok
            ? `Reopened and re-extracted before download: ${report.verification.checks.length} of ${report.verification.checks.length} checks passed.`
            : `Verification failed: ${report.verification.checks.filter((check) => !check.ok).length} of ${report.verification.checks.length} checks failed.`}
      </p>

      {report.warnings.length > 0 && (
        <ul className="editor-receipt-warnings" data-testid="edit-receipt-warnings">
          {report.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}

      <div className="editor-panel-actions">
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid="edit-receipt-copy"
          onClick={() => void copy()}
        >
          {copied ? <ClipboardCheck className="size-3.5" /> : <ClipboardCopy className="size-3.5" />}
          {copied ? 'Copied' : 'Copy receipt'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid="edit-receipt-download"
          onClick={() => downloadBlob(new Blob([text], { type: 'text/plain' }), receiptName)}
        >
          <Download className="size-3.5" />
          Save receipt
        </Button>
      </div>
    </section>
  );
}
