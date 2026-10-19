# Mission H — Security and Data Boundaries

**Scope:** Live opportunity engine (keyless DDG search → pipeline → qualification
→ Rust briefs API). No Q-Core trust changes; no sales logic in `backend/`
beyond serving operator-reviewed briefs.

## 1. Rust API: auth-behind-session, shared-operator-read

- Both routes (`GET /v1/intelligence/briefs`, `GET /v1/intelligence/briefs/{company}`)
  live **behind `auth_service::require_session`** and take
  `Extension<AuthenticatedUser>` — the same session middleware as all other
  protected routes (`backend/control_plane_api/src/intelligence_briefs.rs`, merged in `lib.rs`).
- **Shared-operator-read model:** one operator-reviewed `ranked.json` file,
  readable by any authenticated operator. There is deliberately **no per-tenant
  scoping** — briefs are shared commercial reads, not tenant secrets.
- The module **never triggers live research and never fabricates briefs.**

## 2. Fail-closed codes (no silent empty)

| Condition | HTTP | Code |
|---|---|---|
| Backing file missing / unreadable | 503 | `BRIEFS_UNAVAILABLE` |
| Invalid JSON / wrong shape / bad entry | 500 | `BRIEFS_INVALID` |
| Unknown company | 404 | `BRIEF_NOT_FOUND` |

The list route accepts a bare array or an object wrapping it under
`briefs` / `ranked` / `items`; anything else is `BRIEFS_INVALID`.

## 3. No live web from Rust; polite keyless web from TS

- Rust performs **zero outbound HTTP** — it only reads the Stage-5 JSON file
  (`VARDHAN_BRIEFS_PATH` override or `intelligence_plane/.research/briefs/ranked.json`).
- Live web happens only in TypeScript: read-only GETs to DuckDuckGo HTML
  (`KeylessSearchProvider`) plus direct page fetches (`LiveWebResearchProvider`,
  `CompanyResearchPipeline`). No POST, no form submission, no login.

## 4. Identity on the wire: UA, no Authorization

- DDG search sends `User-Agent: Mozilla/5.0 (compatible; VardhanIntelligence/1.0)`.
- Page fetches send `User-Agent: VARDHAN-LIVE-OBSERVER/1.0` (+ `Accept: text/html`).
- **No `Authorization` header is ever attached** (asserted in
  `missionHSecurity` test (c)); keyless means keyless — Serper stays dormant
  without a key, and errors carry HTTP status only, never secrets.

## 5. URL hygiene: tracking-param stripping

`canonicalizeUrl` (CompanyResearchPipeline) lowercases the host, strips
`utm_*` / `gclid` / `fbclid`, drops default ports, fragments, and the bare-origin
trailing slash, and collapses `utm` variants to one canonical source so
deduplication (`duplicateRate`) is meaningful. Never throws.

## 6. Prompt-injection containment (excerpt-only)

Fetched pages are reduced to inert text: `stripHtml` drops scripts/styles/tags,
and only `title` + a bounded excerpt slice are stored (`VerifiedSource.excerpt`).
Signals carry `{ category, statement, sourceUrls, verified }` — **no
approved/decision/action fields exist** for injected page text to land in
(asserted in test (b)). Contradictions are recorded as data, never executed.

## 7. Unsupported-claim blocklist (no-send default)

`UNSUPPORTED_CLAIM_PHRASES` (OutreachDrafting): `guarantee`, `certified`,
`compliant`, `vulnerability in your`, `breach`, `control failure`,
`production-ready`, `multi-node` — any hit in subject or body blocks the draft
→ `null` with a machine-readable reason (asserted in test (d)).
Drafting is **GO-only, draft-only**: no SMTP, no enrolment, no transmission;
no named persons, no guessed emails/phones (buyer role titles only);
**no price by default** (only with an explicit stage `priceNote`);
template reuse policed by bigram-Jaccard ≥ 0.55 → regenerate once, else block.
Human approval stays downstream (`OutreachEligibilityGate`).

## 8. Public-sources-only boundaries

- Facts enter only as URL-backed `PublicFact`s; search-only hits beyond
  `verifyTop` stay `verified: false` with a `limitations` entry — never promoted.
- Register prose dates are **not** promoted to `publishedDate`/`eventDate`
  (curated overlays keep `httpStatus: 0`, `whyNow: null` → HOLD, honestly).
- No PII or contact generation anywhere in the research path.

## 9. Secret handling

No credentials in code, logs, or briefs: grep for
`api_key\s*=|passwd|Authorization: Bearer|sk-` across
`intelligence_plane/src` + `backend/control_plane_api/src` (excluding tests)
must be clean at closeout. `.env` is gitignored and never committed.

## 10. Boundary → test mapping (all in `tests/missionHSecurity.test.ts`)

| Boundary | Test |
|---|---|
| Tracking-param strip + host lowercase + root-slash strip | `(a) canonicalizeUrl…` |
| Excerpt-only containment (no approved/decision field) | `(b) prompt-injection excerpt stays inert…` |
| VARDHAN-LIVE-OBSERVER UA, no Authorization, brief leaks nothing | `(c) fetcher uses … UA, sends no Authorization…` |
| Unsupported-claim block (multi-node production → null) | `(d) unsupported-claim block…` |
| Rate-limit honesty (empty + error → limitations, no throw) | `(e) rate-limit honesty…` |

## 11. Error shapes (exact JSON contracts)

Missing store → `503 {"code":"BRIEFS_UNAVAILABLE","error":"intelligence brief
store unavailable: …"}`. Bad JSON/shape/entry → `500 {"code":"BRIEFS_INVALID",…}`.
Unknown company → `404 {"code":"BRIEF_NOT_FOUND","error":"no intelligence brief
for company '…'}`. Shapes are asserted in `backend/control_plane_api/tests/intelligence_briefs.rs`
(4 tests: list, get-one, 404, fail-closed override path).
