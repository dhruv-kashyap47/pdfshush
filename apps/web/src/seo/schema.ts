/**
 * JSON-LD builders shared by the prerenderer and the React head hook.
 *
 * No React, no browser APIs: `build/prerender.ts` imports this with plain Node.
 * Every builder returns a plain object; the caller serialises it.
 */

import { GITHUB_URL, OG_IMAGE_HEIGHT, OG_IMAGE_WIDTH, SITE_NAME, SITE_ORIGIN } from './site.ts';

export interface SchemaTool {
  slug: string;
  name: string;
  description: string;
}

export function absolute(origin: string, route: string): string {
  if (route === '/' || route === '') return origin.replace(/\/$/, '');
  return `${origin.replace(/\/$/, '')}/${route.replace(/^\//, '')}`;
}

export function organizationSchema(origin: string = SITE_ORIGIN): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${origin}/#organization`,
    name: SITE_NAME,
    alternateName: 'pdfshush',
    url: origin,
    logo: {
      '@type': 'ImageObject',
      url: `${origin}/icons/icon-512.png`,
      width: 512,
      height: 512,
    },
    email: 'foundersoffice@proton.me',
    sameAs: [GITHUB_URL],
    description:
      'Free online PDF tools that run in your browser: compress, merge, split, edit, convert, sign and redact without uploading the document.',
  };
}

export function websiteSchema(origin: string = SITE_ORIGIN): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${origin}/#website`,
    name: SITE_NAME,
    alternateName: 'pdfshush',
    url: origin,
    description:
      'Free online PDF tools for compressing, merging, splitting, editing and converting files in your browser. No signup and no watermark.',
    inLanguage: 'en-IN',
    publisher: { '@id': `${origin}/#organization` },
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${origin}/?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

export function softwareApplicationSchema(
  tool: SchemaTool,
  origin: string = SITE_ORIGIN,
  route = `/tools/${tool.slug}`,
): Record<string, unknown> {
  const url = absolute(origin, route);
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    '@id': `${url}#app`,
    name: tool.name,
    description: tool.description,
    url,
    applicationCategory: 'UtilitiesApplication',
    applicationSubCategory: 'PDF tools',
    operatingSystem: 'Web',
    browserRequirements: 'Requires JavaScript. Runs in a modern browser.',
    isAccessibleForFree: true,
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'INR',
      availability: 'https://schema.org/InStock',
    },
    featureList:
      'Runs in the browser; no account required; no watermark; no upload for client-side tools.',
    publisher: { '@id': `${origin}/#organization` },
  };
}

export function breadcrumbSchema(
  items: Array<{ name: string; route: string }>,
  origin: string = SITE_ORIGIN,
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: absolute(origin, item.route),
    })),
  };
}

export function faqPageSchema(
  faqs: ReadonlyArray<{ question: string; answer: string }>,
  origin: string = SITE_ORIGIN,
  route = '/',
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${absolute(origin, route)}#faq`,
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: { '@type': 'Answer', text: faq.answer },
    })),
  };
}

export function webPageSchema(
  options: {
    name: string;
    description: string;
    route: string;
    image?: string;
    type?: 'WebPage' | 'Article';
  },
  origin: string = SITE_ORIGIN,
): Record<string, unknown> {
  const url = absolute(origin, options.route);
  return {
    '@context': 'https://schema.org',
    '@type': options.type ?? 'WebPage',
    '@id': `${url}#webpage`,
    name: options.name,
    description: options.description,
    url,
    isPartOf: { '@id': `${origin}/#website` },
    about: { '@id': `${origin}/#organization` },
    ...(options.image
      ? {
          primaryImageOfPage: {
            '@type': 'ImageObject',
            url: `${origin}${options.image}`,
            width: OG_IMAGE_WIDTH,
            height: OG_IMAGE_HEIGHT,
          },
        }
      : {}),
  };
}
