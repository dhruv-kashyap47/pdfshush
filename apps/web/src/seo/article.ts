/** Structured data shared by the guide page and the prerenderer. */

import { absolute } from './schema';
import { SITE_NAME, SITE_ORIGIN } from './site';

export function articleSchema(
  input: {
    title: string;
    description: string;
    route: string;
    publishedAt: string;
    updatedAt: string;
    section: string;
    image?: string;
  },
  origin: string = SITE_ORIGIN,
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: input.title,
    description: input.description,
    datePublished: input.publishedAt,
    dateModified: input.updatedAt,
    articleSection: input.section,
    inLanguage: 'en',
    mainEntityOfPage: { '@type': 'WebPage', '@id': absolute(origin, input.route) },
    image: `${origin}${input.image ?? '/og/home.png'}`,
    author: { '@type': 'Organization', name: SITE_NAME, url: origin },
    publisher: { '@type': 'Organization', name: SITE_NAME, url: origin },
  };
}
