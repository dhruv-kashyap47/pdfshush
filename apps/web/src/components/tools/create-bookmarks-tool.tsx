/**
 * Create Bookmarks: detect sections from page text, then write a real outline.
 *
 * Detection reuses the editor's text-run job and a pure heuristic
 * (`suggestBookmarks`); this component owns the editable list. Nothing is
 * written until the user presses the button, and every title/page can be fixed
 * before it reaches the PDF -- automatic detection that cannot be corrected is
 * just a guess with a download button.
 */

import { useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  Trash2,
  Wand2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  suggestBookmarks,
  timeoutForPageCount,
  type BookmarkSuggestion,
  type CreateBookmarksJobOutput,
  type InspectOutput,
  type TextRun,
  type TextRunsOutput,
} from '@pdfshush/pdf-core';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { JobProgressPanel } from '@/components/tools/job-progress';
import { ResultPanel } from '@/components/tools/result-panel';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useJobRunner } from '@/hooks/use-job-runner';
import {
  announceCapacityWarning,
  checkClientCapacity,
} from '@/lib/client-capacity';
import { downloadBytes } from '@/lib/download';
import { readAsInputFiles, totalBytes } from '@/lib/files';
import { cn } from '@/lib/utils';
import { recordRecent } from '@/tools/recent';

type DetectMode = 'headings' | 'pages';

interface Row {
  id: string;
  title: string;
  /** Kept as text so an empty field is editable rather than snapping to 1. */
  page: string;
  level: number;
  include: boolean;
}

const MAX_TITLE_CHARS = 200;
const MAX_LEVEL = 8;

function normalizeLevels(rows: Row[]): Row[] {
  const result: Row[] = [];
  for (const row of rows) {
    const previous = result[result.length - 1];
    const level = previous
      ? Math.max(0, Math.min(MAX_LEVEL, Math.min(row.level, previous.level + 1)))
      : 0;
    result.push({ ...row, level });
  }
  return result;
}

export function CreateBookmarksTool() {
  const [files, setFiles] = useState<File[]>([]);
  const [info, setInfo] = useState<InspectOutput | null>(null);
  const [runs, setRuns] = useState<TextRun[][] | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [mode, setMode] = useState<DetectMode>('headings');
  const [detectError, setDetectError] = useState<string | null>(null);

  const idRef = useRef(0);
  const inspectRunner = useJobRunner<InspectOutput>('inspect');
  const textRunner = useJobRunner<TextRunsOutput>('text-runs');
  const writer = useJobRunner<CreateBookmarksJobOutput>('create-bookmarks');

  const pageCount = info?.documents[0]?.pageCount ?? 0;
  const reading =
    inspectRunner.state.status === 'running' || textRunner.state.status === 'running';
  const writing = writer.state.status === 'running';
  const busy = reading || writing;

  const toRows = (suggestions: BookmarkSuggestion[]): Row[] =>
    suggestions.map((suggestion) => ({
      id: `bookmark-${(idRef.current += 1)}`,
      title: suggestion.title,
      page: String(suggestion.pageIndex + 1),
      level: suggestion.level,
      include: true,
    }));

  const detect = async (
    source: File[],
    pages: number,
    nextMode: DetectMode,
  ): Promise<Row[] | null> => {
    const outcome = await textRunner.run(await readAsInputFiles(source), undefined, {
      timeoutMs: timeoutForPageCount(pages),
    });
    if (!outcome.ok) {
      if (!outcome.aborted) {
        setDetectError(outcome.message);
        toast.error(outcome.message);
      }
      return null;
    }
    setRuns(outcome.result.runs);
    setDetectError(null);
    return toRows(suggestBookmarks(outcome.result.runs, { mode: nextMode }));
  };

  const resetAll = () => {
    inspectRunner.reset();
    textRunner.reset();
    writer.reset();
    setFiles([]);
    setInfo(null);
    setRuns(null);
    setRows(null);
    setMode('headings');
    setDetectError(null);
  };

  const handleFiles = async (incoming: File[]) => {
    if (incoming.length === 0) {
      resetAll();
      return;
    }
    const byteVerdict = checkClientCapacity({
      fileCount: 1,
      totalBytes: totalBytes(incoming),
    });
    if (!byteVerdict.ok) {
      toast.error(byteVerdict.message);
      return;
    }
    announceCapacityWarning(byteVerdict);

    const inspected = await inspectRunner.run(await readAsInputFiles(incoming));
    if (!inspected.ok) {
      if (!inspected.aborted) toast.error(inspected.message);
      inspectRunner.reset();
      return;
    }
    const document = inspected.result.documents[0];
    if (!document) return;
    if (document.encrypted) {
      toast.error('This PDF is password protected. Unlock it first, then create bookmarks.');
      inspectRunner.reset();
      return;
    }

    const pageVerdict = checkClientCapacity({
      fileCount: 1,
      totalBytes: totalBytes(incoming),
      pageCount: document.pageCount,
    });
    if (!pageVerdict.ok) {
      toast.error(pageVerdict.message);
      inspectRunner.reset();
      return;
    }
    announceCapacityWarning(pageVerdict);

    setFiles(incoming);
    setInfo(inspected.result);
    setRuns(null);
    setRows(null);
    setDetectError(null);
    setMode('headings');

    const suggestions = await detect(incoming, document.pageCount, 'headings');
    setRows(suggestions ?? []);
  };

  const regenerate = async (nextMode: DetectMode) => {
    if (!files.length || reading) return;
    setMode(nextMode);
    if (runs) {
      setRows(toRows(suggestBookmarks(runs, { mode: nextMode })));
      return;
    }
    const suggestions = await detect(files, pageCount, nextMode);
    if (suggestions) setRows(suggestions);
  };

  const updateRow = (id: string, changes: Partial<Row>) => {
    setRows((previous) =>
      previous?.map((row) => (row.id === id ? { ...row, ...changes } : row)) ?? previous,
    );
  };

  const changeLevel = (id: string, delta: number) => {
    setRows((previous) => {
      if (!previous) return previous;
      const index = previous.findIndex((row) => row.id === id);
      if (index < 0) return previous;
      if (delta > 0 && index === 0) return previous;
      const next = previous.map((row, rowIndex) =>
        rowIndex === index
          ? { ...row, level: Math.max(0, Math.min(MAX_LEVEL, row.level + delta)) }
          : row,
      );
      return normalizeLevels(next);
    });
  };

  const moveRow = (id: string, delta: number) => {
    setRows((previous) => {
      if (!previous) return previous;
      const index = previous.findIndex((row) => row.id === id);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= previous.length) return previous;
      const next = [...previous];
      const moving = next[index]!;
      next[index] = next[target]!;
      next[target] = moving;
      return normalizeLevels(next);
    });
  };

  const removeRow = (id: string) => {
    setRows((previous) =>
      previous ? normalizeLevels(previous.filter((row) => row.id !== id)) : previous,
    );
  };

  const addRow = () => {
    setRows((previous) => {
      const row: Row = {
        id: `bookmark-${(idRef.current += 1)}`,
        title: 'New bookmark',
        page: '1',
        level: 0,
        include: true,
      };
      return normalizeLevels([...(previous ?? []), row]);
    });
  };

  const rowIssue = (row: Row): string | null => {
    const title = row.title.trim();
    if (!title) return 'Every included bookmark needs a title.';
    if (title.length > MAX_TITLE_CHARS) {
      return `Bookmark titles are limited to ${MAX_TITLE_CHARS} characters.`;
    }
    if (!/^\d+$/.test(row.page.trim())) {
      return `"${title}" needs a whole page number.`;
    }
    const page = Number(row.page);
    if (page < 1 || page > pageCount) {
      return `"${title}" points at page ${row.page}; this PDF has ${pageCount}.`;
    }
    return null;
  };

  const included = (rows ?? []).filter((row) => row.include);
  const firstIssue = included.map(rowIssue).find((issue): issue is string => issue !== null);
  const ready =
    files.length === 1 && rows !== null && included.length > 0 && firstIssue === undefined;

  const run = async () => {
    if (!ready || busy || files.length !== 1) return;
    const verdict = checkClientCapacity({
      fileCount: 1,
      totalBytes: totalBytes(files),
      pageCount,
    });
    if (!verdict.ok) {
      toast.error(verdict.message);
      return;
    }
    announceCapacityWarning(verdict);

    const stem = files[0]!.name.replace(/\.pdf$/i, '') || 'document';
    const outcome = await writer.run(
      await readAsInputFiles(files),
      {
        bookmarks: included.map((row) => ({
          title: row.title.trim(),
          pageIndex: Number(row.page) - 1,
          level: row.level,
        })),
        outputName: `${stem}-bookmarked`,
      },
      { timeoutMs: timeoutForPageCount(pageCount) },
    );
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    void recordRecent({
      toolSlug: 'create-bookmarks',
      toolName: 'Create Bookmarks',
      fileName: outcome.result.fileName,
      pageCount: outcome.result.pageCount,
      sizeBytes: outcome.result.data.byteLength,
    });
  };

  if (writer.state.status === 'done') {
    const { result } = writer.state;
    return (
      <ResultPanel
        fileName={result.fileName}
        pageCount={result.pageCount}
        sizeBytes={result.data.byteLength}
        onDownload={() => downloadBytes(result.data, result.fileName)}
        onReset={() => {
          writer.reset();
          resetAll();
        }}
        footerNote={
          <>
            {result.bookmarkCount} bookmark{result.bookmarkCount === 1 ? '' : 's'} written.
            {result.replaced
              ? ' The outline that was already in this PDF was replaced.'
              : ''}{' '}
            Bookmarks open a page; they do not change its content.
          </>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <FileDropzone
        files={files}
        onFiles={(incoming) => void handleFiles(incoming)}
        disabled={busy}
        hint="one PDF to add an outline to"
        multiple={false}
      />

      {reading && (
        <JobProgressPanel
          progress={
            textRunner.state.status === 'running'
              ? textRunner.state.progress
              : inspectRunner.state.status === 'running'
                ? inspectRunner.state.progress
                : null
          }
          onCancel={() => {
            inspectRunner.cancel();
            textRunner.cancel();
          }}
        />
      )}

      {writing && (
        <JobProgressPanel
          progress={writer.state.status === 'running' ? writer.state.progress : null}
          onCancel={writer.cancel}
        />
      )}

      {info && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_330px]">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="flex items-center gap-2 text-sm font-medium">
                  <Bookmark className="h-4 w-4 text-primary" />
                  Bookmarks
                  {rows !== null && (
                    <span className="text-muted-foreground">({rows.length})</span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {pageCount} page{pageCount === 1 ? '' : 's'} · titles are editable
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Detection mode">
                <Button
                  size="sm"
                  variant={mode === 'headings' ? 'default' : 'outline'}
                  aria-pressed={mode === 'headings'}
                  onClick={() => void regenerate('headings')}
                  disabled={reading || files.length === 0}
                  data-testid="create-bookmarks-mode-headings"
                >
                  <Wand2 className="h-3.5 w-3.5" />
                  Headings
                </Button>
                <Button
                  size="sm"
                  variant={mode === 'pages' ? 'default' : 'outline'}
                  aria-pressed={mode === 'pages'}
                  onClick={() => void regenerate('pages')}
                  disabled={reading || files.length === 0}
                  data-testid="create-bookmarks-mode-pages"
                >
                  Every page
                </Button>
              </div>
            </div>

            {detectError && (
              <p className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
                Page text could not be read ({detectError}). You can still add bookmarks by hand.
              </p>
            )}

            {rows === null && reading && (
              <p className="mt-4 rounded-md border border-dashed border-border px-3 py-8 text-center text-xs text-muted-foreground">
                Reading page text to find headings…
              </p>
            )}

            {rows !== null && rows.length === 0 && (
              <div className="mt-4 rounded-md border border-dashed border-border px-3 py-8 text-center">
                <p className="text-sm font-medium">No bookmarks yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Detection found nothing usable. Add one by hand, or try “Every page”.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  onClick={addRow}
                  data-testid="create-bookmarks-add-empty"
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Add bookmark
                </Button>
              </div>
            )}

            {rows !== null && rows.length > 0 && (
              <>
                <div className="mt-3 max-h-[30rem] space-y-2 overflow-y-auto pr-1">
                  {rows.map((row, index) => {
                    const previous = index > 0 ? rows[index - 1]! : null;
                    const issue = row.include ? rowIssue(row) : null;
                    return (
                      <div
                        key={row.id}
                        className={cn(
                          'rounded-lg border p-2 transition-colors',
                          row.include ? 'border-border' : 'border-border/60 opacity-60',
                          issue && 'border-destructive/50',
                        )}
                        style={{ marginLeft: `${row.level * 14}px` }}
                      >
                        <div className="flex items-center gap-2">
                          <Checkbox
                            checked={row.include}
                            onCheckedChange={(value) =>
                              updateRow(row.id, { include: value === true })
                            }
                            aria-label={`Include ${row.title || `bookmark ${index + 1}`}`}
                          />
                          <Input
                            value={row.title}
                            maxLength={MAX_TITLE_CHARS}
                            onChange={(event) =>
                              updateRow(row.id, { title: event.target.value })
                            }
                            aria-label={`Title ${index + 1}`}
                            aria-invalid={issue !== null || undefined}
                            className="h-8 min-w-0 flex-1"
                            data-testid={`bookmark-title-${index}`}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            onClick={() => removeRow(row.id)}
                            aria-label={`Remove ${row.title || `bookmark ${index + 1}`}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <div className="mt-1.5 flex items-center gap-1.5 pl-6">
                          <Label
                            htmlFor={`bookmark-page-${row.id}`}
                            className="text-xs text-muted-foreground"
                          >
                            Page
                          </Label>
                          <Input
                            id={`bookmark-page-${row.id}`}
                            type="number"
                            min={1}
                            max={pageCount}
                            value={row.page}
                            onChange={(event) =>
                              updateRow(row.id, { page: event.target.value })
                            }
                            aria-label={`Page for bookmark ${index + 1}`}
                            aria-invalid={issue !== null || undefined}
                            className="h-7 w-16 text-xs"
                            data-testid={`bookmark-page-${index}`}
                          />
                          {row.level > 0 && (
                            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              level {row.level + 1}
                            </span>
                          )}
                          <div className="ml-auto flex items-center">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => changeLevel(row.id, -1)}
                              disabled={row.level === 0}
                              aria-label={`Outdent ${row.title || `bookmark ${index + 1}`}`}
                            >
                              <ChevronLeft className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => changeLevel(row.id, 1)}
                              disabled={!previous || row.level > previous.level || row.level >= MAX_LEVEL}
                              aria-label={`Indent ${row.title || `bookmark ${index + 1}`}`}
                            >
                              <ChevronRight className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => moveRow(row.id, -1)}
                              disabled={index === 0}
                              aria-label={`Move ${row.title || `bookmark ${index + 1}`} up`}
                            >
                              <ArrowUp className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => moveRow(row.id, 1)}
                              disabled={index === rows.length - 1}
                              aria-label={`Move ${row.title || `bookmark ${index + 1}`} down`}
                            >
                              <ArrowDown className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                        {issue && <p className="mt-1 pl-6 text-xs text-destructive">{issue}</p>}
                      </div>
                    );
                  })}
                </div>

                <div className="mt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={addRow}
                    data-testid="create-bookmarks-add"
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Add bookmark
                  </Button>
                </div>
              </>
            )}
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-sm font-medium">How this works</p>
              <ul className="mt-2 space-y-2 text-xs text-muted-foreground">
                <li>
                  <strong className="text-foreground">Headings</strong> uses the largest text on
                  each page relative to the document&apos;s body size. Running headers, footers
                  and page numbers are ignored.
                </li>
                <li>
                  <strong className="text-foreground">Every page</strong> takes the top line of
                  each page instead, which suits reports with no size contrast.
                </li>
                <li>Indent a bookmark to nest it under the one above; titles can be edited.</li>
              </ul>
            </div>

            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs">
              Any outline already in this PDF is <strong>replaced</strong>. The pages themselves
              are not changed.
            </div>

            <div className="space-y-2">
              <Button
                size="lg"
                className="w-full"
                disabled={!ready || busy}
                onClick={() => void run()}
                data-testid="create-bookmarks-run"
              >
                {writing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Writing the outline…
                  </>
                ) : (
                  <>
                    <Bookmark className="mr-2 h-4 w-4" />
                    Create bookmarks
                  </>
                )}
              </Button>
              {included.length > 0 && firstIssue && (
                <p className="text-xs text-destructive">{firstIssue}</p>
              )}
              {included.length === 0 && rows !== null && (
                <p className="text-xs text-muted-foreground">
                  Include at least one bookmark to create the outline.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
