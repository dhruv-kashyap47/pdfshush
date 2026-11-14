/**
 * Sample testimonial content. Replace these entries with real user feedback
 * before launch.
 */

export interface Testimonial {
  id: string;
  quote: string;
  /** First name plus last initial, e.g. "Tom B." */
  name: string;
  /** Optional generic role, e.g. "Accountant". Never a company name. */
  role?: string;
  enabled: boolean;
}

export interface SocialProofContent {
  testimonials: Testimonial[];
}

export const socialProof: SocialProofContent = {
  testimonials: [
    {
      id: 'tom',
      quote:
        'Merged a month of receipts on a train with no signal. The file never left the laptop.',
      name: 'Tom B.',
      role: 'Accountant',
      enabled: true,
    },
    {
      id: 'priya',
      quote:
        'Compressed a scanned reading pack before a seminar. No sign-up screen, no watermark.',
      name: 'Priya N.',
      role: 'Law student',
      enabled: true,
    },
    {
      id: 'dev',
      quote:
        'I pull one page out of a deck as a JPG almost every week. It takes a few seconds.',
      name: 'Dev K.',
      role: 'Designer',
      enabled: true,
    },
    {
      id: 'hana',
      quote: 'Reordered a handout between classes. Drag, drop, download, done.',
      name: 'Hana T.',
      role: 'Teacher',
      enabled: true,
    },
    {
      id: 'noor',
      quote: 'Our guest Wi-Fi blocks half the internet. This still opens the file.',
      name: 'Noor A.',
      role: 'Office manager',
      enabled: true,
    },
    {
      id: 'luis',
      quote: 'Combined three versions of a lease into one file before a call.',
      name: 'Luis F.',
      role: 'Property manager',
      enabled: true,
    },
  ],
};

/**
 * Two rows, keeping the authored reading order and a balanced split.
 */
export function splitTestimonialRows(
  testimonials: readonly Testimonial[],
): [Testimonial[], Testimonial[]] {
  const middle = Math.ceil(testimonials.length / 2);
  return [testimonials.slice(0, middle), testimonials.slice(middle)];
}

export function enabledTestimonials(content: SocialProofContent): Testimonial[] {
  return content.testimonials.filter((testimonial) => testimonial.enabled);
}

export function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
