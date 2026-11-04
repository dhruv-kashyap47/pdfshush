/**
 * Product measurement marks (PLAN.md §31.6, M5.0).
 *
 * The milestone opens by measuring the product instead of guessing about it, so
 * the app publishes a few `performance.mark` entries that a harness can read
 * without instrumenting the DOM or scraping layout. They are inert: no visual
 * output, no network, no storage, and every call is wrapped so an environment
 * without the User Timing API simply records nothing.
 *
 * - `pdfshush:app-ready` — React has committed the shell.
 * - `pdfshush:page-ready` — a route has committed (detail: pathname).
 * - `pdfshush:tool-ready` — a tool route has committed its body (detail: slug).
 * - `pdfshush:first-interaction` — the first pointer/key input after readiness.
 *
 * Only the *last* mark of each name matters; SPA navigations re-mark, and the
 * harness clears before a measured visit.
 */

export type MarkName = 'app-ready' | 'page-ready' | 'tool-ready' | 'first-interaction';

/** Records a mark, replacing any earlier one with the same name. */
export function mark(name: MarkName, detail?: Record<string, string>): void {
  try {
    const entries = performance.getEntriesByName(`pdfshush:${name}`);
    if (entries.length > 0) performance.clearMarks(`pdfshush:${name}`);
    performance.mark(`pdfshush:${name}`, detail ? { detail } : undefined);
  } catch {
    /* User Timing unavailable — measurement is optional, the app is not. */
  }
}

/**
 * Marks the first real input after the shell is ready. Installed once by
 * `main.tsx`; listeners are passive and remove themselves, so this costs
 * nothing after the first click or key press.
 */
export function observeFirstInteraction(): void {
  if (typeof window === 'undefined') return;

  const done = () => {
    mark('first-interaction');
    window.removeEventListener('pointerdown', done, true);
    window.removeEventListener('keydown', done, true);
  };

  window.addEventListener('pointerdown', done, { capture: true, passive: true, once: true });
  window.addEventListener('keydown', done, { capture: true, passive: true, once: true });
}
