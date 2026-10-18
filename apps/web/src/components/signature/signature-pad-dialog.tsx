/**
 * The signature pad dialog (P6.1, PLAN.md §25.2 + §25.1 D2–D4).
 *
 * Deliberately its own lazy chunk: `signature_pad` and the bundled Caveat
 * faces load only when a dialog actually opens; `pnpm test:bundle` asserts
 * they stay out of the main bundle and the worker.
 *
 * The preview core is paper white in **both** themes on purpose: this ink is
 * the ink that lands on the PDF page, and a dark-guided preview would flatter
 * nobody. Adoption from the saved strip shows the stored PNG over the canvas
 * rather than re-feeding `fromData`/`fromDataURL` (whose scaling semantics
 * differ per protocol) -- what you adopt is exactly what you place.
 *
 * The library's DPI gotcha is handled as its README prescribes: canvas pixels
 * = CSS size × devicePixelRatio, a scaled 2D context, and a resize path that
 * restores strokes via `fromData` (a canvas resize clears itself, and
 * `isEmpty()` lies until the restore happens).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as SignaturePadLib from 'signature_pad';
import type { PointGroup } from 'signature_pad';
import { Eraser, PenLine, Trash2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  SIGNATURE_LABEL_MAX_CHARS,
  SIGNATURE_STORE_MAX,
  computeInkBounds,
  type SignatureMethod,
  type SignatureStrokes,
} from '@/lib/signature-assets';
import {
  SignatureAssetLimitError,
  SignatureAssetTooLargeError,
} from '@/lib/signature-assets';
import {
  captureStrokes,
  deleteSignature,
  listSignatures,
  saveSignature,
  subscribeSignatures,
  type SignatureAssetRecord,
} from '@/lib/signatures';
import { SIGNATURE_FONT_FAMILY, loadSignatureFont } from '@/components/signature/signature-fonts';
import { cn } from '@/lib/utils';

export interface SignatureCapture {
  png: Blob;
  method: SignatureMethod;
  /** Present only when the signer drew it (vector output later, §25.2). */
  strokes?: SignatureStrokes;
  /** Capture-space dimensions in CSS pixels. */
  width: number;
  height: number;
}

export interface SignaturePadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * `insert`: footer serves placement in the editor (secondary: save a copy).
   * `manage`: creation only, for the Signature asset page.
   */
  mode: 'insert' | 'manage';
  onUse?: (capture: SignatureCapture) => void;
}

const INK = '#16181d';
const PEN_BLUE = '#1f3a93';
const PEN_COLORS = [INK, PEN_BLUE] as const;
/** Pen widths in CSS px; the pad draws through a DPR-scaled context. */
const PEN_MIN_WIDTH = 1.1;
const PEN_MAX_WIDTH = 2.6;
const CANVAS_CSS_HEIGHT = 200;
const CANVAS_CSS_MIN_WIDTH = 160;
const GUIDES_INSET = 24;
const BASELINE_FROM_BOTTOM = 44;
/** Alpha threshold below which antialiased edges count as paper, not ink. */
const INK_ALPHA_THRESHOLD = 8;

type Tab = 'draw' | 'type';

/* ------------------------------------------------------------ assets strip */

function AssetStrip({
  assets,
  selectedId,
  onSelect,
  onDelete,
}: {
  assets: SignatureAssetRecord[];
  selectedId: string | null;
  onSelect: (asset: SignatureAssetRecord) => void;
  onDelete: (asset: SignatureAssetRecord) => void;
}) {
  const [urls, setUrls] = useState<Map<string, string>>(new Map());

  // Blob thumbnails need object URLs; revoke on replacement and on unmount.
  useEffect(() => {
    const next = new Map<string, string>();
    for (const asset of assets) next.set(asset.id, URL.createObjectURL(asset.png));
    setUrls((previous) => {
      for (const [id, url] of previous) {
        if (!next.has(id)) URL.revokeObjectURL(url);
      }
      return next;
    });
    return () => {
      for (const url of next.values()) URL.revokeObjectURL(url);
    };
  }, [assets]);

  if (assets.length === 0) return null;

  return (
    <div className="space-y-2" data-testid="signature-asset-strip">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
          Saved on this device
        </span>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {assets.length} / {SIGNATURE_STORE_MAX}
        </span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {assets.map((asset) => {
          const url = urls.get(asset.id);
          if (!url) return null;
          const active = asset.id === selectedId;
          return (
            <div
              key={asset.id}
              className="group relative shrink-0"
              data-testid={`signature-asset-${asset.id}`}
            >
              <button
                type="button"
                aria-pressed={active}
                aria-label="Use this saved signature"
                className={cn(
                  'flex size-16 items-center justify-center rounded-xl bg-white p-1.5 ring-1 ring-black/10 transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:shadow-[0_8px_20px_-8px_rgba(0,0,0,0.25)] active:scale-[0.97] dark:ring-white/15',
                  active && 'ring-2 ring-primary',
                )}
                onClick={() => onSelect(asset)}
              >
                <img src={url} alt="" className="max-h-full max-w-full object-contain" />
              </button>
              <button
                type="button"
                aria-label="Delete this saved signature"
                className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-card text-muted-foreground opacity-70 transition-opacity duration-200 ring-1 ring-black/10 hover:opacity-100 hover:text-destructive focus-visible:opacity-100 dark:ring-white/15"
                onClick={() => onDelete(asset)}
              >
                <Trash2 className="size-3" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- the dialog */

export function SignaturePadDialog({ open, onOpenChange, mode, onUse }: SignaturePadDialogProps) {
  const [tab, setTab] = useState<Tab>('draw');
  const [pen, setPen] = useState<string>(INK);
  const [typedText, setTypedText] = useState('');
  /** `draw`: does the pad hold ink? (Adopted assets bypass the pad.) */
  const [padEmpty, setPadEmpty] = useState(true);
  /** `undefined` = still loading; `false` = Type fails visibly (D4). */
  const [fontReady, setFontReady] = useState<boolean | undefined>(undefined);
  const [assets, setAssets] = useState<SignatureAssetRecord[]>([]);
  /** Asset adopted from the strip: the preview shows its PNG, not the pad. */
  const [adopted, setAdopted] = useState<SignatureAssetRecord | null>(null);

  const canvasHostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePadLib.default | null>(null);
  /** Latest stroke groups (device px), for restore-on-DPR-change. */
  const groupsRef = useRef<PointGroup[]>([]);

  /**
   * Radix portals + lazy boundaries can commit this component's effects while
   * the paper canvas itself is still one commit away, so a plain ref would
   * early-return forever. The stable callback ref bumps an epoch when the
   * canvas actually attaches, and the wiring/observer effects depend on that
   * epoch -- one re-run per attach, never per render.
   */
  const [canvasEpoch, setCanvasEpoch] = useState(0);
  const attachCanvas = useCallback((element: HTMLCanvasElement | null) => {
    canvasRef.current = element;
    if (element) setCanvasEpoch((epoch) => epoch + 1);
  }, []);

  const refreshAssets = useCallback(() => {
    void listSignatures().then((records) => setAssets(records));
  }, []);

  useEffect(() => {
    if (!open) return;
    refreshAssets();
    return subscribeSignatures(refreshAssets);
  }, [open, refreshAssets]);

  useEffect(() => {
    if (!open) return;
    void loadSignatureFont().then((ready) => setFontReady(ready));
  }, [open]);

  /* ------------------------------------------------ helpers */

  /** Host-derived geometry: CSS width (canvas fills the core at 100%) and the min-1 device ratio. */
  const measureHost = useCallback((): { cssWidth: number; ratio: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { cssWidth: CANVAS_CSS_MIN_WIDTH, ratio: 1 };
    return {
      cssWidth: Math.max(CANVAS_CSS_MIN_WIDTH, Math.round(canvas.clientWidth)),
      ratio: Math.max(window.devicePixelRatio || 1, 1),
    };
  }, []);

  const sizeCanvas = useCallback((cssWidth: number, ratio: number): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = Math.round(cssWidth * ratio);
    canvas.height = Math.round(CANVAS_CSS_HEIGHT * ratio);
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }, []);

  /* ------------------------------------------------ typed rendering */

  const renderTyped = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { cssWidth, ratio } = measureHost();
    sizeCanvas(cssWidth, ratio);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const text = typedText.trim();
    if (!text) return;
    try {
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.fillStyle = pen;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      let fontSize = 72;
      ctx.font = `500 ${fontSize}px ${SIGNATURE_FONT_FAMILY}`;
      const measured = ctx.measureText(text).width;
      const maxWidth = cssWidth - GUIDES_INSET * 2;
      if (measured > maxWidth && measured > 0) {
        fontSize = Math.max(30, Math.floor((fontSize * maxWidth) / measured));
        ctx.font = `500 ${fontSize}px ${SIGNATURE_FONT_FAMILY}`;
      }
      ctx.fillText(text, cssWidth / 2, CANVAS_CSS_HEIGHT - BASELINE_FROM_BOTTOM - 14);
    } catch {
      // A torn-down canvas mid-frame: the effect re-runs after mount.
    }
  }, [measureHost, pen, sizeCanvas, typedText]);

  useEffect(() => {
    if (!open || tab !== 'type' || fontReady !== true) return;
    const frame = requestAnimationFrame(renderTyped);
    return () => cancelAnimationFrame(frame);
  }, [open, tab, fontReady, renderTyped]);

  /* ------------------------------------------------ draw tab lifecycle */

  /** README resize path: size the canvas, restore strokes, keep isEmpty honest. */
  const drawSetup = useCallback(
    (instance: SignaturePadLib.default): void => {
      const canvas = canvasRef.current;
      if (canvas) {
        const { cssWidth, ratio } = measureHost();
        canvas.width = Math.round(cssWidth * ratio);
        canvas.height = Math.round(CANVAS_CSS_HEIGHT * ratio);
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.scale(ratio, ratio);
      }
      if (groupsRef.current.length > 0) instance.fromData(groupsRef.current);
      setPadEmpty(instance.isEmpty());
    },
    [measureHost],
  );

  useEffect(() => {
    if (!open || tab !== 'draw' || canvasRef.current === null) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const instance = new SignaturePadLib.default(canvas, {
      penColor: pen,
      minWidth: PEN_MIN_WIDTH,
      maxWidth: PEN_MAX_WIDTH,
      velocityFilterWeight: 0.8,
    });
    padRef.current = instance;
    instance.addEventListener('endStroke', () => {
      groupsRef.current = instance.toData();
      setPadEmpty(instance.isEmpty());
    });
    drawSetup(instance);
    let cancelled = false;
    document.fonts.ready.then(() => {
      // A late webfont load can reflow the host on narrow screens.
      if (cancelled) return;
      if (padRef.current === instance) drawSetup(instance);
    });
    return () => {
      cancelled = true;
      instance.off();
      padRef.current = null;
    };
  }, [open, tab, pen, drawSetup, canvasEpoch]);

  // ResizeObserver on the visible host: cheaper than a window listener and
  // fires only when the layout actually moves the pad. The canvas CSS width is
  // 100% of the core, so attribute changes cannot reflow the host -- no
  // measure/paint feedback loop is possible.
  useEffect(() => {
    if (!open || tab !== 'draw') return;
    const host = canvasHostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(() => {
      const pad = padRef.current;
      if (!pad) return;
      drawSetup(pad);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [open, tab, drawSetup, canvasEpoch]);

  /* ------------------------------------------------ close-state reset */

  useEffect(() => {
    if (open) return;
    groupsRef.current = [];
    setAdopted(null);
    setPadEmpty(true);
    setTypedText('');
    setTab('draw');
  }, [open]);

  /* ------------------------------------------------ actions */

  const hasInput =
    adopted !== null || (tab === 'type' ? typedText.trim().length > 0 : !padEmpty);

  const adoptAsset = useCallback((asset: SignatureAssetRecord) => {
    setTab(asset.method === 'typed' ? 'type' : 'draw');
    setAdopted(asset);
    // The adopted PNG is the truth surface; blank the pad and any typed text
    // beneath it.
    setTypedText('');
    groupsRef.current = [];
    padRef.current?.clear();
    setPadEmpty(true);
  }, []);

  /** Shared capture: ink bounds, trim into a fresh canvas, PNG blob. */
  const capture = useCallback(async (): Promise<SignatureCapture | null> => {
    if (adopted) {
      return {
        png: adopted.png,
        method: adopted.method,
        ...(adopted.strokes ? { strokes: adopted.strokes } : {}),
        width: adopted.width,
        height: adopted.height,
      };
    }
    const canvas = canvasRef.current;
    if (!canvas) return null;
    if (tab === 'draw') {
      const pad = padRef.current;
      if (!pad || pad.isEmpty()) return null;
    } else if (!typedText.trim()) {
      return null;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const bounds = computeInkBounds(image.data, canvas.width, canvas.height, {
      alphaThreshold: INK_ALPHA_THRESHOLD,
      padding: Math.round(10 * ratio),
    });
    if (!bounds) return null;
    const blob = await cropToPng(canvas, bounds);
    if (!blob) return null;
    // Capture-space CSS dims: canvas pixels / ratio.
    const cssWidth = Math.round(canvas.width / ratio);
    const cssHeight = Math.round(canvas.height / ratio);
    return {
      png: blob,
      method: tab === 'draw' ? 'drawn' : 'typed',
      ...(tab === 'draw' ? { strokes: captureStrokes(groupsRef.current) } : {}),
      width: cssWidth,
      height: cssHeight,
    };
  }, [adopted, tab, typedText]);

  const onSave = useCallback(async () => {
    const captured = await capture();
    if (!captured) {
      toast.error(tab === 'draw' ? 'Draw a signature first.' : 'Type a name first.');
      return;
    }
    try {
      await saveSignature({
        method: captured.method,
        ...(captured.strokes ? { strokes: captured.strokes } : {}),
        png: captured.png,
        width: captured.width,
        height: captured.height,
      });
      toast.success('Saved on this device.');
    } catch (error) {
      if (error instanceof SignatureAssetTooLargeError) {
        toast.error(`${error.message} Try drawing a shorter signature.`);
      } else if (error instanceof SignatureAssetLimitError) {
        toast.error(error.message);
      } else {
        toast.error('Could not save the signature in this browser.');
      }
    }
  }, [capture, tab]);

  const onUseClick = useCallback(async () => {
    const captured = await capture();
    if (!captured) {
      toast.error(tab === 'draw' ? 'Draw a signature first.' : 'Type a name first.');
      return;
    }
    onUse?.(captured);
    groupsRef.current = [];
    setAdopted(null);
    setPadEmpty(true);
    setTypedText('');
    onOpenChange(false);
  }, [capture, onOpenChange, onUse, tab]);

  const canSaveToday = adopted === null && hasInput;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-xl gap-5 rounded-2xl border-black/10 bg-card shadow-[0_24px_80px_-24px_oklch(0.2_0.02_152/0.35)] dark:border-white/10"
        data-testid="signature-pad-dialog"
      >
        <div className="space-y-1.5 pr-6">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-secondary px-2.5 py-0.5 text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            <PenLine className="size-3" aria-hidden />
            Signature
          </span>
          <DialogTitle className="text-lg font-semibold tracking-tight">
            {mode === 'insert' ? 'Add your signature' : 'Create a signature'}
          </DialogTitle>
          <DialogDescription>
            Draw or type it once. It stays on this device; nothing is uploaded.
          </DialogDescription>
        </div>

        {/* Segment switch */}
        <div
          className="flex w-fit items-center gap-1 rounded-full bg-secondary p-1"
          role="tablist"
          aria-label="Signature input method"
        >
          {(['draw', 'type'] as Tab[]).map((entry) => (
            <button
              key={entry}
              type="button"
              role="tab"
              aria-selected={tab === entry}
              data-testid={`signature-tab-${entry}`}
              disabled={entry === 'type' && fontReady === false}
              className={cn(
                'rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] disabled:cursor-not-allowed disabled:opacity-50',
                tab === entry
                  ? 'bg-card text-foreground shadow-sm ring-1 ring-black/5 dark:ring-white/10'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => {
                setAdopted(null);
                setPadEmpty(true);
                setTab(entry);
              }}
            >
              {entry === 'draw' ? 'Draw' : 'Type'}
            </button>
          ))}
        </div>

        {tab === 'type' && fontReady === false && (
          <p
            className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400"
            role="status"
          >
            This browser could not load the handwriting font, so the Type tab is unavailable.
            Drawing still works.
          </p>
        )}

        {tab === 'type' && (
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Name as it should read
            </span>
            <input
              type="text"
              value={typedText}
              maxLength={SIGNATURE_LABEL_MAX_CHARS}
              placeholder="J. R. Smith"
              onChange={(event) => setTypedText(event.target.value)}
              data-testid="signature-typed-input"
              className="h-10 w-full rounded-full bg-secondary px-4 text-sm ring-1 ring-black/5 outline-none transition-shadow duration-300 placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-primary/70 dark:ring-white/10"
            />
          </label>
        )}

        <div ref={canvasHostRef} className="relative">
          {/* Double-bezel: paper core in a machined shell. White in both themes. */}
          <div className="relative overflow-hidden rounded-2xl bg-white p-1.5 ring-1 ring-black/10 shadow-[0_1px_2px_rgba(0,0,0,0.05),inset_0_1px_1px_rgba(255,255,255,0.7)] dark:ring-white/12">
            <div className="relative rounded-[calc(1rem-0.375rem)] bg-white">
              {tab === 'draw' && !adopted && (
                <>
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-x-5 border-b-2 border-dashed border-black/10"
                    style={{ bottom: BASELINE_FROM_BOTTOM }}
                  />
                  <span
                    aria-hidden
                    className="pointer-events-none absolute left-4 text-sm leading-none text-black/30 select-none"
                    style={{ bottom: BASELINE_FROM_BOTTOM - 22 }}
                  >
                    ×
                  </span>
                </>
              )}
              <canvas
                ref={attachCanvas}
                role="img"
                aria-label={
                  adopted
                    ? 'Preview of the selected saved signature'
                    : tab === 'draw'
                      ? 'Signature drawing area; draw with mouse, pen or touch'
                      : 'Signature preview of the typed name'
                }
                className={cn(
                  'relative z-10 block touch-none select-none',
                  tab === 'draw' && !adopted ? 'cursor-crosshair' : 'pointer-events-none',
                )}
                style={{
                  height: CANVAS_CSS_HEIGHT,
                  width: '100%',
                }}
                data-testid={`signature-canvas-${tab}`}
              />
              {adopted && (
                <img
                  src={URL.createObjectURL(adopted.png)}
                  alt=""
                  className="pointer-events-none absolute inset-0 z-20 m-auto max-h-[85%] max-w-[80%] object-contain"
                  onLoad={(event) => URL.revokeObjectURL(event.currentTarget.src)}
                />
              )}
              {!adopted && tab === 'draw' && padEmpty && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 top-1/2 z-0 -translate-y-1/2 text-center text-sm italic text-black/25 select-none"
                >
                  Draw your signature above the line
                </span>
              )}
              {!adopted && tab === 'type' && !typedText.trim() && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 top-1/2 z-0 -translate-y-1/2 text-center text-sm italic text-black/25 select-none"
                >
                  Your signature appears here
                </span>
              )}
            </div>
          </div>

          {/* Controls row */}
          <div className="mt-2 flex items-center justify-between">
            <div className="flex items-center gap-1">
              {tab === 'draw' ? (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 rounded-full text-muted-foreground transition-transform duration-200 active:scale-[0.96] disabled:opacity-35"
                        aria-label="Undo last stroke"
                        data-testid="signature-undo"
                        disabled={adopted !== null || padEmpty}
                        onClick={() => {
                          const pad = padRef.current;
                          if (!pad) return;
                          const groups = [...groupsRef.current];
                          if (groups.length === 0) return;
                          groups.pop();
                          groupsRef.current = groups;
                          // fromData clears first; keep the flag honest after.
                          pad.fromData(groups);
                          setPadEmpty(pad.isEmpty());
                        }}
                      >
                        <Undo2 className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Undo last stroke</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 rounded-full text-muted-foreground transition-transform duration-200 active:scale-[0.96] disabled:opacity-35"
                        aria-label="Clear the signature"
                        data-testid="signature-clear"
                        disabled={adopted === null && padEmpty}
                        onClick={() => {
                          groupsRef.current = [];
                          padRef.current?.clear();
                          setAdopted(null);
                          setPadEmpty(true);
                        }}
                      >
                        <Eraser className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Clear</TooltipContent>
                  </Tooltip>
                </>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 rounded-full text-muted-foreground transition-transform duration-200 active:scale-[0.96] disabled:opacity-35"
                      aria-label="Clear the typed name"
                      disabled={!typedText}
                      onClick={() => {
                        setTypedText('');
                      }}
                    >
                      <Eraser className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Clear</TooltipContent>
                </Tooltip>
              )}
            </div>

            {/* pen swatches (draw only) */}
            {tab === 'draw' && !adopted && (
              <div className="flex items-center gap-2" role="group" aria-label="Ink colour">
                {PEN_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-pressed={pen === color}
                    aria-label={color === INK ? 'Black ink' : 'Blue ink'}
                    data-testid={`signature-pen-${color === INK ? 'ink' : 'blue'}`}
                    className={cn(
                      'size-6 rounded-full ring-offset-2 transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:scale-110 active:scale-95',
                      pen === color
                        ? 'ring-2 ring-primary ring-offset-background'
                        : 'ring-1 ring-black/10 dark:ring-white/15',
                    )}
                    style={{ background: color }}
                    onClick={() => {
                      setPen(color);
                      if (padRef.current) padRef.current.penColor = color;
                    }}
                  />
                ))}
              </div>
            )}
            {tab === 'type' && fontReady === true && (
              <span className="text-[11px] text-muted-foreground">Caveat, sized to fit</span>
            )}
          </div>
        </div>

        <AssetStrip
          assets={assets}
          selectedId={adopted?.id ?? null}
          onSelect={adoptAsset}
          onDelete={(asset) => {
            void deleteSignature(asset.id).then(() => {
              if (adopted?.id === asset.id) setAdopted(null);
              toast.success('Deleted from this device.');
            });
          }}
        />

        {/* Footer CTAs */}
        <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-4 dark:border-white/5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 rounded-full px-4 text-sm text-muted-foreground transition-colors duration-300 hover:text-foreground"
            data-testid="signature-save-copy"
            disabled={!canSaveToday}
            onClick={() => void onSave()}
          >
            Save for later
          </Button>
          {mode === 'insert' ? (
            <Button
              type="button"
              size="sm"
              className="group h-10 rounded-full pr-2 pl-5 text-sm transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98] disabled:opacity-60"
              data-testid="signature-use"
              disabled={!hasInput}
              onClick={() => void onUseClick()}
            >
              Use signature
              <span className="ml-2.5 flex size-7 items-center justify-center rounded-full bg-primary-foreground/15 transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5">
                <PenLine className="size-3.5" aria-hidden />
              </span>
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              className="group h-10 rounded-full pr-2 pl-5 text-sm transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98] disabled:opacity-60"
              data-testid="signature-save-primary"
              disabled={!canSaveToday}
              onClick={() => void onSave()}
            >
              Save as new
              <span className="ml-2.5 flex size-7 items-center justify-center rounded-full bg-primary-foreground/15 transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5">
                <PenLine className="size-3.5" aria-hidden />
              </span>
            </Button>
          )}
        </div>

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Saved copies live only in this browser. A signature is never sent to a server, and
          signing adds an honest, non-certified audit note next to the file.
        </p>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- helpers */

async function cropToPng(
  source: HTMLCanvasElement,
  bounds: { x: number; y: number; width: number; height: number },
): Promise<Blob | null> {
  const trimmed = document.createElement('canvas');
  trimmed.width = bounds.width;
  trimmed.height = bounds.height;
  const ctx = trimmed.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(
    source,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    0,
    0,
    bounds.width,
    bounds.height,
  );
  return new Promise<Blob | null>((resolve) => {
    trimmed.toBlob((blob) => resolve(blob), 'image/png');
  });
}
