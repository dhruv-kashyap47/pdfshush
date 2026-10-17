import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Bot, FileText, Sparkles } from 'lucide-react';
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

  const currentMode = MODES[activeTab] ?? MODES[0]!;
  const currentPrompt = currentMode.prompts[activePromptIndex] ?? currentMode.prompts[0]!;

  const handleSelectTab = (index: number) => {
    setActiveTab(index);
    setActivePromptIndex(0);
  };

  return (
    <section id="ai-studio" className="border-b border-border/60 bg-background py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="max-w-3xl" data-reveal>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="rounded-md font-mono text-[11px] uppercase tracking-wider">
              Document Intelligence Layer
            </Badge>
          </div>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
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
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => handleSelectTab(index)}
                className={`relative flex items-center gap-2 rounded-lg px-4 py-2.5 text-xs font-semibold tracking-tight transition-all sm:text-sm ${
                  isActive
                    ? 'bg-foreground text-background shadow-xs'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                }`}
              >
                <span>{mode.label}</span>
                <span
                  className={`hidden rounded px-1.5 py-0.5 text-[10px] font-normal uppercase tracking-wide md:inline-block ${
                    isActive ? 'bg-background/20 text-background' : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {mode.badge}
                </span>
              </button>
            );
          })}
        </div>

        {/* Interactive Studio Console */}
        <div className="mt-8 grid gap-6 lg:grid-cols-12 lg:items-stretch" data-reveal data-reveal-delay="160">
          {/* Left Column: Simulated Document Canvas */}
          <div className="flex flex-col rounded-xl border border-border/80 bg-muted/15 p-5 lg:col-span-6 dark:bg-card/60">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <FileText className="h-4 w-4 text-primary" />
                <span>sample-contract.pdf</span>
              </div>
              <span className="font-mono text-[11px] text-muted-foreground">{currentMode.docPage}</span>
            </div>

            {/* Document Page Simulation */}
            <div className="mt-4 flex-1 rounded-lg border border-border/80 bg-card p-6 shadow-xs">
              <div className="border-b border-border/40 pb-3">
                <p className="font-mono text-[11px] font-semibold tracking-wider text-muted-foreground">
                  {currentMode.docTitle}
                </p>
                <p className="text-xs text-muted-foreground">{currentMode.docSub}</p>
              </div>

              <div className="mt-5 space-y-3 font-serif text-xs leading-relaxed text-foreground/80">
                <p>
                  1. <span className="font-sans font-semibold">Scope of Work:</span> Northstar Systems shall deliver
                  enterprise document intelligence infrastructure under the terms outlined herein.
                </p>
                <p>
                  2. <span className="font-sans font-semibold">Security Standards:</span> All file processing must adhere
                  to local client-side execution boundaries without transferring unencrypted payload data to remote hosts.
                </p>

                {/* Highlighted active target text */}
                <div className="relative my-3 rounded border border-emerald-500/40 bg-emerald-500/10 p-3 font-sans text-xs text-foreground transition-all">
                  <div className="mb-1 flex items-center justify-between font-mono text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                    <span>ACTIVE TARGET TEXT</span>
                    <span>{currentPrompt.citation}</span>
                  </div>
                  <p className="font-serif leading-normal font-medium">{currentPrompt.highlightText}</p>
                </div>

                <p>
                  3. <span className="font-sans font-semibold">General Provisions:</span> This agreement supersedes all
                  prior informal quotations and shall bind respective successors and assigns.
                </p>
              </div>

              <div className="mt-6 flex items-center justify-between border-t border-border/40 pt-3 text-[10px] text-muted-foreground">
                <span>VERIFIED RUN GEOMETRY</span>
                <span className="font-mono">COORDS: X:72 Y:240 W:468 H:36</span>
              </div>
            </div>
          </div>

          {/* Right Column: AI Assistant Controller */}
          <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-card p-6 lg:col-span-6">
            <div>
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

              {/* Answer display box */}
              <div className="mt-6 rounded-lg border border-border/80 bg-muted/25 p-4">
                <div className="flex items-center justify-between text-xs font-semibold text-foreground">
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-primary" /> Grounded Result
                  </span>
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-primary">
                    {currentPrompt.citation}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-foreground/90">
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
