import { Check, ShieldCheck, X } from 'lucide-react';
import { AsciiLoop } from '@/components/landing/ascii-loop';
import { RevealText } from '@/components/landing/reveal-text';

const CLAIMS = [
  {
    title: 'Nothing is ever uploaded.',
    body: 'Your file goes straight into memory and into a Web Worker. Watch DevTools during a merge.',
  },
  {
    title: 'No quotas, no watermarks.',
    body: 'The work runs on your hardware, so there is no hourly cap and no sign-up.',
  },
  {
    title: 'Deletion you can verify.',
    body: 'Redaction wipes the pixels and text layer, then reopens the file to check.',
  },
];

const COMPARISON_ROWS = [
  {
    feature: 'File uploads to server',
    traditional: 'Required for every action',
    pdfshush: 'Zero uploads, runs locally',
  },
  {
    feature: 'Free task quota',
    traditional: 'Capped (e.g. 3 tasks / hour)',
    pdfshush: 'Unlimited client-side tasks',
  },
  {
    feature: 'AI key storage',
    traditional: 'Stored on vendor database',
    pdfshush: 'Local browser storage only',
  },
  {
    feature: 'Source code auditability',
    traditional: 'Proprietary black box',
    pdfshush: 'AGPL-3.0, open source',
  },
  {
    feature: 'Account requirement',
    traditional: 'Mandatory for most exports',
    pdfshush: 'Never required for local tools',
  },
];

export function FeaturesSection() {
  return (
    <section id="architecture" className="bg-muted/15 py-16 sm:py-24 dark:bg-[oklch(0.05_0_0)]">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Narrative left, the subject's own material right */}
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-14">
          <div className="lg:col-span-7" data-reveal>
            <RevealText
              as="h2"
              text="Why it runs on your machine."
              className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl"
            />
            <p className="mt-3 max-w-2xl text-base text-foreground sm:text-lg">
              Most PDF sites take your file. This one keeps it in the tab.
            </p>

            <div className="mt-9 space-y-8">
              {CLAIMS.map((claim, index) => (
                <div key={claim.title} data-reveal data-reveal-delay={index * 90}>
                  <RevealText
                    as="h3"
                    text={claim.title}
                    stagger={20}
                    className="text-lg font-semibold tracking-tight text-foreground"
                  />
                  <p className="mt-1.5 max-w-2xl text-[15px] leading-relaxed text-foreground sm:text-base">
                    {claim.body}
                  </p>
                </div>
              ))}
            </div>

            <p className="mt-10 max-w-2xl text-base leading-relaxed text-muted-foreground">
              Your AI key stays in browser storage, purgeable in one click. The stack is AGPL-3.0
              and self-hostable, so you can audit it.
            </p>
          </div>

          <figure className="feature-loop hidden lg:col-span-5 lg:block" data-reveal data-reveal-delay="120">
            {/* One deliberate loop, no caption: the section's second visual.
                One drawing, inked for paper or for light; the frame never moves. */}
            <AsciiLoop />
          </figure>
        </div>

        {/* Side-by-side comparison: the local column is the only one tinted,
            so the eye reads the contrast before it reads the labels. */}
        <div
          className="trust-table mt-16 overflow-hidden rounded-2xl border border-border/60 bg-card"
          data-reveal
          data-reveal-delay="100"
        >
          <div className="flex flex-col gap-3 border-b border-border/60 px-6 py-6 sm:flex-row sm:items-end sm:justify-between sm:px-8">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
                The difference
              </p>
              <h3 className="mt-1.5 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                Cloud tools vs. your browser
              </h3>
            </div>
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
              <ShieldCheck className="h-3.5 w-3.5" />
              Local by default
            </span>
          </div>

          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  <th className="px-6 py-3.5 font-medium sm:px-8">Capability</th>
                  <th className="px-6 py-3.5 font-medium">Standard online tools</th>
                  <th className="border-x border-primary/10 bg-primary/[0.05] px-6 py-3.5 font-semibold text-foreground">
                    pdfshush
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {COMPARISON_ROWS.map((row) => (
                  <tr key={row.feature} className="group transition-colors hover:bg-muted/25">
                    <td className="px-6 py-4 font-medium text-foreground sm:px-8">{row.feature}</td>
                    <td className="px-6 py-4 text-muted-foreground">
                      <span className="flex items-center gap-2">
                        <X className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                        {row.traditional}
                      </span>
                    </td>
                    <td className="border-x border-primary/10 bg-primary/[0.05] px-6 py-4 font-medium text-foreground transition-colors group-hover:bg-primary/[0.08]">
                      <span className="flex items-center gap-2">
                        <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        {row.pdfshush}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phones stack the comparison: all three values stay visible
              without a horizontal scroll. */}
          <div className="divide-y divide-border/50 sm:hidden">
            {COMPARISON_ROWS.map((row) => (
              <div key={row.feature} className="px-5 py-4">
                <p className="text-sm font-medium text-foreground">{row.feature}</p>
                <p className="mt-2 flex items-start gap-2 text-xs text-muted-foreground">
                  <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                  {row.traditional}
                </p>
                <p className="mt-1.5 flex items-start gap-2 rounded-md bg-primary/[0.06] px-2 py-1.5 text-xs font-medium text-foreground">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  {row.pdfshush}
                </p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 px-6 py-4 text-xs text-muted-foreground sm:px-8">
            <span>No account. No upload. Nothing to cancel.</span>
            <span>AGPL-3.0, auditable</span>
          </div>
        </div>
      </div>
    </section>
  );
}

