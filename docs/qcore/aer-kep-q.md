# Vardhan Q Core — AER-KEP-Q

## AER-KEP-Q Integration

**Asynchronous Exposure-Resilient Key Establishment — Quarantine/Reissue**

AER-KEP-Q is a cryptographic protocol component INSIDE Vardhan Q Core. It is
not a separate product.

## Current Implementation

### Location

- `backend/core_crypto/src/aer_kep_q.rs` — Core protocol implementation
- `backend/core_crypto/src/exposure_detector.rs` — Exposure detection & alerts
- `backend/core_crypto/src/anti_tamper.rs` — Binary integrity checks
- `backend/core_crypto/src/aer_kep_q_runtime.rs` — Runtime state persistence

### Architecture

```
Epoch State Persistence (disk)
        │
        ▼
EpochState { epoch_number, status, descriptor, prev_epoch_hash }
        │
        ▼
EpochStatus: Active | Quarantined | Deprecated | Retired
        │
        ▼
Descriptor {
  epoch, domain_id, message_id, ciphertext, context,
  signature (ML-DSA-87), epoch_hash (BLAKE3)
}
        │
        ▼
Shared Secret (ML-KEM-1024)
        │
        ▼
HKDF-SHA3-512 → Session Key
  │
  ├── Domain tag: "VARDHAN-AER-KEP-Q-v2"
  ├── Epoch number (monotonic)
  ├── Message ID (per-epoch replay set)
  ├── Context (caller-supplied)
  └── transaction_id (F-005: bound for transaction safety)
```

### Key Functions

| Function | File | Purpose |
|---|---|---|
| `encapsulate()` | `aer_kep_q.rs` | ML-KEM-1024 encapsulation + HKDF session key |
| `decapsulate()` | `aer_kep_q.rs` | ML-KEM-1024 decapsulation + HKDF session key |
| `derive_session_key()` | `aer_kep_q.rs` | HKDF with transaction binding |
| `on_exposure()` | `exposure_detector.rs` | Quarantine + alert + fresh epoch |
| `assert_integrity()` | `anti_tamper.rs` | Binary self-hash (fail-closed in production) |
| `rotate_key()` | `vault.rs` | Key rotation with transition record |
| `on_exposure_persistent()` | `aer_kep_q_runtime.rs` | Persist epoch state before recovery |

### Security Properties Verified

1. ✅ ML-KEM-1024 integration (FIPS 203 parameters)
2. ✅ Authenticated epoch descriptors (ML-DSA-87)
3. ✅ Epoch monotonicity (no rollback)
4. ✅ Replay protection (per-epoch message ID set)
5. ✅ Domain isolation ("VARDHAN-AER-KEP-Q-v2" tag)
6. ✅ Transcript binding (SHA3-512)
7. ✅ Transaction binding (F-005: transaction_id in HKDF)
8. ✅ Exposure detection (quarantine + alert)
9. ✅ Key destruction (secure_delete after reissue)
10. ✅ Fresh epoch generation (on exposure)
11. ✅ Restart safety (persistent epoch state)
12. ✅ Rollback resistance (monotonic epoch numbers)
13. ✅ HA behavior (raft-backed epoch state)
14. ✅ Recovery (fresh epoch reissue)

### Known Limitations

1. **No retroactive protection** — ciphertexts from an exposed epoch remain
   vulnerable. This is an inherent limitation of post-quantum KEM.
2. **No QROM proof** — AER-KEP-Q's security proof does not claim full
   quantum random oracle model compliance.
3. **Pre-1.0 crate versions** — `ml-kem` v0.2 and `fips204` v0.4 are
   pre-1.0 community implementations. No NIST certification of these
   specific crate versions.
4. **No constant-time verification** — Side-channel resistance (timing,
   cache) was not independently verified.
5. **HA transport** — Production HA transport remains infrastructure work,
   not a cryptographic correctness claim.

### Honest Security Claim

AER-KEP-Q provides:
- Asynchronous key establishment with quarantine capability
- Post-quantum security via ML-KEM-1024 and ML-DSA-87
- Epoch-based exposure recovery mechanism

AER-KEP-Q does NOT provide:
- Universally proven security in the QROM
- Retroactive protection for already-exposed ciphertexts
- NIST-certified crate implementations
- Side-channel resistance guarantees

## Smoke Test

```
cargo test -p core_crypto --lib aer_kep_q
# 16 passed, 0 failed
```
