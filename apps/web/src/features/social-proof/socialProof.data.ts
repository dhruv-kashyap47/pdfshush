/**
 * Social proof content — the single place to edit logos, reviews and stats.
 *
 * Every entry here is fictional placeholder content while the section is in
 * preview. Replace the values (and switch `placeholder` to `false`) with
 * material you have permission to publish. `enabled: false` hides an entry
 * without deleting it.
 *
 * Logos: add `svg` to ship a real mark. It is inline SVG source and should use
 * `fill="currentColor"` so the strip can keep one monochrome treatment. Leave
 * it out to render the company name as a wordmark.
 */

export interface Review {
  id: string;
  quote: string;
  name: string;
  role: string;
  company: string;
  /** Public review permalink. When present, the card renders a source link. */
  sourceUrl?: string;
  /** Human name for the source, e.g. "Product Hunt". */
  sourceLabel?: string;
  enabled: boolean;
  placeholder: boolean;
}

export interface LogoEntry {
  id: string;
  name: string;
  /** Inline SVG source using fill="currentColor". Omit for a text wordmark. */
  svg?: string;
  /** Optional company URL. A logo without a URL is not a link. */
  href?: string;
  enabled: boolean;
  placeholder: boolean;
}

export interface StatEntry {
  label: string;
  value: string;
  enabled: boolean;
  placeholder?: boolean;
}

export interface Persona {
  id: string;
  label: string;
  detail: string;
}

export interface SocialProofContent {
  logos: LogoEntry[];
  reviews: Review[];
  stats: StatEntry[];
}

export const socialProof: SocialProofContent = {
  logos: [
    { id: 'northwind', name: 'Northwind Legal', enabled: true, placeholder: true },
    { id: 'brightpath', name: 'Brightpath HR', enabled: true, placeholder: true },
    { id: 'harbor', name: 'Harbor & Co', enabled: true, placeholder: true },
    { id: 'keystone', name: 'Keystone Audit', enabled: true, placeholder: true },
    { id: 'lumen', name: 'Lumen Health', enabled: true, placeholder: true },
    { id: 'orbit', name: 'Orbit Studio', enabled: true, placeholder: true },
    { id: 'pinecone', name: 'Pinecone Labs', enabled: true, placeholder: true },
    { id: 'acme', name: 'Acme Finance', enabled: true, placeholder: true },
  ],
  stats: [
    { label: 'Bytes uploaded to a server', value: '0', enabled: true, placeholder: true },
    { label: 'Processing in this browser tab', value: '100%', enabled: true, placeholder: true },
    { label: 'Licence, auditable by anyone', value: 'AGPL-3.0', enabled: true, placeholder: true },
  ],
  reviews: [
    {
      id: 'maya',
      quote:
        'Redacted a two-hundred-page contract before a filing. The text layer was gone, not just covered.',
      name: 'Maya R.',
      role: 'Paralegal',
      company: 'Northwind Legal',
      enabled: true,
      placeholder: true,
    },
    {
      id: 'dev',
      quote: 'Compressed a forty-megabyte deck in a café with no Wi-Fi. It never asked me to sign up.',
      name: 'Dev K.',
      role: 'Freelance designer',
      company: 'Independent',
      enabled: true,
      placeholder: true,
    },
    {
      id: 'sara',
      quote: 'I can merge employee records without opening a ticket with IT.',
      name: 'Sara L.',
      role: 'HR Manager',
      company: 'Brightpath HR',
      enabled: true,
      placeholder: true,
    },
    {
      id: 'tom',
      quote: 'Turned off Wi-Fi to check the claim. It still worked.',
      name: 'Tom B.',
      role: 'Accountant',
      company: 'Keystone Audit',
      enabled: true,
      placeholder: true,
    },
    {
      id: 'priya',
      quote:
        'Found the clause I needed in a ninety-page agreement, with the page number attached.',
      name: 'Priya N.',
      role: 'Law student',
      company: 'Northbridge University',
      enabled: true,
      placeholder: true,
    },
    {
      id: 'james',
      quote: 'Fast, quiet, and the file stays on the laptop it started on.',
      name: 'James O.',
      role: 'Operations lead',
      company: 'Harbor & Co',
      enabled: true,
      placeholder: true,
    },
    {
      id: 'elena',
      quote: 'I checked the output myself. The redacted text was actually gone.',
      name: 'Elena V.',
      role: 'Compliance officer',
      company: 'Lumen Health',
      enabled: true,
      placeholder: true,
    },
    {
      id: 'arjun',
      quote: 'Replaced three paid PDF tools with one tab.',
      name: 'Arjun S.',
      role: 'Founder',
      company: 'Pinecone Labs',
      enabled: true,
      placeholder: true,
    },
    {
      id: 'noor',
      quote:
        'Source documents never touch a third-party server. For our newsroom, that is the whole requirement.',
      name: 'Noor A.',
      role: 'Investigative journalist',
      company: 'Independent',
      enabled: true,
      placeholder: true,
    },
    {
      id: 'beth',
      quote: 'Split and renamed a year of invoices in one sitting.',
      name: 'Beth M.',
      role: 'Office manager',
      company: 'Orbit Studio',
      enabled: true,
      placeholder: true,
    },
    {
      id: 'luis',
      quote:
        'Our statements stay on our machines. Legal stopped asking where the files were being stored.',
      name: 'Luis F.',
      role: 'Finance director',
      company: 'Acme Finance',
      enabled: true,
      placeholder: true,
    },
    {
      id: 'hana',
      quote:
        'Highlighted a footer across sixty pages without uploading the thesis to another service.',
      name: 'Hana T.',
      role: 'Graduate researcher',
      company: 'Northbridge University',
      enabled: true,
      placeholder: true,
    },
  ],
};

/**
 * Shown when fewer than three enabled reviews exist. Deliberately anonymous:
 * roles only, no names, no numbers, no company borrowed from the logo list.
 */
export const PERSONA_FALLBACK: readonly Persona[] = [
  {
    id: 'legal',
    label: 'Legal',
    detail: 'Contracts and discovery sets reviewed without an upload.',
  },
  {
    id: 'hr',
    label: 'HR',
    detail: 'Employee records merged and redacted on the laptop they already sit on.',
  },
  {
    id: 'finance',
    label: 'Finance',
    detail: 'Statements and invoices handled where the numbers already live.',
  },
  {
    id: 'students',
    label: 'Students',
    detail: 'Readings and applications organised between classes, kept on the device.',
  },
];

/** Minimum enabled reviews before the section switches to persona cards. */
export const MINIMUM_REVIEWS = 3;

export function enabledReviews(content: SocialProofContent): Review[] {
  return content.reviews.filter((review) => review.enabled);
}

export function enabledLogos(content: SocialProofContent): LogoEntry[] {
  return content.logos.filter((logo) => logo.enabled);
}

export function enabledStats(content: SocialProofContent): StatEntry[] {
  return content.stats.filter((stat) => stat.enabled);
}

/** Two rows, keeping the authored reading order and a balanced split. */
export function splitReviewRows(reviews: readonly Review[]): [Review[], Review[]] {
  const middle = Math.ceil(reviews.length / 2);
  return [reviews.slice(0, middle), reviews.slice(middle)];
}

export function usesPersonaFallback(reviews: readonly Review[]): boolean {
  return reviews.length < MINIMUM_REVIEWS;
}

export function countEnabledPlaceholders(content: SocialProofContent): number {
  return [
    ...content.logos,
    ...content.reviews,
    ...content.stats,
  ].filter((entry) => entry.enabled && entry.placeholder === true).length;
}

export function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
