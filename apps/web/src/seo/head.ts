/**
 * Route-aware head management for SPA navigation.
 *
 * A crawler gets the prerendered document, which already carries these tags.
 * This hook keeps the same tags correct when a visitor moves between routes
 * without a full page load: title, description, canonical, robots, Open Graph,
 * Twitter card, hreflang and JSON-LD. Without it, sharing a client-side URL or
 * switching tabs would keep the first page's title.
 */

import { useEffect } from 'react';
import {
  OG_IMAGE_HEIGHT,
  OG_IMAGE_WIDTH,
  SITE_LOCALE,
  SITE_NAME,
  SITE_ORIGIN,
  absoluteUrl,
} from './site.ts';

export interface PageHead {
  title: string;
  description: string;
  route: string;
  image?: string;
  imageAlt?: string;
  type?: 'website' | 'article';
  keywords?: string[];
  indexable?: boolean;
  jsonLd?: Record<string, unknown>[];
}

function runtimeOrigin(): string {
  const configured =
    typeof import.meta !== 'undefined'
      ? (import.meta.env?.VITE_SITE_ORIGIN as string | undefined)
      : undefined;
  return (configured || SITE_ORIGIN).replace(/\/$/, '');
}

function upsertMeta(attribute: 'name' | 'property', key: string, content: string): void {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.setAttribute('content', content);
}

function upsertLink(rel: string, href: string, extra?: Record<string, string>): void {
  let element = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!element) {
    element = document.createElement('link');
    element.setAttribute('rel', rel);
    document.head.appendChild(element);
  }
  element.setAttribute('href', href);
  for (const [name, value] of Object.entries(extra ?? {})) element.setAttribute(name, value);
}

function syncHreflang(origin: string, route: string): void {
  for (const stale of document.head.querySelectorAll('link[data-seo-hreflang]')) stale.remove();
  const url = absoluteUrl(route, origin);
  const entries: Array<[string, string]> = [
    ['en-IN', url],
    ['en', url],
    ['x-default', url],
  ];
  for (const [lang, href] of entries) {
    const link = document.createElement('link');
    link.rel = 'alternate';
    link.hreflang = lang;
    link.href = href;
    link.dataset.seoHreflang = 'true';
    document.head.appendChild(link);
  }
}

function syncJsonLd(schemas: Record<string, unknown>[]): void {
  // Remove every route-owned block, including the plain prerendered ones. The
  // tool FAQ is deliberately excluded: ToolFaq owns that node and reuses it.
  for (const stale of document.head.querySelectorAll(
    'script[type="application/ld+json"]:not([data-tool-faq-schema])',
  )) {
    stale.remove();
  }
  for (const schema of schemas) {
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.dataset.seoJsonld = 'true';
    script.textContent = JSON.stringify(schema);
    document.head.appendChild(script);
  }
}

export function usePageHead(head: PageHead): void {
  const {
    title,
    description,
    route,
    image = '/og/home.png',
    imageAlt = `${SITE_NAME} – free online PDF tools`,
    type = 'website',
    keywords,
    indexable = true,
    jsonLd = [],
  } = head;

  // Serialise the schema list so the effect does not depend on a fresh array
  // identity every render. The content is what should trigger a rewrite.
  const schemaKey = JSON.stringify(jsonLd);

  useEffect(() => {
    const origin = runtimeOrigin();
    const url = absoluteUrl(route, origin);
    const imageUrl = image.startsWith('http') ? image : `${origin}${image}`;

    document.documentElement.lang = 'en-IN';
    document.title = title;

    upsertMeta('name', 'description', description);
    upsertMeta('name', 'robots', indexable ? 'index, follow, max-image-preview:large' : 'noindex, follow');
    if (keywords?.length) upsertMeta('name', 'keywords', keywords.join(', '));

    upsertLink('canonical', url);

    upsertMeta('property', 'og:type', type);
    upsertMeta('property', 'og:site_name', SITE_NAME);
    upsertMeta('property', 'og:title', title);
    upsertMeta('property', 'og:description', description);
    upsertMeta('property', 'og:url', url);
    upsertMeta('property', 'og:image', imageUrl);
    upsertMeta('property', 'og:image:alt', imageAlt);
    upsertMeta('property', 'og:image:width', String(OG_IMAGE_WIDTH));
    upsertMeta('property', 'og:image:height', String(OG_IMAGE_HEIGHT));
    upsertMeta('property', 'og:locale', SITE_LOCALE);

    upsertMeta('name', 'twitter:card', 'summary_large_image');
    upsertMeta('name', 'twitter:title', title);
    upsertMeta('name', 'twitter:description', description);
    upsertMeta('name', 'twitter:image', imageUrl);
    upsertMeta('name', 'twitter:image:alt', imageAlt);

    syncHreflang(origin, route);
    syncJsonLd(JSON.parse(schemaKey) as Record<string, unknown>[]);
  }, [title, description, route, image, imageAlt, type, indexable, keywords, schemaKey]);
}
