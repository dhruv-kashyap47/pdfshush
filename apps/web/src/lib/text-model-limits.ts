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
  | 'footnote-tails'
  | 'drop-caps'
  | 'vector-figures'
  | 'forms-as-columns'
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
    text: 'A paragraph that continues onto the next page stays two paragraphs, so editing the first does not reflow the rest.',
  },
  {
    id: 'footnote-tails',
    text: 'A footnote whose second line sits above the margin can be treated as a separate paragraph.',
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
    id: 'forms-as-columns',
    text: 'Forms with side-by-side boxes can be read as columns. Confidence drops accordingly, and the grouping may be coarse.',
  },
  {
    id: 'tables',
    text: 'This editor does not edit tables. Mixed-alignment tables are refused rather than guessed, and merged cells are not reconstructed.',
  },
  {
    id: 'scanned-pages',
    text: 'Scanned pages have no text layer until OCR: they can be marked, but not rewritten. There is no OCR in this build.',
  },
];
