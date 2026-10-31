# Vardhan Q-Core: Discovery & Technical PoV Commercial Package

**Document Identifier:** `QCORE-COM-DISCOVERY-POV-2026-10`  
**Commercial Model Authority:** Codified in [`docs/COMMERCIAL_PRICING_MODEL.md`](COMMERCIAL_PRICING_MODEL.md) and exposed via `GET /api/v1/catalog/plans`  
**Target Audience:** Chief Information Security Officers (CISOs), Heads of Cryptographic Architecture, and Transaction Banking Infrastructure Leads.

---

## 1. Executive Summary

Transitioning Tier-1 banking rails and financial infrastructure to quantum-safe cryptography cannot be executed as a blind rip-and-replace. Financial institutions face complex regulatory deadlines (NIST FIPS 203/204, PRA/FCA SS1/21, Bank of England RTGS PQC roadmap, EU DORA) while maintaining zero downtime on legacy core payment systems.

Vardhan Technologies provides a **bounded, two-stage technical evaluation pathway** that allows institutional risk, architecture, and engineering teams to evaluate **Q-Core** in private, authorized environments without exposing live capital rails:

```
+-----------------------------------------------------------------------------------+
| STAGE 1: ARCHITECTURE & SECURITY DISCOVERY                                        |
| ID: qcore_architecture_evaluation                                                 |
| Fee: £15,000 fixed fee                                                            |
| Duration: 2 weeks (Kickoff within 48 hours of access)                             |
| Objective: Scope institutional cryptographic posture, inventory algorithms,        |
|            map ISO 20022 message flows, and define measurable PoV criteria.       |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| STAGE 2: BOUNDED TECHNICAL PROOF OF VALUE (PoV)                                   |
| ID: qcore_proof_of_value                                                          |
| Fee: £65,000 fixed fee                                                            |
| Duration: 4 to 6 weeks (10-day active execution window)                           |
| Objective: Deploy Q-Core in customer VPC/sandbox, connect to AWS KMS / CloudHSM,  |
|            run simulated ISO 20022 dual-signing, verify recovery & performance.   |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| STAGE 3: ENTERPRISE SOFTWARE SUBSCRIPTION / SOVEREIGN LICENSING                   |
| Foundation (£360,000/yr) | Enterprise (£720,000/yr) | Advanced Resilience (£1.2M/yr) |
| Strategic / Sovereign Enclave: Bespoke Air-Gapped (£12,000,000 baseline target)   |
+-----------------------------------------------------------------------------------+
```

---

## 2. Stage 1: Architecture & Security Discovery

### Commercial Terms
* **Engagement Identifier:** `qcore_architecture_evaluation`
* **Commercial Fee:** **£15,000 fixed fee** (Invoiced 100% upon agreement execution)
* **Delivery Timeline:** 2 weeks total; formal kickoff within 48 hours of prerequisite access.

### Scope of Work
1. **Cryptographic Algorithm Audit:** Catalog classical algorithms (RSA 2048/4096, ECDSA P-256/P-384) in current payment settlement and messaging pipelines vulnerable to future quantum cryptanalysis (Shor's algorithm).
2. **ISO 20022 Hybrid Architecture Mapping:** Model dual-signature envelope placement (`ML-DSA-87` + classical `Ed25519`) inside `pacs.008` (Customer Credit Transfer) and `pacs.009` (Financial Institution Transfer) supplementary data blocks without breaking legacy downstream parsing.
3. **Hardware Key Custody Integration:** Map existing institutional hardware security modules (AWS KMS / CloudHSM, Google Cloud KMS, Azure Key Vault, or on-prem Thales/Utimaco via PKCS#11) to Q-Core’s envelope protection substrate.
4. **PoV Success Criteria Formulation:** Establish the mutually agreed mathematical, operational, and latency targets that will govern Stage 2 PoV acceptance.

### Tangible Deliverables
* **Quantum Threat Impact Matrix:** System-by-system vulnerability classification and regulatory compliance roadmap.
* **Q-Core Integration Blueprint:** Architectural topology diagram, network port isolation boundaries, and KMS key policy definitions.
* **Formal PoV Statement of Work (SOW):** Fully scoped criteria for Stage 2.

---

## 3. Stage 2: Bounded Technical Proof of Value (PoV)

### Commercial Terms
* **Engagement Identifier:** `qcore_proof_of_value`
* **Commercial Fee:** **£65,000 fixed fee** (Invoiced 50% upon SOW execution, 50% upon final acceptance report delivery)
* **Duration:** 4 to 6 weeks overall (including 10 active test execution days in sandbox)

### Scope of Work
1. **Isolated Sandbox / VPC Deployment:** Deploy Q-Core within the institution’s private cloud VPC (AWS, Azure, GCP) or air-gapped on-premise test lab.
2. **Live Cloud KMS Custody Verification:** Configure live hardware envelope encryption against the bank's dedicated AWS KMS CMK or HSM. Execute cold process restart drills to prove key material is restored in memory without plaintext key persistence on disk.
3. **Dual-Signature Financial Ingress Drills:** Ingest high-volume simulated payment transaction streams. Verify dual-signing (ML-DSA-87 + Ed25519), integer minor-unit financial arithmetic, and BLAKE3 hash-chained audit logging.
4. **Raft Cluster Failover & Split-Brain Drills:** Validate multi-node Raft clustering resilience under network partition and node termination scenarios.
5. **Adversarial & Tamper Injection Controls:** Verify fail-closed behavior against mutated signatures, altered transaction amounts, expired X.509 certificates, and tampered envelope bytes.

### Target Performance Benchmarks Demonstrated
* **Throughput:** >1,500 dual-signed transactions per second sustained under load.
* **Database Recovery (RTO):** <500 ms clean restore across 20,000+ financial entities.
* **Audit Chaining:** O(1) trailing-seek verification with cross-process file locking.

### Tangible Deliverables
* **Institutional PoV Acceptance Dossier:** Signed technical report containing all timestamped verification logs, cryptographic KAT outputs, latency percentiles (p50, p95, p99), and tamper rejection logs.
* **Executive Board Summary:** Clear recommendation on production readiness, regulatory alignment, and recommended licensing tier.

---

## 4. Why Institutions Engage Now

1. **Regulatory Mandates:** Global central banks (Bank of England RTGS PQC Renewal, Federal Reserve, ECB) have initiated the transition to quantum-safe standards. Financial institutions that defer architectural validation risk forced, rushed migrations under regulatory enforcement.
2. **Zero Live Rail Risk:** The Discovery and PoV are strictly sandboxed. Production rails remain explicitly blocked (`PRODUCTION BLOCKED`) until external counterparty federation and formal regulatory non-objection are achieved.
3. **Fixed-Price Predictability:** The £15,000 Discovery and £65,000 PoV provide institutional buyers with total cost certainty, eliminating unpredictable consulting billable hours.

---

## 5. Contact & Booking

To initiate an **Architecture & Security Discovery** engagement:
* **Repository & Technical Evidence:** [`github.com/vishnuvardhanburri/VARDHAN_Q_CORE-PLATFORM`](https://github.com/vishnuvardhanburri/VARDHAN_Q_CORE-PLATFORM)
* **Commercial Model Reference:** [`docs/COMMERCIAL_PRICING_MODEL.md`](COMMERCIAL_PRICING_MODEL.md)
* **API Plan Catalogue:** `GET https://<qcore-endpoint>/api/v1/catalog/plans`
