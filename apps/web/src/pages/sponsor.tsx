/**
 * The sponsorship page.
 *
 * Two things are sold here, and neither of them is an ad impression: a named
 * card in fixed first-party markup, and a donation with no strings at all. The
 * page states the price and the traffic honestly — a founding rate is cheap
 * because the site is early, not because the placement is worth more than it is.
 *
 * Checkout is Dodo's hosted page. When billing is not configured, the page
 * degrades to an email address instead of a button that lands on a 503.
 */

import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowUpRight, Check, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, ApiError } from '@/lib/api';
import { SPONSOR_FAQ } from '@/content/sponsor';
import { usePageHead } from '@/seo/head';
import { breadcrumbSchema, faqPageSchema, webPageSchema } from '@/seo/schema';
import { SITE_ORIGIN } from '@/seo/site';
import { CONTACT_EMAIL } from '@/lib/site-info';
import {
  useSponsorInventory,
  type SponsorSlotDef,
  type SponsorSlotView,
} from '@/lib/sponsors';
import { cn } from '@/lib/utils';

const TITLE = 'Sponsor pdfshush — Two Slots, No Ad Network | PDFShush';
const DESCRIPTION =
  'Put your product in front of people who care about document privacy. Two first-party sponsor slots, no scripts and no tracking. Founding rates from $19/month.';

const FALLBACK_SLOTS: SponsorSlotDef[] = [
  {
    id: 'featured',
    label: 'Featured',
    priceCents: 3900,
    currency: 'USD',
    placement: 'The home page, under the tool grid',
    summary:
      'A single card with your logo, name, one line and a link, at the foot of the busiest page on the site.',
  },
  {
    id: 'standard',
    label: 'Standard',
    priceCents: 1900,
    currency: 'USD',
    placement: 'The guides index and the end of every guide',
    summary:
      'The same card on the pages people reach from search, which is where the site earns its traffic.',
  },
];

const DONATION_AMOUNTS = [300, 1000, 2500] as const;

function formatUsd(cents: number): string {
  return `$${Math.round(cents / 100)}`;
}

const PRESET_AMOUNTS: readonly number[] = DONATION_AMOUNTS;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

function SlotCard({
  view,
  selected,
  onSelect,
}: {
  view: SponsorSlotView;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      className={cn(
        'flex flex-col rounded-2xl border p-6 transition-colors',
        selected ? 'border-primary bg-primary/5' : 'border-border/70 bg-card',
        !view.available && 'opacity-60',
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-lg font-semibold">{view.slot.label}</h3>
        <p className="text-2xl font-bold tracking-tight">
          {formatUsd(view.slot.priceCents)}
          <span className="text-sm font-normal text-muted-foreground">/mo</span>
        </p>
      </div>
      <p className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">
        {view.slot.summary}
      </p>
      <p className="mt-4 text-xs text-muted-foreground">{view.slot.placement}</p>
      <p className="mt-1 text-xs font-medium">
        {view.available ? (
          <span className="text-primary">Open</span>
        ) : (
          <span className="text-muted-foreground">Taken — join the waitlist</span>
        )}
      </p>
      <Button
        type="button"
        variant={selected ? 'default' : 'outline'}
        className="mt-5"
        disabled={!view.available}
        onClick={onSelect}
      >
        {view.available ? (selected ? 'Selected' : 'Choose this slot') : 'Unavailable'}
      </Button>
    </div>
  );
}

export function SponsorPage() {
  const [params] = useSearchParams();
  const { inventory, loading } = useSponsorInventory();
  const status = params.get('status');

  // Footer links and Dodo return URLs land on `#donate`. The router leaves hash
  // targets to the page that owns them, so this page owns this one.
  useEffect(() => {
    const id = window.location.hash.replace(/^#/, '');
    if (!id) return;
    const timer = window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const slots: SponsorSlotView[] = useMemo(() => {
    if (inventory) return inventory.slots;
    return FALLBACK_SLOTS.map((slot) => ({ slot, available: true, sponsor: null }));
  }, [inventory]);

  const [selected, setSelected] = useState<'featured' | 'standard'>('featured');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [blurb, setBlurb] = useState('');
  const [email, setEmail] = useState('');
  const [brandColor, setBrandColor] = useState('#2f9e6a');
  const [logo, setLogo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [donation, setDonation] = useState<number>(1000);
  const [donorEmail, setDonorEmail] = useState('');
  const [donating, setDonating] = useState(false);

  const billingEnabled = inventory?.billing.enabled ?? false;
  const chosen = slots.find((entry) => entry.slot.id === selected) ?? slots[0]!;

  // If the default (or a stale) choice is taken, move to the open slot instead
  // of showing a disabled button for a slot nobody can buy.
  useEffect(() => {
    if (!inventory) return;
    const current = inventory.slots.find((entry) => entry.slot.id === selected);
    if (current?.available) return;
    const open = inventory.slots.find((entry) => entry.available);
    if (open) setSelected(open.slot.id);
  }, [inventory, selected]);

  usePageHead({
    title: TITLE,
    description: DESCRIPTION,
    route: '/sponsor',
    keywords: ['sponsor pdfshush', 'pdf tool sponsorship', 'privacy friendly sponsorship'],
    jsonLd: [
      webPageSchema({ name: TITLE, description: DESCRIPTION, route: '/sponsor' }, SITE_ORIGIN),
      breadcrumbSchema(
        [
          { name: 'Home', route: '/' },
          { name: 'Sponsor', route: '/sponsor' },
        ],
        SITE_ORIGIN,
      ),
      faqPageSchema(
        SPONSOR_FAQ.map((entry) => ({ question: entry.q, answer: entry.a })),
        SITE_ORIGIN,
        '/sponsor',
      ),
    ],
  });

  async function onLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 64 * 1024) {
      toast.error('Logo must be 64 KB or smaller.');
      event.target.value = '';
      return;
    }
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(file.type)) {
      toast.error('Logo must be PNG, JPG, WebP or SVG.');
      event.target.value = '';
      return;
    }
    setLogo(await readFileAsDataUrl(file));
  }

  async function reserve(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const result = await api<{ url: string }>('/api/sponsors/checkout', {
        method: 'POST',
        body: { slot: selected, name, url, blurb, email, brandColor, logo },
      });
      if (!result?.url) throw new Error('The checkout did not return a link.');
      window.location.assign(result.url);
    } catch (error) {
      const message =
        error instanceof ApiError && error.code === 'slot_taken'
          ? 'Someone reserved that slot first. Pick the other one, or email us for the waitlist.'
          : error instanceof Error
            ? error.message
            : 'Could not start checkout.';
      toast.error(message);
      setBusy(false);
    }
  }

  async function donate(event: FormEvent) {
    event.preventDefault();
    if (donating) return;
    setDonating(true);
    try {
      const result = await api<{ url: string }>('/api/billing/donate', {
        method: 'POST',
        body: { amountCents: donation, email: donorEmail },
      });
      if (!result?.url) throw new Error('The checkout did not return a link.');
      window.location.assign(result.url);
    } catch (error) {
      const message =
        error instanceof ApiError && error.code === 'billing_disabled'
          ? 'Donations open shortly. Thank you for the thought.'
          : error instanceof Error
            ? error.message
            : 'Could not start checkout.';
      toast.error(message);
      setDonating(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6 lg:px-8">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
        Sponsorship
      </p>
      <h1 className="mt-2 max-w-3xl text-3xl font-bold tracking-tight sm:text-4xl">
        Put your product in front of people who care where their files go.
      </h1>
      <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
        pdfshush is free because its readers fund it. There is no ad network, no
        third-party script and no tracking — a sponsor buys a named card that this site renders
        itself.
      </p>

      {status === 'success' ? (
        <p className="mt-6 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
          Payment received. The card goes live as soon as Dodo’s webhook lands, usually within a
          minute.
        </p>
      ) : null}
      {status === 'cancelled' ? (
        <p className="mt-6 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          Checkout cancelled. Nothing was charged.
        </p>
      ) : null}
      {status === 'thanks' ? (
        <p className="mt-6 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
          Thank you. That genuinely helps keep the tools free.
        </p>
      ) : null}

      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        {[
          {
            icon: ShieldCheck,
            title: 'No script, ever',
            body: 'The card is HTML. Your logo is served from pdfshush.com, so the strict Content-Security-Policy never changes.',
          },
          {
            icon: Check,
            title: 'Pro never sees it',
            body: 'A paid account renders no sponsor card. You buy reach among free visitors, which is almost everyone.',
          },
          {
            icon: ArrowUpRight,
            title: 'One line, one link',
            body: 'Logo, name, up to 60 characters and a link with rel="sponsored". No video, no pop-up, no interstitial.',
          },
        ].map((item) => (
          <div key={item.title} className="rounded-xl border border-border/60 p-5">
            <item.icon className="h-5 w-5 text-primary" aria-hidden="true" />
            <p className="mt-3 text-sm font-semibold">{item.title}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
          </div>
        ))}
      </div>

      <section id="slots" className="mt-14 scroll-mt-20">
        <h2 className="text-xl font-semibold tracking-tight">Two slots, founding rates</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          These prices are deliberately low while the site is early, and locked for twelve months
          for the first sponsors. They rise when the traffic does — not before.
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {slots.map((view) => (
            <SlotCard
              key={view.slot.id}
              view={view}
              selected={selected === view.slot.id}
              onSelect={() => setSelected(view.slot.id)}
            />
          ))}
        </div>
        {loading ? (
          <p className="mt-3 text-xs text-muted-foreground">Checking availability…</p>
        ) : null}
      </section>

      <section id="reserve" className="mt-14 scroll-mt-20">
        <h2 className="text-xl font-semibold tracking-tight">Reserve a slot</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Pay by card through Dodo, our merchant of record. The card goes live the same day and
          renews monthly until you cancel.
        </p>

        {!billingEnabled ? (
          <div className="mt-6 rounded-xl border border-border/70 bg-muted/30 p-5 text-sm">
            <p className="font-medium">Checkout is not switched on yet.</p>
            <p className="mt-1 text-muted-foreground">
              Email{' '}
              <a className="underline underline-offset-4" href={`mailto:${CONTACT_EMAIL}`}>
                {CONTACT_EMAIL}
              </a>{' '}
              with the slot you want and we will reserve it manually.
            </p>
          </div>
        ) : (
          <form onSubmit={reserve} className="mt-6 grid gap-5 rounded-2xl border border-border/70 p-6">
            <div className="grid gap-1.5">
              <Label htmlFor="sponsor-name">Name to show</Label>
              <Input
                id="sponsor-name"
                required
                maxLength={40}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Your product"
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="sponsor-url">Link</Label>
              <Input
                id="sponsor-url"
                required
                type="url"
                inputMode="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com"
              />
            </div>

            <div className="grid gap-1.5">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="sponsor-blurb">What it does</Label>
                <span className="text-xs tabular-nums text-muted-foreground">{blurb.length}/60</span>
              </div>
              <Input
                id="sponsor-blurb"
                required
                maxLength={60}
                value={blurb}
                onChange={(event) => setBlurb(event.target.value)}
                placeholder="Private PDF tools that never upload"
              />
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="sponsor-email">Email (for the receipt)</Label>
                <Input
                  id="sponsor-email"
                  required
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="sponsor-color">Brand colour</Label>
                <input
                  id="sponsor-color"
                  type="color"
                  value={brandColor}
                  onChange={(event) => setBrandColor(event.target.value)}
                  className="h-9 w-full cursor-pointer rounded-md border border-input bg-transparent p-1"
                />
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="sponsor-logo">Logo</Label>
              <input
                id="sponsor-logo"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                onChange={onLogo}
                className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm file:font-medium file:text-foreground"
              />
              <p className="text-xs text-muted-foreground">
                PNG, JPG, WebP or SVG · 64 KB max · a square logo looks best
              </p>
              {logo ? (
                <div className="mt-2 flex items-center gap-3 rounded-lg border border-border/60 p-3">
                  <img src={logo} alt="Logo preview" className="h-9 w-9 rounded-lg object-contain" />
                  <div className="min-w-0 text-sm">
                    <p className="truncate font-medium">{name || 'Your product'}</p>
                    <p className="truncate text-muted-foreground">
                      {blurb || 'What it does, in a few words'}
                    </p>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-5">
              <p className="text-sm text-muted-foreground">
                {chosen.slot.label} · {formatUsd(chosen.slot.priceCents)}/month
              </p>
              <Button type="submit" disabled={busy || !chosen.available}>
                {busy
                  ? 'Opening checkout…'
                  : `Continue to payment — ${formatUsd(chosen.slot.priceCents)}/month`}
              </Button>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Payment is handled by Dodo Payments. No card details reach pdfshush. Questions?{' '}
              <a className="underline underline-offset-4" href={`mailto:${CONTACT_EMAIL}`}>
                {CONTACT_EMAIL}
              </a>
              .
            </p>
          </form>
        )}
      </section>

      <section id="donate" className="mt-14 scroll-mt-20">
        <h2 className="text-xl font-semibold tracking-tight">Or just buy us a coffee</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          A donation buys nothing and changes nothing in the product. It pays for the domain and
          the occasional afternoon.
        </p>

        <form
          onSubmit={donate}
          className="mt-6 grid gap-4 rounded-2xl border border-border/70 p-6 sm:max-w-xl"
        >
          <div className="flex flex-wrap gap-2">
            {DONATION_AMOUNTS.map((amount) => (
              <Button
                key={amount}
                type="button"
                variant={donation === amount ? 'default' : 'outline'}
                onClick={() => setDonation(amount)}
              >
                {formatUsd(amount)}
              </Button>
            ))}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">$</span>
              <Input
                aria-label="Custom amount in dollars"
                type="number"
                min={1}
                max={500}
                placeholder="Custom"
                value={PRESET_AMOUNTS.includes(donation) ? '' : Math.round(donation / 100)}
                onChange={(event) => {
                  const dollars = Number(event.target.value);
                  setDonation(
                    Number.isFinite(dollars) && dollars > 0
                      ? Math.min(50_000, Math.max(100, Math.round(dollars * 100)))
                      : 100,
                  );
                }}
                className="w-24"
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="donor-email">Email (for the receipt)</Label>
            <Input
              id="donor-email"
              required
              type="email"
              value={donorEmail}
              onChange={(event) => setDonorEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">No account needed.</p>
            <Button type="submit" disabled={donating}>
              {donating ? 'Opening checkout…' : `Donate ${formatUsd(donation)}`}
            </Button>
          </div>
        </form>
      </section>

      <section className="mt-14">
        <h2 className="text-xl font-semibold tracking-tight">Questions</h2>
        <dl className="mt-6 space-y-6">
          {SPONSOR_FAQ.map((entry) => (
            <div key={entry.q}>
              <dt className="text-sm font-semibold">{entry.q}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{entry.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <p className="mt-12 text-sm text-muted-foreground">
        Prefer to support the project another way?{' '}
        <Link to="/about" className="underline underline-offset-4">
          Read what it costs to run
        </Link>
        , or simply tell one person who handles PDFs all day.
      </p>
    </div>
  );
}
