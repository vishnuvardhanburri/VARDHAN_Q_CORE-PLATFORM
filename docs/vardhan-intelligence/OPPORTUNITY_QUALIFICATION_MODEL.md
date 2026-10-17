# Mission H — Opportunity Qualification Model

**Source of truth:** `intelligence_plane/src/server/commercial/OpportunityQualification.ts`
**Tests:** `intelligence_plane/tests/opportunityQualification.test.ts` (10 tests)
**Status:** Implemented, tested, deterministic. Pure functions — no network, no clock, no randomness.

> `qualifyOpportunity` / `scoreOpportunity` are pure functions of their input.
> Freshness is derived SOLELY from caller-supplied `whyNow.freshnessDays`
> (never `Date.now()`). An optional `nowIso` is accepted for record-keeping
> only and never affects scoring.

## 1. Scoring weights (0–100, `scoreOpportunity`)

| Dimension     | Max | Composition |
|---------------|-----|-------------|
| `evidence`    | 30  | WHY_NOW present (10) + fresh ≤180d (10) + ≥1 URL-backed public fact (10) |
| `fit`         | 30  | ≥1 DEMONSTRATED mapping → 30; else ≥1 PARTIAL → 15; else 0 |
| `buyer`       | 15  | `buyerRole.function` non-empty (8) + `buyerRole.why` non-empty (7) |
| `feasibility` | 15  | Share of commercial stages with ≥1 concrete `customerInputs` entry, pro-rated and rounded |
| `freshness`   | 10  | Graded on `whyNow.freshnessDays`: ≤30d → 10; ≤90d → 7; ≤180d → 4; stale/absent → 0 |

Worked example (this sweep): HSBC scores **70** = 10 + 30 + 15 + 15 + 0
(no WHY_NOW, so freshness 0 and evidence keeps only the corroboration 10).
JPMorgan / LGT / Swift score **60** = 0 + 30 + 15 + 15 + 0 (no public facts either).

## 2. HARD RULES (enforced in code, tested a–e)

- **(a) GO requires a WHY_NOW.** `whyNow === null` → HOLD with
  `resolveEvidence: 'Provide a dated why-now event with sourceUrl and freshnessDays ≤180.'`
- **(b) GO requires a fresh WHY_NOW.** Missing `sourceUrl`, or
  `freshnessDays > 180` → HOLD with a targeted `resolveEvidence`
  (attach a source / refresh the trigger).
- **(c) GO requires evidenced fit.** No DEMONSTRATED/PARTIAL mapping → HOLD
  (`resolveEvidence: 'Add a capability mapping at DEMONSTRATED or PARTIAL with an evidenceRef.'`).
- **(d) Unsupported claims → DROP (checked FIRST, DROP wins).** Any
  `NOT_SUPPORTED` mapping, or any `PLANNED` mapping scoped to a `PRODUCTION`
  commercial stage, returns DROP with a blocking `verdictReason` and **no**
  `resolveEvidence` (terminal — do not re-sweep, re-scope instead).
- **(e) Speculative security wording → HOLD.** Hypothesis containing
  `vulnerability` / `control failure` / `breach` with no supporting public
  fact → HOLD (`resolveEvidence: 'Add corroborating publicFacts or rephrase…'`).
- **GO conjunction:** all of (a)–(e) pass → GO with
  `verdictReason: 'Qualified: fresh sourced WHY_NOW (Nd), evidenced capability fit, …'`.

## 3. QCORE_CAPABILITY_REGISTRY summary

8 evidenced entries (max claim level capped; claiming higher = unsupported → DROP):

| Capability | Max level | Evidence ref |
|---|---|---|
| `sealed-receipts` | DEMONSTRATED | `backend/vardhan_receipt` / `validate-canonical` |
| `replay-idempotency` | DEMONSTRATED | `backend/vardhan_idempotency` / `g2-replay-idempotency` |
| `tenant-binding` | DEMONSTRATED | `backend/control_plane_api` / `tenant-403-isolation` |
| `ed25519-signing` | DEMONSTRATED | `backend/vault/license` / `ed25519-unit` |
| `ml-dsa-87-signing` | PARTIAL | software-only; HSM-backed signing NOT demonstrated |
| `ml-kem-1024-exchange` | PARTIAL | EXCHANGE ONLY — not at-rest encryption |
| `mtls-service-identity` | PARTIAL | G3 proof cargo scope only |
| `vault-rotation` | PARTIAL | G4 dev drill only, not production rotation |

3 NOT_SUPPORTED guards (`evidenceRef: NONE/NONE` — any use → DROP):

- `multi-node-clustering` — horizontal clustering not demonstrated.
- `production-readiness-perf` — at-scale perf/hardening claims blocked.
- `compliance-certification` — SOC2/FIPS/certification claims blocked.

The sweep uses only `sealed-receipts` (DEMONSTRATED), `replay-idempotency`
(DEMONSTRATED), `ed25519-signing` (PARTIAL) — registry evidenceRefs, never hardcoded.

## 4. Verdict semantics + `resolveEvidence` contract

| Verdict | Meaning | `resolveEvidence` |
|---|---|---|
| GO | All hard rules pass; draft may be produced (GO-only) | absent |
| HOLD | Recoverable evidence gap; safe to **re-sweep** after cooldown / new trigger | **present** — machine-readable next evidence step |
| DROP | Terminal unsupported-claim block; re-sweep will NOT fix | absent — re-scope the capability claim instead |

Consumers: `SweepBriefing.briefForCompany` maps verdict → ranked brief;
`draftOutreachWithReason` returns `draft: null` + reason for anything but GO.

## 5. Commercial stages (land-and-expand)

Every qualified input carries `DISCOVERY_15K → POV_60K → PRODUCTION` stages
with buyer outcome, deliverables, customer inputs, acceptance criteria, and
dependencies. Feasibility scoring reads `customerInputs`; the PLANNED guard
reads the `PRODUCTION` stage. No price appears in drafts unless a stage
carries an explicit `priceNote`.

## 6. Hard-rule → test mapping (all in `opportunityQualification.test.ts`)

| Rule | Test |
|---|---|
| (a) no whyNow → HOLD/DROP, never GO | `(a) no whyNow → HOLD/DROP, never GO` |
| stale whyNow (400d) → not GO | `(b) stale whyNow (freshnessDays 400) → not GO` |
| (c) no capability mapping → not GO | `(c) no capability mapping → not GO` |
| (d) NOT_SUPPORTED (multi-node) → DROP | `(d) NOT_SUPPORTED mapping (multi-node) → DROP` |
| strong input → GO with reason | `(e) strong input → GO with reason` |
| speculative wording → HOLD | `(f) speculative wording → HOLD` |
| determinism (same input → identical verdict+score) | `(g) determinism…` |
| fit dominates (drop fit → score falls ≥25) | `(h) scoring weights…` |
| 8 evidenced + NOT_SUPPORTED guards | `registry: 8 evidenced entries…` |
| PLANNED-for-PRODUCTION → DROP | `planned-as-available for PRODUCTION → DROP` |

## 7. Verdict flow (evaluation order in `qualifyOpportunity`)

1. Unsupported-claim screen (rule d) — DROP wins over everything.
2. WHY_NOW presence / source / freshness (rules a–b) — else HOLD + resolveEvidence.
3. Capability fit (rule c) — else HOLD + resolveEvidence.
4. Speculative-wording ground check (rule e) — else HOLD + resolveEvidence.
5. All pass → GO (no resolveEvidence; draft allowed downstream).

`nowIso` is threaded through for record-keeping but excluded from the verdict
and scoring paths by construction — freshness reads `whyNow.freshnessDays`
only, so replays and test fixtures are bit-stable regardless of wall clock.
