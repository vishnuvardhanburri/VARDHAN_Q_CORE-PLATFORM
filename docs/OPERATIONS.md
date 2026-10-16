# Operations — VARDHAN Q-CORE (Phase 6)

Scope: single-process / single-node local runtime operated via `./qcore`
and `docker-compose.yml`. This document describes **verified-today**
behaviour only. Anything not empirically verified is marked **UNVERIFIED**.
No multi-node HA is claimed.

## 1. Health endpoint semantics (verified by source read)

- Route (single, combined): `GET /api/v1/platform/health`
  - Defined in `backend/control_plane_api/src/lib.rs:406`
    (`.route("/api/v1/platform/health", get(health))`).
  - Handler at `lib.rs:426` returns JSON containing
    `"status": "operational"` (plus `service`, `mode`, `transport` fields).
- Meaning TODAY: **liveness + readiness combined** — a `200` with
  `"status":"operational"` means the HTTP router is up and serving.
  It does **not** attest to downstream dependencies (DB, sled, peers).
- Distinct endpoints: **UNVERIFIED / absent**.
  There are no separate `/readyz` or `/livez` routes in
  `backend/control_plane_api/src/lib.rs`
  (`grep -rn "health\|ready\|live"` returns only the two lines above).

Check manually:

```bash
curl -fsS http://localhost:8080/api/v1/platform/health | grep -q operational
```

## 2. Compose healthchecks (verified by `docker-compose.yml` read)

- `control-plane`:
  `test: ["CMD-SHELL", "curl -fsS http://localhost:8080/api/v1/platform/health | grep -q operational"]`,
  `interval: 5s`, `timeout: 3s`, `retries: 20`, `start_period: 10s`,
  `restart: unless-stopped`.
- `intelligence-plane`:
  `test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/')..."]`,
  `interval: 10s`, `timeout: 3s`, `retries: 12`, `start_period: 5s`,
  with `depends_on: control-plane: condition: service_healthy`.
- The eBPF shield is intentionally **not** part of the default stack
  (`docker-compose.yml` header comment: Linux-only and privileged).

## 3. `qcore` usage (verified by `qcore` source read)

| Command | What it does (source) |
|---|---|
| `./qcore status` | `cmd_status`: curls `/api/v1/platform/health` for `operational`; curls intelligence-plane `/`; then `docker compose ps`. On non-Linux also prints a sim-mode NOTICE (eBPF/XDP unavailable). |
| `./qcore logs [service]` | `cmd_logs`: `docker compose logs -f [service]`, else `logs -f --tail=100`. |
| `./qcore down` | `cmd_down`: `docker compose down`, then kills stale native processes on the control/intelligence ports. |
| `./qcore clean [--destructive]` | `cmd_clean`: without flags, `cargo clean` + `rm -rf target/` (preserves user data). With `--destructive` (after `yes` confirm): `down -v`, `rm -rf .vardhan_data`, `rm -rf target`. |
| `./qcore test` | 10-group validation suite (env, fmt, workspace tests, frontend, contract, isolation, lab harness, E2E, raft hardening, compose config). |
| `./qcore pov` | Runs `scripts/qcore-pov/run.sh` + `verify_results.py`. |

## 4. Restart / crash recovery (empirical basis cited — no new claims)

- Idempotency, durable backend: **restart-safe, single-process only**.
  Evidence: `backend/vardhan_idempotency/tests/conformance.rs`
  `conformance_durable_restart_persistence` (lines ~222–241): register →
  drop registry (simulated restart) → reopen same path → replay is
  rejected with the original transaction id. Prior Phase 2 result: 7/7
  conformance green; this phase re-verified by source read only
  (no re-run per task bounds).
- Idempotency, in-memory backend: **volatile by design**, NOT
  restart-persistent (same file, header lines 11–13).
- Multi-node idempotency: **UNSUPPORTED** until G2 closed. The durable
  adapter serializes writers with an OS lock file on one
  machine/filesystem; the conformance header explicitly requires a shared
  strongly-consistent filesystem or transactional DB adapter for
  multi-node replay protection. Do not deploy multi-writer idempotency.
- RAFT / `ha_cluster` persistence model: **UNVERIFIED beyond unit tests**.
  The crate (`backend/ha_cluster/src/lib.rs`) exposes membership,
  heartbeat, election, and raft modules with an extensive unit/integration
  test tree (`raft_l3_*`, `raft_p8_*`, `raft_p9_*`, `transport_tests`),
  but no production multi-node durability run is claimed here.

## 5. Resource limits

- **None enforced.** `docker-compose.yml` defines no `deploy:`,
  `limits:`, `mem_limit`, or `cpus` entries (verified by grep — no hits).
  The stack runs unbounded within host capacity. Set host-level or
  orchestrator-level limits before any load exposure.

## 6. Graceful shutdown — UNVERIFIED

- The non-TLS serve path shows no graceful-shutdown hook in the read
  window; a `with_graceful_shutdown(ctrl_c)` hook exists only in the
  TLS-feature branch (`lib.rs:~719`). Orderly drain on SIGTERM for the
  default local runtime is therefore **UNVERIFIED**. Expect
  `docker compose down` / `qcore down` to stop containers without a
  documented drain sequence.

## 7. Backup / restore (procedure UNTESTED → UNVERIFIED)

Local state lives in Docker named volumes mapped from
`docker-compose.yml` (`control-plane-data`, `keystore-data`,
`idempotency-data`, `auth-config-data` → `/var/lib/vardhan/*`) and, for
native runs, in `.vardhan_data/` (see `qcore` `ensure_env` and
`cmd_clean`). Suggested **untested** procedure — do not rely on it
without a restore drill:

```bash
./qcore down
# Stop-the-world copy (untested):
docker run --rm \
  -v vardhan-q-core-platform-main_control-plane-data:/src/cp:ro \
  -v vardhan-q-core-platform-main_keystore-data:/src/ks:ro \
  -v vardhan-q-core-platform-main_idempotency-data:/src/idem:ro \
  -v vardhan-q-core-platform-main_auth-config-data:/src/auth:ro \
  -v "$(pwd)/backups/$(date +%F)":/dst \
  alpine sh -c 'cp -a /src/cp /dst/ && cp -a /src/ks /dst/ && cp -a /src/idem /dst/ && cp -a /src/auth /dst/'
# Native-run equivalent (untested):
cp -a .vardhan_data "backups/$(date +%F)/vardhan_data"
```

Restore is the reverse copy followed by `./qcore up` and the recovery
verification in `docs/ROLLBACK_AND_RECOVERY.md`. Both directions are
**UNVERIFIED** (no drill executed in this phase).

## 8. Rollback

No migration framework exists. Rollback = `git revert` / `git checkout`
to the prior SHA, rebuild, re-run verification. Full steps in
`docs/ROLLBACK_AND_RECOVERY.md`.

## 9. Deployment matrix (supported vs out of scope)

| Target | Status |
|---|---|
| Linux x86_64 / arm64, Docker, single node (`./qcore up`) | Supported local runtime |
| macOS dev-sim (`./qcore up`, native or Docker Desktop) | Supported for development; eBPF/XDP unavailable — sim mode (see `qcore status` NOTICE) |
| eBPF/XDP shield | Linux-only, privileged; excluded from default compose stack |
| Multi-node / HA cluster | **Not claimed.** `ha_cluster` unit coverage exists; no production multi-node run verified here |
| Multi-writer idempotency | **UNSUPPORTED** until G2 closed (single-process durable only) |
| Production secrets (HSM/KMS, G4) | **Required for prod;** dev defaults (`dev-strong-password-12345` etc.) must never ship |

## 10. Honest UNVERIFIED list (this phase)

1. Distinct liveness vs readiness endpoints (absent).
2. RAFT multi-node persistence / failover beyond unit tests.
3. Graceful-shutdown / drain ordering on SIGTERM (default path).
4. Backup/restore copy procedure (undrilled).
5. Any performance, soak, or scale numbers (no new claims made).
6. Multi-node idempotency (explicitly unsupported).
7. HSM/KMS-backed production key handling (G4 prerequisite).
