import { useEffect, useState } from 'react';

/** The resolved theme, read from the `dark` class the provider (and the
 *  head script) put on <html>. Components that need a different *medium* per
 *  theme — not just different colours — subscribe here so the DOM stays one
 *  layout and only the artwork swaps. */
export function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(() => {
    if (typeof document === 'undefined') return false;
    return document.documentElement.classList.contains('dark');
  });

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setIsDark(root.classList.contains('dark'));
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    // "System" is live: the provider re-writes the class, but listening to the
    // query as well keeps the artwork correct even if the provider is absent.
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', sync);
    sync();
    return () => {
      observer.disconnect();
      media.removeEventListener('change', sync);
    };
  }, []);

  return isDark;
}
