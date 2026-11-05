import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import { ErrorBoundary } from '@/components/error-boundary';
import { SiteFooter } from '@/components/layout/footer';
import { SiteHeader } from '@/components/layout/header';
import { AuthProvider } from '@/hooks/use-auth';
import { AccountPage } from '@/pages/account';
import { HomePage } from '@/pages/home';
import { NotFoundPage } from '@/pages/not-found';
import { WorkflowsPage } from '@/pages/workflows';
import { mark } from '@/lib/marks';

/**
 * The tool page is the only route that pulls every tool body (and the editor and
 * AI surfaces) behind it. Loading it on demand keeps the landing page's critical
 * path at the shell + the catalog, and the route the visitor picked still
 * arrives in one chunk.
 */
const ToolPage = lazy(() => import('@/pages/tool').then((module) => ({ default: module.ToolPage })));
const TrustPage = lazy(() =>
  import('@/pages/trust').then((module) => ({ default: module.TrustPage })),
);
const VerifyPage = lazy(() =>
  import('@/pages/verify').then((module) => ({ default: module.VerifyPage })),
);

function ToolPageFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto flex w-full max-w-6xl items-center justify-center px-4 py-24 text-sm text-muted-foreground"
    >
      Loading tool…
    </div>
  );
}

function PageFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto flex w-full max-w-6xl items-center justify-center px-4 py-24 text-sm text-muted-foreground"
    >
      Loading…
    </div>
  );
}

/**
 * Publishes `pdfshush:page-ready` on every route, so the M5.0 harness can time
 * shell, home, account and workflows as well as tool pages (which add their own
 * `tool-ready` mark). Inert in normal use; see lib/marks.ts.
 */
function PageReadyMark() {
  const { pathname } = useLocation();
  useEffect(() => {
    mark('page-ready', { path: pathname });
  }, [pathname]);
  return null;
}

/**
 * SPA navigations do not reset the window scroll position. Finish a long tool,
 * click a "what's next" chip, and the next tool opened halfway down. Hash links
 * are left to the page that owns the target, so `/#all-tools` still works.
 */
function RouteScroll() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) return;
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [pathname, hash]);
  return null;
}

function AppRoutes() {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary key={pathname}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route
          path="/tools/:slug"
          element={
            <Suspense fallback={<ToolPageFallback />}>
              <ToolPage />
            </Suspense>
          }
        />
        <Route path="/workflows" element={<WorkflowsPage />} />
        <Route
          path="/trust"
          element={
            <Suspense fallback={<PageFallback />}>
              <TrustPage />
            </Suspense>
          }
        />
        <Route
          path="/verify"
          element={
            <Suspense fallback={<PageFallback />}>
              <VerifyPage />
            </Suspense>
          }
        />
        <Route path="/account" element={<AccountPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </ErrorBoundary>
  );
}

export default function App() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="pdfshush-theme">
      <AuthProvider>
        <BrowserRouter>
          <PageReadyMark />
          <RouteScroll />
          <div className="flex min-h-svh flex-col bg-background text-foreground">
            <a
              href="#main"
              className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-lg focus:outline-2 focus:outline-offset-2 focus:outline-ring focus:ring-2 focus:ring-ring/50"
            >
              Skip to content
            </a>
            <SiteHeader />
            <main id="main" tabIndex={-1} className="flex-1 outline-none">
              <AppRoutes />
            </main>
            <SiteFooter />
            <Toaster position="bottom-right" richColors closeButton />
          </div>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
