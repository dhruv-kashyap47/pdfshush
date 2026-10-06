import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

const FAQS = [
  {
    q: 'Is PDFShush really free?',
    a: 'Yes. Every tool is free with no task quotas, no watermarks and no account requirement. Paid plans will exist later for API volume, teams and workflows — the browser tools stay free.',
  },
  {
    q: 'Do my files get uploaded anywhere?',
    a: 'No. For the local tools, files are read into a Web Worker inside this tab and the output is assembled in memory. There is no upload request in the network tab. Server-assisted processing (OCR, large conversions) will be explicit and opt-in when it ships.',
  },
  {
    q: 'What are the actual limits?',
    a: 'Because processing happens on your machine, the ceilings are memory, not quotas: 100 MB per file, 250 MB combined, and 500 pages per run in-browser. We check before starting and refuse cleanly instead of crashing the tab.',
  },
  {
    q: 'How is this different from other online PDF editors?',
    a: 'Two ways: locality (your document is not parked on someone’s server while you work) and scope (this is a full catalog — merge, split, edit, sign, convert, security, workflows, API and an MCP server for AI agents, built as one open-source product).',
  },
  {
    q: 'Why open source under AGPL-3.0?',
    a: 'Privacy claims are only as good as the code behind them. AGPL lets anyone audit, fork and self-host the whole stack — including the server components as they land. The license also protects the project from being closed-sourced by a third party.',
  },
  {
    q: 'Can I use it without JavaScript?',
    a: 'No — local processing requires JavaScript and Web Workers. That is the trade that removes the server. If your environment blocks scripting, you would need a desktop PDF app instead.',
  },
];

export function FaqSection() {
  return (
    <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <div className="mb-6 text-center">
        <h2 className="text-xl font-bold sm:text-2xl">Questions, answered</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The things people ask before trusting a PDF tool with real documents.
        </p>
      </div>

      <Accordion type="single" collapsible className="w-full">
        {FAQS.map((faq, index) => (
          <AccordionItem key={faq.q} value={`faq-${index}`}>
            <AccordionTrigger className="text-left text-base hover:no-underline">
              {faq.q}
            </AccordionTrigger>
            <AccordionContent className="text-sm text-muted-foreground">{faq.a}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}
