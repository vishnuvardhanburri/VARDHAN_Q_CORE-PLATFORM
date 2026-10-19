# Bank Discovery Briefs — Q-Core Platform (Public Sources Only)

> Discovery scaffolding only. No contact details. No bank internals asserted. No deficiencies, gaps, breaches, or procurement interest asserted. Every workflow is a PRODUCT_HYPOTHESIS requiring explicit customer request and synthetic/lab data only. Claims guardrail: `docs/CUSTOMER_CLAIMS_MATRIX.md`. Platform is NOT PRODUCTION-READY (G1 OPEN, PREPARATION ONLY). Spot-verification 2026-10-17 (all HTTP 200): HSBC quantum hub CONFIRMED (HSBC Holdings plc, IBM algo-trading trial); JPMC QKD release CONFIRMED (17 Feb 2022, Toshiba/Ciena, 800 Gbps); LGT crypto offering CONFIRMED (4 May 2022, SEBA broker+custodian); ISACA CSP article CONFIRMED (20 Jan 2022, Ninad Dhavase).

---

## 1. HSBC — Global Universal Bank

### Verified public signals (transcribed from `research/bank_profiles/HSBC.md`)
- HSBC-01: HSBC maintains a public quantum programme page naming a Group Head of Quantum Technologies and an HSBC×IBM quantum algo-trading trial. Source: <https://www.hsbc.com/who-we-are/hsbc-and-digital/hsbc-and-quantum> (hub active Sep-2025 at fetch).
- HSBC-02: In July 2023 HSBC announced it joined BT and Toshiba's QKD-based quantum-secure metro network to trial financial-transaction and secure-communications scenarios. Source: HSBC media release 5 July 2023.
- HSBC-03: In Sep 2025 HSBC and IBM announced empirical results applying quantum feature extraction to production-scale historical bond-trading data. Sources: HSBC media release + IBM Quantum blog.
- HSBC-04: HSBC publishes annual reports including cyber/security governance disclosures at industry-standard level. Source: HSBC annual-report hub.

### What sources do / do NOT establish
- DO: board-visible quantum exploration with named accountability; QKD-transport experimentation; quantum evaluation against historical datasets; governance-disclosure practice.
- DO NOT: any breach, incident, control failure, architecture detail, internal system name, product version, regulatory deficiency, timeline, budget, deployment scope, or vendor selection beyond named releases. No interest or procurement path for Q-Core is established.

### Proposed workflow + rationale (PRODUCT_HYPOTHESIS)
- Narrowly scoped: evidence-integrity + crypto-agility lab demo — policy-versioned PQC signatures and rotation evidence over customer-selected synthetic datasets, with sealed, independently verifiable receipts.
- Rationale: mirrors the public programme's observable themes (quantum exploration with accountability; crypto-agility experimentation; evaluation against governed datasets) as discovery scaffolding only.

### Likely stakeholder function (to be confirmed)
- Innovation / emerging-technology strategy; with network-security / technology-resilience and markets-technology / model-risk-adjacent functions depending on workflow opted into (all to be confirmed).

### Discovery question
- "How do you independently verify that a selected cryptographic-policy change or sensitive workflow was authorized, executed under the intended policy and supported by tamper-evident evidence?"

### Q-Core relevant capability + existing evidence
- Tamper detection/rejection: `receipt_api` validate 422/400 paths; lab tamper 4/4 PASS (C-01, ADVERSARIAL-LAB).
- Independent re-verification: `vardhan-receipt validate-canonical` + `vardhan_verifier` 72/72 per G1 packet (C-04, CARGO-PROOF).
- PQC implementation existence: ML-DSA-87 unit tests (C-06, UNIT); rotation drill vs DEV Vault, G4 PASS (C-10, INTEGRATION).

### Remaining integration / assurance requirements
- Customer-owned: policy definition, IdP/RBAC binding, HSM/KMS custody, production CA; assessor verification pending (G1 OPEN); performance unevidenced; no certification held.

### First-contact brief paragraph
- "HSBC's public quantum programme — including the BT/Toshiba metro-network trial and the IBM algo-trading evaluation — shows governed emerging-technology exploration. Q-Core's lab-demonstrated complement is narrow: tamper-evident, policy-versioned evidence for a customer-selected workflow, re-verifiable offline (lab tamper 4/4 PASS; 72/72 corpus re-verification). We propose only a discovery conversation to test whether that evidence pattern is useful, using synthetic data."

### 10-minute technical review CTA
- "A 10-minute technical review of one customer-selected workflow: what evidence you would need to independently verify authorization, policy version, and integrity — and whether a lab demo with synthetic data is worth scheduling."

### Claims that must NOT be made
- No production-readiness, performance, certification, multi-node resilience, or quantum-safe-deployment claims; no HSBC internal, deficiency, or interest assertions (C-11..C-14; C-07 boundary).

---

## 2. JPMorgan Chase — Global Universal Bank

### Verified public signals (transcribed from `research/bank_profiles/JPMORGAN.md`)
- JPM-01: In Feb 2022 JPMC, Toshiba and Ciena announced a metro-scale QKD network trial securing a mission-critical blockchain application at up to 800 Gbps. Source: JPMC newsroom release 17 Feb 2022 (+ tech-blog mirror, Ciena release).
- JPM-02: JPMC operates a named applied-research lab (FLARE) authoring public quantum-network research. Source: FLARE named on the Feb-2022 QKD release.
- JPM-03: JPMC published experimental research on high-capacity quantum-secured optical channels in metro-scale operational environments. Source: JPMC research paper PDF linked from the announcement.
- JPM-04: Industry press reported JPMC research on quantum-resistant blockchain networks with FLARE leadership quoted (secondary coverage; primary research existence verified).

### What sources do / do NOT establish
- DO: quantum-resistant transport research at high throughput; institutionalised applied research; published methodology; ledger-layer quantum-resistance research theme.
- DO NOT: any breach, incident, control failure, architecture detail, internal system, product version, deficiency, internal deployment scope, production QKD usage, or vendor selection beyond named partners. No interest or procurement path for Q-Core is established.

### Proposed workflow + rationale (PRODUCT_HYPOTHESIS)
- Narrowly scoped: crypto-agility evidence demo — PQC-signed receipts with KEK rotation and re-verification, bound to declared crypto-policy versions, in a lab on synthetic data.
- Rationale: analogises the public research themes (algorithm transition; published, reproducible method; policy-versioned evidence) as evaluation-lab scaffolding only.

### Likely stakeholder function (to be confirmed)
- Applied-research leadership (FLARE-adjacent) and network research / ledger-technology engineering functions (all to be confirmed).

### Discovery question
- "For a selected security-sensitive workflow, what evidence is needed to independently verify authorization, integrity, policy version and duplicate/replay handling?"

### Q-Core relevant capability + existing evidence
- Replay/idempotency: `is_finding_already_sealed` + `sealed_*.flag` + sled CAS; G2 `g2_durable_idempotency` 4/4; lab replay/20-way-race PASS (C-02, ADVERSARIAL-LAB).
- Tamper rejection: `receipt_api` validate 422/400; lab tamper 4/4 PASS (C-01). Independent re-verification 72/72 (C-04, CARGO-PROOF).
- Tenant binding: org-mismatch 403; lab `cross_tenant` 403 4/4 (C-03, ADVERSARIAL-LAB).

### Remaining integration / assurance requirements
- Customer-owned: policy-version governance, IdP/RBAC, HSM/KMS, production CA/transport (lab ran `plaintext_http`); single-node scope only; assessor verification pending (G1 OPEN).

### First-contact brief paragraph
- "JPMC's published QKD and quantum-resistant research — including the 800 Gbps Toshiba/Ciena trial and FLARE-authored methodology — sets a high bar for reproducible evaluation. Q-Core's lab-demonstrated complement is narrow: policy-versioned, replay-safe, tenant-bound receipts re-verifiable offline (G2 idempotency 4/4; 20-way-race PASS; 72/72 corpus). We propose only a discovery conversation on what transition evidence would matter in your lab, using synthetic data."

### 10-minute technical review CTA
- "A 10-minute technical review of one security-sensitive workflow: the evidence you require for authorization, integrity, policy version, and replay handling — and whether a synthetic-data lab demo is worth scheduling."

### Claims that must NOT be made
- No production-readiness, performance, certification, multi-node, quantum-safe-deployment, or JPMC internal/deficiency/interest assertions (C-07, C-11..C-14 boundaries).

---

## 3. LGT Private Banking — Private Bank (Custody Workflow)

### Verified public signals (transcribed from `research/bank_profiles/LGT.md`)
- LGT-01: In 2022 LGT Bank announced direct Bitcoin/Ether investments for clients with SEBA Bank as broker and custodian (offering live since May 2022; announced 4 May 2022). Source: LGT newsroom.
- LGT-02: Industry coverage corroborates LGT's selection of SEBA Bank for digital-asset custody and brokerage services (secondary; primary announcement verified).
- LGT-03: LGT is a Liechtenstein princely-family-owned private banking group reporting ~CHF 386bn AUM and ~6,000 staff across 40+ locations (tertiary profile tracing cited disclosures).
- LGT-04: LGT maintains public institutional pages describing princely-ownership heritage and global wealth-management footprint (anchor item only).

### What sources do / do NOT establish
- DO: regulated private-bank digital-asset access via a specialist broker/custodian partner; separation of custody/brokerage duties; group scale and continuity.
- DO NOT: any breach, incident, control failure, custody architecture, key-management, or regulator-interaction detail; internal systems or versions. No interest or procurement path for Q-Core is established.

### Proposed workflow + rationale (PRODUCT_HYPOTHESIS)
- Narrowly scoped: custody control-evidence lab demo — sealed per-tenant receipts plus replay-safe submission for custody instructions, evidencing which tenant an instruction belonged to (synthetic data only).
- Rationale: analogises the public custody-partnership themes (segregation of duties; instruction integrity) as lab evidence scaffolding; Q-Core never replaces custody systems, HSM/KMS, or assessors.

### Likely stakeholder function (to be confirmed)
- Digital-assets / custody operations and custody-oversight / operations-risk functions (all to be confirmed).

### Discovery question
- "Is there a defined custody-related workflow where independently verifiable, tenant-bound evidence of an authorized instruction would materially improve assurance?"

### Q-Core relevant capability + existing evidence
- Tenant binding: org-mismatch 403; lab `cross_tenant` 403 4/4 (C-03, ADVERSARIAL-LAB).
- Replay-safe sealing: `is_finding_already_sealed` + sled CAS; G2 4/4 + 20-way-race PASS (C-02). Tamper rejection 4/4 PASS (C-01). Offline re-verification 72/72 (C-04).

### Remaining integration / assurance requirements
- Customer-owned: custody-system integration, IdP/RBAC, HSM/KMS custody (DEV Vault drill only, C-10), production transport/CA; single-node scope; assessor verification pending; no certification.

### First-contact brief paragraph
- "LGT's public SEBA partnership shows regulated custody access with separated broker/custodian duties. Q-Core's lab-demonstrated complement is narrow: per-tenant, replay-safe, tamper-evident receipts for a customer-defined custody instruction workflow, re-verifiable offline (cross-tenant 403 4/4; idempotency 4/4; 72/72 corpus). We propose only a discovery conversation on whether that evidence pattern would add assurance, using synthetic data."

### 10-minute technical review CTA
- "A 10-minute technical review of one custody-related workflow: whether tenant-bound, independently verifiable instruction evidence would help — and whether a synthetic-data lab demo is worth scheduling."

### Claims that must NOT be made
- No custody-system replacement, key-custody, production-readiness, performance, certification, multi-node, or LGT internal/deficiency/interest assertions (C-09..C-14 boundaries).

---

## 4. Swift — Financial-Messaging Infrastructure (NOT a Bank)

### Verified public signals (transcribed from `research/bank_profiles/SWIFT.md`)
- SWF-01: Swift is a Belgian cooperative founded 1973 providing the main cross-border payments messaging network plus BIC assignment and Sibos (~11,000 institutions, 200+ countries). Tertiary profile of long-stable facts.
- SWF-02: Following 2016 fraud cases, Swift introduced the Customer Security Programme with a mandatory-controls framework (CSCF: 16 mandatory + 11 advisory at v1) and an attestation regime. Source: ISACA Journal synthesis (20 Jan 2022, Ninad Dhavase) of Swift disclosures.
- SWF-03: A 2026 retrospective traces a decade of mandatory CSP controls reshaping endpoint security, with rising attestation submission rates (secondary retrospective; programme existence verified).
- SWF-04: In Feb 2016 attackers issued ~35 fraudulent Swift instructions moving funds from Bangladesh Bank's New York account — the event that triggered the CSP (historical public fact; industry-risk context, NOT a Swift deficiency claim).

### What sources do / do NOT establish
- DO: systemic messaging role; community-wide mandatory, attestable control regime; decade-long control evolution; 2016 incident as programme context.
- DO NOT: any Swift control failure, architecture detail, internal system, product version, or regulatory deficiency. The 2016 incident establishes attacker abuse of a customer endpoint, not a network deficiency; Swift is programme owner, not deficient party. No interest or procurement path for Q-Core is established.

### Proposed workflow + rationale (PRODUCT_HYPOTHESIS)
- Narrowly scoped: control-attestation evidence lab demo for a security-control or remediation workflow — mTLS-bound transport plus independently verified per-org receipts that remain re-verifiable across policy versions (synthetic data only).
- Rationale: analogises the CSP's observable pattern (mandatory, attestable controls; longitudinal evidence) as lab scaffolding; Q-Core never replaces CSP/CSCF, audit systems, or assessors.

### Likely stakeholder function (to be confirmed)
- Customer-security / compliance-attestation and security-governance / audit functions (all to be confirmed).

### Discovery question
- "Could independently verifiable evidence for a narrowly scoped security-control or remediation workflow add value to an existing attestation process?"

### Q-Core relevant capability + existing evidence
- mTLS client-auth: G3 `g3_mtls_handshake` 4/4 + `g3_mtls_proof.sh` (C-08, CARGO-PROOF; lab transport `plaintext_http`, prod CA owner-provisioned).
- Fraudulent-instruction analogues: tamper 4/4 PASS (C-01), replay/20-way-race PASS (C-02), cross-tenant 403 4/4 (C-03) — all ADVERSARIAL-LAB, single-node.
- Offline re-verification 72/72 (C-04, CARGO-PROOF).

### Remaining integration / assurance requirements
- Customer-owned: attestation mapping, IdP/RBAC, HSM/KMS, production CA/transport; single-node scope; assessor verification pending (G1 OPEN); no certification; no performance figures.

### First-contact brief paragraph
- "Swift's Customer Security Programme shows how mandatory, attestable controls uplifted community endpoint security over a decade. Q-Core's lab-demonstrated complement is narrow: per-org, tamper-evident receipts for a scoped control workflow — with mTLS-bound transport evidence and offline re-verification (G3 4/4; 72/72 corpus) — offered only as a discovery aid alongside existing attestation, using synthetic data."

### 10-minute technical review CTA
- "A 10-minute technical review of one scoped control workflow: whether independently verifiable evidence would add value to your attestation process — and whether a synthetic-data lab demo is worth scheduling."

### Claims that must NOT be made
- No CSP/CSCF replacement, transport-security, production-readiness, performance, certification, multi-node, or Swift deficiency/interest assertions; never frame the 2016 incident as a Swift failure (C-08..C-14 boundaries).

---

## Appendix — Cross-cutting honesty statements (restates above; no new facts)

- All four briefs transcribe `research/bank_profiles/*.md` (fetched 2026-10-17) and assert nothing beyond those profiles plus the claims matrix.
- Every proposed workflow is a PRODUCT_HYPOTHESIS: synthetic/lab data only, explicit customer request required, no procurement interest implied.
- Q-Core replaces nothing: not inventories, migration programmes, HSM/KMS, custody systems, Swift CSP/CSCF, audit systems, or assessors; at most a complementary discovery aid.
- Platform posture is uniform across briefs: NOT PRODUCTION-READY (G1 OPEN, PREPARATION ONLY); single-node lab scope; lab transport `plaintext_http`; DEV Vault drill only; performance NOT MEASURED; no certification held.
- Swift is classified as financial-messaging infrastructure (cooperative), NOT a bank; the 2016 incident is cited as programme context, never as a Swift deficiency.
