import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  ChevronDown,
  LogOut,
  Search,
  User,
  X,
} from 'lucide-react';
import { Logo } from '@/components/logo';
import { AccountAvatar } from '@/components/account/account-avatar';
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
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { useAuth, useAuthRedirectNotice } from '@/hooks/use-auth';
import {
  catalogCategories,
  catalogTools,
  getTool,
  type ToolDef,
} from '@/tools/registry';

const QUICK_LINKS = ['merge-pdf', 'organize-pdf', 'compress-pdf', 'pdf-to-jpg'];

/** Compact labels for the mobile category rail; the full names are in the sections. */
const MOBILE_CATEGORY_LABELS: Record<string, string> = {
  'convert-from': 'From PDF',
  'convert-to': 'To PDF',
};

const MOBILE_FOOTER_LINKS = [
  { label: 'Guides', path: '/guides' },
  { label: 'Trust & privacy', path: '/trust' },
  { label: 'Verify a redaction', path: '/verify' },
  { label: 'About', path: '/about' },
  { label: 'Contact', path: '/contact' },
  { label: 'Status', path: '/status' },
];

/**
 * Category names are needed inside a flat search result, where the column
 * header that normally supplies context is gone.
 */
const CATALOG_CATEGORIES = catalogCategories();

const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  CATALOG_CATEGORIES.map((category) => [category.id, category.label]),
);

/**
 * Each tool keeps its own icon tile tone, so a returning visitor can navigate
 * by shape and colour instead of re-reading 58 rows. The palette lives in
 * `tool-accent.css`; this file only supplies the `data-accent` key, so the menu
 * and the tool page can never drift apart.
 */

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
  CATALOG_CATEGORIES.map((category) => [category.id, category]),
);

/** Every word must match, so "split text" finds Split by text and nothing else. */
function filterTools(query: string): ToolDef[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const parts = needle.split(/\s+/);
  return catalogTools().filter((tool) => {
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
          <AccountAvatar
            picture={account.picture}
            name={account.name}
            email={account.email}
            loading="eager"
          />
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
  const { refresh } = useAuth();
  // Surfaces a failed sign-in once and strips the query, so a refresh does not
  // re-toast a message the user already read. On success it refreshes the
  // session immediately instead of waiting for a reload, which is what made a
  // re-login (new photo, different Google account) keep the old header state.
  useAuthRedirectNotice(refresh);

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
                data-accent={def.accent}
                aria-current={active ? 'page' : undefined}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                <Icon className="tool-accent-text h-4 w-4" />
                {def.name}
              </Link>
            );
          })}

          <Link
            to="/guides"
            aria-current={location.pathname.startsWith('/guides') ? 'page' : undefined}
            className={`inline-flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              location.pathname.startsWith('/guides')
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            }`}
          >
            Guides
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          <AccountControl />
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 lg:hidden"
                aria-label="Open all tools"
              >
                All Tools
                <ChevronDown className="h-4 w-4" aria-hidden />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="right"
              className="w-full max-w-full gap-0 border-l-0 p-0 sm:max-w-md"
              onOpenAutoFocus={(event) => {
                // A phone menu should open on the catalog, not on the software
                // keyboard. Focus the title instead, so the dialog is announced.
                if (window.matchMedia('(pointer: coarse)').matches) {
                  event.preventDefault();
                  document.getElementById('mobile-tools-title')?.focus();
                }
              }}
            >
              <SheetHeader className="border-b border-border/60 px-4 py-3 pr-14">
                <SheetTitle
                  id="mobile-tools-title"
                  tabIndex={-1}
                  className="flex items-baseline gap-2 text-[15px] font-semibold outline-none"
                >
                  All Tools
                  <span className="text-[11px] font-normal tabular-nums text-muted-foreground">
                    {catalogTools().length}
                  </span>
                </SheetTitle>
                <SheetDescription className="sr-only">
                  Search, browse and open any PDF tool.
                </SheetDescription>
              </SheetHeader>
              <MobileToolList onClose={() => setMobileOpen(false)} />
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
              <MegaMenu onNavigate={closeMega} />
            </div>
          </div>
        )}
      </div>
    </header>
  );
}

/** One catalog row: the tool's icon tile and its name. Nothing else. */
function ToolRow({
  tool,
  onNavigate,
  touch = false,
}: {
  tool: ToolDef;
  onNavigate: () => void;
  touch?: boolean;
}) {
  const Icon = tool.icon;
  return (
    <Link
      to={`/tools/${tool.slug}`}
      onClick={onNavigate}
      className={`group flex w-full items-center gap-2.5 rounded-lg px-2 transition-colors hover:bg-white/[0.05] focus-visible:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60 ${
        touch ? 'py-2.5' : 'py-1'
      }`}
    >
      <span
        aria-hidden
        data-accent={tool.accent}
        className={`tool-accent-tile flex shrink-0 items-center justify-center rounded-md ${
          touch ? 'h-8 w-8' : 'h-7 w-7'
        }`}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span
        className={`min-w-0 flex-1 truncate font-medium leading-5 text-foreground/85 transition-colors group-hover:text-foreground ${
          touch ? 'text-sm' : 'text-[13px]'
        }`}
      >
        {tool.name}
      </span>
    </Link>
  );
}

function CategoryHeading({ label }: { label: string }) {
  return (
    <div className="mb-1 border-b border-white/[0.05] pb-1">
      <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/75">
        {label}
      </h3>
    </div>
  );
}

function MegaMenu({ onNavigate }: { onNavigate: () => void }) {
  const [query, setQuery] = useState('');
  const results = useMemo(() => filterTools(query), [query]);
  const searching = query.trim().length > 0;

  return (
    <div className="flex max-h-[calc(100svh-6rem)] flex-col">
      {/* Search sits above the scroll area, so it never scrolls away mid-scan. */}
      <div className="shrink-0 pb-4">
        <div className="relative w-full sm:max-w-sm">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${catalogTools().length} tools…`}
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
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
        {searching ? (
          <div>
            <p role="status" className="sr-only">
              {results.length} {results.length === 1 ? 'tool' : 'tools'} matching{' '}
              <span className="font-medium text-foreground">“{query.trim()}”</span>
            </p>
            {results.length > 0 ? (
              <div className="grid gap-x-6 sm:grid-cols-2 xl:grid-cols-3">
                {results.map((tool) => (
                  <ToolRow key={tool.slug} tool={tool} onNavigate={onNavigate} />
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
            {/* Deliberate columns: each group stays together and the four
                columns finish within a few rows of each other. */}
            <div className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2 xl:grid-cols-4">
              {MEGA_COLUMNS.map((ids) => (
                <div key={ids.join('-')} className="space-y-4">
                  {ids.map((id) => {
                    const category = CATEGORY_BY_ID[id];
                    if (!category) return null;
                    return (
                      <section key={category.id}>
                        <CategoryHeading label={category.label} />
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
  const navigate = useNavigate();
  const { account, loading, accountsEnabled, signIn, signOut } = useAuth();
  const [query, setQuery] = useState('');
  const results = useMemo(() => filterTools(query), [query]);
  const searching = query.trim().length > 0;
  const go = (path: string) => {
    onClose();
    navigate(path);
  };

  /** The rail moves the sheet's own scroller, not the page behind the dialog. */
  const jumpToCategory = (id: string) => {
    const section = document.getElementById(`mobile-category-${id}`);
    if (!section) return;
    section.focus({ preventScroll: true });
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Fixed above the list: search and category jumps never scroll away. */}
      <div className="shrink-0 border-b border-border/60 pb-3">
        <div className="px-4 pt-3">
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${catalogTools().length} tools…`}
              aria-label="Search the tool catalog"
              autoComplete="off"
              spellCheck={false}
              className="h-11 w-full rounded-lg border border-white/10 bg-white/[0.04] pl-9 pr-10 text-base text-foreground outline-none transition-[border-color,background-color,box-shadow] placeholder:text-muted-foreground/70 focus:border-primary/50 focus:bg-white/[0.06] focus:ring-2 focus:ring-primary/20 sm:text-sm"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear tool search"
                className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>

        {!searching && (
          <div className="mt-3 flex gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {CATALOG_CATEGORIES.map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={() => jumpToCategory(category.id)}
                className="shrink-0 rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-medium text-foreground/75 transition-colors active:bg-white/10"
              >
                {MOBILE_CATEGORY_LABELS[category.id] ?? category.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1 [&_[data-radix-scroll-area-viewport]>div]:!block">
        <div className="space-y-6 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4">
          {searching ? (
            <div>
              <p role="status" className="sr-only">
                {results.length} {results.length === 1 ? 'tool' : 'tools'} matching{' '}
                <span className="font-medium text-foreground">“{query.trim()}”</span>
              </p>
              {results.length > 0 ? (
                <ul className="space-y-0.5">
                  {results.map((tool) => (
                    <li key={tool.slug}>
                      <ToolRow tool={tool} onNavigate={onClose} touch />
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
                    className="mt-4 min-h-10 rounded-md border border-white/10 px-3 text-xs font-medium text-foreground transition-colors hover:bg-white/[0.06]"
                  >
                    Clear search
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              {CATALOG_CATEGORIES.map((category) => (
                <section
                  key={category.id}
                  id={`mobile-category-${category.id}`}
                  tabIndex={-1}
                  className="scroll-mt-3 outline-none"
                >
                  <CategoryHeading label={category.label} />
                  <ul className="space-y-0.5">
                    {category.tools.map((def) => (
                      <li key={def.slug}>
                        <ToolRow tool={def} onNavigate={onClose} touch />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}

              {/* Account is secondary to the catalog, so it sits after the tools. */}
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
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9"
                        onClick={() => go('/account')}
                      >
                        Account
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-9"
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
                      className="w-full"
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

              <div className="grid grid-cols-2 gap-1.5 border-t border-border/70 pt-4">
                {MOBILE_FOOTER_LINKS.map((link) => (
                  <button
                    key={link.path}
                    type="button"
                    onClick={() => go(link.path)}
                    className="flex min-h-10 items-center rounded-md px-2 text-left text-sm text-muted-foreground transition-colors hover:bg-white/[0.05] hover:text-foreground"
                  >
                    {link.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
