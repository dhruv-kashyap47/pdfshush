/**
 * Public site facts for SEO output.
 *
 * One origin, one name, one locale. `build/prerender.ts` imports this module
 * with plain Node, so it must stay free of React and browser APIs.
 *
 * `SITE_ORIGIN` is the canonical origin. The deployed origin can still be
 * overridden with `VITE_SITE_ORIGIN` (self-hosters do exactly that); the
 * default is the public production domain.
 */
export const SITE_ORIGIN = 'https://pdfshush.com';
export const SITE_NAME = 'PDFShush';
export const SITE_SHORT_NAME = 'pdfshush';
export const SITE_LOCALE = 'en_IN';
export const SITE_LANG = 'en-IN';
export const SITE_TAGLINE = 'Free online PDF tools that run in your browser';
export const SITE_DESCRIPTION =
  'Free online PDF tools to compress, merge, split, edit and convert PDFs in your browser. No signup, no watermark, and your files never leave your device.';
export const CONTACT_EMAIL = 'foundersoffice@proton.me';
export const GITHUB_URL = 'https://github.com/dhruv-kashyap47/pdfshush';

/** Default social card. Every route overrides this with its own 1200×630 PNG. */
export const DEFAULT_OG_IMAGE = '/og/home.png';
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

/** Absolute URL for a route, with a trailing slash only on the root. */
export function absoluteUrl(route: string, origin: string = SITE_ORIGIN): string {
  const base = origin.replace(/\/$/, '');
  if (route === '/' || route === '') return `${base}/`;
  return `${base}/${route.replace(/^\//, '')}`;
}

export interface PageMeta {
  title: string;
  description: string;
  route: string;
  image?: string;
  imageAlt?: string;
  type?: 'website' | 'article';
  keywords?: string[];
  indexable?: boolean;
}
