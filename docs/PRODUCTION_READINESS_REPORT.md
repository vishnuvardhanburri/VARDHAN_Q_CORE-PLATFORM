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

## §10 Verdict (Phase 10 — FINAL, evidence-backed)

**Release status: BLOCKED.**

Grounds (all verified, none invented):
- **S-01b OPEN** — secret-bearing blobs remain in history (`02707f8` add;
  `372b69a`/`9b92d49` legacy). Untracked-and-ignored at HEAD is NOT rotation,
  NOT purge, NOT proof of non-exposure. Required: credential rotation +
  `filter-repo`/BFG purge + force-push coordination + fresh-clone grep proof.
  A RELEASE CANDIDATE requires clean secret history or documented owner
  risk-acceptance — neither exists.
- **G1 OPEN** — no independent pentest / ISO 27001 evidence. Internal tests
  (lab 5/5, adversarial 10/10, receipt tamper/replay) are behavior evidence
  only, not assurance or certification.
- **G2 OPEN** — multi-node idempotency UNSUPPORTED (single-process durable
  path only; split-brain across in-mem / `qcore:event:` / file unresolved).
  Required: single durable path + failover/concurrency test.
- **G3 OPEN** — mTLS handshake proof absent (plaintext default; :8443 example
  only). Required: handshake logs / enforced-TLS test.
- **G4 OPEN** — software-only keystore, no HSM/KMS custody. Required: HSM/KMS
  binding + rotation drill.
- Unsupported topologies: multi-node / multi-region / zero-downtime;
  eBPF SIMULATED on macOS; backup/restore + graceful-shutdown
  IMPLEMENTED-UNTESTED; rate-limit UNVERIFIED; frontend pricing/entities
  contract UNVERIFIED (separate repo, NOT RUN in clean-room).
- Rollback/recovery (`docs/ROLLBACK_AND_RECOVERY.md`): procedure is
  actionable for single-node (down → checkout prior SHA → rebuild → lab
  re-run → status check) but restore drill is UNTESTED — no RPO/RTO promised.

What passes today: 33-crate workspace builds; 9/9 CI green at `af241e6`
(Leader-verified 2026-10-16); clean-room at `e6ffb8a` fully green in executed
scope (guard/rustls/fmt, builds, lab 5/5, idempotency 20/20, receipt+verifier
72/72, contract 13/13, adversarial 10/10, zero failures).

**No PRODUCTION-READY claim is made. Not a RELEASE CANDIDATE (S-01b bars it).
No independent certification is claimed. Owner designations: UNASSIGNED —
requires owner designation for every gate above.**
