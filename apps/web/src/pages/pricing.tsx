/**
 * `/pricing`: the one page that states what is free, what Pro adds, and what the
 * smaller purchases are for.
 *
 * Every number comes from `@/content/pricing`, which the prerenderer imports too,
 * so the static HTML and the React page cannot disagree. The buttons do not start
 * a checkout here: Pro, the pass and credits need an account, so they route to
 * `/account`, which owns the authenticated purchase flow.
 *
 * Motion: entrances run through `Reveal` (anime.js via the shared motion scope),
 * prices count up with `CountUp`, and the ambient fields and headline sheen are
 * CSS so they stop under `prefers-reduced-motion`.
 */

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Check, HeartHandshake, Megaphone, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AiTools } from '@/components/pricing/ai-tools';
import { PricingFaqList } from '@/components/pricing/faq';
import { PopularNote } from '@/components/pricing/popular-note';
import { SaleMarquee } from '@/components/pricing/sale-marquee';
import { CountUp } from '@/components/motion/count-up';
import { Magnetic } from '@/components/motion/magnetic';
import { Reveal } from '@/components/motion/reveal';
import { SpotlightCard } from '@/components/motion/spotlight-card';
import { PRICING, PRICING_COMPARISON, PRICING_FAQ, usd } from '@/content/pricing';
import './pricing.css';

function Tick() {
  return (
    <span className="pricing-tick" aria-hidden="true">
      <Check className="h-3 w-3" />
    </span>
  );
}

function Cell({ value }: { value: boolean | string }) {
  if (value === true) return <Tick />;
  return <span className="text-muted-foreground">{value}</span>;
}

function Feature({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-2.5 text-sm text-muted-foreground">
      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <span>{children}</span>
    </li>
  );
}

export function PricingPage() {
  return (
    <div className="pricing-page">
      <div className="pricing-ambient" aria-hidden="true">
        <div className="pricing-blob pricing-blob-a" />
        <div className="pricing-blob pricing-blob-b" />
        <div className="pricing-grid-lines" />
      </div>

      <div className="mx-auto max-w-6xl px-4 pb-20 pt-14 sm:px-6 sm:pt-20 lg:px-8">
        <header className="mx-auto max-w-3xl text-center">
          <Reveal delay={80}>
            <h1 className="mt-4 text-5xl font-bold tracking-tight sm:text-6xl">
              <span className="pricing-shine">Pricing</span>
            </h1>
          </Reveal>
          <Reveal delay={160}>
            <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              Every PDF tool is free and runs in your browser. Pro adds more managed AI, and keeps
              pdfshush free of ad networks.
            </p>
          </Reveal>
          <Reveal delay={240}>
            <div className="pricing-sale">
              <span className="pricing-sale-chip">33% off yearly</span>
              <span>
                Yearly Pro is {usd(PRICING.pro.yearlyCents)} for twelve months. Two months free.
              </span>
            </div>
          </Reveal>
        </header>

        <Reveal delay={320} className="mt-10">
          <SaleMarquee />
        </Reveal>

        <section aria-label="Plans" className="mt-10 grid gap-4 lg:mt-12 lg:grid-cols-3">
          <Reveal delay={0} distance={24}>
            <SpotlightCard className="bg-card/60">
              <div className="flex h-full flex-col p-7 sm:p-8">
                <h2 className="text-xl font-semibold tracking-tight">Free</h2>
                <p className="mt-1 min-h-[2.5rem] text-sm text-muted-foreground">
                  The whole catalogue, on your device.
                </p>
                <p className="mt-6 flex items-baseline gap-1.5">
                  <span className="text-4xl font-bold tracking-tight tabular-nums">$0</span>
                  <span className="text-sm text-muted-foreground">forever</span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">No card, no sign-up.</p>
                <ul className="mt-7 space-y-3">
                  <Feature>Every PDF tool, no watermark</Feature>
                  <Feature>{PRICING.free.aiPerDay} managed AI messages a day</Feature>
                  <Feature>Bring your own AI provider key</Feature>
                  <Feature>No account, and no file upload</Feature>
                </ul>
                <div className="mt-auto pt-8">
                  <Button asChild variant="outline" size="lg" className="w-full rounded-full">
                    <Link to="/#all-tools">Use the free tools</Link>
                  </Button>
                  <p className="mt-2 text-center text-xs text-muted-foreground">
                    No account needed.
                  </p>
                </div>
              </div>
            </SpotlightCard>
          </Reveal>

          <Reveal delay={100} distance={24}>
            <SpotlightCard popular className="bg-card/70">
              <div className="relative flex h-full flex-col p-7 sm:p-8">
                <span className="pricing-spark pricing-spark-a" aria-hidden="true">
                  ✦
                </span>
                <span className="pricing-spark pricing-spark-b" aria-hidden="true">
                  ✦
                </span>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-xl font-semibold tracking-tight">Pro</h2>
                    <p className="mt-1 min-h-[2.5rem] text-sm text-muted-foreground">
                      For the months the AI does real work.
                    </p>
                  </div>
                  <PopularNote />
                </div>
                <p className="mt-6 flex items-baseline gap-1.5">
                  <span className="text-4xl font-bold tracking-tight tabular-nums">
                    <CountUp value={PRICING.pro.monthlyCents / 100} prefix="$" />
                  </span>
                  <span className="text-sm text-muted-foreground">per month</span>
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  or {usd(PRICING.pro.yearlyCents)} a year
                  <span className="pricing-save">Save 33%</span>
                </p>
                <ul className="mt-7 space-y-3">
                  <Feature>{PRICING.pro.aiPerMonth} managed AI messages a month</Feature>
                  <Feature>Up to {PRICING.pro.aiPerDay} messages a day</Feature>
                  <Feature>No sponsor cards anywhere</Feature>
                  <Feature>Cancel any time</Feature>
                </ul>
                <div className="mt-auto pt-8">
                  <Magnetic>
                    <Button asChild size="lg" className="pricing-cta w-full rounded-full">
                      <Link to="/account">
                        <Sparkles className="mr-1.5 h-4 w-4" aria-hidden="true" /> Get Pro
                      </Link>
                    </Button>
                  </Magnetic>
                  <p className="mt-2 text-center text-xs text-muted-foreground">
                    Sign in with Google. Prices exclude tax.
                  </p>
                </div>
              </div>
            </SpotlightCard>
          </Reveal>

          <Reveal delay={200} distance={24}>
            <SpotlightCard className="bg-card/60">
              <div className="flex h-full flex-col p-7 sm:p-8">
                <h2 className="text-xl font-semibold tracking-tight">Pay as you go</h2>
                <p className="mt-1 min-h-[2.5rem] text-sm text-muted-foreground">
                  One project, one payment, nothing renews.
                </p>
                <p className="mt-6 flex items-baseline gap-1.5">
                  <span className="text-4xl font-bold tracking-tight tabular-nums">
                    <CountUp value={PRICING.pass.cents / 100} prefix="$" />
                  </span>
                  <span className="text-sm text-muted-foreground">
                    for {PRICING.pass.days} days
                  </span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  or {usd(PRICING.credits.cents)} for{' '}
                  {PRICING.credits.count.toLocaleString('en-US')} AI credits
                </p>
                <ul className="mt-7 space-y-3">
                  <Feature>
                    {PRICING.pass.days} days of Pro for {usd(PRICING.pass.cents)}
                  </Feature>
                  <Feature>
                    {PRICING.credits.count.toLocaleString('en-US')} credits for{' '}
                    {usd(PRICING.credits.cents)}
                  </Feature>
                  <Feature>Credits never expire while the account exists</Feature>
                  <Feature>No subscription, and nothing renews</Feature>
                </ul>
                <div className="mt-auto pt-8">
                  <Button asChild variant="outline" size="lg" className="w-full rounded-full">
                    <Link to="/account">Buy a pass or credits</Link>
                  </Button>
                  <p className="mt-2 text-center text-xs text-muted-foreground">
                    One-time payment.
                  </p>
                </div>
              </div>
            </SpotlightCard>
          </Reveal>
        </section>

        <AiTools />

        <Reveal className="mt-16 sm:mt-20">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Compare plans</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                The same tools on every plan. The differences are the AI allowance and the
                renewals.
              </p>
            </div>
            <p className="text-xs text-muted-foreground">Prices in USD, tax excluded.</p>
          </div>

          <div
            role="region"
            aria-label="Plan comparison, scrollable horizontally"
            tabIndex={0}
            className="mt-5 overflow-x-auto rounded-2xl border border-border/70 bg-card/40"
          >
            <table className="pricing-table min-w-[42rem]">
              <caption className="sr-only">
                Feature comparison for the Free, Pro and pay as you go plans
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="w-[34%] text-xs uppercase tracking-[0.12em] text-muted-foreground">
                    Feature
                  </th>
                  <th scope="col">Free</th>
                  <th scope="col">
                    Pro
                    <span className="mt-1 block text-xs font-normal text-muted-foreground">
                      {usd(PRICING.pro.monthlyCents)} per month
                    </span>
                  </th>
                  <th scope="col">
                    Pay as you go
                    <span className="mt-1 block text-xs font-normal text-muted-foreground">
                      {usd(PRICING.pass.cents)} or {usd(PRICING.credits.cents)}
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {PRICING_COMPARISON.map((row) => (
                  <tr key={row.label} data-stagger>
                    <th scope="row" className="font-normal text-foreground">
                      {row.label}
                    </th>
                    <td>
                      <Cell value={row.free} />
                    </td>
                    <td>
                      <Cell value={row.pro} />
                    </td>
                    <td>
                      <Cell value={row.topup} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground sm:hidden">
            Swipe the table to compare all three plans.
          </p>
        </Reveal>

        <section aria-label="Other ways to pay" className="mt-12 grid gap-4 md:grid-cols-2">
          <Reveal delay={0} distance={20}>
            <div className="h-full rounded-2xl border border-border/70 bg-card/50 p-6">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Included with pay as you go
              </p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight">Credits that never expire</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {PRICING.credits.count.toLocaleString('en-US')} managed AI messages for{' '}
                {usd(PRICING.credits.cents)}, bought once. They are spent only after the monthly Pro
                allowance, and they survive a lapsed plan.
              </p>
              <Button asChild variant="outline" className="mt-5 rounded-full">
                <Link to="/account">Buy credits</Link>
              </Button>
            </div>
          </Reveal>

          <Reveal delay={100} distance={20}>
            <div className="h-full rounded-2xl border border-border/70 bg-card/50 p-6">
              <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                <HeartHandshake className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                Separate from every plan
              </p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight">Donations, no strings</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Any amount, through the same checkout. A donation buys nothing and unlocks nothing.
                It pays for the domain and keeps the tools free for the next person.
              </p>
              <Button asChild variant="outline" className="mt-5 rounded-full">
                <Link to="/sponsor#donate">Donate</Link>
              </Button>
            </div>
          </Reveal>
        </section>

        <Reveal className="mt-12">
          <div className="flex flex-col gap-4 rounded-2xl border border-border/70 bg-card/40 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-3">
              <Megaphone className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <h2 className="text-base font-semibold">Sponsor the site instead</h2>
                <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                  Two first party slots, {usd(PRICING.sponsor.featuredCents)} and{' '}
                  {usd(PRICING.sponsor.standardCents)} a month. No ad network, no script, and Pro
                  accounts never see a card.
                </p>
              </div>
            </div>
            <Button asChild variant="outline" className="shrink-0 rounded-full">
              <Link to="/sponsor">See the slots</Link>
            </Button>
          </div>
        </Reveal>

        <section aria-labelledby="faq-heading" className="mt-16">
          <Reveal>
            <h2 id="faq-heading" className="text-xl font-semibold tracking-tight">
              Questions
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              The short answers. Anything else goes to the contact page.
            </p>
          </Reveal>
          <div className="mt-5">
            <PricingFaqList items={PRICING_FAQ} />
          </div>
        </section>

        <p className="mt-10 max-w-3xl text-xs leading-relaxed text-muted-foreground">
          Prices are in US dollars and exclude tax. Dodo Payments is the merchant of record. It
          takes the card, adds the tax for your billing country at checkout, and issues the
          receipt. Every plan can be cancelled from that receipt, and the PDF tools stay free
          either way.
        </p>
      </div>
    </div>
  );
}
