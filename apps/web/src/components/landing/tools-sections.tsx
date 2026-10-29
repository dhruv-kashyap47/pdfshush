import { useState, useMemo } from 'react';
import { ArrowRight, Search, X } from 'lucide-react';
import { ToolCard } from '@/components/landing/tool-card';
import { TOOL_CATEGORIES, ALL_TOOLS, popularTools } from '@/tools/registry';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function PopularToolsSection() {
  const tools = popularTools();

  return (
    <section className="bg-muted/10 py-16 sm:py-24 dark:bg-[oklch(0.04_0_0)]">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-10 flex flex-col justify-between gap-4 sm:flex-row sm:items-end" data-reveal>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Most-used daily tools
            </h2>
            <p className="mt-2 text-base text-foreground sm:text-lg">
              The jobs people run every day: edit, compress, split and merge, all
              executed inside this browser tab.
            </p>
          </div>
          <a
            href="#all-tools"
            className="inline-flex items-center gap-1 text-sm font-semibold text-primary transition-colors hover:text-primary/80"
          >
            Browse all {ALL_TOOLS.length} tools
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5" data-reveal data-reveal-delay="100">
          {tools.map((tool) => (
            <ToolCard key={tool.slug} tool={tool} compact />
          ))}
        </div>
      </div>
    </section>
  );
}

const CATEGORY_TABS = [
  { id: 'all', label: 'All Tools' },
  { id: 'live', label: 'Live Now' },
  { id: 'ai', label: 'AI & Intelligence' },
  { id: 'merge-split', label: 'Merge & Split' },
  { id: 'edit-sign', label: 'Edit & Sign' },
  { id: 'security', label: 'Security & Redaction' },
  { id: 'convert', label: 'Convert' },
] as const;

export function AllToolsSection() {
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<string>('all');

  const filteredTools = useMemo(() => {
    let result = ALL_TOOLS;

    // Filter by tab
    if (activeTab === 'live') {
      result = result.filter((t) => t.status === 'live');
    } else if (activeTab === 'ai') {
      result = result.filter((t) => t.category === 'ai' || t.category === 'automate');
    } else if (activeTab === 'merge-split') {
      result = result.filter((t) => t.category === 'merge' || t.category === 'split');
    } else if (activeTab === 'edit-sign') {
      result = result.filter((t) => t.category === 'edit-sign' || t.category === 'editors');
    } else if (activeTab === 'security') {
      result = result.filter((t) => t.category === 'security');
    } else if (activeTab === 'convert') {
      result = result.filter((t) => t.category === 'convert-from' || t.category === 'convert-to');
    }

    // Filter by search query
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.category.toLowerCase().includes(q) ||
          t.slug.toLowerCase().includes(q)
      );
    }

    return result;
  }, [search, activeTab]);

  return (
    <section id="all-tools" className="scroll-mt-16 bg-background py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-10 flex flex-col gap-6 md:flex-row md:items-end md:justify-between" data-reveal>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Every tool has a permanent home
            </h2>
            <p className="mt-2 max-w-2xl text-base text-foreground sm:text-lg">
              {ALL_TOOLS.length} tools, one steady catalog. Live tools run immediately;
              roadmap tools keep stable links and specifications.
            </p>
          </div>

          {/* Quick search input */}
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search by name or task..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-10 pl-9 pr-8 text-sm shadow-none"
              aria-label="Search tools"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Category filter tabs */}
        <div className="mb-8 flex flex-wrap gap-2" role="tablist">
          {CATEGORY_TABS.map((tab) => {
            const isSelected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => setActiveTab(tab.id)}
                className={`tool-tab rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
                  isSelected
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tools display */}
        {filteredTools.length > 0 ? (
          <div>
            {search.trim() || activeTab !== 'all' ? (
              <div>
                <p className="mb-4 text-base text-muted-foreground">
                  {filteredTools.length} tool{filteredTools.length === 1 ? '' : 's'} match
                </p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {filteredTools.map((tool) => (
                    <ToolCard key={tool.slug} tool={tool} />
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-10">
                {TOOL_CATEGORIES.map((category) => (
                  <div key={category.id} id={category.id}>
                    <div className="mb-4 flex items-baseline justify-between gap-3">
                      <h3 className="text-[15px] font-semibold text-foreground">{category.label}</h3>
                      <span className="text-sm tabular-nums text-muted-foreground">
                        {category.tools.length}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                      {category.tools.map((tool) => (
                        <ToolCard key={tool.slug} tool={tool} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-xl bg-muted/40 p-12 text-center">
            <p className="text-sm font-medium text-foreground">No matching tools for "{search}"</p>
            <p className="mt-1 text-[13px] text-muted-foreground">Try keywords like merge, ocr, split, sign, or redact.</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4 shadow-none"
              onClick={() => {
                setSearch('');
                setActiveTab('all');
              }}
            >
              Reset filters
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
