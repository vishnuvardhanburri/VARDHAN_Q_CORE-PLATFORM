# Phase 2 — Backend Security & Correctness Report

Date: 2026-10-16 · Scope: additive-first, reviewable changes only.
No crypto algorithms changed. No default public ports changed. No API shapes changed.

## 2A. Idempotency conformance — DONE (new file, tests green)

**Added:** `backend/vardhan_idempotency/tests/conformance.rs` (7 tests, std-only —
no new deps; `std::thread::scope` used because `tokio` is not in the crate's
`Cargo.toml`).

**Shared contract** (`Backend` trait; `MemBackend` wraps `IdempotencyRegistry`
behind a `Mutex`, `DurableBackend` wraps `DurableIdempotencyRegistry`):

| Rule | In-mem (`IdempotencyRegistry`) | Durable (`DurableIdempotencyRegistry`) |
|---|---|---|
| duplicate-submission: 2nd `check_and_register` same (tenant,key) in-window → `Err`, reports original tx id | ✅ `conformance_inmem_duplicate_submission` | ✅ `conformance_durable_duplicate_submission` |
| concurrent-duplicate: 8 racing threads → exactly 1 accept + 7 duplicates | ✅ `conformance_inmem_concurrent_duplicate` (Mutex-serialized) | ✅ `conformance_durable_concurrent_duplicate` (Arc + OS lock file) |
| restart-persistence: record survives drop+reopen on same path | N/A by design (volatile) | ✅ `conformance_durable_restart_persistence` |
| tenant isolation: same key, different tenant → accepted | ✅ | ✅ |

**Idempotency contract (confirmed by code + tests):**
- Key scope is `(tenant_id, key)`; windows are per-record `expires_at_ms`.
- In-mem: `&mut self` HashMap, volatile, single-process.
- Durable: file-backed JSON + atomic rename + `create_new` lock file
  (`src/durable.rs`); writers serialized on one machine/filesystem.
- **Single-process restriction CONFIRMED:** the durable adapter's own docs
  state multi-node needs a shared strongly-consistent filesystem or a
  transactional DB adapter. Multi-node replay protection is NOT claimed.

**Evidence:**
- `cargo test -p vardhan_idempotency` → exit 0.
  lib unit 7/7 · conformance 7/7 · durable 6/6 · doc 0 → **20 passed, 0 failed**.

## 2B. Port registry — DONE (docs + advisory doctor)

**Added:** `docs/SERVICE_PORT_REGISTRY.md` (full table with file:line evidence).
**Modified:** `qcore` `cmd_doctor` — port-occupancy WARN block only (no hard
fail, no kill; every probe `if`-guarded under `set -euo pipefail`).

**Verdict — 8080 COLLISION explicit:** `control_plane_api` (127.0.0.1:8080,
`main.rs:110`) × `pq_shield` (0.0.0.0:8080, `main.rs:24`) ×
`vardhan-receipt Serve` (`--port` default 8080, `main.rs:45`).
Rule: never run all three on defaults simultaneously; overrides
`VARDHAN_CONTROL_PLANE_ADDR` / `VARDHAN_PORT` / `--port` documented.
Full matrix (UI 3000, mock/upstream 9090, heartbeat 18080, raft 18090, admin
8081, OTLP 4318, quantum 8443) in the registry doc.

**Evidence:**
- `bash -n qcore` → OK (`QCORE_SYNTAX_OK`).
- Doctor smoke test with a listener on 18090 → WARN line emitted; without
  occupancy → no port WARNs; no hard failure introduced by the block.

## 2C. Receipt / crypto negative tests — VERIFY-ONLY (green, no new tests)

No new crypto tests added: suite is green and already covers tamper + replay.

**Evidence:** `cargo test -p vardhan_receipt -p vardhan_verifier` → exit 0.
- `vardhan_receipt` bin: 69/69 (incl. `test_r1_tampered_ed25519_signature_rejected`,
  `test_r2_tampered_mldsa87_signature_rejected`, `test_r3_durable_replay_rejection`,
  `test_q_replay_identical_transaction_rejected`, 4× concurrent REJECTED_REPLAY,
  `test_audit_tamper_detect_on_reopen`, `test_audit_forged_entry_detectable`,
  tenant/policy mismatch denials) + `publish_receipt` bin 2/2 → **71 passed**.
- `vardhan_verifier` lib 1/1 · `strict_verification` integration 0 tests (placeholder comment only) → **1 passed**.
- Pre-existing warnings only (unused imports/variables); no failures.

## Remaining blockers (G2/G3, unchanged by Phase 2)

- **G2 (multi-node replay):** durable adapter is single-filesystem only;
  cross-host dedup needs shared storage or DB adapter — NOT demonstrated.
- **G3 (8080 collision at runtime):** documented + doctor warns, but defaults
  intentionally unchanged this phase; operators must stagger ports.

## Phase 2 exit criteria — HONEST VERDICT: MET (bounded scope)

- ✅ Conformance tests added, compilable, green (duplicate/concurrent/restart per backend).
- ✅ Port registry published with evidence; 8080 collision flagged; doctor warns, never kills/fails.
- ✅ Crypto suite verified green with tamper + replay coverage; no algorithm changes.
- ⚠️ Multi-node replay NOT claimed (single-process restriction documented).
- No default ports, crypto algorithms, or API shapes changed. Changes are
  additive-first: 1 new test file, 1 new doc, 1 report, +~25 lines in `qcore`.
