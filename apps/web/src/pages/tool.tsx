import type { ComponentType } from 'react';
import { lazy, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Archive, Clock, Flame, Sparkles } from 'lucide-react';
import { AlternateMixTool } from '@/components/tools/alternate-mix-tool';
import { CropTool } from '@/components/tools/crop-tool';
import { DarkModePdfTool } from '@/components/tools/dark-mode-pdf-tool';
import { DeskewTool } from '@/components/tools/deskew-tool';
import { DeletePagesTool } from '@/components/tools/delete-pages-tool';
import { ExtractPagesTool } from '@/components/tools/extract-pages-tool';
import { MergeTool } from '@/components/tools/merge-tool';
import { NUpTool } from '@/components/tools/n-up-tool';
import { OcrTool } from '@/components/tools/ocr-tool';
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
import { ToolFrame } from '@/components/tools/tool-frame';
import { ToolCard } from '@/components/landing/tool-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { NotFoundPage } from '@/pages/not-found';
import { AiTrustNotes } from '@/components/ai/ai-trust-notes';
import { getTool, TOOL_CATEGORIES, liveTools, type ToolDef } from '@/tools/registry';
import { TOOL_SEO, toolSeoFor } from '@/seo/tool-seo';
import { usePageHead } from '@/seo/head';
import {
  breadcrumbSchema,
  softwareApplicationSchema,
  webPageSchema,
} from '@/seo/schema';
import { SITE_ORIGIN } from '@/seo/site';
import { DECLINED_COPY } from '@/tools/declined';
import { ARCHIVED_COPY } from '@/tools/archived';
// The studio visual system is tool-page-only: it ships in this lazy chunk, so
// the landing page never pays for it.
import '@/studio.css';
import '@/editor-shared.css';

/**
 * The decision record. Declined tools link here instead of pretending to capture
 * an email address we do not collect -- the repo is public, so this is the same
 * source of truth the team works from (PLAN.md).
 */
const ROADMAP_URL =
  'https://github.com/dhruv-kashyap47/pdfshush/blob/main/PLAN.md#315-parity-debt-the-nine-planned-entries-must-resolve';

/**
 * Why each declined tool is not live, in the tool's own words.
 *
 * "In development" was doing too much work: it covered a missing engine, a
 * missing server and a deliberate product decision with the same sentence. Each
 * entry names the real blocker and the closest thing that *does* work today, so
 * a visitor can finish their task instead of waiting for a date we would have to
 * invent. When a tool ships, delete its entry -- the map is the honesty, not a
 * second roadmap.
 */
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

/**
 * The editor family is 100+ kB of canvas, selection and form machinery that a
 * merge or a crop never touches. Keep it in its own chunk, loaded only by the
 * slugs that actually open the editor.
 */
const loadEditor = () => import('@/components/tools/edit-pdf-tool');
const EditPdfTool = lazy(() => loadEditor().then((module) => ({ default: module.EditPdfTool })));
const FillSignTool = lazy(() => loadEditor().then((module) => ({ default: module.FillSignTool })));
const OrganizePdfTool = lazy(() =>
  loadEditor().then((module) => ({ default: module.OrganizePdfTool })),
);
const RedactPdfTool = lazy(() =>
  loadEditor().then((module) => ({ default: module.RedactPdfTool })),
);
const EditPdfWithAiTool = lazy(() =>
  import('@/components/tools/edit-pdf-with-ai-tool').then((module) => ({
    default: module.EditPdfWithAiTool,
  })),
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
  // Authoring batch (2026-10-26).
  'create-forms': CreateFormsTool,
  'create-bookmarks': CreateBookmarksTool,
  // Dark-mode batch (2026-10-28).
  'dark-mode-pdf': DarkModePdfTool,
  // Scans batch (2026-11-05).
  deskew: DeskewTool,
  // Scans batch (2026-11-08).
  'ocr-pdf': OcrTool,
};

export function ToolPage() {
  const { slug } = useParams<{ slug: string }>();
  const tool = getTool(slug);

  if (!tool) return <NotFoundPage />;

  return <ToolPageView tool={tool} />;
}

function ToolPageView({ tool }: { tool: ToolDef }) {
  const archived = tool.status === 'archived';
  // Archived pages keep their permanent URL, but they must not render the
  // server-backed body they used to ship (workflows, API console, MCP console).
  const Body = tool.status === 'live' ? LIVE_BODIES[tool.slug] : undefined;
  const ai = tool.status === 'live' ? AI_BODIES[tool.slug] : undefined;
  const isAi = tool.category === 'ai';
  const baseSeo = TOOL_SEO[tool.slug] ?? toolSeoFor(tool.slug, tool.name, tool.description);
  const archivedSeo = archived ? ARCHIVED_COPY[tool.slug] : undefined;
  const seo = archivedSeo
    ? { ...baseSeo, title: archivedSeo.title, description: archivedSeo.description }
    : baseSeo;
  const categoryLabel =
    TOOL_CATEGORIES.find((category) => category.id === tool.category)?.label ?? 'PDF tools';
  const route = `/tools/${tool.slug}`;
  const image = `/og/${tool.slug}.png`;

  const jsonLd = useMemo(() => {
    const crumbs = breadcrumbSchema(
      [
        { name: 'Home', route: '/' },
        { name: 'All PDF tools', route: '/#all-tools' },
        { name: tool.name, route },
      ],
      SITE_ORIGIN,
    );
    const page = webPageSchema(
      { name: seo.title, description: seo.description, route, image },
      SITE_ORIGIN,
    );
    // An archived surface is not a live application, so it does not claim to be
    // one in structured data. The page still explains itself to a reader.
    if (archived) return [crumbs, page];
    return [
      softwareApplicationSchema(
        { slug: tool.slug, name: tool.name, description: seo.description },
        SITE_ORIGIN,
        route,
      ),
      crumbs,
      page,
    ];
  }, [archived, tool.slug, tool.name, seo.description, seo.title, route, image]);

  usePageHead({
    title: seo.title,
    description: seo.description,
    route,
    image,
    imageAlt: `${tool.name} – ${categoryLabel} on PDFShush`,
    keywords: seo.keywords,
    indexable: tool.status === 'live',
    jsonLd,
  });

  return (
    <ToolFrame
      tool={tool}
      wide={isAi}
      chrome={isAi ? 'studio' : 'default'}
      notes={isAi ? <AiTrustNotes /> : undefined}
    >
      {archived ? (
        <ArchivedNotice tool={tool} />
      ) : ai ? (
        <AiWorkspace variant={ai.variant} {...(ai.autoPrompt ? { autoPrompt: ai.autoPrompt } : {})} />
      ) : Body ? (
        <Body />
      ) : (
        <DeclinedNotice tool={tool} />
      )}
    </ToolFrame>
  );
}

function ArchivedNotice({ tool }: { tool: ToolDef }) {
  const live = liveTools().slice(0, 3);
  const copy = ARCHIVED_COPY[tool.slug];
  const alternative =
    copy?.alternative && 'slug' in copy.alternative
      ? getTool(copy.alternative.slug)
      : undefined;

  return (
    <div className="space-y-6">
      <Card className="border-dashed">
        <CardContent className="flex flex-col gap-4 px-6 pb-6 pt-0 sm:flex-row sm:items-start">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Archive className="h-5 w-5" />
          </span>
          <div className="flex-1">
            <h2 className="font-semibold">Not available on this deployment</h2>
            <div className="mt-1 space-y-2 text-sm text-muted-foreground">
              <p>
                <strong className="text-foreground">{tool.name}</strong>{' '}
                {copy?.what ?? 'needs the server tier, which is archived.'}
              </p>
              <p>
                <span className="font-medium text-foreground">Why.</span>{' '}
                {copy?.why ??
                  'This deployment runs every PDF tool in your browser and has no server-side PDF worker.'}
              </p>
              <p>
                <span className="font-medium text-foreground">What works instead.</span>{' '}
                {alternative ? (
                  <Link
                    to={`/tools/${alternative.slug}`}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {alternative.name}
                  </Link>
                ) : null}
                {alternative ? ' ' : null}
                {copy?.alternative?.note}
              </p>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {alternative ? (
                <Button size="sm" asChild>
                  <Link to={`/tools/${alternative.slug}`}>
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                    Use {alternative.name}
                  </Link>
                </Button>
              ) : null}
              <Button variant={alternative ? 'outline' : 'default'} size="sm" asChild>
                <Link to="/#all-tools">See the {liveTools().length} live tools</Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div>
        <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
          <Flame className="h-4 w-4 text-primary" />
          Working right now, in your browser
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

function DeclinedNotice({ tool }: { tool: ToolDef }) {
  const live = liveTools().filter((def) => def.slug !== tool.slug).slice(0, 3);
  const copy = DECLINED_COPY[tool.slug];
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
              {copy ? 'Coming soon — here is exactly why' : 'Coming soon'}
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
                <strong>{tool.name}</strong> is coming soon. Rather than post a date we cannot keep,
                this page says exactly where it stands. The live tools below cover the closest
                working paths.
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
                  Read the decision
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


