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
| STAGE 1: DISCOVERY / WORKFLOW IDENTIFICATION                                      |
| ID: qcore_architecture_evaluation                                                 |
| Fee: £15,000 fixed fee                                                            |
| Duration: 48 hours                                                                |
| Objective: Identify the institution's specific problem, understand target        |
|            workflow and architecture, establish feasibility and security rules,   |
|            and define the appropriate PoP scope and success criteria.             |
|            A rapid, decision-oriented engagement (not a multi-week project).     |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| STAGE 2: PROOF OF PRODUCT (PoP)                                                   |
| ID: qcore_proof_of_value                                                          |
| Fee: £60,000 fixed fee                                                            |
| Duration: 10 days (active controlled execution window)                            |
| Objective: Demonstrate selected Q-Core workflow in authorized sandbox or VPC,     |
|            execute controlled technical validation, connect to AWS KMS / HSM,     |
|            measure performance and security controls, deliver evidence & results. |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| STAGE 3: IMPLEMENTATION / DEPLOYMENT                                              |
| Duration: 10–15 working days (subject to integration complexity)                  |
| Objective: Implement agreed production-scope components, configure integrations   |
|            and deployment environment, complete operational validation & handover.|
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| STAGE 4: ANNUAL ENTERPRISE PLATFORM AGREEMENT                                     |
| Foundation (£360,000/yr) | Enterprise (£720,000/yr) | Advanced Resilience (£1.2M/yr) |
| Strategic / Sovereign Enclave: Bespoke Air-Gapped (£12,000,000 baseline target)   |
+-----------------------------------------------------------------------------------+
```

---

## 2. Stage 1: Discovery / Workflow Identification

### Commercial Terms
* **Engagement Identifier:** `qcore_architecture_evaluation`
* **Commercial Fee:** **£15,000 fixed fee** (Invoiced 100% upon agreement execution)
* **Delivery Timeline:** **48 hours** — rapid, decision-oriented engagement.

### Scope of Work
1. **Problem & Workflow Identification:** Identify the institution's specific cryptographic or resilience problem; catalog current messaging and settlement workflows.
2. **Architecture & Trust-Boundary Scoping:** Model target trust boundaries, KMS/HSM custody dependencies, and dual-signature requirements without disrupting legacy verification.
3. **Feasibility & Security Requirements:** Establish technical constraints, regulatory drivers (NIST FIPS 203/204, PRA SS1/21), and data handling boundaries.
4. **PoP Success Criteria & Scope Formulation:** Define the specific workflow, test datasets, and measurable criteria that will govern the Stage 2 Proof of Product.

### Tangible Deliverables
* **Executive Problem Statement & Workflow Blueprint:** Documented current-state architecture and trust boundaries.
* **Quantum Threat & Regulatory Impact Summary:** Vulnerability classification and regulatory compliance roadmap.
* **Formal PoP Statement of Work (SOW):** Mutually agreed scope, test datasets, and acceptance criteria for Stage 2.

---

## 3. Stage 2: Proof of Product (PoP)

### Commercial Terms
* **Engagement Identifier:** `qcore_proof_of_value`
* **Commercial Fee:** **£60,000 fixed fee** (Invoiced 50% upon SOW execution, 50% upon final acceptance report delivery)
* **Duration:** **10 days** (controlled technical validation window)

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
3. **Fixed-Price Predictability:** The £15,000 Discovery and £60,000 PoP provide institutional buyers with total cost certainty, eliminating unpredictable consulting billable hours.

---

## 5. Contact & Booking

To initiate an **Architecture & Security Discovery** engagement:
* **Repository & Technical Evidence:** [`github.com/vishnuvardhanburri/VARDHAN_Q_CORE-PLATFORM`](https://github.com/vishnuvardhanburri/VARDHAN_Q_CORE-PLATFORM)
* **Commercial Model Reference:** [`docs/COMMERCIAL_PRICING_MODEL.md`](COMMERCIAL_PRICING_MODEL.md)
* **API Plan Catalogue:** `GET https://<qcore-endpoint>/api/v1/catalog/plans`
