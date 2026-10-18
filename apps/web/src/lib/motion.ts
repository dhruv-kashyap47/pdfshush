/**
 * Motion system — the single home for every anime.js call in the app.
 *
 * Contract:
 * - Transform + opacity only (both GPU-composited; no layout thrash, no blur).
 * - Motion is always a response to an interaction or an appearance; nothing
 *   loops ambiently (loops, if any, live in CSS where the global
 *   prefers-reduced-motion fallback nullifies them).
 * - prefers-reduced-motion collapses every duration/delay to zero, so
 *   elements land in their final state instantly.
 * - Easings and durations are tokens: two components animating "an enter"
 *   must move identically, which is what makes the site feel like one product.
 */

import {
  animate as animeAnimate,
  createTimeline as animeCreateTimeline,
  stagger,
  type AnimationParams,
  type StaggerFunction,
  type StaggerParams,
  type TargetsParam,
  type Timeline,
  type TimelineParams,
} from 'animejs';

/* ── Tokens ────────────────────────────────────────────────────────────── */

/** The entering ease of the CSS reveal system is (0.16, 1, 0.3, 1); this is
 *  its library twin, so anime/CSS entrances read as one system. */
export const EASE = {
  out: 'outExpo' as const,
  soft: 'outCubic' as const,
  inOut: 'inOutQuad' as const,
};

export const DUR = {
  /** Press feedback, chips, tiny swaps. */
  fast: 220,
  /** Default enter/exit. */
  base: 420,
  /** Hero copy, panel entrances. */
  slow: 720,
} as const;

/* ── Reduced motion ────────────────────────────────────────────────────── */

let reducedCache: boolean | null = null;

/** True once, then cached — the preference does not change mid-session. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  if (reducedCache === null) {
    reducedCache = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  return reducedCache;
}

/** A duration (or delay) value that collapses to zero under reduced motion. */
export function dur(ms: number): number {
  return prefersReducedMotion() ? 0 : ms;
}

/* ── Wrappers ──────────────────────────────────────────────────────────── */

export type AnimateUI = (targets: TargetsParam, params: AnimationParams) => ReturnType<typeof animeAnimate>;

/**
 * anime.animate with the product's motion contract baked in: under reduced
 * motion every animation finishes on frame one, in place.
 */
export const animateUI: AnimateUI = (targets, params) => {
  const reduced = prefersReducedMotion();
  return animeAnimate(targets, reduced ? { ...params, duration: 0, delay: 0 } : params);
};

/**
 * createTimeline with the same contract (defaults collapse to zero).
 * Individual `.add()` calls must still pass `dur(...)`/`staggerUI(...)` for
 * their own durations.
 */
export function timelineUI(params: TimelineParams = {}): Timeline {
  if (!prefersReducedMotion()) return animeCreateTimeline(params);
  return animeCreateTimeline({
    ...params,
    autoplay: true,
    defaults: { ...params.defaults, duration: 0, delay: 0 },
  });
}

/** anime stagger that collapses to zero-delay under reduced motion. */
export function staggerUI(
  step: number,
  params?: StaggerParams,
): StaggerFunction<number> {
  return stagger(prefersReducedMotion() ? 0 : step, params);
}

/**
 * Scroll-gated entrance: runs `play` when `el` first enters the viewport.
 * Falls back to immediately (next frame) when the API is missing. The
 * observer disconnects itself once fired — no long-lived listener remains.
 */
export function onEnterViewport(el: Element, play: () => void): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    const handle = requestAnimationFrame(play);
    return () => cancelAnimationFrame(handle);
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          observer.disconnect();
          // rAF keeps the reveal off the very frame that scrolled the section
          // into view, so entering content never jitters against the scroll.
          requestAnimationFrame(play);
          return;
        }
      }
    },
    { threshold: 0.15, rootMargin: '0px 0px -60px 0px' },
  );
  observer.observe(el);
  // Unmounting while below the fold must still disconnect: otherwise the
  // observer pins the element and its closure in memory until GC.
  return () => observer.disconnect();
}
