/**
 * First-run marker for the AI welcome overlay.
 *
 * One thing only the overlay reads and writes: whether the friendly "getting
 * started" walkthrough has been shown (or dismissed) in this browser. A plain
 * UI-preference string in localStorage — it is not file data and carries no
 * secret; the key itself lives exclusively in the IndexedDB record
 * (`./storage`), and the onboarding flow saves through the same `onSave`
 * pipeline as the settings card, never directly.
 *
 * The marker is written for *any* interaction with the overlay, so the card
 * never nags: dismissed once, it stays dismissed even after the key is
 * forgotten later.
 */

const WELCOME_KEY = 'pdfshush.ai.welcome.v1';
const ANSWERED = 'answered';

/** Guarded for the same non-browser environments `aiState()` tolerates. */
export function aiWelcomeAnswered(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(WELCOME_KEY) === ANSWERED;
  } catch {
    return false;
  }
}

export function markAiWelcomeAnswered(): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(WELCOME_KEY, ANSWERED);
  } catch {
    // A storage-walled browser still gets the overlay; it just shows every time.
  }
}
