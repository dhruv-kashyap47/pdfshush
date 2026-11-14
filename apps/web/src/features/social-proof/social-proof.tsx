import type { CSSProperties, ReactNode } from 'react';
import {
  enabledTestimonials,
  initialsFor,
  socialProof,
  splitTestimonialRows,
  type SocialProofContent,
  type Testimonial,
} from './socialProof.data';
import './social-proof.css';

/**
 * Two compact rows of testimonials, drifting in opposite directions behind a
 * soft edge mask. The marquee is the same CSS mechanism the section used
 * before: 60 s and 75 s linear loops, seamless because each row carries one
 * aria-hidden copy, and paused on hover or focus-within. Reduced motion turns
 * both rows into a static wrapped grid; there is no JS animation to clean up.
 */

/** Widths are chosen so each three-card row fills the 1216 px content band. */
const CARD_WIDTHS = [400, 364, 404, 372, 400, 396];

interface MarqueeProps {
  speed: number;
  reverse?: boolean;
  label: string;
  children: ReactNode;
}

function Marquee({ speed, reverse = false, label, children }: MarqueeProps) {
  return (
    <div
      className={`sp-marquee${reverse ? ' sp-marquee--reverse' : ''}`}
      role="group"
      aria-label={label}
    >
      <div className="sp-marquee__viewport">
        <div
          className="sp-marquee__track"
          style={{ '--sp-duration': `${speed}s` } as CSSProperties}
        >
          <ul className="sp-marquee__group">{children}</ul>
          {/* Loop copy only. Hidden from assistive tech, and inert so it can
              never take keyboard focus behind the visible row. */}
          <ul className="sp-marquee__group sp-marquee__group--dup" aria-hidden="true" inert>
            {children}
          </ul>
        </div>
      </div>
    </div>
  );
}

function TestimonialCard({ testimonial, width }: { testimonial: Testimonial; width: number }) {
  return (
    <li
      className="sp-card"
      style={{ '--sp-card-width': `${width}px` } as CSSProperties}
    >
      <blockquote className="sp-quote">
        <p>“{testimonial.quote}”</p>
      </blockquote>

      <div className="sp-person">
        <span className="sp-avatar" aria-hidden="true">
          {initialsFor(testimonial.name)}
        </span>
        <span className="sp-person__text">
          <span className="sp-person__name">{testimonial.name}</span>
          {testimonial.role ? (
            <span className="sp-person__meta">{testimonial.role}</span>
          ) : null}
        </span>
      </div>
    </li>
  );
}

interface SocialProofSectionProps {
  content?: SocialProofContent;
}

export function SocialProofSection({ content = socialProof }: SocialProofSectionProps) {
  const testimonials = enabledTestimonials(content);
  const [firstRow, secondRow] = splitTestimonialRows(testimonials);

  if (testimonials.length === 0) return null;

  return (
    <section className="sp-section" aria-labelledby="social-proof-title">
      <div className="sp-shell">
        <h2 id="social-proof-title" className="sr-only">
          What people say
        </h2>

        <div className="sp-rows">
          <Marquee speed={60} label="Customer reviews, first row">
            {firstRow.map((testimonial, index) => (
              <TestimonialCard
                key={testimonial.id}
                testimonial={testimonial}
                width={CARD_WIDTHS[index % CARD_WIDTHS.length]!}
              />
            ))}
          </Marquee>

          <Marquee speed={75} reverse label="Customer reviews, second row">
            {secondRow.map((testimonial, index) => (
              <TestimonialCard
                key={testimonial.id}
                testimonial={testimonial}
                width={CARD_WIDTHS[(index + 3) % CARD_WIDTHS.length]!}
              />
            ))}
          </Marquee>
        </div>
      </div>
    </section>
  );
}
