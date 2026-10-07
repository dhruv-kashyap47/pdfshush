import { createContext, useContext } from 'react';

/**
 * Which tool page is currently rendered. Set by ToolFrame, read by
 * ResultPanel so success screens can suggest the next tool without every
 * call site passing its slug down.
 */
export const ToolSlugContext = createContext<string | null>(null);

export function useToolSlug(): string | null {
  return useContext(ToolSlugContext);
}
