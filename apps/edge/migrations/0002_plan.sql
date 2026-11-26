-- Entitlements.
--
-- `plan` is what the SPA reads to decide two things: whether to show ads, and
-- which AI allowance applies. It defaults to 'free', so every existing row and
-- every new sign-in behaves exactly as before until a payment flips it.
--
-- Deliberately a plain text column rather than a boolean: 'free' | 'pro' leaves
-- room for a future tier without another migration, and a CHECK constraint would
-- turn a typo in a webhook into a failed insert.
ALTER TABLE accounts ADD COLUMN plan TEXT NOT NULL DEFAULT 'free';
