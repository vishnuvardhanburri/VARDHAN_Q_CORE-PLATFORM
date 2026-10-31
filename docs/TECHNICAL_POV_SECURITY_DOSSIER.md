# Vardhan Q-Core: Technical PoV Security Dossier

**Document Classification:** Authoritative Technical & Commercial Disclosure  
**Release Version:** `2.0-STAGING`  
**Consolidated Evidence Date:** `2026-10-31`  
**Repository Reference:** `VARDHAN_Q_CORE-PLATFORM` (`main@b87b475`)

---

## 1. Executive Summary & Architecture Boundary

**Vardhan Q-Core** is an advanced post-quantum cryptographic (PQC) and quantum-resilient financial transaction infrastructure platform. Engineered from first principles for mission-critical institutional banking environments, Q-Core provides quantum-safe digital signatures, immutable finding receipts, deterministic idempotency, exact integer minor-unit accounting, and hardware-enforced cloud key custody.

### Operational Deployment Boundary

The platform enforces a transparent, 3-tier operational governance model:

```
+-----------------------------------------------------------------------------------------+
| LEVEL 1: LOCAL POV & SANDBOX EVALUATION                                                 |
| Status: VERIFIED & OPERATIONAL                                                          |
| - NIST FIPS 204 (ML-DSA-87) + Ed25519 dual-signature engine verified                   |
| - NIST FIPS 203 (ML-KEM-1024) quantum key encapsulation verified                       |
| - Exact minor-unit financial arithmetic (eliminates binary floating-point drift)       |
| - BLAKE3 256-bit hash chaining with O(1) trailing-seek audit log verification           |
| - 83/83 core crypto and FIPS 140-3 power-on self-tests (POST) passing                   |
+-----------------------------------------------------------------------------------------+
                                           |
                                           v
+-----------------------------------------------------------------------------------------+
| LEVEL 2: MULTI-NODE STAGING & HARDWARE CUSTODY                                          |
| Status: STAGING ACCEPTANCE VERIFIED                                                     |
| - Raft HA clustering: 14/14 node failure, split-brain, and recovery drills passed      |
| - Live AWS KMS hardware CMK envelope encryption in Europe Stockholm (eu-north-1)       |
| - Zero-plaintext disk persistence: key material restored purely in volatile memory      |
| - Live public PQC TLS 1.3 audit: negotiated X25519MLKEM768 hybrid key exchange         |
| - 3-tier PQC X.509 PKI test capability with fail-closed rotation and revocation         |
+-----------------------------------------------------------------------------------------+
                                           |
                                           v
+-----------------------------------------------------------------------------------------+
| LEVEL 3: PRODUCTION LIVE RAILS & INSTITUTIONAL CLEARING                                 |
| Status: PRODUCTION BLOCKED (NOT APPROVED FOR LIVE RAILS)                                |
| Strictly blocked from live banking transactions until 5 external blockers close:       |
| 1. BLK-001: Counterparty Banking PKI & Trust Federation (Root CA exchange)              |
| 2. BLK-002: CMVP / FIPS 140-3 Cryptographic Module Laboratory Certification             |
| 3. BLK-003: AER-KEP-Q Independent Specialist Cryptographic Review                       |
| 4. BLK-004: Payment-Network Counterparty Sandbox Certification                         |
| 5. BLK-005: Institutional Governance & Regulatory Non-Objection (PRA/FCA / Fed / ECB)   |
+-----------------------------------------------------------------------------------------+
```

---

## 2. Evidence Portfolio: Three Progressive Engineering Sprints

Q-Core maintains sanitized, timestamped, and machine-verifiable evidence files for each phase of institutional evaluation:

```
+-----------------------------------------------------------------------------------------------+
| PHASE 1: Live PQC TLS 1.3 & IETF Conformance                                                  |
| Report: docs/PQC_VALIDATION_REPORT.md                                                         |
| - Live Public TLS 1.3 Audit: Cloudflare demo endpoint negotiated hybrid X25519MLKEM768        |
| - IETF Interoperability Suite: 12/12 tests passed against Botan, BouncyCastle, Entrust artifacts|
+-----------------------------------------------------------------------------------------------+
                                               |
                                               v
+-----------------------------------------------------------------------------------------------+
| PHASE 2: External X.509 PQC PKI Test Capability & Rotation                                    |
| Report: docs/PKI_INTEROP_VALIDATION_REPORT.md                                                 |
| - 3-Tier ML-DSA-87 Hierarchy: Root CA -> Intermediary CA -> Leaf Signers                      |
| - Strict Path & Extension Validation: Path, dates, BasicConstraints, KeyUsage digitalSignature |
| - Fail-Closed Negative Suite: Untrusted CAs, expired certs, tampered DER, bad signatures, CRL |
| - Deterministic Rotation Lifecycle: cert_v1 -> cert_v2; stale certs strictly rejected fail-closed|
+-----------------------------------------------------------------------------------------------+
                                               |
                                               v
+-----------------------------------------------------------------------------------------------+
| PHASE 3: Live AWS KMS Hardware Custody & Daemon Restart Recovery                              |
| Report: docs/AWS_KMS_DAEMON_RECOVERY_REPORT.md                                                |
| - Cloud Hardware CMK: ARN arn:aws:kms:eu-north-1:755376534413:key/86a104c0-... (Enabled)      |
| - Zero Plaintext Leakage: Persistent envelope contains ONLY ciphertext + 184-byte wrapped DEK  |
| - Daemon Cold Restart: Hardware kms:Decrypt call -> in-memory zeroizing key restore -> valid  |
|   ML-DSA-87 transaction signing across multiple genuine process terminations                  |
| - Tamper Defense: 1-byte envelope mutation rejected on daemon startup fail-closed             |
+-----------------------------------------------------------------------------------------------+
```

---

## 3. Strict Institutional Governance Matrix

To maintain compliance with banking audit standards, Q-Core classifies every capability using strict commercial categories:

| Governance Category | Authoritative Safe Meaning | Operational Scope |
| :--- | :--- | :--- |
| **Tested and reproducibly validated** | Verified with reproducible cryptographic test evidence | Core primitives, local consensus, in-memory recovery, and automated negative controls |
| **Available for controlled customer evaluation** | Implemented and deployable in customer private VPC/sandbox | Multi-node Raft clustering, customer KMS/HSM integration, and isolated PQC PKI test harness |
| **Requires independent/counterparty validation** | Formal institutional external dependency (Blocked from live rails) | Banking PKI federation (`BLK-001`), accredited CMVP lab certification (`BLK-002`), regulator non-objection (`BLK-005`) |

### Detailed Capability Audit

| Dimension | Governance Category | Status & Evidence |
| :--- | :--- | :--- |
| **Dual Post-Quantum Signing (ML-DSA-87 + Ed25519)** | **Tested and reproducibly validated** | 83/83 unit/FIPS KATs passed; canonical ISO 20022 dual receipts verified. |
| **Post-Quantum Key Exchange Primitives (ML-KEM-1024)** | **Tested and reproducibly validated** | FIPS 203 Known Answer Tests passed; `core_crypto` pairwise consistency verified. |
| **Public Demo PQC TLS 1.3 Key Exchange** | **Tested and reproducibly validated (Edge-Terminated)** | Live CertKit audit verified client-to-Cloudflare-edge `X25519MLKEM768` hybrid key exchange. *Note: In the on-demand demo (`./qcore share`), TLS terminates at the Cloudflare edge and routes over an encrypted tunnel to origin; dedicated end-to-end VPC TLS termination via `pq_shield` is available for controlled customer evaluation.* |
| **Hardware Envelope Custody (AWS KMS)** | **Tested and reproducibly validated** | Live `eu-north-1` hardware CMK round-trip and daemon cold restarts verified. |
| **Cloud & HSM Agnosticism** | **Available for controlled customer evaluation** | Abstract `KeyProtector` SPI supporting AWS KMS, GCP KMS, Vault Transit, PKCS#11. |
| **Isolated PQC PKI Test Hierarchy & Rotation** | **Available for controlled customer evaluation** | 3-tier ML-DSA-87 path validation, negative tamper tests, and rotation verified in test harness. |
| **Counterparty Banking PKI Federation (`BLK-001`)** | **Requires independent/counterparty validation** | Requires counterparty central bank / Tier-1 commercial bank production root CA exchange. |
| **Cryptographic Laboratory CMVP (`BLK-002`)** | **Requires independent/counterparty validation** | Requires formal testing by an accredited NVLAP laboratory for NIST CMVP certificate. |
| **Independent Cryptographic Audit (`BLK-003`)** | **Requires independent/counterparty validation** | Requires third-party specialist peer review of the AER-KEP-Q epoch protocol. |
| **Clearing Network Sandbox (`BLK-004`)** | **Requires independent/counterparty validation** | Requires counterparty interbank testing on SWIFT / Fedwire / CHAPS sandboxes. |
| **Regulatory Non-Objection (`BLK-005`)** | **Requires independent/counterparty validation** | Requires supervisory non-objection under PRA/FCA SS1/21, NYDFS, or EU DORA. |

---

## 4. Commercial Entry Path: Discovery to Enterprise PoV

Financial institutions and clearing counterparties do not purchase unvetted cryptographic software for live rails. The engagement follows a structured, risk-free commercial onboarding model:

### Step 1: Architecture & Security Discovery (`qcore_architecture_evaluation`)
* **Fixed Fee:** £15,000 (2 weeks)
* **Objective:** Review institutional cryptographic posture, catalog algorithm migration timelines, assess ISO 20022 message flows, and map HSM key custody requirements.
* **Deliverable:** Bespoke Quantum Threat Impact Assessment & System Integration Specification.

### Step 2: Technical Problem Validation PoV (`qcore_proof_of_value`)
* **Fixed Fee:** £65,000 fixed fee
* **Objective:** Deploy Q-Core in the customer's isolated sandbox or private cloud VPC. Run custom transaction workloads, test AWS/GCP KMS or on-prem HSM custody integration, and simulate counterparty PQC dual-signed settlements.
* **Deliverable:** Customer-Specific Acceptance Dossier with benchmarked throughput and latency metrics under simulated quantum attack scenarios.

### Step 3: Enterprise Subscription / Sovereign Infrastructure Licensing
* Following successful PoV acceptance, institutions license Q-Core under multi-year core subscriptions or transition to full sovereign infrastructure licensing.

---

## 5. Verification Commands

All evidence reported in this dossier is 100% reproducible directly from the repository:

```bash
# 1. Run baseline workspace unit and FIPS tests (83/83 Pass)
cargo test -p core_crypto

# 2. Run Phase 2 PQC X.509 PKI Chain & Rotation Test Suite
python3 tests/interop/test_pqc_pki_chain_rotation.py

# 3. Run Phase 3 Live AWS KMS Custody & Daemon Recovery Suite
python3 scripts/verify_phase3_kms_daemon_recovery.py
```
