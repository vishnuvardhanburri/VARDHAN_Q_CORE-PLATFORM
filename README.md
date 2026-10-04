# VARDHAN Q-CORE PLATFORM

> Vardhan Technologies — BE DIFFERENT

High-assurance security infrastructure for regulated enterprises, banks, and high-consequence digital operations.

## Product Architecture

Vardhan Technologies is organized as **two integrated pillars**:

1. **Vardhan Intelligence** — external/internal intelligence, discovery, collection, normalization, entity resolution, enrichment, correlation, verification, scoring, and delivery through the canonical `VerifiedFindingContract`.
2. **Vardhan Q Core** — trust, authority, policy, secure transactions, post-quantum cryptography, key lifecycle, AER-KEP-Q, signed receipts, ledger, independent verification, resilience, and the seven industry planes.

Quantum/PQ security is a Q Core capability, not a separate business pillar.

## Core Trust Architecture

```text
Vardhan Intelligence
    ↓
Evidence / Verification
    ↓
VerifiedFindingContract
    ↓
Q Core Trust Boundary
    ↓
Authority / Policy
    ↓
Transaction State Machine
    ↓
PQ / Hybrid Cryptographic Security
    ↓
Signed Receipt
    ↓
Ledger
    ↓
Independent Verification
```

Q Core does **not** trust an upstream `VERIFIED_FINDING` label merely because it is present. Findings cross a versioned trust boundary and are independently validated before governed actions can execute.

## Seven Industry Planes

The following industry capabilities live inside Q Core and share the same trust, cryptographic, governance, and transaction substrate:

1. Banking / Financial Services
2. Healthcare
3. Government / Public Sector
4. Telecom
5. Energy / Critical Infrastructure
6. Insurance
7. Education / Research

They are domain planes, not seven separate products.

## Cryptographic Security

- ML-DSA-87 / FIPS 204 for post-quantum signatures
- Ed25519 for classical signatures
- ML-KEM-1024 for post-quantum key establishment
- BLAKE3 for integrity commitments
- authenticated key lifecycle and zeroization controls
- existing receipt/governance signing path remains independent from AER-KEP-Q

## AER-KEP-Q

AER-KEP-Q is the platform's asynchronous exposure-resilient key-establishment capability.

It provides authenticated epoch descriptors, ML-KEM session establishment, transcript/domain/epoch/message binding, replay rejection, exposure detection, epoch quarantine, fresh epoch generation, authenticated HA peer validation, stale/future/conflicting epoch rejection, rollback protection, duplicate descriptor idempotency, and pending-message reissue semantics.

AER-KEP-Q deliberately does **not** claim retroactive protection for ciphertexts created under an epoch whose complete decryption state has already been exposed. Such traffic is quarantined and new traffic moves to a fresh authenticated epoch.

AER-KEP-Q is an engineered protocol candidate built from established cryptographic primitives. It is not presented as a newly invented primitive or as a completed peer-reviewed cryptographic proof.

## Runtime Reports

```text
runtime/
├── report.md
├── status.md
├── tests.md
└── errors.md
```

Runtime documentation records current implementation state and known limits. CI results are authoritative; documentation must not claim a workflow is green without a verified successful run.

## Repository Structure

```text
backend/              Rust Q-Core services and cryptographic substrate
intelligence_plane/   Vardhan Intelligence, evidence, verification, trust boundary
sdks/                 TypeScript and Python SDKs
contracts/            Versioned platform contracts
zk_engine/            Zero-knowledge proof engine
runtime/              Short operational reports
.github/              CI and release workflows
```

## Validation

### Rust

```bash
cargo fmt --all -- --check
cargo test --workspace
cargo build --workspace --release
```

### Intelligence Plane

```bash
cd intelligence_plane
npm install
npx tsc -p tsconfig.xavira.json --noEmit
npx tsx tests/trust_boundary.test.ts
npx vitest run
```

### Security / Supply Chain

```bash
cargo audit
cargo deny check advisories
```

### Linux eBPF

The kernel object and userspace loader are compiled together in CI. Runtime deployment configures `EBPF_OBJECT_PATH` and `EBPF_INTERFACE`.

## Security Position

Vardhan Q Core is positioned as security infrastructure and a cryptographic control plane—not as a collection of unrelated algorithms. Security claims remain bounded by the implementation, test evidence, and independent assurance status.

## Licence

Proprietary. All rights reserved. © Vardhan Technologies.
