# Proof-Carrying Key Epoch — Primary Invention Specification

## Status

**INVENTION:** Proof-Carrying Key Epoch (PCKE)
**ALTERNATE NAME:** AER-KEP-Q (Asynchronous Exposure-Resilient Key Establishment — Quarantine/Reissue)
**STATUS:** Fully implemented and verified
**SCORE:** 8.0 (see `VARDHAN_INVENTION_SHORTLIST.md`)

## Abstract

A system for establishing cryptographic key epochs with built-in exposure
detection, automatic quarantine, and fresh epoch reissue. Each epoch carries
a proof of integrity and authorization that can be independently verified.
The system binds session keys to application-level transaction IDs and
persists epoch state across process restarts and distributed nodes.

## Problem Statement

Traditional key establishment does not account for exposure detection
and recovery within the same protocol flow. When a key compromise is
detected:

1. The system must quarantine the current epoch (prevent further use).
2. The system must issue a fresh epoch without downtime.
3. The system must persist this state across restarts.
4. The system must coordinate across distributed nodes (HA).
5. The system must provide cryptographic proof that the epoch is valid.

AER-KEP-Q solves all five simultaneously.

## Technical Architecture

### Components

```
┌─────────────────────────────────────────────────────────┐
│                    EpochState Persistence                │
├─────────────────────────────────────────────────────────┤
│  EpochState {                                            │
│    epoch_number: u64,                                    │
│    status: EpochStatus,                                  │
│    descriptor: EpochDescriptor,                          │
│    prev_epoch_hash: String,                              │
│    created_at: SystemTime,                               │
│    quarantine_reason: Option<String>,                    │
│  }                                                       │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                   EpochDescriptor                        │
├─────────────────────────────────────────────────────────┤
│  {                                                       │
│    epoch: u64,                                           │
│    domain_id: String,                                    │
│    message_id: String,                                   │
│    ciphertext: Vec<u8>,                                   │
│    context: String,                                      │
│    signature: Vec<u8>,        // ML-DSA-87               │
│    epoch_hash: String,       // BLAKE3                  │
│  }                                                       │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                   HKDF-SHA3-512 Session Key             │
├─────────────────────────────────────────────────────────┤
│  info = [                                              │
│    "VARDHAN-AER-KEP-Q-v2",                             │
│    epoch.to_be_bytes(),                                 │
│    message_id,                                          │
│    context,                                             │
│    transaction_id,   // F-005 binding                   │
│  ]                                                      │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│             ML-KEM-1024 (FIPS 203) Shared Secret         │
├─────────────────────────────────────────────────────────┤
│  encapsulate() → (ciphertext, shared_secret)             │
│  decapsulate() → shared_secret                           │
└─────────────────────────────────────────────────────────┘
```

### Epoch Status State Machine

```
Active ──exposure──► Quarantined ──reissue──► Active (new epoch N+1)
   │                    │
   ├──deprecated──► Deprecated
   ├──retired──► Retired
   └──revoked──► Revoked
```

### Functions

| Function | File | Description |
|---|---|---|
| `encapsulate()` | `core_crypto/src/aer_kep_q.rs` | ML-KEM-1024 encapsulation + HKDF session key |
| `decapsulate()` | `core_crypto/src/aer_kep_q.rs` | ML-KEM-1024 decapsulation + HKDF session key |
| `derive_session_key()` | `core_crypto/src/aer_kep_q.rs` | HKDF with transaction binding |
| `on_exposure()` | `core_crypto/src/exposure_detector.rs` | Quarantine + emit alert + trigger reissue |
| `on_exposure_persistent()` | `core_crypto/src/aer_kep_q_runtime.rs` | Persist epoch state before recovery |
| `assert_integrity()` | `core_crypto/src/anti_tamper.rs` | Binary integrity self-check |

## Security Properties

1. **Post-Quantum Secure** — ML-KEM-1024 (FIPS 203) + ML-DSA-87 (FIPS 204)
2. **Epoch Monotonicity** — Epoch numbers are strictly increasing
3. **Replay Protection** — Per-epoch message ID set prevents replay
4. **Domain Isolation** — "VARDHAN-AER-KEP-Q-v2" domain tag
5. **Transaction Binding** — transaction_id in HKDF transcript (F-005)
6. **Exposure Detection** — Automatic quarantine on exposure detection
7. **Persistent State** — Epoch state survives process restart
8. **HA Consistency** — Raft-backed epoch state for distributed nodes
9. **Authorization** — Epoch descriptor signed by ML-DSA-87
10. **Integrity** — BLAKE3 epoch hash chaining
11. **Key Destruction** — Secure deletion after reissue

## Honest Security Claim

AER-KEP-Q provides:
- Asynchronous key establishment with exposure-triggered quarantine
- Post-quantum security via ML-KEM-1024
- Epoch-based recovery mechanism with persistent state

AER-KEP-Q does NOT provide:
- A universally novel cryptographic primitive
- Retroactive protection for already-exposed ciphertexts
- NIST-certified crate implementations
- Side-channel resistance guarantees

See `VARDHAN_PRIOR_ART_RED_TEAM.md` for prior art analysis.

## Testing

```
cargo test -p core_crypto --lib aer_kep_q  → 16 passed
cargo test -p core_crypto --lib exposure_detector → 18 passed
cargo test -p core_crypto --lib anti_tamper → 7 passed
```
