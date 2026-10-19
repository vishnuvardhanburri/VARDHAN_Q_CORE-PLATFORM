# Evaluation Boundaries — Q-Core Platform

> What a customer evaluation IS and IS NOT. HEAD `943e61d` (2026-10-17 06:13 IST) · RC `204642c`.
> Verdict: RELEASE CANDIDATE single-node, NOT PRODUCTION-READY (G1 OPEN, uncommissioned).
> Guardrails: `docs/CUSTOMER_CLAIMS_MATRIX.md` (C-01..C-14) · `docs/EVIDENCE_INDEX.md` · `BANK_DISCOVERY_BRIEFS.md`.

## 1. Synthetic lab vs customer environment

- All demonstrated results come from a synthetic lab: bank lab run 3 = 44/44 PASS (4 profiles × 11 checks) plus 8 PASS-WITH-EXCEPTION, and G2/G3/G4 cargo proofs (single-node / drill).
- Lab profile names (`hsbc` / `jpmorgan` / `lgt` / `swift`) are research labels only — not representations of real bank systems.
- Lab transport was `plaintext_http`; mTLS posture rests on the G3 cargo proof, not the lab baseline.
- No result transfers to a customer environment without a fresh, customer-authorised run on customer-selected synthetic data.

## 2. Data and access requirements

- Synthetic data only. No customer credentials, no production data, no production keys accepted into evaluation.
- Isolated bridge: lab containers only; no contact with customer or bank infrastructure (per `docs/BANK_LAB_RESULTS.md` method).
- Customer authorization required in writing before ANY on-prem activity, data exchange, or connectivity change.
- Prod CA, HSM/KMS, and IdP/RBAC remain owner-provisioned; unevidenced until provisioned and re-tested.

## 3. Acceptance criteria template (copy per evaluation)

- Scope: single workflow, single node, synthetic fixtures; HEAD pinned and recorded.
- Pass bar (example): tamper 4/4 reject (C-01) · replay/race exactly-one-identity (C-02) · cross-tenant 403 (C-03) · corpus re-verify N/N (C-04).
- Exceptions logged as PASS-WITH-EXCEPTION with covering proof cited (G2/G3 pattern); no silent upgrades.
- Sign-off: customer reviewer + platform engineering; G1 assessor path tracked separately (OPEN).

## 4. Known limitations

- G1 PREPARED (OPEN, uncommissioned): no assessor verdict, no certificate (C-14).
- Single-node only: multi-node / HA UNSUPPORTED, `ha_cluster` EXPERIMENTAL (C-11).
- Perf/soak NOT RUN: no throughput, latency, or capacity figures (C-13).
- DEV Vault drill only: production key custody unevidenced (C-10); prod CA unevidenced (C-08).
- Corpus-bound re-verification (C-04, 72/72): new schemas or customer data need a fresh run.

## 5. No SLA or certification implied

- No SLA, no uptime, no support-timescale, and no certification is offered or implied by any evaluation.
- G1 packet is preparation material for a future assessment only — not an audit pass.
- PQC paths (ML-DSA-87, ML-KEM-1024) are unit-tested implementations, not certified or quantum-safe-deployment claims.

## 6. Commercial status

- All stages in §7 are PROPOSALS, not contracts; no statement of work exists until signed.
- No promise is made that Q-Core solves the bank's problem pre-validation; progression requires cited evidence.
- No bank internals, deficiencies, or procurement interest asserted; discovery briefs are PRODUCT_HYPOTHESES.

## 7. Commercial stages (PROPOSED — not contracted)

> Prices are PROPOSED only. No SOW, no SLA, no production commitment. Each stage progresses only on its stated evidence.

### Stage 1 — Discovery (£15k, PROPOSED)

- Customer decision: whether a lab demo on synthetic data is worth scheduling for one selected workflow.
- Scope + deliverables: 10-minute technical review CTA per `BANK_DISCOVERY_BRIEFS.md`; evidence walkthrough (CI table + lab 44/44 + G2/G3/G4 scope); written discovery note with decision question.
- Access + prerequisites: public-sources only; synthetic data if any; no customer creds; no on-prem activity.
- Acceptance criteria: customer confirms problem statement and evidence pattern fit (or declines); no technical pass bar.
- Dependencies + exclusions: excludes integration, prod data, performance, certification, multi-node (C-11..C-14).
- Evidence to progress: signed discovery note + customer authorisation + synthetic dataset definition for Stage 2.

### Stage 2 — Bounded PoV (£60k, PROPOSED)

- Customer decision: whether bounded lab results justify scoping a production assessment (G1 commission path).
- Scope + deliverables: single-workflow PoV on isolated single-node lab; rerun of §3 template; exception log; PoV report pinned to HEAD.
- Access + prerequisites: customer-selected SYNTHETIC data only; isolated bridge; written authorisation; owner-provisioned test CA/keys if mTLS/rotation in scope.
- Acceptance criteria: §3 pass bar met on customer-selected fixtures; all exceptions cited to G2/G3 cargo proofs or logged as gaps.
- Dependencies + exclusions: single-node only; DEV Vault analog unless customer provisions test HSM; no prod cutover; no SLA; G1 still OPEN.
- Evidence to progress: PoV report + corpus re-verification on PoV data; G1 commission decision owned by customer.

### Stage 3 — Production (scoped separately, NOT PRICED)

- Customer decision: whether to commission independent assurance (G1) and separately scope any production activity.
- Scope + deliverables: scoped ONLY after Stage 2 evidence + commissioned G1; SOW, owners, and acceptance criteria defined then — nothing pre-agreed here.
- Access + prerequisites: prod CA/HSM/IdP owner-provisioned with named owners; written authorisation; G1 assessor engaged.
- Acceptance criteria: to be defined in SOW; must include assessor verdict and customer-environment re-verification.
- Dependencies + exclusions: excludes multi-node until evidenced; excludes perf claims until measured; excludes any certification until held.
- Evidence to progress: commissioned G1 verdict + SOW sign-off; until then platform remains NOT PRODUCTION-READY.

## Document control

- Owner: platform engineering. Review on HEAD move, G1 change, or commercial-terms change.
