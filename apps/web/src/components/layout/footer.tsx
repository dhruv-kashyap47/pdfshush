import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { Logo } from '@/components/logo';
import { POPULAR_SLUGS, getTool } from '@/tools/registry';

const FOOTER_COLUMNS: { title: string; links: { label: string; to?: string; soon?: boolean }[] }[] = [
  {
    title: 'Product',
    links: [
      { label: 'All tools', to: '/' },
      { label: 'REST API', to: '/tools/api' },
      { label: 'MCP server', to: '/tools/mcp' },
      { label: 'Workflows', to: '/tools/workflows' },
      { label: 'Pricing', soon: true },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About', soon: true },
      { label: 'Blog', soon: true },
      { label: 'Contact', soon: true },
      { label: 'Status', soon: true },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border/60 bg-muted/30">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <Link to="/" aria-label="PDFShush home">
              <Logo />
            </Link>
            <p className="mt-3 max-w-sm text-sm text-muted-foreground">
              Free PDF tools that run entirely in your browser. No sign-up, no watermarks, no
              upload -- your files never leave this device.
            </p>
            <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Files are processed locally and never uploaded.
            </p>
          </div>

          <div>
            <p className="mb-3 text-sm font-semibold">Popular tools</p>
            <ul className="space-y-2">
              {POPULAR_SLUGS.slice(0, 5).map((slug) => {
                const def = getTool(slug);
                if (!def) return null;
                return (
                  <li key={slug}>
                    <Link
                      to={`/tools/${slug}`}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {def.name}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>

          {FOOTER_COLUMNS.map((column) => (
            <div key={column.title}>
              <p className="mb-3 text-sm font-semibold">{column.title}</p>
              <ul className="space-y-2">
                {column.links.map((link) =>
                  link.to ? (
                    <li key={link.label}>
                      <Link
                        to={link.to}
                        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ) : (
                    <li key={link.label} className="text-sm text-muted-foreground/60">
                      {link.label} <span className="text-xs">(soon)</span>
                    </li>
                  ),
                )}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-border/60 pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>&copy; {new Date().getFullYear()} PDFShush · AGPL-3.0 licensed · Not affiliated with Sejda</p>
          <p className="flex items-center gap-4">
            <span className="transition-colors hover:text-foreground">Privacy (soon)</span>
            <span className="transition-colors hover:text-foreground">Terms (soon)</span>
            <Link to="/" className="transition-colors hover:text-foreground">
              Source
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}
