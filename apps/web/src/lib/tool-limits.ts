/**
 * The honest limit sentence for each live tool.
 *
 * The shared trust card used to say "No limits." and then contradict itself
 * with a global 500-page / 250 MB cap. That is the exact failure mode M5 exists
 * to remove: a claim a user can disprove in one run. The replacement keeps the
 * true part ("no account, no quota") and states the ceiling that actually
 * applies to *that* tool, because the ceiling is not the same everywhere:
 *
 *  - page operations edit the full 500-page client limit;
 *  - raster rebuilds (redaction, grayscale, dark mode, strong compression) stop
 *    at 150 pages, because every page becomes a bitmap;
 *  - combine/jpg-to-pdf bound the input count;
 *  - AI tools bound text characters and model turns, not pages;
 *  - workflows/API/MCP are server-run and have their own daily quotas.
 *
 * Numbers come from the engine constants wherever one exists, so a limit change
 * updates the copy in the same commit instead of leaving the page lying.
 */

import {
  BATES_LIMITS,
  IMAGE_LIMITS,
  LIMITS,
  OCR_LIMITS,
  PROTECT_LIMITS,
  RENAME_LIMITS,
  formatBytes,
} from '@pdfshush/pdf-core';

const { client, tool, server, workflow, ai } = LIMITS;

const mb = (bytes: number): string => formatBytes(bytes, 0);
const pages = client.maxPages.toLocaleString();
const perFile = mb(client.maxFileBytes);
const perRun = mb(client.maxTotalBytes);

/** The sentence shown after "No account or quota." */
export const TOOL_LIMIT_NOTES: Record<string, string> = {
  'merge-pdf': `Up to ${pages} pages and ${perRun} across all PDFs in one run (${perFile} per file).`,
  'organize-pdf': `Up to ${pages} pages per run. Reordering copies pages, so text stays selectable.`,
  'pdf-to-jpg': `Up to ${pages} pages per run, rendered at ${tool.defaultImageWidthPx.toLocaleString()} px wide by default (maximum ${tool.maxImagePixels.toLocaleString()} px).`,
  'delete-pages': `Up to ${pages} pages and ${perRun} per run (${perFile} per file).`,
  'extract-pages': `Up to ${pages} pages and ${perRun} per run (${perFile} per file).`,
  'rotate-pdf': `Up to ${pages} pages and ${perRun} per run (${perFile} per file).`,
  'split-by-pages': `Up to ${pages} pages per run, with at most ${tool.maxZipEntries} output files — raise the chunk size if the split would create more.`,
  'alternate-mix': `Two PDFs, up to ${pages} pages and ${perRun} combined.`,
  'split-in-half': `Up to ${pages} pages per run; every page becomes two documents.`,
  'page-numbers': `Up to ${pages} pages and ${perRun} per run (${perFile} per file).`,
  'crop-pdf': `Up to ${pages} pages and ${perRun} per run (${perFile} per file).`,
  'header-footer': `Up to ${pages} pages and ${perRun} per run (${perFile} per file).`,
  'n-up': `Up to ${pages} pages per run, arranged 2, 4 or 8 pages to a sheet.`,
  'edit-pdf': `Up to ${tool.maxEditObjects.toLocaleString()} overlay objects and ${tool.maxTextObjectChars.toLocaleString()} characters per text box in one export; embedded images up to ${mb(tool.maxImageBytes)} and ${tool.maxImagePixels.toLocaleString()} px per edge.`,
  'redact-pdf': `Up to ${tool.maxRedactPages} pages and ${tool.maxRedactRegions} regions per run; the rebuilt output must stay under ${mb(tool.maxRedactOutputBytes)}.`,
  'summarize-pdf': `Up to ${ai.clientMaxContextChars.toLocaleString()} characters of document text and ${ai.clientMaxTurns} model turns per run.`,
  'chat-with-pdf': `Up to ${ai.clientMaxContextChars.toLocaleString()} characters of document text and ${ai.clientMaxTurns} model turns per run.`,
  'edit-pdf-with-ai': `Up to ${ai.clientMaxContextChars.toLocaleString()} characters of document text and ${ai.clientMaxTurns} model turns per run.`,
  'fill-sign': `Up to ${tool.maxEditObjects.toLocaleString()} overlay objects in one export; signatures are drawn or typed in this browser and never uploaded.`,
  signature: 'Stored only in this browser. There is no account, no sync and no expiry.',
  api: `Anonymous callers get ${server.anonymousTasksPerDay} tasks/day and ${server.anonymousTasksPerMinute}/minute; a key gets ${server.api.tasksPerDay}/day per key and ${server.api.accountTasksPerDay.toLocaleString()}/day per account, with ${mb(server.maxUploadBytes)} uploads. Files are deleted within an hour of the job finishing.`,
  mcp: `Runs as a local process over stdio. Each tool call still uses the API quota: ${server.api.tasksPerDay} tasks/day per key and ${mb(server.api.bytesPerDay)} of uploads per day.`,
  'flip-pdf': `Up to ${pages} pages and ${perRun} per run (${perFile} per file).`,
  watermark: `Up to ${pages} pages and ${perRun} per run; image watermarks must be PNG or JPEG up to ${mb(tool.maxImageBytes)}.`,
  'edit-metadata': 'Up to 500 characters per metadata field. Creation and modification dates are left untouched rather than invented.',
  'remove-annotations': `Up to ${pages} pages and ${perRun} per run (${perFile} per file).`,
  'pdf-to-text': `Up to ${pages} pages per run. Scanned pages have no text layer, so they come back empty rather than guessed.`,
  'grayscale-pdf': `Up to ${tool.maxRedactPages} pages per run — every page is rebuilt as an image, which is why the cap is lower than ${pages}.`,
  'resize-pdf': `Up to ${pages} pages and ${perRun} per run (${perFile} per file).`,
  'extract-images': `Up to ${pages} pages per run. Images the parser cannot decode safely are skipped, and the result says how many.`,
  'split-by-size': `Up to ${pages} pages, at most ${LIMITS.tool.maxZipEntries} output files, and a target of at least 100 KB. Sizes are measured, never promised.`,
  'flatten-pdf': `Up to ${pages} pages and ${perRun} per run (${perFile} per file).`,
  'unlock-pdf': `Up to ${perFile} per file. An owner-restricted PDF unlocks without a password; a file with an open password needs that password.`,
  'jpg-to-pdf': `Up to ${IMAGE_LIMITS.maxImages} JPEG or PNG images per PDF, ${mb(tool.maxImageBytes)} and ${tool.maxImagePixels.toLocaleString()} px per image.`,
  'rename-pdf': `Up to ${RENAME_LIMITS.maxFiles} files at once, with a pattern up to ${RENAME_LIMITS.maxPatternChars} characters. Renaming changes the name only — the bytes are untouched.`,
  'bates-numbering': `Up to ${pages} pages per run; prefixes are capped at ${BATES_LIMITS.maxPrefixChars} characters and numbers at ${BATES_LIMITS.maxDigits} digits.`,
  'split-by-text': `Up to ${pages} pages per run. Matching is literal, not fuzzy, and a scan with no text layer cannot match.`,
  'compress-pdf': `Smart compression handles the full ${pages}-page limit; strong (raster) compression rebuilds pages as images and stops at ${tool.maxRedactPages} pages.`,
  workflows: `Server-run, so each step uses the API quota (${server.anonymousTasksPerDay} tasks/day anonymous, ${server.api.tasksPerDay}/day with a key). A recipe has at most ${workflow.maxSteps} steps, and files are deleted within an hour.`,
  'batch-run': `Runs one operation over up to ${tool.maxZipEntries} files, because the results are packed into a single ZIP. Each file still has to fit the ${pages}-page / ${perRun} client limit.`,
  stamp: `Up to ${pages} pages and ${perRun} per run (${perFile} per file).`,
  'repair-pdf': `Up to ${perFile} per file. This rebuilds the cross-reference table and trailer; it does not reconstruct damaged content streams or missing fonts.`,
  'combine-pdf': `Up to ${tool.maxCombineFiles} files per run, ${pages} pages and ${perRun} in total. Office files are refused by name rather than silently dropped.`,
  'image-editor': `Images up to ${mb(tool.maxImageBytes)} and about 80 megapixels; the editor runs in this tab and exports a new image.`,
  'split-by-bookmarks': `Up to ${tool.maxBookmarkParts} parts from an outline of at most ${tool.maxOutlineEntries.toLocaleString()} bookmarks.`,
  'create-forms': `Up to ${tool.maxFormFields} new fields per run, with names up to ${tool.maxFormFieldNameChars} characters.`,
  'create-bookmarks': `Up to ${tool.maxOutlineEntries.toLocaleString()} bookmarks per run, with titles up to ${tool.maxBookmarkTitleChars} characters.`,
  'protect-pdf': `AES-256 encryption with an open password of ${PROTECT_LIMITS.minPasswordLength}–${PROTECT_LIMITS.maxPasswordLength} characters (${PROTECT_LIMITS.maxPasswordBytes} bytes, since multibyte text counts heavier). There is no recovery key, so keep the password.`,
  'dark-mode-pdf': `Up to ${tool.maxRedactPages} pages per run — every page is rebuilt as an image, which is why the cap is lower than ${pages}.`,
  deskew: `Up to ${tool.maxRedactPages} pages per run. Auto-detection searches −10° to +10°; the manual override accepts up to ±45°. Because pages are rebuilt as images, text stops being selectable.`,
  'ocr-pdf': `Up to ${OCR_LIMITS.maxPages} pages per run. The first run downloads about 15 MB of recognizer and English language data once, then works offline; recognition is English-only and probabilistic. Pages that already have a text layer are kept untouched.`,
};

/** Falls back to the global client ceiling for a slug we forgot to describe. */
export function limitNoteFor(slug: string): string {
  return (
    TOOL_LIMIT_NOTES[slug] ??
    `Up to ${pages} pages and ${perRun} per run (${perFile} per file).`
  );
}
