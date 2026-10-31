# HSBC — £15K Architecture & Security Discovery Proposition
## Cryptographic Agility for Tokenized Asset Transactions

**Document Identifier:** `QCORE-PROP-HSBC-2026-10`  
**Target Entity:** HSBC Holdings plc (Emerging Technology, Innovation and Ventures / Group Cyber Security)  
**Offer Status:** Exploratory Discovery Proposal Template — Requires Buyer Agreement & Formal Statement of Work  
**Commercial Baseline:** £15,000 GBP Fixed Fee (Codified in [`docs/COMMERCIAL_PRICING_MODEL.md`](../COMMERCIAL_PRICING_MODEL.md))  
**Delivery Timeline:** 48 Hours from Kickoff (Rapid, Decision-Oriented Engagement)  
**Opportunity Baseline:** Derived from verified public evidence in [`HSBC_OPPORTUNITY_VALIDATION.md`](../../HSBC_OPPORTUNITY_VALIDATION.md)  

---

## 1. Commercial Context & Strict Evidence Boundary

> [!IMPORTANT]
> **Commercial Disclaimer & Reality Check:**
> - **Commercial Engagement Progression:**
>   - **Stage 1 (Discovery):** 48 hours | £15,000 fixed fee. Rapid, decision-oriented engagement to identify the problem, map workflows, and define PoP scope.
>   - **Stage 2 (Proof of Product - PoP):** 10 days | £60,000 fixed fee. Controlled technical validation running selected workflow in an authorized sandbox.
>   - **Stage 3 (Implementation / Deployment):** 10–15 working days. Integrations, deployment environment, and handover.
>   - **Stage 4 (Annual Licensing):** Foundation (£360K/yr) | Enterprise (£720K/yr) | Advanced Resilience (£1.2M/yr) | Strategic/Sovereign (separately scoped).
> - **Score Meaning:** The internal score of `96 / 100 (P0)` represents a *technical problem and initiative ranking* based exclusively on publicly verified disclosures (Quantinuum tokenized gold pilot, IBM Quantum collaboration, and public statements by Philip Intallura).
> - **Commercial Readiness:** Commercial readiness is strictly **`NOT_ASSESSED (50/100)`**.
> - **Zero Fabricated Intent:** There is **no active purchasing dialogue**, **no confirmed procurement budget**, and **no active vendor tender** at HSBC for Q-Core.
> - **Buyer Roles are Inferred Targets:** Publicly named leaders (e.g., Philip Intallura, William Shoosmith) are identified functions from published documents, not verified customer relationships.
> - **Acceptance Criteria are Proposed:** All quantitative metrics in this document are *proposed Discovery hypotheses* to be confirmed or adjusted by the buyer during kickoff.

---

## 2. Business Problem & Discovery Objective

### The Strategic Context
HSBC has established an in-house Quantum Technologies team within Emerging Technology, Innovation and Ventures and has conducted groundbreaking pilot work applying post-quantum cryptography (PQC) with Quantinuum to tokenized physical gold. Concurrently, leadership has declared that quantum computers will break current encryption standards and that *"the time to act is now."*

However, moving from an isolated partner pilot on tokenized gold to a repeatable, bank-grade cryptographic agility posture introduces critical architectural hurdles:
1. **Schema Disruption:** How to introduce NIST-standard post-quantum signatures (`ML-DSA-87`) without breaking legacy transaction verification pipelines that expect classical elliptic curve (`Ed25519` / `ECDSA`) formats.
2. **Key Lifecycle Management:** How to enforce automated epoch-based key rotation, deprecation, and rapid quarantine without taking transaction validation offline.
3. **Hardware Isolation:** How to bind post-quantum key envelopes to external hardware security modules (HSMs / AWS KMS) without persisting plaintext key material in application memory.

### The Objective
A rapid, 48-hour decision-oriented engagement to identify HSBC's specific tokenized asset transaction problem, map target signing workflows and trust boundaries, establish architectural feasibility and security requirements, and define the precise scope and acceptance criteria for a 10-day **Stage 2 Proof of Product (PoP, £60,000)**. The outcome is a decision-ready roadmap: **Proceed to £60K PoP / Proceed after prerequisites / Stop**.

---

## 3. Scope of Work (48-Hour Rapid Discovery)

```
+-----------------------------------------------------------------------------------+
| DAY 1 (HOURS 1–24): PROBLEM, WORKFLOW & TRUST BOUNDARIES                          |
| - Sponsor & architecture kickoff: review tokenized asset transaction schema.       |
| - Identify target workflow: client origin -> signing gateway -> ledger verifier.  |
| - Map trust boundaries, KMS/HSM dependencies, and legacy verification formats.    |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| DAY 2 (HOURS 25–48): FEASIBILITY, GAP REGISTER & POP SPECIFICATION               |
| - Evaluate architectural feasibility of ML-DSA-87 dual-signing on token payloads.  |
| - Formulate prioritized security & operational gap register.                      |
| - Define Stage 2 Proof of Product (PoP) Statement of Work (SOW) & success metrics. |
| - Final executive decision workshop: Proceed / Proceed after prerequisites / Stop.|
+-----------------------------------------------------------------------------------+
```

### Detailed Activities
1. **Problem & Workflow Identification:** Scope the exact message formats (ISO 20022 `pacs.008` supplementary data or digital asset transfer payloads) where cryptographic agility is required.
2. **Current-State & Trust-Boundary Mapping:** Map the agreed transaction ingestion, signing, and verification path; identify actors, trust boundaries, KMS dependencies, and downstream consumers.
3. **Feasibility & Security Requirements:** Evaluate latency budgets, HSM key custody integration options, and NIST FIPS 203/204 alignment.
4. **PoP SOW Formulation:** Establish the agreed synthetic datasets, test environments, and measurable pass/fail criteria that will govern Stage 2.

---

## 4. Synthetic Datasets (Zero Live Data Exposure)

All benchmarking and testing will occur in an isolated sandbox environment using strictly **synthetic data**:

| Dataset Parameter | Specification | Purpose |
|---|---|---|
| **Corpus Size** | 250 synthetic asset transfer instructions | Sufficient scale to establish deterministic latency distributions. |
| **Asset Domain** | Synthetic tokenized physical gold & collateral transfers | Mirrors the business context of HSBC’s published Quantinuum pilot. |
| **Payload Attributes** | Synthetic asset identifiers, vault references, ISO 20022 message wrappers (`pacs.008` supplementary data). | Tests structural compatibility with banking message standards. |
| **Security Controls** | **Zero live bank data, zero customer identifiers, zero production HSM keys.** | Full compliance with institutional risk and air-gap guidelines. |

---

## 5. Baseline Measurements & Comparison Targets

The Discovery evaluates the exact operational trade-offs of introducing post-quantum cryptography:

| Metric | Classical Baseline (Observed) | Q-Core Hybrid Target (Proposed) | Trade-Off Evaluated |
|---|---|---|---|
| **Signature Payload Size** | ~64 bytes (`Ed25519` / `ECDSA`) | ~4.6 KB (`ML-DSA-87` + classical dual envelope) | Network transmission & ledger block overhead. |
| **Signing Latency** | Baseline established on synthetic data | Target: `< 15 ms` per transaction | Latency impact on high-throughput settlement. |
| **Verification Throughput** | Classical verification speed | Dual-verification speed (legacy + PQC) | CPU cycle consumption on validating nodes. |
| **Exposure Recovery** | Manual key revocation & system restart | Automated epoch quarantine & key rotation via AER-KEP-Q | Downtime and manual operational risk during compromise. |

---

## 6. Proposed Discovery Acceptance Criteria

> [!NOTE]
> These criteria represent **proposed technical hypotheses** to govern the 2-week evaluation. They require formal sponsor review and mutual agreement during project kickoff.

1. **Vulnerability Identification (Proposed):** `> 80%` of classical cryptographic dependencies across synthetic asset metadata are identified and categorized by algorithm class, key length, and quantum vulnerability profile.
2. **Workflow Compatibility (Proposed):** `> 60%` of synthetic tokenized transfer workflows successfully bind to the AER-KEP-Q epoch model without payload rejection or schema modification.
3. **Dual-Verification Backward Compatibility:** 100% of dual-signed messages are successfully verified by a legacy simulator (inspecting only the classical signature) and by Q-Core (verifying both classical and `ML-DSA-87` signatures).
4. **Deterministic Quarantine:** When an exposure alert is triggered, old epoch key material is quarantined within `< 50 ms` in the test environment, rejecting subsequent stale transaction submissions.

---

## 7. Deliverables

At the conclusion of the 10-day engagement, Vardhan Technologies delivers:
1. **Sponsor Problem Statement & Cryptographic Boundary Blueprint:** Verified architectural map of tokenized asset message signing.
2. **Empirical Benchmarking Report:** Reproducible latency, CPU, and payload overhead measurements from synthetic execution runs.
3. **Prioritized Security & Operations Gap Register:** Concrete gap analysis against NIST FIPS 203/204, NCSC PQC timelines, and PRA resilience standards.
4. **Stage 2 PoP Specification:** Detailed test plan, environment requirements, and measurable success metrics for a 10-day £60K Proof of Product (PoP).
5. **Final Executive Decision Workshop:** Formal readout with a decision recommendation: **Proceed / Proceed after prerequisites / Stop**.

---

## 8. Commercial Terms & Boundaries

### Commercial Pricing
- **Fixed Fee:** **£15,000 GBP** (Exclusive of applicable VAT).
- **Duration:** **48 Hours** (Rapid decision-oriented discovery).
- **Invoice Schedule:** 100% upon SOW execution; 30-day payment terms.
- **Prerequisites:** Named sponsor, confirmed access to authorized sandbox/synthetic environment, agreed data-handling rules.

### Strict Boundaries & Exclusions
- **OUT OF SCOPE:** Live payment rails (CHAPS, Faster Payments, SWIFT, Bacs), core settlement cutover, or live capital systems.
- **OUT OF SCOPE:** Institutional PKI federation or cross-bank certificate authority exchange.
- **OUT OF SCOPE:** Production SLAs, penetration testing, formal CMVP/FIPS lab certification, or regulatory attestation.
- **OUT OF SCOPE:** Proprietary bank source code or live customer data.
- **STOP IS A VALID OUTCOME:** If the Discovery proves that hybrid PQC introduces unacceptable latency or that existing controls suffice, a stop recommendation is delivered. The £15K fee entails no obligation to purchase the £60K PoP or production software.

---

## 9. Recommended First-Contact Outreach Brief

### Target Role
- **Recipient Function:** Group Head of Quantum Technologies (Philip Intallura, Emerging Technology, Innovation and Ventures) or Head of Cryptographic Architecture (CISO Organization).

### Outbound Message Draft (Single-Question Focus)

> **Subject:** Question on cryptographic agility for tokenized asset message verification
>
> Dear Philip,
>
> I am reaching out with one specific architectural question rather than assuming HSBC has a gap.
>
> Following HSBC’s published pilot applying post-quantum cryptography to tokenized gold, many enterprise teams are encountering the operational challenge of backward compatibility: how to introduce NIST-standard signatures (such as ML-DSA) into transaction messaging without breaking downstream systems that still expect classical ECDSA envelopes.
>
> Is evaluating hybrid dual-signing and automated key epoch management across tokenized asset records a problem your Quantum Technologies team is actively assessing—or is this already solved within your existing architecture?
>
> We are developing VARDHAN Q-CORE, an isolated cryptographic agility layer providing ML-DSA dual-signing and epoch key rotation with hardware-backed KMS recovery. We have validated this in controlled lab environments (not production rails), and we offer a rapid 48-hour Discovery (£15k fixed fee) using strictly synthetic transaction data to map feasibility and define a bounded 10-day Proof of Product.
>
> Would a brief technical exchange be useful to understand your team's success criteria and determine whether a 48-hour discovery would be relevant?
>
> Regards,  
> **Vardhan Technologies**
