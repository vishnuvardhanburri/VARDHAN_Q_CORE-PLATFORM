# Mission I — Live Research Validation: provider operational behaviour

Extends (does not replace) `LIVE_RESEARCH_VALIDATION.md` (Mission H evidence).
All behaviour verified against source (`KeylessSearchProvider.ts`,
`CompanyResearchPipeline.ts`) plus Mission I live evidence. No bypass used.

## Provider constants (source)

- Endpoint DDG html (`https://html.duckduckgo.com/html/?q=`); UA
  `Mozilla/5.0 (compatible; VardhanIntelligence/1.0)`; politeness 1200 ms;
  timeout 8000 ms; default max 8 results.
- Pipeline: UA `VARDHAN-LIVE-OBSERVER/1.0`; fetch timeout 8000 ms;
  `MAX_RESULTS_PER_QUERY = 8`; `EXCERPT_CHARS = 500`; 8 planned queries/company;
  sweep CLI inter-company politeness 90 s (do not shorten without re-validation).

## Failure mapping (source → Mission I observation)

| Condition | Provider returns | Pipeline records | Mission I observation |
|---|---|---|---|
| HTTP 429 / 202 (throttle) | `available:false`, `SEARCH_RATE_LIMITED` | per-query `results:0` + limitation | Smoke HSBC-quantum 0 results provider `None`; JPM runs 202-throttled; LGT/Swift 8/8. Smoke 2/3 |
| Other non-2xx | `available:false`, `SEARCH_UNAVAILABLE` | same honest-empty pattern | Unit-covered (`keylessSearch.test.ts` 7 tests) |
| 200 DDG page, zero parseable results | `available:true`, `[]`, `SEARCH_EMPTY` | `results:0` entries | Final sweep JPM/LGT/Swift 0 sources → HOLD/60 |
| Garbled layout | `available:false`, `SEARCH_PARSE_ERROR` | limitation | Unit-covered |
| Throw (timeout/network) | `available:false`, `SEARCH_UNAVAILABLE` | `httpStatus:0`, snippet kept, limitation | HSBC `HTTP 0` unverified; BW direct `HTTP:000 SIZE:0` |
| Fetch non-200 (Forbes 403) | n/a (pipeline fetch) | `httpStatus`, snippet kept, limitation | Forbes 403 kept unverified + limitation; captcha page `/tmp/forbes_jpm_missionI.html` |
| Empty result set | n/a | `honest empty run` limitation → HOLD | JPM/LGT/Swift final sweep |

## Success path (observed, HSBC `run_20261017_4aa3b732`)

8 queries, 8 sources, 6 verified (HTTP 200, excerpts ≤500 chars, meta-date
extraction attempted), corroboration edges (`corroboratedBy`), dedupe via
`canonicalizeUrl` (lowercase host, default-port strip, tracking-param drop,
trailing-slash rule), `duplicateRate` emitted. Confidence: verified+corroborated
→ HIGH, verified-only → MEDIUM, else LOW.

## Invariants (never bypassed)

- Provider NEVER throws — every failure is a typed `failureReason`.
- Pipeline NEVER throws — every failure lands in `limitations`.
- Explicit injection only: constructor requires `(searchProvider, fetcher)`; live
  provider exists only in `scripts/live-*.ts` + smoke chain (guarded by test).
- No retry-with-backoff by design (politeness delay only); throttled runs stay
  honest-empty, re-run by operator after cooldown.
- `queriesExecuted[].cached` is always `false` today (no result cache); dedupe is
  canonical-URL only, never content-based.
- No secrets in the research path (keyless DDG needs none; secret grep clean —
  only `no secrets` doc comments match).
