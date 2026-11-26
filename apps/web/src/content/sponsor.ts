/**
 * Sponsor copy shared by the SPA and the prerenderer.
 *
 * The FAQ appears twice by design: once as React on mount, and once as static
 * HTML plus `FAQPage` JSON-LD for a crawler that never runs JavaScript. Keeping
 * one array means the two can never disagree, which the SEO audit checks.
 */

export interface SponsorFaq {
  q: string;
  a: string;
}

export const SPONSOR_FAQ: readonly SponsorFaq[] = [
  {
    q: 'Is this an ad network?',
    a: 'No. A sponsor adds no script, no iframe and no pixel. The only third-party script on any page is the site’s own Google Tag Manager measurement tag, which a sponsor cannot extend, target or read. A sponsor card is markup pdfshush renders itself, with a logo served from pdfshush.com, and it is labelled “Sponsored”.',
  },
  {
    q: 'Do Pro subscribers see sponsor cards?',
    a: 'No. A paid account never renders one. Sponsors buy reach among free visitors, which is almost every visitor.',
  },
  {
    q: 'Where exactly does my card appear?',
    a: 'Featured is the home page, under the tool grid. Standard is the guides index and the end of each published guide. Neither ever appears inside a tool, a result screen, checkout or the account page.',
  },
  {
    q: 'What content is refused?',
    a: 'Anything that uploads documents, claims to be a download button, or misleads a reader about what it does. The site’s whole argument is that a PDF tool should not need your file; a sponsor that contradicts it is refused.',
  },
  {
    q: 'How do I cancel or change the card?',
    a: 'Cancel from the Dodo receipt at any time; the card stays up until the paid month ends. Email us to swap the logo or the line, and it changes the same day.',
  },
] as const;

/** The crawlable body of `/sponsor`, minus the FAQ block the prerenderer adds. */
export const SPONSOR_STATIC_BODY = `
<p>pdfshush is a free PDF toolkit that runs entirely in the browser. Every tool is free, no account is required, and no document is uploaded. The site is funded by its readers: a paid Pro plan, two direct sponsor slots, and the occasional donation.</p>
<p><strong>Why sponsorship instead of an ad network.</strong> The product’s claim is that your documents are nobody else’s business. A page that loads Google’s ad script, an ad consent platform and a cross-site pixel argues the opposite. Sponsorship keeps the page first-party: a logo, a name, one line and a link, rendered by this site. The site’s own page-view measurement tag is not part of the sponsorship, and a sponsor cannot add to it. There is no ad cookie, no retargeting audience and no third party for a sponsor to trust.</p>
<p><strong>What a sponsor gets.</strong> The Featured slot is a single card at the foot of the home page, under the tool grid. The Standard slot appears on the guides index and at the end of every published guide. Both carry the sponsor’s logo, a name of up to 40 characters, a line of up to 60 characters, and one outbound link marked <code>rel="sponsored"</code>. Cards are labelled and never imitate a download button, a system notice or a control.</p>
<p><strong>What a sponsor does not get.</strong> No tracking pixel, no cookie, no retargeting audience, no pop-up, no interstitial, and no placement inside a tool, a result screen, checkout or the account page. Pro accounts never render a card at all.</p>
<p><strong>Founding rates.</strong> The Featured slot is $39 a month and the Standard slot is $19 a month, locked for twelve months for the first sponsors. These prices are deliberately low while the site is early and rise when the traffic does, not before. Payment is handled by Dodo Payments, the merchant of record, which also handles tax and the receipt.</p>
<p><strong>Donations</strong> are accepted through the same checkout. They buy nothing and change nothing in the product; they pay for the domain and the occasional afternoon.</p>
`;
