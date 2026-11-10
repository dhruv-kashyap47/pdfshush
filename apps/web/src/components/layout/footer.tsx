import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { Logo } from '@/components/logo';
import { POPULAR_SLUGS, getTool } from '@/tools/registry';

/* The oversized close spells the name letter by letter so the hover wave can
   travel through it. Weights mirror the logo mark: "pdf" Light, "shush"
   ExtraBold. */
const WORDMARK_LETTERS: Array<{ ch: string; bold?: boolean }> = [
  { ch: 'p' },
  { ch: 'd' },
  { ch: 'f' },
  { ch: 's', bold: true },
  { ch: 'h', bold: true },
  { ch: 'u', bold: true },
  { ch: 's', bold: true },
  { ch: 'h', bold: true },
];

const SOURCE_URL = 'https://github.com/dhruv-kashyap47/pdfshush';

const FOOTER_COLUMNS: { title: string; links: { label: string; to?: string; soon?: boolean }[] }[] = [
  {
    title: 'Product',
    links: [
      { label: 'All tools', to: '/#all-tools' },
      { label: 'REST API', to: '/tools/api' },
      { label: 'MCP server', to: '/tools/mcp' },
      { label: 'Workflows', to: '/workflows' },
      { label: 'Trust & privacy', to: '/trust' },
      { label: 'Verify a redaction', to: '/verify' },
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
    <footer className="bg-muted/30 dark:bg-[oklch(0.03_0_0)]">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <Link to="/" aria-label="PDFShush home">
              <Logo />
            </Link>
            <p className="mt-3 max-w-sm text-sm text-muted-foreground">
              Free PDF tools that run entirely in your browser. No sign-up, no watermarks, no
              upload. Your files never leave this device.
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
                    <li key={link.label} className="text-sm text-muted-foreground">
                      {link.label} <span className="text-xs">(soon)</span>
                    </li>
                  ),
                )}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-border/60 pt-6 text-[13px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>&copy; {new Date().getFullYear()} PDFShush</p>
          <p className="flex items-center gap-4">
            <Link to="/trust" className="transition-colors hover:text-foreground">
              Privacy
            </Link>
            <span>Terms (soon)</span>
            <a
              href={SOURCE_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="transition-colors hover:text-foreground"
            >
              Source
            </a>
          </p>
        </div>

        {/* Oversized brand close: the name returns at the full content width,
            set in the full ink — no fade — with the logo's four-point sparkle
            in the brand green as the single accent. The size is set in
            container units, so the word spans edge to edge at every viewport.
            Hovering sends a quiet wave through the letters (see index.css);
            under reduced motion the name simply sits still. */}
        <div className="footer-wordmark @container mt-14 select-none sm:mt-20" aria-hidden="true" data-reveal>
          <div className="flex items-start justify-center text-[24.5cqw] leading-none tracking-[-0.045em] text-foreground">
            <span className="fw-letters whitespace-nowrap">
              {WORDMARK_LETTERS.map((letter, i) => (
                <span
                  key={`${letter.ch}-${i}`}
                  className={`fw-letter inline-block ${letter.bold ? 'font-bold' : 'font-light'}`}
                  style={{ '--i': i } as CSSProperties}
                >
                  {letter.ch}
                </span>
              ))}
            </span>
            <svg
              className="fw-spark mt-[0.02em] ml-[0.03em] w-[0.28em] shrink-0 text-primary"
              viewBox="715 76 60 60"
              fill="currentColor"
            >
              <path d="M745 76 C750 94 757 101 775 106 C757 111 750 118 745 136 C740 118 733 111 715 106 C733 101 740 94 745 76 Z" />
            </svg>
          </div>
        </div>
      </div>
    </footer>
  );
}
