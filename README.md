# Vardhan Technologies — Q Core

**Production status: LOCAL POV VERIFIED | STAGING ACCEPTANCE VERIFIED | PRODUCTION BLOCKED (NOT APPROVED FOR LIVE RAILS).**

Q Core contains Rust cryptography, tenant/authentication services, finding receipts,
audit structures, a custom transport, financial validation libraries and cluster code.
The repository also contains the Intelligence Plane, enterprise console, SDKs and ZK engine.
These components do not yet establish an approved end-to-end financial execution service.

## Evidence and release status

| Label | Current meaning |
|---|---|
| IMPLEMENTED | See the source inventory and security repairs in the readiness report |
| TESTED | Only checks with recorded commands/outcomes in the acceptance report |
| INDEPENDENTLY REVIEWED | No independent protocol/security assessment established by this task |
| CERTIFIED | No applicable CMVP, regulatory or payment-network certification established |
| NOT YET PROVEN | Official ISO schemas/profiles, complete tenant/payment authority, cross-node execution/recovery, production custody and clean deployment acceptance |

- [Readiness report](docs/PRODUCTION_READINESS_REPORT.md)
- [Baseline and inventory](docs/PRODUCTION_READINESS_BASELINE.md)
- [Actual architecture](docs/PRODUCTION_ARCHITECTURE.md)
- [Acceptance tests](docs/PRODUCTION_ACCEPTANCE_TESTS.md)
- [Open risks and external dependencies](docs/OPEN_RISKS_AND_EXTERNAL_DEPENDENCIES.md)
- [UK institutional assurance pack](docs/UK_INSTITUTIONAL_ASSURANCE_PACK.md)

## Implemented capabilities and boundaries

- Ed25519, ML-DSA and ML-KEM library integrations; algorithm use is not FIPS 140-3 certification.
- Institutional-key comparison/status/expiry and versioned ISO seal verification. The bounded
  XML profile is **not official XSD validation or SWIFT/CHAPS/FedNow interoperability**.
- Finding validation and policy authority, with [22 documented checks](docs/22_POINT_TRUST_GATE_SPECIFICATION.md).
  Hash syntax and asserted provenance do not prove underlying evidence integrity.
- Separate [payment invariant matrix](docs/PAYMENT_TRANSACTION_INVARIANTS.md). Finding sealing is not payment authorization.
- Persistent queues and local receipt reservations. Hashing and reservation alone do not prove exactly-once downstream execution.
- Signed receipts and hash-chained audit structures. Tamper evidence is not immutable retention.
- Tenant sessions, role checks, provisioning and administration; full deployment-specific access-control assessment remains required.
- Local epoch quarantine and transaction KDF. No measured sub-millisecond full recovery,
  side-channel detection guarantee, zero-downtime promise or copied-key single-use guarantee.
- Independent verification tools: `vardhan_verifier` is a library; `pq_verify` is an audit-bundle CLI.

See [cryptographic design](docs/CRYPTOGRAPHIC_DESIGN_AND_KEY_LIFECYCLE.md),
[ISO profile and migration](docs/ISO20022_VALIDATION_AND_INTEROPERABILITY.md),
[idempotency](docs/IDEMPOTENCY_AND_RECOVERY.md), [deployment](docs/SECURE_DEPLOYMENT.md),
[HA/DR](docs/HA_DR_RUNBOOK.md) and [incident response](docs/INCIDENT_RESPONSE.md).
Software zeroization reduces buffer lifetime; compiler fences do not erase all memory,
registers, crash dumps or host snapshots. Production key custody and host isolation remain necessary.

The product does not replace a bank's authorization, fraud, sanctions, settlement or
operational controls. Compliance applicability requires qualified specialists and the
intended customer/network operator. Production deployment and release publication require
explicit repository-owner approval after acceptance gates are satisfied.

## Commercial Engagement Path

Vardhan's enterprise engagement sequence is buyer-gated: **£15K architecture/security discovery -> £60K bounded proof of value -> £500K production engagement**. These are target contract values, not booked revenue or a claim of production readiness. Each stage requires buyer evidence, written acceptance criteria, and an executed agreement before the next stage begins.

- [Commercial path and stage gates](docs/commercial/README.md)
- [£15K discovery scope](docs/commercial/DISCOVERY_15K_SCOPE.md)
- [£60K proof-of-value scope](docs/commercial/POV_60K_SCOPE.md)
- [£500K production scope](docs/commercial/PRODUCTION_500K_SCOPE.md)
- [First buyer problem-validation outreach](docs/commercial/FIRST_BUYER_OUTREACH.md)
- [LGT buyer hypothesis and tailored first-contact brief](docs/commercial/LGT_TARGET_HYPOTHESIS.md)


## Quick Start

```bash
# 1. Check your environment
./qcore doctor

# 2. Build and prepare dependencies
./qcore setup

# 3. Start the full local stack
./qcore up

# 4. Run all tests
./qcore test

# 5. Run the PoV security & benchmark suite
./qcore pov
```

### Local service URLs

| Service | URL | Notes |
|---|---|---|
| Control-plane API | http://localhost:8080 | Rust, JSON/HTTPS |
| API health | http://localhost:8080/api/v1/platform/health | Returns `{"status":"operational"}` |
| Intelligence Plane | http://localhost:3000 | React dev server |

### `./qcore` commands

| Command | Description |
|---|---|
| `./qcore help` | Show available commands |
| `./qcore doctor` | Check prerequisites (OS, Rust, Docker, Node, Python, disk, ports) |
| `./qcore setup` | Build Rust binaries, create dev auth config, prepare data directories |
| `./qcore up` | Start control-plane + intelligence-plane via Docker Compose |
| `./qcore status` | Show service health and container status |
| `./qcore logs [service]` | Tail logs (optionally filter by service) |
| `./qcore test` | Run formatting, Rust tests, frontend build, contract tests, security, E2E, resilience |
| `./qcore pov` | Run the PoV security & benchmark suite (Docker), validate with `verify_results.py` |
| `./qcore down` | Stop services and clean up stray processes |
| `./qcore clean` | Remove build artifacts (preserves user data) |
| `./qcore clean --destructive` | Also remove Docker volumes and persisted state (requires confirmation) |

Configuration is read from `.env` (copy from `.env.example`). The canonical local development Compose file is `docker-compose.yml` at the repository root.

---

## Repository Map

```text
Vardhan Technologies
├── backend/              Q Core Rust crates + cryptographic substrate
│   ├── control_plane_api/  REST API server (port 8080, axum)
│   ├── vardhan_receipt/    Receipt sealing + verification engine
│   ├── core_crypto/        Ed25519, ML-DSA-87, BLAKE3, AER-KEP-Q
│   ├── auth_service/       Authentication, sessions, MFA, RBAC
│   ├── ha_cluster/         RAFT consensus + resilience tests
│   ├── vardhan_keystore/   Key management (dev + Vault/KMS)
│   ├── audit_ledger/       Tamper-evident audit structures
│   ├── enterprise_tenant/  Tenant, RBAC-SCIM, industry contracts
│   ├── pq_shield/          Post-quantum ingress shield
│   └── [more crates]       Libraries (not standalone services)
├── intelligence_plane/   React/Vite frontend + server-side research
├── scripts/              E2E, PoV, benchmarks, CI helpers
├── scripts/qcore-pov/    Standalone PoV (Docker security + perf + crypto)
├── sdk/                  First-party SDKs (TS, Python, Go, Java, Rust)
├── sdks/                 Internal SDKs used by intelligence_plane
├── zk_engine/            Zero-knowledge engine (separate Node.js monorepo)
├── platform_web/          Static enterprise console (HTML)
├── docker/               Non-eBPF Dockerfiles
├── docs/                 Architecture, assurance, roadmap, industry docs
├── evidence_pack/        Phase 8 evidence, reports, demo script
├── .github/              CI, security and release workflows
├── docker-compose.yml     Canonical local dev stack (control-plane + frontend)
├── .env.example           Local development env template
└── qcore                  Unified execution interface
```

## Validation

The canonical validation path is `./qcore test`, which runs:

1. Environment checks (`doctor`)
2. `cargo fmt --all -- --check`
3. `cargo test --workspace`
4. Intelligence Plane build (`npm run build`)
5. `scripts/check_rustls_lock.py`
6. Tenant isolation + org lifecycle tests
7. `lab_demo_verify.sh` (5 core security checks)
8. `scripts/e2e_lifecycle_validation.py` (33 lifecycle checks)
9. RAFT resilience tests (`ha_cluster`)

For isolated PoV validation without the dev stack:

```bash
./qcore pov
```

This runs the Docker-based security, performance, and cryptographic benchmark suite
and validates results with `verify_results.py`.

## Security

- `.github/workflows/security.yml` runs `cargo audit`, `cargo deny check advisories`,
  and a repository secret scan on every push/PR.
- `scripts/check_rustls_lock.py` enforces the patched rustls release floor.
- See `docs/pov/` for PoV security test results and threat model.

## Runtime Truth

Passing CI is one input to acceptance. Current limitations and fresh local results are recorded in the production readiness report. A passing build is not production approval.

**Vardhan Technologies — BE DIFFERENT**

Proprietary. All rights reserved. © Vardhan Technologies.
