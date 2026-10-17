import { useEffect } from 'react';

/**
 * Attaches an IntersectionObserver to every [data-reveal] element
 * inside the given root (defaults to document). Once an element enters
 * the viewport it receives the `data-revealed` attribute, which CSS
 * transitions react to. The observer disconnects on unmount.
 *
 * Usage in JSX: add `data-reveal` (and optionally `data-reveal-delay="150"`)
 * to any element. The animation classes in index.css will do the rest.
 */
export function useReveal(rootSelector?: string) {
  useEffect(() => {
    const root = rootSelector
      ? document.querySelector(rootSelector)
      : document;

    if (!root) return;

    const targets = (root as Element | Document).querySelectorAll<HTMLElement>(
      '[data-reveal]',
    );

    if (!targets.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const el = entry.target as HTMLElement;
            const delay = el.dataset.revealDelay ?? '0';
            el.style.transitionDelay = `${delay}ms`;
            el.setAttribute('data-revealed', '');
            observer.unobserve(el);
          }
        });
      },
      { threshold: 0.08, rootMargin: '0px 0px -40px 0px' },
    );

    targets.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [rootSelector]);
}
