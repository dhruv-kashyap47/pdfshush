/**
 * Update notice for a waiting service worker.
 *
 * This deliberately lives in the document flow instead of a toast. The old
 * prompt used an infinite-duration toast pinned to the bottom, which covered
 * real page controls on small screens and could not be dismissed without losing
 * the only convenient way to activate the new build. A one-line banner under
 * the header never obscures content, and stays available until the user reloads.
 */

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  applyServiceWorkerUpdate,
  getWaitingServiceWorker,
  subscribeServiceWorkerUpdate,
} from '@/lib/service-worker';

export function UpdateBanner() {
  const [available, setAvailable] = useState(() => getWaitingServiceWorker() !== null);

  useEffect(() => {
    // Read once after mount as well: the worker may have started waiting between
    // the initial state read and this subscription.
    const sync = () => setAvailable(getWaitingServiceWorker() !== null);
    sync();
    return subscribeServiceWorkerUpdate(sync);
  }, []);

  if (!available) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="update-banner border-b border-primary/20 bg-primary/[0.06]"
      data-testid="update-banner"
    >
      <div className="mx-auto flex max-w-7xl items-center gap-2.5 px-4 py-2 text-xs sm:gap-3 sm:px-6 sm:text-sm lg:px-8">
        <RefreshCw className="size-3.5 shrink-0 text-primary sm:size-4" aria-hidden />
        <p className="min-w-0 flex-1 leading-snug">
          <span className="font-medium text-foreground">
            <span className="sm:hidden">Update ready.</span>
            <span className="hidden sm:inline">A new version of pdfshush is ready.</span>
          </span>{' '}
          <span className="hidden text-muted-foreground sm:inline">
            Reload to use it. Open tabs keep the version they started with.
          </span>
        </p>
        <Button
          type="button"
          size="sm"
          className="h-9 shrink-0 rounded-full px-3 text-xs sm:h-8"
          onClick={applyServiceWorkerUpdate}
        >
          Reload
        </Button>
      </div>
    </div>
  );
}
