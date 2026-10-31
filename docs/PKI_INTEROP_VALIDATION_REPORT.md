# Q-Core Phase 2: External X.509 PQC PKI Interoperability Validation Report

**Report Identifier:** `QCORE-REP-PKI-INTEROP-2026-10-31`  
**Execution Timestamp:** `2026-10-31T06:18:37Z`  
**Target Milestone:** Phase 2 Institutional Interoperability (`BLK-001` Institutional PKI Bridge)  
**Evidence Artifact:** [`tests/interop/pki_chain_rotation_evidence.json`](../tests/interop/pki_chain_rotation_evidence.json)  
**Automated Test Suite:** [`tests/interop/test_pqc_pki_chain_rotation.py`](../tests/interop/test_pqc_pki_chain_rotation.py)

---

## 1. Executive Summary

This validation sprint establishes and verifies an isolated **Post-Quantum Cryptographic (PQC) X.509 Public Key Infrastructure (PKI)** interoperability layer for Vardhan Q-Core. It validates full 3-tier certificate chain verification, ML-DSA-87 signature verification on financial settlement receipts, comprehensive negative tampering controls, and deterministic certificate rotation with revocation enforcement.

All tests were executed in an isolated interoperability test harness without modifying production cryptographic crates, zero-trust state machines, or live banking rails.

### Strict Compliance & Classification Disclaimers

> [!IMPORTANT]
> **Regulatory and Institutional Boundary:**  
> Integration with external test Certificate Authorities (CAs) and IETF test artifacts establishes **technical interoperability and protocol conformance**. It **does not** constitute banking PKI federation, formal FIPS 140-3 Cryptographic Module Validation Program (CMVP) certification, or regulatory non-objection from central banks (e.g. Bank of England, Federal Reserve, ECB).

| Scope / Dimension | Classification | Operational Meaning |
| :--- | :--- | :--- |
| **X.509 PQC Chain Validation** | **VERIFIED** | 3-tier ML-DSA-87 chain (Leaf → Intermediate → Root) verified; path validation, validity periods, key usage, and algorithm OID enforced. |
| **Receipt Signature Verification** | **VERIFIED** | Settlement receipts signed with ML-DSA-87 (4,627 bytes) verified against leaf certificates anchored in the test trust store. |
| **Negative Controls & Tamper Resistance** | **VERIFIED** | Untrusted rogue CAs, expired certificates, bit-flipped DER structures, corrupted signatures, and revoked certificates are strictly rejected (fail-closed). |
| **Certificate Rotation Lifecycle** | **VERIFIED** | Epoch-based transition: `cert_v1` active → `cert_v2` promoted → `cert_v1` revoked/superseded → subsequent `cert_v1` receipts fail-closed. |
| **Live Rust Control-Plane Daemon Binding** | **IN PROGRESS** | Connect live AWS KMS envelope custody directly to daemon restart lifecycle (Phase 3). |
| **Institutional Banking PKI Federation (`BLK-001`)** | **EXTERNAL BLOCKER** | Requires counterparty central bank / Tier-1 commercial bank production root CA exchange and mutual trust anchor onboarding. |

---

## 2. PQC X.509 PKI Architecture

The Phase 2 validation establishes a dedicated 3-tier test PKI hierarchy utilizing pure **ML-DSA-87** (NIST FIPS 204, OID `2.16.840.1.101.3.4.3.19`):

```
+------------------------------------------------------------------------+
| 1. Dedicated Test Trust Store (PQCTestTrustStore)                      |
|    - Imported External Trust Anchors (e.g., IETF Botan / OpenSSL 3.6)   |
|    - Root CA: CN=Q-Core PQC Test Root CA                               |
|      * Algorithm: ML-DSA-87 (OID 2.16.840.1.101.3.4.3.19)             |
|      * BasicConstraints: CA=TRUE, path_length=2                        |
|      * KeyUsage: keyCertSign, crlSign, digitalSignature                |
+------------------------------------------------------------------------+
                                   |
                                   v
+------------------------------------------------------------------------+
| 2. Intermediate CA (Banking Intermediary CA)                          |
|    - Subject: CN=Q-Core Banking Intermediary CA                        |
|    - Issuer:  CN=Q-Core PQC Test Root CA                               |
|    - BasicConstraints: CA=TRUE, path_length=0                        |
|    - KeyUsage: keyCertSign, crlSign, digitalSignature                |
+------------------------------------------------------------------------+
                                   |
                  +----------------+----------------+
                  |                                 |
                  v                                 v
+----------------------------------+ +----------------------------------+
| 3a. Leaf Signer v1 (Active)      | | 3b. Leaf Signer v2 (Rotated)     |
| - Serial: 3001                   | | - Serial: 3002                   |
| - BasicConstraints: CA=FALSE     | | - BasicConstraints: CA=FALSE     |
| - KeyUsage: digitalSignature     | | - KeyUsage: digitalSignature     |
| - Status Pre: ACTIVE_ACCEPTED    | | - Status Pre: STANDBY            |
| - Status Post: SUPERSEDED_REJECT | | - Status Post: ACTIVE_ACCEPTED   |
+----------------------------------+ +----------------------------------+
```

---

## 3. Automated Test Results & Verification Matrix

The test runner executed 7 core validation and negative security checks against the trust store and receipt verification engine:

| Check ID | Test Description | Expected Behavior | Actual Result | Status |
| :--- | :--- | :--- | :--- | :--- |
| **PKI-001** | Positive 3-tier chain validation (`Leaf v1` → `Intermediary` → `Root CA`) | Validate valid path, dates, key usage, and ML-DSA-87 OID | Validated full path to trusted Root CA | **VERIFIED** |
| **PKI-002** | Settlement receipt signing & verification anchored to X.509 cert | Verify 4,627-byte ML-DSA-87 receipt signature using leaf public key | Cryptographic verification succeeded | **VERIFIED** |
| **PKI-003** | Negative: Untrusted issuer (Rogue CA outside trust store) | Reject leaf certificate signed by unauthorized external root | Fail-closed: `Untrusted issuer: CN=Rogue Untrusted CA` | **VERIFIED** |
| **PKI-004** | Negative: Expired certificate rejection | Reject leaf certificate where `now > not_valid_after_utc` | Fail-closed: `Certificate validity window expired` | **VERIFIED** |
| **PKI-005** | Negative: Tampered certificate data (DER bit-flip) | Reject altered certificate bytes during ASN.1 parsing / signature check | Fail-closed: `ParseError { kind: InvalidValue, location: ["issuer"] }` | **VERIFIED** |
| **PKI-006** | Negative: Tampered ML-DSA-87 signature | Reject mutated 4,627-byte signature | Fail-closed: `InvalidSignature` exception | **VERIFIED** |
| **PKI-007** | Negative: Revoked certificate rejection (CRL / OCSP) | Reject revoked serial numbers matching CRL revocation list | Fail-closed: `Certificate revoked: UNSCHEDULED_HSM_KEY_ROTATION` | **VERIFIED** |

---

## 4. Certificate Rotation Lifecycle Verification

To resolve operational key obsolescence and scheduled key retirement without service interruption, Q-Core implements deterministic epoch transitions:

1. **Pre-Rotation Phase:**
   - `cert_v1` (Serial `3001`) designated as active settlement signer.
   - Financial receipt payload `REC-TEST-PKI-001` signed with `leaf1_priv`.
   - Trust store validates chain and accepts signature.
2. **Rotation Transition Event:**
   - `cert_v2` (Serial `3002`) issued by Intermediary CA.
   - Trust store activates `cert_v2` as authoritative settlement signer.
   - Trust store CRL registers `cert_v1` as revoked with reason `SUPERSEDED_BY_ROTATION_POLICY_EPOCH_2`.
3. **Post-Rotation Phase:**
   - Transaction receipt payload signed with `leaf2_priv` is validated and accepted.
   - Subsequent receipt signed with old `leaf1_priv` is **strictly rejected**:
     ```
     [FAIL-CLOSED] Certificate revoked: SUPERSEDED_BY_ROTATION_POLICY_EPOCH_2
     ```

---

## 5. Next Technical Priorities

1. **Phase 3 (Live KMS Daemon Binding):**
   - Bind AWS KMS Hardware custody directly into the control-plane daemon startup sequence.
   - Verify: `Daemon restart -> read KMS ciphertext -> AWS KMS Decrypt API call -> restore active signing state -> successful ML-DSA-87 receipt signing`.
2. **Phase 4 (Independent Cryptographic Review & Institutional Discovery):**
   - Package sanitized test suites and reports for external cryptographic audit firms.
   - Initiate commercial **Architecture & Security Discovery** and customer-specific **Technical PoVs**.
