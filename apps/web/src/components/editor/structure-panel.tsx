/**
 * D4: the Document panel's structure card.
 *
 * Three layers, in the order a reader needs them:
 *  1. the banded overall score and the eight facets (what the engine thinks);
 *  2. the engine's `basis` sentences (why);
 *  3. "Explain this extraction" (what it read, and what it refused to infer).
 *
 * The score is never shown without the facets, and the limitations are always
 * reachable from here, so a low number cannot be read as a mysterious verdict.
 */

import { useId } from 'react';
import type { PageLayout } from '@pdfshush/pdf-core';
import { Button } from '@/components/ui/button';
import {
  BAND_COPY,
  ROLE_LABELS,
  buildStructureReport,
  formatConfidence,
} from '@/lib/structure-report';

interface StructurePanelProps {
  layout: PageLayout | null;
  /** 1-based page number, used in the heading and the empty state. */
  pageNumber: number;
  /** Fetches the page's text model when the tool has not read it yet. */
  onRequestStructure?: () => void;
  /** Opens the measured-limits section below the panel. */
  onShowLimits?: () => void;
}

export function StructurePanel({
  layout,
  pageNumber,
  onRequestStructure,
  onShowLimits,
}: StructurePanelProps) {
  const headingId = useId();

  if (!layout) {
    return (
      <section className="editor-structure" data-testid="editor-structure">
        <p className="editor-panel-kicker">Structure</p>
        <p className="editor-panel-copy" data-testid="structure-unavailable">
          The text model for page {pageNumber} has not been read yet. It is read when the page is
          opened with Select or Text.
        </p>
        {onRequestStructure && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-2"
            data-testid="structure-request"
            onClick={onRequestStructure}
          >
            Read this page&apos;s structure
          </Button>
        )}
      </section>
    );
  }

  const report = buildStructureReport(layout);

  return (
    <section className="editor-structure" data-testid="editor-structure" aria-labelledby={headingId}>
      <div className="editor-structure-head">
        <p className="editor-panel-kicker" id={headingId}>
          Structure
        </p>
        {report.overall !== null && report.band ? (
          <span
            className={`editor-structure-band editor-structure-band--${report.band}`}
            data-testid="structure-band"
            data-band={report.band}
          >
            {BAND_COPY[report.band]} · {formatConfidence(report.overall)}
          </span>
        ) : (
          <span className="editor-structure-band editor-structure-band--unknown">
            Not measured
          </span>
        )}
      </div>

      <p className="editor-panel-copy">
        {report.overall !== null
          ? 'How much the inferred structure of this page can be trusted. The score is the mean of the facets below; it is not a separate measurement.'
          : 'This page model did not include a confidence score. The extracted counts below still come from it.'}
      </p>

      {report.facets.length > 0 && (
        <ul className="editor-structure-facets" data-testid="structure-facets">
          {report.facets.map((facet) => (
            <li key={facet.key} className="editor-structure-facet" data-band={facet.band}>
              <div className="editor-structure-facet-head">
                <span className="editor-structure-facet-label">{facet.label}</span>
                <span className="editor-structure-facet-value">
                  {formatConfidence(facet.value)}
                </span>
              </div>
              <div className="editor-structure-bar" aria-hidden>
                <span style={{ width: `${Math.round(facet.value * 100)}%` }} />
              </div>
              <span className="editor-structure-facet-detail">{facet.detail}</span>
            </li>
          ))}
        </ul>
      )}

      {report.basis.length > 0 && (
        <div className="editor-structure-basis" data-testid="structure-basis">
          <p className="editor-panel-kicker">Why</p>
          <ul>
            {report.basis.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      <details className="editor-structure-explain" data-testid="structure-explain">
        <summary className="cursor-pointer text-xs font-medium text-foreground">
          Explain this extraction
        </summary>

        <dl className="editor-panel-facts">
          <div>
            <dt>Words</dt>
            <dd>{report.extraction.words.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Lines</dt>
            <dd>{report.extraction.lines.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Paragraphs</dt>
            <dd>{report.extraction.paragraphs.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Blocks</dt>
            <dd>{report.extraction.blocks.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Columns</dt>
            <dd>{report.extraction.columns.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Tables</dt>
            <dd>
              {report.extraction.tables.toLocaleString()}
              {report.extraction.tables > 0
                ? ` (${report.extraction.tableCells.toLocaleString()} cells)`
                : ''}
            </dd>
          </div>
          {report.extraction.images > 0 && (
            <div>
              <dt>Images</dt>
              <dd>{report.extraction.images.toLocaleString()}</dd>
            </div>
          )}
          <div>
            <dt>Ambiguous boundaries</dt>
            <dd>{report.extraction.ambiguous.toLocaleString()}</dd>
          </div>
        </dl>

        {report.extraction.roleCounts.length > 0 && (
          <ul className="editor-structure-roles" data-testid="structure-roles">
            {report.extraction.roleCounts.map(({ role, count }) => (
              <li key={role}>
                <span>{count.toLocaleString()}</span> {ROLE_LABELS[role]}
              </li>
            ))}
          </ul>
        )}

        <ul className="editor-structure-lines">
          {report.explanation.map((sentence) => (
            <li key={sentence}>{sentence}</li>
          ))}
        </ul>

        {report.limitations.length > 0 && (
          <div className="editor-structure-limitations" data-testid="structure-limitations">
            <p className="editor-panel-kicker">What was not inferred</p>
            <ul>
              {report.limitations.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}

        {onShowLimits && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-2"
            data-testid="structure-show-limits"
            onClick={onShowLimits}
          >
            Measured limits in this editor
          </Button>
        )}
      </details>
    </section>
  );
}
