import type { ComponentType } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Clock, Flame, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { MergeTool } from '@/components/tools/merge-tool';
import { OrganizeTool } from '@/components/tools/organize-tool';
import { PdfToImagesTool } from '@/components/tools/pdf-to-images-tool';
import { ToolFrame } from '@/components/tools/tool-frame';
import { ToolCard } from '@/components/landing/tool-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { NotFoundPage } from '@/pages/not-found';
import { getTool, liveTools, type ToolDef } from '@/tools/registry';

/** Live tool bodies, keyed by slug. Add a tool here when its job lands. */
const LIVE_BODIES: Record<string, ComponentType> = {
  'merge-pdf': MergeTool,
  'organize-pdf': OrganizeTool,
  'pdf-to-jpg': PdfToImagesTool,
};

export function ToolPage() {
  const { slug } = useParams<{ slug: string }>();
  const tool = getTool(slug);

  if (!tool) return <NotFoundPage />;

  const Body = LIVE_BODIES[tool.slug];

  return (
    <ToolFrame tool={tool}>
      {Body ? <Body /> : <PlannedNotice tool={tool} />}
    </ToolFrame>
  );
}

function PlannedNotice({ tool }: { tool: ToolDef }) {
  const live = liveTools().filter((def) => def.slug !== tool.slug).slice(0, 3);

  return (
    <div className="space-y-6">
      <Card className="border-dashed">
        <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-start">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <Clock className="h-5 w-5" />
          </span>
          <div className="flex-1">
            <h2 className="font-semibold">In development</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              <strong>{tool.name}</strong> is on the roadmap but not wired up yet — this page is
              already its permanent home, so nothing needs to change when it ships. The three tools
              below are fully working today, and they run on the same engine this one will use.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() =>
                  toast.success('We will not email you — we have no account system yet. Check back soon!')
                }
              >
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                Tell me when it ships
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
