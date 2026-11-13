/**
 * Export dialog for a saved signature.
 *
 * The dialog owns presentation and remembered choices; every pixel decision
 * lives in `lib/signature-export.ts`. The stored signature PNG is used as the
 * source of truth for both drawn and typed assets: the pad dialog already
 * rasterised typed text through the same renderer the editor uses, so exporting
 * that PNG is exactly what the user previewed when saving.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Download,
  Loader2,
  Share2,
  ShieldCheck,
  TriangleAlert,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { downloadBlob } from '@/lib/download';
import { formatBytes } from '@/lib/format';
import type { SignatureAssetRecord } from '@/lib/signatures';
import {
  DEFAULT_SIGNATURE_EXPORT_OPTIONS,
  SIGNATURE_EXPORT_BACKGROUNDS,
  SIGNATURE_EXPORT_FORMATS,
  SIGNATURE_EXPORT_PDF_PAGES,
  SIGNATURE_EXPORT_QUALITY_MAX,
  SIGNATURE_EXPORT_QUALITY_MIN,
  SIGNATURE_EXPORT_SIZES,
  exportSignature,
  mimeForExportFormat,
  renderSignaturePng,
  resolveExportBackground,
  signatureExportFileName,
  type SignatureExportBackground,
  type SignatureExportFormat,
  type SignatureExportOptions,
  type SignatureExportSize,
  type SignaturePdfPage,
} from '@/lib/signature-export';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'pdfshush.signature-export.v1';
const PREVIEW_DEBOUNCE_MS = 140;

interface RememberedOptions {
  format: SignatureExportFormat;
  background: SignatureExportBackground;
  size: SignatureExportSize;
  trim: boolean;
  quality: number;
  pdfPage: SignaturePdfPage;
  /** Empty string means "no target". Kept as text so the field can be cleared. */
  targetKb: string;
}

const FORMAT_LABELS: Record<SignatureExportFormat, string> = {
  png: 'PNG',
  jpg: 'JPG',
  webp: 'WebP',
  pdf: 'PDF',
};

const SIZE_LABELS: Record<SignatureExportSize, { label: string; detail: string }> = {
  original: { label: 'Original', detail: 'Source' },
  small: { label: 'Small', detail: '400 px' },
  medium: { label: 'Medium', detail: '800 px' },
  large: { label: 'Large', detail: '1200 px' },
};

function defaultOptions(): RememberedOptions {
  return {
    format: DEFAULT_SIGNATURE_EXPORT_OPTIONS.format,
    background: DEFAULT_SIGNATURE_EXPORT_OPTIONS.background,
    size: DEFAULT_SIGNATURE_EXPORT_OPTIONS.size,
    trim: DEFAULT_SIGNATURE_EXPORT_OPTIONS.trim,
    quality: DEFAULT_SIGNATURE_EXPORT_OPTIONS.quality,
    pdfPage: DEFAULT_SIGNATURE_EXPORT_OPTIONS.pdfPage,
    targetKb: '',
  };
}

function oneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

function loadRememberedOptions(): RememberedOptions {
  const fallback = defaultOptions();
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<RememberedOptions>;
    const quality =
      typeof parsed.quality === 'number' && Number.isFinite(parsed.quality)
        ? Math.min(
            SIGNATURE_EXPORT_QUALITY_MAX,
            Math.max(SIGNATURE_EXPORT_QUALITY_MIN, Math.round(parsed.quality)),
          )
        : fallback.quality;
    return {
      format: oneOf(parsed.format, SIGNATURE_EXPORT_FORMATS) ? parsed.format : fallback.format,
      background: oneOf(parsed.background, SIGNATURE_EXPORT_BACKGROUNDS)
        ? parsed.background
        : fallback.background,
      size: oneOf(parsed.size, SIGNATURE_EXPORT_SIZES) ? parsed.size : fallback.size,
      trim: typeof parsed.trim === 'boolean' ? parsed.trim : fallback.trim,
      quality,
      pdfPage: oneOf(parsed.pdfPage, SIGNATURE_EXPORT_PDF_PAGES)
        ? parsed.pdfPage
        : fallback.pdfPage,
      targetKb:
        typeof parsed.targetKb === 'string' ? parsed.targetKb.replace(/[^\d.]/g, '') : '',
    };
  } catch {
    return fallback;
  }
}

function rememberOptions(options: RememberedOptions): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
    }
  } catch {
    // Private mode or a full quota: remembering choices is a convenience, not a
    // reason to block the export.
  }
}

function parseTargetKb(value: string): number | null {
  const parsed = Number.parseFloat(value.replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.min(5_000, Math.max(1, Math.round(parsed)));
}

function toExportOptions(options: RememberedOptions): SignatureExportOptions {
  const targetKb = parseTargetKb(options.targetKb);
  const supportsTarget = options.format === 'jpg' || options.format === 'webp';
  return {
    format: options.format,
    background: resolveExportBackground(options.format, options.background),
    size: options.size,
    trim: options.trim,
    quality: options.quality,
    pdfPage: options.pdfPage,
    ...(targetKb !== null && supportsTarget ? { maxBytes: targetKb * 1024 } : {}),
  };
}

/* ---------------------------------------------------------------- controls */

function ChoiceButton({
  active,
  className,
  ...props
}: React.ComponentProps<'button'> & { active: boolean }) {
  return (
    <button
      type="button"
      data-slot="choice"
      {...props}
      aria-pressed={active}
      className={cn(
        'rounded-lg px-2.5 py-2 text-xs font-medium transition-all duration-200 outline-none',
        'min-h-9 focus-visible:ring-2 focus-visible:ring-primary/60 disabled:cursor-not-allowed disabled:opacity-45',
        active
          ? 'bg-card text-foreground shadow-sm ring-1 ring-black/5 dark:ring-white/10'
          : 'text-muted-foreground hover:text-foreground',
        className,
      )}
    />
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
      {children}
    </span>
  );
}

function OptionGroup({
  label,
  children,
  columns = 4,
}: {
  label: string;
  children: React.ReactNode;
  columns?: 2 | 4;
}) {
  return (
    <div className="space-y-1.5">
      <FieldLabel>{label}</FieldLabel>
      <div
        role="group"
        aria-label={label}
        className={cn(
          'grid gap-1 rounded-xl bg-secondary p-1',
          columns === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2',
        )}
      >
        {children}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- dialog */

export interface SignatureExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset: SignatureAssetRecord;
}

export function SignatureExportDialog({
  open,
  onOpenChange,
  asset,
}: SignatureExportDialogProps) {
  const [options, setOptions] = useState<RememberedOptions>(loadRememberedOptions);
  const [output, setOutput] = useState<{ blob: Blob; url: string } | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canShare, setCanShare] = useState(false);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    rememberOptions(options);
  }, [options]);

  // Any preview URL this dialog created is revoked on unmount.
  useEffect(
    () => () => {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let createdUrl: string | null = null;

    setBusy(true);
    setError(null);

    const timer = setTimeout(() => {
      void (async () => {
        const resolved = toExportOptions(options);
        try {
          // `asset.png` is already the rendered image for both methods: the pad's
          // capture path rasterises typed text through the same Caveat preview,
          // so there is no separate typed-text path to reconstruct here.
          const blob = await exportSignature(asset.png, resolved);
          if (cancelled) return;
          const previewBlob =
            resolved.format === 'pdf'
              ? await renderSignaturePng(asset.png, resolved)
              : blob;
          if (cancelled) return;

          createdUrl = URL.createObjectURL(previewBlob);
          if (urlRef.current) URL.revokeObjectURL(urlRef.current);
          urlRef.current = createdUrl;
          setOutput({ blob, url: createdUrl });
        } catch (caught) {
          if (cancelled) return;
          const message =
            caught instanceof Error
              ? caught.message
              : 'Could not export this signature. Try another format.';
          setError(message);
          if (urlRef.current) {
            URL.revokeObjectURL(urlRef.current);
            urlRef.current = null;
          }
          setOutput(null);
          toast.error(message);
        } finally {
          if (!cancelled) setBusy(false);
        }
      })();
    }, PREVIEW_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      // A URL that never reached state would otherwise leak.
      if (createdUrl && createdUrl !== urlRef.current) URL.revokeObjectURL(createdUrl);
    };
  }, [open, asset.png, options]);

  useEffect(() => {
    if (!output) {
      setCanShare(false);
      return;
    }
    try {
      if (
        typeof File !== 'function' ||
        typeof navigator === 'undefined' ||
        typeof navigator.canShare !== 'function'
      ) {
        setCanShare(false);
        return;
      }
      const file = new File([output.blob], signatureExportFileName(options.format), {
        type: output.blob.type || mimeForExportFormat(options.format),
      });
      setCanShare(navigator.canShare({ files: [file] }));
    } catch {
      setCanShare(false);
    }
  }, [output, options.format]);

  const update = (patch: Partial<RememberedOptions>) => {
    setOptions((previous) => ({ ...previous, ...patch }));
  };

  const chooseFormat = (format: SignatureExportFormat) => {
    update(format === 'jpg' ? { format, background: 'white' } : { format });
  };

  const effectiveBackground = resolveExportBackground(options.format, options.background);
  const a4Preview = options.format === 'pdf' && options.pdfPage === 'a4';
  const targetKb = parseTargetKb(options.targetKb);
  const targetBytes = targetKb === null ? null : targetKb * 1024;
  const targetApplies =
    targetBytes !== null && (options.format === 'jpg' || options.format === 'webp');
  const targetMissed =
    targetApplies && output !== null && output.blob.size > targetBytes;

  const onDownload = () => {
    if (!output) return;
    downloadBlob(output.blob, signatureExportFileName(options.format));
    toast.success('Signature downloaded.');
    // On a phone, finish the flow: download closes the sheet and returns to the
    // signature list. Desktop keeps it open for a second format.
    if (window.matchMedia('(max-width: 639px)').matches) onOpenChange(false);
  };

  const onShare = async () => {
    if (!output) return;
    try {
      const file = new File([output.blob], signatureExportFileName(options.format), {
        type: output.blob.type || mimeForExportFormat(options.format),
      });
      await navigator.share({ files: [file], title: 'Signature' });
    } catch (caught) {
      if ((caught as DOMException | null)?.name !== 'AbortError') {
        toast.error('Could not open the share sheet on this device.');
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[92svh] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded-2xl border-black/10 bg-card p-0 shadow-[0_24px_80px_-24px_oklch(0.2_0.02_152/0.35)] sm:max-w-2xl dark:border-white/10"
        data-testid="signature-export-dialog"
      >
        <DialogClose asChild>
          <button
            type="button"
            aria-label="Back to your signatures"
            className="absolute top-4 right-4 z-20 flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:outline-none"
          >
            <X className="size-4" aria-hidden />
          </button>
        </DialogClose>

        <div className="shrink-0 space-y-1.5 px-5 pt-5 pr-12 sm:px-6 sm:pt-6">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-secondary px-2.5 py-0.5 text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            <Download className="size-3" aria-hidden />
            Export
          </span>
          <DialogTitle className="text-lg font-semibold tracking-tight">
            Download your signature
          </DialogTitle>
          <DialogDescription>
            Pick a format and size. The preview is exactly what the file will contain.
          </DialogDescription>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 sm:px-6 sm:py-5">
          <div className="grid gap-5 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            {/* Live preview */}
            <div className="space-y-2">
              <div
                className={cn(
                  'flex h-36 items-center justify-center overflow-hidden rounded-2xl ring-1 ring-black/10 sm:h-44 dark:ring-white/15',
                  a4Preview
                    ? 'bg-secondary/50 p-2'
                    : cn('p-3', effectiveBackground === 'white' && 'bg-white'),
                )}
                style={
                  !a4Preview && effectiveBackground === 'transparent'
                    ? {
                        backgroundColor: '#ffffff',
                        backgroundImage:
                          'linear-gradient(45deg, #e2e8f0 25%, transparent 25%), linear-gradient(-45deg, #e2e8f0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e2e8f0 75%), linear-gradient(-45deg, transparent 75%, #e2e8f0 75%)',
                        backgroundSize: '12px 12px',
                        backgroundPosition: '0 0, 0 6px, 6px -6px, -6px 0',
                      }
                    : undefined
                }
                data-testid="signature-export-preview"
              >
                {output ? (
                  a4Preview ? (
                    <div
                      className="relative h-full overflow-hidden rounded-md bg-white shadow-[0_1px_3px_rgba(0,0,0,0.12)] ring-1 ring-black/10"
                      style={{ aspectRatio: '595.28 / 841.89' }}
                    >
                      <img
                        src={output.url}
                        alt="Preview of the signature placed on an A4 page"
                        className={cn(
                          'absolute bottom-[5.7%] left-[8.06%] max-h-[30.9%] w-[33.6%] object-contain object-left-bottom transition-opacity duration-200',
                          busy && 'opacity-50',
                        )}
                      />
                    </div>
                  ) : (
                    <img
                      src={output.url}
                      alt="Preview of the signature file to download"
                      className={cn(
                        'max-h-full max-w-full object-contain transition-opacity duration-200',
                        busy && 'opacity-50',
                      )}
                    />
                  )
                ) : error ? (
                  <span className="flex flex-col items-center gap-2 text-xs text-muted-foreground">
                    <TriangleAlert className="size-5 text-destructive" aria-hidden />
                    Preview unavailable
                  </span>
                ) : (
                  <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
                )}
              </div>

              <div className="min-h-9 text-center text-xs text-muted-foreground" aria-live="polite">
                {error ? (
                  <span className="inline-flex items-center gap-1.5 text-destructive">
                    <TriangleAlert className="size-3.5" aria-hidden />
                    {error}
                  </span>
                ) : busy || !output ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    Updating preview…
                  </span>
                ) : (
                  <span className="tabular-nums">
                    ~{formatBytes(output.blob.size, 0)} · {FORMAT_LABELS[options.format]}
                    {options.format === 'pdf'
                      ? ` · ${options.pdfPage === 'a4' ? 'A4 page' : 'Fit'}`
                      : ''}
                  </span>
                )}
              </div>

              {targetMissed && output && targetBytes !== null ? (
                <p
                  className="flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400"
                  role="status"
                >
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  Could not get under {formatBytes(targetBytes, 0)} even at{' '}
                  {SIGNATURE_EXPORT_QUALITY_MIN}% quality. Try a smaller size.
                </p>
              ) : null}
            </div>

            {/* Controls */}
            <div className="space-y-4">
              <OptionGroup label="Format">
                {SIGNATURE_EXPORT_FORMATS.map((format) => (
                  <ChoiceButton
                    key={format}
                    active={options.format === format}
                    onClick={() => chooseFormat(format)}
                    data-testid={`signature-export-format-${format}`}
                  >
                    {FORMAT_LABELS[format]}
                  </ChoiceButton>
                ))}
              </OptionGroup>

              <OptionGroup label="Background" columns={2}>
                <ChoiceButton
                  active={effectiveBackground === 'white'}
                  onClick={() => update({ background: 'white' })}
                  data-testid="signature-export-background-white"
                >
                  White
                </ChoiceButton>
                {options.format === 'jpg' ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        tabIndex={0}
                        aria-label="Transparent background, unavailable for JPG"
                        className="inline-flex rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                      >
                        <ChoiceButton
                          active={effectiveBackground === 'transparent'}
                          disabled
                          aria-label="Transparent background, unavailable for JPG"
                          data-testid="signature-export-background-transparent"
                          className="w-full"
                        >
                          Transparent
                        </ChoiceButton>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      JPG has no transparency. Choose PNG or WebP for a transparent file.
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <ChoiceButton
                    active={effectiveBackground === 'transparent'}
                    onClick={() => update({ background: 'transparent' })}
                    data-testid="signature-export-background-transparent"
                  >
                    Transparent
                  </ChoiceButton>
                )}
              </OptionGroup>

              <div className="space-y-1.5">
                <FieldLabel>Size</FieldLabel>
                <div
                  role="group"
                  aria-label="Size"
                  className="grid grid-cols-2 gap-1 rounded-xl bg-secondary p-1 sm:grid-cols-4"
                >
                  {SIGNATURE_EXPORT_SIZES.map((size) => (
                    <ChoiceButton
                      key={size}
                      active={options.size === size}
                      aria-label={`${SIZE_LABELS[size].label}: ${SIZE_LABELS[size].detail}`}
                      onClick={() => update({ size })}
                      className="flex flex-col items-start gap-0.5 px-2.5 py-1.5 text-left"
                      data-testid={`signature-export-size-${size}`}
                    >
                      <span>{SIZE_LABELS[size].label}</span>
                      <span className="text-[10px] font-normal text-muted-foreground">
                        {SIZE_LABELS[size].detail}
                      </span>
                    </ChoiceButton>
                  ))}
                </div>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Never upscaled beyond the saved image.
                </p>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-xl bg-secondary/60 px-3 py-2.5">
                <div className="space-y-0.5">
                  <Label htmlFor="signature-export-trim" className="text-sm font-medium">
                    Trim empty space
                  </Label>
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    Crops to the ink and adds a small margin.
                  </p>
                </div>
                <Switch
                  id="signature-export-trim"
                  checked={options.trim}
                  onCheckedChange={(checked) => update({ trim: checked })}
                  aria-label="Trim empty space"
                  data-testid="signature-export-trim"
                />
              </div>

              {options.format === 'jpg' || options.format === 'webp' ? (
                <label className="block space-y-1">
                  <span className="flex items-baseline justify-between">
                    <FieldLabel>Quality</FieldLabel>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {options.quality}%
                    </span>
                  </span>
                  <input
                    type="range"
                    min={SIGNATURE_EXPORT_QUALITY_MIN}
                    max={SIGNATURE_EXPORT_QUALITY_MAX}
                    step={1}
                    value={options.quality}
                    onChange={(event) => update({ quality: Number(event.target.value) })}
                    aria-label="Image quality"
                    className="h-6 w-full cursor-pointer accent-[var(--primary)]"
                    data-testid="signature-export-quality"
                  />
                </label>
              ) : null}

              {options.format === 'jpg' || options.format === 'webp' ? (
                <div className="space-y-1.5">
                  <Label
                    htmlFor="signature-export-target"
                    className="text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase"
                  >
                    Target max size <span className="font-normal normal-case">(optional)</span>
                  </Label>
                  <div className="relative">
                    <Input
                      id="signature-export-target"
                      inputMode="decimal"
                      placeholder="e.g. 50"
                      value={options.targetKb}
                      onChange={(event) =>
                        update({ targetKb: event.target.value.replace(/[^\d.]/g, '') })
                      }
                      className="pr-10"
                      aria-describedby="signature-export-target-help"
                      data-testid="signature-export-target"
                    />
                    <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">
                      KB
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {[50, 100, 200].map((value) => (
                      <button
                        key={value}
                        type="button"
                        className="rounded-full bg-secondary px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                        onClick={() => update({ targetKb: String(value) })}
                      >
                        {value} KB
                      </button>
                    ))}
                    {options.targetKb ? (
                      <button
                        type="button"
                        className="rounded-full px-2.5 py-1.5 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                        onClick={() => update({ targetKb: '' })}
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>
                  <p
                    id="signature-export-target-help"
                    className="text-[11px] leading-relaxed text-muted-foreground"
                  >
                    Banks often cap uploads. Quality is lowered automatically until the file fits.
                  </p>
                </div>
              ) : null}

              {options.format === 'pdf' ? (
                <OptionGroup label="PDF page" columns={2}>
                  <ChoiceButton
                    active={options.pdfPage === 'fit'}
                    onClick={() => update({ pdfPage: 'fit' })}
                    data-testid="signature-export-pdf-fit"
                  >
                    Fit to signature
                  </ChoiceButton>
                  <ChoiceButton
                    active={options.pdfPage === 'a4'}
                    onClick={() => update({ pdfPage: 'a4' })}
                    data-testid="signature-export-pdf-a4"
                  >
                    A4 page
                  </ChoiceButton>
                </OptionGroup>
              ) : null}
            </div>
          </div>
        </div>

        <div className="shrink-0 border-t border-border/60 bg-card/95 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:px-6 dark:border-white/5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
              Exported on your device. Nothing is uploaded.
            </p>
            <div className="flex w-full items-center gap-2 sm:w-auto sm:justify-end">
              {canShare ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void onShare()}
                  aria-label="Share the signature file"
                  disabled={!output || busy}
                  className="h-10 flex-1 rounded-full sm:flex-none"
                >
                  <Share2 className="size-4" aria-hidden />
                  Share
                </Button>
              ) : null}
              <Button
                type="button"
                onClick={onDownload}
                aria-label={`Download signature as ${FORMAT_LABELS[options.format]}`}
                disabled={!output || busy}
                className="group h-10 flex-1 rounded-full pr-2 pl-5 transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98] sm:flex-none"
                data-testid="signature-export-download"
              >
                {busy && !output ? (
                  <Loader2 className="mr-1 size-4 animate-spin" aria-hidden />
                ) : null}
                Download
                <span className="ml-2 flex size-7 items-center justify-center rounded-full bg-primary-foreground/15 transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5">
                  <Download className="size-3.5" aria-hidden />
                </span>
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
