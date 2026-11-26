/**
 * The guides index FAQ.
 *
 * Shared by the SPA page and the prerenderer so the visible answers and the
 * FAQPage schema are the same strings. Keep each answer short enough to read in
 * the panel and specific enough to be worth marking up.
 */
export const GUIDE_INDEX_FAQS = [
  {
    question: 'Are these PDF guides free to read?',
    answer:
      'Yes. Every guide is free, needs no account, and links to tools that run in your browser without uploading the file.',
  },
  {
    question: 'Do the tools need an account or a trial?',
    answer:
      'No. The PDF tools need no account, no trial and no install. Signing in only syncs settings and history across devices.',
  },
  {
    question: 'Do I need to install software to follow a guide?',
    answer:
      'For most tasks, no. The browser tools cover merging, splitting, compressing, redacting, OCR and signing, and some guides explain the built-in macOS and iPhone options as well.',
  },
] as const;
