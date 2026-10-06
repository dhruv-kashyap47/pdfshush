import { useEffect, useState } from 'react';
import { getRecent, type RecentEntry } from '@/tools/recent';

/** Loads local recent-tool history (IndexedDB) for the menu and homepage. */
export function useRecent(): RecentEntry[] {
  const [entries, setEntries] = useState<RecentEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    void getRecent().then((result) => {
      if (!cancelled) setEntries(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return entries;
}
