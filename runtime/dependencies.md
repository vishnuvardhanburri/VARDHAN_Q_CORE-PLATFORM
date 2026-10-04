# Runtime Dependencies

## Rust Workspace

### Workspace Root

- **Cargo.toml** — 31 workspace members (see `runtime/services.md`)
- **Cargo.lock** — 606 crate dependencies (pinned)
- **deny.toml** — cargo-deny advisories allowlist (12 documented entries)
- **.cargo/audit.toml** — cargo-audit ignore list (12 documented entries)

### Crate Dependency Graph (production, excluding dev-dependencies)

```
vardhan_receipt                vardhan_verifier
├── core_crypto (ML-DSA, ML-KEM, HKDF)
├── vardhan_keystore
│   ├── aes-gcm (envelope encryption)
│   └── zeroize (memory protection)
├── vardhan_state
│   └── vardhan_model
├── vardhan_transaction
├── audit_ledger
├── authority_gate
├── vardhan_idempotency
│   └── durable (file-based persistence)
└── vardhan_proof_contracts

core_crypto
├── ml-kem (ML-KEM-1024)
├── fips204 (ML-DSA-87)
├── ed25519-dalek (Ed25519)
├── blake3
├── hkdf
├── sha3
├── sha2
├── aes-gcm
├── zeroize
├── rand (OsRng)
├── tracing
└── thiserror

enterprise_tenant
├── vardhan_model
├── vardhan_state
└── audit_ledger

hybrid_core (SIMULATION ONLY)
└── sha2

ha_cluster
├── tokio (async runtime)
└── raft state machine

ledger_sync
├── tokio
├── blake3
└── ML-DSA-87 signatures

proxy_engine
├── hkdf
├── sha2
├── aes-gcm
└── tokio

pq_shield
├── core_crypto
├── vardhan_keystore
└── blake3
```

### Key External Dependencies

| Dependency | Version | Used By | Purpose | PQC Audit Status |
|---|---|---|---|---|
| `ml-kem` | 0.2 | core_crypto | ML-KEM-1024 encapsulation | Pre-1.0 |
| `fips204` | 0.4 | core_crypto | ML-DSA-87 signing/verification | Pre-1.0 |
| `ed25519-dalek` | 2.1 | core_crypto | Classical Ed25519 signatures | Stable |
| `blake3` | 1.5 | core_crypto, ledger | Content hashing | Stable |
| `sha3` | 0.10 | core_crypto | SHA3-512 for transcripts | Stable |
| `sha2` | 0.10 | core_crypto, hybrid_core | SHA-256 | Stable |
| `hkdf` | 0.12 | core_crypto, proxy_engine | Key derivation | Stable |
| `aes-gcm` | 0.11 | core_crypto, vardhan_keystore | Envelope encryption | Stable |
| `zeroize` | 1.7 | core_crypto, vardhan_keystore | Memory zeroization | Stable |
| `rand` | 0.8 | core_crypto | OsRng CSPRNG | Stable |
| `tokio` | 1.x | ledger_sync, ha_cluster, proxy_engine | Async runtime | Stable |

### Known Advisories (all documented in `.cargo/audit.toml`)

| Advisory | Crate | Severity | Rationale |
|---|---|---|---|
| RUSTSEC-2021-0127 | serde_cbor | Low | Non-production `poc_auditor` only |
| RUSTSEC-2026-0258 | h2 | Medium | Transitive via aws-sdk-kms |
| RUSTSEC-2026-0104 | rustls-webpki | Medium | Transitive via aws-sdk-kms |
| RUSTSEC-2026-0098 | rustls-webpki | Medium | Transitive via aws-sdk-kms |
| RUSTSEC-2026-0099 | rustls-webpki | Medium | Transitive via aws-sdk-kms |
| RUSTSEC-2025-0057 | fxhash | Low | Transitive via criterion (test-only) |
| RUSTSEC-2024-0384 | instant | Low | Transitive via criterion (test-only) |
| RUSTSEC-2024-0436 | paste | Negligible | Transitive via criterion (test-only) |
| RUSTSEC-2026-0163 | pqcrypto | Medium | PQClean archived; used for ML-DSA-87 |
| RUSTSEC-2026-0166 | pqcrypto | Medium | PQClean archived; used for ML-DSA-87 |
| RUSTSEC-2026-0162 | pqcrypto | Medium | PQClean archived; used for ML-DSA-87 |
| RUSTSEC-2026-0187 | poc_auditor | Low | Non-production PoC only |

## TypeScript Dependencies

### intelligence_plane

- `@vardhan/qcore-sdk` — local file dependency (SDK)
- `vite` — build tooling
- `vitest` — test runner
- `tsx` — TypeScript execution
- `clsx` — conditional classnames

### zk_engine

- Uses `pnpm` workspaces with `turbo`
- 7 packages: api, circuit-lib, cli, dashboard, engine, keys, proof-format

## Build Tools

| Tool | Version | Purpose |
|---|---|---|
| cargo | 1.98.1 | Rust build |
| rustc | 1.98.1 | Rust compiler (arm64 macOS) |
| cargo-audit | installed | Security advisory scanning |
| cargo-deny | installed | License and dependency policy |
| cargo-sbom | installed | SPDX/CycloneDX SBOM generation |
| node | LTS | TypeScript execution |
| npm | included | TypeScript package management |
| npx tsc | via local install | TypeScript type checking |
| npx vitest | via local install | Test runner |
