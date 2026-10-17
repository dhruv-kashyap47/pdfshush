import { Check, Cpu, Eye, HardDrive, Lock, ShieldCheck, Zap, X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const ARCHITECTURE_PILLARS = [
  {
    icon: HardDrive,
    title: 'Zero remote file transfers',
    body: 'Files are read directly into memory inside this browser tab via dedicated Web Workers. No network uploads occur for client tools: your private legal and financial documents remain strictly on your machine.',
  },
  {
    icon: Zap,
    title: 'No hourly task limits or paywalls',
    body: 'Traditional SaaS editors cap free usage at 3 tasks per hour to protect their server budgets. Because PDFShush computes on your local hardware, the only ceiling is your device memory.',
  },
  {
    icon: Lock,
    title: 'Private BYOK key architecture',
    body: 'Bring your own OpenAI, Anthropic, or Gemini API keys. Keys reside in browser IndexedDB, never touch an intermediate proxy, and can be purged from storage with a single click.',
  },
  {
    icon: Cpu,
    title: 'Engineered for high-volume jobs',
    body: 'Memory-bounded worker threads transfer ArrayBuffers without deep duplication. Multi-hundred-page operations complete smoothly without locking the main user interface.',
  },
  {
    icon: ShieldCheck,
    title: 'Verifiable destructive redaction',
    body: 'Redactions are not cosmetic black rectangles. Every page is rebuilt as a sanitized raster image, stripping text layers, hidden metadata and attachments with automated post-render verification.',
  },
  {
    icon: Eye,
    title: 'AGPL-3.0 open source auditability',
    body: 'Privacy claims are worthless without verifiable code. Our entire frontend and core engine are open source and self-hostable. Anyone can audit the network traffic and inspect the build.',
  },
];

const COMPARISON_ROWS = [
  {
    feature: 'File Uploads to Server',
    traditional: 'Required for every action',
    pdfshush: 'Zero uploads (runs locally)',
    pdfshushOk: true,
  },
  {
    feature: 'Free Task Quota',
    traditional: 'Capped (e.g. 3 tasks / hour)',
    pdfshush: 'Unlimited client-side tasks',
    pdfshushOk: true,
  },
  {
    feature: 'AI Key Storage',
    traditional: 'Stored on vendor database',
    pdfshush: 'Local browser IndexedDB only',
    pdfshushOk: true,
  },
  {
    feature: 'Source Code Auditability',
    traditional: 'Proprietary black box',
    pdfshush: '100% AGPL-3.0 Open Source',
    pdfshushOk: true,
  },
  {
    feature: 'Account Requirement',
    traditional: 'Mandatory for most exports',
    pdfshush: 'Never required for local tools',
    pdfshushOk: true,
  },
];

export function FeaturesSection() {
  return (
    <section className="border-b border-border/60 bg-muted/15 py-16 sm:py-24 dark:bg-[oklch(0.05_0_0)]">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section Intro */}
        <div className="max-w-3xl" data-reveal>
          <Badge variant="secondary" className="rounded-md font-mono text-[11px] uppercase tracking-wider">
            Architecture Blueprint
          </Badge>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Why client-side execution matters.
          </h2>
          <p className="mt-3 text-base text-muted-foreground sm:text-lg">
            Most online PDF tools ask you to upload confidential contracts, tax returns and records to
            remote servers you cannot inspect. We eliminated the server from the loop.
          </p>
        </div>

        {/* 6 Technical Pillars Grid */}
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ARCHITECTURE_PILLARS.map((pillar, i) => {
            const Icon = pillar.icon;
            return (
              <Card
                key={pillar.title}
                className="card-lift border-border/80 bg-card shadow-2xs"
                data-reveal
                data-reveal-delay={i * 70}
              >
                <CardContent className="px-6 pb-6 pt-0">
                  <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="text-base font-semibold text-foreground">{pillar.title}</h3>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{pillar.body}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Side-by-Side Comparison Matrix */}
        <div className="mt-14 overflow-hidden rounded-xl border border-border/80 bg-card shadow-xs" data-reveal data-reveal-delay="100">
          <div className="border-b border-border/60 bg-muted/30 px-6 py-4">
            <h3 className="text-sm font-semibold text-foreground">
              Technical Comparison: Traditional Cloud Tools vs. PDFShush
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border/60 bg-muted/10 font-semibold text-foreground">
                <tr>
                  <th className="px-6 py-3.5">Capability / Policy</th>
                  <th className="px-6 py-3.5 text-muted-foreground">Standard Online PDF Services</th>
                  <th className="px-6 py-3.5 font-bold text-primary">PDFShush Architecture</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {COMPARISON_ROWS.map((row) => (
                  <tr key={row.feature} className="transition-colors hover:bg-muted/10">
                    <td className="px-6 py-3.5 font-medium text-foreground">{row.feature}</td>
                    <td className="px-6 py-3.5 text-muted-foreground">
                      <span className="flex items-center gap-1.5 text-destructive/90">
                        <X className="h-3.5 w-3.5" />
                        {row.traditional}
                      </span>
                    </td>
                    <td className="px-6 py-3.5 font-medium text-foreground">
                      <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                        <Check className="h-3.5 w-3.5" />
                        {row.pdfshush}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
