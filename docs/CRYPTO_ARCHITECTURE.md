# Vardhan Q-Core — Cryptographic Architecture & Post-Quantum Assurance

## Document Control & Specification Metadata

- **Document Version:** 1.0.0
- **Classification:** Technical Architecture / Cryptographic Specification
- **Product:** Vardhan Q-Core (Submission Integrity & Evidence Verification Engine)
- **Standard Baseline:** NIST FIPS 203 (ML-KEM), NIST FIPS 204 (ML-DSA), RFC 8032 (Ed25519), NIST SP 800-38D (AES-GCM), BLAKE3 Specification
- **Assurance Target:** NIST Post-Quantum Cryptography Security Category 5

---

## 1. Threat Model & Adversary Assumptions

Vardhan Q-Core is engineered to provide cryptographically verifiable proof of transaction and workflow integrity for regulated financial institutions. Its threat model accounts for both classical adversaries and future quantum-enabled adversaries:

### 1.1 Adversary Capabilities
1. **Classical Adversary:** Full network intercept capability, ability to spoof HTTP headers, replay previously captured payloads, inject malicious or malformed JSON submissions, and attempt timing or side-channel attacks against cryptographic verification routines.
2. **Quantum Adversary (Store-Now-Decrypt-Later / Retrospective Forgery):**
   - **Harvest-Now-Decrypt-Later (HNDL):** Adversary intercepts and archives encrypted communications today with the intent of decrypting them once a Cryptanalytically Relevant Quantum Computer (CRQC) becomes available.
   - **Retrospective Evidence Forgery:** Adversary attempts to forge audit receipts or repudiate historical transaction decisions after classical public-key cryptography (RSA, ECDSA, Ed25519) is broken by Shor's algorithm.

### 1.2 System Boundary & Out-of-Scope Defenses
- Q-Core protects **submission integrity, policy compliance evidence, and verifiable transaction receipts**.
- Q-Core complements, but does not replace, transport layer security (TLS 1.3), enterprise identity and access management (IAM), hardware security modules (HSMs), or core banking transaction ledgers.

---

## 2. NIST Security Level 5 Implementation

Vardhan Q-Core selects NIST Post-Quantum Cryptography (PQC) Security Category 5 primitives for all post-quantum operations. NIST Category 5 corresponds to a security level that is as hard to break as a brute-force key search on AES-256 (equivalent to 256 bits of classical and quantum security).

### 2.1 Primary Primitives

| Primitive ID | Algorithm | Specification | NIST Category | Public Key Size | Secret Key Size | Signature / Ciphertext Size |
|---|---|---|---|---|---|---|
| `PQC-SIG-ML-DSA-87` | ML-DSA-87 (Dilithium5) | NIST FIPS 204 | Category 5 | 2,592 bytes | 4,896 bytes | 4,627 bytes |
| `PQC-KEM-ML-KEM-1024` | ML-KEM-1024 (Kyber1024) | NIST FIPS 203 | Category 5 | 1,568 bytes | 3,168 bytes | 1,568 bytes |
| `CLASSICAL-SIG-ED25519` | Ed25519 | RFC 8032 | Classical (128-bit) | 32 bytes | 32 bytes | 64 bytes |
| `SYM-CIPHER-AES-256-GCM` | AES-256-GCM | NIST SP 800-38D | Category 5 | 32 bytes (key) | N/A | 12B nonce + 16B tag |
| `HASH-BLAKE3` | BLAKE3 | BLAKE3 Spec | Category 5 | N/A | N/A | 32 bytes (digest) |
| `HASH-SHA3-512` | SHA3-512 | NIST FIPS 202 | Category 5 | N/A | N/A | 64 bytes (digest) |

---

## 3. Hybrid Dual-Signature Architecture

### 3.1 Rationale for Hybrid Construction
Financial regulators (such as BSI, ANSSI, NIST, and FCA) recommend hybrid constructions during the cryptographic transition era. Pure post-quantum algorithms are relatively young compared to decades-tested elliptic curves. Conversely, pure classical algorithms will be rendered insecure by Shor's algorithm.

Vardhan Q-Core implements a **dual-signature envelope** on every sealed transaction receipt:
1. **Classical Anchor (Ed25519):** High-speed, battle-tested classical signature providing immediate compatibility with existing audit tools and defense against unexpected algebraic vulnerabilities in newly standardized lattice schemes.
2. **Post-Quantum Shield (ML-DSA-87):** NIST FIPS 204 Level 5 module-lattice signature guaranteeing mathematical resistance against quantum computer forgery.

### 3.2 Dual-Signature Verification Rule
Verification of a `VardhanSealedReceipt` strictly enforces logical **AND** semantics:
```
Verdict = Verify(Ed25519, payload_hash, ed25519_sig, ed25519_pub) 
          AND Verify(ML-DSA-87, payload_hash, ml_dsa_87_sig, ml_dsa_87_pub)
```
- If the Ed25519 signature is valid but the ML-DSA-87 signature fails or is missing: the receipt is marked `Invalid`.
- If the ML-DSA-87 signature is valid but the Ed25519 signature fails or is missing: the receipt is marked `Invalid`.
- If the computed canonical payload hash differs from `receipt.payload_hash`: the receipt is marked `Invalid`.

---

## 4. Evidence Commitment & Canonicalization Pipeline

### 4.1 Canonical Payload Construction
To eliminate ambiguity arising from JSON serialization (key ordering, whitespace, number formatting), Q-Core computes canonical digests using a deterministic serialization pipeline:
1. The receipt structure is normalized with deterministic key ordering.
2. Field values are serialized without non-significant whitespace.
3. The resulting canonical byte array is hashed using BLAKE3 (32-byte digest), represented as a 64-character lowercase hex string (`receipt.payload_hash`).

### 4.2 Evidence Commitments
Every transaction processed by Q-Core binds external supporting evidence (e.g., authorization token, input payload, KYC document, policy version) via explicit commitments:
```json
{
  "evidence_id": "ev-8842",
  "content_hash": "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b",
  "category": "authorization_context"
}
```
The independent verifier confirms each commitment's cryptographic binding against the original evidence artifact without requiring direct transmission of sensitive plaintext evidence across untrusted networks.

---

## 5. Key Lifecycle & Custody Integration

### 5.1 Key Lifecycle States
Signing keys managed in `backend/vardhan_keystore` transition through formal lifecycle states:

```
[Active] -------> [Rotating] -------> [Deprecated] -------> [Retired]
   |                 |                     |
   +-----------------+---------------------+-------> [Revoked]
```

- **Active:** Key is authorized to sign new transactions and verify historical receipts.
- **Rotating:** New primary key is generated and activated; current key continues to verify existing transactions and sign draining batches during graceful transition.
- **Deprecated:** Key cannot be used to sign new transactions. It is retained solely for historical receipt verification.
- **Retired:** Key has passed its retention window. Kept in cold archive for dispute resolution.
- **Revoked:** Key compromise suspected or confirmed. Never permitted to sign; receipt verifiers flag receipts signed by revoked keys with a mandatory audit warning.

### 5.2 Key Custody Providers
Q-Core isolates private key material using three custody tiers:
1. **Development (`DevelopmentLocalProtection`):** File-based encrypted store for local testing and CI.
2. **Enterprise Envelope (`ProductionEnvelopeProtection`):** AES-256-GCM envelope encryption using a Master Key derived from OS entropy or environment-injected KMS credentials. Key material is cleared from RAM via `zeroize` on drop.
3. **Hardware Vault / Cloud KMS (`VaultKeyProtectionProvider`):** Direct hardware-backed custody integrating with AWS KMS, HashiCorp Vault, or PKCS#11 hardware security modules (HSMs). Private keys never leave the secure hardware boundary.

---

## 6. Algorithm Agility & Forward Migration

### 6.1 Agility Architecture
Vardhan Q-Core receipts carry explicit algorithm and schema metadata:
- `schema_version`: Identifies receipt structure (current: `"1.1"`).
- `ed25519_key_id`: UUID pointing to the classical signing key and its certificate profile.
- `ml_dsa_87_key_id`: UUID pointing to the ML-DSA-87 public key and parameter set.

### 6.2 Backward Compatibility & Historical Assurance
Receipts generated today are designed to be verifiable 10 to 30 years into the future:
1. Verification does not rely on online calls to the Q-Core platform. The standalone verifier library (`vardhan_verifier`) requires only the receipt JSON and the issuer public keys.
2. If future standards introduce new post-quantum signature schemes (e.g., Falcon/FN-DSA, SPHINCS+/SLH-DSA), Q-Core's schema engine introduces a new schema version while the verifier retains decoders for legacy `"1.1"` ML-DSA-87 receipts.
3. Historical evidence verified against an archived ML-DSA-87 receipt retains legal and cryptographic admissibility regardless of future classical cryptographic deprecations.
