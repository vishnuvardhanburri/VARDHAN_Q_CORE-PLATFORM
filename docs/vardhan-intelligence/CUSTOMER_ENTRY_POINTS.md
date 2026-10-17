# Customer Entry Points — Stage 5 Ranked Set (2026-10-17)

> STAGE 5-RANKING. Built HONESTLY from available evidence: 1 live HSBC sweep
> (run_20261017_93640ac8) + 3 honest-empty throttled runs overlaid with curated
> `research/SOURCE_REGISTER.md` rows (JPM-01..04, LGT-01..04, SWF-01..04) plus
> `research/bank_profiles/*.md` dossiers and a synthetic-lab caveat (all Q-Core
> workflows are PRODUCT_HYPOTHESIS demos on synthetic data only, never bank systems).
> Machine source: `intelligence_plane/.research/briefs/ranked.json` (4 entries) +
> per-company `<slug>.json`, via `scripts/build-ranked-briefs.ts` reusing pure
> `briefForCompany` + `rankBriefs` from `src/server/commercial/SweepBriefing.ts`.
> Every `sourceUrl` below exists in either the live run JSON or SOURCE_REGISTER —
> zero fabricated dates/URLs. Builder command:
> `npx tsx scripts/build-ranked-briefs.ts` (from `intelligence_plane/`).

## How to read this file

- Each company section carries the 10 required fields: (1) context, (2) PROBLEM
  hypothesis, (3) WHY_NOW or its absence, (4) Q-Core fit with evidence refs,
  (5) TARGET_BUYER_ROLE (function-only, no named persons), (6) commercial stage
  PROPOSED, (7) GO/HOLD/DROP + reasons, (8) uncertainties, (9) resolveEvidence,
  (10) provenance as DOCUMENTED_FACT vs REAL_PUBLIC_OBSERVATION vs VARDHAN_INFERENCE.
- Engine rules (from `OpportunityQualification.ts` + `SweepBriefing.ts`): GO requires
  a dated, sourced, fresh WHY_NOW (≤180d) + ≥1 DEMONSTRATED/PARTIAL capability +
  grounded hypothesis + identified buyer. Anything else → HOLD (or DROP on
  unsupported claims). Drafts are GO-only; HOLD/DROP yield draft null +
  machine-readable `draftBlockedReason`. No auto-send, ever.
- QCORE_CAPABILITY_REGISTRY evidence refs used throughout: sealed-receipts
  DEMONSTRATED (`backend/vardhan_receipt` / `validate-canonical`),
  replay-idempotency DEMONSTRATED (`backend/vardhan_idempotency` /
  `g2-replay-idempotency`), ed25519-signing PARTIAL (`backend/vault/license` /
  `ed25519-unit`). Registry refs, never hardcoded.
- Rust API contract (`backend/control_plane_api/src/intelligence_briefs.rs`
  `BriefSummary`): each `ranked.json` entry carries exactly `company`, `verdict`,
  `score`, `signal_url`, `why_now`, `buyer_role`. All 4 entries verified
  key-exact (see verification log in §Throttle note).

## Evidence base (no fabricated dates or URLs)

| Company | Live run | Live result | Curated overlay |
|---|---|---|---|
| HSBC | `run_20261017_93640ac8` | 12/12 sources, 8 corroborated, 6 verified HTTP-200 GENERAL_TECH security-center pages | HSBC-01..04 (profile + register) |
| JPMorgan | `run_20261017_75a48bb2` | honest-empty (DDG 202 challenge throttle) | JPM-01..04 (register) |
| LGT | `run_20261017_909ee989` | honest-empty (DDG 202 challenge throttle) | LGT-01..04 (register) |
| Swift | `run_20261017_6e0e0b07` | honest-empty (DDG 202 challenge throttle) | SWF-01..04 (register) |

## Ranked table (engine output — all HOLD, zero GO)

| # | Company | Verdict | Score | Strongest trigger | Buyer function | Discovery question | Next step |
|---|---|---|---|---|---|---|---|
| 1 | HSBC | HOLD | 70 | none — resolveEvidence below | Payments Operations / Trade Finance Operations | Which review workflow, if any, feels capacity pressure today? | Re-sweep for a dated trigger; confirm publish date of quantum-defences view |
| 2 | JPMorgan | HOLD | 60 | none — resolveEvidence below | Payments Operations / Trade Finance Operations | Does any published-research-to-lab handoff need evidenced tooling? | Re-run live sweep before outreach; seek dated FLARE/QKD trigger ≤180d |
| 3 | LGT | HOLD | 60 | none — resolveEvidence below | Payments Operations / Trade Finance Operations | Which custody-instruction evidence properties matter in your lab? | Re-run live sweep before outreach; seek dated custody trigger ≤180d |
| 4 | Swift | HOLD | 60 | none — resolveEvidence below | Payments Operations / Trade Finance Operations | Which attestation artefacts, if any, come from lab tooling? | Re-run live sweep before outreach; seek dated CSCF-cycle trigger ≤180d |

## 1. HSBC — HOLD (score 70)

1. **Context:** Global universal bank; live-verified security-center pages (6× HTTP-200) + public quantum programme (HSBC-01..03) + annual disclosure hub (HSBC-04).
2. **PROBLEM hypothesis:** Unclear whether HSBC faces near-term review pressure in the payments-operations workflow; capacity pressure is an unconfirmed hypothesis. (No breach/control-failure language — speculative-phrase rule stays clean.)
3. **WHY_NOW or its absence:** ABSENT (null). Live pages carry no pipeline-extracted eventDate/publishedDate ≤180d; quantum-defences view URL was search-only, never fetch-verified.
4. **Q-Core fit:** sealed-receipts DEMONSTRATED (`backend/vardhan_receipt` / `validate-canonical`); replay-idempotency DEMONSTRATED (`backend/vardhan_idempotency` / `g2-replay-idempotency`); ed25519-signing PARTIAL (`backend/vault/license` / `ed25519-unit`). Lab-analogy only.
5. **TARGET_BUYER_ROLE:** Payments Operations / Trade Finance Operations (function only).
6. **Commercial stage PROPOSED:** DISCOVERY_15K (scoped diagnostic + evidence pack; NDA-gated; customer inputs required).
7. **GO/HOLD/DROP + reasons:** HOLD. `No WHY_NOW trigger: GO requires a dated, sourced trigger event.` Score 70 = fit 30 + buyer 15 + feasibility 15 + corroborated facts 10, freshness 0.
8. **Uncertainties:** No customer contact, need, budget, or procurement path established; internal timelines/vendors unknown.
9. **resolveEvidence:** Dated trigger: quantum-defences view publish date or CSCF attestation cycle (freshnessDays ≤180 with sourceUrl).
10. **Provenance:** Security pages + programme claims = DOCUMENTED_FACT (live-fetched); pressure hypothesis = VARDHAN_INFERENCE; no-breach assertion = DOCUMENTED_FACT (profiles §3).

## 2. JPMorgan — HOLD (score 60)

1. **Context:** Global universal bank; FLARE applied-research lab; Feb-2022 metro QKD trial (800 Gbps, blockchain app) + quantum-resistant ledger research (JPM-01..04).
2. **PROBLEM hypothesis:** Unclear whether JPMC faces near-term review pressure in the payments-signing / crypto-agility workflow; transition-evidence need is unconfirmed.
3. **WHY_NOW or its absence:** ABSENT (null). Register dates (2022) are stale prose anchors, not fetch-verified ≤180d triggers; live sweep returned zero sources.
4. **Q-Core fit:** Same registry trio as §1 (sealed-receipts DEMONSTRATED / replay-idempotency DEMONSTRATED / ed25519-signing PARTIAL). Lab-analogy only.
5. **TARGET_BUYER_ROLE:** Payments Operations / Trade Finance Operations (function only).
6. **Commercial stage PROPOSED:** DISCOVERY_15K (same scaffold as §1).
7. **GO/HOLD/DROP + reasons:** HOLD. `No WHY_NOW trigger: GO requires a dated, sourced trigger event.` Score 60 = fit 30 + buyer 15 + feasibility 15, evidence/freshness 0 (no URL-backed publicFacts in curated overlay).
8. **Uncertainties:** Deployment scope, production QKD use, vendor selections beyond named partners, and any Q-Core interest are all unknown.
9. **resolveEvidence:** Re-run live DDG sweep (post-throttle) + attach a dated FLARE/QKD event ≤180d with sourceUrl; or DROP if no fresh trigger exists.
10. **Provenance:** 2022 trial + FLARE existence = DOCUMENTED_FACT (register, primary releases); lab-handoff workflow = VARDHAN_INFERENCE; live-sweep emptiness = REAL_PUBLIC_OBSERVATION (run JSON).

## 3. LGT — HOLD (score 60)

1. **Context:** Liechtenstein princely-owned private bank (~CHF 386bn AUM); 2022 direct BTC/ETH offering via SEBA broker-custodian (LGT-01..04).
2. **PROBLEM hypothesis:** Unclear whether LGT faces near-term review pressure in custody-instruction evidence; segregation-evidence need is unconfirmed.
3. **WHY_NOW or its absence:** ABSENT (null). Register dates (2022/2024/2025 anchors) are not fetch-verified ≤180d triggers; live sweep returned zero sources.
4. **Q-Core fit:** Same registry trio as §1 (sealed-receipts DEMONSTRATED / replay-idempotency DEMONSTRATED / ed25519-signing PARTIAL). Lab-analogy only.
5. **TARGET_BUYER_ROLE:** Payments Operations / Trade Finance Operations (function only).
6. **Commercial stage PROPOSED:** DISCOVERY_15K (same scaffold as §1).
7. **GO/HOLD/DROP + reasons:** HOLD. `No WHY_NOW trigger: GO requires a dated, sourced trigger event.` Score 60, same composition as §2.
8. **Uncertainties:** Custody architecture, key management, regulator interactions, and any Q-Core interest are unknown.
9. **resolveEvidence:** Re-run live DDG sweep (post-throttle) + attach a dated custody event ≤180d with sourceUrl; or DROP if none exists.
10. **Provenance:** SEBA offering + scale figures = DOCUMENTED_FACT (register); custody-evidence workflow = VARDHAN_INFERENCE; live-sweep emptiness = REAL_PUBLIC_OBSERVATION (run JSON).

## 4. Swift — HOLD (score 60)

1. **Context:** Belgian cooperative messaging infrastructure (NOT a bank); Customer Security Programme + CSCF attestation regime since 2016-2017; Feb-2016 Bangladesh Bank trigger = industry-risk context, NOT a Swift deficiency (SWF-01..04).
2. **PROBLEM hypothesis:** Unclear whether any Swift-connected institution faces near-term attestation-evidence pressure; lab-tooling need is unconfirmed.
3. **WHY_NOW or its absence:** ABSENT (null). Newest register item (SWF-03, 2026-05 retrospective) was not fetch-verified in this sweep, so no dated sourced trigger ≤180d exists in engine input.
4. **Q-Core fit:** Same registry trio as §1 (sealed-receipts DEMONSTRATED / replay-idempotency DEMONSTRATED / ed25519-signing PARTIAL). Lab-analogy only.
5. **TARGET_BUYER_ROLE:** Payments Operations / Trade Finance Operations (function only).
6. **Commercial stage PROPOSED:** DISCOVERY_15K (same scaffold as §1).
7. **GO/HOLD/DROP + reasons:** HOLD. `No WHY_NOW trigger: GO requires a dated, sourced trigger event.` Score 60, same composition as §2.
8. **Uncertainties:** No Swift control failure asserted; whether any member institution wants lab attestation tooling is unknown.
9. **resolveEvidence:** Re-run live DDG sweep (post-throttle) + attach a dated CSCF-cycle event ≤180d with sourceUrl; or DROP if none exists.
10. **Provenance:** CSP/CSCF existence + 2016 trigger = DOCUMENTED_FACT (register); attestation workflow = VARDHAN_INFERENCE; 2016 incident cited as context, never as deficiency.

## Score composition (deterministic, from `scoreOpportunity`)

| Company | Evidence /30 | Fit /30 | Buyer /15 | Feasibility /15 | Freshness /10 | Total |
|---|---|---|---|---|---|---|
| HSBC | 10 (corroborated facts only; no whyNow) | 30 (DEMONSTRATED) | 15 | 15 | 0 | **70** |
| JPMorgan | 0 (no URL-backed publicFacts) | 30 (DEMONSTRATED) | 15 | 15 | 0 | **60** |
| LGT | 0 (no URL-backed publicFacts) | 30 (DEMONSTRATED) | 15 | 15 | 0 | **60** |
| Swift | 0 (no URL-backed publicFacts) | 30 (DEMONSTRATED) | 15 | 15 | 0 | **60** |

- Curated overlays score 0 on evidence because excerpts are register-derived
  (httpStatus 0), not fetch-verified HTTP-200 pages — an honest reflection of
  the throttle, not a data error. A successful live re-sweep that fetch-verifies
  register URLs would restore the corroboration points where URLs verify.
- Freshness is 0 everywhere because no brief carries a WHY_NOW. This is the
  single binding constraint on GO across the whole set.

## Artifact map

| Artifact | Path | Consumer |
|---|---|---|
| Ranked summaries (Rust contract) | `intelligence_plane/.research/briefs/ranked.json` | `GET /v1/intelligence/briefs` |
| Full brief — HSBC | `intelligence_plane/.research/briefs/hsbc.json` | Operator review |
| Full brief — JPMorgan | `intelligence_plane/.research/briefs/jpmorgan.json` | Operator review |
| Full brief — LGT | `intelligence_plane/.research/briefs/lgt.json` | Operator review |
| Full brief — Swift | `intelligence_plane/.research/briefs/swift.json` | Operator review |
| Builder (thin IO wrapper; pure logic in `SweepBriefing.ts`) | `intelligence_plane/scripts/build-ranked-briefs.ts` | Reproducibility |
| Live evidence — HSBC | `intelligence_plane/.research/companies/hsbc-com/run_20261017_93640ac8.json` | Audit trail |
| Honest-empty runs | `jpmorgan-com/run_20261017_75a48bb2.json`, `lgt-com/run_20261017_909ee989.json`, `swift-com/run_20261017_6e0e0b07.json` | Audit trail |
| Curated registers | `research/SOURCE_REGISTER.md`, `research/bank_profiles/*.md` | Audit trail |

## Honesty checklist (signed off this run)

- [x] Zero fabricated dates: no `publishedDate`/`eventDate` invented; register
  prose dates (e.g. `2025-09`, `2022-02`, `2026-05`) never promoted into engine input.
- [x] Zero fabricated URLs: lineage check confirms every brief `sourceUrl` exists
  in the live run JSON or SOURCE_REGISTER.
- [x] Only GO if a genuinely dated fresh trigger ≤180d is present in engine input
  — none was, so zero GO and all `draft: null` with `draftBlockedReason` set.
- [x] Function-only buyer roles; no named persons, no guessed contacts.
- [x] No breach / control-failure / deficiency language asserted against any target.
- [x] Swift treated as messaging infrastructure, not a bank; 2016 incident cited
  as programme context only.

## Throttle note + close

- JPMorgan / LGT / Swift briefs carry `limitations[]`: `Live DDG sweep throttled (HTTP 202 challenge) — brief built from curated SOURCE_REGISTER; re-run live sweep before outreach`. Curated rows use httpStatus 0 and verified:false; no register prose date was promoted into a pipeline `publishedDate`/`eventDate`.
- Verification log (this run): `ranked.json` has 4 entries with exact Rust keys
  (`company, verdict, score, signal_url, why_now, buyer_role` — confirmed against
  `BriefSummary` in `backend/control_plane_api/src/intelligence_briefs.rs`);
  per-company `<slug>.json` all HOLD (HSBC 70, JPMorgan/LGT/Swift 60), all
  `whyNow: null`, all `draft: null` with HOLD `draftBlockedReason`; every
  `sourceUrl` traced to the live run JSON or SOURCE_REGISTER (lineage check clean).
- **No GO → no outreach sent.** All four drafts are null with `draftBlockedReason: Brief-without-email: verdict is HOLD; outreach drafts require GO.` Re-sweep to resolve HOLDs (freshness rule: first corroborated MEDIUM+ source with eventDate/publishedDate ≤180d) before any human-reviewed outreach.
- Test evidence: `npx vitest run tests/liveOpportunitySweep.test.ts` (still green) +
  `cargo test -p control_plane_api --test intelligence_briefs` with
  `VARDHAN_BRIEFS_PATH` pointed at the new `ranked.json` — exact commands and
  outputs reported in the Stage 5 completion report.
