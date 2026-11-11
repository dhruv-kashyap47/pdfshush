# PDF audit — final report, session 5 (share boundary)

Branch `pdf/s5-share`, cut from `pdf/s4-editor` at `20280e5`.
Date 2026-11-11. Windows 11, Node v24.21.0, pnpm 12.11.2.

Companion documents: `FINDINGS.md` (status per finding), `SHARE-SPEC.md`
(design only), `METRICS.md` (session 5 numbers), `BASELINE.md` (session 1).

---

## 1. Outcome in one paragraph

SHARE is not implemented in `apps/` or `packages/` and never has been
(`PDF-SHARE-000`), so the session audited the only capability that lets a
second party reach a document — the per-job `jobId` + `x-job-token` — and the
result streamer behind it. Two defects were found and fixed there: token
protected responses were cacheable under a non-secret URL (`PDF-SHARE-001`),
and the download header trusted a queue-supplied filename (`PDF-SHARE-003`).
Verifying redaction end to end found no removal defect but exposed a
false-refusal in the verification gate for a fully marked page
(`PDF-REDACT-001`). The inability to revoke a finished result
(`PDF-SHARE-002`) is parked because fixing it changes a shipped public status
code. The share feature is specified, not built. The gated e2e and sweep suites
ran for the first time in this audit and the browser walkthrough passes.

Commits (one root cause each):

| Commit | Subject |
| --- | --- |
| `2cba94c` | `fix(pdf-share): keep token-protected job responses out of caches (PDF-SHARE-001)` |
| `8e2fd65` | `fix(pdf-share): sanitise the download filename at the header (PDF-SHARE-003)` |
| `f922d62` | `fix(pdf-redact): accept a page fully covered by its marks (PDF-REDACT-001)` |
| `f94ebda` | `test(pdf-audit): prove redacted output bytes carry no content` |
| *(this docs commit)* | `docs(pdf-audit): session-5 share-boundary report, spec and metrics` |

Tests added: `apps/api/test/share-boundary.test.ts` (21 cases: 20 pass, 1
expected fail), `tests/e2e/share-boundary.mjs` (17 checks),
`packages/pdf-core/test/pdf-audit/redaction-output.test.ts` (4 cases), one case
in `packages/pdf-core/test/redact.test.ts`.

---

## 2. Per-item report

### PDF-SHARE-000 — SHARE does not exist (scope record)

- **Symptom:** nothing to audit, no issued links, no format to preserve.
- **Evidence:** `ARCHITECTURE-PDF.md:233-248`; route inventory of
  `apps/api/src`; `apps/web/src/pages/`; `rg -i "shareLink|shareToken|createShare|/share|/:token"`
  → no matches; `git log --all -S "shareToken"` / `-S "shareLink"` → none.
- **Action:** did not build it. Wrote `SHARE-SPEC.md` and asked; the user chose
  to audit the existing surface only.
- **Status:** deferred by decision.

### PDF-SHARE-001 — token-protected responses were cacheable

- **Symptom:** a completed PDF was served with no `Cache-Control`. The URL
  (`/api/jobs/<id>/files/<name>`) contains no secret because the capability is
  the `x-job-token` header, so a shared cache keyed on the URL can store the
  document and replay it to a caller that never presented the token — and keep
  replaying it after expiry or revocation. Job state JSON, 403 and 404 bodies
  were cacheable too (404 is heuristically cacheable by default).
- **Root cause:** `apps/api/src/http/result-stream.ts:47-51` set only
  Content-Type/Length/Disposition; `app.ts:375-412` and
  `http/v1/routes.ts:472-535` set no cache headers on state or errors.
- **Files/lines:** fix in `result-stream.ts` (`NO_STORE`, `markPrivate`,
  `noStoreResponses`), mounted at `app.ts` before `POST /api/jobs` and at
  `v1/routes.ts` before `authenticate`.
- **Test added:** `apps/api/test/share-boundary.test.ts` — "tells every cache
  not to store a job response" (200 file, 200 state, 403, 404) and "…v1 job
  response either"; plus an e2e assertion on a real download.
- **Verification:** failed before the fix (`cache-control: null` on all four,
  and on v1); passes after; `pnpm --filter @pdfshush/api test` 238 passed.
- **Status:** fixed, `2cba94c`.

### PDF-SHARE-002 — a finished result cannot be revoked

- **Symptom:** `DELETE /api/jobs/:id` on a completed job → `409
  {"code":"not_cancellable"}`; the same token continues to download the file
  (`200 %PDF-…`) until the one-hour retention TTL. There is no other revoke
  route. A queued job *is* revoked immediately (state removed, directory
  deleted, `queue.ts:158`).
- **Root cause:** `apps/api/src/jobs/queue.ts:148` returns `'finished'` for
  `completed`/`failed`; `apps/api/src/http/app.ts:430-438` maps that to 409 and
  never removes the work directory.
- **Test added:** `it.fails` repro "blocks access immediately when a completed
  job is revoked" (suite stays green, turns red when the decision lands). The
  e2e walkthrough pins the current 409 with an explicit `PDF-SHARE-002 open`
  label.
- **Why not fixed:** changing a finished job's DELETE from 409 to 200-and-delete
  is a public API/behaviour change; a new revoke route is a public API addition.
  `http.test.ts` currently pins the 409 contract.
- **Status:** **needs decision**.

### PDF-SHARE-003 — the header trusted a queue-supplied name

- **Symptom:** a result whose queue-reported name contains `"` produced
  `Content-Disposition: attachment; filename="report".pdf"` — not a valid
  RFC 6266 quoted-string. A CR/LF would make `setHeader` throw after the stat,
  turning a download into a 500.
- **Root cause:** `apps/api/src/http/result-stream.ts:51` (before `8e2fd65`)
  wrote `args.name` directly into the header; the guarantee it relied on lives
  in `files/store.ts:117` (`writeResult` returns a sanitised basename), a
  different process boundary.
- **Test added:** "sanitises the download filename reported by the queue"
  (poisoned snapshot `report".pdf`, file stored as `report_.pdf`, asserts the
  header and a 200).
- **Verification:** failed with the malformed header before the fix, passes
  after; ordinary downloads unchanged because `safeFileName` is idempotent.
- **Status:** fixed, `8e2fd65`.

### PDF-REDACT-001 — a fully marked page was refused

- **Symptom:** redacting an entire page failed with `Redaction verification
  failed … page-not-blank: a page lost its content — p1: contrast spread only
  -255`. Indistinguishable from a failed render, and the user asked for that
  output.
- **Root cause:** `packages/pdf-core/src/redact/verify.ts:430-455` (before
  `f922d62`) computed min/max luminance over samples *outside* the marks. With
  a full-page mark there are none, so the sentinels (255/0) produced -255.
- **Test added:** `packages/pdf-core/test/redact.test.ts` — "accepts a page that
  is entirely covered by its marks" (asserts the detail text, the opaque mark,
  and that the existing blank-page rejection still fails a flat rebuild).
- **Verification:** the e2e redaction run failed with the exact message before
  the fix; after it, `redact.test.ts` 19 passed and the output checks pass.
- **Status:** fixed, `f922d62`.

### Redaction removal — verified, no defect

- **Question:** is content truly removed from the bytes, not just covered?
- **Method:** run the shipped pipeline on committed fixtures and read the
  returned bytes three ways — pdf.js text extraction, the gate's decompressing
  text-operator/forbidden-string scan, and the object graph. Controls assert the
  same checks fail on the unredacted source.
- **Result:** no extractable text; no text-showing operator; no
  `/AcroForm`, `/EmbeddedFiles`, `/Metadata`, `/Info`, no font object; every page
  exactly one full-size image; the mark is opaque in the pixels. The browser e2e
  independently confirms the structure on a real redaction.
- **Status:** verified; `f94ebda`.

### Checked with no defect

| Check | Result |
| --- | --- |
| Token entropy/CSPRNG | 64 hex chars; 32-byte CSPRNG pepper persisted `0600`; `PEPPER` min length 16; changes with pepper or job |
| Constant-time compare | `timingSafeEqual` with explicit length guard; equal-length and different-length wrong values reject |
| Tokens in logs | no request logger; explicit log shapes; pino redaction covers `token`, `x-job-token`, cookies |
| Tokens in referrers/URLs | header-only; query token refused (403); `Referrer-Policy: no-referrer`; no token in any response header |
| Expiry server-side | authorisation before state; janitor-removed file → 404 `result_not_found` |
| IDOR | token bound to job id; cross-job token 403; foreign file name 404 |
| Path traversal | malformed id 400; `..`, `%2F`, backslash names 404 |
| Content-Type/Disposition | closed allowlist; `attachment` + sanitised name; `nosniff` |
| CORS | no `Access-Control-Allow-Origin` for a foreign origin |
| Status codes | 400 / 403 / 404 / 200 as above; unknown and foreign indistinguishable |
| Range | **not supported**; a `Range` request is answered 200 with the full body (legal, RFC 9110 §14.2); required by `SHARE-SPEC.md` for the future share route, not fixed here |

---

## 3. Integration gate (live numbers)

Run on this machine in this session; logs in `docs/pdf-audit/.baseline/*-s5.log`.

| Step | Command | Result | Baseline |
| --- | --- | --- | --- |
| Typecheck | `pnpm typecheck` | pass | pass |
| Unit | `pnpm test` | **1496 passed, 0 failed, 8 expected fail, 117 files** | 1409 passed (session 1); 1471 / 7 / 115 (session 4) |
| Build | `pnpm build` | pass, 63 routes prerendered | pass, 63 |
| Bundle | `pnpm test:bundle` | pass, 0 engines in app chunks | pass |
| Lint | `pnpm lint` | **not configured** (`Command "lint" not found`) | not configured |
| Preflight | `node tests/support/preflight.mjs` | **exit 0** (Docker, Redis, API, web all up) | exit 1 (blocked) |
| Browser E2E | `pnpm test:e2e` | **ALL CHECKS PASSED** (14 tools, editor, redaction) | blocked |
| Share walkthrough | `node tests/e2e/share-boundary.mjs` | **17/17 checks** | n/a |
| Sweep | `pnpm test:sweep` | **61 groups** (baseline 60) — see §4 | 60 (ungated) |
| Round-trip | `vitest run test/pdf-audit/roundtrip.test.ts` | 15 passed | 15 passed |
| Render regression | `vitest run test/render-regression.test.ts` | 10 passed, 1 expected fail | same |

The browser walkthrough is the requested replacement for the share e2e:

```
create job (merge, 2 files)            -> 202, 32-hex id + 64-hex token
poll with token                        -> completed, merged.pdf
download without token                 -> 403, no %PDF bytes
download with token (clean session)    -> 200, %PDF, application/pdf,
                                          attachment; filename="merged.pdf",
                                          private, no-store, no-referrer
wrong token / query-string token       -> 403 each
token from another job (IDOR)          -> 403
traversal in file name                 -> 404
unknown job with valid-format token    -> 403 (no enumeration)
missing result                         -> 404 result_not_found
DELETE a finished job                  -> 409 (PDF-SHARE-002 open)
```

---

## 4. Regression analysis — the one extra sweep group

`pnpm test:sweep` reported 61 groups against the baseline's 60. The only new
group is:

```
[FAIL] light 1920 /  overflow=0 unrevealed=2   (a second run: unrevealed=4)
```

Why this is **not** a session-5 regression:

1. `git diff c8f2208 HEAD -- apps/web/src/pages/home.tsx
   apps/web/src/hooks/use-reveal.ts apps/web/src/components/layout/footer.tsx`
   is empty; the only web changes since the baseline are editor files.
2. Replaying the sweep's exact `/` steps at 1920×1080 in fresh browsers gave
   `0, 2, 2` unrevealed across three launches, and `2, 0, 0` across three
   contexts in one browser. It is a cold-start race in `useReveal`: the
   `IntersectionObserver` is attached in an effect, and the sweep begins
   scrolling immediately after `networkidle`; elements near the fold (top ≈1067
   and ≈1207 px) can be scrolled past before the observer reports them.
3. The baseline reached `/` at a moment the race did not fire. The 60
   footer-reveal groups are the same in both runs.

It is recorded, not fixed: it is a marketing-chrome issue explicitly outside the
PDF engine audit (`BASELINE.md`, `FINDINGS.md` "Out of scope"), and the fix
would change the reveal contract for every page. A follow-up should either make
`useReveal` reveal elements already above the viewport on attach, or make the
sweep wait for the observer. Until then the sweep is red for 60 known groups
plus a flaky 61st.

---

## 5. Before / after metrics (120-page fixture)

Full tables and commands in `METRICS.md` session 5. Summary:

| Metric | Before (session 2/3) | After (session 5) |
| --- | --- | --- |
| Lifecycle `cached` peak RSS / live heap / live docs | 124.8 MB / 60.1 MB / 1 | 126.4 MB / 60.1 MB / 1 |
| Lifecycle `cold` peak RSS / live heap / live docs | 374.6 MB / 59.8 MB / 0 | 375.9 MB / 59.8 MB / 0 |
| First page 1600 px | 122.0 ms | 301.6 ms |
| First page 2560 px | 298.6 ms | 737.2 ms |
| Editor window 20 pages, mean per page | 26.6 ms | 58.4 ms |
| Thumbnails 120 pages, mean per page | 1.85 ms | 4.71 ms |
| Editor window peak RSS / heap | 436.7 / 199.1 MB | 417.5 / 198.2 MB |
| Thumbnail peak RSS / heap | 461.1 / 215.6 MB | 441.8 / 214.6 MB |

Memory is flat and unchanged, which is the shape the fixes care about. Render
timings are uniformly ~2.4× slower with **lower** peak memory on a render path
that is byte-identical to session 3 (`git diff 6d49d7d HEAD --
packages/pdf-core/src/render` is empty), so this is recorded as machine state,
not a regression. Absolute times should not be compared across sessions on this
host.

---

## 6. Remaining issues and risks

1. **`PDF-SHARE-002` — no revocation for a finished result** (needs decision).
   Until decided, the only bound on access to a completed job is the one-hour
   TTL and deletion of the job by the janitor.
2. **Share feature absent** (`SHARE-SPEC.md`, 12 decisions). No user can send a
   document to a second party; the job capability is header-only.
3. **Range requests unsupported on result downloads.** A large download cannot
   resume. Legal today (Range may be ignored), required for `/s/<token>/file`.
4. **Token rotation.** The job token is `SHA-256(pepper ‖ jobId)` and has no
   per-job secret, so it cannot be rotated without deleting the job. The pepper
   is a global secret: rotating it invalidates every job token (and every quota
   counter) at once, and a leaked pepper forges tokens for any job id. That is
   inherent to the derived design and is why `SHARE-SPEC.md` uses a CSPRNG
   token stored only as a hash.
5. **Adjacent cache class not fixed:** `/api/account*` and `/api/auth/me` are
   cookie-authenticated and still send no `Cache-Control`. A shared cache could
   store one user's account JSON under a URL another user requests. This is the
   same root cause as `PDF-SHARE-001` but outside the declared second-party
   surface; recommended as a one-line follow-up (mount the same no-store
   middleware on `/api/account` and `/api/auth`). Not changed here to avoid
   widening a fix beyond its finding.
6. **`no-store` depends on the intermediary.** It is the correct directive; a
   proxy that ignores it can still replay. `Vary` is the backstop.
7. **Sweep `/` race** (§4) — pre-existing, flaky, outside scope.
8. **Lint is still not configured** for the workspace, so "lint" in the gate
   means "verified absent", not "clean".
9. **`PDF-SHARE-003` is defence in depth.** The unsafe name is not reachable
   through today's worker (it sanitises before writing the queue snapshot); the
   fix removes the dependency on that invariant at the header boundary.

---

## 7. Decisions needed from the user

1. **Revoke semantics for a finished job (`PDF-SHARE-002`).** (a) DELETE a
   finished job removes its directory and returns 200; (b) add a separate
   delete/revoke route; (c) keep the TTL as the only revocation. (a) is smallest
   but changes a shipped status code; the existing test pins 409 today.
2. **Share design (`SHARE-SPEC.md` §9, D1–D12):** storage lifetime and copy vs
   pinned job directory; `view` vs `download` semantics; whether `edit` is ever
   in scope; expiry defaults and caps; 404 vs 410 for expired/revoked; password
   policy; Redis vs Mongo vs object store; cascade on job deletion; API vs web
   origin; access audit; anonymous owners; embedding.
3. **Range support on the existing job download route.** Add partial content
   now (new response semantics for every result), or only on the future share
   route (current plan).
4. **Adjacent account/auth cache headers** (risk 5). Confirm whether to fix in
   this audit line or defer.

---

## 8. Reproduction

```powershell
# Unit + typecheck + build + bundle
pnpm typecheck
pnpm test
pnpm build
pnpm test:bundle

# Full stack (this session had Docker + Redis available)
docker compose up -d redis
pnpm --filter @pdfshush/api dev      # :8080
pnpm --filter @pdfshush/web dev      # :5173
node tests/support/preflight.mjs     # exit 0
pnpm test:e2e                        # ALL CHECKS PASSED
node tests/e2e/share-boundary.mjs    # 17/17
pnpm test:sweep                      # 61 groups (see §4)

# Focused evidence
pnpm --filter @pdfshush/api exec vitest run test/share-boundary.test.ts
pnpm --filter @pdfshush/pdf-core exec vitest run test/pdf-audit/redaction-output.test.ts
pnpm --filter @pdfshush/pdf-core exec vitest run test/redact.test.ts
pnpm --filter @pdfshush/pdf-core exec vitest run test/pdf-audit/roundtrip.test.ts
pnpm --filter @pdfshush/pdf-core exec vitest run test/render-regression.test.ts
```

The API and web dev servers were stopped before the performance probes were
taken and are not left running. The `pdfshush-redis-1` container was stopped
after the gate (`docker compose stop redis`); the stack is not left up.
