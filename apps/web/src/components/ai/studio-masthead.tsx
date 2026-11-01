/**
 * The studio masthead.
 *
 * One line of identity, one optional folio line, and the two actions that belong
 * to the document. No progress chrome, no mode badges, no decorative dots: the
 * plate below does the talking.
 */

import type { ReactNode } from 'react';
import { FilePlus2 } from 'lucide-react';

interface StudioMastheadProps {
  heading: string;
  /** A file is open: the heading is a working document title, not the page title. */
  documentTitle?: string | undefined;
  /** Folio line, e.g. "12 pages, 1.4 MB". Omitted on the frontispiece. */
  meta?: string | undefined;
  /** `p` when the frontispiece below carries the page's only h1. */
  titleAs?: 'h1' | 'p';
  onNewFile?: (() => void) | undefined;
  settingsTrigger?: ReactNode;
}

export function StudioMasthead({
  heading,
  documentTitle,
  meta,
  titleAs = 'h1',
  onNewFile,
  settingsTrigger,
}: StudioMastheadProps) {
  return (
    <header className="studio-masthead">
      <div className="studio-masthead-id">
        {documentTitle ? (
          <h1 className="studio-doc-title" title={documentTitle}>
            {documentTitle}
          </h1>
        ) : titleAs === 'p' ? (
          <p className="studio-doc-title">{heading}</p>
        ) : (
          <h1 className="studio-doc-title">{heading}</h1>
        )}
        {meta ? <p className="studio-doc-meta">{meta}</p> : null}
      </div>

      <div className="studio-masthead-actions">
        {settingsTrigger}
        {onNewFile ? (
          <button type="button" onClick={onNewFile} className="studio-action">
            <FilePlus2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">New PDF</span>
            <span className="sr-only sm:hidden">Open a different PDF</span>
          </button>
        ) : null}
      </div>
    </header>
  );
}
