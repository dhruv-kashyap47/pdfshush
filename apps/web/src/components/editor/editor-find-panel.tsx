/**
 * Find & replace panel.
 *
 * Search state lives in the editor (the panel is a view): the same layouts the
 * overlay already owns answer the query, so opening Find never re-parses the
 * page through PDFium. Results are announced through a live region, and every
 * action is reachable from the keyboard.
 */

import { useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { SearchMatch } from '@pdfshush/pdf-core';

export interface EditorFindPanelProps {
  open: boolean;
  query: string;
  replacement: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  matches: SearchMatch[];
  activeIndex: number;
  searching: boolean;
  pagesSearched: number;
  pagesMissing: number;
  failedPages: number[];
  totalPages: number;
  error: string | null;
  disabled?: boolean;
  onQueryChange: (value: string) => void;
  onReplacementChange: (value: string) => void;
  onToggleCase: () => void;
  onToggleWholeWord: () => void;
  onNext: () => void;
  onPrev: () => void;
  onJump: (index: number) => void;
  onReplaceAll: () => void;
  onClose: () => void;
}

export function EditorFindPanel({
  open,
  query,
  replacement,
  caseSensitive,
  wholeWord,
  matches,
  activeIndex,
  searching,
  pagesSearched,
  pagesMissing,
  failedPages,
  totalPages,
  error,
  disabled,
  onQueryChange,
  onReplacementChange,
  onToggleCase,
  onToggleWholeWord,
  onNext,
  onPrev,
  onJump,
  onReplaceAll,
  onClose,
}: EditorFindPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const element = inputRef.current;
    if (!element) return;
    element.focus();
    element.select();
  }, [open]);

  if (!open) return null;

  const count = matches.length;
  const position = count === 0 ? 0 : Math.min(count, activeIndex + 1);
  const status = searching
    ? `Searching ${pagesSearched} of ${totalPages} page${totalPages === 1 ? '' : 's'}…`
    : count === 0
      ? query.length === 0
        ? 'Type to search every page.'
        : 'No matches.'
      : `${position} of ${count} match${count === 1 ? '' : 'es'}`;
  const missingNote =
    !searching && (pagesMissing > 0 || failedPages.length > 0)
      ? `${Math.max(pagesMissing, failedPages.length)} page${
          Math.max(pagesMissing, failedPages.length) === 1 ? '' : 's'
        } could not be searched${failedPages.length > 0 ? ` (${failedPages.slice(0, 6).map((page) => page + 1).join(', ')}${failedPages.length > 6 ? '…' : ''})` : ''}.`
      : null;

  return (
    <div
      className="editor-find-panel"
      role="search"
      aria-label="Find and replace"
      data-testid="editor-find-panel"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          if (event.shiftKey) onPrev();
          else onNext();
        }
      }}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <input
          ref={inputRef}
          type="search"
          className="editor-find-input"
          placeholder="Find text"
          aria-label="Find text"
          data-testid="editor-find-query"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
        <input
          type="text"
          className="editor-find-input"
          placeholder="Replace with"
          aria-label="Replace with"
          data-testid="editor-find-replace"
          value={replacement}
          onChange={(event) => onReplacementChange(event.target.value)}
        />
        <button
          type="button"
          className="editor-context-chip"
          aria-pressed={caseSensitive}
          aria-label="Aa match case"
          title="Match case"
          data-testid="editor-find-case"
          onClick={onToggleCase}
        >
          Aa
        </button>
        <button
          type="button"
          className="editor-context-chip"
          aria-pressed={wholeWord}
          aria-label="Ab whole word"
          title="Whole word"
          data-testid="editor-find-word"
          onClick={onToggleWholeWord}
        >
          Ab
        </button>
        <span
          className="editor-context-count"
          data-testid="editor-find-count"
          role="status"
          aria-live="polite"
        >
          {status}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="Previous match"
          data-testid="editor-find-prev"
          disabled={disabled || count === 0}
          onClick={onPrev}
        >
          <ChevronUp className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="Next match"
          data-testid="editor-find-next"
          disabled={disabled || count === 0}
          onClick={onNext}
        >
          <ChevronDown className="size-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-7"
          data-testid="editor-find-replace-all"
          disabled={disabled || count === 0}
          onClick={onReplaceAll}
        >
          Replace all
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="Close find"
          data-testid="editor-find-close"
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </div>

      {missingNote ? (
        <p className="w-full text-[11px] text-amber-700 dark:text-amber-300" data-testid="editor-find-missing">
          {missingNote} Zoom or retry to load them, then search again.
        </p>
      ) : null}
      {error ? (
        <p className="w-full text-[11px] text-destructive" role="alert" data-testid="editor-find-error">
          {error}
        </p>
      ) : null}

      {matches.length > 1 ? (
        <ul className="editor-find-results" aria-label="Search results">
          {matches.slice(0, 40).map((match, index) => (
            <li key={`${match.pageIndex}:${match.paragraphId}:${match.start}`}>
              <button
                type="button"
                className="editor-find-result"
                aria-current={index === activeIndex ? 'true' : undefined}
                data-testid="editor-find-result"
                onClick={() => onJump(index)}
              >
                <span className="editor-find-result-page">p{match.pageIndex + 1}</span>
                <span className="truncate">{match.snippet}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
