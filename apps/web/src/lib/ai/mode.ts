/**
 * Which AI mode the user is in.
 *
 * `byok` sends the request from this tab with the user's own key; `managed` goes
 * through the PDFShush trial endpoint. The value is stored inside the same
 * IndexedDB record as the provider settings (see ./storage) rather than in
 * localStorage: the two are one piece of state, so they are read, migrated and
 * erased together.
 */

import { aiState, setAiState } from './storage';

export type AiMode = 'byok' | 'managed';

export function loadAiMode(): AiMode {
  return aiState().mode;
}

export function saveAiMode(mode: AiMode): void {
  setAiState({ mode: mode === 'managed' ? 'managed' : 'byok' });
}
