# AdSense plan — US-first, G7 RPMs

Decision record from 2026-11-26. Everything here follows from five choices:
US-first English, 20+ real guides before applying, a certified CMP for EEA + UK,
ads only for non-Pro users, and no reaction to ad blockers.

> **Why content comes first.** AdSense rejects sites whose pages are thin or
> purely functional, which is exactly what a tool page is. Approval is a content
> judgement, not a traffic judgement. The same 20 articles are also the only
> realistic way to attract US search traffic, so nothing here is wasted work.

## 1. Site signal fixes

| Fix | Status |
|---|---|
| `lang="en-IN"` → `lang="en"` (`SITE_LANG`, `<html>`, JSON-LD `inLanguage`, hreflang) | **done** |
| Remove the `hreflang="en-IN"` alternate from the sitemap | **done** |
| `public/ads.txt` with `google.com, pub-XXXX, DIRECT, f08c47fec0942fa0` | pending publisher id |
| Privacy policy mentions Google, cookies, consent | pending ads being enabled |
| AdSense site review: `/about`, `/contact`, `/privacy`, `/terms` reachable from the footer | verify |

## 2. The 20 articles (US intent, RPM-aware)

Advertiser vertical sets RPM more than geography does. Legal, insurance, tax and
finance pay several times what generic "productivity" pays on the same pageview,
so the list below is deliberately weighted toward compliance-adjacent topics.

**Legal & compliance (highest RPM)**

1. How to redact a PDF properly — and why black boxes fail
2. Bates numbering for legal documents: a practical guide
3. Are e-signatures legally binding? ESIGN, UETA and eIDAS explained
4. HIPAA and PDFs: what redaction actually requires
5. Redacting a PDF for court filing: a checklist
6. Is it safe to upload a PDF to an online tool? (the zero-upload argument)

**Tax & finance**

7. Sending tax documents as PDFs without exposing your SSN
8. How to compress a PDF under 5 MB for a portal upload
9. Bank statements as PDFs: merging, redacting and sharing safely

**High-volume how-tos**

10. How to merge PDFs on a Mac without paying for Acrobat
11. How to split a PDF into separate files (Windows and Mac)
12. Sign a PDF on an iPhone: the built-in way and when it is not enough
13. Fill out a PDF form without printing it
14. Remove pages from a PDF without Adobe
15. Rotate and straighten a scanned PDF
16. OCR a scanned PDF: what it does and where it fails
17. Why is my PDF so large? Seven causes and the fix for each
18. Flatten a PDF: what it means and when you actually need it
19. Password-protect a PDF — and keep the password recoverable
20. Convert PDF to JPG at print quality

Each one: 900–1,400 words, one H1, H2s that answer the sub-questions people
actually search, at least one screenshot, a link to the matching tool, and an FAQ
block with `FAQPage` JSON-LD. Original writing — reworded AI output is a common
rejection reason.

## 3. Ad placement (decided)

"As many as fit without hurting the experience" resolves to:

| Page | Units | Where |
|---|---|---|
| Tool page | 1 | After the tool area, before the footer. Never above the drop zone. |
| Home | 1 | Below the tool grid. |
| Article | 2 | One after the intro, one at the end. |
| Result / error state | 0 | Never. |
| `/account`, `/status`, `/verify` | 0 | Never. |

Not used, on purpose: auto ads, anchor ads, vignettes, interstitials, sticky
mobile units. On a utility site they cost more in bounce and Core Web Vitals than
they return. Responsive display units only, fixed height reserved so CLS stays 0.

Rule: **every non-Pro visitor sees ads; Pro never does.** A signed-in free user
still sees them. The gate is `account?.plan !== 'pro'` from `/api/auth/me`.

## 4. Consent (EEA + UK)

Google requires a certified consent platform for EEA/UK ad traffic. Without it,
those visitors receive no ads at all — not cheaper ones.

- Use **Google's own Privacy & Messaging CMP** (free, certified) unless a paid
  IAB TCF platform is preferred later.
- It must load **before** any ad request, and must be reachable again from the
  footer ("Privacy choices").
- Consent mode must be configured so a refusal still allows non-personalized ads
  where permitted.

## 5. CSP changes (only when ads go live)

The current policy is `default-src 'self'` and is pinned by
`apps/web/src/lib/edge-headers.test.ts`. Enabling ads requires adding, at minimum:

- `script-src`: `pagead2.googlesyndication.com`, `partner.googleadservices.com`,
  `tpc.googlesyndication.com`, `www.googletagservices.com`,
  `adservice.google.com`, `fundingchoicesmessages.google.com`
- `img-src`: `pagead2.googlesyndication.com`, `googleads.g.doubleclick.net`,
  `www.google.com`
- `frame-src`: `googleads.g.doubleclick.net`, `tpc.googlesyndication.com`,
  `www.google.com`, `fundingchoicesmessages.google.com`
- `connect-src`: `pagead2.googlesyndication.com`, `googleads.g.doubleclick.net`

Verify this list against Google's current documentation at implementation time;
it changes. Build the widened policy behind a flag so the default build keeps the
strict policy and the test keeps passing.

## 6. Sequence

1. Write the 20 articles; internal-link each to its tool and to two siblings.
2. Submit every article in Search Console; check indexing weekly.
3. Apply to AdSense. Expect a decision in days to weeks; a rejection names a
   reason and can be fixed and resubmitted.
4. In parallel: ads.txt, CMP, ad slot component behind a flag, CSP flag.
5. On approval: switch ads on for non-Pro, then watch the country report for two
   weeks before changing placement.

## 6a. What is built (2026-11-26)

Everything below is implemented and behind a flag. `VITE_ADS_ENABLED=false` (the
default) makes every part of it a no-op: no script, no slot, no reserved space,
no CSP change.

| Piece | Where | State |
|---|---|---|
| Guides index + article routes | `src/pages/guides.tsx`, `src/pages/guide.tsx` | built |
| Content pipeline (frontmatter + markdown → HTML) | `src/content/guide-format.ts` | built |
| Prerender of `/guides/*` with Article + Breadcrumb JSON-LD | `build/prerender.ts`, `build/guides.ts` | built |
| Drafts excluded from build, sitemap and bundle | `guidesPlugin` in `vite.config.ts` | built |
| Tool page → guides links | `components/guides/related-guides.tsx` | built |
| 20 article drafts | `src/content/guides/*.md` | drafted, **unpublished** |
| Ad slot + gating | `components/ads/ad-slot.tsx`, `lib/ads.ts` | built, flag off |
| CMP + Consent Mode v2 | `lib/ad-loader.ts` | built, flag off |
| CSP widening | `lib/csp.ts` (`buildCsp(origins, { ads })`) | flag-gated |
| `ads.txt` template | `public/ads.txt` | placeholder only |
| Status report | `pnpm --filter @pdfshush/web guides:status` | built |

Ad placements as implemented: one unit after the content on the home page and on
each tool page, two in article flow (after the 2nd and 5th H2). Nothing on
result, account, status, error, login or checkout routes — the gate is an
allowlist, so a new route is ad-free by default.

## 6b. Apply checklist (manual)

1. **Edit and publish the 20 drafts.** For each file in
   `apps/web/src/content/guides/`: verify the `NEEDS HUMAN EDIT` boxes, then
   change `draft: true` to `draft: false`.
2. **Confirm the gate:** `pnpm --filter @pdfshush/web guides:check` must print
   `OK: 20 published guides`.
3. **Build and deploy**, then submit `/guides` and each article in Search
   Console. Wait for indexing.
4. **Apply to AdSense** with `https://pdfshush.com`.
5. **On approval**, put the real publisher id in `public/ads.txt` (uncomment the
   template line, replace the zeros), and verify:
   `curl -s https://pdfshush.com/ads.txt`.
6. **Configure the CMP** in AdSense → Privacy & messaging → GDPR message. Copy
   its publication id into `VITE_ADSENSE_CMP_ID`.
7. **Set the build variables** in the deploy environment:
   `VITE_ADS_ENABLED=true`, `VITE_ADSENSE_CLIENT=ca-pub-…`, the four slot ids,
   `VITE_ADSENSE_CMP_ID=…`.
8. **Deploy.** The CSP widens itself from `VITE_ADS_ENABLED`; the default build
   keeps the strict policy.
9. **Verify in the EEA** (VPN): the consent dialog appears before any ad, and
   declining leaves no ad requests. Verify a Pro account loads no ad script.
10. **Watch the country report** for two weeks before touching placement.

## 7. What "working" looks like

| Metric | Target | Note |
|---|---|---|
| Page RPM (US) | $4–8 on articles, $2–6 on tool pages | Vertical matters more than layout |
| Sessions | 10k/mo within 6 months | Long-tail how-tos compound |
| Ads share of revenue | under 15% | A $6 Pro subscription at 1% conversion beats ads ~10× |
| Ad-blocked sessions | expect 30–50% | Not worth fighting |

The honest framing: ads are the floor that pays for the free tier. Subscriptions
are the business. The 20 articles serve both — they are the approval requirement,
the traffic engine, and the trust signal that makes a stranger pay $6.
