/**
 * The text model's known limits, in the user's words.
 *
 * These are the measured limitations recorded in PLAN.md 29.6 and 30.10. They
 * are not edge cases invented for a disclaimer: each one was observed on a real
 * document, and each one can change what a user sees after an edit. The editor
 * used to disclose only the scanned/OCR boundary, which left the rest to be
 * discovered the hard way.
 *
 * Kept as data rather than JSX so a test can pin coverage. If a limitation is
 * fixed, delete its entry -- this list is a claim about today, not a roadmap.
 */

export type TextModelLimitId =
  | 'cross-page-paragraphs'
  | 'drop-caps'
  | 'vector-figures'
  | 'tables'
  | 'scanned-pages';

export interface TextModelLimit {
  id: TextModelLimitId;
  /** One sentence, no jargon, no hedge beyond what is true. */
  text: string;
}

export const TEXT_MODEL_LIMITS: readonly TextModelLimit[] = [
  {
    id: 'cross-page-paragraphs',
    text: 'A paragraph that continues onto the next page is linked to its continuation, but editing the first part still does not reflow the rest.',
  },
  {
    id: 'drop-caps',
    text: 'A large drop cap can be split onto its own line. Every letter is still there; only the line break is wrong.',
  },
  {
    id: 'vector-figures',
    text: 'Only images block reflow. Text drawn inside a vector figure can be read as body text, or offered as a heading.',
  },
  {
    id: 'tables',
    text: 'A table is reported only when its grid repeats: two rows whose cells align on different edges stay text, and a form-like page needs three rows. Merged cells are not reconstructed.',
  },
  {
    id: 'scanned-pages',
    text: 'Scanned pages have no text layer until OCR: they can be marked, but not rewritten. There is no OCR in this build.',
  },
];
