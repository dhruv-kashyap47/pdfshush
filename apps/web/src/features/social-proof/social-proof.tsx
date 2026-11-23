import {
  useEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { Star } from 'lucide-react';
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
      tabIndex={0}
      /* The track is intentionally wider than the viewport: the viewport clips
         and masks it, so it can never cause page-level overflow. `data-bleed`
         is the sweep's marker for deliberately clipped art (tests/sweep.mjs). */
      data-bleed
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

/**
 * One five-star row, filled to the testimonial's rating. The row is a single
 * image to assistive tech ("5 out of 5 stars") because five decorative glyphs
 * would otherwise be read as five separate unlabelled graphics. Whole stars
 * only; a rating outside 0–5 is clamped rather than trusted.
 */
function Stars({ rating }: { rating: number }) {
  const filled = Math.max(0, Math.min(5, Math.round(rating)));

  return (
    <span className="sp-stars" role="img" aria-label={`${filled} out of 5 stars`}>
      {Array.from({ length: 5 }, (_, index) => (
        <Star
          key={index}
          aria-hidden="true"
          className={`sp-star${index < filled ? ' sp-star--filled' : ''}`}
        />
      ))}
    </span>
  );
}

function TestimonialCard({ testimonial, width }: { testimonial: Testimonial; width: number }) {
  return (
    <li
      className="sp-card"
      style={{ '--sp-card-width': `${width}px` } as CSSProperties}
    >
      {typeof testimonial.rating === 'number' ? <Stars rating={testimonial.rating} /> : null}

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

/* On phones the rows are snap-scrollers, so the desktop marquee's CSS drift is
   switched off. This advances each row one whole card at a time, pauses the
   moment a reader touches, swipes, hovers or focuses a row, and waits until the
   section is actually on screen. Reduced motion wins: no timer is started. */
const AUTO_ADVANCE_MS = 6000;
const AUTO_RESUME_MS = 5000;

function useMobileAutoAdvance(sectionRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return;

    const narrow = window.matchMedia('(max-width: 767px)');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const rowCleanups: Array<() => void> = [];
    let interval: number | undefined;
    let kickoff: number | undefined;
    let resumeTimer: number | undefined;
    let paused = false;
    let inView = false;

    const viewports = () =>
      Array.from(
        sectionRef.current?.querySelectorAll<HTMLElement>('.sp-marquee__viewport') ?? [],
      );

    const cardsOf = (viewport: HTMLElement) =>
      Array.from(
        viewport.querySelectorAll<HTMLElement>(
          '.sp-marquee__group:not(.sp-marquee__group--dup) .sp-card',
        ),
      );

    const stop = () => {
      if (kickoff !== undefined) {
        window.clearTimeout(kickoff);
        kickoff = undefined;
      }
      if (interval !== undefined) {
        window.clearInterval(interval);
        interval = undefined;
      }
    };

    const advance = () => {
      if (!narrow.matches || reduce.matches || paused || !inView) return;

      for (const viewport of viewports()) {
        const cards = cardsOf(viewport);
        const group = cards[0]?.parentElement;
        if (!group || cards.length < 2) continue;

        const step = cards[1]!.offsetLeft - cards[0]!.offsetLeft;
        if (step <= 0) continue;

        const current = Math.round(viewport.scrollLeft / step);
        const next = (current + 1) % cards.length;
        const target =
          cards[next]!.getBoundingClientRect().left - group.getBoundingClientRect().left;

        viewport.scrollTo({ left: target, behavior: 'smooth' });
      }
    };

    const start = () => {
      stop();
      if (!narrow.matches || reduce.matches || paused || !inView) return;
      // One early move proves the row is alive, then it settles into the loop.
      kickoff = window.setTimeout(() => {
        advance();
        interval = window.setInterval(advance, AUTO_ADVANCE_MS);
      }, 2500);
    };

    const hold = () => {
      paused = true;
      stop();
      if (resumeTimer !== undefined) window.clearTimeout(resumeTimer);
    };

    const release = () => {
      if (resumeTimer !== undefined) window.clearTimeout(resumeTimer);
      resumeTimer = window.setTimeout(() => {
        paused = false;
        start();
      }, AUTO_RESUME_MS);
    };

    const bindRow = (viewport: HTMLElement) => {
      viewport.addEventListener('pointerdown', hold);
      viewport.addEventListener('pointerenter', hold);
      viewport.addEventListener('touchstart', hold, { passive: true });
      viewport.addEventListener('focusin', hold);
      viewport.addEventListener('pointerleave', release);
      viewport.addEventListener('touchend', release, { passive: true });
      viewport.addEventListener('focusout', release);

      rowCleanups.push(() => {
        viewport.removeEventListener('pointerdown', hold);
        viewport.removeEventListener('pointerenter', hold);
        viewport.removeEventListener('touchstart', hold);
        viewport.removeEventListener('focusin', hold);
        viewport.removeEventListener('pointerleave', release);
        viewport.removeEventListener('touchend', release);
        viewport.removeEventListener('focusout', release);
      });
    };

    for (const viewport of viewports()) bindRow(viewport);

    const observer = new IntersectionObserver(
      (entries) => {
        inView = entries.some((entry) => entry.isIntersecting);
        if (inView) start();
        else stop();
      },
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' },
    );
    if (sectionRef.current) observer.observe(sectionRef.current);

    const onModeChange = () => {
      if (narrow.matches) {
        start();
      } else {
        stop();
        for (const viewport of viewports()) viewport.scrollTo({ left: 0, behavior: 'auto' });
      }
    };

    const onReduceChange = () => {
      if (reduce.matches) {
        stop();
        for (const viewport of viewports()) viewport.scrollTo({ left: 0, behavior: 'auto' });
      } else {
        start();
      }
    };

    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };

    narrow.addEventListener('change', onModeChange);
    reduce.addEventListener('change', onReduceChange);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      if (resumeTimer !== undefined) window.clearTimeout(resumeTimer);
      observer.disconnect();
      for (const cleanup of rowCleanups) cleanup();
      narrow.removeEventListener('change', onModeChange);
      reduce.removeEventListener('change', onReduceChange);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [sectionRef]);
}

interface SocialProofSectionProps {
  content?: SocialProofContent;
}

export function SocialProofSection({ content = socialProof }: SocialProofSectionProps) {
  const sectionRef = useRef<HTMLElement>(null);
  useMobileAutoAdvance(sectionRef);
  const testimonials = enabledTestimonials(content);
  const [firstRow, secondRow] = splitTestimonialRows(testimonials);

  if (testimonials.length === 0) return null;

  return (
    <section ref={sectionRef} className="sp-section" aria-labelledby="social-proof-title">
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
