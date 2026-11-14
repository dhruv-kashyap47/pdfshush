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
  { y: -12, x: 3, rotate: -0.22, duration: 5900, delay: 0 },
  { y: 10, x: -3, rotate: 0.18, duration: 6900, delay: 450 },
  { y: -11, x: 2, rotate: -0.16, duration: 6300, delay: 180 },
  { y: 12, x: -2, rotate: 0.2, duration: 7200, delay: 750 },
  { y: -10, x: 3, rotate: -0.2, duration: 6100, delay: 300 },
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
        rotate: [0, plan.rotate],
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
