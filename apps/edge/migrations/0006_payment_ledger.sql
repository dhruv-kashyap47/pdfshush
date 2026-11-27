-- What each successful payment granted, so a refund or a dispute can take it
-- back exactly once, and a delayed payment event cannot grant after a refund.
--
-- `billing_events` already de-duplicates a webhook by message id. This table is
-- the second lock, keyed by the payment itself: Dodo can deliver the same
-- payment under a different message id, and a refund can arrive before the
-- payment event. Neither may grant twice or leave access behind.
--
-- The entitlement columns are what the payment actually gave:
--   credits             messages added (the clamped amount, not the request)
--   previous_expires_at the term before this payment, restored on a refund
--   granted_until       the paid-through date this payment produced
--
-- `refunded_at`, `revoked_at` and `restored_at` are a small audit trail; the
-- live entitlement stays in `accounts` and `sponsors`.

CREATE TABLE billing_payments (
  payment_id          TEXT    PRIMARY KEY,
  account_id          TEXT,
  customer_id         TEXT,
  kind                TEXT    NOT NULL,
  product_id          TEXT,
  subscription_id     TEXT,
  sponsor_id          TEXT,
  credits             INTEGER NOT NULL DEFAULT 0,
  previous_expires_at INTEGER,
  granted_until       INTEGER,
  amount              INTEGER,
  currency            TEXT,
  created_at          INTEGER NOT NULL,
  granted_at          INTEGER,
  refunded_at         INTEGER,
  revoked_at          INTEGER,
  restored_at         INTEGER,
  revoke_reason       TEXT
);

CREATE INDEX billing_payments_account ON billing_payments(account_id);
CREATE INDEX billing_payments_customer ON billing_payments(customer_id);
CREATE INDEX billing_payments_subscription ON billing_payments(subscription_id);
