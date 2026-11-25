/**
 * Tool colour identity.
 *
 * Every catalog entry owns one accent from this closed palette. The accent is
 * part of the tool's identity, not decoration: the same hue follows it into the
 * mega menu, the catalog cards, the tool page heading, its icon and every
 * primary control inside the tool. A visitor who learns "red is merge, blue is
 * split" can find a tool by colour before reading the label.
 *
 * The palette is deliberately small. Adding a 59th tool must reuse a hue, so
 * the system stays learnable instead of turning the catalog into confetti.
 *
 * The values live in `tool-accent.css`; this module is the typed contract the
 * registry and the components share, so a typo cannot silently drop a colour.
 */

export const ACCENT_NAMES = [
  'red',
  'orange',
  'amber',
  'lime',
  'green',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'fuchsia',
  'pink',
  'rose',
] as const;

export type Accent = (typeof ACCENT_NAMES)[number];

/** Tool-family anchors, used by tests and by anyone choosing a new hue. */
export const ACCENT_FAMILY: Record<string, Accent> = {
  merge: 'red',
  split: 'blue',
  'edit-sign': 'green',
  security: 'rose',
  'convert-from': 'blue',
  'convert-to': 'amber',
  ai: 'violet',
  scans: 'teal',
  automate: 'violet',
  editors: 'green',
};
