import { TOOL_SEO } from '../apps/web/src/seo/tool-seo.ts';
import { LANDING_PAGES } from '../apps/web/src/seo/landing-pages.ts';
import { HOME_TITLE, HOME_DESCRIPTION } from '../apps/web/src/seo/home-content.ts';

function len(value) {
  return [...value].length;
}

function report(label, title, description) {
  const t = len(title);
  const d = len(description);
  const ok = t >= 50 && t <= 60 && d >= 150 && d <= 160;
  console.log(`${ok ? 'OK  ' : 'FIX '} ${label.padEnd(30)} T=${String(t).padStart(2)} D=${String(d).padStart(3)}`);
}

report('/', HOME_TITLE, HOME_DESCRIPTION);
for (const [slug, seo] of Object.entries(TOOL_SEO)) report(`/tools/${slug}`, seo.title, seo.description);
for (const page of LANDING_PAGES) report(page.path, page.title, page.description);
