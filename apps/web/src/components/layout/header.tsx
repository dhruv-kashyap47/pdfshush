import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  ChevronDown,
  Clock,
  LogOut,
  Menu,
  Search,
  User,
  X,
} from 'lucide-react';
import { Logo } from '@/components/logo';
import { ComingSoonBadge } from '@/components/tool-status';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { useAuth, useAuthRedirectNotice } from '@/hooks/use-auth';
import { useRecent } from '@/hooks/use-recent';
import {
  ALL_TOOLS,
  TOOL_CATEGORIES,
  getTool,
  type Accent,
  type ToolDef,
} from '@/tools/registry';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { RecentEntry } from '@/tools/recent';

const QUICK_LINKS = ['merge-pdf', 'organize-pdf', 'compress-pdf', 'pdf-to-jpg'];

const LIVE_COUNT = ALL_TOOLS.filter((tool) => tool.status === 'live').length;
const SOON_COUNT = ALL_TOOLS.length - LIVE_COUNT;

/**
 * Category names are needed inside a flat search result, where the column
 * header that normally supplies context is gone.
 */
const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  TOOL_CATEGORIES.map((category) => [category.id, category.label]),
);

/**
 * Each tool keeps its own icon tile tone, so a returning visitor can navigate
 * by shape and colour instead of re-reading 58 rows. Tones stay low-saturation
 * against the black panel: recognition, not decoration.
 */
const ACCENT_TILE: Record<Accent, string> = {
  green: 'bg-emerald-500/10 text-emerald-300 ring-emerald-400/20',
  blue: 'bg-blue-500/10 text-blue-300 ring-blue-400/20',
  amber: 'bg-amber-500/10 text-amber-300 ring-amber-400/20',
  rose: 'bg-rose-500/10 text-rose-300 ring-rose-400/20',
  violet: 'bg-violet-500/10 text-violet-300 ring-violet-400/20',
  cyan: 'bg-cyan-500/10 text-cyan-300 ring-cyan-400/20',
  orange: 'bg-orange-500/10 text-orange-300 ring-orange-400/20',
};

/**
 * The four mega-menu columns are composed on purpose, not auto-balanced:
 * CSS columns split categories across columns unpredictably and left the last
 * one half empty. These groups keep related work together (merge/split/edit,
 * protect/convert, everything else, then AI and automation) and land within a
 * few rows of the same height.
 */
const MEGA_COLUMNS: readonly (readonly string[])[] = [
  ['merge', 'split', 'edit-sign', 'compress'],
  ['security', 'convert-from', 'convert-to'],
  ['other'],
  ['ai', 'scans', 'automate', 'editors'],
];

const CATEGORY_BY_ID = Object.fromEntries(
  TOOL_CATEGORIES.map((category) => [category.id, category]),
);

/** Every word must match, so "split text" finds Split by text and nothing else. */
function filterTools(query: string): ToolDef[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const parts = needle.split(/\s+/);
  return ALL_TOOLS.filter((tool) => {
    const haystack = [
      tool.name,
      tool.description,
      tool.slug,
      CATEGORY_LABELS[tool.category] ?? '',
    ]
      .join(' ')
      .toLowerCase();
    return parts.every((part) => haystack.includes(part));
  });
}

/**
 * History is stored per finished file, so the same tool can appear several
 * times. The strip is for jumping back to a tool: one chip per tool is enough.
 */
function recentTools(recent: RecentEntry[], limit: number): RecentEntry[] {
  const seen = new Set<string>();
  const entries: RecentEntry[] = [];
  for (const entry of recent) {
    if (seen.has(entry.toolSlug)) continue;
    seen.add(entry.toolSlug);
    entries.push(entry);
    if (entries.length === limit) break;
  }
  return entries;
}

/**
 * Sign-in control. Renders nothing while the first `/api/auth/me` is in flight,
 * so the header does not flash "Sign in" at an already-signed-in user.
 */
function AccountControl() {
  const { account, loading, accountsEnabled, signIn, signOut } = useAuth();

  if (loading) return null;
  if (!account && !accountsEnabled) return null;

  if (!account) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="hidden text-muted-foreground sm:inline-flex"
        onClick={signIn}
      >
        Sign in
      </Button>
    );
  }

  const label = account.name ?? account.email ?? 'Account';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2" aria-label="Account menu">
          {account.picture ? (
            <img src={account.picture} alt="" className="h-6 w-6 rounded-full" referrerPolicy="no-referrer" />
          ) : (
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted">
              <User className="h-3.5 w-3.5" />
            </span>
          )}
          <span className="hidden max-w-[10rem] truncate sm:inline">{label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
          {account.email ?? label}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/account">
            <User className="mr-2 h-4 w-4" /> Account
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/workflows">Workflows</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            void signOut();
          }}
        >
          <LogOut className="mr-2 h-4 w-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SiteHeader() {
  const [megaOpen, setMegaOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<number | null>(null);
  const location = useLocation();
  const recent = useRecent();
  // Surfaces a failed sign-in once and strips the query, so a refresh does not
  // re-toast a message the user already read.
  useAuthRedirectNotice();

  // Close the mega panel on route change or Escape.
  useEffect(() => setMegaOpen(false), [location.pathname, location.search, location.hash]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMegaOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Hover intent: a short delay so a cursor merely crossing the nav does not
  // flash a full-screen panel, and so the click handler below still wins.
  const scheduleOpen = () => {
    if (hoverTimer.current !== null) return;
    hoverTimer.current = window.setTimeout(() => setMegaOpen(true), 120);
  };
  const cancelOpen = () => {
    if (hoverTimer.current === null) return;
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  };
  useEffect(() => cancelOpen, []);

  const closeMega = () => {
    cancelOpen();
    setMegaOpen(false);
  };

  return (
    <header className="site-nav sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur-md"> {/* taste-skill-ignore: one sticky bar; the top border is its chrome */}
      <div
        ref={wrapperRef}
        className="relative mx-auto flex h-16 max-w-7xl items-center gap-2 px-4 sm:gap-4 sm:px-6 lg:px-8"
        onMouseLeave={closeMega}
      >
        <Link to="/" className="shrink-0" aria-label="pdfshush home">
          <Logo />
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-1 lg:flex" aria-label="Main">
          <button
            type="button"
            className={`inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              megaOpen ? 'bg-accent text-foreground' : 'text-foreground/90 hover:bg-accent'
            }`}
            aria-expanded={megaOpen}
            aria-haspopup="true"
            aria-controls="all-tools-panel"
            // Opening only — never toggling closed. A toggle would fight the
            // hover handler: hovering already opened the panel, so the click
            // that follows would slam it shut again.
            onClick={() => setMegaOpen(true)}
            onMouseEnter={scheduleOpen}
            onFocus={scheduleOpen}
          >
            All Tools
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${megaOpen ? 'rotate-180' : ''}`} />
          </button>

          {QUICK_LINKS.map((slug) => {
            const def = getTool(slug);
            if (!def) return null;
            const Icon = def.icon;
            const active = location.pathname === `/tools/${def.slug}`;
            return (
              <Link
                key={slug}
                to={`/tools/${def.slug}`}
                data-nav-link
                aria-current={active ? 'page' : undefined}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                <Icon className="h-4 w-4" />
                {def.name}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          <AccountControl />
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
                onClose={() => setMobileOpen(false)}
              />
            </SheetContent>
          </Sheet>
        </div>

        {/* All Tools mega panel */}
        {megaOpen && (
          <div
            id="all-tools-panel"
            className="mega-panel absolute left-0 right-0 top-16 z-50 border-b border-border/60 bg-card shadow-2xl shadow-black/60" /* taste-skill-ignore: real overlay menu */
            onMouseEnter={scheduleOpen}
            role="region"
            aria-label="All tools"
          >
            <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
              <MegaMenu recent={recent} onNavigate={closeMega} />
            </div>
          </div>
        )}
      </div>
    </header>
  );
}

/** One catalog row: icon tile, name, one-line description and availability. */
function ToolRow({
  tool,
  onNavigate,
  showCategory = false,
}: {
  tool: ToolDef;
  onNavigate: () => void;
  showCategory?: boolean;
}) {
  const Icon = tool.icon;
  return (
    <Link
      to={`/tools/${tool.slug}`}
      onClick={onNavigate}
      title={tool.description}
      className="group flex items-start gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/[0.05] focus-visible:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60"
    >
      <span
        aria-hidden
        className={cn(
          'mt-px flex h-7 w-7 shrink-0 items-center justify-center rounded-md ring-1 ring-inset',
          ACCENT_TILE[tool.accent],
        )}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-medium leading-5 text-foreground/85 transition-colors group-hover:text-foreground">
            {tool.name}
          </span>
          {tool.status === 'declined' && <ComingSoonBadge />}
        </span>
        <span className="mt-0.5 block truncate text-[11px] leading-4 text-muted-foreground/60">
          {showCategory ? `${CATEGORY_LABELS[tool.category] ?? tool.category} · ` : null}
          {tool.description}
        </span>
      </span>
    </Link>
  );
}

function CategoryHeading({ label, count }: { label: string; count: number }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-2 border-b border-white/[0.05] pb-1.5">
      <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/75">
        {label}
      </h3>
      <span className="text-[10px] tabular-nums text-muted-foreground/40">{count}</span>
    </div>
  );
}

function MegaMenu({
  recent,
  onNavigate,
}: {
  recent: ReturnType<typeof useRecent>;
  onNavigate: () => void;
}) {
  const [query, setQuery] = useState('');
  const results = useMemo(() => filterTools(query), [query]);
  const searching = query.trim().length > 0;

  return (
    <div className="flex max-h-[calc(100svh-6rem)] flex-col">
      {/* Search sits above the scroll area, so it never scrolls away mid-scan. */}
      <div className="flex shrink-0 flex-col gap-3 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${ALL_TOOLS.length} tools…`}
            aria-label="Search the tool catalog"
            autoComplete="off"
            spellCheck={false}
            className="h-10 w-full rounded-lg border border-white/10 bg-white/[0.04] pl-9 pr-9 text-sm text-foreground outline-none transition-[border-color,background-color,box-shadow] placeholder:text-muted-foreground/70 focus:border-primary/50 focus:bg-white/[0.06] focus:ring-2 focus:ring-primary/20"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear tool search"
              className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            {LIVE_COUNT} available now
          </span>
          {SOON_COUNT > 0 ? (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              {SOON_COUNT} coming soon
            </span>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
        {searching ? (
          <div>
            <p role="status" className="mb-3 text-xs text-muted-foreground">
              {results.length} {results.length === 1 ? 'tool' : 'tools'} matching{' '}
              <span className="font-medium text-foreground">“{query.trim()}”</span>
            </p>
            {results.length > 0 ? (
              <div className="grid gap-x-6 sm:grid-cols-2 xl:grid-cols-3">
                {results.map((tool) => (
                  <ToolRow key={tool.slug} tool={tool} onNavigate={onNavigate} showCategory />
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-6 py-10 text-center">
                <p className="text-sm font-medium text-foreground">
                  No tools match “{query.trim()}”
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Try “merge”, “split”, “sign”, “ocr” or “redact”.
                </p>
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="mt-4 rounded-md border border-white/10 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-white/[0.06]"
                >
                  Clear search
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            {recent.length > 0 ? (
              <div className="mb-5">
                <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/60">
                  Recently used
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {recentTools(recent, 5).map((entry) => {
                    const def = getTool(entry.toolSlug);
                    const EntryIcon = def?.icon ?? Clock;
                    return (
                      <Link
                        key={entry.id}
                        to={`/tools/${entry.toolSlug}`}
                        onClick={onNavigate}
                        className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.03] py-1 pl-2 pr-2.5 text-[11.5px] text-foreground/75 transition-colors hover:border-white/[0.14] hover:bg-white/[0.06] hover:text-foreground"
                      >
                        <EntryIcon
                          aria-hidden
                          className="h-3 w-3 shrink-0 text-muted-foreground"
                        />
                        <span className="max-w-[12rem] truncate">{entry.toolName}</span>
                        <span className="shrink-0 text-[10px] text-muted-foreground/50">
                          {timeAgo(entry.createdAt)}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {/* Deliberate columns: each group stays together and the four
                columns finish within a few rows of each other. */}
            <div className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2 xl:grid-cols-4">
              {MEGA_COLUMNS.map((ids) => (
                <div key={ids.join('-')} className="space-y-5">
                  {ids.map((id) => {
                    const category = CATEGORY_BY_ID[id];
                    if (!category) return null;
                    return (
                      <section key={category.id}>
                        <CategoryHeading label={category.label} count={category.tools.length} />
                        <ul>
                          {category.tools.map((def) => (
                            <li key={def.slug}>
                              <ToolRow tool={def} onNavigate={onNavigate} />
                            </li>
                          ))}
                        </ul>
                      </section>
                    );
                  })}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="mt-2 flex shrink-0 items-center justify-between gap-4 border-t border-white/[0.06] pt-3 text-[11px] text-muted-foreground">
        <span className="hidden items-center gap-1.5 sm:inline-flex">
          Press{' '}
          <kbd className="rounded border border-white/10 bg-white/[0.06] px-1 py-0.5 font-sans text-[10px] leading-none text-foreground/70">
            Esc
          </kbd>{' '}
          to close
        </span>
        <Link
          to="/#all-tools"
          onClick={onNavigate}
          className="ml-auto inline-flex items-center gap-1 font-medium text-foreground/70 transition-colors hover:text-foreground"
        >
          Browse the full catalog
          <ArrowRight aria-hidden className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

function MobileToolList({ onClose }: { onClose: () => void }) {
  const recent = useRecent();
  const navigate = useNavigate();
  const { account, loading, accountsEnabled, signIn, signOut } = useAuth();
  const [query, setQuery] = useState('');
  const results = useMemo(() => filterTools(query), [query]);
  const searching = query.trim().length > 0;
  const go = (path: string) => {
    onClose();
    navigate(path);
  };

  // One list, not two. A "live now" chip cloud above the full catalog repeated
  // every tool already reachable one screen lower, which read as clutter rather
  // than as a shortcut — so availability is marked in place instead.
  return (
    <ScrollArea className="-mr-4 h-[calc(100svh-8rem)] pr-4">
      <div className="space-y-6 px-4 pb-8">
        <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">Checking your account…</p>
          ) : account ? (
            <div className="space-y-1">
              <p className="truncate text-sm font-medium">
                {account.name ?? account.email ?? 'Your account'}
              </p>
              {account.email && account.name ? (
                <p className="truncate text-xs text-muted-foreground">{account.email}</p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button type="button" variant="outline" size="sm" onClick={() => go('/account')}>
                  Account
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => go('/workflows')}>
                  Workflows
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onClose();
                    void signOut();
                  }}
                >
                  Sign out
                </Button>
              </div>
            </div>
          ) : !accountsEnabled ? (
            <p className="text-xs text-muted-foreground">
              Accounts are not enabled on this deployment. Every client-side tool still works.
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Accounts are optional: every client-side tool works signed out.
              </p>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  onClose();
                  signIn();
                }}
              >
                Sign in with Google
              </Button>
            </div>
          )}
        </div>

        <div className="sticky top-0 z-10 -mx-1 border-b border-white/[0.06] bg-background/95 px-1 py-2 backdrop-blur">
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${ALL_TOOLS.length} tools…`}
              aria-label="Search the tool catalog"
              autoComplete="off"
              spellCheck={false}
              className="h-10 w-full rounded-lg border border-white/10 bg-white/[0.04] pl-9 pr-9 text-sm text-foreground outline-none transition-[border-color,background-color,box-shadow] placeholder:text-muted-foreground/70 focus:border-primary/50 focus:bg-white/[0.06] focus:ring-2 focus:ring-primary/20"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear tool search"
                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>

        {searching ? (
          <div>
            <p className="mb-2 text-xs text-muted-foreground">
              {results.length} {results.length === 1 ? 'tool' : 'tools'} matching{' '}
              <span className="font-medium text-foreground">“{query.trim()}”</span>
            </p>
            {results.length > 0 ? (
              <ul className="space-y-0.5">
                {results.map((tool) => (
                  <li key={tool.slug}>
                    <ToolRow tool={tool} onNavigate={onClose} showCategory />
                  </li>
                ))}
              </ul>
            ) : (
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-8 text-center">
                <p className="text-sm font-medium text-foreground">
                  No tools match “{query.trim()}”
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Try “merge”, “split”, “sign”, “ocr” or “redact”.
                </p>
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="mt-4 rounded-md border border-white/10 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-white/[0.06]"
                >
                  Clear search
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            {recent.length > 0 && (
              <div>
                <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/60">
                  Recently used
                </p>
                <ul className="space-y-0.5">
                  {recentTools(recent, 4).map((entry) => {
                    const def = getTool(entry.toolSlug);
                    const EntryIcon = def?.icon ?? Clock;
                    return (
                      <li key={entry.id}>
                        <Link
                          to={`/tools/${entry.toolSlug}`}
                          onClick={onClose}
                          className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-white/[0.05]"
                        >
                          <EntryIcon
                            aria-hidden
                            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                          />
                          <span className="truncate">{entry.toolName}</span>
                          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/60">
                            {timeAgo(entry.createdAt)}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {TOOL_CATEGORIES.map((category) => (
              <div key={category.id}>
                <CategoryHeading label={category.label} count={category.tools.length} />
                <ul className="space-y-0.5">
                  {category.tools.map((def) => (
                    <li key={def.slug}>
                      <ToolRow tool={def} onNavigate={onClose} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </>
        )}

        <div className="flex flex-wrap gap-3 border-t border-border/70 pt-4 text-sm">
          <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => go('/trust')}>
            Trust &amp; privacy
          </button>
          <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => go('/verify')}>
            Verify a redaction
          </button>
          <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => go('/about')}>
            About
          </button>
          <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => go('/contact')}>
            Contact
          </button>
          <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => go('/status')}>
            Status
          </button>
        </div>
      </div>
    </ScrollArea>
  );
}
