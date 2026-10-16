# Blocker Register — Mission E (base 0baece5)

> Mission E update 2026-10-16: S-01b CLOSED (purge 0 objects fresh-clone at HEAD 2dc617b + guard exit 0 + rotation done); G2 CLOSED single-node; G3 CLOSED single-node; G4 CLOSED-drill; G1 OPEN-prepared. Verdict in docs/PRODUCTION_READINESS_REPORT.md UNTOUCHED — leader decides after re-verification. S-01b plan retained below for record.

| Gate | Owner | Prerequisites | Acceptance criteria | Evidence location | Status |
|---|---|---|---|---|---|
| S-01b secret-history purge | UNASSIGNED | Owner auth for rotation; force-push coordination; notify all cloners/forks | (a) rotation evidenced, (b) history contains no secret blobs (fresh-clone grep empty), (c) guard PASS on fresh clone | docs/PRODUCTION_READINESS_REPORT.md §7; docs/KNOWN_LIMITATIONS.md L-09; scripts/check_no_tracked_secrets.sh; commits 02707f8, af241e6, 372b69a, 9b92d49; CLOSED 2026-10-16: fresh-clone purge 0 objects at HEAD 2dc617b, guard exit 0, rotation done | CLOSED |
| G1 independent assurance | UNASSIGNED | Commissioned independent assessment (scope auth + assessor) | Assessment report delivered and accepted; control mapping recorded | docs/THREAT_MODEL.md; docs/SECURITY_TEST_PLAN.md; docs/SECURITY_ASSESSMENT_STATUS.md; docs/G1_ASSURANCE_PACKET.md (prep packet) | OPEN-prepared (packet ready, assessment not commissioned) |
| G2 durable idempotency | UNASSIGNED | Single durable path selected; failover/concurrency test env | One durable authoritative path; concurrency + restart + duplicate + failover tests pass in recorded topology | backend/control_plane_api/src/durable_event_queue.rs; backend/vardhan_idempotency/tests/; commit 7151cd4; test backend/control_plane_api/tests/g2_durable_idempotency.rs 4/4 | CLOSED single-node (CAS authority; multi-node UNSUPPORTED — topology limit recorded) |
| G3 mTLS handshake proof | UNASSIGNED | Trust config + test certs authorized | Trusted-client success + untrusted-client rejection with recorded command/config/exit | quantum_node :8443 example; commit c61b9f8; scripts/g3_mtls_proof.sh exit 0 (accept+reject proven); production CA provisioning = owner action | CLOSED single-node |
| G4 HSM/KMS binding | UNASSIGNED | Provider + hardware/service/credentials/env available | Key binding + rotation drill incl. failure handling and recovery | commit c61b9f8; scripts/g4_vault_rotation_drill.sh exit 0 (Vault transit bind + rotation drill PASS); production Vault cluster + HSM = owner-provisioned | CLOSED-drill |

## S-01b current posture (leader-verified 2026-10-16, values never read)

- Tracked secret files at HEAD: 0 (`git ls-files | grep admin_password` empty). Guard `scripts/check_no_tracked_secrets.sh` PASS exit 0 on current clone.
- History STILL contains secret-bearing blobs: `02707f8` (add `scripts/qcore-pov/secrets/admin_password.txt`); `af241e6` (`rm --cached` deletion — blob still reachable); `372b69a` / `9b92d49` (legacy `.admin_password`).
- Readers (paths only): `scripts/qcore-pov/docker-compose.yml` (secret `admin_password`, file `./secrets/admin_password.txt`); `scripts/qcore-pov/entrypoint.sh` (`/run/secrets/admin_password` to `VARDHAN_ADMIN_PASSWORD_FILE`, lab temp fallback).
- Rotation: UNKNOWN/UNPROVEN. Replacement provisioning: NOT DONE. Untracked-and-ignored is NOT rotation, NOT purge, NOT proof of non-exposure.

## S-01b history-purge plan (AWAITING AUTHORIZATION — do NOT execute)

> DO-NOT-RUN. Plan text only — no runnable commands included by design.

- Tool choice (descriptive): preferred `git filter-repo` history rewrite removing secret blobs; alternative BFG Repo-Cleaner.
- Coordination before any authorized run: owner auth for rotation AND force-push to main; notify all known cloners/forks (assume unknown forks exist); inventory open PRs (require rebase after rewrite); quarantine/regenerate freeze bundle `9b92d49` so it cannot re-introduce the blob.
- Rollback: record pre-purge bundle backup reference offline (location/hash retained, never redistributed).
- Verification after authorized run (fresh clone only): history grep for secret paths empty; guard PASS on fresh clone; rotation evidenced separately.
