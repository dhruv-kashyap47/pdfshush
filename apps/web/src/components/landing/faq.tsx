import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { HOME_FAQS } from '@/seo/home-content';

/**
 * Home-page FAQ.
 *
 * The questions live in `seo/home-content.ts` so the same six answers feed the
 * FAQPage JSON-LD and the prerendered HTML. A second copy here would drift the
 * moment one of them changed.
 */
export function FaqSection() {
  return (
    <section id="faq" aria-labelledby="home-faq-title" className="bg-background py-16 sm:py-24">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <div className="mb-10" data-reveal>
          <h2
            id="home-faq-title"
            className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl"
          >
            Frequently asked questions
          </h2>
          <p className="mt-2 text-base text-foreground">
            Straight answers on cost, privacy, file sizes and the tools themselves.
          </p>
        </div>

        {/* Items are separated by tone on hover and by space, not rules. */}
        <Accordion type="single" collapsible className="w-full">
          {HOME_FAQS.map((faq, index) => (
            <AccordionItem key={faq.question} value={`faq-${index}`} className="border-b-0">
              <AccordionTrigger className="rounded-lg px-4 text-left text-[15px] font-semibold text-foreground hover:bg-muted/40 hover:no-underline sm:text-base">
                {faq.question}
              </AccordionTrigger>
              <AccordionContent className="max-w-[620px] px-4 pb-4 pt-1 text-base leading-relaxed text-foreground">
                {faq.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
