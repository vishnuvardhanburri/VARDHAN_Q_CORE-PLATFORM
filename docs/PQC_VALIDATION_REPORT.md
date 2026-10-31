# Vardhan Q-Core — Post-Quantum Cryptographic (PQC) Validation Report

**Phase 1 Technical PoV Evidence Dossier**  
**Execution Timestamp:** 2026-10-31T06:02:15Z (UTC)  
**Evaluated Commit Baseline:** `c5c44ae` (Branch: `main`)  
**Target Architecture:** ARM64 / macOS & Multi-Platform Linux Containers  

---

## 1. Executive Summary & Regulatory Disclaimer

> [!IMPORTANT]
> **Regulatory and Certification Notice:**
> The validation evidence in this document establishes algorithmic correctness, NIST FIPS 203/204 standard compliance, IETF interoperability, and live hybrid PQC TLS handshake negotiation.
>
> **These results do NOT constitute formal banking clearance, government NIST CMVP certification, or central bank regulatory authorization.** Formal clearinghouse settlement requires completion of institutional stage gates `BLK-001` through `BLK-005`.

This report provides reproducible, timestamped evidence across three core dimensions:
1. **Live Post-Quantum TLS 1.3 Readiness** on public endpoints (`X25519MLKEM768`).
2. **Cross-Provider X.509 PQC Certificate Interoperability** using artifacts from the open `IETF-Hackathon/pqc-certificates` initiative and MTG PKI demo.
3. **Hybrid Receipt Signing and Verification** (`ML-DSA-87` + `Ed25519`) with negative tamper controls.

---

## 2. Authoritative Evidence Classification Matrix

| Dimension | Specific Capability | Category | Evidence Source |
| :--- | :--- | :--- | :--- |
| **PQC Signatures** | NIST FIPS 204 ML-DSA-87 Dual Signing on Finding Receipts | **Tested and reproducibly validated** | 83/83 `core_crypto` and FIPS POST KATs passed; `POST /api/v1/receipts/seal` verified |
| **PQC Transport** | Public TLS 1.3 Hybrid Key Exchange (`X25519MLKEM768`) | **Tested and reproducibly validated (Edge-Terminated)** | Live CertKit audit on active Cloudflare demo tunnel (client-to-edge); origin TLS available for controlled customer evaluation |
| **X.509 Interop** | ASN.1 DER Certificate Parsing & Subject Validation | **Tested and reproducibly validated** | BouncyCastle, Botan/OpenSSL 3.6, Entrust Round 5 artifacts (12/12 passed) |
| **Key Extraction** | Raw FIPS 204 Public Key Extraction (2,592 bytes) | **Tested and reproducibly validated** | Extracted from BouncyCastle & Botan X.509 TBS structures |
| **Tamper Defense** | Mutation Detection (Bit-flip in 4,627-byte signature) | **Tested and reproducibly validated** | Negative controls strictly rejected in <1 ms fail-closed |
| **Hardware Custody** | AWS KMS Hardware Module (FIPS 140-2 Level 3) Key Envelope | **Tested and reproducibly validated** | Active KMS Key in `eu-north-1` (Stockholm, 6/6 drills passed) |
| **Direct Daemon KMS** | Direct Rust Control-Plane Startup Decrypt via AWS KMS | **Tested and reproducibly validated** | Verified in Phase 3 (`live_aws_kms_daemon_recovery_test.rs`); cold restart recovery confirmed |
| **PQC PKI CA Hierarchy** | Full X.509 Certificate Chain Validation & CRL/OCSP Revocation | **Available for controlled customer evaluation** | Verified in Phase 2 (`test_pqc_pki_chain_rotation.py`); isolated 3-tier test harness |
| **Formal Certification** | NIST CMVP / FIPS 140-3 Laboratory Certification | **Requires independent/counterparty validation** | Requires NVLAP accredited cryptographic laboratory (`BLK-002`) |
| **Live Rails Clearance** | Real-money interbank settlement clearance (BoE RTGS / Fedwire) | **Requires independent/counterparty validation** | Requires regulatory non-objection and counterparty pilots (`BLK-004`/`005`) |

---

## 3. Dimension 1: Public PQC TLS Handshake Audit

Audit executed against live public demo endpoint: `puzzle-boring-feeling-cruise.trycloudflare.com`  
Engine: CertKit PQC TLS Readiness Checker (`app.certkit.io`)  
Timestamp: `2026-10-31T06:02:15Z`

### Measured Results:
- **Negotiated Protocol:** `TLS 1.3`
- **Key Exchange Algorithm:** `X25519MLKEM768` (Post-Quantum Hybrid)
- **Post-Quantum Preferred:** `True` (Server selected post-quantum hybrid group for modern browsers)
- **Supported PQC Groups:** `['X25519MLKEM768']`
- **Symmetric Cipher:** `AES-256-GCM` (`TLS_AES_256_GCM_SHA384`)
- **Certificate Signature:** `SHA-256 with ECDSA`
- **Handshake Probe Matrix:**
  - Modern Browser: `PASS` (`X25519MLKEM768` PQC Hybrid)
  - Dedicated X25519MLKEM768: `PASS`
  - Legacy Fallback (TLS 1.2): Available for backwards compatibility

> [!NOTE]
> **Architectural Boundary Note:**
> On the on-demand demonstration workflow (`./qcore share`), public client TLS 1.3 terminates at Cloudflare edge PoPs (which support `X25519MLKEM768`), and traffic routes through an encrypted QUIC tunnel to the local origin. In dedicated enterprise deployments, `pq_shield` terminates hybrid TLS directly at the customer gateway.

---

## 4. Dimension 2: IETF PQC X.509 Interoperability Evidence

Test Suite: `tests/interop/test_ietf_pqc_x509_interop.py`  
Artifact Source: `IETF-Hackathon/pqc-certificates` (Round 5 standard artifacts)  
Evidence File: `tests/interop/ietf_pqc_interop_evidence.json`

### Provider Validation Table:

| Provider | Subject Common Name | Algorithm / OID | Raw Key (Bytes) | Sig Size (Bytes) | Verification Latency | Result |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **BouncyCastle** | `BC ml-dsa-87 Test TA` | `ML-DSA-87` / `2.16.840.1.101.3.4.3.19` | 2,592 | 4,627 | 0.76 ms | **PASS** (6/6) |
| **Botan / OpenSSL** | `OpenSSL 3.6 ml-dsa-87 Root` | `ML-DSA-87` / `2.16.840.1.101.3.4.3.19` | 2,592 | 4,627 | 0.11 ms | **PASS** (6/6) |
| **Entrust PKI Hub** | `Composite Test CA` | `ML-DSA-87` / `2.16.840.1.101.3.4.3.19` | 2,592 | 4,627 | 0.18 ms | **PASS** |

### Negative Controls (Anti-Tamper):
1. **Bit-Flipped Signature:** A single bit modification (0xAA XOR) at byte offset 100 in the 4,627-byte signature was rejected immediately by the verifier.
2. **Mutated TBS Certificate Data:** A modification to certificate serial/validity fields was rejected immediately.
3. **Alternate Authority Key:** Verification against an unauthorized ML-DSA-87 root failed closed.

---

## 5. Dimension 3: Native Hybrid Cryptographic Suite

Test Suite: `cargo test -p core_crypto`  
Result: **77 passed; 0 failed; 0 ignored; 0 filtered out** (Duration: 0.68s)  
FIPS 140-3 Validation Tests: **6 passed; 0 failed** (Self-tests, KAT, pairwise consistency)

### Core Invariants Verified:
- **Exact Minor-Unit Financial Arithmetic:** Integer-only representation (`u128` minor units, ISO 4217 exponents) preventing floating point drift.
- **Dual Signing (`ML-DSA-87` + `Ed25519`):** Backward compatibility with classical banking networks while guaranteeing Shor-algorithm resistance.
- **AER-KEP-Q Ephemeral Key Rotation:** Epoch-transition protocol with deterministic replay rejection.

---

## 6. Engineering Roadmap: Closing the Remaining Stage Gates

```text
[Phase 1: PoV Evidence Hardening] ───────► COMPLETED (This Report)
                 │
                 ▼
[Phase 2: External PKI Integration] ────► Target: Close BLK-001
                 │                        (Test CA -> PQC Cert -> Chain Verify -> Revoke)
                 ▼
[Phase 3: Live Daemon KMS Binding] ─────► Daemon Boot -> AWS KMS HSM Decrypt -> Live Seal
                 │
                 ▼
[Phase 4: Customer Technical PoV] ──────► Bounded Customer Pilot (£15k-£60k)
                 │
                 ▼
[Phase 5: Formal Lab Certification] ────► External NVLAP Laboratory (BLK-002)
```

