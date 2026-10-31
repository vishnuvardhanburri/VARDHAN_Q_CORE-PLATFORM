# HSBC — £15K Architecture & Security Discovery Proposition
## Cryptographic Agility for Tokenized Asset Transactions

**Document Identifier:** `QCORE-PROP-HSBC-2026-10`  
**Target Entity:** HSBC Holdings plc (Emerging Technology, Innovation and Ventures / Group Cyber Security)  
**Offer Status:** Exploratory Discovery Proposal Template — Requires Buyer Agreement & Formal Statement of Work  
**Commercial Baseline:** £15,000 GBP Fixed Fee (Codified in [`docs/COMMERCIAL_PRICING_MODEL.md`](../COMMERCIAL_PRICING_MODEL.md))  
**Delivery Timeline:** 2 Weeks (10 Working Days from Kickoff)  
**Opportunity Baseline:** Derived from verified public evidence in [`HSBC_OPPORTUNITY_VALIDATION.md`](../../HSBC_OPPORTUNITY_VALIDATION.md)  

---

## 1. Commercial Context & Strict Evidence Boundary

> [!IMPORTANT]
> **Commercial Disclaimer & Reality Check:**
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
A bounded, 2-week technical evaluation to evaluate the architectural feasibility of Q-Core's **hybrid dual-signing** and **AER-KEP-Q epoch key management** on synthetic tokenized asset transaction records. The outcome is a decision-ready roadmap: **Proceed to £65K Bounded PoV / Proceed after prerequisites / Stop**.

---

## 3. Scope of Work (Two-Week Timeline)

```
+-----------------------------------------------------------------------------------+
| WEEK 1: ARCHITECTURE MAPPING & TRUST BOUNDARIES                                   |
| - Review tokenized asset transaction schema & current signing pipelines.          |
| - Map trust boundaries: client origin -> signing gateway -> ledger verification.  |
| - Establish synthetic asset dataset & classical baseline benchmarks.              |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| WEEK 2: SYNTHETIC-DATA BENCHMARKING & DECISION REPORT                             |
| - Execute Q-Core ML-DSA-87 + Ed25519 dual-signing against synthetic payloads.     |
| - Simulate exposure detection and test AER-KEP-Q automated epoch quarantine.      |
| - Compile empirical gap register and deliver final Discovery Decision Workshop.   |
+-----------------------------------------------------------------------------------+
```

### Detailed Activities
1. **Current-State & Trust-Boundary Mapping:** Map the agreed transaction ingestion, signing, and verification path; identify actors, trust boundaries, KMS dependencies, and downstream consumers.
2. **Hybrid Envelope Design:** Model supplementary data placement for `ML-DSA-87` signatures alongside classical `Ed25519` signatures so legacy nodes verify classical signatures while quantum-aware validators inspect PQC proofs.
3. **Key Lifecycle & Quarantine Simulation:** Test Q-Core’s state machine (`Active` → `Rotating` → `Deprecated` → `Quarantined`) under simulated compromise triggers.
4. **Gap Analysis & PoV Planning:** Evaluate integration dependencies, latency budgets, and security controls against NIST FIPS 203/204 and UK NCSC guidelines.

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
4. **Stage 2 PoV Specification:** Detailed test plan, environment requirements, and measurable success metrics for a £65K bounded PoV.
5. **Final Executive Decision Workshop:** Formal readout with a decision recommendation: **Proceed / Proceed after prerequisites / Stop**.

---

## 8. Commercial Terms & Boundaries

### Commercial Pricing
- **Fixed Fee:** **£15,000 GBP** (Exclusive of applicable VAT).
- **Invoice Schedule:** 100% upon SOW execution; 30-day payment terms.
- **Prerequisites:** Named sponsor, confirmed access to authorized sandbox/synthetic environment, agreed data-handling rules.

### Strict Boundaries & Exclusions
- **OUT OF SCOPE:** Live payment rails (CHAPS, Faster Payments, SWIFT, Bacs), core settlement cutover, or live capital systems.
- **OUT OF SCOPE:** Institutional PKI federation or cross-bank certificate authority exchange.
- **OUT OF SCOPE:** Production SLAs, penetration testing, formal CMVP/FIPS lab certification, or regulatory attestation.
- **OUT OF SCOPE:** Proprietary bank source code or live customer data.
- **STOP IS A VALID OUTCOME:** If the Discovery proves that hybrid PQC introduces unacceptable latency or that existing controls suffice, a stop recommendation is delivered. The £15K fee entails no obligation to purchase the £65K PoV or production software.

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
> We are developing VARDHAN Q-CORE, an isolated cryptographic agility layer providing ML-DSA dual-signing and epoch key rotation with hardware-backed KMS recovery. We have validated this in controlled lab environments (not production rails), and we offer a bounded, 2-week technical discovery (£15k fixed fee) using strictly synthetic transaction data to test architectural feasibility.
>
> Would a brief technical exchange be useful to understand your team's success criteria and determine whether a synthetic discovery would be relevant?
>
> Regards,  
> **Vardhan Technologies**
