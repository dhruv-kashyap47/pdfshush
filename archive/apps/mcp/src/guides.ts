/**
 * The `pdfshush://guide/*` resource contents: what each server-runnable slug
 * does, and the `options` vocabulary its engine job actually reads (§25.4 --
 * one guide resource per slug, the GenOffice `genoffice://guide/*` pattern).
 *
 * Each guide states the file constraints and the option keys explicitly, and
 * the honest limits (what the deployment rejects) rather than a fantasy of
 * flexibility. Where an option shape is documented it is the same shape the
 * API's `validation_failed` errors repair from.
 */

export interface SlugGuide {
  slug: string;
  title: string;
  text: string;
}

const FILE_NOTE = `files: 1-50 entries of {name, data}, data = base64 PDF bytes per file (max ${'{'}inlineCap{'}'} encoded bytes each; send fewer, smaller files rather than one huge base64 blob). Files must be PDFs (the %{PDF-}-magic check is enforced).`;

export function guideFor(
  slug: string,
  labels: Record<string, string>,
  inlineCapBytes: number,
): SlugGuide | undefined {
  const label = labels[slug] ?? slug;
  const files = FILE_NOTE.replace('{inlineCap}', String(inlineCapBytes));
  const head = `${label} (slug: "${slug}")\n${files}\n`;
  const text = (() => {
    switch (slug) {
      case 'inspect':
        return (
          head +
          'Reads the PDFs and returns structure only: page count, sizes, metadata. ' +
          'options: none. The status carries pageCount; treat this as the cheap first call before any edit.'
        );
      case 'merge':
        return (
          head +
          'Concatenates the files in the order given into one PDF. ' +
          'options: { reverse?: boolean } (append files in reverse order). ' +
          'Duplicate file names are impossible; submit each input once, ordered.'
        );
      case 'organize':
        return (
          head +
          'Builds a new PDF from an explicit page list (organize, delete pages, extract pages, rotate). ' +
          'options: { pageOrder?: [{docIndex, pageIndex, rotateDegrees?}...] (zero-based; default keeps every page), ' +
          'rotateDegrees?: 0|90|180|270 (all pages), crop?: {x,y,width,height} (PDF points, clamped), ' +
          'outputName?: string }. Omit pageOrder and the output is every page unchanged.'
        );
      case 'stamp':
        return (
          head +
          'Overlays page numbers / header / footer text on every page. ' +
          'options: { header?: {text, position?, style?}, footer?: {text, position?, style?}, ' +
          'pageOrder?: [...], style?: {fontSize?, margin?, bold?, color?}, outputName?: string }. ' +
          'position is "<top|middle|bottom>-<left|center|right>"; style color is {r,g,b} in 0..1. ' +
          'Template tokens: {n} = 1-based page number, {N} = total pages ("Page {n} of {N}").'
        );
      case 'split-by-pages':
        return (
          head +
          'Splits the input into chunk-sized PDFs. ' +
          'options: { chunkSize?: integer (pages per part, default 1) }. ' +
          'Single input file; multi outputs come back as a listing, one file per part.'
        );
      case 'split-in-half':
        return (
          head +
          'Cuts each page in half vertically and gathers left/right halves (or splits the file into two halves by pages). ' +
          'options: none. Single input file; expect two or more outputs.'
        );
      case 'n-up':
        return (
          head +
          'Places pages on a smaller grid ("4-up" etc). ' +
          'options: { n?: 2|4|6|8|9|16 (pages per sheet, default 2), sheet?: {x,y} sheet size override, outputName?: string }. ' +
          'One input PDF containing every page, in reading order.'
        );
      case 'edit':
        return (
          head +
          'Applies overlay objects (the PDF editor). One input file. ' +
          'options: { objects?: [<text|rect|ellipse|line|arrow|highlight|strikeout|underline|whiteout>], ' +
          'formValues?: Record<fieldName, value>, outputName?: string }. ' +
          'Every object carries {id, pageIndex, x, y, width, height} in display space (top-left origin, PDF ' +
          'points at 100% zoom); text adds {text, fontSize, bold?, italic?, fontFamily?: "helvetica"|"times"|"courier", ' +
          "color? \"#rrggbb\", align?}; rects add {fill?, stroke?, strokeWidth?}. " +
          'LIMITATION: image objects are not expressible over JSON -- omit them; text and vectors work fully. ' +
          'formValues fills AcroForm fields (checkboxes take true|false).'
        );
      default:
        return (
          head +
          "Read the deployment's OpenAPI document for this slug's exact behaviour."
        );
    }
  })();
  return { slug, title: `${label} — how to call it`, text };
}
