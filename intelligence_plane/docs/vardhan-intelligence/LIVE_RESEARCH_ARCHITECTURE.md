# Vardhan Intelligence — Live Research Architecture

Decision: keyless DuckDuckGo-html search is the explicit live-web source, paired
with direct-fetch page corroboration; Serper providers remain dormant fallbacks
until an operator configures credentials. Keyless is explicit-injection only
(passed via options.searchProvider or used in CompanyResearchPipeline /
scripts/live-company-research.ts) — the LiveWebResearchProvider default
fallback stays Serper → Null so offline/mock/fake-fetcher callers never trigger
live HTTP implicitly (Stage 3 regression fix, verified 2026-10-17).

## 1. Decision

- Primary: `KeylessSearchProvider` (`src/server/providers/KeylessSearchProvider.ts`)
  performs read-only GETs against `https://html.duckduckgo.com/html/?q=…` and
  parses result anchors with dependency-free regexes. Zero credentials required.
- Corroboration: result URLs are re-fetched directly (`HttpFetcher`) so dossiers
  cite observed page content, not search snippets alone.
- Fallback: `buildKeylessChain()` wraps `[KeylessSearchProvider, NullSearchProvider]`
  in the existing `WebSearchProviderManager` waterfall. Serper classes stay
  dormant; they activate only when `SERPER_API_KEY` is present in the environment.

## 2. Why this fits

- Zero credentials and zero new npm dependencies: regex parsing only, reusing the
  existing `SearchProvider` interface, `HttpFetcher` type, and failure enum.
- Composes with `ProviderRegistry` ordering, `SearchCache` freshness, and
  `ResearchBudget` caps without interface changes.
- `PublicWebSearchProvider` (zetaflow mock) is untouched; existing tests keep passing.

## 3. Data flow

query → CompanyResearchPipeline/KeylessSearchProvider (explicit injection) → brief;
LiveWebResearchProvider default unchanged (Serper → Null) → DeepProspectBuilder → dossier

1. `LiveWebResearchProvider` issues the query through the keyless-first manager.
2. The manager returns DDG results (url/title/snippet) or a typed failure.
3. Promising URLs are direct-fetched and condensed into evidence observations.
4. `DeepProspectBuilder` merges search + direct-fetch evidence into the dossier
   with per-claim provenance (search hit vs. observed page).

## 4. Failure taxonomy

| Provider outcome              | SearchFailureReason    | Pipeline meaning                    |
|------------------------------|------------------------|-------------------------------------|
| HTTP 429 / 202 from DDG      | `SEARCH_RATE_LIMITED`  | Back off; retry later with budget   |
| Other non-2xx / fetch throw  | `SEARCH_UNAVAILABLE`   | Transient; try next provider        |
| 200, DDG page, zero results  | `SEARCH_EMPTY`         | Genuine no-hit; record and continue |
| 200, unparseable non-DDG HTML| `SEARCH_PARSE_ERROR`   | Probable layout change; alert owner |
| 403 / robots-blocked fetch   | `SEARCH_BLOCKED`       | Skip gated content; never bypass    |

The provider NEVER throws; every branch returns a `SearchProviderResponse`.

## 5. Rate-limit / timeout / retry policy

- Default 1200 ms politeness gap between consecutive queries (configurable via
  `politenessMs`); first query in a process is never delayed.
- Default 8000 ms per-request abort via `AbortSignal.timeout()` (`timeoutMs`).
- 429/202 surfaces `SEARCH_RATE_LIMITED` so the caller — not the provider —
  owns retry/backoff under `ResearchBudget` limits. No busy-loop retries inside
  the provider.

## 6. Caching and freshness

- `SearchCache` keys on normalized query + `maxResults`; live hits are cached
  short-TTL (minutes) because DDG rankings drift.
- Failure responses (`RATE_LIMITED`, `UNAVAILABLE`, `PARSE_ERROR`) are NOT cached;
  `EMPTY` is cached briefly to avoid re-hammering dead queries.
- Direct-fetch corroboration is cached separately by URL with ETag/last-modified
  revalidation where available.

## 7. Cost

£0 per run: no paid search API, no new infrastructure. Marginal cost is polite
DDG GET traffic plus the operator's own direct-fetch bandwidth.

## 8. ToS / privacy

- Public GETs only, with an identifying `User-Agent` (`VardhanIntelligence/1.0`).
- Polite inter-query delays; no parallel fan-out against the html endpoint.
- Robots directives and 403s are respected as `SEARCH_BLOCKED`; no credentialed,
  paywalled, or gated content is accessed or circumvented.
- Queries contain only operator-supplied research terms; no PII is transmitted
  beyond the query string itself.

## 9. Secret policy

No keys exist for this path. `SERPER_API_KEY` is read from the environment only
if an operator sets it; the keyless chain never reads, logs, or embeds secrets,
and error strings carry HTTP status codes only.

## 10. Fallback chain

CompanyResearchPipeline / scripts: `KeylessSearchProvider` → caller-level
fallback to cached results. LiveWebResearchProvider default (unchanged):
`SerperWebSearchProvider` (only when `SERPER_API_KEY` is configured) →
`NullSearchProvider` (terminator) → recorded `SEARCH_UNAVAILABLE` with graceful
dossier degradation. Keyless never fires implicitly from DeepProspectBuilder.

## 11. Validation plan

- `npx vitest run tests/keylessSearch.test.ts`: 7 deterministic cases (valid
  parse incl. `uddg` redirect, empty, 429, garbage-HTML parse error, fetcher
  throw, politeness delay, maxResults cap) — no network.
- `npx tsx scripts/keyless-search-smoke.ts`: live 3-query smoke; exit 0 when
  ≥2/3 queries return ≥1 result. Records real DDG output for honest review.
