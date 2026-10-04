# Runtime Architecture

## Platform Overview

Vardhan Technologies is one unified hybrid security platform with three tightly
integrated pillars:

```
                    VARDHAN TECHNOLOGIES
                           |
          +----------------+----------------+
          |                |                |
          v                v                v
 VARDHAN INTELLIGENCE  VARDHAN QUANTUM   VARDHAN Q CORE
          |                |                |
          +----------------+----------------+
                           |
                           v
                  UNIFIED SECURITY PLATFORM
```

### Pillar Responsibilities

| Pillar | Language | Scope |
|---|---|---|
| **VARDHAN INTELLIGENCE** | TypeScript | Discover, collect, normalize, resolve, enrich, correlate, verify, and score security findings from external and internal sources |
| **VARDHAN QUANTUM** | Rust | PQ cryptographic primitives: ML-KEM-1024, ML-DSA-87, AER-KEP-Q epoch management, key lifecycle |
| **VARDHAN Q CORE** | Rust (backend) + TypeScript (gateway) | Transaction state machine, authority/policy enforcement, receipt signing, ledger immutability, independent verification |

### Trust Pipeline (end-to-end)

```
External Intelligence     Internal Intelligence
        │                       │
        ▼                       ▼
   Collection      ───►  Collection
        │                       │
        ▼                       ▼
Normalization     ───►  Normalization
        │                       │
        ▼                       ▼
Entity Resolution ◄──►  Entity Resolution
        │                       │
        ▼                       ▼
   Enrichment      ───►  Enrichment
        │                       │
        ▼                       ▼
Correlation       ───►  Correlation
        │                       │
        ▼                       ▼
  Verification    ───►  Verification
        │                       │
        ▼                       ▼
Confidence Scoring ◄──► Confidence Scoring
        │                       │
        └──────────┬────────────┘
                   ▼
         Intelligence Finding
                   │
                   ▼
      VerifiedFindingContract  (trust boundary)
                   │
                   ▼
            Q-Core Gateway
                   │
                   ▼
        Authority / Policy Enforcement
                   │
                   ▼
      Transaction State Machine
                   │
                   ▼
         PQ/Hybrid Signing
        (ML-DSA-87 + Ed25519)
                   │
                   ▼
              Ledger (append-only)
                   │
                   ▼
         Independent Verification
```

### Key Architectural Invariants

1. **Vardhan Intelligence is aggressive in discovery, strict in verification.**
   Only `VERIFIED` findings cross the trust boundary into Q-Core.
2. **Q-Core enforces fail-closed by default.** If any validation step fails,
   the transaction is rejected before sealing.
3. **Vardhan Quantum provides cryptographic capability but is not a
   universally proven new primitive.** AER-KEP-Q is an async
   exposure-resilient key establishment and quarantine/reissue protocol
   built on FIPS 203 (ML-KEM-1024) and FIPS 204 (ML-DSA-87).
4. **Simulation code is never selected in production.** All simulation/mock
   implementations are gated behind explicit configuration.
5. **Tenant isolation is enforced at every layer** (type-level in Rust,
   config-driven in TS).

## Deployment Model

| Component | Runtime | Network Boundary | Persistence |
|---|---|---|---|
| Intelligence Plane | Node.js (via `tsx`) | External (collects from public sources) | Local state files |
| Q-Core Receipt Service | Rust binary | Internal (API gateway) | File-based keystore |
| Crypto Engine | Rust lib | Internal | KMS/HSM-backed |
| HA Cluster | Rust lib | Internal cluster | Shared state |
| ZK Engine | TypeScript/Node.js | Separate service | Local |
| eBPF Engine | Rust/LLVM | Kernel space | N/A |

## Trust Boundaries

```
┌─────────────────────────────────────────────────────┐
│  EXTERNAL INTELLIGENCE PLANE (TS)                     │
│  - Public source collection                          │
│  - Entity resolution                                 │
│  - Confidence scoring                                │
│  - VerifiedFindingContract generation                │
│          │                                          │
│          ▼  (trust boundary — only VERIFIED findings)│
├─────────────────────────────────────────────────────┤
│  Q-CORE GATEWAY (Rust)                               │
│  - TrustBoundaryValidator (22 checks)                │
│  - GatewayAuthorityEvaluator (config-driven)         │
│  - VardhanTransaction state machine                  │
│  - VardhanSealedReceipt (ML-DSA-87 + Ed25519)        │
│  - Audit ledger (append-only)                        │
│  - VardhanVerifier (independent verification)        │
└─────────────────────────────────────────────────────┘
```
