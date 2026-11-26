-- D1 schema for the free deployment shape.
--
-- Replaces the MongoDB collections used by apps/api (auth/mongo.ts). Two things
-- changed shape on the way over:
--
--   1. TTL indexes have no equivalent. Expiry is enforced in every query
--      (`expires_at > ?`) and swept hourly by the Worker's cron trigger, so a
--      stale row can never act as a live credential even before the sweep.
--   2. History and workflows were arrays/subdocuments; here every row belongs to
--      exactly one account and carries its own timestamp.
--
-- Timestamps are epoch milliseconds (INTEGER), not text, so ordering is a
-- numeric comparison and no timezone can creep in.

CREATE TABLE accounts (
  id             TEXT    PRIMARY KEY,
  google_sub     TEXT    NOT NULL UNIQUE,
  email          TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  name           TEXT,
  picture        TEXT,
  created_at     INTEGER NOT NULL,
  last_login_at  INTEGER NOT NULL
);

-- The row is keyed by the SHA-256 of the cookie value, never the value itself:
-- a database dump cannot be replayed as a set of live sessions.
CREATE TABLE sessions (
  token_hash TEXT    PRIMARY KEY,
  account_id TEXT    NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX sessions_account ON sessions(account_id);
CREATE INDEX sessions_expiry  ON sessions(expires_at);

-- `state` is the primary key, and the callback reads it with DELETE ... RETURNING,
-- which is what makes a replayed state a miss rather than a second login.
CREATE TABLE auth_transactions (
  state         TEXT    PRIMARY KEY,
  code_verifier TEXT    NOT NULL,
  nonce         TEXT    NOT NULL,
  return_to     TEXT    NOT NULL,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL
);

CREATE TABLE preferences (
  account_id TEXT    PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  updated_at INTEGER NOT NULL,
  -- JSON object. Keys are validated to /^[A-Za-z0-9_-]{1,64}$/ at the route.
  data       TEXT    NOT NULL DEFAULT '{}'
);

CREATE TABLE history (
  id         TEXT    PRIMARY KEY,
  account_id TEXT    NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  tool_slug  TEXT    NOT NULL,
  tool_name  TEXT    NOT NULL,
  file_name  TEXT    NOT NULL,
  page_count INTEGER,
  size_bytes INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX history_account ON history(account_id, created_at DESC);

CREATE TABLE workflows (
  id         TEXT    PRIMARY KEY,
  account_id TEXT    NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  steps      TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX workflows_account ON workflows(account_id, updated_at DESC);

-- Replaces Redis counters. One row per (subject, window); `expires_at` is the
-- window boundary, and the increment is a single atomic upsert.
CREATE TABLE quota_counters (
  key        TEXT    PRIMARY KEY,
  count      INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX quota_expiry ON quota_counters(expires_at);
