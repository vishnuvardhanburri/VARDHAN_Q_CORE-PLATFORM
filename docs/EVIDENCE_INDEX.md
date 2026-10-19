# Evidence Index — VARDHAN Q Core Platform

HEAD: `943e61d` (`943e61dd83cec7351f5d0a88eb5925e92d6c30ce`) · Verified: 2026-10-17 (local `git` runs below).
Method: `VERIFIED` = ran locally during authoring; `RECORDED` = transcribed from report/CI API values in mission brief; `STALE` = superseded `af241e6`-base snapshot. No bank claims. No invented run IDs/dates/exits.

| Claim ID | Claim | Source file or CI run | Commit SHA | Execution date | Exit/conclusion | Scope | Limitation | Confidence |
|---|---|---|---|---|---|---|---|---|
| E-01 | HEAD is `943e61d` (`git rev-parse HEAD`) | `git rev-parse HEAD` | 943e61d | 2026-10-17 | `943e61dd83cec7351f5d0a88eb5925e92d6c30ce` | repo-wide | local clone only | VERIFIED |
| E-02 | Working tree clean (`git status --short` empty) | `git status --short` | 943e61d | 2026-10-17 | exit 0, empty output | repo-wide | untracked-ignored files not shown | VERIFIED |
| E-03 | Push sync: `ls-remote origin main` == HEAD | `git ls-remote origin main` | 943e61d | 2026-10-17 | `943e61dd… == refs/heads/main` | remote `main` | does not prove CI ran | VERIFIED |
| E-04 | Enterprise CI green on 943e61d | run 38987665441 | 943e61d | 2026-10-17T00:43:17Z | completed / success | CI, single SHA | scoped to workflow inputs | RECORDED |
| E-05 | Correctness CI green on 943e61d | run 38987665427 | 943e61d | 2026-10-17T00:43:17Z | completed / success | CI, single SHA | scoped to workflow inputs | RECORDED |
| E-06 | Supply-Chain CI green on 943e61d | run 38987665425 | 943e61d | 2026-10-17T00:43:17Z | completed / success | CI, single SHA | scoped to workflow inputs | RECORDED |
| E-07 | Sovereign-Unified CI green on 943e61d | run 38987665449 | 943e61d | 2026-10-17T00:43:17Z | completed / success | CI, single SHA | scoped to workflow inputs | RECORDED |
| E-08 | Web-Contract CI green on 943e61d (a) | run 38987665417 | 943e61d | 2026-10-17T00:43:17Z | completed / success | CI, single SHA | scoped to workflow inputs | RECORDED |
| E-09 | Web-Contract CI green on 943e61d (b) | run 38987665422 | 943e61d | 2026-10-17T00:43:17Z | completed / success | CI, single SHA | scoped to workflow inputs | RECORDED |
| E-10 | Red Enterprise run on older SHA 84ae56a | run 38955464440 | 84ae56a | pre-943e61d | completed / failure | CI, superseded SHA | superseded by 943e61d fix | RECORDED |
| E-11 | Red Enterprise run on older SHA 204642c | run 38947805894 | 204642c | pre-943e61d | completed / failure | CI, superseded SHA | superseded by 943e61d fix | RECORDED |
| E-12 | Red root cause: `replay_protection_after_sealing` unwrap panic exit 101, fixed in 943e61d | CI logs + commit subject | 943e61d | 2026-10-17 | fix commit present | single test | prod `src/` unchanged (see E-31) | RECORDED |
| E-13 | 0 `admin_password` blobs in `git rev-list --objects --all` at HEAD | `git rev-list --objects --all \| grep -ci admin_password` | 943e61d | 2026-10-17 | count 0 (grep exit 1 = no match) | full history of this clone | pre-purge clones still carry blobs | VERIFIED |
| E-14 | Secret guard passes | `scripts/check_no_tracked_secrets.sh` | 943e61d | 2026-10-17 | exit 0, GUARD RESULT PASS | tracked files only | untracked/disk secrets out of scope | VERIFIED |
| E-15 | Purge commit ce22c49 dated 2026-10-16 | `git show -s ce22c49` | ce22c49 | 2026-10-16 | purge-plan register subject | history | history was rewritten | VERIFIED |
| E-16 | Purge commit 2dc617b dated 2026-10-16 | `git show -s 2dc617b` | 2dc617b | 2026-10-16 23:06:58 +0530 | purge-plan register subject | history | history was rewritten | VERIFIED |
| E-17 | G2 test file present | `backend/control_plane_api/tests/g2_durable_idempotency.rs` | 7151cd4 | 2026-10-16 | file present (9072 B) | single-node | test proves queue, not HTTP | VERIFIED |
| E-18 | G2 commit 7151cd4 dated 2026-10-16 | `git show -s 7151cd4` | 7151cd4 | 2026-10-16 23:27:31 +0530 | CAS path + tests subject | single-node | multi-node unsupported | VERIFIED |
| E-19 | G2 authority uses `compare_and_swap` | `backend/control_plane_api/src/durable_event_queue.rs` | 7151cd4 | 2026-10-17 | 4 hits (lines 114,160,211,251) | single durable path | single-node sled only | VERIFIED |
| E-20 | G3 test + proof script present | `backend/control_plane_api/tests/g3_mtls_handshake.rs`, `scripts/g3_mtls_proof.sh` | c61b9f8 | 2026-10-16 | files present | cargo mTLS | not the lab plaintext baseline | VERIFIED |
| E-21 | G3/G4 commit c61b9f8 dated 2026-10-16 | `git show -s c61b9f8` | c61b9f8 | 2026-10-16 23:51:17 +0530 | mTLS + Vault drill subject | single-node | prod CA/cluster owner-provisioned | VERIFIED |
| E-22 | G4 drill test + script present | `backend/vardhan_keystore/tests/vault_rotation_drill.rs`, `scripts/g4_vault_rotation_drill.sh` | c61b9f8 | 2026-10-16 | files present | dev-Vault drill | NOT prod-HSM evidence | VERIFIED |
| E-23 | G4 scope is DEV-Vault drill only (script caveat) | `scripts/g4_vault_rotation_drill.sh` header | c61b9f8 | 2026-10-16 | drill-only caveat recorded | dev Vault 1.18 | prod cluster owner-provisioned | RECORDED |
| E-24 | G1 packet is PREPARATION ONLY, assessment NOT commissioned | `docs/G1_ASSURANCE_PACKET.md` | 204642c | 2026-10-16 | packet only | assessor entry | bars PRODUCTION-READY | RECORDED |
| E-25 | Bank lab run 3: 44/44 PASS | `docs/BANK_LAB_RESULTS.md` | 84ae56a | 2026-10-17 | 44 PASS / 0 FAIL | synthetic lab | labels are research-only | RECORDED |
| E-26 | Lab evidence lives in `/tmp`, NOT in repo | `docs/BANK_LAB_RESULTS.md` (`/tmp/banklab_run3.log`, `/tmp/banklab_evidence/`) | 84ae56a | 2026-10-17 | host-local paths | lab host | not reproducible from repo alone | RECORDED |
| E-27 | Lab rerun command | `research/bank_lab/run_bank_lab.sh` | 84ae56a | 2026-10-17 | script present | synthetic lab | needs docker + lab fixtures | RECORDED |
| E-28 | RC is 204642c per PRR §10 (base af241e6, RELEASE CANDIDATE single-node, NOT PRODUCTION-READY) | `docs/PRODUCTION_READINESS_REPORT.md` §10 | 204642c | 2026-10-16 | verdict recorded | single-node | G1 uncommissioned | RECORDED |
| E-29 | PQC impl is ML-KEM-1024 + ML-DSA-87 | `backend/core_crypto/src/lib.rs` (`MlKem1024`, `ml_dsa_87`) | 943e61d | 2026-10-17 | names confirmed by grep | algorithm choice | not a FIPS/cert claim | VERIFIED |
| E-30 | mTLS enforcement via `VARDHAN_TLS_CLIENT_CA_PATH` | `backend/control_plane_api/src/lib.rs` (lines 447–450, 766–777) | 943e61d | 2026-10-17 | env-var gate confirmed | control plane | needs prod CA provision | VERIFIED |
| E-31 | Prod `src/` identical 204642c→943e61d (`-- 'backend/*/src/**'` empty) | `git diff 204642c 943e61d --name-only` | 943e61d | 2026-10-17 | empty (identical) | prod code | test/lab/docs changed only | VERIFIED |
| E-32 | Mission D baseline af241e6 (S-01b + G2/G3/G4 OPEN) is superseded | `docs/KNOWN_LIMITATIONS.md` L-09, PRR §7/§9 | af241e6 | 2026-10-16 | snapshot, do not cite as current | historical | superseded by Mission E | STALE |

## Local command outputs (2026-10-17, VERIFIED rows)

- `git status --short` → empty (clean); `git rev-parse HEAD` → `943e61dd83cec7351f5d0a88eb5925e92d6c30ce`; `git ls-remote origin main` → `943e61dd… refs/heads/main` (in sync).
- `git rev-list --objects --all | grep -ci admin_password` → `0` (grep exit 1 = no match).
- `bash scripts/check_no_tracked_secrets.sh` → exit `0`, `GUARD RESULT: PASS`.
- `git diff 204642c 943e61d --stat` → `19 files changed, 1740 insertions(+), 15 deletions(-)`; only test file is `backend/control_plane_api/tests/org_lifecycle_edge_cases.rs`; remainder is `docs/` + `research/`; `backend/*/src/**` diff is empty.
- `grep compare_and_swap backend/control_plane_api/src/durable_event_queue.rs` → lines 114,160,211,251.
- `grep -E "MlKem1024|ml_dsa_87" backend/core_crypto/src/lib.rs` → `use fips204::ml_dsa_87;`, `MlKem1024`, `PK_LEN`/`SIG_LEN`/`SK_LEN` bindings.
- `grep VARDHAN_TLS_CLIENT_CA_PATH backend/control_plane_api/src/lib.rs` → lines 447–450, 766–777.
