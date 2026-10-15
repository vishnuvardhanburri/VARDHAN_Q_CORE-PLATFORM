# Phase 8b PoV Test Plan — Financial-Services Workflow

## Objective

Validate that VARDHAN Q-Core can protect a realistic financial-services workflow:
submitting a security finding from a bank's automated analysis pipeline, validating
authenticity, integrity, non-replay, tenant scoping, and producing a verifiably
cryptographically sealed receipt for audit.

## Component Map

### Components That Actually Execute

| Component | Binary | Port | Description |
|---|---|---|---|
| Control Plane API | `control_plane_api` | 8080 (configurable) | Axum HTTP API: auth, org management, receipt validation gateway |
| Receipt Engine | `vardhan-receipt` | N/A (subprocess) | Spawned by control plane for `validate-canonical`; also has `verify`, `prove` subcommands |
| Auth Service | (library, linked into control_plane_api) | N/A | Credential store, session management, token rotation |

### Components That Are Mocks/Stubs/Unavailable

| Component | Status | Notes |
|---|---|---|
| Intelligence Plane (TypeScript dashboard) | Not tested | React dev server; not needed for PoV |
| eBPF Shield | Not built | Requires kernel headers; not in scope |
| zk_engine | Not built | TypeScript; not needed for PoV |
| AER-KEP-Q runtime | Not attached | `VARDHAN_AER_KEP_Q_VAULT_PASS` not set |
| Q-Core issuer key registry | Bootstrap only | `VARDHAN_QCORE_ISSUER_REGISTRY_JSON` not set; dev defaults used |
| Vault KMS | Feature-gated, not in Docker | `vault` feature not enabled in default Docker build |
| TLS | Feature-gated, not in default Docker | `tls` feature not enabled; HTTP used for local testing |

### Existing Test Evidence

| Test | Count | Status |
|---|---|---|
| Lab demo | 5/5 | ✅ PASS |
| E2E lifecycle | 33/33 | ✅ PASS |
| Rust unit tests | 68/68 | ✅ PASS |
| Regression tests | 13/13 | ✅ PASS |
| Tenant isolation | 6/6 | ✅ PASS |
| Audit trail tests | 5/5 | ✅ PASS |
| Vault provider tests | 6/6 | ✅ PASS |

## Shortest Viable E2E Workflow

1. Start `control_plane_api` with dev environment
2. POST `/api/v1/auth/login` → get token
3. POST `/api/v1/organizations` → create tenant
4. POST `/api/v1/organizations/{id}/security/validate` → spawn `vardhan-receipt validate-canonical` → receive sealed receipt (Ed25519 + ML-DSA-87)
5. GET `/api/v1/organizations/{id}/security/audit` → retrieve audit trail
6. `vardhan-receipt verify` → independent receipt verification
7. Replay same contract → `REJECTED_REPLAY`
8. Submit with unauthorized actor → `DENY_ISSUER_UNBOUND`
9. Tamper receipt signature → verification returns Invalid

## Test Plan Matrix

### Security Tests

| # | Test | Threat | Expected Result |
|---|---|---|---|
| S1 | Valid contract sealing | N/A (baseline) | Status=SEALED, dual signatures present |
| S2 | Replay identical contract | Replay attack | Status=REJECTED_REPLAY |
| S3 | Tampered payload hash | Tampering | Status=REJECTED_TRUST_BOUNDARY |
| S4 | Unauthorized actor | Impersonation | Status=REJECTED, not SEALED |
| S5 | Spoofed issuer prefix | Impersonation via substring | Status=REJECTED, not SEALED |
| S6 | Tampered receipt signature | Receipt forgery | Verification returns Invalid |
| S7 | Unknown tenant | Tenant cross-access | Status=DENY_TENANT_UNKNOWN |
| S8 | Empty tenant ID | Input validation | Status=DENY_TENANT_MISSING |
| S9 | SQL injection in tenant | Injection | Status=DENY_TENANT_UNKNOWN (no crash) |
| S10 | Malformed contract JSON | Input validation | Status=REJECTED (no crash/500) |
| S11 | Oversized payload | DoS | Rejected gracefully (no OOM crash) |
| S12 | Unauthenticated API access | Auth bypass | HTTP 401 |
| S13 | Wrong role accessing org | RBAC bypass | HTTP 403 |
| S14 | Service restart persistence | State loss | Replay still rejected, orgs persist |
| S15 | Concurrent duplicate submissions | Race condition | At most one SEALED |
| S16 | Audit trail tampering | Audit forgery | Hash chain mismatch detected |

### Performance Tests

| # | Metric | Concurrency | Payload Size |
|---|---|---|---|
| P1 | Login latency (ms) | 1, 10, 50, 100 | N/A |
| P2 | Org creation latency (ms) | 1, 10, 50, 100 | 1KB contract |
| P3 | Contract sealing latency (ms) | 1, 10, 50, 100 | 1KB, 10KB, 100KB |
| P4 | Receipt verification latency (ms) | 1, 10, 50, 100 | 1KB receipt |
| P5 | Audit retrieval latency (ms) | 1, 10, 50, 100 | N/A |
| P6 | E2E workflow latency (ms) | 1, 10, 50 | 1KB contract |
| P7 | Replay rejection latency (ms) | 1, 10, 50 | 1KB contract |
| P8 | Cold start vs warm | 1 | 1KB contract |

### Cryptographic Benchmarks

| # | Operation | Iterations |
|---|---|---|
| C1 | Ed25519 sign (SHA-512) | 10,000 |
| C2 | Ed25519 verify | 10,000 |
| C3 | ML-DSA-87 sign | 1,000 |
| C4 | ML-DSA-87 verify | 1,000 |
| C5 | BLAKE3 hash (1KB) | 100,000 |
| C6 | BLAKE3 hash (100KB) | 10,000 |

## Identified Gaps

1. **No production Dockerfile** — existing `docker/Dockerfile.ebpf` is for eBPF only; `docker-compose.yml` runs `cargo run` (slow dev mode).
2. **No security test script** — must create from scratch.
3. **No crypto benchmark harness** — must create standalone test binary.
4. **No baseline comparison** — must implement a "no-Q-Core" baseline path.
5. **TLS not enabled by default** — acceptable for local lab; documented as limitation.
6. **Vault/KMS not in Docker** — feature-gated; documented as limitation.
7. **No multi-instance deployment** — replay protection is single-process.

## Acceptance Criteria (Provisional)

| Metric | Proposed Target | Reason |
|---|---|---|
| Replay rejection | 100% | Security critical |
| Unauthorized actor rejection | 100% | Security critical |
| Tamper detection | 100% | Security critical |
| p99 contract sealing latency | < 500ms | Financial services SLA |
| Sustainable throughput | > 5 TPS | Reasonable for batch processing |
| Error rate under load | < 1% | Quality of service |
| Recovery after restart | 100% | Durability requirement |
