import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Bot, CheckCircle2, FileText, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ShowcaseMode {
  id: string;
  label: string;
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
    label: 'Chat with a page',
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
    label: 'Natural language edit',
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
    label: 'Destructive redaction',
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
    <section id="ai-studio" className="bg-background py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section header */}
        <div className="max-w-3xl" data-reveal>
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            AI that cites the page.
          </h2>
          <p className="mt-3 text-base text-foreground sm:text-lg">
            Chat, edit and redact run against the document itself. Every answer carries its
            source page; your API key stays in this tab.
          </p>
        </div>

        {/* Mode tabs */}
        <div
          className="mt-8 flex flex-wrap gap-2"
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
                className={`rounded-lg px-4 py-2.5 text-[13px] font-semibold transition-colors sm:text-sm ${
                  isActive
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                }`}
              >
                {mode.label}
              </button>
            );
          })}
        </div>

        {/* Interactive studio console — the product's own interface, shown
            rendered: document viewport left, assistant right. data-ui marks
            this as an interface fragment, so its chrome is not page decoration. */}
        <div
          id="ai-studio-panel"
          role="tabpanel"
          aria-labelledby={`ai-tab-${currentMode.id}`}
          className="mt-8 grid gap-6 lg:grid-cols-12 lg:items-stretch"
          data-reveal
          data-reveal-delay="160"
        >
          {/* Left column: simulated document viewport */}
          {/* min-h values are the measured worst case across all tabs and prompts
              at each breakpoint, so switching never reflows the section. */}
          <div
            key={`doc:${swapKey}`}
            data-ui
            className="showcase-swap flex min-h-[717px] flex-col rounded-xl bg-muted/25 p-4 sm:min-h-[570px] sm:p-5 lg:col-span-6 lg:min-h-[634px] xl:min-h-[570px] dark:bg-muted/30"
          >
            <div className="flex items-center justify-between pb-3">
              <div className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
                <FileText className="h-4 w-4 text-primary" />
                <span>sample-contract.pdf</span>
              </div>
              <span className="text-xs tabular-nums text-muted-foreground">{currentMode.docPage}</span>
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
                    <span className="doc-highlight-tag text-[10px] font-semibold uppercase tracking-[0.12em]">
                      Active target text
                    </span>
                    <span className="doc-highlight-tag shrink-0 text-[11px] font-medium tabular-nums">
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

              <footer className="doc-verify mt-5 flex flex-col gap-1 pt-3 text-[10px] uppercase tracking-[0.1em] sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="doc-verify-icon h-3.5 w-3.5" />
                  Verified run geometry
                </span>
                <span className="text-[10.5px] tabular-nums normal-case tracking-normal">
                  COORDS: X:72 Y:240 W:468 H:36
                </span>
              </footer>
            </article>
          </div>

          {/* Right column: assistant controller */}
          <div
            key={`assistant:${swapKey}`}
            data-ui
            className="showcase-swap flex min-h-[575px] flex-col rounded-xl bg-card p-6 sm:min-h-[515px] lg:col-span-6"
          >
            <div className="flex flex-1 flex-col">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Bot className="h-4 w-4" />
                  </span>
                  <div>
                    <h3 className="text-[15px] font-semibold text-foreground">Interactive Intelligence Assistant</h3>
                    <p className="text-[12.5px] text-muted-foreground">Local model session · BYOK or managed trial</p>
                  </div>
                </div>
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                  Ready
                </span>
              </div>

              <div className="mt-6">
                <p className="text-[13px] font-medium text-muted-foreground">Try one of these questions:</p>
                <div className="mt-2.5 space-y-2">
                  {currentMode.prompts.map((item, idx) => {
                    const isSelected = idx === activePromptIndex;
                    return (
                      <button
                        key={item.label}
                        type="button"
                        onClick={() => setActivePromptIndex(idx)}
                        className={`flex w-full items-start justify-between gap-3 rounded-lg p-3.5 text-left text-[13px] transition-colors ${
                          isSelected
                            ? 'bg-primary/10 font-medium text-foreground'
                            : 'bg-muted/25 text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                        }`}
                      >
                        <span>{item.label}</span>
                        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/80">
                          {item.citation}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Answer display box. It absorbs the panel's spare height so the
                  CTA can pin to the bottom without a void opening above it. */}
              <div className="mt-6 flex flex-1 flex-col rounded-lg bg-primary/5 p-4">
                <div className="flex items-center justify-between text-[13px] font-semibold text-foreground">
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-primary" /> Answer
                  </span>
                  <span className="text-[11px] tabular-nums font-medium text-primary">
                    {currentPrompt.citation}
                  </span>
                </div>
                <p className="mt-2 min-h-[4.5rem] text-sm leading-relaxed text-foreground/90">
                  {currentPrompt.answer}
                </p>
                {/* Pin a quiet status line to the pane's floor: the absorbed
                    spare height then reads as a message bubble with deliberate
                    room, not an unloaded panel. */}
                <p className="mt-auto pt-3 text-[11.5px] text-muted-foreground">
                  Local session · nothing leaves this tab.
                </p>
              </div>
            </div>

            {/* Bottom link to the real tool */}
            <div className="mt-6 flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[13px] text-muted-foreground">
                Private in-browser execution with zero uploaded documents.
              </p>
              <Button size="sm" className="shadow-none" asChild>
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
