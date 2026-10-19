# VARDHAN Q-CORE — Security Test Plan & Evidence Matrix (Phase 7)

> Assessment-only. Every result below cites a real command run on 2026-10-16 (Darwin/arm64)
> from `BASE`. Nothing here is an audit, pentest, or certification — see
> `docs/SECURITY_ASSESSMENT_STATUS.md`. Gaps are recorded, not waived.

## 1. Threat → test matrix

| Threat (THREAT_MODEL) | Test (existing) | Command | Result (2026-10-16) | Gap |
|---|---|---|---|---|
| T1 unknown tenant | receipt unit: tenant-mismatch rejects; `DENY_TENANT_UNKNOWN` asserts (`policy_authority.rs:445,455,581`) | `cargo test -p vardhan_receipt -p vardhan_verifier` | **PASS** — receipt 69/69, verifier 1/1, publish_receipt 2/2 | multi-node registry consistency |
| T1 cross-tenant substitution | adversarial Test 7 (cross-tenant receipt rejected) | `bash scripts/adversarial_security_test.sh` | **PASS 10/10**, exit 0 | — |
| T2 session/role confusion | control-plane `tenant_isolation_test`, `receipt_trust_boundary_test`, `org_lifecycle_edge_cases` (repo-present; not re-run this phase) | `cargo test -p control_plane_api` (deferred — release-build adversarial run used instead) | NOT RE-RUN here; adversarial session flow (login→org→passport lifecycle) PASS | re-run + cite counts; concurrent-session binding test |
| T3 MFA | auth_service MFA/TOTP unit + integration (`integration_auth.rs`, mfa modules; repo-present) | `cargo test -p auth_service` (deferred) | NOT RE-RUN here | cite run; recovery-code + challenge-expiry + lockout tests |
| T4 signature forgery / key spoof | receipt R1/R2 tamper tests (`main.rs:1343,1395`) + verifier checks | `cargo test -p vardhan_receipt -p vardhan_verifier` | **PASS** 69/69 + 1/1 + 2/2 | — |
| T4 wrong-key / subject substitution | adversarial Tests 3/4/5/6/8 | `bash scripts/adversarial_security_test.sh` | **PASS 10/10**, exit 0 | — |
| T5 key compromise/revocation (G4) | keystore unit incl. `test_production_with_local_provider_fails`, plaintext-forbidden, fingerprint-mismatch guards (repo-present) | `cargo test -p vardhan_keystore` (deferred) | NOT RE-RUN here | cite run; **G4 HSM binding + rotation drill OPEN** |
| T6 replay single-process | lab check 2 (replay → REJECTED_REPLAY); receipt `test_q_replay…` (`:1175`), `test_r3_durable_replay_rejection` (`:1451`) | `bash lab_demo_verify.sh` + `cargo test -p vardhan_receipt -p vardhan_verifier` | **PASS** — lab 5/5 exit 0; receipt 69/69 | — |
| T6 replay end-to-end | adversarial Test 9 (first accept, replay rejected) | `bash scripts/adversarial_security_test.sh` | **PASS**, exit 0 | — |
| T6 durability / concurrency | idempotency conformance 7 (incl. concurrent-duplicate ×2, restart-persistence) + lib 7 + durable 6 | `cargo test -p vardhan_idempotency` | **PASS** — 7/7 conformance, 7/7 lib, 6/6 durable | **G2 split-brain OPEN**: no failover/multi-node test; 20/20-style idempotency count not reproduced here |
| T7 tamper/serialization | lab checks 3/4 (malformed hash, tampered sig); receipt tamper battery (§T7) | `bash lab_demo_verify.sh` + cargo receipt suite | **PASS** 5/5 + 69/69 | schema 1.0/1.1 duality + policy-version TODO open |
| T8 unauth admin/diag | adversarial lifecycle-integrity Test 10 (skip-to-VERIFIED rejected); trust-boundary + tenant-isolation integration (repo-present) | `bash scripts/adversarial_security_test.sh` | **PASS** 10/10 | router-layer negative test (unauth → 401 on every protected route) not scripted |
| T9 rate limiting | `test_rate_limiter_triggers_429_after_10_failures` (`integration_auth.rs:132`; repo-present) | `cargo test -p auth_service` (deferred) | NOT RE-RUN here → **UNVERIFIED effectiveness** | cite run; load-level 429; HMAC/SCIM/SSO ingress limits; sweep/eviction |
| T10 supply chain | rustls floor | `python3 scripts/check_rustls_lock.py` | **PASS** — `0.23.46` floor held; legacy `0.21.12` KMS-only (documented) | `cargo audit` / `cargo deny` not re-run locally here (CI-owned); pqcrypto migration unscheduled |
| T11 tracked secret S-01 | secret guard (fail-closed) | `bash scripts/check_no_tracked_secrets.sh` | **FAIL-as-expected** exit 1 — `scripts/qcore-pov/secrets/admin_password.txt` tracked | **S-01 OPEN**: rotate + history purge, then green |
| T12 storage corruption | sled flush paths + durable restart-persistence test | `cargo test -p vardhan_idempotency` (durable) | **PASS** 6/6 durable | corruption-injection / crash-recovery / backup-restore |
| T13 partition/consensus | ha_cluster unit tests; CI `--test-threads=1` RAFT note | (deferred) | NOT RUN here | **OPEN**: multi-node partition/election/failover |
| T14 transport MITM (G3) | rustls feature build; health `tls_enabled` flag | `python3 scripts/check_rustls_lock.py` (floor only) | floor PASS; handshake proof absent | **G3 OPEN**: mTLS accept/reject logs |
| Hygiene | `cargo fmt --check -p vardhan_receipt -p vardhan_verifier` | `cargo fmt --check …` | **PASS** exit 0 | workspace-wide fmt/clippy cite |
| Fuzz | — (no harness: no `fuzz_target`, `honggfuzz`, `libfuzzer-sys`, `arbitrary` in workspace) | NOT RUN (per brief) | recorded as **gap** | add harness (receipt parser, verifier, canonicalizer) + corpus + CI job |

## 2. Real-run citations (2026-10-16, Darwin/arm64, no docker)

1. **Adversarial — PASS, exit 0, 10/10.** `bash scripts/adversarial_security_test.sh 2>&1 | tail -20`
   → Tests 2–10 `✅ PASS`, `ALL ADVERSARIAL SECURITY CHECKS PASSED!`. Notes: script
   `kill -9`s port `:8080` (`lsof -ti :8080 | xargs kill -9 || true`), builds
   `--release --bin control_plane_api`, writes bootstrap password to `/tmp/vardhan_adv_pw`
   (600) and data to `/tmp/vardhan_adv_data`; no docker dependency. Pre-existing release
   artifacts (`target/release/control_plane_api`, `receipt_generator`) were reused.
2. **Lab — PASS, exit 0, 5/5 REAL + 1 SIMULATED.** `bash lab_demo_verify.sh` →
   `[PASS] ×5` (seal, replay, malformed, tampered-sig, unauthorized),
   `SUMMARY: PASS=5 FAIL=0 SKIP=0 SIMULATED=1`, `FINAL VERDICT: ALL LAB TESTS PASSED`.
   Traffic-enforcement is `[SIMULATED]` (eBPF/XDP Linux-only) — receipt checks are REAL.
3. **Receipt + verifier — PASS.** `cargo test -p vardhan_receipt -p vardhan_verifier` →
   `69 passed` (vardhan_receipt), `2 passed` (publish_receipt), `1 passed` (vardhan_verifier).
   Task-brief shorthand "72/72" ≈ 69 + 2 + 1 across these three targets (strict_verification:
   0 tests).
4. **Idempotency — PASS.** `cargo test -p vardhan_idempotency` →
   lib 7/7, conformance 7/7 (`…inmem_duplicate`, `…tenant_isolation`,
   `…concurrent_duplicate` × impls, `…restart_persistence`), durable 6/6.
   The brief's "20/20" figure was not reproduced; these are the binaries' actual counts.
5. **rustls floor — PASS.** `python3 scripts/check_rustls_lock.py` →
   `PASS: maintained rustls 0.23 line is patched (>= 0.23.46)`; `0.21.12` retained only via the
   opt-in AWS KMS graph (documented exception in `deny.toml`).
6. **Secret guard — FAIL-as-expected, exit 1.**
   `bash scripts/check_no_tracked_secrets.sh` → `FAIL: tracked admin_password.txt files:
   scripts/qcore-pov/secrets/admin_password.txt`; `.pem`/`.key`/`lab_keys` PASS. This is the
   S-01 control working, not a test failure to fix by editing the guard.
7. **fmt — PASS.** `cargo fmt --check -p vardhan_receipt -p vardhan_verifier` → exit 0.
8. **Fuzz — NOT RUN** (no harness in workspace; recorded as gap per brief).
9. **Deferred (repo-present, not re-run this phase):** `control_plane_api` integration
   (trust-boundary/tenant-isolation/org-edge), `auth_service` (incl. 429 + bootstrap-negative),
   `vardhan_keystore`, `ha_cluster`, `cargo audit`/`cargo deny`. Re-run and cite before any
   release claim that depends on them.

## 3. Gaps requiring future work (owners)

- **Pentest + fuzz + mTLS + multi-node failover** (G1/G2/G3; T13/T14) — owners per THREAT_MODEL.
- **HSM/KMS binding + rotation drill** (G4/T5) — Security/Cryptography.
- **S-01 rotation + history purge** (T11) — Security + Engineering Director.
- **Schema unification, rate-limit sweep + shared counter, HMAC endpoint hardening proof,
  router-layer 401 matrix, storage corruption drills** — Platform/Identity.
