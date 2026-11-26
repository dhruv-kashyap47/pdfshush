/**
 * The guide sources, resolved by `guidesPlugin` in `vite.config.ts`.
 *
 * A published build contains only articles whose frontmatter says
 * `draft: false`; the dev server contains everything so a draft can be
 * previewed. The plugin, not this module, does the filtering.
 */
declare module 'virtual:guides' {
  const sources: Record<string, string>;
  export default sources;
}
