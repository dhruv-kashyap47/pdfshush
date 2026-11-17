/**
 * Copy semantics for overlay objects.
 *
 * A duplicate or paste is a new, independent edit. Paragraph edits
 * (`native`/`inPlace`) are not that: they say "rewrite *this* original run"
 * and are keyed to the match anchor. Copying them would queue the same rewrite
 * twice -- the first applies, the second can no longer verify and falls back to
 * an overlay -- so a copy drops those intents and becomes a plain overlay.
 */

import type { EditorObject } from '@pdfshush/pdf-core';

export function detachEditIntent(object: EditorObject): EditorObject {
  const stripNative =
    (object.kind === 'text' || object.kind === 'whiteout') && Boolean(object.native);
  const stripInPlace = object.kind === 'text' && Boolean(object.inPlace);
  if (!stripNative && !stripInPlace) return object;

  const next = { ...object } as EditorObject;
  if (stripNative) delete (next as { native?: unknown }).native;
  if (stripInPlace) delete (next as { inPlace?: unknown }).inPlace;
  return next;
}

/** Deep-clones an object (image/ink buffers included) ready to paste. */
export function cloneObjectForPaste(object: EditorObject): EditorObject {
  return detachEditIntent(structuredClone(object) as EditorObject);
}
