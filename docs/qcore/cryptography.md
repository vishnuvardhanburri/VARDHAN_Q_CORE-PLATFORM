# Vardhan Q Core — Cryptography

## Cryptographic Subsystem

PQ/Quantum security is a core capability INSIDE Vardhan Q Core. It is NOT a
separate business pillar.

## Primitive Selection

| Primitive | Algorithm | Standard | Usage |
|---|---|---|---|
| KEM | ML-KEM-1024 | FIPS 203 | Key encapsulation (AER-KEP-Q) |
| Signature (PQ) | ML-DSA-87 | FIPS 204 | Receipt signing, ledger signing |
| Signature (Classical) | Ed25519 | RFC 8032 | Receipt dual-signature |
| Hash | BLAKE3 | — | Content hashing, fingerprinting, ledger chain |
| Hash | SHA3-512 | FIPS 202 | Transcript hashing (AER-KEP-Q) |
| Hash | SHA-256 | FIPS 180-4 | Evidence content hash (TS), interop |
| KDF | HKDF | RFC 5869 | Session key derivation |
| AEAD | AES-256-GCM | NIST SP 800-38D | Envelope encryption |
| Key Protection | Argon2id | RFC 9106 | Dev KEK derivation |
| Memory Protection | zeroize | — | Secure memory clearing |

## AER-KEP-Q — Asynchronous Exposure-Resilient Key Establishment

**Quarantine / Reissue**

### Status

Implementation preserved and audited. Not claimed as a universally proven new
cryptographic primitive.

### Architecture

```
Epoch N (Active)
    │
    ├── ML-KEM-1024 shared secret
    ├── HKDF-SHA3-512 session key
    │   ├── Domain tag: "VARDHAN-AER-KEP-Q-v2"
    │   ├── Epoch number
    │   ├── Message ID
    │   ├── Context
    │   └── transaction_id (F-005 binding)
    │
    ▼
Epoch N+1 (Quarantined)
    │
    ├── On exposure detected:
    │   └── EpochStatus::Quarantined
    │       ├── on_exposure() emits ExposureAlert
    │       ├── Quarantine current epoch
    │       └── Generate fresh epoch
    │
    ▼
Epoch N+1 (Active after recovery)
```

### Security Properties

| Property | Status |
|---|---|
| ML-KEM-1024 integration | ✅ Preserved |
| Authenticated epoch descriptors | ✅ ML-DSA-87 signed |
| Epoch monotonicity | ✅ Enforced |
| Replay protection | ✅ Per-epoch message ID set |
| Domain isolation | ✅ "VARDHAN-AER-KEP-Q-v2" tag |
| Transcript binding | ✅ SHA3-512 |
| Transaction binding (F-005) | ✅ transaction_id in HKDF |
| Exposure detection | ✅ Quarantine + alert |
| Key destruction | ✅ Secure deletion after reissue |
| Fresh epoch generation | ✅ On exposure |
| Restart safety | ✅ Persistent epoch state |
| Rollback resistance | ✅ Epoch monotonicity |
| HA behavior | ✅ Raft-backed HA cluster |
| Recovery | ✅ Fresh epoch reissue |

### Limitations

- No retroactive protection for ciphertexts from an exposed epoch.
- No complete QROM proof is claimed.
- ml-kem 0.2 and fips204 0.4 are pre-1.0 crates.
- Side-channel resistance (timing, cache) not independently verified.

## Key Hierarchy

```
KMS/HSM Master Key (external)
    │
    ▼
KEK (Key Encryption Key) — from VARDHAN_PRODUCTION_KEK
    │
    ▼
DEK (Data Encryption Key) — AES-256-GCM envelope
    │
    ├── Ed25519 private key (envelope-encrypted)
    ├── ML-DSA-87 secret key (envelope-encrypted)
    └── ML-KEM-1024 decapsulation key (envelope-encrypted)
```

## Key Lifecycle

```
Active → Rotating → Deprecated → Retired → Revoked
```

- **Rotating:** New key generated, co-existing with old during transition.
- **Deprecated:** Old key after rotation. Usable for verification, not signing.
  Configurable TTL (default 24h).
- **Retired:** Removed from active use. Can be destroyed after grace period.
- **Revoked:** Compromised. Immediately destroyed, zeroized.

## Crypto Boundaries

| Boundary | Location | Algorithm |
|---|---|---|
| Intelligence ↔ Q Core | `VerifiedFindingContract` | SHA-256 evidence hashes |
| Q Core signing | `VardhanSealedReceipt` | BLAKE3 + ML-DSA-87 + Ed25519 |
| Q Core verification | `VardhanVerifier` | Reconstructs canonical payload |
| Ledger chaining | `audit_ledger` | BLAKE3 hash chain |
| Session keys | `aer_kep_q.rs` | HKDF-SHA3-512 |
| Key protection | `vardhan_keystore` | AES-256-GCM envelope |
