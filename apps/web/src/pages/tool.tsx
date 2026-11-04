import type { ComponentType } from 'react';
import { lazy } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Clock, Flame, Sparkles } from 'lucide-react';
import { AlternateMixTool } from '@/components/tools/alternate-mix-tool';
import { CropTool } from '@/components/tools/crop-tool';
import { DarkModePdfTool } from '@/components/tools/dark-mode-pdf-tool';
import { DeletePagesTool } from '@/components/tools/delete-pages-tool';
import {
  EditPdfTool,
  FillSignTool,
  OrganizePdfTool,
  RedactPdfTool,
} from '@/components/tools/edit-pdf-tool';
import { EditPdfWithAiTool } from '@/components/tools/edit-pdf-with-ai-tool';
import { ExtractPagesTool } from '@/components/tools/extract-pages-tool';
import { MergeTool } from '@/components/tools/merge-tool';
import { NUpTool } from '@/components/tools/n-up-tool';
import { ProtectPdfTool } from '@/components/tools/protect-pdf-tool';
import { PdfToImagesTool } from '@/components/tools/pdf-to-images-tool';
import { RotateTool } from '@/components/tools/rotate-tool';
import { SplitByPagesTool } from '@/components/tools/split-by-pages-tool';
import { SplitHalfTool } from '@/components/tools/split-half-tool';
import { EditMetadataTool } from '@/components/tools/edit-metadata-tool';
import { ExtractImagesTool } from '@/components/tools/extract-images-tool';
import { FlattenTool } from '@/components/tools/flatten-tool';
import { FlipTool } from '@/components/tools/flip-tool';
import { GrayscaleTool } from '@/components/tools/grayscale-tool';
import { PdfToTextTool } from '@/components/tools/pdf-to-text-tool';
import { RemoveAnnotationsTool } from '@/components/tools/remove-annotations-tool';
import { ResizeTool } from '@/components/tools/resize-tool';
import { SplitBySizeTool } from '@/components/tools/split-by-size-tool';
import { WatermarkTool } from '@/components/tools/watermark-tool';
import { BatesNumberingTool } from '@/components/tools/bates-numbering-tool';
import { CompressPdfTool } from '@/components/tools/compress-pdf-tool';
import { JpgToPdfTool } from '@/components/tools/jpg-to-pdf-tool';
import { RenamePdfTool } from '@/components/tools/rename-pdf-tool';
import { SplitByTextTool } from '@/components/tools/split-by-text-tool';
import { UnlockTool } from '@/components/tools/unlock-tool';
import { HeaderFooterTool, PageNumbersTool } from '@/components/tools/stamp-tool';
import { StampMarkTool } from '@/components/tools/stamp-mark-tool';
import { RepairPdfTool } from '@/components/tools/repair-tool';
import { CombineFilesTool } from '@/components/tools/combine-tool';
import { BatchRunTool } from '@/components/tools/batch-run-tool';
import { SplitByBookmarksTool } from '@/components/tools/split-by-bookmarks-tool';
import { ImageEditorTool } from '@/components/tools/image-editor-tool';
import { CreateFormsTool } from '@/components/tools/create-forms-tool';
import { CreateBookmarksTool } from '@/components/tools/create-bookmarks-tool';
import { SignatureTool } from '@/components/tools/signature-tool';
import { ApiToolPage } from '@/components/tools/api-tool';
import { McpToolPage } from '@/components/tools/mcp-tool';
import { ToolFrame } from '@/components/tools/tool-frame';
import { ToolCard } from '@/components/landing/tool-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { NotFoundPage } from '@/pages/not-found';
import { WorkflowsPage } from '@/pages/workflows';
import { AiTrustNotes } from '@/components/ai/ai-trust-notes';
import { getTool, liveTools, type ToolDef } from '@/tools/registry';
// The studio visual system is tool-page-only: it ships in this lazy chunk, so
// the landing page never pays for it.
import '@/studio.css';
import '@/editor-shared.css';

/**
 * The public roadmap. Planned tools link here instead of pretending to capture
 * an email address we do not collect -- the repo is public, so this is the same
 * source of truth the team works from (PLAN.md).
 */
const ROADMAP_URL = 'https://github.com/dhruv-kashyap47/pdfshush/blob/main/PLAN.md';

/**
 * Why each planned tool is not live, in the tool's own words.
 *
 * "In development" was doing too much work: it covered a missing engine, a
 * missing server and a deliberate product decision with the same sentence. Each
 * entry names the real blocker and the closest thing that *does* work today, so
 * a visitor can finish their task instead of waiting for a date we would have to
 * invent. When a tool ships, delete its entry -- the map is the honesty, not a
 * second roadmap.
 */
interface PlannedCopy {
  what: string;
  why: string;
  alternative?:
    | { slug: string; note: string }
    | { note: string };
}

const PLANNED_COPY: Record<string, PlannedCopy> = {
  'pdf-to-word': {
    what: 'will convert a PDF into an editable Word document, keeping headings, paragraphs and reading order.',
    why: 'The engine has a measured reading-order model, but a faithful .docx also needs styles, lists, tables and font mapping. A naive export would open in Word looking nothing like the original, so it is not shipped.',
    alternative: {
      slug: 'pdf-to-text',
      note: 'extracts the same text and labels it as plain text instead of pretending to be a Word file.',
    },
  },
  'pdf-to-excel': {
    what: 'will detect tables in a PDF and write the rows and columns into a spreadsheet.',
    why: 'Table detection and cell de-duplication are a separate problem from text extraction. A text dump into cells produces wrong numbers, which is worse than no tool.',
    alternative: {
      slug: 'pdf-to-text',
      note: 'gives you the cell text in reading order; you keep the column structure yourself.',
    },
  },
  'pdf-to-ppt': {
    what: 'will turn each page into an editable slide.',
    why: '“Editable” means reconstructing the page as text, shapes and images. A JPEG wrapped in a .pptx is a picture of a slide, not an editable one, and we will not label it otherwise.',
    alternative: {
      slug: 'pdf-to-jpg',
      note: 'renders one image per page at a width you choose, ready to drop into a deck.',
    },
  },
  'word-to-pdf': {
    what: 'will render a .docx file into a PDF.',
    why: 'Word layout needs a full office text engine — fonts, floating tables, section breaks. Running that in a tab is not realistic, and a half-rendered document is a broken export.',
    alternative: {
      note: 'No live tool converts Office files today. Print the document to PDF from Word or Google Docs, then use any tool here on the result.',
    },
  },
  'html-to-pdf': {
    what: 'will render a URL or an HTML file into a print-perfect PDF.',
    why: 'It needs a headless browser on a server, plus SSRF protection and a network policy. That is a server product, not a browser tool, so it cannot sit behind the “nothing is uploaded” promise.',
    alternative: {
      note: 'Use your browser’s Print → Save as PDF, then bring the result here to edit, sign or compress it.',
    },
  },
  deskew: {
    what: 'will detect the skew angle of a scanned page and rotate it back to level.',
    why: 'Reliable angle detection needs image analysis, and a wrong guess crops or blurs the page edge. The engine will not ship a guess that silently damages a scan.',
    alternative: {
      slug: 'rotate-pdf',
      note: 'fixes 90° orientation exactly; for small angles, crop the margin after rotating.',
    },
  },
  'ocr-pdf': {
    what: 'will add a searchable, selectable text layer to scanned pages with OCR.',
    why: 'OCR needs Tesseract or OCRmyPDF, a large server-side dependency. Without it, “searchable” would be a false claim, and this tool will not make one.',
    alternative: {
      slug: 'pdf-to-text',
      note: 'extracts an existing text layer; on a scan it returns empty, which is the honest answer.',
    },
  },
  'sign-workflow': {
    what: 'will send a document to several signers in order, then file the completed copy.',
    why: 'Routing needs accounts, stored documents, email delivery and an audit trail — a server product with a retention policy, not something a tab can honestly promise.',
    alternative: {
      slug: 'fill-sign',
      note: 'signs locally with a drawn or typed signature, and the file never leaves the browser.',
    },
  },
  'convert-batch': {
    what: 'will convert many files at once with shared settings.',
    why: 'A batch is only useful once the converters exist; the missing ones are exactly the Word, Excel, PowerPoint, HTML and OCR conversions above.',
    alternative: {
      slug: 'batch-run',
      note: 'applies a live tool — compress, grayscale, flatten, repair and more — to a whole folder today.',
    },
  },
};

/**
 * The AI studio is its own chunk. It carries the provider protocols, the edit
 * planner and the assistant loop -- none of which a merge or a crop needs.
 * There is deliberately no inner Suspense: a suspension reaches the App-level
 * boundary, so `tool-ready` is published only after the studio has actually
 * mounted, not when a skeleton has.
 */
const AiWorkspace = lazy(() =>
  import('@/components/ai/ai-workspace').then((module) => ({ default: module.AiWorkspace })),
);

const SUMMARIZE_PROMPT = [
  'Summarize this document for someone who has not read it.',
  'Start with a two-sentence overview, then list the key points as short bullets.',
  'Cite the pages that matter most as [page N]. Keep it under 250 words.',
].join(' ');

const AI_BODIES: Record<string, { variant: 'summarize' | 'chat'; autoPrompt?: string }> = {
  'summarize-pdf': { variant: 'summarize', autoPrompt: SUMMARIZE_PROMPT },
  'chat-with-pdf': { variant: 'chat' },
};

/** Live tool bodies, keyed by slug. Add a tool here when its job lands. */
const LIVE_BODIES: Record<string, ComponentType> = {
  'merge-pdf': MergeTool,
  'organize-pdf': OrganizePdfTool,
  'pdf-to-jpg': PdfToImagesTool,
  'delete-pages': DeletePagesTool,
  'extract-pages': ExtractPagesTool,
  'rotate-pdf': RotateTool,
  'split-by-pages': SplitByPagesTool,
  'alternate-mix': AlternateMixTool,
  'split-in-half': SplitHalfTool,
  'page-numbers': PageNumbersTool,
  'crop-pdf': CropTool,
  'header-footer': HeaderFooterTool,
  'n-up': NUpTool,
  'edit-pdf': EditPdfTool,
  'redact-pdf': RedactPdfTool,
  'edit-pdf-with-ai': EditPdfWithAiTool,
  'fill-sign': FillSignTool,
  signature: SignatureTool,
  api: ApiToolPage,
  mcp: McpToolPage,
  // Plain-tools batch (PLAN.md changelog, 2026-10-20).
  'flip-pdf': FlipTool,
  watermark: WatermarkTool,
  'edit-metadata': EditMetadataTool,
  'remove-annotations': RemoveAnnotationsTool,
  'pdf-to-text': PdfToTextTool,
  'grayscale-pdf': GrayscaleTool,
  'resize-pdf': ResizeTool,
  'extract-images': ExtractImagesTool,
  'split-by-size': SplitBySizeTool,
  'flatten-pdf': FlattenTool,
  // Next-tools batch (2026-10-21).
  'unlock-pdf': UnlockTool,
  'jpg-to-pdf': JpgToPdfTool,
  'rename-pdf': RenamePdfTool,
  'bates-numbering': BatesNumberingTool,
  'split-by-text': SplitByTextTool,
  'compress-pdf': CompressPdfTool,
  'protect-pdf': ProtectPdfTool,
  // Bookmark batch (2026-10-25).
  'split-by-bookmarks': SplitByBookmarksTool,
  stamp: StampMarkTool,
  'repair-pdf': RepairPdfTool,
  'combine-pdf': CombineFilesTool,
  'batch-run': BatchRunTool,
  'image-editor': ImageEditorTool,
  workflows: () => <WorkflowsPage embedded />,
  // Authoring batch (2026-10-26).
  'create-forms': CreateFormsTool,
  'create-bookmarks': CreateBookmarksTool,
  // Dark-mode batch (2026-10-28).
  'dark-mode-pdf': DarkModePdfTool,
};

export function ToolPage() {
  const { slug } = useParams<{ slug: string }>();
  const tool = getTool(slug);

  if (!tool) return <NotFoundPage />;

  const Body = LIVE_BODIES[tool.slug];
  const ai = AI_BODIES[tool.slug];
  const isAi = tool.category === 'ai';

  return (
    <ToolFrame
      tool={tool}
      wide={isAi}
      chrome={isAi ? 'studio' : 'default'}
      notes={isAi ? <AiTrustNotes /> : undefined}
    >
      {ai ? (
        <AiWorkspace variant={ai.variant} {...(ai.autoPrompt ? { autoPrompt: ai.autoPrompt } : {})} />
      ) : Body ? (
        <Body />
      ) : (
        <PlannedNotice tool={tool} />
      )}
    </ToolFrame>
  );
}

function PlannedNotice({ tool }: { tool: ToolDef }) {
  const live = liveTools().filter((def) => def.slug !== tool.slug).slice(0, 3);
  const copy = PLANNED_COPY[tool.slug];
  const alternative =
    copy?.alternative && 'slug' in copy.alternative
      ? getTool(copy.alternative.slug)
      : undefined;

  return (
    <div className="space-y-6">
      <Card className="border-dashed">
        <CardContent className="flex flex-col gap-4 px-6 pb-6 pt-0 sm:flex-row sm:items-start">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <Clock className="h-5 w-5" />
          </span>
          <div className="flex-1">
            <h2 className="font-semibold">
              {copy ? 'Not shipped yet — and here is exactly why' : 'In development'}
            </h2>
            {copy ? (
              <div className="mt-1 space-y-2 text-sm text-muted-foreground">
                <p>
                  <strong className="text-foreground">{tool.name}</strong> {copy.what}
                </p>
                <p>
                  <span className="font-medium text-foreground">Why it is not here yet.</span>{' '}
                  {copy.why}
                </p>
                <p>
                  <span className="font-medium text-foreground">
                    Closest thing that works today.
                  </span>{' '}
                  {alternative ? (
                    <Link
                      to={`/tools/${alternative.slug}`}
                      className="font-medium text-primary underline-offset-4 hover:underline"
                    >
                      {alternative.name}
                    </Link>
                  ) : null}
                  {alternative ? ' ' : null}
                  {copy.alternative?.note}
                </p>
              </div>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">
                <strong>{tool.name}</strong> is on the roadmap but not wired up yet; this page is
                already its permanent home, so nothing needs to change when it ships. The tools
                below are fully working today, and they run on the same engine this one will use.
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {/*
                Honest CTA. This used to be a "Tell me when it ships" button that
                toasted "we have no account system yet" -- false since P4 shipped
                Google sign-in, and a lie is worse than no CTA (PLAN.md 33.6).
                The roadmap link is a real destination and needs no notification
                system we do not have.
              */}
              {alternative ? (
                <Button size="sm" asChild>
                  <Link to={`/tools/${alternative.slug}`}>
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                    Use {alternative.name}
                  </Link>
                </Button>
              ) : null}
              <Button variant={alternative ? 'outline' : 'default'} size="sm" asChild>
                <a href={ROADMAP_URL} target="_blank" rel="noreferrer noopener">
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  See what ships next
                </a>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link to="/#all-tools">See the full catalog</Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div>
        <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
          <Flame className="h-4 w-4 text-primary" />
          Working right now
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          {live.map((def) => (
            <ToolCard key={def.slug} tool={def} />
          ))}
        </div>
      </div>
    </div>
  );
}
