import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronDown, Clock, Menu, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Logo } from '@/components/logo';
import { ModeToggle } from '@/components/mode-toggle';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { useRecent } from '@/hooks/use-recent';
import { TOOL_CATEGORIES, getTool, liveTools } from '@/tools/registry';
import { timeAgo } from '@/lib/format';

const QUICK_LINKS = ['merge-pdf', 'organize-pdf', 'compress-pdf', 'pdf-to-jpg'];

export function SiteHeader() {
  const [megaOpen, setMegaOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const recent = useRecent();

  // Close the mega panel on route change or Escape.
  useEffect(() => setMegaOpen(false), [navigate]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMegaOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur-md">
      <div
        ref={wrapperRef}
        className="relative mx-auto flex h-16 max-w-7xl items-center gap-2 px-4 sm:gap-4 sm:px-6 lg:px-8"
        onMouseLeave={() => setMegaOpen(false)}
      >
        <Link to="/" className="shrink-0" aria-label="PDFShush home">
          <Logo />
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-1 lg:flex" aria-label="Main">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-foreground/90 transition-colors hover:bg-accent"
            aria-expanded={megaOpen}
            aria-haspopup="true"
            onClick={() => setMegaOpen((open) => !open)}
            onMouseEnter={() => setMegaOpen(true)}
          >
            All Tools
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${megaOpen ? 'rotate-180' : ''}`} />
          </button>

          {QUICK_LINKS.map((slug) => {
            const def = getTool(slug);
            if (!def) return null;
            const Icon = def.icon;
            return (
              <Link
                key={slug}
                to={`/tools/${def.slug}`}
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Icon className="h-4 w-4" />
                {def.name}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="hidden text-muted-foreground sm:inline-flex"
            onClick={() => toast.info('Accounts arrive in Phase 4. Every tool works without a login.')}
          >
            Sign in
          </Button>
          <ModeToggle />
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open tools menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-full max-w-sm sm:max-w-md">
              <SheetHeader>
                <SheetTitle>
                  <Logo />
                </SheetTitle>
              </SheetHeader>
              <MobileToolList
                onNavigate={(slug) => {
                  setMobileOpen(false);
                  navigate(`/tools/${slug}`);
                }}
              />
            </SheetContent>
          </Sheet>
        </div>

        {/* All Tools mega panel */}
        {megaOpen && (
          <div
            className="absolute left-0 right-0 top-16 z-50 border-b border-border/60 bg-background shadow-xl shadow-black/5"
            onMouseEnter={() => setMegaOpen(true)}
          >
            <div className="mx-auto max-h-[72vh] max-w-7xl overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
              <MegaMenu recent={recent} onNavigate={() => setMegaOpen(false)} />
            </div>
          </div>
        )}
      </div>
    </header>
  );
}

function MegaMenu({
  recent,
  onNavigate,
}: {
  recent: ReturnType<typeof useRecent>;
  onNavigate: () => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-x-8 gap-y-7 md:grid-cols-3 xl:grid-cols-4">
      {recent.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent</p>
          <ul className="space-y-0.5">
            {recent.slice(0, 5).map((entry) => (
              <li key={entry.id}>
                <Link
                  to={`/tools/${entry.toolSlug}`}
                  onClick={onNavigate}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground/90 transition-colors hover:bg-accent"
                >
                  <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{entry.toolName}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {timeAgo(entry.createdAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {TOOL_CATEGORIES.map((category) => (
        <div key={category.id}>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {category.label}
          </p>
          <ul className="space-y-0.5">
            {category.tools.map((def) => {
              const Icon = def.icon;
              return (
                <li key={def.slug}>
                  <Link
                    to={`/tools/${def.slug}`}
                    onClick={onNavigate}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground/90 transition-colors hover:bg-accent"
                    title={def.description}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{def.name}</span>
                    {def.status === 'planned' && (
                      <span className="ml-auto shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                        soon
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function MobileToolList({ onNavigate }: { onNavigate: (slug: string) => void }) {
  const recent = useRecent();
  const live = liveTools();

  return (
    <ScrollArea className="-mr-4 h-[calc(100svh-8rem)] pr-4">
      <div className="space-y-5 pb-6">
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Search className="h-3 w-3" /> Live now
          </p>
          <div className="flex flex-wrap gap-2">
            {live.map((def) => (
              <Button key={def.slug} variant="outline" size="sm" onClick={() => onNavigate(def.slug)}>
                {def.name}
              </Button>
            ))}
          </div>
        </div>

        {recent.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent</p>
            <ul className="space-y-0.5">
              {recent.slice(0, 4).map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => onNavigate(entry.toolSlug)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
                  >
                    <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{entry.toolName}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {TOOL_CATEGORIES.map((category) => (
          <div key={category.id}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {category.label}
            </p>
            <ul className="space-y-0.5">
              {category.tools.map((def) => {
                const Icon = def.icon;
                return (
                  <li key={def.slug}>
                    <button
                      type="button"
                      onClick={() => onNavigate(def.slug)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{def.name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
