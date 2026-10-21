import { useRef, useState } from 'react';
import { FilePlus2, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PDF_ACCEPT, isPdfLike, shortName } from '@/lib/files';
import { formatBytes } from '@/lib/format';

interface FileDropzoneProps {
  files: File[];
  onFiles: (files: File[]) => void;
  multiple?: boolean;
  disabled?: boolean;
  /** Small helper text under the prompt. */
  hint?: string;
  /**
   * The privacy line under the prompt. Defaults to the engine's claim, which is
   * true for every tool that only executes jobs. Tools whose data path is wider
   * (the AI tools send the text you ask about to a provider) pass their own.
   */
  note?: string;
  /** Picker filter; defaults to PDFs. */
  accept?: string;
  /** Drop filter paired with `accept`; defaults to PDF detection. */
  accepts?: (file: File) => boolean;
  /** Noun used in the copy: "PDF" (default) or "image". */
  kind?: string;
}

/**
 * Drag-and-drop PDF picker. Empty state is the big dashed target; once files
 * exist it collapses to a compact "add more" bar (the file list lives in the
 * tool component, which owns ordering).
 */
export function FileDropzone({
  files,
  onFiles,
  multiple = true,
  disabled,
  hint,
  note = 'Processed on this device; never uploaded',
  accept,
  accepts,
  kind = 'PDF',
}: FileDropzoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const isAccepted = accepts ?? isPdfLike;

  const acceptFiles = (incoming: FileList | null) => {
    if (!incoming || disabled) return;
    const all = Array.from(incoming);
    const picked = all.filter(isAccepted);
    const rejected = all.length - picked.length;
    if (rejected > 0) {
      // Non-matching files are silently dropped rather than hard-failed:
      // drag-drop often grabs a sibling file by accident.
      return;
    }
    if (picked.length === 0) return;
    onFiles(multiple ? [...files, ...picked] : [picked[0]!]);
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept ?? PDF_ACCEPT}
        multiple={multiple}
        className="hidden"
        onChange={(event) => {
          acceptFiles(event.target.files);
          event.target.value = '';
        }}
      />
      {files.length === 0 ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            if (!disabled) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            acceptFiles(event.dataTransfer.files);
          }}
          // Centred and height-capped on purpose: stretched to the full tool frame the
          // empty target read as a large empty box rather than as an action.
          className={`mx-auto flex w-full max-w-xl flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-11 text-center transition-colors ${
            dragOver
              ? 'border-primary bg-primary/5'
              : 'border-border bg-muted/40 hover:border-primary/60 hover:bg-muted/70'
          } ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            {dragOver ? <Upload className="h-6 w-6" /> : <FilePlus2 className="h-6 w-6" />}
          </span>
          <span className="text-base font-semibold">
            {dragOver ? 'Drop to add' : `Choose ${kind} files`}
          </span>
          <span className="text-sm text-muted-foreground">
            or drag and drop them here: {multiple ? 'multiple files supported' : 'one file'} · max 100 MB each
          </span>
          {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
          <span className="text-xs font-medium text-primary">{note}</span>
        </button>
      ) : (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {files.length === 1
                ? shortName(files[0]!.name)
                : `${files.length} ${kind} files selected`}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatBytes(files.reduce((s, f) => s + f.size, 0))} total
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" size="sm" disabled={disabled} onClick={() => inputRef.current?.click()}>
              {multiple ? 'Add more' : 'Change file'}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="Clear files"
              disabled={disabled}
              onClick={() => onFiles([])}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
