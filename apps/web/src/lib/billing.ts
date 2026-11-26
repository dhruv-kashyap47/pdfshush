/**
 * The account page's four purchases, in one place so the button label and the
 * request it sends cannot drift apart. Kept out of the component because the
 * interval is the part that is easy to get wrong: sending `month` to the yearly
 * product would still take money and grant the wrong term.
 */

export type PurchaseKind = 'credits' | 'pass' | 'pro-monthly' | 'pro-yearly';

export interface PurchaseRequest {
  path: string;
  body?: { interval: 'month' | 'year' };
}

export function purchaseRequest(kind: PurchaseKind): PurchaseRequest {
  switch (kind) {
    case 'credits':
      return { path: '/api/billing/credits' };
    case 'pass':
      return { path: '/api/billing/pass' };
    case 'pro-monthly':
      return { path: '/api/billing/pro', body: { interval: 'month' } };
    case 'pro-yearly':
      return { path: '/api/billing/pro', body: { interval: 'year' } };
  }
}
