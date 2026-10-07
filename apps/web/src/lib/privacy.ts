import { toast } from 'sonner';

/**
 * One-time-per-session "this ran on your device" confirmation, shown on the
 * first success screen of the session. Part of the cross-pollination funnel:
 * users who came for one tool learn that every tool works this way.
 */
let announced = false;

export function announceLocalProcessing(pageCount?: number): void {
  if (announced) return;
  announced = true;
  const subject =
    pageCount === undefined
      ? 'File processed'
      : `${pageCount.toLocaleString()} page${pageCount === 1 ? '' : 's'} processed`;
  toast.info(`${subject} on this device · 0 bytes uploaded`, { duration: 6000 });
}

/** Test hook: forget that we announced (E2E runs one session anyway). */
export function resetLocalProcessingAnnouncement(): void {
  announced = false;
}
