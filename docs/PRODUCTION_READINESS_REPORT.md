# Production Readiness Report — Vardhan Q-Core Platform

Base commit: `af241e6` · Date: 2026-10-16 · Scope: single-node Linux (Docker) + macOS dev-sim.
This report reconciles documentation against `af241e6` reality. It makes no
production-security claim; release posture is governed by §9–§10.

## §1 Architecture reconciliation

- Workspace: **33 crates** (`cargo metadata --no-deps`, re-verified 2026-10-16).
- `ARCHITECTURE.md` EXISTS in-repo (10862 B). README §294 is honest:
  "Production claims require runtime evidence…" (README line 294).
- Control-plane routes: `backend/control_plane_api/src/lib.rs:221-412`
  (46 `.route(` entries inside that range; file is 749 lines total).
- Crypto: dual **ML-DSA-87** (FIPS 204; `core_crypto/src/lib.rs`) +
  **ML-KEM-1024** (FIPS 203) with **Ed25519 / BLAKE3** paths present
  (`core_crypto/src/lib.rs`, `license.rs`, `vault.rs`, `anti_tamper.rs`).
- Verifiers: **3 distinct crates** — `backend/pq_verify`,
  `backend/vardhan_verifier`, `backend/verifier` (separate dirs, not aliases).
- Storage: **sled** (`control_plane_api/Cargo.toml`; durable queue at
  `backend/control_plane_api/src/durable_event_queue.rs`, prefix `qcore:event:`).
- Topology at `af241e6`: **durable single-process** node; multi-node idempotency
  and consensus remain gated (G2; see `docs/KNOWN_LIMITATIONS.md` L-01/L-02).

## §2 Service / port map

Source: `docs/SERVICE_PORT_REGISTRY.md` (Phase-2 snapshot; defaults unchanged).

| Service / binary | Port | Note |
|---|---|---|
| control-plane API (`control_plane_api`) | 8080 (`127.0.0.1`) | Override `VARDHAN_CONTROL_PLANE_ADDR` |
| pq-shield ingress (`pq_shield`) | 8080 (`0.0.0.0:{VARDHAN_PORT}`) | Override `VARDHAN_PORT` — **COLLISION [KNOWN]** |
| receipt gateway (`vardhan-receipt Serve`) | 8080 (`--port` default) | Override `--port <N>` — **COLLISION [KNOWN]** |
| load-tester target | 8080 (default target) | Override `--target <addr>` |
| verifier dial target | 8080 (test client) | No override; point manually |
| intelligence-plane UI | 3000 (compose-mapped) | `VARDHAN_INTELLIGENCE_PORT` |
| mock upstream | 9090 (fixed test double) | None |
| heartbeat (UDP) | 18080 | `VARDHAN_HEARTBEAT_PORT` |
| raft | 18090 | `VARDHAN_RAFT_PORT` |
| admin API | 8081 | `VARDHAN_ADMIN_PORT` |
| OTLP test collector | 4318 (test-only) | None |
| quantum_node proxy | 8443 (TLS example) | `--bind <addr>`; handshake UNVERIFIED (G3) |
| HA-test-only | 18081 | Test scope only |

`qcore doctor` warns on the 8080 collision; stagger with overrides (L-11).

## §3 API contracts

- Canonical contract: `api/openapi.yaml` — OpenAPI 3.1.0, `version: 1.1.0`,
  **31 paths** (`grep -c "^  /"` = 31).
- Backend has **NO pricing/entities routes**: `grep -rln "pricing|entities"`
  under `backend/control_plane_api/src/` returns empty at `af241e6`.
- Frontend lives in a SEPARATE folder (`Vardhan-Q-Core-_-Frontend--main`),
  not in this backend repo — pricing/entities provider contract is
  **[UNVERIFIED]** (see `docs/KNOWN_LIMITATIONS.md` L-10).

## §4 Crypto components

| Component | Status | Evidence |
|---|---|---|
| ML-DSA-87 sign/verify (FIPS 204) | `[IMPLEMENTED-TESTED]` (unit) | `core_crypto/src/lib.rs` |
| ML-KEM-1024 (FIPS 203) | `[IMPLEMENTED-TESTED]` (unit) | `core_crypto/src/lib.rs:4` |
| Ed25519 / BLAKE3 paths | `[IMPLEMENTED-TESTED]` (unit) | `license.rs`, `vault.rs`, `anti_tamper.rs` |
| HSM / KMS custody | `[PLANNED]` (Gate G4) | Software-only keystore; `lab_keys/` empty |

No new cryptanalysis in Phase 8; live handshake / custody proofs remain gated.

## §5 Deployment assumptions

- Supported at `af241e6`: **single-node Linux via `docker-compose.yml`** +
  **macOS dev-sim** (eBPF is `[SIMULATED]` on macOS — L-12).
- Multi-region / zero-downtime are roadmap items (README Phase 6), not release
  claims. `docs/ROLLBACK_AND_RECOVERY.md` is a Phase-6 stub — kept as-is.
- Compose volume `keystore-data` holds the software keystore (G4 open).

## §6 Feature status table

| Feature | Label | Pointer |
|---|---|---|
| Control-plane API + durable queue | `[IMPLEMENTED-TESTED]` (unit) / failover `[UNVERIFIED]` | L-01, S-06 |
| RAFT multi-node consensus | `[EXPERIMENTAL]` | L-02 (`ha_cluster`) |
| Backup / restore | `[IMPLEMENTED-UNTESTED]` | L-03 |
| Graceful shutdown | `[IMPLEMENTED-UNTESTED]` | L-04 |
| Rate limiting | `[UNVERIFIED]` (effectiveness) | L-05 |
| mTLS | `[PLANNED]` (G3) | L-06, S-07 |
| HSM / KMS | `[PLANNED]` (G4) | L-07, S-08 |
| Pentest / ISO 27001 | `[PLANNED]` (G1) | L-08, S-11 |
| Secret-history purge | `[KNOWN]` OPEN (S-01b) | §7, L-09 |
| Frontend pricing/entities | `[UNVERIFIED]` (contract) | L-10 |
| Port 8080 collision | `[KNOWN]` | L-11 |
| eBPF on macOS | `[SIMULATED]` | L-12 |
| Deployment model | `[KNOWN]` single-node only | L-13 |

## §7 Secret-exposure statement (S-01 / S-01b)

- `scripts/qcore-pov/secrets/admin_password.txt`: **UNTRACKED at `af241e6`**
  (removed from index via `git rm --cached` in `af241e6`; present on disk;
  covered by `.gitignore` `scripts/qcore-pov/secrets/*` + `**/admin_password.txt`;
  `git ls-files | grep admin_password` = 0; guard
  `scripts/check_no_tracked_secrets.sh` PASSES).
- History **STILL contains secret-bearing blobs**: `02707f8` (add) plus legacy
  `.admin_password` in `372b69a` / `9b92d49`. Rotation + `filter-repo`/BFG purge
  + force-push coordination are **STILL OPEN as S-01b**.
- Explicitly: **untracked-and-ignored is NOT rotation, NOT purge, NOT proof
  of non-exposure.** No secret values were read or recorded in Phase 8.

## §8 CI summary

- **9/9 workflows green as Leader-verified 2026-10-16** (`sovereign-ci`,
  `security`, `platform-web`, `platform-web-contract`, `lab-harness`,
  `pov-docker-validation`, `unified-local-runtime`, `enterprise-release`,
  `ci-correctness-benchmarks`). **NOT re-run in Phase 8** (docs-only phase;
  `bash -n` N/A — no shell scripts changed).

## §9 Residual gates

- **G1** (pentest/ISO evidence, S-11) — OPEN.
- **G2** (single durable idempotency path + failover/concurrency test, S-06) — OPEN.
- **G3** (mTLS handshake proof, S-07) — OPEN.
- **G4** (HSM/KMS binding + rotation drill, S-08) — OPEN.
- **S-01b** (credential rotation + history purge + force-push coordination) — OPEN.

## §10 Verdict (Phase 8 scope)

- **Phase 8 documentation-governance: COMPLETE** — L-09 corrected to
  `af241e6` reality; this report created; no code or ports changed.
- **Release decision: DEFERRED to Phase 10.** Current posture is **BLOCKED**
  on S-01b + G1–G4. No owners, dates, or results are invented in this report;
  each gate requires its own evidence before any production claim.
