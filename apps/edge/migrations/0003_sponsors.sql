-- Sponsorship and the one-time rails that sit beside the subscription.
--
-- There is no ad network here. A sponsor buys a named slot, uploads a logo, and
-- gets first-party markup that the site renders itself: no script, no pixel, no
-- iframe. That is why the Content-Security-Policy does not change when this
-- feature is on.
--
-- `status` is the whole lifecycle:
--
--   draft     — checkout started, money not confirmed
--   active    — paid and live; `ends_at` is the paid-through date
--   cancelled — will not renew, but stays live until `ends_at`
--   expired   — `ends_at` has passed; hidden everywhere
--
-- A slot can have at most one live row. The partial index enforces that at the
-- database, not only in a route handler where a race could slip through.

CREATE TABLE sponsors (
  id                   TEXT    PRIMARY KEY,
  slot                 TEXT    NOT NULL,
  status               TEXT    NOT NULL,
  name                 TEXT    NOT NULL,
  url                  TEXT    NOT NULL,
  blurb                TEXT    NOT NULL,
  email                TEXT    NOT NULL,
  brand_color          TEXT,
  logo_bytes           BLOB,
  logo_type            TEXT,
  created_at           INTEGER NOT NULL,
  starts_at            INTEGER,
  ends_at              INTEGER,
  dodo_subscription_id TEXT,
  dodo_payment_id      TEXT
);

CREATE INDEX sponsors_slot ON sponsors(slot, status);
CREATE UNIQUE INDEX sponsors_live_slot
  ON sponsors(slot)
  WHERE status IN ('active', 'cancelled');
CREATE UNIQUE INDEX sponsors_subscription
  ON sponsors(dodo_subscription_id)
  WHERE dodo_subscription_id IS NOT NULL;

-- Webhook replay protection. Standard Webhooks retries, and a retried
-- `payment.succeeded` must not grant the same credit pack twice.
CREATE TABLE billing_events (
  id         TEXT    PRIMARY KEY,
  type       TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX billing_events_age ON billing_events(created_at);

-- A 30-day pass and a monthly subscription both mean `plan = 'pro'`; the
-- difference is only when access ends. `NULL` means "no end date", which is what
-- a manually granted account keeps.
ALTER TABLE accounts ADD COLUMN plan_expires_at INTEGER;

-- One-time AI credit packs. Drained only after the monthly allowance is gone,
-- so a pack never replaces the subscription's included messages.
ALTER TABLE accounts ADD COLUMN credit_messages INTEGER NOT NULL DEFAULT 0;
