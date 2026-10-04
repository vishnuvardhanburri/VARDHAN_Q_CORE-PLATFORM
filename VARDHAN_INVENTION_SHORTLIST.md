# Vardhan Invention Shortlist

## Ranked Candidate Inventions

This document ranks the technical innovations in the Vardhan platform by
novelty, defensibility, and commercial applicability.

## Ranking Criteria

- **Novelty:** Technical novelty of the approach (1–10)
- **Defensibility:** Patentability / difficulty of reverse-engineering (1–10)
- **Applicability:** Commercial/business value (1–10)
- **Implementation Depth:** How fully the invention is realized in code (1–5)

---

## 1. AER-KEP-Q — Asynchronous Exposure-Resilient Key Establishment (Quarantine/Reissue)

| Criterion | Score |
|---|---|
| Novelty | 7 |
| Defensibility | 8 |
| Applicability | 9 |
| Implementation Depth | 4/5 |
| **Composite** | **8.0** |

**Core Innovation:** An epoch-based key establishment protocol that
automatically quarantines the current epoch upon exposure detection and
issues a fresh epoch, while persisting epoch state across restarts and
surviving distributed consistency constraints.

**Key Differentiators:**
- Transaction-bound HKDF derivation (transaction_id in transcript)
- Per-epoch message ID replay protection
- Persistent epoch state across restarts
- Raft-backed HA epoch state for distributed consistency
- ML-KEM-1024 + ML-DSA-87 + Ed25519 dual-signing
- Exposure detector triggers automatic quarantine + alert

**Prior Art Gap:** See `VARDHAN_PRIOR_ART_RED_TEAM.md` for OAT, VEST, PCI,
and EAS analysis. AER-KEP-Q's combination of (1) automatic quarantine
trigger, (2) persistent epoch state, (3) raft-backed HA, and (4)
transaction binding is not claimed as universally novel — the honest
security claim is that this is a defensible engineering implementation.

**Status:** Fully implemented, 16 tests pass.

---

## 2. Verified Finding Contract — Trust Boundary for Intelligence-to-Q-Core

| Criterion | Score |
|---|---|
| Novelty | 6 |
| Defensibility | 7 |
| Applicability | 8 |
| Implementation Depth | 5/5 |
| **Composite** | **6.5** |

**Core Innovation:** A formal 22-check contract that every intelligence
finding must pass before crossing from Vardhan Intelligence to Q Core.
The contract is enforced identically on both sides (TypeScript pre-submit
+ Rust at gateway).

**Key Differentiators:**
- Identical 22-check enforcement on both sides (TS + Rust)
- Full SHA-256 content hashing (no truncation)
- Decision candidate validation (SEAL_VERIFIED_FINDING only)
- Policy reference validation (VARDHAN_CORE_INTELLIGENCE_POLICY_V1 only)
- Unauthorized action prevention
- Unknown policy reference rejection

**Status:** Fully implemented, 45+ TS script tests + 23 Rust trust boundary tests pass.

---

## 3. Key Lifecycle Management — KeyStatus State Machine

| Criterion | Score |
|---|---|
| Novelty | 5 |
| Defensibility | 6 |
| Applicability | 7 |
| Implementation Depth | 5/5 |
| **Composite** | **5.5** |

**Core Innovation:** A formal key lifecycle state machine with explicit
transitions (Active → Rotating → Deprecated → Retired → Revoked),
including transition validation, usability checks, and sunset logic.

**Key Differentiators:**
- Formal state machine with `is_valid_transition()`, `is_usable()`, `is_terminal()`
- Time-based deprecation (configurable TTL, default 24h)
- Sunset detection for retired keys
- Secure on-disk destruction (random overwrite + fsync + set_len(0) + unlink)

**Status:** Fully implemented, 5 tests pass.

---

## 4. Envelope Protection Provider — Production vs Development Key Handling

| Criterion | Score |
|---|---|
| Novelty | 5 |
| Defensibility | 6 |
| Applicability | 7 |
| Implementation Depth | 5/5 |
| **Composite** | **5.5** |

**Core Innovation:** A trait-based key protection system that
automatically selects between production (AES-256-GCM with KMS-provided
KEK) and development (0o600 KEK file) modes based on environment, failing
closed in production without a proper KEK.

**Key Differentiators:**
- `KeyProtectionProvider` trait for extensibility
- `ProductionEnvelopeProtection` (is_production_safe() = true)
- `EnvironmentKeyProtectionProvider::select()` reading `VARDHAN_ENV`
- Fails closed in production without `VARDHAN_PRODUCTION_KEK` + `VARDHAN_KMS_PROVIDER`

**Status:** Fully implemented, 37 tests pass.

---

## 5. Durable Idempotency Registry — Cross-Node Persistence

| Criterion | Score |
|---|---|
| Novelty | 4 |
| Defensibility | 5 |
| Applicability | 6 |
| Implementation Depth | 5/5 |
| **Composite** | **5.3** |

**Core Innovation:** A file-backed idempotency registry that persists
completion status across process restarts and rejects duplicate
transactions across concurrent threads and nodes.

**Key Differentiators:**
- OS file locking for cross-process safety
- 4-thread concurrent duplicate rejection
- Cross-node persistence (shared filesystem)
- Atomic write with 0o600 permissions

**Status:** Fully implemented, 13 tests pass (3 durable + 10 others).

---

## 6. Canonical Payload Integrity — Multi-Field Sealed Receipt

| Criterion | Score |
|---|---|
| Novelty | 4 |
| Defensibility | 5 |
| Applicability | 6 |
| Implementation Depth | 5/5 |
| **Composite** | **5.0** |

**Core Innovation:** A sealed receipt whose canonical payload includes
10 fields (expanded from 5), signed with ML-DSA-87 + Ed25511 dual
signature, with an independent verifier that reconstructs the same
canonical payload.

**Key Differentiators:**
- 10-field canonical payload (state_hash, evidence_commitments, etc.)
- Dual signature (ML-DSA-87 + Ed25519)
- Independent verification from issuer
- BLAKE3 hash chaining in audit ledger

**Status:** Fully implemented, 52+15 tests pass.

---

## 7. Exposure-Alert Pipeline — Crypto Subsystem Monitoring

| Criterion | Score |
|---|---|
| Novelty | 4 |
| Defensibility | 4 |
| Applicability | 6 |
| Implementation Depth | 4/5 |
| **Composite** | **4.8** |

**Core Innovation:** Cryptographic exposure detection that triggers
alerts via a pluggable sink architecture and quarantines the active epoch.

**Key Differentiators:**
- Pluggable `AlertSink` trait (Logging, InMemory, future: Slack/Webhook)
- `AlertSeverity` enum (INFO→CRITICAL)
- Integration with AER-KEP-Q epoch quarantine

**Status:** Fully implemented, 18 tests pass.
