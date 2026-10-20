import { useState } from 'react';
import { Loader2, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import {
  timeoutForPageCount,
  type InspectOutput,
  type MetadataJobOutput,
} from '@pdfshush/pdf-core';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { JobProgressPanel } from '@/components/tools/job-progress';
import { ResultPanel } from '@/components/tools/result-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useJobRunner } from '@/hooks/use-job-runner';
import { checkClientCapacity, announceCapacityWarning } from '@/lib/client-capacity';
import { downloadBytes } from '@/lib/download';
import { largestBytes, readAsInputFiles, shortName } from '@/lib/files';
import { recordRecent } from '@/tools/recent';

interface Fields {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
}

const EMPTY: Fields = { title: '', author: '', subject: '', keywords: '', creator: '', producer: '' };

/**
 * Edit Metadata: reads the document's own values via inspect, edits live in a
 * small form, and rewrites just the Info dictionary. Only fields the user
 * touched are sent; clearing is an explicit empty field, which the engine
 * accepts.
 */
export function EditMetadataTool() {
  const [files, setFiles] = useState<File[]>([]);
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [touched, setTouched] = useState<Partial<Record<keyof Fields, boolean>>>({});
  const [pageCount, setPageCount] = useState<number | null>(null);
  const inspectRunner = useJobRunner<InspectOutput>('inspect');
  const runner = useJobRunner<MetadataJobOutput>('edit-metadata');

  const running = inspectRunner.state.status === 'running' || runner.state.status === 'running';

  const handleFiles = async (incoming: File[]) => {
    if (incoming.length === 0) {
      setFiles([]);
      setFields(EMPTY);
      setTouched({});
      setPageCount(null);
      return;
    }
    const file = incoming[0]!;
    const verdict = checkClientCapacity({
      fileCount: 1,
      totalBytes: file.size,
      largestFileBytes: largestBytes([file]),
    });
    if (!verdict.ok) {
      toast.error(verdict.message);
      return;
    }
    announceCapacityWarning(verdict);

    const outcome = await inspectRunner.run(await readAsInputFiles([file]));
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    const doc = outcome.result.documents[0];
    if (!doc) return;
    if (doc.encrypted) {
      toast.error('That PDF is password protected: unlock it first.');
      return;
    }
    setFiles([file]);
    setPageCount(doc.pageCount);
    // Inspect exposes only the read-side trio today; the rest start blank and
    // the job writes exactly what the user leaves changed.
    setFields({ ...EMPTY, title: doc.metadata.title ?? '', author: doc.metadata.author ?? '' });
    setTouched({});
  };

  const set = (key: keyof Fields) => (value: string) => {
    setFields((prev) => ({ ...prev, [key]: value }));
    setTouched((prev) => ({ ...prev, [key]: true }));
  };

  const save = async () => {
    if (files.length === 0 || runner.state.status === 'running') return;
    const edits: Record<string, string | string[]> = {};
    if (touched.title) edits.title = fields.title;
    if (touched.author) edits.author = fields.author;
    if (touched.subject) edits.subject = fields.subject;
    if (touched.creator) edits.creator = fields.creator;
    if (touched.producer) edits.producer = fields.producer;
    if (touched.keywords) {
      edits.keywords = fields.keywords
        .split(',')
        .map((keyword) => keyword.trim())
        .filter(Boolean);
    }
    if (Object.keys(edits).length === 0) {
      toast.error('Change at least one field to save.');
      return;
    }

    const outcome = await runner.run(
      await readAsInputFiles(files),
      { edits },
      { timeoutMs: timeoutForPageCount(pageCount ?? 30) },
    );
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    void recordRecent({
      toolSlug: 'edit-metadata',
      toolName: 'Edit Metadata',
      fileName: outcome.result.fileName,
      pageCount: outcome.result.pageCount,
      sizeBytes: outcome.result.data.byteLength,
    });
  };

  if (runner.state.status === 'done') {
    const { result } = runner.state;
    return (
      <ResultPanel
        fileName={result.fileName}
        pageCount={result.pageCount}
        sizeBytes={result.data.byteLength}
        onDownload={() => downloadBytes(result.data, result.fileName)}
        onReset={() => {
          runner.reset();
          setFiles([]);
          setFields(EMPTY);
          setTouched({});
          setPageCount(null);
        }}
        footerNote="Only the fields you changed were written; everything else, including dates, is untouched."
      />
    );
  }

  const editedCount = Object.values(touched).filter(Boolean).length;

  return (
    <div className="space-y-4">
      <FileDropzone
        files={files}
        onFiles={(next) => void handleFiles(next)}
        multiple={false}
        disabled={running}
        hint="one PDF; its current values load first"
      />

      {inspectRunner.state.status === 'running' && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading document…
        </p>
      )}

      {pageCount !== null && files.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{shortName(files[0]!.name)}</p>
              <p className="text-xs text-muted-foreground">{pageCount.toLocaleString()} pages</p>
            </div>
            <Wrench className="h-5 w-5 shrink-0 text-primary" />
          </div>

          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <Field label="Title" value={fields.title} onChange={set('title')} placeholder="Annual Report" />
            <Field label="Author" value={fields.author} onChange={set('author')} placeholder="Jane Doe" />
            <Field
              label="Subject"
              value={fields.subject}
              onChange={set('subject')}
              placeholder="Q4 financial statements"
            />
            <Field
              label="Keywords"
              value={fields.keywords}
              onChange={set('keywords')}
              placeholder="finance, 2026, quarterly"
              hint="comma-separated"
            />
            <Field label="Creator" value={fields.creator} onChange={set('creator')} placeholder="PDFShush" />
            <Field
              label="Producer"
              value={fields.producer}
              onChange={set('producer')}
              placeholder="PDFShush engine"
            />
          </form>

          <div className="mt-4 flex flex-col items-end gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              Clear a field to remove it · {editedCount === 0 ? 'nothing changed yet' : `${editedCount} field${editedCount === 1 ? '' : 's'} changed`}
            </p>
            <Button size="lg" disabled={running} onClick={() => void save()}>
              {runner.state.status === 'running' ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…
                </>
              ) : (
                <>Save metadata</>
              )}
            </Button>
          </div>
        </div>
      )}

      {runner.state.status === 'running' && (
        <JobProgressPanel progress={runner.state.progress} onCancel={runner.cancel} />
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        maxLength={500}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
