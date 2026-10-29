import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, Clock, LogOut, Menu, User } from 'lucide-react';
import { Logo } from '@/components/logo';
import { ModeToggle } from '@/components/mode-toggle';
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
import { TOOL_CATEGORIES, getTool } from '@/tools/registry';
import { timeAgo } from '@/lib/format';

const QUICK_LINKS = ['merge-pdf', 'organize-pdf', 'compress-pdf', 'pdf-to-jpg'];

/**
 * Sign-in control. Renders nothing while the first `/api/auth/me` is in flight,
 * so the header does not flash "Sign in" at an already-signed-in user.
 */
function AccountControl() {
  const { account, loading, signIn, signOut } = useAuth();

  if (loading) return null;

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
  const navigate = useNavigate();
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
        <Link to="/" className="shrink-0" aria-label="PDFShush home">
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
            className="mega-panel absolute left-0 right-0 top-16 z-50 border-b border-border/60 bg-background shadow-xl shadow-black/5" /* taste-skill-ignore: real overlay menu */
            onMouseEnter={scheduleOpen}
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
          <p className="mb-2 text-[13px] font-medium text-muted-foreground">Recent</p>
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
          <p className="mb-2 text-[13px] font-medium text-muted-foreground">
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

  // One list, not two. A "live now" chip cloud above the full catalog repeated
  // every tool already reachable one screen lower, which read as clutter rather
  // than as a shortcut — so availability is marked in place instead.
  return (
    <ScrollArea className="-mr-4 h-[calc(100svh-8rem)] pr-4">
      <div className="space-y-6 px-4 pb-8">
        {recent.length > 0 && (
          <div>
            <p className="mb-1.5 text-[13px] font-medium text-muted-foreground">
              Recent
            </p>
            <ul className="space-y-0.5">
              {recent.slice(0, 4).map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => onNavigate(entry.toolSlug)}
                    className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-accent"
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
            <p className="mb-1.5 text-[13px] font-medium text-muted-foreground">
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
                      className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-accent"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{def.name}</span>
                      {def.status === 'live' ? (
                        <span
                          aria-label="Available now"
                          className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                        />
                      ) : (
                        <span className="ml-auto shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                          soon
                        </span>
                      )}
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
