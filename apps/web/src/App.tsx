import { lazy, Suspense, useEffect, useMemo } from 'react';
import {
  createBrowserRouter,
  Outlet,
  RouterProvider,
  useLocation,
} from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import { ErrorBoundary } from '@/components/error-boundary';
import { RelatedGuides } from '@/components/guides/related-guides';
import { SiteFooter } from '@/components/layout/footer';
import { SiteHeader } from '@/components/layout/header';
import { SponsorSlot } from '@/components/sponsors/sponsor-slot';
import { UpdateBanner } from '@/components/layout/update-banner';
import { AuthProvider } from '@/hooks/use-auth';
import { useReveal } from '@/hooks/use-reveal';
import { AccountPage } from '@/pages/account';
import { HomePage } from '@/pages/home';
import { NotFoundPage } from '@/pages/not-found';
import { WorkflowsPage } from '@/pages/workflows';
import { mark } from '@/lib/marks';
import { usePageHead } from '@/seo/head';
import { webPageSchema } from '@/seo/schema';
import { SITE_ORIGIN } from '@/seo/site';
import { STATIC_PAGE_META, type StaticPageHead } from '@/seo/static-pages';

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
const AboutPage = lazy(() =>
  import('@/pages/about').then((module) => ({ default: module.AboutPage })),
);
const ContactPage = lazy(() =>
  import('@/pages/contact').then((module) => ({ default: module.ContactPage })),
);
const PrivacyPage = lazy(() =>
  import('@/pages/privacy').then((module) => ({ default: module.PrivacyPage })),
);
const StatusPage = lazy(() =>
  import('@/pages/status').then((module) => ({ default: module.StatusPage })),
);
const TermsPage = lazy(() =>
  import('@/pages/terms').then((module) => ({ default: module.TermsPage })),
);
const LandingPage = lazy(() =>
  import('@/pages/landing').then((module) => ({ default: module.LandingPage })),
);
const GuidesPage = lazy(() =>
  import('@/pages/guides').then((module) => ({ default: module.GuidesPage })),
);
const GuidePage = lazy(() =>
  import('@/pages/guide').then((module) => ({ default: module.GuidePage })),
);
const SponsorPage = lazy(() =>
  import('@/pages/sponsor').then((module) => ({ default: module.SponsorPage })),
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
 * Keeps the tab title, canonical and cards correct on the static info routes
 * after a client-side navigation. Home, tool and guide pages manage their own
 * head because their copy depends on the registry and the page data.
 */
function StaticRouteHead({ meta, route }: { meta: StaticPageHead; route: string }) {
  const jsonLd = useMemo(
    () =>
      [
        webPageSchema(
          { name: meta.title, description: meta.description, route, image: meta.image },
          SITE_ORIGIN,
        ),
      ],
    [meta, route],
  );
  usePageHead({
    title: meta.title,
    description: meta.description,
    route,
    image: meta.image,
    imageAlt: meta.imageAlt,
    keywords: meta.keywords,
    indexable: meta.indexable !== false,
    jsonLd,
  });
  return null;
}

function StaticRouteMeta() {
  const { pathname } = useLocation();
  const meta = STATIC_PAGE_META[pathname];
  if (!meta) return null;
  return <StaticRouteHead meta={meta} route={pathname} />;
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

/**
 * Arms the scroll-reveal observer for the current route. It lives at the shell
 * (not inside one page) because [data-reveal] appears in the shared footer,
 * which renders on every route — arming it only on the home page left the
 * footer wordmark at opacity 0 everywhere else. The pathname is passed as the
 * hook's rearm key, so the DOM query re-runs after each navigation and picks up
 * any new page's [data-reveal] blocks, including ones inside lazy chunks.
 */
function RevealArmer() {
  const { pathname } = useLocation();
  useReveal(undefined, pathname);
  return null;
}

function RootLayout() {
  const { pathname } = useLocation();
  return (
    <>
      <PageReadyMark />
      <StaticRouteMeta />
      <RouteScroll />
      <div className="flex min-h-svh flex-col bg-background text-foreground">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-lg focus:outline-2 focus:outline-offset-2 focus:outline-ring focus:ring-2 focus:ring-ring/50"
        >
          Skip to content
        </a>
        <SiteHeader />
        <UpdateBanner />
        <main id="main" tabIndex={-1} className="flex-1 outline-none">
          <ErrorBoundary key={pathname}>
            <RevealArmer />
            <Outlet />
          </ErrorBoundary>
          {/* Self-gating: renders only on /tools/:slug and only when guides exist. */}
          <RelatedGuides />
        </main>
        {/* One sponsor card, at the foot of the home page only. Articles and the
            guides index own theirs; Pro never renders one. */}
        <SponsorSlot only={['home']} />
        <SiteFooter />
        <Toaster position="bottom-right" richColors closeButton />
      </div>
    </>
  );
}

/**
 * A data router (instead of `<BrowserRouter>` + `<Routes>`) is required for the
 * editor's `useBlocker` history guard. The route surface is unchanged.
 */
const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    children: [
      { index: true, element: <HomePage /> },
      {
        path: 'tools/:slug',
        element: (
          <Suspense fallback={<ToolPageFallback />}>
            <ToolPage />
          </Suspense>
        ),
      },
      { path: 'workflows', element: <WorkflowsPage /> },
      {
        path: 'trust',
        element: (
          <Suspense fallback={<PageFallback />}>
            <TrustPage />
          </Suspense>
        ),
      },
      {
        path: 'verify',
        element: (
          <Suspense fallback={<PageFallback />}>
            <VerifyPage />
          </Suspense>
        ),
      },
      {
        path: 'about',
        element: (
          <Suspense fallback={<PageFallback />}>
            <AboutPage />
          </Suspense>
        ),
      },
      {
        path: 'contact',
        element: (
          <Suspense fallback={<PageFallback />}>
            <ContactPage />
          </Suspense>
        ),
      },
      {
        path: 'privacy',
        element: (
          <Suspense fallback={<PageFallback />}>
            <PrivacyPage />
          </Suspense>
        ),
      },
      {
        path: 'status',
        element: (
          <Suspense fallback={<PageFallback />}>
            <StatusPage />
          </Suspense>
        ),
      },
      {
        path: 'terms',
        element: (
          <Suspense fallback={<PageFallback />}>
            <TermsPage />
          </Suspense>
        ),
      },
      { path: 'account', element: <AccountPage /> },
      /*
       * Guides. Static segments rank above the `:slug` keyword-guide route
       * below, so /guides is never treated as a landing page.
       */
      {
        path: 'guides',
        element: (
          <Suspense fallback={<PageFallback />}>
            <GuidesPage />
          </Suspense>
        ),
      },
      {
        path: 'guides/:slug',
        element: (
          <Suspense fallback={<PageFallback />}>
            <GuidePage />
          </Suspense>
        ),
      },
      {
        path: 'sponsor',
        element: (
          <Suspense fallback={<PageFallback />}>
            <SponsorPage />
          </Suspense>
        ),
      },
      /*
       * Keyword guide pages (/compress-pdf, /pdf-under-200kb, /merge-pdf …).
       * A single lazy dynamic route keeps the guide data out of the entry
       * chunk; `LandingPage` returns the 404 page for a path it does not know.
       * React Router ranks the static routes above this one, so /about and
       * /tools/:slug still resolve to their own elements.
       */
      {
        path: ':slug',
        element: (
          <Suspense fallback={<PageFallback />}>
            <LandingPage />
          </Suspense>
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

export default function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
