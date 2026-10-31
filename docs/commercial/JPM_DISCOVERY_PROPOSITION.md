# JPMorgan Chase — £15K Architecture & Security Discovery Proposition
## Benchmarking Quantum-Resistant Blockchain Transaction Verification

**Document Identifier:** `QCORE-PROP-JPM-2026-10`  
**Target Entity:** JPMorgan Chase & Co. (Global Technology Applied Research / Blockchain and Privacy Team)  
**Offer Status:** Technical Research & Benchmarking Proposal Template — Requires Buyer Agreement & Formal Statement of Work  
**Commercial Baseline:** £15,000 GBP Fixed Fee (Codified in [`docs/COMMERCIAL_PRICING_MODEL.md`](../COMMERCIAL_PRICING_MODEL.md))  
**Delivery Timeline:** 48 Hours from Kickoff (Rapid Scoping & Feasibility Mapping)  
**Opportunity Baseline:** Derived from verified public evidence in [`JPM_OPPORTUNITY_VALIDATION.md`](../../JPM_OPPORTUNITY_VALIDATION.md)  

---

## 1. Commercial Context & Strict Evidence Boundary

> [!IMPORTANT]
> **Commercial Disclaimer & Reality Check:**
> - **Commercial Engagement Progression:**
>   - **Stage 1 (Discovery):** 48 hours | £15,000 fixed fee. Rapid, decision-oriented scoping to understand target workflows, assess feasibility, and formulate Stage 2 PoP criteria.
>   - **Stage 2 (Proof of Product - PoP):** 10 days | £60,000 fixed fee. Controlled technical validation & empirical benchmarking running selected workflow in an authorized sandbox.
>   - **Stage 3 (Implementation / Deployment):** 10–15 working days. Integrations, deployment environment, and handover.
>   - **Stage 4 (Annual Licensing):** Foundation (£360K/yr) | Enterprise (£720K/yr) | Advanced Resilience (£1.2M/yr) | Strategic/Sovereign (separately scoped).
> - **Score Meaning:** The internal score of `89 / 100 (P0)` represents a *technical problem and initiative ranking* based exclusively on publicly verified research disclosures on `jpmorganchase.com` (Global Technology Applied Research, Networking and Security R&D, and Blockchain & Privacy research).
> - **Commercial Readiness:** Commercial readiness is strictly **`NOT_ASSESSED (50/100)`**.
> - **Zero Fabricated Intent:** There is **no active purchasing dialogue**, **no confirmed procurement budget**, and **no active vendor tender** at JPMorgan Chase for Q-Core.
> - **Research Alignment:** JPMC Applied Research operates as a scientific research division exploring frontier technologies. Positioning must center on **applied research collaboration and empirical benchmarking**, not enterprise vendor replacement.
> - **Acceptance Criteria are Proposed:** All quantitative metrics in this document are *proposed Discovery hypotheses* to be confirmed or adjusted by the research team during kickoff.

---

## 2. Business Problem & Discovery Objective

### The Strategic Context
JPMorgan Chase Global Technology Applied Research explicitly recognizes quantum computing as an *"inevitable disruption to today's cryptography"* and is actively *"conducting research into methods to adapt blockchain technologies to be quantum resistant."*

Distributed ledger networks (such as Onyx / Kinexys) rely fundamentally on classical asymmetric cryptography (`secp256k1` / `ECDSA` / `Ed25519`) for transaction authorization, receipt generation, and node-to-node validation. Transitioning blockchain consensus and transaction verification to post-quantum cryptography introduces severe technical trade-offs:
1. **Signature Size Explosion:** NIST-standard post-quantum digital signatures (such as `ML-DSA-87`, ~4.6 KB) are ~70x larger than classical elliptic curve signatures (~64 bytes), dramatically increasing block size and network broadcast latency.
2. **Verification Latency & Block Throughput:** Validating complex lattice-based signatures at scale threatens transaction throughput (TPS) on distributed consensus nodes.
3. **Key Rotation Without Network Forks:** Migrating cryptographic key pairs across distributed participants without causing network desynchronization or hard-forks requires formal epoch-based key lifecycle state machines.

### The Objective
A rapid, 48-hour scoping and feasibility engagement to evaluate the problem context of quantum-resistant blockchain adaptations, map transaction envelope architectures, assess integration constraints, and define the exact scope and success metrics for a 10-day **Stage 2 Proof of Product (PoP, £60,000)** benchmarking study. The outcome is a decision-ready roadmap: **Proceed to £60K PoP / Proceed after prerequisites / Stop**.

---

## 3. Scope of Work (48-Hour Rapid Discovery)

```
+-----------------------------------------------------------------------------------+
| DAY 1 (HOURS 1–24): ARCHITECTURE SCOPING & DLT ENVELOPE ANALYSIS                  |
| - Applied Research kickoff: review EVM/DLT transaction envelope schemas.          |
| - Scope dual-signing model: classical secp256k1 vs. ML-DSA-87 containerization.  |
| - Identify trust boundaries, node verification pipeline, and KMS custody hooks.   |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| DAY 2 (HOURS 25–48): FEASIBILITY MAPPING, GAP REGISTER & POP SPECIFICATION        |
| - Assess preliminary latency budgets, block expansion risks, and network impact. |
| - Formulate prioritized cryptographic agility gap register for blockchain rails.  |
| - Deliver Stage 2 Proof of Product (PoP) Statement of Work (SOW) & KPIs.          |
| - Final research readout & decision workshop: Proceed / Remediate / Stop.         |
+-----------------------------------------------------------------------------------+
```

### Detailed Activities
1. **DLT Transaction Envelope Scoping:** Review transaction and receipt envelope structures to evaluate where `ML-DSA-87` post-quantum proofs can be placed alongside `secp256k1` signatures without breaking classical consensus nodes.
2. **Current-State & Trust-Boundary Mapping:** Map validator node ingestion, transaction signing, and verification paths across distributed peers.
3. **Feasibility & Trade-Off Analysis:** Evaluate preliminary constraints regarding block propagation delays, memory footprints, and KMS-backed hardware isolation.
4. **PoP SOW Formulation:** Establish the agreed synthetic transaction corpus (500 receipts) and measurable benchmarking KPIs governing Stage 2.

---

## 4. Synthetic Datasets (Zero Proprietary Code or Data Exposure)

All benchmarking executes in an isolated environment using strictly **synthetic transaction data**:

| Dataset Parameter | Specification | Purpose |
|---|---|---|
| **Corpus Size** | 500 synthetic blockchain transaction envelopes & receipts | Statistically significant sample to measure tail latencies (P95/P99). |
| **Transaction Domain** | Synthetic digital asset settlement, token transfers, smart contract execution receipts | Modeled on enterprise EVM / Onyx-style data structures. |
| **Payload Attributes** | Nonce, gas/fee parameters, contract address, synthetic calldata, classical `secp256k1` signatures. | Evaluates exact envelope size expansion under dual-signing. |
| **Security Controls** | **Zero proprietary bank code, zero live ledger nodes, zero customer data.** | Eliminates internal security review and IP ownership friction. |

---

## 5. Baseline Measurements & Comparison Targets

The Discovery produces an empirical comparison between classical blockchain cryptography and Q-Core's post-quantum dual-signing layer:

| Metric | Classical Baseline (`secp256k1`) | Q-Core Dual-Signing (`secp256k1` + `ML-DSA-87`) | Research Question Answered |
|---|---|---|---|
| **Signature Overhead** | 64 – 65 bytes | ~4,650 bytes (dual-signed envelope) | What is the exact network bandwidth and storage cost per 10,000 tx? |
| **Signing Latency** | Baseline established on test harness | Proposed Target: `< 12 ms` | Can client signing occur without degrading user experience? |
| **Batch Verification Latency** | Baseline verification time | Post-quantum verification latency | How significantly will block verification time increase on validator nodes? |
| **Epoch Key Rotation** | Manual key replacement (risk of fork) | Automated AER-KEP-Q epoch transition (`< 50 ms`) | Can validators rotate keys without stalling consensus? |

---

## 6. Proposed Discovery Acceptance Criteria

> [!NOTE]
> These criteria represent **proposed technical hypotheses** to govern the 2-week benchmarking study. They require review and refinement with the Applied Research team during kickoff.

1. **Vulnerability Identification (Proposed):** `> 80%` of classical cryptographic dependencies in the synthetic transaction schema are cataloged with quantum threat severity ratings.
2. **Dual-Signing Integrity:** 100% of synthetic transactions dual-signed with `ML-DSA-87` and `secp256k1` parse correctly and verify against both independent cryptographic verifiers.
3. **Benchmarking Reproducibility:** Latency and throughput benchmarks demonstrate a relative standard deviation of `< 5%` across 5 consecutive benchmark runs.
4. **Key Rotation Continuity:** The AER-KEP-Q epoch state machine demonstrates zero-downtime key rotation, with expired epoch keys cleanly rejected without causing node synchronization divergence.

---

## 7. Deliverables

At the conclusion of the 10-day research engagement, Vardhan Technologies delivers:
1. **Quantum-Resistant Blockchain Benchmarking Report:** Complete empirical dataset covering latency, memory, block expansion, and verification throughput.
2. **Dual-Signing Integration Blueprint:** Architectural specification for embedding `ML-DSA-87` signatures into EVM/DLT transaction envelopes without breaking classical nodes.
3. **Cryptographic Agility Gap Register:** Comprehensive assessment of migration barriers, HSM/KMS dependencies, and NIST FIPS 204 implementation considerations.
4. **Stage 2 PoP Plan:** Proposed test environment, measurable KPIs, and workload profile for a 10-day £60K sandbox PoP.
5. **Research Readout & Decision Workshop:** Presentation of findings to Applied Research leads with an actionable recommendation: **Proceed / Proceed after prerequisites / Stop**.

---

## 8. Commercial Terms & Boundaries

### Commercial Pricing
- **Fixed Fee:** **£15,000 GBP** (Exclusive of applicable VAT).
- **Duration:** **48 Hours** (Rapid research scoping and feasibility mapping).
- **Invoice Schedule:** 100% upon SOW execution; 30-day payment terms.
- **Prerequisites:** Named research sponsor, confirmed access to authorized sandbox/compute environment, agreed data-handling rules.

### Strict Boundaries & Exclusions
- **OUT OF SCOPE:** Live Onyx / Kinexys production nodes, wholesale clearing rails (Fedwire, CHIPS), or live financial transactions.
- **OUT OF SCOPE:** Institutional PKI federation or cross-bank certificate exchange.
- **OUT OF SCOPE:** Formal CMVP/FIPS lab certification, penetration testing, or regulatory filings.
- **OUT OF SCOPE:** Proprietary JPMC blockchain source code or internal network access.
- **STOP IS A VALID OUTCOME:** If the benchmark reveals that ML-DSA signature size creates prohibitive block propagation delays that outweigh quantum security benefits, this will be documented transparently as an empirical stop decision. The £15K fee entails no obligation to purchase the £60K PoP or production software.

---

## 9. Recommended First-Contact Outreach Brief

### Target Role
- **Recipient Function:** Lead Scientist / Research Director, Networking and Security R&D Team, or Cryptography Lead, Blockchain and Privacy Team (Global Technology Applied Research).

### Outbound Message Draft (Single-Question Focus)

> **Subject:** Question on benchmarking quantum-resistant blockchain transaction verification
>
> Dear [Name],
>
> I am reaching out with one specific engineering question regarding post-quantum cryptography on distributed ledgers.
>
> J.P. Morgan Applied Research’s published focus on adapting blockchain technologies to be quantum-resistant highlights a critical industry challenge: the massive payload expansion (~4.6 KB for ML-DSA-87) and signature verification overhead on high-throughput distributed transaction nodes.
>
> Has empirically benchmarking post-quantum dual-signing (ML-DSA-87 alongside secp256k1) and epoch-based key lifecycle management become an active testing priority for your team—or is this currently remaining at the theoretical evaluation stage?
>
> We are developing VARDHAN Q-CORE, an isolated cryptographic agility platform implementing ML-DSA-87 dual-signing, epoch key rotation (AER-KEP-Q), and hardware-backed KMS recovery. We offer a rapid 48-hour Discovery (£15k fixed fee) using strictly synthetic transaction envelopes to map feasibility and define a bounded 10-day Proof of Product benchmarking study.
>
> Would a brief technical conversation be worthwhile to share our initial lab benchmarks and determine if a 48-hour discovery study would support your ongoing explorations?
>
> Regards,  
> **Vardhan Technologies**
