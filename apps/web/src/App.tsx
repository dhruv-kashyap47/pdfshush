import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import { SiteFooter } from '@/components/layout/footer';
import { SiteHeader } from '@/components/layout/header';
import { HomePage } from '@/pages/home';
import { NotFoundPage } from '@/pages/not-found';
import { ToolPage } from '@/pages/tool';

export default function App() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="pdfshush-theme">
      <BrowserRouter>
        <div className="flex min-h-svh flex-col bg-background text-foreground">
          <SiteHeader />
          <main className="flex-1">
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/tools/:slug" element={<ToolPage />} />
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
