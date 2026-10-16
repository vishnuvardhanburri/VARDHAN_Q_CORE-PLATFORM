# Release Gates — Vardhan Q-Core

| Field | Value |
|---|---|
| Date | 2026-10-16 |
| Host | darwin / arm64 |
| Author | Autonomous Engineering Director (Leader-Boss) |
| Mission Phase | Phase 0 — Baseline |
| Source of truth | Prior `RELEASE_GATE_REPORT` (2026-10-13, HEAD `7741c3c`): **PASSED with limitations, NOT PRODUCTION-READY**. Current HEAD `9b0d7c7` (2026-10-15). No new test evidence is claimed in this file — every gate below is **BLOCKED or UNVERIFIED** unless it cites a re-run artifact. No secret values. |

---

## 0. Gate Legend

| Status | Meaning |
|---|---|
| `PASS` | Verified artifact cited (command + log) — **none claimed in Phase 0** |
| `BLOCKED` | Known gap from verified brief; must clear before release |
| `UNVERIFIED` | Not re-checked in Phase 0; must be evidenced before release |
| `OPEN` | Tracked issue, owner assigned |

---

## 1. Release Gate Table

| Gate | Title | Status | Severity | Owner | Evidence / ref | Clearance criteria |
|---|---|---|---|---|---|---|
| G0 | Baseline docs published (this Phase 0) | `OPEN` — 4 docs created, **UNVERIFIED** by second reviewer | Medium | Engineering Director | This file + siblings dated 2026-10-16 | Reviewer sign-off + `git status` clean-or-tracked |
| G1 | External pentest + ISO evidence pack | `BLOCKED` | High | Security | Prior gate 2026-10-13 lists G1 open; no new evidence in Phase 0 | Accredited pentest report + ISO control mapping checked into `docs/` |
| G2 | Idempotency split-brain: in-mem vs durable (`qcore:event:`) vs file | `BLOCKED` | High | Platform | `backend/control_plane_api/src/durable_event_queue.rs` (`qcore:event:`) vs file store; `.gitignore` gap: `vardhan_receipt_idempotency` NOT ignored | Single durable path (or fenced adapters) + concurrency test + gitignore fix verified |
| G3 | mTLS verification | `BLOCKED` | High | Platform / Security | Prior gate lists G3 mTLS unverified; `quantum_node` :8443 TLS example only | mTLS handshake proof (client-cert reject/accept logs) on control-plane + node |
| G4 | HSM-backed keys | `BLOCKED` | High | Security | Prior gate lists G4 HSM open; `keystore-data` is a compose volume (software) | HSM/KMS binding doc + rotation drill log |
| G5 | Port 8080 collision resolved | `BLOCKED` | Medium | Platform | Port registry: control-plane default + `pq_shield` listen + `vardhan-receipt` Serve + `load_tester` target + `verifier` dial all on 8080 | Port allocation table + distinct defaults or profiles + bind-order test |
| G6 | Secrets hygiene (tracked password, history, gitignore) | `BLOCKED` | High | Security | `scripts/qcore-pov/secrets/admin_password.txt` 25 B mode 644 TRACKED (`02707f8`); `.admin_password` 19 B in history (`372b69a`, `9b92d49`); gaps `lab_keys/`, `secrets/`, `vardhan_receipt_idempotency` | Secret purged from history (BFG/filter-repo) + rotation + `.gitignore` gaps closed + `secret-scan` green |
| G7 | Workspace test suite green on HEAD `9b0d7c7` | `UNVERIFIED` | High | QA | No `cargo test` run in Phase 0; prior `--test-threads=1` RAFT-flake fix noted (`9b0d7c7`) | `cargo test --workspace --test-threads=1` log attached, 0 failures |
| G8 | CI required checks green (8 workflows) | `UNVERIFIED` | High | DevOps | 8 workflows inventoried; outcomes not re-verified | CI run linked to HEAD with all required checks green |
| G9 | Lab harness hermetic + trapped | `BLOCKED` | Medium | QA | `lab_demo_verify.sh` 139 lines `set -e` only, hardcoded absolute `BINARY`, CWD-polluting; platform copy 218 lines `set -euo pipefail` but **no trap in either** | `set -euo pipefail` + `trap` cleanup + repo-relative paths + temp-dir isolation in both copies |
| G10 | Frontend contract tests (pricing/public entities, hash routes) | `UNVERIFIED` | Medium | Frontend | 3× same-origin `fetch()` (`/api/v1/pricing/*`, `/api/v1/public/entities`); no router/test/lint; no `node_modules` | `platform-web-contract` green + mocked contract fixtures |
| G11 | Stash triage (`feature/pov-validation-suite`) | `OPEN` | Low | Engineering Director | 1 stash verified present; contents **UNVERIFIED** | Stash inspected → applied or dropped, recorded |
| G12 | Crypto posture sign-off (ML-DSA-87 + Ed25519 / BLAKE3) | `UNVERIFIED` | High | Security | Lib versions verified; correctness/FIPS/key-custody **UNVERIFIED** | `.../security/crypto-posture` evidence + offline-bundle (`pq_verify`) verify log |

---

## 2. Prior Gate Carry-over (2026-10-13 → 2026-10-16)

| Prior finding | Carried as | Change since `7741c3c` |
|---|---|---|
| PASSED with limitations, NOT PRODUCTION-READY | Verdict unchanged | **UNVERIFIED** — HEAD moved `7741c3c` → `9b0d7c7`; no re-run evidence in Phase 0 |
| G1 pentest/ISO | G1 above | No new evidence (verified: none supplied) |
| G2 file-vs-durable idempotency | G2 above | No new evidence (verified: none supplied) |
| G3 mTLS unverified | G3 above | No new evidence (verified: none supplied) |
| G4 HSM | G4 above | No new evidence (verified: none supplied) |

---

## 3. Pre-release Checklist (all must be `PASS` before any PRODUCTION-READY claim)

- [ ] G1 pentest + ISO pack checked in
- [ ] G2 single durable idempotency path + test log
- [ ] G3 mTLS accept/reject logs
- [ ] G4 HSM binding + rotation log
- [ ] G5 port table + bind test
- [ ] G6 history purge + rotation + gitignore + secret-scan green
- [ ] G7 `cargo test` green log on release HEAD
- [ ] G8 CI green run linked
- [ ] G9 lab scripts hermetic (`trap`, relative paths)
- [ ] G10 web-contract green
- [ ] G11 stash resolved
- [ ] G12 crypto sign-off

**Current releasability: NOT RELEASABLE (all boxes unchecked — by design in Phase 0).**

---

## 4. Verification Command (for the release engineer)

```bash
ls -la docs/PRODUCTION_READINESS_BASELINE.md docs/ARCHITECTURE_AND_DEPENDENCY_MAP.md docs/RELEASE_GATES.md docs/SECURITY_FINDINGS_REGISTER.md \
&& wc -l docs/PRODUCTION_READINESS_BASELINE.md docs/ARCHITECTURE_AND_DEPENDENCY_MAP.md docs/RELEASE_GATES.md docs/SECURITY_FINDINGS_REGISTER.md \
&& git -C /Users/vishnuvardhanburri/antigravity/VARDHAN_Q_CORE-PLATFORM-main status --short
```

No test-result fabrication: paste real output next to each gate when clearing it.

---

*End of Release Gates — 2026-10-16.*
