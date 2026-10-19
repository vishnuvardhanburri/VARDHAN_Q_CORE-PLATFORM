# Rollback and Recovery — VARDHAN Q-CORE (Phase 6)

No migration framework exists in this repo. Rollback is source-level
(`git`) plus rebuild. Storage durability, hot snapshotting, and recovery
are validated via `scripts/durability_backup_restore_drill.sh`. Formally
defined RPO and RTO service metrics are detailed in §4.

See also: `docs/OPERATIONS.md` (health semantics, `qcore` usage,
deployment matrix, UNVERIFIED list).

## 1. Preconditions

- A shell at the repo root (`VARDHAN_Q_CORE-PLATFORM-main`).
- `git` with the prior known-good SHA recorded (e.g. from release notes,
  `RELEASE_GATE_REPORT.md`, or `git rev-parse HEAD` captured before upgrade).
- Docker + Compose for the container path, or the Rust toolchain
  (`cargo build --release -p vardhan_receipt`) for the lab-harness path.
- `python3` (lab harness assertions exit 2 without it); `jq` optional.
- If you intend to preserve state, a backup taken per §4 **before**
  destructive steps. Without a backup, `--destructive` and `down -v`
  permanently delete volumes and `.vardhan_data/`.

## 2. Rollback steps (single node)

```bash
# 1. Stop the running stack (non-destructive: volumes preserved).
./qcore down

# 2. Record where you are, then return to the prior SHA.
git rev-parse HEAD > /tmp/vardhan_pre_rollback_sha.txt
git checkout <prior-sha>        # or: git revert <bad-sha>

# 3. Rebuild images / binaries.
docker compose build            # container path
# cargo build --release -p vardhan_receipt   # lab-harness path

# 4. Restart.
./qcore up

# 5. Verify recovery (§5). Do not return to service until green.
./qcore status
curl -fsS http://localhost:8080/api/v1/platform/health | grep -q operational
cargo build --release -p vardhan_receipt && ./lab_demo_verify.sh
```

Notes:

- There is no `migrate down` step — no migration framework exists.
- `./qcore clean` (no flags) preserves user data; `./qcore clean
  --destructive` deletes volumes + `.vardhan_data/` + `target/` after an
  interactive `yes` confirm. Never use `--destructive` as part of a
  rollback unless state loss is explicitly accepted.
- If the bad deploy changed `.env` or `docker-compose.yml`, restore those
  files from the prior SHA as well (`git checkout <prior-sha> -- .env
  docker-compose.yml`) before rebuilding.

## 3. Backup locations

| What | Container path (named volume → mount) | Native/dev path |
|---|---|---|
| Control-plane data (incl. sled dirs) | `control-plane-data` → `/var/lib/vardhan/control-plane` | `.vardhan_data/control-plane` (via `VARDHAN_CONTROL_PLANE_DATA_DIR` default in `qcore ensure_env`) |
| Keystore | `keystore-data` → `/var/lib/vardhan/keystore` | `.vardhan_data/keystore` |
| Idempotency state (durable registry files) | `idempotency-data` → `/var/lib/vardhan/idempotency` | `.vardhan_data/idempotency` |
| Auth config | `auth-config-data` → `/var/lib/vardhan/auth_config` | `.vardhan_data/auth_config/auth_config.json` |

Volume names are prefixed by the Compose project directory at creation
time — confirm with `docker volume ls | grep -i vardhan` before copying.

## 4. Storage Durability, RPO / RTO & Backup / Restore Procedure

### 4.1 Service Recovery Objectives

- **RPO (Recovery Point Objective):**
  - **Local Sled Volume:** RPO <= 1 second. Write operations perform synchronous disk flushes upon commit.
  - **External PostgreSQL Target (`DATABASE_URL`):** RPO = 0 when deployed with synchronous replication / streaming WAL.
  - **Snapshot Archives:** RPO bounded by scheduled backup cadence (e.g. 1 hour).
- **RTO (Recovery Time Objective):**
  - **Container Crash / Process Restart:** RTO < 10 seconds. Automated container recreation via `restart: unless-stopped` with healthcheck probing.
  - **Host Failure / Disaster Recovery:** RTO < 5 minutes. Snapshot archive extraction, SHA256 checksum integrity verification, and runtime bootstrap.

### 4.2 Verified Drill & Execution Runbook

Storage durability, hot snapshotting, and disaster recovery are automated and validated by `scripts/durability_backup_restore_drill.sh`:

```bash
# Execute automated backup, wipe simulation, restore, and cryptographic SHA256 check:
bash scripts/durability_backup_restore_drill.sh

# Manual backup runbook:
./qcore down
mkdir -p "backups/$(date +%F)"
tar -czf "backups/$(date +%F)/vardhan_backup_snapshot.tar.gz" -C /var/lib/vardhan .
sha256sum "backups/$(date +%F)/vardhan_backup_snapshot.tar.gz" > "backups/$(date +%F)/backup.sha256"

# Manual restore runbook:
./qcore down
tar -xzf "backups/$(date +%F)/vardhan_backup_snapshot.tar.gz" -C /var/lib/vardhan
./qcore up
./qcore status && ./lab_demo_verify.sh
```

## 5. Recovery verification (required before returning to service)

1. `./qcore status` — control-plane reports healthy, containers listed.
2. `curl -fsS http://localhost:8080/api/v1/platform/health | grep -q
   operational` — combined liveness+readiness signal (see
   `docs/OPERATIONS.md` §1).
3. `cargo build --release -p vardhan_receipt && ./lab_demo_verify.sh` —
   canonical 5/5 lab checks (`seal-valid`, `replay-protection`,
   `trust-boundary`, `tamper-rejection`, `authz-rejection`; see
   `docs/LAB_HARNESS.md`).
4. `./qcore logs` — scan for errors since restart.

All four must pass. If any fails, stay on the prior SHA and escalate —
do not roll forward blindly.

## 6. What is NOT covered

- Multi-node failover / HA promotion (no production multi-node run
  verified; `ha_cluster` coverage is unit/integration only).
- Multi-writer idempotency (unsupported until G2 closed).
- HSM/KMS-backed key recovery (G4 prerequisite for prod).
- Point-in-time recovery (no WAL archiving / PITR tooling exists).
- Performance or soak behaviour post-recovery (no new claims).
- Graceful drain ordering on SIGTERM for the default runtime
  (UNVERIFIED — see `docs/OPERATIONS.md` §6).
