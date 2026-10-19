# JPMorgan Evidence Review (Mission I §5) — official HOLD vs projection

Review date (UTC): 2026-10-17. Standard: per-source event/publish/retrieval dates,
canonical URL, publisher, retrieval status, corroboration, confidence, claim-support,
limitations. Slug/mirror dates are NOT fetch-verified dates.

## Per-source table

| # | Canonical URL | Publisher | Event date | Publish date | Retrieved | Retrieval status | Corroboration | Confidence | Supports | Limitation |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `https://www.businesswire.com/news/home/20250715922466/en/…ResearchAndMarkets.com` | Businesswire (ResearchAndMarkets report notice) | — | 2025-07-15 (URL slug only, NOT fetch-verified) | 2026-10-17 (sweep `run_20261017_5524eb50`) | Search snippet only; direct fetch `HTTP:000 SIZE:0` (blocked/empty) | none | LOW (undated in pipeline: `publishedDate`/`eventDate` null) | "A JPMorgan digital-transformation strategy report exists" — historical context ONLY, not a fresh trigger | Slug date ≠ verified publish date; no meta-tag confirmation |
| 2 | `https://www.forbes.com/sites/bernardmarr/2026/07/01/how-jpmorgan-chase-is-building-the-ai-powered-bank-of-the-future` | Forbes (Bernard Marr) | — | 2026-07-01 (URL slug only, NOT fetch-verified) | 2026-10-17 (sweep + Mission I curl) | HTTP 403 both times; body = Cloudflare captcha challenge (`/tmp/forbes_jpm_missionI.html`, 770 B, 0.78 s) | none | LOW (unverified, excerpt 0 chars) | NOTHING verifiable — URL presence only | 403 + captcha; no meta-tag confirmation; mirror/header evidence is not direct verification |
| 3–6 | JPM-01…JPM-04 (`SOURCE_REGISTER.md:11-14`): 2022 QKD press release, tech-blog FLARE writeup, QKD prototype PDF, Cointelegraph ledger coverage | JPMorgan Chase (×3) + Cointelegraph (secondary) | 2022-02 / 2022 (prose register dates) | — (prose only, never pipeline-extracted) | Curated register (Mission H builder overlay), not live fetch-verified | `httpStatus: 0`, `verified:false` | none fresh | LOW for trigger purposes | "JPMC ran a 2022 quantum-network research programme" — background capability context | Prose dates NOT promoted to WHY_NOW; 4+ years old in any case |

## Why the official brief stays HOLD

Official brief `intelligence_plane/.research/briefs/jpmorgan-com.json`:
verdict **HOLD**, score **70**, `whyNow: null`, 1 public fact (businesswire URL,
both dates null), limitations cite Forbes 403 + "No fresh corroborated MEDIUM+
trigger". Final live re-sweep (`run_20261017_73111493`): 8 queries, 0 sources,
honest-empty → HOLD/60. GO requires a dated, sourced, corroborated MEDIUM+
trigger ≤180 d; no source above meets that bar.

## Projection separation (what-if GO/94)

`scripts/jpm-whatif-projection.ts` (197 lines, no production imports) takes a
CALLER-SUPPLIED WhyNow (Forbes 2026-07-01 + BW 2025-07-15 corroboration) and prints
GO/94 + a 100-word draft with the verbatim `CAVEAT_BLOCK` (Forbes MEDIUM
snippet+slug / BW HIGH mirror header; official brief stays HOLD). It is a labelled
hypothesis for process validation ONLY: never in the ranked list, never in a
campaign, never counted, never cited as validated. It passed (EXIT 0) and stays.

## What would flip JPMorgan to GO (operator checklist)

1. Human browser session (or clean fetch) retrieving the Forbes URL with a
   parseable `article:published_time` meta tag dated ≤180 d.
2. A second independent source corroborating the same trigger event.
3. Pipeline re-run extracting both dates → `whyNow` non-null → engine GO.
   Until then: HOLD, no draft, no outreach.
