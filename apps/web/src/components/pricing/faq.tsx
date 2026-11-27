import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { PricingFaq } from '@/content/pricing';
import { useMotionScope } from '@/hooks/use-motion';
import { dur, EASE, prefersReducedMotion } from '@/lib/motion';

/**
 * Accordion with an anime.js height transition.
 *
 * A native `<details>` cannot animate its panel height, and `height: auto` is
 * not animatable. So each panel is measured, animated to its scroll height, and
 * then released back to `auto` so a resize or a font swap cannot clip it.
 */
export function PricingFaqList({ items }: { items: readonly PricingFaq[] }) {
  const [open, setOpen] = useState(0);
  const panels = useRef<Array<HTMLDivElement | null>>([]);
  const motion = useMotionScope();

  useEffect(() => {
    if (prefersReducedMotion()) {
      panels.current.forEach((panel, index) => {
        if (!panel) return;
        panel.style.height = index === open ? 'auto' : '0px';
      });
      return;
    }

    panels.current.forEach((panel, index) => {
      if (!panel) return;
      const isOpen = index === open;
      const start = panel.getBoundingClientRect().height;
      panel.style.height = 'auto';
      const end = isOpen ? panel.scrollHeight : 0;
      panel.style.height = `${start}px`;
      motion.animate(panel, {
        height: `${end}px`,
        duration: dur(320),
        ease: EASE.soft,
        onComplete: () => {
          panel.style.height = isOpen ? 'auto' : '0px';
        },
      });
    });
  }, [open, motion]);

  return (
    <div className="border-y border-border/60">
      {items.map((entry, index) => {
        const expanded = open === index;
        const panelId = `pricing-faq-panel-${index}`;
        const buttonId = `pricing-faq-button-${index}`;
        return (
          <div key={entry.q} className="border-b border-border/60 last:border-b-0">
            <h3>
              <button
                type="button"
                id={buttonId}
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() => setOpen(expanded ? -1 : index)}
                className="pricing-faq-trigger"
              >
                <span>{entry.q}</span>
                <Plus className="pricing-faq-icon h-4 w-4 text-muted-foreground" aria-hidden="true" />
              </button>
            </h3>
            <div
              ref={(node) => {
                panels.current[index] = node;
              }}
              id={panelId}
              role="region"
              aria-labelledby={buttonId}
              aria-hidden={!expanded}
              className="pricing-faq-panel"
              style={{ height: index === 0 ? 'auto' : 0 }}
            >
              <p className="max-w-3xl pb-4 pr-8 text-sm leading-7 text-muted-foreground">
                {entry.a}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
