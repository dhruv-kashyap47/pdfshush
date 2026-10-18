/**
 * Signature -- the reusable-signature asset manager (P6.1, §25.1 D3).
 *
 * A deliberately small page: create (draw/type through the same pad dialog the
 * editor uses), review, delete. There is deliberately no upload/import here:
 * D3 keeps assets device-local, and an imported bitmap is just an image, which
 * the Edit PDF tool already places.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eraser, Info, PenLine, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { lazy, Suspense } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  deleteSignature,
  listSignatures,
  subscribeSignatures,
  type SignatureAssetRecord,
} from '@/lib/signatures';
import { SIGNATURE_STORE_MAX } from '@/lib/signature-assets';

const SignaturePadDialog = lazy(
  () =>
    import('@/components/signature/signature-pad-dialog').then((m) => ({
      default: m.SignaturePadDialog,
    })),
);

export function SignatureTool() {
  const [assets, setAssets] = useState<SignatureAssetRecord[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [urls, setUrls] = useState<Map<string, string>>(new Map());

  const refresh = useCallback(() => {
    void listSignatures().then((records) => setAssets(records));
  }, []);

  useEffect(() => {
    refresh();
    return subscribeSignatures(refresh);
  }, [refresh]);

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

  return (
    <div className="space-y-5" data-testid="signature-tool">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-base font-semibold tracking-tight">Your signatures</h2>
          <p className="text-sm text-muted-foreground">
            Draw or type once, then place it from any signing session on this device. Saved copies
            live in this browser only: {assets.length} / {SIGNATURE_STORE_MAX} used.
          </p>
        </div>
        <Button
          size="sm"
          className="group h-10 rounded-full pr-2 pl-5 transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98]"
          onClick={() => setDialogOpen(true)}
          data-testid="signature-new"
        >
          <PenLine className="mr-2 size-4" aria-hidden />
          New signature
          <span className="ml-2 flex size-7 items-center justify-center rounded-full bg-primary-foreground/15 transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5">
            <PenLine className="size-3.5" aria-hidden />
          </span>
        </Button>
      </div>

      {assets.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-start gap-3 px-6 py-8 text-left sm:flex-row sm:items-center">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground">
              <Eraser className="size-5" aria-hidden />
            </span>
            <p className="flex-1 text-sm text-muted-foreground">
              Nothing saved yet. Create a signature and it is ready in every Fill &amp; Sign
              session from this device, and nothing is uploaded, ever.
            </p>
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
              Draw one now
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {assets.map((asset) => {
            const url = urls.get(asset.id);
            if (!url) return null;
            return (
              <Card
                key={asset.id}
                className="group overflow-hidden pt-0 transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:shadow-[0_16px_40px_-20px_rgba(0,0,0,0.25)]"
                data-testid={`signature-manage-${asset.id}`}
              >
                <div className="relative flex h-32 items-center justify-center bg-white p-4">
                  <img src={url} alt="" className="max-h-full max-w-full object-contain" />
                  <button
                    type="button"
                    aria-label="Delete this signature"
                    className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full bg-card text-muted-foreground opacity-70 ring-1 ring-black/10 transition-opacity duration-200 hover:opacity-100 hover:text-destructive focus-visible:opacity-100 dark:ring-white/15"
                    data-testid="signature-delete"
                    onClick={() => {
                      void deleteSignature(asset.id).then(() => {
                        toast.success('Deleted from this device.');
                      });
                    }}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </div>
                <div className="flex items-center justify-between px-4 py-2.5 text-[11px] text-muted-foreground">
                  <span className="tracking-wide uppercase">
                    {asset.method === 'drawn' ? 'Drawn' : 'Typed'}
                  </span>
                  <span className="tabular-nums">
                    {new Date(asset.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <div className="flex items-start gap-2.5 rounded-xl bg-secondary/60 px-4 py-3 text-sm text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>
          Saved signatures stay in this browser (IndexedDB). Placing one on a document marks its
          export with an honest audit note (digests and placements, never a certification claim).
          Start a signature session in{' '}
          <Link to="/tools/fill-sign" className="font-medium text-primary hover:underline">
            Fill &amp; Sign
          </Link>
          .
        </p>
      </div>

      {dialogOpen && (
        <Suspense fallback={null}>
          <SignaturePadDialog
            open
            onOpenChange={setDialogOpen}
            mode="manage"
          />
        </Suspense>
      )}
    </div>
  );
}
