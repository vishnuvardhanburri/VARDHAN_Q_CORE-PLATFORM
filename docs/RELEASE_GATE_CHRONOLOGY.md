# Release Gate Chronology — Missions D → E → F + CI Fix

Scope: single-node only. HEAD `943e61d` (2026-10-17). RC designation stays `204642c` (see §4).
Status vocabulary used below: `CLOSED` / `CLOSED FOR DEFINED SCOPE` / `PREPARED` / `OPEN` / `NOT RUN` / `UNVERIFIED`. Full proof rows: `docs/EVIDENCE_INDEX.md`.

## 1. Mission D — baseline `af241e6` (2026-10-16 21:26 +0530, STALE snapshot)

- **S-01b OPEN** — per `docs/KNOWN_LIMITATIONS.md` L-09 + `docs/PRODUCTION_READINESS_REPORT.md` (PRR) §7: `admin_password.txt` untracked-and-ignored at `af241e6`, but history blobs present (`02707f8` add; `372b69a`/`9b92d49` legacy `.admin_password`). Rotation + purge + force-push coordination still open.
- **G2/G3/G4 OPEN** — per PRR §9 residual gates: G2 single durable path + failover/concurrency test OPEN; G3 mTLS handshake proof OPEN; G4 HSM/KMS binding + rotation drill OPEN. **G1 OPEN** (pentest/ISO, S-11).
- Do not cite `af241e6` docs as current; they are superseded (EVIDENCE_INDEX `STALE`).

## 2. Mission E — closeout `204642c` (2026-10-16 23:59 IST)

PRR §10 verdict at `c61b9f8` (carried into closeout `204642c`): RELEASE CANDIDATE single-node, NOT PRODUCTION-READY (G1 uncommissioned bars it).

- **S-01b CLOSED** — purge commits `ce22c49` / `2dc617b` (both 2026-10-16; `2dc617b` 23:06:58 +0530); `git rev-list --objects --all | grep -ci admin_password` → `0`; guard `scripts/check_no_tracked_secrets.sh` exit `0`. Caveat: history was REWRITTEN, so pre-purge clones/forks still carry blobs until re-cloned.
- **G2 CLOSED FOR DEFINED SCOPE (single-node)** — commit `7151cd4` (2026-10-16 23:27:31 +0530); authority `backend/control_plane_api/src/durable_event_queue.rs` (`compare_and_swap`, lines 114,160,211,251); tests `backend/control_plane_api/tests/g2_durable_idempotency.rs` (4/4 + 43 lib).
- **G3 CLOSED FOR DEFINED SCOPE (single-node)** — commit `c61b9f8` (2026-10-16 23:51:17 +0530); tests `backend/control_plane_api/tests/g3_mtls_handshake.rs` (4/4) + `scripts/g3_mtls_proof.sh` exit 0; enforcement `VARDHAN_TLS_CLIENT_CA_PATH` in `backend/control_plane_api/src/lib.rs`. Remaining: prod CA owner-provisioned.
- **G4 CLOSED FOR DEFINED SCOPE (drill)** — commit `c61b9f8`; test `backend/vardhan_keystore/tests/vault_rotation_drill.rs` + `scripts/g4_vault_rotation_drill.sh` exit 0. DEV-Vault drill only (dev-mode HTTP, `vault server -dev`); prod Vault/HSM cluster is owner-provisioned.
- **G1 PREPARED** — `docs/G1_ASSURANCE_PACKET.md` is a preparation packet only (scope + threat-model pointer + assessor entry); independent assessment NOT commissioned.

## 3. Mission F `84ae56a` + CI fix `943e61d`

- **Mission F `84ae56a`** (2026-10-17 01:00:39 +0530): docs-only + synthetic bank lab. Lab run 3: 44/44 PASS per `docs/BANK_LAB_RESULTS.md`; evidence in `/tmp` (host-local, NOT in repo); rerun `./research/bank_lab/run_bank_lab.sh`. No production-code change, no gate transition.
- **CI fix `943e61d`** (2026-10-17 06:13:11 +0530): test-only hardening of `replay_protection_after_sealing` (env serialization + diagnosable assert + bounded retry). Fixes red Enterprise runs `38955464440` (`84ae56a`, failure) + `38947805894` (`204642c`, failure) whose root cause was the unwrap panic exit 101. 6 CI runs on `943e61d` all completed/success (created 2026-10-17T00:43:17Z): Enterprise `38987665441`, Correctness `38987665427`, Supply-Chain `38987665425`, Sovereign-Unified `38987665449`, Web-Contract `38987665417` + `38987665422`.

## 4. Per-gate reconciliation

| Gate | Mission D (`af241e6`) | Mission E (`204642c`) | Current (`943e61d`) | Proof | Remaining conditions |
|---|---|---|---|---|---|
| S-01b purge | OPEN (history blobs present) | CLOSED | CLOSED | E-13/E-14/E-15/E-16: 0 blobs, guard exit 0, `ce22c49`/`2dc617b` | notify pre-purge cloners to re-clone (rewritten history) |
| G2 idempotency | OPEN | CLOSED FOR DEFINED SCOPE (single-node) | CLOSED FOR DEFINED SCOPE (single-node) | E-17/E-18/E-19: `7151cd4`, `compare_and_swap` | multi-node / RAFT: NOT RUN; consensus UNVERIFIED |
| G3 mTLS | OPEN | CLOSED FOR DEFINED SCOPE (single-node) | CLOSED FOR DEFINED SCOPE (single-node) | E-20/E-21/E-30: `c61b9f8`, `VARDHAN_TLS_CLIENT_CA_PATH` | production CA provisioning = owner action |
| G4 rotation | OPEN | CLOSED FOR DEFINED SCOPE (drill) | CLOSED FOR DEFINED SCOPE (drill) | E-22/E-23: `c61b9f8`, dev-Vault script | prod Vault/HSM cluster = owner-provisioned |
| G1 assurance | OPEN | PREPARED (packet only) | PREPARED (packet only) | E-24: packet, uncommissioned | commission independent pentest/ISO assessment |

## 5. RC designation — preserved

RC stays **`204642c`** for the defined single-node scope. `943e61d` is test-hardening on top; production code is identical:

- `git diff 204642c 943e61d --stat` → `19 files changed, 1740 insertions(+), 15 deletions(-)`; only test file is `backend/control_plane_api/tests/org_lifecycle_edge_cases.rs`; remainder is `docs/` + `research/`; `git diff 204642c 943e61d --name-only -- 'backend/*/src/**'` → empty.
- No evidence justifies moving the RC: no `src/` change, no new gate proof, no commissioned G1. `943e61d` inherits the RC verdict with a strictly better test floor.

## 6. Required distinctions (do not conflate)

1. History **purge ≠ untracked-and-ignored**: `af241e6` merely `git rm --cached`; only `ce22c49`/`2dc617b` purged history (and rewrote it).
2. **Dev-Vault drill ≠ HSM**: G4 proves rotation logic on dev-mode Vault; prod custody needs an owner-provisioned Vault/HSM cluster.
3. **Cargo mTLS proof ≠ lab mTLS posture**: G3 handshake proof ran under cargo with runtime `/tmp` CAs; the bank lab transport baseline was plaintext HTTP with mTLS covered-by-reference.
4. **Single-node idempotency ≠ multi-node**: G2 CAS proves single-winner sled semantics on one node; multi-node idempotency is UNSUPPORTED / NOT RUN.
5. **Green CI ≠ all-deployments green**: the 6 green runs attest `943e61d` under their workflow inputs only, not every topology.
6. **Assurance packet ≠ pentest**: G1 `PREPARED` is an entry packet; no assessment was commissioned, so PRODUCTION-READY is barred.
7. **Target posture ≠ attained certification**: PQC (`MlKem1024`, `ml_dsa_87` in `backend/core_crypto/src/lib.rs`) and mTLS describe implementation choice, not a FIPS / ISO / pentest certificate.
