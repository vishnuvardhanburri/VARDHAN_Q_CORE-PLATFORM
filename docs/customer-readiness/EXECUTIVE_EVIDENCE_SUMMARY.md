# Executive Evidence Summary — Q-Core Platform

> Customer-readiness summary. Verdict: **RELEASE CANDIDATE (single-node), NOT PRODUCTION-READY** (G1 OPEN, uncommissioned).
> Guardrails: `docs/CUSTOMER_CLAIMS_MATRIX.md` (C-01..C-14) · `docs/EVIDENCE_INDEX.md` (E-01..E-32).
> HEAD `943e61d` · verified 2026-10-17 06:13 IST · RC `204642c`. No certifications held. No performance figures. No bank internals.

## 1. What Q-Core does (capability → evidence pointer, one line each)

- Tamper-evident sealed receipts — tampered submissions rejected 422/400; lab tamper 4/4 PASS (C-01; `docs/BANK_LAB_RESULTS.md`).
- Replay-safe submission — duplicates resolve to one sealed record via CAS; G2 4/4 + lab replay/20-way-race PASS (C-02; `backend/control_plane_api/tests/g2_durable_idempotency.rs`).
- Tenant binding — cross-tenant access denied 403; lab `cross_tenant` 4/4 (C-03; `docs/BANK_LAB_RESULTS.md`).
- PQC ML-DSA-87 path — `core_crypto` `ml_dsa_87` sign/verify unit-tested, implementation only (C-06; `backend/core_crypto/src/lib.rs`).
- PQC ML-KEM-1024 path — `core_crypto` `MlKem1024` encap/decap unit-tested, key exchange only (C-07; `backend/core_crypto/src/lib.rs`).
- Ed25519 paths — sign/verify round-trip on covered paths `license.rs` / `vault.rs` / `anti_tamper.rs` (C-05, UNIT).
- Vault transit rotation — rotation + recovery drilled against DEV Vault; G4 drill PASS (C-10; `backend/vardhan_keystore/tests/vault_rotation_drill.rs`).
- mTLS client-auth — accept/reject matrix evidenced by cargo test; G3 4/4 + `scripts/g3_mtls_proof.sh` (C-08; `backend/control_plane_api/tests/g3_mtls_handshake.rs`).

## 2. Demonstrated results

### 2.1 CI — 6 green runs on `943e61d` (created 2026-10-17T00:43:17Z)

| Workflow | Run ID | SHA | Conclusion |
|---|---|---|---|
| Enterprise | 38987665441 | 943e61d | success |
| Correctness | 38987665427 | 943e61d | success |
| Supply Chain | 38987665425 | 943e61d | success |
| Sovereign Unified | 38987665449 | 943e61d | success |
| Web Contract (a) | 38987665417 | 943e61d | success |
| Web Contract (b) | 38987665422 | 943e61d | success |

Source: `docs/EVIDENCE_INDEX.md` E-04..E-09 (RECORDED). Two older red runs on `84ae56a` / `204642c` are superseded (E-10/E-11).

### 2.2 Bank lab run 3 — 44/44 PASS at `84ae56a`

- 4 profiles × 11 checks, 0 FAIL; rerun via `research/bank_lab/run_bank_lab.sh` (E-25/E-27; `docs/BANK_LAB_RESULTS.md`).
- 8 PASS-WITH-EXCEPTION: `mtls_triple` + `restart_durability` × 4 profiles — live baseline observed, assertion covered by G3/G2 cargo proofs; lab transport was `plaintext_http`.
- Evidence lives in `/tmp/banklab_run3.log` + `/tmp/banklab_evidence/` on the lab host, NOT in repo (E-26).

### 2.3 Gate proofs (defined scope only)

- G2 durable idempotency + single-node restart: CLOSED single-node (`durable_event_queue.rs` CAS ×4 lines 114,160,211,251; E-17..E-19).
- G3 mTLS handshake cargo proof: CLOSED single-node cargo scope (test + `g3_mtls_proof.sh`; E-20/E-21; lab baseline plaintext, see §4).
- G4 Vault rotation drill: CLOSED-drill, DEV Vault only (drill test + `g4_vault_rotation_drill.sh` header caveat; E-22/E-23; NOT prod-HSM evidence).
- S-01b secret-history guard: CLOSED (0 `admin_password` blobs; guard exit 0; purge commits `ce22c49` + `2dc617b` dated 2026-10-16; E-13..E-16).

### 2.4 Independent re-verification (corpus-bound)

- `vardhan-receipt validate-canonical` + `vardhan_verifier` 72/72 per G1 packet (C-04, CARGO-PROOF).
- Bound to the pinned canonical corpus at HEAD; customer data or new schemas require a fresh run.
- G1 packet itself is PREPARATION ONLY — the 72/72 aids a future assessment, it is not a verdict (E-24).

## 3. RC scope

- RC `204642c` preserved per `docs/PRODUCTION_READINESS_REPORT.md` §10 (base `af241e6`); `943e61d` is test-hardening — production `backend/*/src/**` identical per `git diff 204642c 943e61d` empty (E-31).
- Scope is single-node lab/discovery evaluation only. Independent re-verification corpus `vardhan_verifier` 72/72 is corpus-bound (C-04).

## 4. Material limitations + next validation

- NOT PRODUCTION-READY: G1 PREPARED (OPEN, uncommissioned); packet is assessor-entry only (E-24; C-14).
- Prod CA / HSM-KMS owner-provisioned and unevidenced; lab ran DEV Vault + `plaintext_http` (C-08/C-10).
- Multi-node / HA UNSUPPORTED: `ha_cluster` EXPERIMENTAL, no claim permitted (C-11).
- Performance / soak NOT RUN: no figures may be cited (C-13).
- Next validation: commission G1 assessment; provision prod CA/HSM with named owners; re-verify customer data in customer-authorised synthetic environment.

## Document control

- Owner: platform engineering. Review on HEAD move or G1/G2/G3/G4 evidence change.
- Companion docs: `TECHNICAL_CAPABILITY_MATRIX.md` · `EVALUATION_BOUNDARIES.md` · `RELEASE_STATUS.md` · `BANK_DISCOVERY_BRIEFS.md`.
