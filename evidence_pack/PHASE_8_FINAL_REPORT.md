# Phase 8: Final Report — VARDHAN Q-Core Platform

## 1. Executive Summary

The VARDHAN Q-Core platform prototype implements a post-quantum cryptographic
authorization-bound execution sealing system using Ed25519 + ML-DSA-87 dual
signatures. Phase 8 validates the prototype across two milestones:

- **Phase 8a (Baseline)**: Establishes a reproducible test baseline with all
  existing test suites passing.
- **Phase 8b (Production Security Hardening)**: Implements six security
  hardening areas — distributed replay protection, secure transport (TLS),
  KMS/HSM key management, workload identity binding, audit integrity, and CI
  verification — each with reproducible tests and explicit acceptance criteria.

**Critical distinction**: All tests passing establishes the *tested
implementation's behavior*, not *production readiness*. The remaining
unproven capabilities are enumerated in Section 7.

## 2. Lifecycle Status

| Validation Area | Phase 8a Result | Phase 8b Enhanced |
|---|---|---|
| Lab Demo (`lab_demo_verify.sh`) | 5/5 passed | 5/5 passed |
| E2E Lifecycle | 31/31 passed | 33/33 passed (+2 adversarial) |
| Rust Unit Tests (receipt) | 59/59 passed | 68/68 passed (+9 adversarial) |
| Rust Keystore Tests | — | 43/43 passed (incl. 6 Vault tests) |
| Regression Tests | 13/13 passed | 13/13 passed |
| Tenant Isolation | 6/6 passed | 6/6 passed |
| Receipt Verification | 19/19 valid | 19/19 valid |
| Release Build | ✅ | ✅ (`cargo build --release` succeeds) |
| TLS Feature | ❌ | ✅ (`cargo build --features tls` succeeds) |

## 3. Architecture Map

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    VARDHAN Q-CORE PLATFORM                              │
│                                                                         │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐ │
│  │  Control Plane    │    │  Intelligence     │    │  Antigravity      │ │
│  │  API (Rust/axum)  │◄──►│  Plane (TS)       │◄──►│  Discovery (TS)   │ │
│  │                   │    │                   │    │                   │ │
│  │  ┌────────────┐  │    │  ┌────────────┐  │    │  ┌────────────┐  │ │
│  │  │ Auth &     │  │    │  │ Signal     │  │    │  │ Live       │  │ │
│  │  │ Session    │  │    │  │ Engine     │  │    │  │ Providers   │  │ │
│  │  └────────────┘  │    │  └────────────┘  │    │  └────────────┘  │ │
│  │  ┌────────────┐  │    │  ┌────────────┐  │    │                  │ │
│  │  │ Receipt    │──┼──►│  │ Decision   │  │    │                  │ │
│  │  │ API        │  │    │  │ Engine     │  │    │                  │ │
│  │  │ (spawns    │  │    │  └────────────┘  │    │                  │ │
│  │  │  subprocess)│  │    │                 │    │                  │ │
│  │  └────────────┘  │    │                 │    │                  │ │
│  │  ┌────────────┐  │    │                 │    │                  │ │
│  │  │ Tenant &   │  │    │                 │    │                  │ │
│  │  │ Billing    │  │    │                 │    │                  │ │
│  │  └────────────┘  │    │                 │    │                  │ │
│  └──────────────────┘    └──────────────────┘    └──────────────────┘ │
│           │                    │                    │                    │
│           ▼                    │                    │                    │
│  ┌──────────────────┐         │                    │                    │
│  │  Receipt Engine   │         │                    │                    │
│  │  (Rust binary)    │         │                    │                    │
│  │                   │         │                    │                    │
│  │  ┌────────────┐  │         │                    │                    │
│  │  │ Policy     │  │         │                    │                    │
│  │  │ Authority  │  │         │                    │                    │
│  │  │ (E1–E7)    │  │         │                    │                    │
│  │  └────────────┘  │         │                    │                    │
│  │  ┌────────────┐  │         │                    │                    │
│  │  │ Keystore   │  │         │                    │                    │
│  │  │ Manager    │  │         │                    │                    │
│  │  │ (PQ + HD)  │──┼────┐    │                    │                    │
│  │  └────────────┘  │    │    │                    │                    │
│  │  ┌────────────┐  │    │    │                    │                    │
│  │  │ Audit Trail │  │    │    │                    │                    │
│  │  │ (BLAKE3 +  │  │    │    │                    │                    │
│  │  │  ML-DSA-87) │  │    │    │                    │                    │
│  │  └────────────┘  │    │    │                    │                    │
│  │  ┌────────────┐  │    │    │                    │                    │
│  │  │ Idempotency │  │    │    │                    │                    │
│  │  │ (O_EXCL +  │  │    │    │                    │                    │
│  │  │  fsync)     │  │    │    │                    │                    │
│  │  └────────────┘  │    │    │                    │                    │
│  └──────────────────┘    │    │                    │                    │
│           │             │    │                    │                    │
│           │  TLS (rustls)│    │                    │                    │
│           │  (feature)   │    │                    │                    │
│           ▼             ▼    ▼                    ▼                    │
│  ┌─────────────────────────────────────────────────────────┐           │
│  │  Vault KMS (feature: vault)                              │           │
│  │  transit: encrypt/decrypt key material                   │           │
│  └─────────────────────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────────────────────┘
```

### Security Control Layering

| Layer | Component | Phase 8a | Phase 8b |
|---|---|---|---|
| Network | TLS (rustls) | Not configured | ✅ Feature-gated |
| Identity | Issuer Registry | ❌ Not present | ✅ DENY_ISSUER_UNBOUND |
| Authorization | Policy Authority (E1–E7) | ✅ 6 checks | ✅ 7 checks (+issuer binding) |
| Key Management | DevelopmentLocalProtection | ✅ Dev only | ✅ + VaultKeyProtectionProvider |
| Audit | Local JSONL | ❌ Not present | ✅ BLAKE3 chain + ML-DSA-87 signatures |
| Replay | File-based flag | ✅ Single-process | ✅ O_EXCL + fsync |

## 4. Security Findings

### Phase 8a Findings (Established)

| Finding | Severity | Status |
|---|---|---|
| Dual-signature (Ed25519 + ML-DSA-87) sealing | High | ✅ Verified |
| Replay protection (idempotency) | High | ✅ Verified |
| Trust boundary enforcement | High | ✅ Verified |
| Unauthorized actor rejection | High | ✅ Verified |
| Tenant isolation | High | ✅ Verified |
| Tampered signature rejection | High | ✅ Verified |
| State persistence across restart | Medium | ✅ Verified |

### Phase 8b Findings (New)

| Finding | Area | Severity | Status |
|---|---|---|---|
| `DENY_ISSUER_UNBOUND` for unregistered issuer prefixes | Identity binding | High | ✅ Implemented |
| Spoofed issuer prefix (substring match) rejected | Identity binding | Medium | ✅ Tested |
| SQL injection in tenant_id handled | Input validation | Low | ✅ Tested |
| Audit trail tamper detection (hash chain mismatch) | Audit integrity | High | ✅ Implemented & tested |
| TLS feature compiles and is structurally correct | Secure transport | High | ✅ Implemented (feature-gated) |
| Vault KMS provider registered and selectable | Key management | High | ✅ Implemented (feature-gated) |
| `binary_path()` resolves correctly from any CWD | Operational | Low | ✅ Fixed |

## 5. Performance Tables

### Phase 8a — Performance Benchmark

| Operation | Concurrency 1 | Concurrency 10 | Concurrency 100 | Bottleneck? |
|---|---|---|---|---|
| Login | 13.37 req/s | — | 1.9 req/s | ✅ Yes |
| Org Read | 2,675.6 req/s | — | — | ❌ No |
| Contract Seal | 1,499.2 req/s | — | — | ❌ No |
| Receipt Verify | 227.7 req/s | — | — | ❌ No |
| Audit Retrieve | 2,076.0 req/s | — | — | ❌ No |
| E2E | 10.92 req/s | — | — | ❌ No |

44 data points across 9 operation types at concurrency 1/5/10/25/50/100.

### Phase 8b — Test Performance

| Suite | Count | Duration |
|---|---|---|
| Rust unit tests (receipt) | 68 | 0.12s |
| Rust keystore tests (vault) | 43 | 0.23s |
| Regression tests | 13 | 8.29s |
| Tenant isolation | 6 | 7.29s |
| E2E lifecycle | 33 | ~25s |
| Lab demo | 5 | ~5s |

## 6. Phase 8b Hardening Details

### 6.1 Distributed Replay Protection

**Implementation**: `record_finding_sealed()` in `backend/vardhan_receipt/src/main.rs`
uses `create_new(true)` (O_CREAT|O_EXCL) for atomic file creation, paired with `fsync`
on the parent directory. This ensures that concurrent processes racing to seal the
same finding_id will have exactly one succeed.

The `is_finding_already_sealed()` check in both `main.rs` and
`receipt_api.rs` provides defense-in-depth: the API layer checks before spawning
the subprocess, and the subprocess re-checks at the `process_transaction()` level.

**Limitation**: This is single-process-safe but not distributed-consensus-safe.
In a multi-node deployment, a shared sled DB, Redis with Redlock, or Raft-based
consensus is needed for true distributed replay protection.

### 6.2 Secure Transport (TLS)

**Implementation**: `backend/control_plane_api/src/lib.rs` adds a `TlsListener`
struct that implements axum's `Listener` trait, wrapping a `TcpListener` with
`tokio_rustls::TlsAcceptor`. TLS is enabled when `VARDHAN_TLS_CERT_PATH` and
`VARDHAN_TLS_KEY_PATH` environment variables point to valid PEM files. The `tls`
feature flag (`--features tls`) gates the rustls dependency.

**Files modified**:
- `backend/control_plane_api/Cargo.toml` — added `tokio-rustls`, `rustls`, `rustls-pemfile`
- `backend/control_plane_api/src/lib.rs` — `TlsListener` struct, `Listener` impl, TLS in `serve()`

### 6.3 Key Management (Vault)

**Implementation**: `backend/vardhan_keystore/src/vault.rs` provides
`VaultKeyProtectionProvider` implementing the `KeyProtectionProvider` trait, using
Vault's transit secrets engine for encrypt/decrypt operations. The provider is
wired into `EnvironmentKeyProtectionProvider::select()` — when `VARDHAN_ENV=production`
and `VARDHAN_VAULT_ADDR` is set, Vault is selected ahead of the KEK-based provider.

**Files modified**:
- `backend/vardhan_keystore/Cargo.toml` — added `reqwest` + `base64` as optional deps, `vault` feature
- `backend/vardhan_keystore/src/lib.rs` — registered `pub mod vault`
- `backend/vardhan_keystore/src/protection.rs` — added `ConfigurationError` and `NetworkError` variants; Vault branch in `select()`

### 6.4 Identity Binding

**Implementation**: `IssuerRegistry` in `backend/vardhan_receipt/src/auth_config.rs`
maps issuer prefixes (e.g., `svc:vardhan-intelligence:`) to trusted issuer names
(e.g., `dev-local`). The `GatewayAuthorityEvaluator` in `policy_authority.rs` checks
the actor's workload ID prefix against this registry at step E3, returning
`DENY_ISSUER_UNBOUND` before the actor-prefix check (E7).

In development mode, `default_for_development()` includes a single issuer entry.
In production, the registry is configured via `VARDHAN_QCORE_ISSUER_REGISTRY_JSON`.

### 6.5 Audit Integrity

**Implementation**: `backend/vardhan_receipt/src/audit_trail.rs` provides
`AuditWriter` with:
- BLAKE3 hash chaining (each entry's `prev_hash` = canonical hash of previous entry)
- ML-DSA-87 signature via a signing closure (pluggable, uses the keystore's ML-DSA-87 key)
- `fsync` after each append (crash-safe)
- `scan_to_tip()` for log reconstruction on reopen

Integrated into `process_transaction()` in `main.rs` — after `record_finding_sealed()`,
an audit event is appended with finding_id, receipt_id, tenant_id, policy_id,
actor_identity, outcome_code, payload_hash, decision, and authorization_reference.

### 6.6 CI Verification

**Implementation**: New `adversarial-security` job in
`.github/workflows/ci-correctness-benchmarks.yml` with these steps:
1. Issuer binding tests (DENY_ISSUER_UNBOUND)
2. Audit trail tamper detection
3. Vault KMS provider tests
4. TLS feature compilation
5. Full regression + tenant isolation
6. Lab demo verification
7. E2E lifecycle validation

## 7. Known Limitations

### Unproven in Phase 8b

1. **TLS is feature-gated, not default**: Requires `--features tls` at build time
   and certificate paths at runtime. Not enabled in the default build.
2. **Vault provider is unit-tested, not integration-tested**: Tests verify config
   detection and provider attributes, but have not been run against a live Vault
   instance.
3. **Audit trail is local-only**: Written to a JSONL file with hash chaining and
   signatures, but not published to an external log sink (CloudTrail, SIEM).
4. **Multi-node replay protection is single-process**: Atomic file creation provides
   intra-process safety but not distributed consensus.
5. **No independent security assessment**: Adversarial tests are developer-authored.
   No third-party audit or penetration test.
6. **Issuer registry is dev-only**: Production configuration requires external
   bootstrap via `VARDHAN_QCORE_ISSUER_REGISTRY_JSON`.
7. **No Q-Core issuer registry integration**: The `VARDHAN_QCORE_ISSUER_REGISTRY_JSON`
   env var is not set in the test environment.
8. **No AER-KEP-Q runtime**: `VARDHAN_AER_KEP_Q_VAULT_PASS` is not set.

## 8. Reproduction Instructions

See `evidence_pack/reproducible_test_report.md` for exact commands and expected
outputs. All commands must be run from the repository root.

```bash
# Phase 8a baseline tests
bash /Users/vishnuvardhanburri/antigravity/lab_demo_verify.sh          # 5/5
python3 scripts/e2e_lifecycle_validation.py                            # 33/33
cargo test -p vardhan_receipt --bin vardhan-receipt                    # 68/68
cargo test -p vardhan_keystore --features vault                      # 43/43
cargo test -p control_plane_api --test org_lifecycle_edge_cases      # 13/13
cargo test -p control_plane_api --test tenant_isolation_test         # 6/6
cargo build --release -p vardhan_receipt -p control_plane_api          # ✅

# Phase 8b adversarial tests
cargo test -p vardhan_receipt -- t12_spoofed_issuer_prefix_is_denied
cargo test -p vardhan_receipt -- audit_trail::tests
cargo test -p vardhan_keystore --features vault -- vault::tests
cargo build -p control_plane_api --features tls
```

## 9. Recommended Next Actions

| # | Action | Priority | Owner |
|---|---|---|---|
| 1 | Replace file-based idempotency with shared sled DB or Redis for multi-node replay protection | High | Engineering |
| 2 | Enable TLS by default in production builds; add cert rotation | High | DevOps |
| 3 | Integration-test Vault provider against a real Vault instance | High | Security |
| 4 | Publish audit trail to external log sink (SIEM/CloudTrail) | Medium | Security |
| 5 | Bootstrap issuer registry in production via SPIFFE/OIDC | High | Identity |
| 6 | Commission independent third-party security audit | High | Security |
| 7 | Add property-based fuzzing for contract payload handling | Medium | Engineering |
| 8 | Evaluate FIPS 140-3 certification path for ML-DSA-87 | Medium | Compliance |
