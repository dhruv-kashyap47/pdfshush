import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import { SiteFooter } from '@/components/layout/footer';
import { SiteHeader } from '@/components/layout/header';
import { AccountPage } from '@/pages/account';
import { HomePage } from '@/pages/home';
import { NotFoundPage } from '@/pages/not-found';
import { WorkflowsPage } from '@/pages/workflows';

/**
 * The tool page is the only route that pulls every tool body (and the editor and
 * AI surfaces) behind it. Loading it on demand keeps the landing page's critical
 * path at the shell + the catalog, and the route the visitor picked still
 * arrives in one chunk.
 */
const ToolPage = lazy(() => import('@/pages/tool').then((module) => ({ default: module.ToolPage })));

function ToolPageFallback() {
  return (
    <div className="mx-auto flex w-full max-w-6xl items-center justify-center px-4 py-24 text-sm text-muted-foreground">
      Loading tool…
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="pdfshush-theme">
      <BrowserRouter>
        <div className="flex min-h-svh flex-col bg-background text-foreground">
          <SiteHeader />
          <main className="flex-1">
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
              <Route path="/account" element={<AccountPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </main>
          <SiteFooter />
          <Toaster position="bottom-right" richColors closeButton />
        </div>
      </BrowserRouter>
    </ThemeProvider>
  );
}
