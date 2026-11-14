import { useEffect, useRef } from 'react';
import { animate } from 'animejs';
import { prefersReducedMotion } from '@/lib/motion';
import {
  enabledTestimonials,
  initialsFor,
  socialProof,
  type SocialProofContent,
} from './socialProof.data';
import './social-proof.css';

/**
 * A compact band of testimonials. Each card floats on its own slow cycle, with
 * a different phase and amplitude, so the group reads as a handful of notes
 * resting on the page rather than a carousel. Animation is transform-only and
 * loops with anime.js; reduced motion leaves the cards still.
 */

const FLOAT_PLAN = [
  { y: -6, x: 2, duration: 8200, delay: 0 },
  { y: 5, x: -2, duration: 9400, delay: 700 },
  { y: -4, x: 1, duration: 8800, delay: 340 },
  { y: 6, x: -1, duration: 9700, delay: 1050 },
  { y: -5, x: 2, duration: 8600, delay: 520 },
] as const;

interface SocialProofSectionProps {
  content?: SocialProofContent;
}

export function SocialProofSection({ content = socialProof }: SocialProofSectionProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const testimonials = enabledTestimonials(content);

  useEffect(() => {
    const list = listRef.current;
    if (!list || prefersReducedMotion()) return;

    const cards = Array.from(list.querySelectorAll<HTMLElement>('[data-float]'));
    const animations = cards.map((card, index) => {
      const plan = FLOAT_PLAN[index % FLOAT_PLAN.length]!;
      return animate(card, {
        y: [0, plan.y],
        x: [0, plan.x],
        duration: plan.duration,
        delay: plan.delay,
        ease: 'inOutSine',
        loop: true,
        alternate: true,
      });
    });

    return () => {
      for (const animation of animations) animation.cancel();
    };
  }, [testimonials.length]);

  if (testimonials.length === 0) return null;

  return (
    <section className="sp-section" aria-labelledby="social-proof-title">
      <div className="sp-shell">
        <h2 id="social-proof-title" className="sr-only">
          What people say
        </h2>

        <ul
          ref={listRef}
          className="sp-list"
          aria-label="Testimonials"
          tabIndex={0}
        >
          {testimonials.map((testimonial) => (
            <li key={testimonial.id} className="sp-card" data-float>
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
          ))}
        </ul>
      </div>
    </section>
  );
}
