# JPMorgan Chase — £15K Architecture & Security Discovery Proposition
## Benchmarking Quantum-Resistant Blockchain Transaction Verification

**Document Identifier:** `QCORE-PROP-JPM-2026-10`  
**Target Entity:** JPMorgan Chase & Co. (Global Technology Applied Research / Blockchain and Privacy Team)  
**Offer Status:** Technical Research & Benchmarking Proposal Template — Requires Buyer Agreement & Formal Statement of Work  
**Commercial Baseline:** £15,000 GBP Fixed Fee (Codified in [`docs/COMMERCIAL_PRICING_MODEL.md`](../COMMERCIAL_PRICING_MODEL.md))  
**Delivery Timeline:** 2 Weeks (10 Working Days from Kickoff)  
**Opportunity Baseline:** Derived from verified public evidence in [`JPM_OPPORTUNITY_VALIDATION.md`](../../JPM_OPPORTUNITY_VALIDATION.md)  

---

## 1. Commercial Context & Strict Evidence Boundary

> [!IMPORTANT]
> **Commercial Disclaimer & Reality Check:**
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
A bounded, 2-week technical benchmarking study to measure the exact performance, payload expansion, and verification latency of Q-Core’s **ML-DSA-87 dual-signing** and **AER-KEP-Q epoch key management** against synthetic distributed ledger transaction envelopes. The outcome is an empirical research report and decision matrix: **Proceed to £65K Bounded PoV / Proceed after prerequisites / Stop**.

---

## 3. Scope of Work (Two-Week Timeline)

```
+-----------------------------------------------------------------------------------+
| WEEK 1: ARCHITECTURE ANALYSIS & SYNTHETIC CORPUS INGESTION                        |
| - Review EVM/Onyx-style transaction envelope structures & receipt schemas.        |
| - Generate synthetic 500-receipt corpus mirroring real digital asset transfers.    |
| - Establish classical secp256k1 baseline: signing time, payload, verification CPU.|
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| WEEK 2: ML-DSA-87 DUAL-SIGNING BENCHMARKING & EMPIRICAL REPORT                    |
| - Benchmark Q-Core ML-DSA-87 + secp256k1 dual-signing across synthetic corpus.   |
| - Quantify exact TPS impact, block overhead, and signature verification latency.  |
| - Test AER-KEP-Q node epoch key rotation and deliver final Benchmarking Dossier.  |
+-----------------------------------------------------------------------------------+
```

### Detailed Activities
1. **Transaction Envelope Mapping:** Model dual-signature containerization where classical validator nodes verify `secp256k1` while post-quantum verification nodes simultaneously validate `ML-DSA-87` signatures.
2. **Empirical Benchmarking Execution:** Run multi-iteration benchmarks measuring CPU cycle consumption, memory allocations, and latency distributions across signing and verification execution paths.
3. **Key Lifecycle & Epoch Modeling:** Evaluate Q-Core’s `AER-KEP-Q` runtime for automated validator node key rotation across epochs without interrupting consensus.
4. **Hardware-Backed Recovery Evaluation:** Review Q-Core’s fail-closed AWS KMS / HSM recovery mechanism, verifying that node restart does not persist plaintext key material.

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
4. **Stage 2 Bounded PoV Plan:** Proposed test environment, measurable KPIs, and workload profile for a £65K sandbox PoV.
5. **Research Readout & Decision Workshop:** Presentation of findings to Applied Research leads with an actionable recommendation: **Proceed / Proceed after prerequisites / Stop**.

---

## 8. Commercial Terms & Boundaries

### Commercial Pricing
- **Fixed Fee:** **£15,000 GBP** (Exclusive of applicable VAT).
- **Invoice Schedule:** 100% upon SOW execution; 30-day payment terms.
- **Prerequisites:** Named research sponsor, confirmed access to authorized sandbox/compute environment, agreed data-handling rules.

### Strict Boundaries & Exclusions
- **OUT OF SCOPE:** Live Onyx / Kinexys production nodes, wholesale clearing rails (Fedwire, CHIPS), or live financial transactions.
- **OUT OF SCOPE:** Institutional PKI federation or cross-bank certificate exchange.
- **OUT OF SCOPE:** Formal CMVP/FIPS lab certification, penetration testing, or regulatory filings.
- **OUT OF SCOPE:** Proprietary JPMC blockchain source code or internal network access.
- **STOP IS A VALID OUTCOME:** If the benchmark reveals that ML-DSA signature size creates prohibitive block propagation delays that outweigh quantum security benefits, this will be documented transparently as an empirical stop decision.

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
> We are developing VARDHAN Q-CORE, an isolated cryptographic agility platform implementing ML-DSA-87 dual-signing, epoch key rotation (AER-KEP-Q), and hardware-backed KMS recovery. We offer a bounded, 2-week research benchmarking study (£15k fixed fee) using strictly synthetic transaction envelopes to produce reproducible latency, throughput, and block expansion metrics.
>
> Would a brief technical conversation be worthwhile to share our initial lab benchmarks and determine if a synthetic research study would support your ongoing explorations?
>
> Regards,  
> **Vardhan Technologies**
