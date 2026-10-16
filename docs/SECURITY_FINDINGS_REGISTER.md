# Security Findings Register — Vardhan Q-Core

| Field | Value |
|---|---|
| Date | 2026-10-16 |
| Host | darwin / arm64 |
| Author | Autonomous Engineering Director (Leader-Boss) |
| Mission Phase | Phase 0 — Baseline |
| Source of truth | **Verified presence/metadata only** from the Phase 0 task brief. **NO secret values** are recorded here — file names, sizes, modes, and commit hashes only. Untested exploitability is marked **UNVERIFIED**. Severity is a triage judgement on verified exposure, not a pentest rating. |

---

## 1. Findings (presence-verified)

| ID | Finding | Severity | Owner | Status | Verified evidence (no values) | Exposure / ref |
|---|---|---|---|---|---|---|
| S-01 | Tracked admin password file | **High** | Security | **OPEN** | `scripts/qcore-pov/secrets/admin_password.txt`, 25 B, mode 644, TRACKED (commit `02707f8`) | Any clone of the repo contains the file; world-readable mode. Rotation + history purge required. |
| S-02 | Legacy dot-password in git history | **High** | Security | **OPEN** | `.admin_password`, 19 B, mode 600, untracked at HEAD but present in history (`372b69a` removal, `9b92d49` freeze) | History rewrite (BFG/`git filter-repo`) + rotation still required even though the working tree no longer tracks it. |
| S-03 | `.env` untracked but key-names mirror example | **Info** | Platform | **ACKNOWLEDGED** | `.env` 1939 B, untracked, ignored (`.gitignore:97`); key-names identical to `.env.example` | Names-only parity is expected; **UNVERIFIED**: live values and rotation posture unknown. |
| S-04 | `.gitignore` gaps: secrets-adjacent paths not ignored | **Medium** | Platform | **OPEN** | `lab_keys/`, `secrets/`, `vardhan_receipt_idempotency` NOT ignored | Accidental-commit risk for keys, secret dirs, and idempotency spill files. |
| S-05 | Port 8080 multi-claim collision | **Medium** | Platform | **OPEN** | control-plane default + `pq_shield` listen + `vardhan-receipt` Serve + `load_tester` target + `verifier` dial (127.0.0.1:8080) | Bind-order failures / test flakiness; availability impact **UNVERIFIED** at runtime (no live scan in Phase 0). DoS-by-misconfig possible but unproven. |
| S-06 | Idempotency split-brain (in-mem vs durable `qcore:event:` vs file) | **High** | Platform | **OPEN** | `backend/control_plane_api/src/durable_event_queue.rs` (sled prefix `qcore:event:`) vs file path; = gate G2 | Double-execution / replay risk under failover. Exploitability **UNVERIFIED**; needs concurrency/failover test. |
| S-07 | mTLS unverified on control-plane / node | **High** | Platform / Security | **OPEN** | Gate G3; `quantum_node` :8443 TLS example only; no handshake proof in Phase 0 | MITM / spoofing posture unknown. Marked by prior gate 2026-10-13; still open. |
| S-08 | Software-only keystore (no HSM binding) | **High** | Security | **OPEN** | Gate G4; compose volume `keystore-data`; `lab_keys/` EMPTY | Key exfiltration impact **UNVERIFIED**; HSM/KMS binding + rotation drill required. |
| S-09 | Lab harness fragility (CWD pollution, absolute path, no trap) | **Low** | QA | **OPEN** | Root `lab_demo_verify.sh` 139 lines `set -e` only, hardcoded absolute `BINARY`, CWD-polluting; platform copy 218 lines `set -euo pipefail`, temp-dir isolated, tracked; **no trap in either** | Dirty-tree / leftover-artifact risk; partial-run residue. Not directly exploitable; hygiene fix queued (gate G9). |
| S-10 | Frontend without tests/lint/router; 7614-line `App.tsx` monolith | **Low** | Frontend | **OPEN** | React 19 + Vite 8 + Tailwind v4; 6 files in `src/`; no router/test/lint; no `node_modules`; hash routing `#dashboard/` + `#public/`; single env `VITE_ENTERPRISE_CONTACT_EMAIL`; `public/` 922 KB portrait | Supply-chain and XSS posture **UNVERIFIED**; monolith impedes review. No vulnerability claimed. |
| S-11 | Pentest / ISO evidence absent | **High** | Security | **OPEN** | Gate G1; prior report 2026-10-13 lists gap; no accredited report in Phase 0 | Cannot assert production security posture. Links to `docs/RELEASE_GATES.md` G1. |
| S-12 | Stash on `feature/pov-validation-suite` uninspected | **Low** | Engineering Director | **OPEN** | 1 stash verified present; contents **UNVERIFIED** | Unknown code delta; triage queued (gate G11). No claim made about its contents. |

---

## 2. Explicitly NOT Claimed (UNVERIFIED)

| # | Item | Why not claimed |
|---|---|---|
| 1 | No CVE / CVSS scores | No scan output supplied in Phase 0 (`cargo-audit`/`cargo-deny` outcomes **UNVERIFIED**) |
| 2 | No exploit confirmations | No adversarial run logs supplied; `verifier` TCP-client verdict unknown |
| 3 | No crypto breakage | Library versions only; FIPS/correctness/side-channel unassessed |
| 4 | No live network exposure | No `ss -tulpn` / firewall / TLS scan performed |
| 5 | No secret values | Deliberately omitted; presence/metadata only |

---

## 3. Remediation Queue (priority order)

| Priority | IDs | Action | Exit artifact |
|---|---|---|---|
| P0 | S-01, S-02 | Rotate credentials; purge from history (`02707f8`, `372b69a`, `9b92d49`); verify clones | `secret-scan` green + fresh-clone grep log |
| P0 | S-04 | Add `lab_keys/`, `secrets/`, `vardhan_receipt_idempotency` (and audit spill files) to `.gitignore` | Diff of `.gitignore` + `git status` clean proof |
| P1 | S-06, S-07, S-08 | Single durable idempotency path + failover test; mTLS handshake logs; HSM binding + rotation drill | Gates G2/G3/G4 evidence |
| P1 | S-11 | Commission pentest; map ISO controls | Report + mapping in `docs/` |
| P2 | S-05 | Port allocation table + distinct defaults/profiles + bind test | Gate G5 evidence |
| P3 | S-09, S-10, S-12 | Harden lab scripts (`set -euo pipefail` + `trap` + relative paths); frontend test/lint baseline; stash triage | Gates G9/G10/G11 evidence |

---

## 4. Register Hygiene

- New findings get the next `S-NN` ID; never reuse IDs.
- Status transitions require an artifact (log, diff, or report path) cited in the evidence column.
- This register records **presence and triage**, not pentest conclusions, until S-11 is cleared.

---

*End of Security Findings Register — 2026-10-16.*

---

## 5. Phase 1 Execution Log (2026-10-16) — secret hygiene, NON-DESTRUCTIVE only

| Item | Detail |
|---|---|
| Scope | Phase 1 secret hygiene only. No history rewrite, no rotation, no push, no stash drop, no `rm` of user files. `admin_password.txt` content NOT touched. |
| Step 1 evidence | `git ls-files scripts/qcore-pov/secrets/admin_password.txt` → file is TRACKED; `wc -c` → 25 B; `ls -la scripts/qcore-pov/secrets/` → only `admin_password.txt` present; `git log --oneline -3 -- <file>` → single commit `02707f8 feat: Add VARDHAN Q-Core PoV validation suite`; `git check-ignore -v` → `NOT_IGNORED`; `.gitignore` grep → only pre-existing `.admin_password` (line 43) and `.env` comment (line 96) matched — no rule covered `scripts/qcore-pov/secrets/`. No secret VALUES read or recorded. |
| Step 2a — security.yml | READ fully (42 lines). Secret scan EXISTS: job `supply-chain`, step `Repository secret scan` uses `git grep -nIE 'AKIA[0-9A-Z]{16}\|-----BEGIN (RSA\|EC\|OPENSSH\|PRIVATE) KEY-----'` (AWS key IDs + PEM private-key headers only). Tool: inline `git grep`, NOT gitleaks/trufflehog. NOTE: this pattern does NOT match a generic tracked password file, so S-01 is invisible to that scan. |
| Step 2b — layout/readers | `ls -R scripts/qcore-pov`: `bench.sh`, `contracts/`, `crypto_bench.py`, `docker/`, `docker-compose.yml`, `entrypoint.sh`, `perf_bench.py`, `results/`, `run.sh`, `secrets/` (only `admin_password.txt`), `security_test.py/.sh`, `test_plan.md`, `verify_results.py`. Readers of `admin_password`: `scripts/qcore-pov/docker-compose.yml` (`secrets: admin_password` → `file: ./secrets/admin_password.txt`) and `scripts/qcore-pov/entrypoint.sh` (binds `/run/secrets/admin_password` → `VARDHAN_ADMIN_PASSWORD_FILE`; falls back to a hardcoded lab temp password when no secret is mounted). |
| Step 3 | security.yml NOT modified: scan already exists, so the add-gitleaks condition was not met. Recorded as follow-up recommendation below instead of risking CI breakage. |
| Files changed | (1) `.gitignore` appended 5 lines + comment: `scripts/qcore-pov/secrets/*` + `!.../README.md` negation (plain dir rule would also swallow the README — git cannot re-include inside an excluded dir, so `/*` form used; verified: README exit 1 NOT ignored/committable, hypothetical new secret exit 0 ignored), `**/admin_password.txt`, `lab_keys/`, `vardhan_receipt_idempotency*`. (2) NEW `scripts/qcore-pov/secrets/README.md` (safe, no secrets; shows as committable `??` in status). (3) NEW executable `scripts/check_no_tracked_secrets.sh` (`set -euo pipefail`, read-only `git ls-files`, PASS/FAIL + exit codes). (4) This register entry. |
| NOT done (owner approval required) | No rotation of any previously committed value. No history rewrite/purge (`02707f8`, `372b69a`, `9b92d49`). No `git rm --cached` (deliberately avoided). No push. No stash inspection/drop. No `rm` of user files. |
| check-ignore caveat (recorded explicitly) | `git check-ignore` on an already-TRACKED file returns nothing even after adding ignore rules — the new `.gitignore` lines stop FUTURE accidental commits, but `scripts/qcore-pov/secrets/admin_password.txt` stays TRACKED until it is untracked (needs owner approval). An ignore rule is not a purge. |
| Follow-up recommendation | Upgrade `security.yml` `Repository secret scan` to gitleaks or trufflehog (or extend the `git grep` pattern to generic password/secret filenames) so S-01-class findings fail CI; wire `scripts/check_no_tracked_secrets.sh` into CI as a second gate. S-04 status moves to PARTIAL (ignore rules added, tracked file + history purge still open). |
| Verdict | Release still **BLOCKED** on rotation + purge decision (S-01, S-02 OPEN; S-04 PARTIAL).

---

## 6. Phase 8 Entry (2026-10-16) — Documentation + release governance, NO source/workflow changes

| Item | Detail |
|---|---|
| Scope | Docs-only. No workflows, no source, no CI re-run, no rotation, no history rewrite, no push. Per brief: CI NOT re-verified in Phase 8. |
| Release ref | Commit `af241e6`; repo `https://github.com/vishnuvardhanburri/VARDHAN_Q_CORE-PLATFORM`; 33 workspace crates; deployment model single-node Linux (Docker) + macOS dev-sim; frontend is a SEPARATE folder (`Vardhan-Q-Core-_-Frontend--main`), not in this backend repo. Full manifest: `docs/RELEASE_MANIFEST.md`. |
| CI posture | 9/9 green **as verified 2026-10-16 by Leader** (reproduced in `docs/RELEASE_MANIFEST.md` with per-workflow table; NOT claimed as Phase 8 re-verification). Workflows untouched. |
| Secret guard | Guard PASS (forward-looking gate). `admin_password.txt` still TRACKED (`02707f8`); history purge still OPEN as S-01b (`02707f8`, `372b69a`, `9b92d49` — rotation + `filter-repo`/BFG + fresh-clone grep required). No secret values read or recorded. |
| Fmt gate | fmt PASS (per Leader-verified CI; not re-run in Phase 8). |
| Files created | (1) NEW `docs/KNOWN_LIMITATIONS.md` — L-01…L-13 with status labels (G2 UNSUPPORTED, G3/G4/G1 PLANNED, eBPF SIMULATED on macOS, RAFT EXPERIMENTAL, backup/restore + graceful shutdown IMPLEMENTED-UNTESTED, 8080 collision KNOWN, pricing/entities contract UNVERIFIED, rate-limit UNVERIFIED). (2) NEW `docs/RELEASE_MANIFEST.md` — commit/URL/CI table/crate count/docs index/artifacts-none (UNVERIFIED provenance). |
| README verdict | UNTOUCHED — full 411-line audit found no contradicting claim: assurance badges already labelled Target/Planned (§9–24), commercial path explicitly "not … a claim of production readiness" (§98), AER-KEP-Q disclaims new-primitive/proof claims (§206), HA/DR + HSM/KMS + pentest/ISO appear only as roadmap/future-gate items (§59/133/254–267/294). No "production-ready" / "HA" / "multi-node" release claim present. |
| Residual risks | G1 (pentest/ISO) + G2 (idempotency split-brain, multi-node) + G3 (mTLS) + G4 (HSM) + S-01b (credential history purge). Release attestation remains BLOCKED on S-01/S-02 rotation + purge; G1–G4 require their gate evidence before any production-security claim. |
