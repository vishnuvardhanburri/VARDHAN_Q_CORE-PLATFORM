# Release Status — Q-Core Platform (Customer-Readiness)

> Point-in-time release record for customer conversations. No new facts; all IDs/dates transcribed from `docs/EVIDENCE_INDEX.md` (E-01..E-32) and `docs/CUSTOMER_CLAIMS_MATRIX.md` (C-01..C-14).
> Verdict: **RELEASE CANDIDATE (single-node), NOT PRODUCTION-READY** (G1 OPEN, uncommissioned).

## 1. HEAD + date

- HEAD `943e61d` (`943e61dd83cec7351f5d0a88eb5925e92d6c30ce`), verified 2026-10-17 06:13 IST (E-01).
- Working tree clean; `ls-remote origin main` == HEAD (E-02/E-03). History carries 0 `admin_password` blobs; secret guard exit 0 (E-13/E-14).
- PQC paths confirmed by grep: `ml_dsa_87` + `MlKem1024` in `backend/core_crypto/src/lib.rs` (E-29); mTLS gate `VARDHAN_TLS_CLIENT_CA_PATH` in `backend/control_plane_api/src/lib.rs` (E-30).

## 2. CI table — 6 green runs on `943e61d` (created 2026-10-17T00:43:17Z)

| Workflow | Run ID | SHA | Created (UTC) | Conclusion | Evidence |
|---|---|---|---|---|---|
| Enterprise | 38987665441 | 943e61d | 2026-10-17T00:43:17Z | success | E-04 |
| Correctness | 38987665427 | 943e61d | 2026-10-17T00:43:17Z | success | E-05 |
| Supply Chain | 38987665425 | 943e61d | 2026-10-17T00:43:17Z | success | E-06 |
| Sovereign Unified | 38987665449 | 943e61d | 2026-10-17T00:43:17Z | success | E-07 |
| Web Contract (a) | 38987665417 | 943e61d | 2026-10-17T00:43:17Z | success | E-08 |
| Web Contract (b) | 38987665422 | 943e61d | 2026-10-17T00:43:17Z | success | E-09 |

- Superseded reds (do NOT cite as current): run 38955464440 on `84ae56a` (E-10); run 38947805894 on `204642c` (E-11) — root cause `replay_protection_after_sealing` unwrap panic exit 101, fixed in `943e61d` (E-12).
- Lab run 3 reference: 44/44 PASS at `84ae56a` with 8 PASS-WITH-EXCEPTION; rerun `research/bank_lab/run_bank_lab.sh`; logs `/tmp/banklab_run3.log` + `/tmp/banklab_evidence/`, NOT in repo (E-25..E-27).

## 3. RC status

- RC `204642c` preserved per `docs/PRODUCTION_READINESS_REPORT.md` §10 (base `af241e6`, single-node, NOT PRODUCTION-READY; E-28).
- `943e61d` = test-hardening on top of RC: `git diff 204642c 943e61d --stat` = 19 files (+1740/−15); production `backend/*/src/**` diff EMPTY — production code identical (E-31).
- Mission D baseline `af241e6` (S-01b + G2/G3/G4 OPEN) is STALE/superseded; do not cite as current (E-32).

## 4. Gate scoreboard (defined scope only)

| Gate | Status | Scope | Evidence |
|---|---|---|---|
| S-01b secret-history guard | CLOSED | 0 blobs; guard PASS | E-13/E-14 |
| G2 durable idempotency + restart | CLOSED FOR DEFINED SCOPE | Single-node sled CAS (`compare_and_swap` ×4) | E-17..E-19 |
| G3 mTLS handshake proof | CLOSED FOR DEFINED SCOPE | Single-node cargo accept/reject matrix; lab baseline plaintext | E-20/E-21 |
| G4 Vault rotation drill | CLOSED-DRILL | DEV Vault 1.18 drill only; NOT prod-HSM | E-22/E-23 |
| G1 independent assurance | OPEN — PREPARED (uncommissioned) | Packet only; bars PRODUCTION-READY | E-24 |

- C-11..C-14 are explicit non-claims: no multi-node, no production-readiness, no perf figures, no certification.

## 5. Unresolved prerequisites (owners UNASSIGNED)

| Prerequisite | Owner | Status |
|---|---|---|
| G1 assessment commissioned + assessor verdict | UNASSIGNED | OPEN |
| Production CA provisioned + rotation runbook | UNASSIGNED | Unevidenced |
| Production HSM/KMS custody + rotation evidenced | UNASSIGNED | DEV-drill only |
| Customer IdP/RBAC binding validated | UNASSIGNED | Lab fixtures only |
| Multi-node / HA evidence (if ever claimed) | UNASSIGNED | EXPERIMENTAL; no claim |
| Perf/soak measurement (if ever cited) | UNASSIGNED | NOT RUN |

## 6. Supporting documents

- `docs/EVIDENCE_INDEX.md` — claim IDs E-01..E-32, method legend (VERIFIED/RECORDED/STALE); local `git` outputs for VERIFIED rows.
- `docs/CUSTOMER_CLAIMS_MATRIX.md` — claims C-01..C-14 with safe wording + per-claim evidence notes.
- `docs/BANK_LAB_RESULTS.md` — run 3 detail (44/44 + 8 exceptions; `/tmp` log paths; plaintext lab transport).
- `docs/G1_ASSURANCE_PACKET.md` — PREPARATION ONLY (E-24); `docs/PRODUCTION_READINESS_REPORT.md` §10 — RC verdict (E-28).
- `docs/KNOWN_LIMITATIONS.md` L-09 — stale baseline marker (E-32); `docs/RELEASE_GATES.md` — superseded Phase 0 baseline.
- This pack: `EXECUTIVE_EVIDENCE_SUMMARY.md` · `TECHNICAL_CAPABILITY_MATRIX.md` · `EVALUATION_BOUNDARIES.md` (§7 commercial stages, PROPOSED) · `BANK_DISCOVERY_BRIEFS.md`.

## 7. How to cite this release (copy-safe)

- "Q-Core at HEAD `943e61d` (2026-10-17): 6/6 CI green (runs 38987665441/27/25/49/17/22); lab run 3 44/44 PASS at `84ae56a` with 8 PASS-WITH-EXCEPTION."
- "RC `204642c` preserved; `943e61d` is test-hardening — production `backend/*/src/**` identical per `git diff 204642c 943e61d` empty."
- "Gates: S-01b CLOSED; G2/G3/G4 CLOSED FOR DEFINED SCOPE (single-node / drill); G1 PREPARED (OPEN, uncommissioned). Verdict: RELEASE CANDIDATE single-node, NOT PRODUCTION-READY."

## Document control

- Owner: platform engineering. Review on HEAD move, CI re-run, or any G1/G2/G3/G4/S-01b change.
- Rules: docs only; no bank internals; no contact details; no invented run IDs/dates/exits.
