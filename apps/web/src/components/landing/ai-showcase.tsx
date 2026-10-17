import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Bot, CheckCircle2, FileText, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface ShowcaseMode {
  id: string;
  label: string;
  badge: string;
  title: string;
  headline: string;
  description: string;
  slug: string;
  ctaText: string;
  docTitle: string;
  docSub: string;
  docPage: string;
  prompts: { label: string; answer: string; citation: string; highlightText: string }[];
}

const MODES: ShowcaseMode[] = [
  {
    id: 'chat',
    label: 'Chat & Grounded Q&A',
    badge: 'Verifiable Citations',
    title: 'Ask questions directly to your PDF',
    headline: 'Answers with exact page citations and zero hallucinations.',
    description:
      'Unlike generic chatbots that summarize from memory, PDFShush extracts text runs locally and requires the model to cite the exact source page. Your API key stays in this browser tab.',
    slug: 'chat-with-pdf',
    ctaText: 'Launch Chat with PDF',
    docTitle: 'ENTERPRISE SERVICE AGREEMENT',
    docSub: 'Section 8.4 · Term, Renewals and SLA Commitments',
    docPage: 'Page 18 of 32',
    prompts: [
      {
        label: 'What is the required cancellation notice?',
        answer: 'Either party may terminate without cause by providing written notice at least thirty (30) days prior to the expiration of the then-current term.',
        citation: '[p. 18]',
        highlightText: 'Either party may terminate without cause by providing written notice at least thirty (30) days prior to the expiration of the then-current term.',
      },
      {
        label: 'What is the uptime guarantee and SLA penalty?',
        answer: 'The provider guarantees 99.9% monthly availability. Downtime exceeding 0.1% results in a 10% credit applied to the next billing cycle.',
        citation: '[p. 18]',
        highlightText: 'The provider guarantees 99.9% monthly availability. Downtime exceeding 0.1% results in a 10% credit applied to the next billing cycle.',
      },
      {
        label: 'Are audit logs retained for compliance?',
        answer: 'Audit records and administrative activity logs are retained in encrypted cold storage for a statutory minimum of twelve (12) months.',
        citation: '[p. 19]',
        highlightText: 'Audit records and administrative activity logs are retained in encrypted cold storage for a statutory minimum of twelve (12) months.',
      },
    ],
  },
  {
    id: 'edit',
    label: 'Natural Language Edit',
    badge: 'Propose · Review · Apply',
    title: 'Describe edits in plain language',
    headline: 'Review every proposed modification before applying.',
    description:
      'State what needs changing in natural language. The model plans edits (replacements, highlights, reordering) without touching the original document until you explicitly approve the change card.',
    slug: 'edit-pdf-with-ai',
    ctaText: 'Launch AI Editor',
    docTitle: 'MUTUAL NON-DISCLOSURE AGREEMENT',
    docSub: 'Governing Law and Confidentiality Scope',
    docPage: 'Page 3 of 6',
    prompts: [
      {
        label: 'Change governing jurisdiction from New York to Delaware',
        answer: 'Proposed edit: Replace "State of New York" with "State of Delaware" in Section 9.1. Coordinates verified in text run #42.',
        citation: '[p. 3]',
        highlightText: 'This Agreement shall be governed by and construed in accordance with the laws of the State of Delaware.',
      },
      {
        label: 'Highlight all confidentiality expiration dates',
        answer: 'Proposed edit: Add amber highlight box over "five (5) years from the Effective Date" in Section 4.2.',
        citation: '[p. 3]',
        highlightText: 'The obligations of confidentiality shall endure for a period of five (5) years from the Effective Date.',
      },
      {
        label: 'Add confidential draft stamp to header',
        answer: 'Proposed edit: Insert "CONFIDENTIAL · INTERNAL USE ONLY" header on all pages using vector text.',
        citation: '[All pages]',
        highlightText: 'CONFIDENTIAL · INTERNAL USE ONLY',
      },
    ],
  },
  {
    id: 'redact',
    label: 'Smart Destructive Redaction',
    badge: 'Verified Pixel Destruct',
    title: 'Permanently destroy sensitive data',
    headline: 'Automatic PII detection with verified pixel sanitization.',
    description:
      'Identify social security numbers, banking details, personal emails and addresses automatically. Redaction rasterizes the page bitmap, permanently destroying the text layer with automated verification.',
    slug: 'redact-pdf',
    ctaText: 'Launch Redaction Tool',
    docTitle: 'VENDOR INVOICE & PAYMENT DIRECTIVE',
    docSub: 'Wire Instructions & Tax Identification',
    docPage: 'Page 1 of 2',
    prompts: [
      {
        label: 'Detect social security and tax ID numbers',
        answer: 'Detected Employer Identification Number (EIN) 12-3456789 on line 14. Target region scheduled for pixel wipe.',
        citation: '[p. 1]',
        highlightText: 'TAX IDENTIFICATION: [REDACTED PERMANENTLY]',
      },
      {
        label: 'Redact international bank routing and IBAN',
        answer: 'Detected routing code 021000021 and account 9876543210. Both fields targeted for permanent black-box rasterization.',
        citation: '[p. 1]',
        highlightText: 'ROUTING: [REDACTED] · ACCOUNT: [REDACTED]',
      },
      {
        label: 'Verify no hidden text remains in output',
        answer: 'Verification gate: Output PDF reopened and parsed with zero text layer, zero annotations, and all metadata stripped.',
        citation: '[Verified]',
        highlightText: '0 remaining text runs · 100% pixel burned · Cleaned metadata',
      },
    ],
  },
];

export function AiShowcase() {
  const [activeTab, setActiveTab] = useState(0);
  const [activePromptIndex, setActivePromptIndex] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const currentMode = MODES[activeTab] ?? MODES[0]!;
  const currentPrompt = currentMode.prompts[activePromptIndex] ?? currentMode.prompts[0]!;
  // One key drives both panels, so the preview and the assistant always
  // swap in as a single gesture.
  const swapKey = `${currentMode.id}:${activePromptIndex}`;

  const handleSelectTab = (index: number) => {
    setActiveTab(index);
    setActivePromptIndex(0);
  };

  // Roving-tabindex keyboard model for the tablist (arrow keys, Home, End).
  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = MODES.length - 1;
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = index === last ? 0 : index + 1;
    else if (event.key === 'ArrowLeft') next = index === 0 ? last : index - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    if (next === null) return;
    event.preventDefault();
    handleSelectTab(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <section id="ai-studio" className="border-b border-border/60 bg-background py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="max-w-3xl" data-reveal>
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            AI grounded in the page, not hallucinated from memory.
          </h2>
          <p className="mt-3 text-base text-muted-foreground sm:text-lg">
            Experience our local AI workflows. Every fact maps back to verified coordinates on the source page.
          </p>
        </div>

        {/* Studio Tab Bar */}
        <div
          className="mt-10 flex flex-wrap gap-2 border-b border-border/80 pb-3"
          role="tablist"
          aria-label="AI capabilities"
          data-reveal
          data-reveal-delay="80"
        >
          {MODES.map((mode, index) => {
            const isActive = index === activeTab;
            return (
              <button
                key={mode.id}
                ref={(node) => {
                  tabRefs.current[index] = node;
                }}
                id={`ai-tab-${mode.id}`}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls="ai-studio-panel"
                tabIndex={isActive ? 0 : -1}
                onClick={() => handleSelectTab(index)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
                className={`relative flex items-center gap-2 rounded-lg px-4 py-2.5 text-xs font-semibold tracking-tight transition-all sm:text-sm ${
                  isActive
                    ? 'bg-card text-foreground shadow-sm ring-1 ring-border'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                }`}
              >
                <span>{mode.label}</span>
                <span
                  className={`hidden rounded px-1.5 py-0.5 text-[10px] font-normal uppercase tracking-wide md:inline-block ${
                    isActive ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {mode.badge}
                </span>
              </button>
            );
          })}
        </div>

        {/* Interactive Studio Console */}
        <div
          id="ai-studio-panel"
          role="tabpanel"
          aria-labelledby={`ai-tab-${currentMode.id}`}
          className="mt-8 grid gap-6 lg:grid-cols-12 lg:items-stretch"
          data-reveal
          data-reveal-delay="160"
        >
          {/* Left Column: Simulated Document Canvas */}
          {/* min-h values are the measured worst case across all tabs and prompts
              at each breakpoint, so switching never reflows the section. */}
          <div
            key={`doc:${swapKey}`}
            className="showcase-swap flex min-h-[717px] flex-col rounded-xl border border-border/80 bg-muted/15 p-4 sm:min-h-[570px] sm:p-5 lg:col-span-6 lg:min-h-[634px] xl:min-h-[570px] dark:bg-card/60"
          >
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <FileText className="h-4 w-4 text-primary" />
                <span>sample-contract.pdf</span>
              </div>
              <span className="font-mono text-[11px] text-muted-foreground">{currentMode.docPage}</span>
            </div>

            {/* Document page — rendered as real paper, like a desktop PDF viewer */}
            <article className="doc-page flex flex-1 flex-col rounded-md px-6 py-7 sm:px-8 sm:py-8">
              <header className="pb-3.5">
                <h3 className="doc-body text-[11px] font-semibold uppercase tracking-[0.14em]">
                  {currentMode.docTitle}
                </h3>
                <p className="doc-body doc-ink-soft mt-1 text-[11.5px] italic">
                  {currentMode.docSub}
                </p>
              </header>
              <div className="doc-body doc-ruled min-h-[13.5rem] flex-1 space-y-4 pt-4 text-[13px] leading-[1.75] sm:text-[13.5px]">
                <p className="doc-clause">
                  <span className="doc-clause-title">1. Scope of Work:</span> Northstar Systems shall deliver
                  enterprise document intelligence infrastructure under the terms outlined herein.
                </p>
                <p className="doc-clause">
                  <span className="doc-clause-title">2. Security Standards:</span> All file processing must adhere
                  to local client-side execution boundaries without transferring unencrypted payload data to remote hosts.
                </p>

                {/* Active target text run */}
                <div className="doc-highlight rounded-r-[3px]">
                  <div className="mb-1.5 flex items-baseline justify-between gap-3">
                    <span className="doc-highlight-tag font-sans text-[9.5px] font-semibold uppercase tracking-[0.12em]">
                      Active target text
                    </span>
                    <span className="doc-highlight-tag shrink-0 font-mono text-[10px] font-medium">
                      {currentPrompt.citation}
                    </span>
                  </div>
                  <p className="min-h-[3.4rem]">{currentPrompt.highlightText}</p>
                </div>

                <p className="doc-clause">
                  <span className="doc-clause-title">3. General Provisions:</span> This agreement supersedes all
                  prior informal quotations and shall bind respective successors and assigns.
                </p>
              </div>

              <footer className="doc-verify mt-5 flex flex-col gap-1 pt-3 font-sans text-[9.5px] uppercase tracking-[0.1em] sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="doc-verify-icon h-3.5 w-3.5" />
                  Verified run geometry
                </span>
                <span className="font-mono text-[10px] normal-case tracking-normal">
                  COORDS: X:72 Y:240 W:468 H:36
                </span>
              </footer>
            </article>
          </div>

          {/* Right Column: AI Assistant Controller */}
          <div
            key={`assistant:${swapKey}`}
            className="showcase-swap flex min-h-[575px] flex-col rounded-xl border border-border/80 bg-card p-6 sm:min-h-[515px] lg:col-span-6"
          >
            <div className="flex flex-1 flex-col">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Bot className="h-4 w-4" />
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Interactive Intelligence Assistant</h3>
                    <p className="text-[11px] text-muted-foreground">Local model session · BYOK or managed trial</p>
                  </div>
                </div>
                <Badge variant="outline" className="border-emerald-500/40 text-[10px] font-mono text-emerald-600 dark:text-emerald-400">
                  Ready
                </Badge>
              </div>

              <div className="mt-6">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Select a test query:
                </p>
                <div className="mt-2.5 space-y-2">
                  {currentMode.prompts.map((item, idx) => {
                    const isSelected = idx === activePromptIndex;
                    return (
                      <button
                        key={item.label}
                        type="button"
                        onClick={() => setActivePromptIndex(idx)}
                        className={`flex w-full items-start justify-between rounded-lg border p-3 text-left text-xs transition-all ${
                          isSelected
                            ? 'border-primary bg-primary/5 font-medium text-foreground ring-1 ring-primary/20'
                            : 'border-border/60 bg-muted/20 text-muted-foreground hover:border-border hover:bg-muted/40 hover:text-foreground'
                        }`}
                      >
                        <span className="pr-2">{item.label}</span>
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                          {item.citation}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Answer display box. It absorbs the panel's spare height so the
                  CTA can pin to the bottom without a void opening above it. */}
              <div className="mt-6 flex flex-1 flex-col rounded-lg border border-border/80 bg-muted/25 p-4">
                <div className="flex items-center justify-between text-xs font-semibold text-foreground">
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-primary" /> Grounded Result
                  </span>
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-primary">
                    {currentPrompt.citation}
                  </span>
                </div>
                <p className="mt-2 min-h-[4.5rem] text-xs leading-relaxed text-foreground/90">
                  {currentPrompt.answer}
                </p>
              </div>
            </div>

            {/* Bottom link to actual tool */}
            <div className="mt-6 flex flex-col gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                Private in-browser execution with zero uploaded documents.
              </p>
              <Button size="sm" asChild>
                <Link to={`/tools/${currentMode.slug}`}>
                  {currentMode.ctaText}
                  <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
