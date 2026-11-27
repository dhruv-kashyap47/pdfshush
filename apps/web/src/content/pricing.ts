/**
 * Prices, allowances and public copy for `/pricing`.
 *
 * React-free on purpose: `build/prerender.ts` imports this module to emit the
 * static HTML and the `FAQPage` JSON-LD, and the React page imports the same
 * values. One array means the visible page and the crawlable copy cannot drift.
 *
 * The cents mirror `apps/edge/src/routes/billing.ts` (`PRO`, `PASS`,
 * `CREDIT_PACK`, `DONATION`) and `apps/edge/src/sponsors/catalog.ts`. The web
 * and edge apps are separate builds, so a change on either side must be made on
 * both. The number is money, not decoration.
 */

export const PRICING = {
  free: { aiPerDay: 3 },
  pro: { monthlyCents: 600, yearlyCents: 4_800, aiPerMonth: 500, aiPerDay: 60 },
  pass: { days: 30, cents: 300 },
  credits: { count: 1_000, cents: 500 },
  sponsor: { featuredCents: 3_900, standardCents: 1_900 },
} as const;

/** `$6`, `$4.50`. No trailing `.00`, always the smallest sensible form. */
export function usd(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

export interface PricingFaq {
  q: string;
  a: string;
}

export const PRICING_FAQ: readonly PricingFaq[] = [
  {
    q: 'Do I need an account to buy Pro?',
    a: 'The tools never need one. Pro, the 30 day pass and the credit pack attach to an account, so checkout asks you to sign in with Google first. That is how the plan follows you to another device. Donations and sponsorships never need an account.',
  },
  {
    q: 'Do the prices include tax?',
    a: 'No. Prices are in US dollars and exclude tax. Dodo Payments, the merchant of record, calculates the tax for your billing country and shows it at checkout before you pay, so the total is never a surprise.',
  },
  {
    q: 'Do my files get uploaded when I pay?',
    a: 'No, and paying changes nothing about that. Every PDF tool runs in your browser and the document never leaves the device. AI tools send only the text you choose to the model provider. The file itself stays local.',
  },
  {
    q: 'What happens when I cancel Pro?',
    a: 'Access continues to the end of the period you already paid for, then the account returns to Free. Cancel from the Dodo receipt at any time. Nothing is deleted and no tool stops working.',
  },
  {
    q: 'Do the 1,000 credits expire?',
    a: 'No, not while the account exists. Credits are spent only after the monthly Pro allowance is used, and they survive a lapsed plan, so buying a pack before a busy month is never wasted.',
  },
  {
    q: 'What does Pro actually pay for?',
    a: 'The managed AI, and the site’s independence. Every PDF tool is free for everyone, so Pro is not a paywall on the editor. It raises the managed allowance from 3 messages a day to 500 a month and keeps pdfshush free of ad networks.',
  },
] as const;

/** One row per comparison line. `true` renders a tick, a string renders as is. */
export interface ComparisonRow {
  label: string;
  free: boolean | string;
  pro: boolean | string;
  topup: boolean | string;
}

export const PRICING_COMPARISON: readonly ComparisonRow[] = [
  { label: 'Every PDF tool', free: true, pro: true, topup: true },
  { label: 'Files stay on your device', free: true, pro: true, topup: true },
  { label: 'Managed AI', free: '3 a day', pro: '500 a month', topup: '1,000 one time' },
  { label: 'Account needed', free: 'No', pro: 'Yes', topup: 'Yes' },
  { label: 'Sponsor cards hidden', free: 'No', pro: 'Yes', topup: 'Pass only' },
  { label: 'Renews automatically', free: 'No', pro: 'Yes', topup: 'No' },
  { label: 'Works offline', free: true, pro: true, topup: true },
  { label: 'Price', free: '$0', pro: '$6 or $48', topup: '$3 or $5' },
] as const;

/** The crawlable body of `/pricing`, minus the FAQ block the prerenderer adds. */
export const PRICING_STATIC_BODY = `
<p>Every PDF tool on pdfshush is free, runs in the browser and needs no account. Pro is for one thing: more managed AI, and keeping the site free of advertising.</p>
<h2>Free: $0</h2>
<ul>
<li>Every tool in the catalogue, with no watermark and no daily tool limit.</li>
<li>${PRICING.free.aiPerDay} managed AI messages a day, or bring your own provider key.</li>
<li>No account, no upload, no copy of the document on our side.</li>
</ul>
<h2>Pro: ${usd(PRICING.pro.monthlyCents)} a month, or ${usd(PRICING.pro.yearlyCents)} a year</h2>
<ul>
<li>${PRICING.pro.aiPerMonth} managed AI messages a month, with a daily ceiling of ${PRICING.pro.aiPerDay}.</li>
<li>Everything in Free, for as long as the plan runs.</li>
<li>No sponsor cards, and cancellation any time from the Dodo receipt.</li>
</ul>
<h2>Pay as you go: ${usd(PRICING.pass.cents)} or ${usd(PRICING.credits.cents)}</h2>
<p>A ${PRICING.pass.days} day pass gives Pro for one project, paid once. ${PRICING.credits.count.toLocaleString('en-US')} AI credits cost ${usd(PRICING.credits.cents)} and never expire while the account exists. Neither one renews.</p>
<h2>AI that cites the page</h2>
<p>Summarize PDF returns a summary with page citations. Chat with PDF answers questions from the document. Edit PDF with AI applies a described change after you review it. Three messages a day are free, Pro includes ${PRICING.pro.aiPerMonth} a month, a credit pack covers a busy month, and your own provider key always works.</p>
<h2>Compare plans</h2>
<table>
<thead><tr><th>Feature</th><th>Free</th><th>Pro</th><th>Pay as you go</th></tr></thead>
<tbody>
${PRICING_COMPARISON.map(
  (row) =>
    `<tr><td>${row.label}</td><td>${row.free === true ? 'Included' : row.free}</td><td>${row.pro === true ? 'Included' : row.pro}</td><td>${row.topup === true ? 'Included' : row.topup}</td></tr>`,
).join('\n')}
</tbody>
</table>
<h2>Donation</h2>
<p>Any amount, through the same checkout. A donation buys nothing and changes nothing in the product. It pays for the domain and the occasional afternoon.</p>
<h2>Sponsorship: ${usd(PRICING.sponsor.featuredCents)} or ${usd(PRICING.sponsor.standardCents)} a month</h2>
<p>Two first party sponsor slots, no ad network and no script. The Featured slot is the home page. Standard is the guides index and the end of each guide. Pro accounts never see a card.</p>
<h2>Payment and tax</h2>
<p>Dodo Payments is the merchant of record. It takes the card, calculates tax for your billing country, and issues the receipt. Prices above exclude tax, so the checkout total may be higher. Every plan can be cancelled from the Dodo receipt, and the tools stay free either way.</p>
`;
