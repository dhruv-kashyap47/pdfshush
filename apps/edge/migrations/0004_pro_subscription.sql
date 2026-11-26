-- The recurring Pro rail.
--
-- `plan_expires_at` already carries the term for every paid grant: a 30-day pass,
-- a manual grant (NULL, no end) and now a Dodo subscription all write the same
-- column, and `downgradeLapsed` is the only thing that flips it back. What a
-- subscription needs in addition is its own identity: `subscription.renewed`
-- carries the Dodo subscription id and nothing that reliably names the account,
-- so the id has to be stored when the subscription is activated.
--
-- One subscription per account: a second purchase must update the row, not
-- accumulate a second term. The partial unique index enforces that in the
-- database rather than only in the webhook handler.
ALTER TABLE accounts ADD COLUMN dodo_subscription_id TEXT;

CREATE UNIQUE INDEX accounts_subscription
  ON accounts(dodo_subscription_id)
  WHERE dodo_subscription_id IS NOT NULL;
