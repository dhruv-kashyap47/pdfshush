# SHARE — design specification (no implementation)

Status: **deferred**. SHARE is not implemented in `apps/` or `packages/`; this
document is the decision record for building it, written by session 5 of the
PDF audit (`pdf/s5-share`). No code accompanies it.

The session was scoped to audit and fix sharing. The audit found no sharing
surface to audit (`FINDINGS.md`, `PDF-SHARE-000`), so the same security
questions were applied to the only second-party capability that does exist —
the per-job `jobId` + `x-job-token` granted at creation — and this spec records
what a real share feature would have to guarantee. Where the two overlap, the
spec reuses the properties the existing capability already satisfies.

Read with `ARCHITECTURE-PDF.md` §5 (what exists today) and `FINDINGS.md`
(`PDF-SHARE-001`…`003`).

---

## 1. What exists today, and why it is not a share link

`POST /api/jobs` returns an opaque job id and a token
(`apps/api/src/http/app.ts:367-372`); every read must present the token in the
`x-job-token` header (`app.ts:507-511`). The token is
`SHA-256(pepper ‖ jobId)` (`apps/api/src/context.ts:98`), compared with
`timingSafeEqual` (`quota/quota.ts:44`).

| Property | Job capability | A share link needs |
| --- | --- | --- |
| Sendable to a second party | No — a header, not a URL | Yes, a URL |
| Token source | Derived from the server pepper | CSPRNG per share |
| Revocable | Only by deleting the whole job (and a finished job refuses DELETE — `PDF-SHARE-002`) | Immediately, per link |
| Lifetime | The work-directory TTL (1 h) | Owner-chosen, independent |
| Permissions | Full owner access | view / download |
| Extra protection | None | Optional password |
| Audit trail | None | Access counts, never tokens |

The job capability is therefore **not** the share feature, and it must not be
widened into one: a header capability cannot be pasted into a chat, and a
derived token can never be rotated.

---

## 2. Link format

```
https://<origin>/s/<token>
```

- `<token>` is exactly **32 CSPRNG bytes** (`crypto.randomBytes(32)`),
  **base64url**, unpadded: 43 characters from `[A-Za-z0-9_-]`.
- The path carries **no** job id, file name, owner or permission hint. A link
  must not reveal what it points at to anyone who sees the URL (or a proxy log).
- No query string, ever: not for the password, not for a download flag, not for
  analytics parameters.
- One canonical form. `…/s/<token>/`, `…/s/<token>?x=1` and any other spelling
  either 404 or 301 to the canonical path — never a second working URL, so a
  leaked variant cannot outlive revocation of the canonical one.

Server-side, the token is never stored. The record key is
`sha256(token)` (lower-case hex, 64 chars). A 256-bit random value needs no salt
and no KDF; hashing is what makes a Redis dump non-replayable.

---

## 3. Permissions

Two permissions, both enforced on the server for **every** request:

| Permission | Effect |
| --- | --- |
| `view` | `GET /s/<token>` returns the viewer page and `GET /s/<token>/file` serves the bytes inline (`Content-Disposition: inline`). |
| `download` | Adds `Content-Disposition: attachment` when the request asks for a download (`/s/<token>/file?download=1`, or always, per decision D2). |

Rules:

- `download` implies `view`; `view` alone must still serve the bytes to the
  browser's PDF viewer. **`view` is not copy protection** — any viewer that can
  display the file has the bytes. The UI must say "can be displayed" rather than
  "cannot be downloaded". This is a product-honesty requirement, not a limit of
  this design.
- A token without `download` that receives `?download=1` gets **403**, not a
  silent inline response.
- No `edit` permission in this version (decision D3).

---

## 4. Storage schema

Redis is already the stack's state store (`apps/api/src/jobs/redis.ts`), holds
no document bytes by design, and has a TTL primitive. The schema is versioned
so a later change can migrate without breaking issued links.

### 4.1 Share record

Key: `share:v1:<sha256(token) hex>` — a Redis hash.

| Field | Type | Meaning |
| --- | --- | --- |
| `v` | `1` | Schema version. Unknown versions are refused as 404. |
| `shareId` | 32 hex | Non-secret id used by the owner to list/revoke. Never accepted as a capability. |
| `jobId` | string | Originating job (`safeJobId` form). |
| `file` | string | Sanitised basename (`safeFileName`) of the shared result. |
| `perms` | string | Comma set: `view`, `view,download`. Parsed as a closed allowlist. |
| `createdAt` | ms epoch | Mint time. |
| `expiresAt` | ms epoch | Hard expiry, checked on every request. |
| `revokedAt` | ms epoch, optional | Presence means "deny everything". |
| `pwd` | string, optional | `scrypt$N=16384,r=8,p=1$<salt b64url>$<key b64url>`. |
| `sourceSha256` | hex | Hash of the bytes copied at mint time. |
| `sourceBytes` | integer | Copied size, for `Content-Length` and range validation. |
| `views` | integer | Viewer-page hits. |
| `downloads` | integer | File transfers (not bytes). |
| `owner` | 32 hex | Hashed subject (`subjectId`), never an account id or IP. |
| `lastAt` | ms epoch | Last access, for abuse review. Never an IP. |

Key TTL is set to `expiresAt − now + 24 h`, so Redis itself reclaims the record
even if the sweeper stops. Correctness never depends on the TTL: `expiresAt` and
`revokedAt` are checked on every read.

### 4.2 Indexes (non-secret)

- `sharejob:v1:<jobId>` — set of `shareId`s, so "revoke every link for this
  document" is one read.
- `sharesub:v1:<owner hash>` — sorted set of `shareId` scored by `expiresAt`,
  so "my links" does not scan the keyspace.

Both entries are removed when the share is revoked or expires. `shareId` →
`sha256(token)` mapping lives in `shareid:v1:<shareId>` (string), which is what
the owner routes use; it is never reachable without the job capability.

### 4.3 Bytes

A job's work directory is deleted one hour after the job finishes
(`apps/api/src/limits.ts:50`, `files/janitor.ts`). A share that may live longer
needs its own copy:

```
<shareRoot>/<sha256(token) first 2 chars>/<sha256(token)>.bin
```

- Written at mint time from the job's result, through the existing
  `WorkDirStore`-style `resolveWithin` boundary, with the same atomic
  temp-file-and-rename used by `writeResult` (`files/store.ts:99-118`).
- `sourceSha256`/`sourceBytes` are recorded; a missing, truncated or
  hash-mismatched copy is a **404**, never a partial response.
- The share sweeper deletes records and bytes together; there is no path that
  deletes one without the other except a crash, which the sweeper reconciles on
  the next pass (orphan bytes with no record are removed after a grace period).

Decision D1 covers whether this copy is acceptable, or whether sharing should
instead pin the job directory open.

---

## 5. API routes

### 5.1 Owner routes (existing job capability, no new auth model)

All require `x-job-token` for the job in the path; the token is verified with the
existing `authorize` helper. A share can only be minted from a **completed**
job's **listed** result.

| Method | Path | Body / query | Answers |
| --- | --- | --- | --- |
| `POST` | `/api/jobs/:id/shares` | `{ file, permissions: { download: boolean }, expiresInSeconds, password? }` | `201 { shareId, url, expiresAt }` |
| `GET` | `/api/jobs/:id/shares` | — | `200 { shares: [{ shareId, file, permissions, createdAt, expiresAt, revoked, views, downloads }] }` — never a token or URL |
| `DELETE` | `/api/jobs/:id/shares/:shareId` | — | `204`; immediate |

Validation:

- `file` must be in the job's completed result list (exact string match).
- `expiresInSeconds` bounded by policy (decision D4).
- `password` bounded length; hashed with scrypt before the record is written.
- Max shares per job (decision D1).
- Minting copies the bytes **before** writing the record, so a link is never
  issued for bytes that are not durably there.

### 5.2 Public routes

| Method | Path | Answers |
| --- | --- | --- |
| `GET` | `/s/:token` | `200` viewer HTML; `404` unknown/revoked/expired; `401` when a password is set and no valid unlock cookie is present |
| `POST` | `/s/:token/unlock` | `204` + `Set-Cookie` on success; `401` wrong password; `429` rate-limited; `404` unknown/revoked/expired |
| `GET` | `/s/:token/file` | `200`/`206` bytes; `416` unsatisfiable range; `401` password gate; `403` permission missing; `404` unknown/revoked/expired |

Status-code policy (decision D5):

- Unknown, expired and revoked are **all 404** with an identical body. A 410
  would confirm that a link once existed; a scanner must not be able to tell a
  guessed token from a dead one.
- Password-required is **401** with a `WWW-Authenticate`-free JSON/HTML body
  that only says a password is needed.
- A wrong password is **401** with the same body shape and no timing signal
  (scrypt + `timingSafeEqual`).

### 5.3 Response headers on every public response

| Header | Value | Why |
| --- | --- | --- |
| `Referrer-Policy` | `no-referrer` | The token is in the path; any outbound request from the viewer page would otherwise carry it. |
| `Cache-Control` | `private, no-store` | Revocation and expiry must not be bypassable by a cached copy (the defect fixed as `PDF-SHARE-001` on the job surface). |
| `Vary` | `x-share-unlock` | Second line of defence for caches that ignore `no-store`. |
| `X-Robots-Tag` | `noindex, nofollow, noarchive` | Links are unlisted, not public. |
| `X-Content-Type-Options` | `nosniff` | A `.json`/PDF result must never be sniffed as HTML. |
| `Content-Security-Policy` | `default-src 'none'; img-src 'self'; style-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'` | The viewer renders untrusted documents; it must not be a scripting surface. |
| `Content-Disposition` | `inline` or `attachment` from the permission + request | The `filename` is `safeFileName`-sanitised at the header, never trusted from the record. |
| `Content-Type` | closed allowlist (`contentTypeFor`) | No `text/html` ever. |
| `Accept-Ranges` | `bytes` | Large files must resume. |

**Ranges.** `GET /s/:token/file` implements a single range:

- `Range: bytes=a-b` → `206`, `Content-Range: bytes a-b/<size>`, `Content-Length: b-a+1`.
- `bytes=a-` and `bytes=-n` are supported.
- Unsatisfiable (`a ≥ size`) → `416` + `Content-Range: bytes */<size>`.
- Multiple ranges → serve the whole file (`200`); do not emit multipart.
- A range request is authorised exactly like a full one: no permission, password
  or revocation check is skipped because the read is partial.
- `HEAD` mirrors `GET` headers with no body.

### 5.4 CORS

No `Access-Control-Allow-Origin` on any `/s/*` response. The viewer is
same-origin. If a future embed needs cross-origin reads, it gets an explicit
allowlist, never `*`, and never with `Allow-Credentials`.

---

## 6. Password protection

- Hashing: `scrypt` with `N=16384, r=8, p=1`, 16-byte random salt, 32-byte key,
  parameters stored inline so they can be raised without invalidating links.
- Comparison: `crypto.timingSafeEqual` over equal-length buffers.
- Unlock: `POST /s/:token/unlock` sets an `HttpOnly; Secure; SameSite=Lax`
  cookie scoped to `Path=/s/<token>`, containing
  `HMAC-SHA256(pepper, shareHash ‖ expiresAt)` — not the password, not a
  session. It is bound to one share, so replaying it against another token
  fails. Lifetime is the shorter of 30 minutes and the share's remaining TTL.
- The file route checks the cookie **itself**. There is no path to the bytes
  that skips the password gate: no direct work-directory URL, no job route, no
  range endpoint.
- Rate limiting: per share and per hashed client subject, both counted in
  Redis. Suggested: 5 attempts/minute and 50/day per share, 20/minute per
  client. On a counter outage the unlock route **fails closed** (503) — unlike
  quota, this is an authentication decision.
- The password never appears in a URL, a log line, a response body or an error
  message.

---

## 7. Threat model

Assets: document bytes, the password, the fact that a share exists, the owner's
identity and other jobs.

| # | Threat | Mitigation | Residual |
| --- | --- | --- | --- |
| T1 | Token guessing | 256-bit CSPRNG token; uniform 404; per-IP rate limit on `/s/*` | None at this entropy |
| T2 | Token leak via `Referer` | `no-referrer`; token only in the path; no third-party resources in the viewer; no query params | A user pasting the link into a site that stores URLs (chat, issue tracker) |
| T3 | Token in logs | Never log the path or token; log `shareId` only; pino redaction for `token`/`cookie` | Reverse proxies outside our control — document "do not log `/s/`" in deployment notes |
| T4 | Password brute force | scrypt; per-share + per-client limits; fail closed | Offline attack if Redis leaks — scrypt cost only |
| T5 | Password bypass via direct file URL | Cookie gate on `/s/:token/file`; no alternate byte route; share bytes outside the job tree | None |
| T6 | IDOR across shares/jobs | Public route derives jobId/file from the record; owner routes require the job token + a `shareId` that belongs to that job | None |
| T7 | Path traversal | File name fixed at mint from the job's sanitised output list, re-sanitised at the header, `resolveWithin` for both record and bytes | None |
| T8 | Expiry/revocation bypass via cache | `no-store`, `Vary`, per-request `expiresAt`/`revokedAt` check | A client that ignored `no-store` keeps what it already downloaded (inherent) |
| T9 | Revocation latency | Checked synchronously on every request; no positive cache | A ≤1 s cache, if one is ever added, must be invalidated by pub/sub |
| T10 | Source result replaced/deleted after mint | Bytes copied at mint; `sourceSha256` re-checked on read; missing/corrupt → 404 | Disk corruption is detected, not repaired |
| T11 | Range-based probing | Every partial request re-authorises; same limits | None |
| T12 | Search indexing | `X-Robots-Tag`, `robots.txt` `Disallow: /s/` | A crawler that ignores both |
| T13 | Share enumeration | `shareId` and token are independent 128/256-bit random values; owner list requires the job token | None |
| T14 | DoS via many shares | Per-job share cap, per-owner rate limit, TTL cap, size cap | Storage cost is bounded by policy (D1) |
| T15 | Compromised Redis | Tokens stored hashed; passwords scrypt; no bytes in Redis | An attacker with write access can flip permissions; document this |
| T16 | Malicious document served from our origin | Closed content-type allowlist, `nosniff`, `attachment` for downloads, CSP, `frame-ancestors 'none'`, sandboxed iframe | A browser PDF-plugin 0-day is out of scope |
| T17 | Job deleted while shares exist | Cascade policy (D8); a share whose bytes are gone 404s | Depends on the chosen policy |
| T18 | Link forwarded beyond the intended recipient | Out of scope: a capability link is a bearer token by design; password + expiry are the only mitigations | Inherent |

Out of scope for this spec: DRM, watermarking, per-recipient identities, edit
collaboration, and link analytics beyond counters.

---

## 8. What the existing capability already proves

The session-5 audit ran these against the shipped job routes and pinned them in
`apps/api/test/share-boundary.test.ts` and `tests/e2e/share-boundary.mjs`. A
share implementation must keep all of them:

- the token is 256-bit and stable per (pepper, job), and changes with either;
- comparison is constant-time and rejects different lengths without throwing;
- a token is never accepted from a query string;
- state and bytes require the token; a token from another job is 403; an
  unknown job is 403 before any lookup (no enumeration);
- a traversal in the job id is 400, in the file name 404;
- an expired/missing result is 404 `result_not_found`;
- `Content-Type` is from a closed allowlist, `Content-Disposition` is
  `attachment` with a sanitised name, `nosniff` is present;
- `Referrer-Policy: no-referrer`, no CORS grant, no token echoed in a header;
- `Cache-Control: private, no-store` + `Vary` on every job response
  (`PDF-SHARE-001`);
- a cancelled (queued) job denies access immediately.

Known gaps carried into the decisions: a **finished** job cannot be revoked
before its TTL (`PDF-SHARE-002`), and the download stream does not advertise or
honour ranges (today's endpoint is download-only; the share route must, per §5.3).

---

## 9. Decisions needed

Each one changes a public contract, a schema or user-visible behaviour, so none
was guessed.

| # | Decision | Options | Recommendation |
| --- | --- | --- | --- |
| D1 | Where the shared bytes live | (a) copy into `shareRoot` at mint; (b) pin the job directory until the share expires; (c) object store | (a) for now: simple, bounded, no new infrastructure; add a per-owner byte quota and a max shares per job |
| D2 | Meaning of `view` vs `download` | (a) `view` = inline, `download` = attachment; (b) `download` off means the bytes are never served to a browser | (a), with UI wording that `view` is not copy protection |
| D3 | `edit` permission | (a) omit for now; (b) add a write-back job | (a) — write-back is a separate feature with its own concurrency and audit problems |
| D4 | Expiry policy | default 7 days / max 30; or fixed 24 h; or owner-chosen with a hard cap | default 7 days, hard cap 30 days, no extension without re-minting |
| D5 | Status for expired/revoked | 404 uniformly vs 410 for expired | 404 uniformly (no existence oracle) |
| D6 | Password policy | min length 8 vs 12; owner-set vs generated; lockout thresholds | min 12 if owner-set, allow generated; 5/min per share |
| D7 | Storage backend | Redis hash (records) + filesystem (bytes) vs Mongo (accounts already there) vs both | Redis for records (TTL + the stack already depends on it), filesystem for bytes |
| D8 | Cascade on job deletion/TTL | revoke all shares vs keep them independent | revoke all shares when the job is deleted or expires; a share is a view of a job, not a new document |
| D9 | Origin of the link | API origin vs web origin | web origin (`/s/<token>` proxied to the API), so the viewer shares the app's CSP and assets; the cookie stays scoped to the path |
| D10 | Access audit | none vs counters only vs per-access log without identifiers | counters + `lastAt`; no per-access log by default |
| D11 | Anonymous owners | allow shares for anonymous jobs vs accounts only | allow, matching the anonymous-first product; rate-limit by hashed subject |
| D12 | Embedding | `frame-ancestors 'none'` vs an allowlist | `'none'` until a concrete embed request exists |

Until D1–D9 are answered, implementing the routes would freeze a public API and
a link format that cannot be changed without breaking issued links. That is
exactly the outcome this session was told to avoid.
