import { useEffect, useState } from 'react';
import { getRecent, subscribeRecent, type RecentEntry } from '@/tools/recent';

/**
 * Loads local recent-tool history (IndexedDB) for the menu and homepage.
 *
 * Subscribes to writes as well as reading on mount. The header is a persistent
 * layout component, so it stays mounted across every tool run: reading only once
 * on mount froze the list at whatever it held when the app loaded, and the tool
 * the user had just finished never appeared.
 */
export function useRecent(): RecentEntry[] {
  const [entries, setEntries] = useState<RecentEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    const reload = () => {
      void getRecent().then((result) => {
        if (!cancelled) setEntries(result);
      });
    };
    reload();
    const unsubscribe = subscribeRecent(reload);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return entries;
}
