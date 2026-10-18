import { useEffect, useRef } from 'react';
import { animateUI, type AnimateUI } from '@/lib/motion';

/**
 * A parked anime.js renderable (JSAnimation or Timeline). Only the surface
 * the cleanup pass touches is declared, so the registry stays decoupled from
 * the exact anime module shape.
 */
interface Pausable {
  pause(): void;
}

/**
 * Per-component motion registry. Every animation created through `animate()`
 * (or parked with `park()`) is cancelled on unmount — this is what keeps
 * navigated-away pages engine-free and makes React StrictMode's dev
 * double-mount harmless: every effect fully re-cleans before it re-runs.
 */
export interface MotionScope {
  /** Registers an already-created animation (e.g. a timeline) for cleanup. */
  park(animation: Pausable): void;
  /** Creates + plays an interaction animation in one step. */
  animate(targets: Parameters<AnimateUI>[0], params: Parameters<AnimateUI>[1]): ReturnType<AnimateUI>;
  /** Cancels and forgets everything parked so far. */
  cancelAll(): void;
}

export function useMotionScope(): MotionScope {
  const scopeRef = useRef<MotionScope | null>(null);
  if (scopeRef.current === null) {
    // The parked set lives outside React state: animations are created from
    // event callbacks and observers that must not re-render anything.
    const parked = new Set<Pausable>();
    scopeRef.current = {
      park(animation) {
        parked.add(animation);
        // Self-forgetting keeps the set small on chatty interactions.
        void Promise.resolve(animation).then(() => parked.delete(animation)).catch(() => {});
      },
      animate(targets, params) {
        const animation = animateUI(targets, params);
        this.park(animation);
        return animation;
      },
      cancelAll() {
        for (const animation of parked) animation.pause();
        parked.clear();
      },
    };
  }

  useEffect(() => {
    const scope = scopeRef.current;
    return () => {
      scope?.cancelAll();
    };
  }, []);

  return scopeRef.current;
}
