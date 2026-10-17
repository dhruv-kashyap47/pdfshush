import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';

const FAQS = [
  {
    q: 'Is PDFShush completely free to use?',
    a: 'Yes. Every browser-based tool is free with zero task quotas, zero watermarks and no account requirements. Optional paid plans will exist in the future for server-side API volume and team collaboration, but local browser tools remain free forever.',
  },
  {
    q: 'How can I verify that my files are not being uploaded?',
    a: 'You can verify this in real time using your browser DevTools: open the Network tab, drop any PDF into a tool like Merge or Redact, and execute the job. You will see zero outbound file upload requests. All parsing, rendering and output assembly happen strictly in WebAssembly memory within your browser tab.',
  },
  {
    q: 'What are the practical file size and page limits?',
    a: 'Because processing runs on your local machine, the limits are governed by hardware memory rather than artificial paywalls. Our client capacity guard approves runs up to 100 MB per file, 250 MB combined, and up to 500 pages per job. If a document exceeds safe tab limits, we fail gracefully rather than crashing your session.',
  },
  {
    q: 'How does BYOK (Bring Your Own Key) work for the AI features?',
    a: 'When you use AI features like Chat or Natural Language Edit, you can connect your own API key from OpenAI, Anthropic, or Google Gemini. Your key is stored solely in local browser IndexedDB. Requests communicate directly from your browser to the provider endpoint without routing through any PDFShush intermediate server.',
  },
  {
    q: 'Why is PDFShush open source under the AGPL-3.0 license?',
    a: 'Privacy claims cannot be taken on faith; they must be backed by inspectable source code. The AGPL-3.0 license guarantees that anyone can inspect, audit, fork and self-host the complete stack. It also ensures the codebase cannot be closed-sourced by third parties.',
  },
  {
    q: 'Can I use PDFShush in offline environments?',
    a: 'Once the application assets and WebAssembly worker modules are loaded into your browser cache, core tools like Merge, Split, Reorder, Delete Pages and Local Redaction can function completely offline without an active internet connection.',
  },
];

export function FaqSection() {
  return (
    <section className="border-b border-border/60 bg-background py-16 sm:py-24">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <div className="mb-10 text-center">
          <Badge variant="secondary" className="rounded-md font-mono text-[11px] uppercase tracking-wider">
            Clear Answers
          </Badge>
          <h2 className="mt-3 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Frequently asked questions
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Clear technical details on privacy, limits, AI keys and licensing.
          </p>
        </div>

        <Accordion type="single" collapsible className="w-full divide-y divide-border/60">
          {FAQS.map((faq, index) => (
            <AccordionItem key={faq.q} value={`faq-${index}`} className="border-b-0 py-1">
              <AccordionTrigger className="text-left text-sm font-semibold text-foreground hover:no-underline sm:text-base">
                {faq.q}
              </AccordionTrigger>
              <AccordionContent className="text-xs leading-relaxed text-muted-foreground sm:text-sm">
                {faq.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
