import { ToolCard } from '@/components/landing/tool-card';
import { TOOL_CATEGORIES, popularTools } from '@/tools/registry';

export function PopularToolsSection() {
  const tools = popularTools();

  return (
    <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold sm:text-2xl">Most popular</h2>
          <p className="text-sm text-muted-foreground">The tools people open every day.</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tools.map((tool) => (
          <ToolCard key={tool.slug} tool={tool} compact />
        ))}
      </div>
    </section>
  );
}

export function AllToolsSection() {
  return (
    <section id="all-tools" className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h2 className="text-xl font-bold sm:text-2xl">All tools</h2>
        <p className="text-sm text-muted-foreground">
          The full catalog — every tool gets its own permanent page, whether it has shipped yet or
          not.
        </p>
      </div>

      <div className="space-y-9">
        {TOOL_CATEGORIES.map((category) => (
          <div key={category.id} id={category.id}>
            <div className="mb-3 flex items-center gap-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                {category.label}
              </h3>
              <span className="h-px flex-1 bg-border/70" />
              <span className="text-xs text-muted-foreground">{category.tools.length}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {category.tools.map((tool) => (
                <ToolCard key={tool.slug} tool={tool} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
