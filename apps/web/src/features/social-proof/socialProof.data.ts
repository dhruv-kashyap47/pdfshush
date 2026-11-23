/**
 * Sample testimonial content. Replace these entries with real user feedback
 * before launch. The ratings are authored sample data too: attach a rating
 * only to a review you can point at.
 */

export interface Testimonial {
  id: string;
  quote: string;
  /** First name plus last initial, e.g. "Tom B." */
  name: string;
  /** Optional generic role, e.g. "Accountant". Never a company name. */
  role?: string;
  /** Whole stars, 1–5. Omitted renders no stars for that card. */
  rating?: number;
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
        'Merged a month of receipts into one file. No upload, no waiting.',
      name: 'Tom B.',
      role: 'Accountant',
      rating: 5,
      enabled: true,
    },
    {
      id: 'priya',
      quote:
        'Asked a reading pack a question and got the answer with its page number.',
      name: 'Priya N.',
      role: 'Law student',
      rating: 5,
      enabled: true,
    },
    {
      id: 'dev',
      quote:
        'Pulled one page out as a JPG in a few seconds.',
      name: 'Dev K.',
      role: 'Designer',
      rating: 5,
      enabled: true,
    },
    {
      id: 'hana',
      quote: 'Reordered a handout between classes. Drag, drop, done.',
      name: 'Hana T.',
      role: 'Teacher',
      rating: 4,
      enabled: true,
    },
    {
      id: 'noor',
      quote: 'Redacted client details before sharing a scan.',
      name: 'Noor A.',
      role: 'Office manager',
      rating: 5,
      enabled: true,
    },
    {
      id: 'luis',
      quote: 'Compressed a lease without losing the fine print.',
      name: 'Luis F.',
      role: 'Property manager',
      rating: 5,
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
