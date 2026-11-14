import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { Star } from 'lucide-react';
import { CompanyLogo } from './company-logo';
import {
  PERSONA_FALLBACK,
  countEnabledPlaceholders,
  enabledLogos,
  enabledReviews,
  enabledStats,
  initialsFor,
  socialProof,
  splitReviewRows,
  usesPersonaFallback,
  type Review,
  type SocialProofContent,
} from './socialProof.data';
import './social-proof.css';

/**
 * Social proof: who uses the product, in their own words.
 *
 * The only ambient motion is a CSS marquee on the logo strip and the two review
 * rows; reduced motion turns all three into static, wrapped grids. Nothing here
 * fetches, and every colour resolves through the site tokens, so light and dark
 * share one DOM.
 */

/** Slightly unequal cards are what keeps the two rows from reading as a clone. */
const CARD_WIDTHS = [352, 318, 374, 332, 362, 306, 320, 368, 336, 356, 312, 380];

const IS_DEV = import.meta.env.DEV;

interface MarqueeProps {
  variant: 'logos' | 'reviews';
  speed: number;
  reverse?: boolean;
  label: string;
  children: ReactNode;
}

function Marquee({ variant, speed, reverse = false, label, children }: MarqueeProps) {
  return (
    <div
      className={`sp-marquee sp-marquee--${variant}${reverse ? ' sp-marquee--reverse' : ''}`}
      role="group"
      aria-label={label}
    >
      <div className="sp-marquee__viewport">
        <div
          className="sp-marquee__track"
          style={{ '--sp-duration': `${speed}s` } as CSSProperties}
        >
          <ul className="sp-marquee__group">{children}</ul>
          {/* Loop copy only. Hidden from assistive tech, and inert so its links
              cannot take keyboard focus behind the visible row. */}
          <ul className="sp-marquee__group sp-marquee__group--dup" aria-hidden="true" inert>
            {children}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Stars() {
  return (
    <div className="sp-stars" role="img" aria-label="Rated 5 out of 5">
      {Array.from({ length: 5 }, (_, index) => (
        <Star key={index} aria-hidden="true" />
      ))}
    </div>
  );
}

function ReviewCard({ review, width }: { review: Review; width: number }) {
  const sourceName = review.sourceLabel ?? 'the original source';

  return (
    <li
      className="sp-card"
      style={{ '--sp-card-width': `${width}px` } as CSSProperties}
    >
      <div className="sp-card__top">
        <Stars />
        {IS_DEV && review.placeholder ? <span className="sp-badge">Placeholder</span> : null}
      </div>

      <blockquote className="sp-quote">
        <p>“{review.quote}”</p>
      </blockquote>

      <div className="sp-person">
        <span className="sp-avatar" aria-hidden="true">
          {initialsFor(review.name)}
        </span>
        <span className="sp-person__text">
          <span className="sp-person__name">{review.name}</span>
          <span className="sp-person__meta">
            {review.role}, {review.company}
          </span>
        </span>
      </div>

      {review.sourceUrl ? (
        <a
          className="sp-source"
          href={review.sourceUrl}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={`Read ${review.name}’s review on ${sourceName} (opens in a new tab)`}
        >
          {sourceName}
        </a>
      ) : null}
    </li>
  );
}

function PersonaFallback() {
  return (
    <ul className="sp-personas" aria-label="Teams who work with sensitive files">
      {PERSONA_FALLBACK.map((persona) => (
        <li key={persona.id} className="sp-persona">
          <h3 className="sp-persona__label">{persona.label}</h3>
          <p className="sp-persona__detail">{persona.detail}</p>
        </li>
      ))}
    </ul>
  );
}

interface SocialProofSectionProps {
  content?: SocialProofContent;
}

export function SocialProofSection({ content = socialProof }: SocialProofSectionProps) {
  const reviews = enabledReviews(content);
  const logos = enabledLogos(content);
  const stats = enabledStats(content);
  const placeholderCount = countEnabledPlaceholders(content);
  const fallback = usesPersonaFallback(reviews);
  const [firstRow, secondRow] = splitReviewRows(reviews);

  // Placeholder material is a preview aid, never something to ship silently.
  useEffect(() => {
    if (!import.meta.env.PROD || placeholderCount === 0) return;
    console.warn(
      `[social-proof] ${placeholderCount} enabled placeholder ${
        placeholderCount === 1 ? 'entry is' : 'entries are'
      } live in this production build. Replace them in socialProof.data.ts or set enabled: false.`,
    );
  }, [placeholderCount]);

  return (
    <section className="sp-section" aria-labelledby="social-proof-title">
      <div className="sp-shell">
        <div className="sp-header">
          <h2 id="social-proof-title" className="sp-title">
            Trusted by teams who can’t upload their files.
          </h2>
          <p className="sp-sub">
            Legal, HR and finance teams use pdfshush because the document never leaves the
            browser tab.
          </p>
          {IS_DEV && placeholderCount > 0 ? (
            <p className="sp-dev-note">
              <span className="sp-badge">Placeholder</span>
              Preview content. Replace the entries in socialProof.data.ts before launch.
            </p>
          ) : null}
        </div>

        {stats.length > 0 ? (
          <dl className="sp-stats">
            {stats.map((stat) => (
              <div key={stat.label} className="sp-stat">
                <dt className="sp-stat__label">{stat.label}</dt>
                <dd className="sp-stat__value">{stat.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>

      {logos.length > 0 ? (
        <div className="sp-logos">
          <div className="sp-shell">
            <div className="sp-logos__head">
              <p className="sp-logos__note">Organizations using pdfshush</p>
            </div>
          </div>
          <Marquee variant="logos" speed={90} label="Organizations using pdfshush">
            {logos.map((logo) => (
              <li key={logo.id} className="sp-logo-item">
                <CompanyLogo logo={logo} />
              </li>
            ))}
          </Marquee>
        </div>
      ) : null}

      <div className="sp-reviews">
        {fallback ? (
          <div className="sp-shell">
            <PersonaFallback />
          </div>
        ) : (
          <>
            <Marquee
              variant="reviews"
              speed={60}
              label="Customer reviews, first row"
            >
              {firstRow.map((review, index) => (
                <ReviewCard
                  key={review.id}
                  review={review}
                  width={CARD_WIDTHS[index % CARD_WIDTHS.length]!}
                />
              ))}
            </Marquee>
            <Marquee
              variant="reviews"
              speed={75}
              reverse
              label="Customer reviews, second row"
            >
              {secondRow.map((review, index) => (
                <ReviewCard
                  key={review.id}
                  review={review}
                  width={CARD_WIDTHS[(index + 3) % CARD_WIDTHS.length]!}
                />
              ))}
            </Marquee>
          </>
        )}
      </div>
    </section>
  );
}
