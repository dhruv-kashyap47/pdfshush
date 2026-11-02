/**
 * Real-document corpus.
 *
 * The synthetic corpus gives exact precision/recall, but it is drawn by this
 * repository and can accidentally encode this repository's assumptions. These
 * are unmodified documents downloaded from their publishers, committed as-is,
 * and annotated by hand with what a reader sees on the page. They are scored
 * with invariants (nothing lost, nothing duplicated, order preserved) plus
 * landmark roles, which is what can be asserted about a real page without
 * pretending to pixel-perfect ground truth.
 *
 * Provenance:
 *   irs-1040.pdf        irs.gov/pub/irs-pdf/f1040.pdf        (2025 form, 2 pages)
 *   arxiv-1409.0473.pdf arxiv.org/pdf/1409.0473v7            (ICLR 2015, 15 pages)
 *   arxiv-1810.04805.pdf arxiv.org/pdf/1810.04805v2          (BERT, 16 pages)
 */

import type { ParagraphRole } from '../../src/document/types.js';

export interface RealLandmark {
  /** Case-insensitive substring of the paragraph's text. */
  text: string;
  /** Any of these roles is a correct classification. */
  roles: ParagraphRole[];
}

export interface RealDocumentSpec {
  name: string;
  file: string;
  pages: number;
  /** Page indexes the landmarks apply to. */
  landmarks: { page: number; entries: RealLandmark[] }[];
  /** Column count on a page, when the page makes it unambiguous. */
  columns?: { page: number; count: number }[];
  /** A form whose grid must be detected at least once. */
  expectTables?: boolean;
  /**
   * Verbatim sentences that must survive extraction, in reading order. These
   * catch text loss and reordering that per-line metrics cannot see.
   */
  probes?: { page: number; text: string }[];
}

export const REAL_DOCUMENTS: readonly RealDocumentSpec[] = [
  {
    name: 'irs-1040',
    file: 'test/corpus/real/irs-1040.pdf',
    pages: 2,
    landmarks: [
      {
        page: 1,
        entries: [
          // The form ident in the page-1 margin: it must not be lost or merged
          // into an unrelated line, and it is furniture rather than content.
          { text: 'Form 1040', roles: ['header', 'footer', 'heading', 'body'] },
          { text: 'Under penalties of perjury', roles: ['body', 'footnote'] },
          { text: 'Your occupation', roles: ['body', 'table-cell', 'list-item'] },
        ],
      },
      {
        page: 0,
        entries: [
          { text: 'Your first name and middle initial', roles: ['body', 'table-cell', 'list-item'] },
          { text: 'Check here if your main home', roles: ['body', 'table-cell', 'list-item'] },
        ],
      },
    ],
    expectTables: true,
    probes: [
      {
        page: 1,
        text: 'Under penalties of perjury, I declare that I have examined this return',
      },
      { page: 1, text: 'Do you want to allow another person to discuss this return with the IRS' },
    ],
  },
  {
    name: 'arxiv-1409.0473',
    file: 'test/corpus/real/arxiv-1409.0473.pdf',
    pages: 15,
    columns: [{ page: 0, count: 1 }],
    landmarks: [
      {
        page: 0,
        entries: [
          { text: 'NEURAL MACHINE', roles: ['heading'] },
          { text: 'ABSTRACT', roles: ['heading', 'body'] },
          { text: '1 INTRODUCTION', roles: ['heading'] },
          { text: 'Published as a conference paper at ICLR 2015', roles: ['header', 'footer', 'body'] },
        ],
      },
      {
        page: 1,
        entries: [
          { text: '2 BACKGROUND', roles: ['heading'] },
          { text: '2.1 RNN ENCODER', roles: ['heading'] },
          // A real footnote: smaller than the body, marker-led, lower on the page.
          { text: 'We mean by the state-of-the-art performance', roles: ['footnote', 'body'] },
        ],
      },
    ],
    probes: [
      { page: 0, text: 'Neural machine translation is a recently proposed approach' },
      {
        page: 1,
        text: 'From a probabilistic perspective, translation is equivalent to finding a target sentence',
      },
    ],
  },
  {
    name: 'arxiv-1810.04805',
    file: 'test/corpus/real/arxiv-1810.04805.pdf',
    pages: 16,
    columns: [{ page: 1, count: 2 }],
    landmarks: [
      {
        page: 0,
        entries: [
          { text: 'BERT: Pre-training of Deep Bidirectional Transformers', roles: ['heading'] },
          { text: '1 Introduction', roles: ['heading', 'body'] },
          { text: 'Google AI Language', roles: ['body'] },
        ],
      },
      {
        page: 1,
        entries: [
          { text: '2 Related Work', roles: ['heading', 'body'] },
          { text: '2.1 Unsupervised Feature-based Approaches', roles: ['heading', 'body', 'list-item'] },
        ],
      },
    ],
    probes: [
      { page: 0, text: 'BERT is conceptually simple and empirically powerful' },
      { page: 0, text: 'Google AI Language' },
      { page: 1, text: 'There is a long history of pre-training general' },
    ],
  },
];

interface FsLike {
  readFileSync(path: string): Uint8Array;
}

function nodeFs(): FsLike {
  const proc = (
    globalThis as unknown as { process: { getBuiltinModule(name: string): unknown } }
  ).process;
  return proc.getBuiltinModule('node:fs') as FsLike;
}

export function readRealPdf(spec: RealDocumentSpec): Uint8Array {
  return new Uint8Array(nodeFs().readFileSync(spec.file));
}
