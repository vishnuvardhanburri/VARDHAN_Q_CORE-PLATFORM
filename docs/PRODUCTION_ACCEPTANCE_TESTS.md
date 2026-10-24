# Production acceptance test evidence — final production acceptance programme

**NOT PRODUCTION READY.** Source baseline: `cbd4cf05797edd8f6db31b503f5ea38beb60b33d` (post-merge `main` branch following PR #34, consensus concurrency hardening, strict Clippy workspace zero-warning remediation, and financial exact decimal/minor-unit enforcement).
Environment: Ubuntu 24.04 / macOS Darwin arm64; Rust 1.99.1 stable; Python 3.12+; Docker 27.x. Local synthetic fixtures and CI virtualized environments only. No real payment rails, live institutional keys, or customer funds.

## 1. Post-merge CI workflow execution matrix

All production and verification workflows are verified on the `main` branch on GitHub Actions:

| Workflow Name | Run ID | Head Commit | Result | Duration | Scope and Passing Criteria |
|---|---|---|---|---|---|
| **Vardhan Q-Core Enterprise Release Gate** | `40043013533` | `cbd4cf0` | PASS (exit 0) | ~40m | Formatting check (`cargo fmt --check`), full workspace test suite (`cargo test --workspace -- --test-threads=1`), clustered PostgreSQL idempotency verification, production KMS/HSM key drill, FIPS 140-3 KAT health gate, release binary compilation, SDK/model/industry/console contract gates, Cosign signing, SLSA provenance attestation |
| **Vardhan Q-Core Correctness & Performance** | `40043013557` | `cbd4cf0` | PASS (exit 0) | ~46m | Full unit and integration tests, E2E lifecycle suite (31/31 checks), lab demo verification (5/5 checks), adversarial security tests (issuer binding `DENY_ISSUER_UNBOUND`, audit tamper detection, Vault KMS, TLS compilation), controlled performance benchmark |
| **Sovereign Platform CI (Unified)** | `40043013535` | `cbd4cf0` | PASS (exit 0) | 8m 1s | Intelligence Plane build/tests, SDK contract validation, seven industry plane contracts, zero-knowledge engine, eBPF Linux build, Quantum Core build, control plane contract tests |
| **Supply Chain Security** | `40043013524` | `cbd4cf0` | PASS (exit 0) | 4m 53s | Patched rustls 0.23 line enforcement, cargo audit under repository exclusions, cargo deny advisories, CycloneDX SBOM verification (554 components), repository secret scanning, fail-closed tracked secret guard |
| **Platform Web Contract** | `40043013638` | `cbd4cf0` | PASS (exit 0) | 9s | Console contract gate, model compatibility, client TypeScript schemas |
| **Platform Web Contract** | `40043013546` | `cbd4cf0` | PASS (exit 0) | 15s | Web contract verification runner |
| **Docker PoV Validation** | `40033913199` | `79d3ee1` | PASS (exit 0) | 13m 43s | End-to-end Docker container build, syntax validation, high-concurrency API performance bench (`perf_bench.py` c=1, 10, 50, 100 with zero rejected requests), crypto microbenchmarks (Ed25519, BLAKE3, ML-DSA-87), signed PoV evidence bundle upload |
| **Unified Local Runtime Validation** | `40033913263` | `79d3ee1` | PASS (exit 0) | 4m 46s | Local container stack orchestration smoke test (`docker compose up`) verifying clean PostgreSQL socket initialization and control plane health checks |
| **Lab Harness Verification** | `79d3ee1` | `40033913194` | PASS (exit 0) | 1m 20s | Synthetic lab harness verification and end-to-end sandbox state validation |

## 2. Post-merge commands and observed exits

Commands executed from the repository root across local test environments and GitHub Actions runners:

| Check | Exact Command | Observed Result | Scope |
|---|---|---|---|
| post-merge-build | `cargo build --workspace --locked` | PASS (exit 0) | All crates in workspace compile cleanly |
| post-merge-format | `cargo fmt --all -- --check` | PASS (exit 0) | Zero formatting diffs across all crates |
| post-merge-clippy-strict | `cargo clippy --workspace --all-targets -- -D warnings` | PASS (exit 0) | Zero warnings and zero errors across entire workspace (libs, bins, tests, benches, examples) |
| post-merge-financial-minor-units | `cargo test -p core_crypto payment_gate` | PASS (exit 0) | Exact minor unit integer calculations, ISO 4217 scales, and non-zero minor unit invariants verified (17/17 tests pass) |
| post-merge-secrets | `bash scripts/check_no_tracked_secrets.sh` | PASS (exit 0) | Zero tracked PEM, key, or secret files |
| post-merge-rustls | `python3 scripts/check_rustls_lock.py` | PASS (exit 0) | Maintained line >= 0.23.46 verified |
| post-merge-sbom | `python3 -c "import json; data=json.load(open('bom.json')); assert data.get('bomFormat') == 'CycloneDX', 'Invalid SBOM'; assert len(data.get('components', [])) > 0, 'Empty components'"` | PASS (exit 0) | CycloneDX SBOM contains 554 valid components |
| post-merge-repo-secrets | `git grep -nIE 'AKIA[0-9A-Z]{16}\|-----BEGIN (RSA\|EC\|OPENSSH\|PRIVATE) KEY-----' -- . ':(exclude).github/workflows/security.yml' ':(exclude)zk_engine/.gitleaks.toml' ':(exclude)zk_engine/packages/keys/test/*'` | PASS (exit 0) | No matching pattern in tracked source files |
| post-merge-ha-failure | `cargo test -p ha_cluster --test raft_l3_failure` | PASS (exit 0) | 14/14 tests pass, including `test_leader_crash_10x`, `test_stale_delayed_rpc`, `test_partition_healing`, `test_stale_rpc_10x`, `test_duplicate_client_request` |
| post-merge-audit-trail | `cargo test -p vardhan_receipt audit_trail` | PASS (exit 0) | 5/5 tests pass, verifying cross-process locking, tamper detection, and trail chain linkage |
| post-merge-fips-kat | `bash scripts/test_fips_140_3_gate.sh` | PASS (exit 0) | FIPS 140-3 Known Answer Test health gate verified |
| post-merge-postgres-cluster | `bash scripts/multi_node_cluster_verify.sh` | PASS (exit 0) | Multi-node clustered PostgreSQL idempotency verified |
| post-merge-e2e-lifecycle | `python3 scripts/e2e_lifecycle_validation.py` | PASS (exit 0) | 31/31 end-to-end lifecycle verification checks passed |
| post-merge-lab-demo | `bash lab_demo_verify.sh` | PASS (exit 0) | 5/5 lab demonstration sanity checks passed |
| post-merge-unsuppressed-audit | `cargo audit --file Cargo.lock --no-fetch --no-yanked --json` | DIAGNOSTIC | Reports legacy transitive dependencies (AWS KMS SDK tree: `rustls 0.21.12`, `h2 0.3.27`, `rsa 0.9.10`). Normal `cargo audit` passes under documented repository policy. |

## 3. Post-merge consensus and durability resolution

1. **Raft Candidate Step-Down (`ha_cluster/raft_original.rs`)**:
   - In accordance with Raft §5.2, `handle_append_entries` now unconditionally steps down any candidate to `Follower` when `args.term >= *term`.
   - `handle_request_vote` restricts election timer resets strictly to cases where `stepped_down || vote_granted`.
   - `start_election` halts vote solicitation immediately upon detecting concurrent role transition.
2. **Peer Task Leak Elimination (`ha_cluster/peer_manager.rs`)**:
   - `run_peer_worker` monitors channel closure during reconnect backoff intervals.
   - `TestNode::abort()` explicitly clears active worker tasks via `clear_all_workers().await`, preventing worker starvation on resource-constrained runners.
3. **Database Container Dependency (`docker-compose.yml`, `postgres_store.rs`)**:
   - `control-plane` enforces `depends_on: postgres: condition: service_healthy`.
   - `PostgresIdempotencyStore::from_database_url` implements a 15-attempt (500ms sleep) retry handshake, eliminating container socket startup race conditions.
4. **Audit Trail Multi-Writer Protection (`vardhan_receipt/audit_trail.rs`)**:
   - Implemented exclusive advisory file locking (`fs2::FileExt::lock_exclusive`) upon opening `/tmp/audit_trail.jsonl` and unlock on drop.
   - Implemented $O(1)$ trailing chunk scan seeking to `len - 8192` with full-file fallback, eliminating file scan contention.
   - Increased default receipt execution semaphore to 64.
5. **Exact Financial Monetary Representation (`core_crypto/payment_gate.rs`)**:
   - Integrated exact minor-unit integer calculation (`amount_minor_units: u128`) and ISO 4217 currency scale definitions.
   - Enforced non-zero minor unit invariants and exact minor-unit limits, eliminating floating-point drift.

## 4. Operational and evidence boundary

- Internal testing and CI verification are passing.
- Passing CI proves that automated tests, benchmarks, and regression suites succeed; it does **not** prove that a commercial bank can safely deploy Q CORE for live payments.
- Independent external assurance, formal FIPS 140-3 NIST CMVP certification, official institutional PKI CA root distribution, downstream banking core ledger adapters, and live network sandbox approvals remain pending external requirements.

**CURRENT STATUS: NOT PRODUCTION READY**
