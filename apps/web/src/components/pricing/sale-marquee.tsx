import { Sparkles } from 'lucide-react';

const PHRASES = [
  '500 managed AI messages a month',
  'Every PDF tool, always free',
  'Files never leave your device',
  '1,000 credits that never expire',
  'No ad network, ever',
  'Pro hides sponsor cards',
  'Cancel any time',
] as const;

/**
 * Ticker between the hero and the plans. It repeats a second copy of the list
 * for the loop; that copy is hidden from assistive tech so the phrases are read
 * once. The CSS animation pauses on hover and stops under reduced motion.
 */
export function SaleMarquee() {
  return (
    <div className="pricing-marquee" aria-label="What you get">
      <div className="pricing-marquee-track">
        {[0, 1].map((copy) => (
          <ul
            key={copy}
            className="flex shrink-0 items-center gap-8 pr-8"
            aria-hidden={copy === 1 ? 'true' : undefined}
          >
            {PHRASES.map((phrase) => (
              <li key={phrase} className="flex items-center gap-2 whitespace-nowrap text-xs">
                <Sparkles className="h-3 w-3 text-primary" aria-hidden="true" />
                <span className="text-muted-foreground">{phrase}</span>
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}
