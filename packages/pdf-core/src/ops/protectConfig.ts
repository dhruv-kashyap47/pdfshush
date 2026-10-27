/**
 * Protect PDF options that the UI is allowed to import.
 *
 * This module deliberately has no pdf-lib dependency: the tool page uses these
 * constants at runtime for validation and defaults, and importing them from
 * `protect.ts` would pull the whole PDF engine into the lazy tool chunk.
 */

export const PROTECT_LIMITS = {
  /** A short password is the weakest link in an otherwise sound cipher. */
  minPasswordLength: 8,
  maxPasswordLength: 256,
  algorithm: 'AES-256',
} as const;

export interface ProtectPermissions {
  /** Printing, including high-resolution printing. */
  printing: boolean;
  /** Copying text and images out of the document. */
  copying: boolean;
  /** Editing the document's content. */
  modifying: boolean;
  /** Adding or changing annotations. */
  annotating: boolean;
  /** Filling existing form fields. */
  fillingForms: boolean;
  /** Inserting, deleting, rotating or reordering pages. */
  documentAssembly: boolean;
}

/**
 * The default is useful, not maximally hostile: people can print and fill
 * forms, but cannot copy, edit or reassemble the document. Accessibility
 * extraction is always allowed because locking assistive technology out is not
 * a sensible default (and is not enforceable by the encryption itself).
 */
export const PROTECT_DEFAULT_PERMISSIONS: ProtectPermissions = {
  printing: true,
  copying: false,
  modifying: false,
  annotating: true,
  fillingForms: true,
  documentAssembly: false,
};
