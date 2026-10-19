# G1 Independent-Assurance Preparation Packet — Mission E

Base: HEAD `c61b9f8` · Date: 2026-10-16 · Mode: PREPARATION ONLY.
Verdict untouched — `docs/PRODUCTION_READINESS_REPORT.md` §10 stays BLOCKED until leader re-verification.

## 1. Scope statement

- IN SCOPE: single-node control-plane (`backend/control_plane_api`) + receipt
  pipeline (seal → transport → verify) at current HEAD, with sled durable queue
  (`qcore:event:` CAS authority), mTLS client-auth path, Vault transit binding.
- EXCLUDED: multi-node / multi-region / zero-downtime, RAFT consensus
  (`ha_cluster`, EXPERIMENTAL), eBPF on macOS (SIMULATED), backup/restore +
  graceful-shutdown drills (IMPLEMENTED-UNTESTED), rate-limit effectiveness
  (UNVERIFIED), frontend pricing/entities (separate repo, UNVERIFIED),
  fuzz / soak / `docker compose up` on Darwin (NOT RUN).
- Assessor tests the single-node topology only; any multi-node or experimental
  claim is out of scope and must not be inferred.

## 2. Threat model pointer

- Canonical: `docs/THREAT_MODEL.md` (B1–B7 boundaries, T1–T14 threats) +
  `docs/SECURITY_TEST_PLAN.md` + `docs/SECURITY_ASSESSMENT_STATUS.md`.
- NEW since Phase 7 (Mission E evidence, assessor to include):
  (a) mTLS boundary — network edge → control plane now enforces client-CA
  verification (`backend/control_plane_api/src/lib.rs`, G3 proof);
  (b) Vault transit trust — key custody via transit engine, rotation + recovery
  drill (`backend/vardhan_keystore`, G4 drill);
  (c) idempotency replay — single durable CAS path kills split-brain duplicate /
  restart / failover replay (`durable_event_queue.rs`, G2 tests).

## 3. Test evidence inventory (recorded results — behavior evidence, not certification)

| Suite | Command / script | Exit | Result | Log location |
|---|---|---|---|---|
| Lab | `bash lab_demo_verify.sh` | 0 | 5/5 PASS | `docs/CLEAN_ROOM_VERIFICATION.md` §Results #3 |
| Idempotency | `cargo test -p vardhan_idempotency` | 0 | 20/20 PASS (7+7+6+0) | `docs/CLEAN_ROOM_VERIFICATION.md` §Results #4a |
| Receipt + verifier | `cargo test -p vardhan_receipt -p vardhan_verifier` | 0 | 72/72 PASS (2+69+1+0+0) | `docs/CLEAN_ROOM_VERIFICATION.md` §Results #4b |
| Contract org_lifecycle | `cargo test -p control_plane_api --test org_lifecycle_edge_cases` | 0 | 13/13 PASS | `docs/CLEAN_ROOM_VERIFICATION.md` §Results #6 |
| Adversarial | `bash scripts/adversarial_security_test.sh` | 0 | 10/10 PASS | `docs/CLEAN_ROOM_VERIFICATION.md` §Results #7; `PROOFS/adversarial_trace.log` |
| G2 durable idempotency | `cargo test -p control_plane_api --test g2_durable_idempotency` | 0 | 4/4 PASS + lib 43 PASS | Mission E commit `7151cd4`; test file `backend/control_plane_api/tests/g2_durable_idempotency.rs` |
| G3 mTLS handshake | `scripts/g3_mtls_proof.sh` | 0 | 4/4 PASS (trusted accept + rogue/nocert reject) | `/tmp/g3_mtls_proof.log`; test file `backend/control_plane_api/tests/g3_mtls_handshake.rs` |
| G4 rotation drill | `scripts/g4_vault_rotation_drill.sh` | 0 | PASS (wrap→rotate→rewrap→bad-token-Err→recovery) | `/tmp/g4-vault-drill.log`; test file `backend/vardhan_keystore/tests/vault_rotation_drill.rs` |
| CI | 9 workflows (`sovereign-ci`, `security`, `platform-web`, `platform-web-contract`, `lab-harness`, `pov-docker-validation`, `unified-local-runtime`, `enterprise-release`, `ci-correctness-benchmarks`) | 0 | 9/9 green (Leader-verified 2026-10-16) | `.github/workflows/`; `docs/PRODUCTION_READINESS_REPORT.md` §8 |

## 4. Control mapping

| Control | Status | Evidence |
|---|---|---|
| S-01b secret-history purge | CLOSED | Fresh-clone history grep 0 objects; guard `scripts/check_no_tracked_secrets.sh` exit 0; rotation done; fresh clone HEAD `2dc617b` |
| S-06 idempotency split-brain | CLOSED single-node | CAS single durable authority + 4/4 tests; multi-node UNSUPPORTED (topology limit) |
| S-07 mTLS | CLOSED single-node | Trusted-accept + rogue/nocert-reject via `scripts/g3_mtls_proof.sh` exit 0; prod CA = owner action |
| S-08 key custody | CLOSED-drill | Vault transit bind + rotation drill PASS via `scripts/g4_vault_rotation_drill.sh` exit 0; prod Vault cluster + HSM = owner-provisioned |
| S-11 pentest / ISO 27001 | OPEN-prepared | No assessment commissioned; this packet is the preparation artifact |

## 5. Explicit statement — PREPARATION ONLY

PREPARATION ONLY — no pentest commissioned, no ISO 27001 (or any) certification
claimed. Internal suites above are behavior evidence, not assurance.
Assessor needs: (1) scope in §1 above, (2) this packet, (3) repo access at HEAD.
Owner action required to commission: designate assessor, authorize scope,
fund/schedule assessment. G1 stays OPEN-prepared until a delivered report is accepted.
