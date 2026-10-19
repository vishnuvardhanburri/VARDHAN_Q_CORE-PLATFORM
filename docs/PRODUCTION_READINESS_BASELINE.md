# Production Readiness Baseline — Vardhan Q-Core

| Field | Value |
|---|---|
| Date | 2026-10-16 |
| Host | darwin / arm64 |
| Author | Autonomous Engineering Director (Leader-Boss) |
| Mission Phase | Phase 0 — Baseline (Mission Phase 0 for Vardhan Q-Core) |
| Source of truth | This document records **only verified evidence** supplied in the Phase 0 task brief. Anything not directly verified is labelled **UNVERIFIED**. No test results are fabricated. No secret values are recorded. |
| Repo (BASE) | `/Users/vishnuvardhanburri/antigravity/VARDHAN_Q_CORE-PLATFORM-main` |
| Frontend reference (read-only) | `/Users/vishnuvardhanburri/antigravity/Vardhan-Q-Core-_-Frontend--main` |
| Root reference (read-only) | `/Users/vishnuvardhanburri/antigravity/` |

> **Verdict (verified):** Per `docs/RELEASE_GATE_REPORT` dated 2026-10-13 (HEAD `7741c3c`): **PASSED with limitations — NOT PRODUCTION-READY**. Open gaps: G1 pentest/ISO, G2 file-vs-durable idempotency split-brain, G3 mTLS unverified, G4 HSM. See `docs/RELEASE_GATES.md` and `docs/SECURITY_FINDINGS_REGISTER.md`.

---

## 1. Repository Baseline (verified)

| Item | Verified value | Evidence / ref |
|---|---|---|
| Branch | `main` | Task brief (git main) |
| Remote origin | `https://github.com/vishnuvardhanburri/VARDHAN_Q_CORE-PLATFORM.git` | Task brief (origin) |
| HEAD | `9b0d7c7` (2026-10-15) | Task brief |
| Working tree | clean | Task brief |
| Stash | 1 stash on `feature/pov-validation-suite` | Task brief — **UNVERIFIED**: stash contents not inspected in Phase 0 |
| Prior gate report | `RELEASE_GATE_REPORT` 2026-10-13, HEAD `7741c3c`, PASSED with limitations | Task brief |

**UNVERIFIED:** No fresh `git log`, `git status`, `cargo test`, or CI run was executed as part of this baseline doc. Do not treat this file as a passing test claim.

---

## 2. Workspace — 33 Cargo crates (verified via `cargo metadata --no-deps`)

`ebpf_kernel` is C/eBPF, **not** a Cargo member — excluded by design.

| # | Crate | Notes (verified) |
|---|---|---|
| 1 | `audit_ledger` | Workspace member |
| 2 | `auth_service` | Uses sled 0.34 (storage). See §5 |
| 3 | `authority_gate` | Workspace member |
| 4 | `control_plane_api` | Control-plane routes + sled 0.34 + durable queue. See §3/§5 |
| 5 | `core_crypto` | ed25519-dalek 2.1, ml-kem 0.2, fips204 0.4 (ML-DSA), blake3 1.5, aes-gcm, hkdf, sha3. See §4 |
| 6 | `decision_twin` | Workspace member |
| 7 | `enterprise_tenant` | Workspace member |
| 8 | `ha_cluster` | Workspace member |
| 9 | `ledger_persistence` | Workspace member |
| 10 | `ledger_sync` | Workspace member |
| 11 | `load_tester` | Targets port 8080 (verified port registry) |
| 12 | `mock_upstream` | Binds 9090 (verified port registry) |
| 13 | `orchestration_ai` | Workspace member |
| 14 | `poc_auditor` | Workspace member |
| 15 | `pq_shield` | Listens 8080; upstream 9090 (verified port registry) |
| 16 | `pq_verify` | Binary, offline bundle (verified §4) |
| 17 | `proofmesh` | Workspace member |
| 18 | `proxy_engine` | Workspace member |
| 19 | `quantum_network` | Workspace member |
| 20 | `quantum_node` | Default 8443 / TLS example (verified port registry) |
| 21 | `quantum_tui` | Workspace member |
| 22 | `receipt_generator` | Uses sled 0.34 (storage) |
| 23 | `saas_metering` | Workspace member |
| 24 | `vardhan_ebpf_user` | Userspace side of eBPF (kernel part is C, non-member) |
| 25 | `vardhan_hybrid_core` | Workspace member |
| 26 | `vardhan_idempotency` | Idempotency split-brain party (G2). See §5 |
| 27 | `vardhan_keystore` | Workspace member |
| 28 | `vardhan_model` | Workspace member |
| 29 | `vardhan_receipt` | sled 0.34, blake3, pqcrypto-mldsa 0.1.2, ed25519-dalek; dual-sign path. Serves on 8080 (`vardhan-receipt Serve`). See §4/§6 |
| 30 | `vardhan_state` | Workspace member |
| 31 | `vardhan_transaction` | Workspace member |
| 32 | `vardhan_verifier` | Library verifier path. See §4 |
| 33 | `verifier` | Binary adversarial TCP client dialling 127.0.0.1:8080. See §4/§6 |

Full dependency edges: see `docs/ARCHITECTURE_AND_DEPENDENCY_MAP.md`.

---

## 3. Control-Plane API Surface (verified)

Source: `backend/control_plane_api/src/lib.rs:221-412`.

| Route group | Verified routes |
|---|---|
| Identity | `/api/v1/me` |
| Organizations | `/organizations`, `/organizations/{id}` |
| Entitlements / billing | `.../entitlements`, `.../subscription`, `.../usage`, `.../usage/record`, `/billing/webhook`, `/catalog/plans` |
| Members / invitations | `.../members` (`.../members/{member}/role`), `.../invitations` (`.../invitations/{id}`), `/invitations/accept` |
| Auth | `/auth/webauthn/*`, `/auth/oidc/*`, `/auth/saml/*` |
| QCore receipts | `/organizations/{id}/qcore/receipts` |
| Security | `.../security/posture`, `.../security/validate`, `.../security/operations`, `.../security/executive-report`, `.../security/alerts` (`.../security/alerts/{alert_id}`), `.../security/policy-baseline`, `.../security/policy-observations`, `.../security/policy-drift`, `.../security/remediations` (`.../security/remediations/{id}`), `.../security/crypto-posture`, `.../security/audit` |
| Supply-chain / trust | `.../passports` (`.../passports/{id}`), `.../findings`, `.../incidents`, `.../transactions`, `.../aer-kep-q/status` |
| Platform | `/platform/health`, SCIM `/scim/v2.0/*` |

**UNVERIFIED:** Route handlers' authZ enforcement, rate limits, and contract-test coverage were not re-verified in Phase 0. See `docs/RELEASE_GATES.md` G-gates.

---

## 4. Cryptography (verified — presence and library versions only)

| Component | Verified fact | Ref |
|---|---|---|
| `core_crypto` | ed25519-dalek 2.1, ml-kem 0.2, fips204 0.4 (ML-DSA), blake3 1.5, aes-gcm, hkdf, sha3 | Task brief |
| `vardhan_receipt` | sled 0.34, blake3, pqcrypto-mldsa 0.1.2, ed25519-dalek; dual-signs ML-DSA-87 + Ed25519 over BLAKE3 canonical payload | Task brief |
| `pq_verify` | Binary, offline bundle | Task brief |
| `vardhan_verifier` | Library verify path | Task brief |
| `verifier` | Binary adversarial TCP client dialling 127.0.0.1:8080 | Task brief |
| `vardhan_receipt` verify path | Exists as a verifier | Task brief |

**UNVERIFIED:** Algorithm correctness, FIPS status, key custody/HSM binding (G4), and side-channel resistance. No cryptographic test outcome is claimed here.

---

## 5. Storage, Queue, Idempotency (verified)

| Item | Verified fact | Ref |
|---|---|---|
| sled 0.34 users | `control_plane_api`, `vardhan_receipt`, `auth_service`, `receipt_generator` | Task brief |
| Durable queue | `backend/control_plane_api/src/durable_event_queue.rs`, sled prefix `qcore:event:` | Task brief |
| Compose volumes | `control-plane-data`, `keystore-data`, `idempotency-data`, `auth-config-data`; local `.vardhan_data/` | Task brief |
| Idempotency split-brain (G2) | In-memory vs durable vs file implementations diverge | Task brief; tracked as G2 in `docs/RELEASE_GATES.md` |

---

## 6. Port Registry (verified — declared bindings only, no live-port scan claimed)

| Port | Owner / purpose | Status |
|---|---|---|
| 8080 | control-plane default + `pq_shield` listen + `vardhan-receipt` Serve + `load_tester` target + `verifier` dial | **COLLISION (verified)** — see Findings register |
| 3000 | Intelligence UI | Verified binding |
| 9090 | `mock_upstream` bind + `pq_shield` upstream | Verified binding |
| 18080 | Heartbeat UDP | Verified binding |
| 18090 | Raft | Verified binding |
| 8081 | Admin | Verified binding |
| 4318 | OTLP test | Test-only (verified) |
| 8443 | `quantum_node` default / TLS example | Verified binding |
| 18081 | HA test only | Test-only (verified) |

**UNVERIFIED:** No live `ss -tulpn` / socket scan performed in Phase 0. Collision impact (bind failure order, test flakiness) is **UNVERIFIED** at runtime.

---

## 7. Frontend Reference (read-only, verified as stated)

| Item | Verified fact |
|---|---|
| Git status | **NOT** a git repo |
| Stack | React 19 + Vite 8 + Tailwind v4; pnpm + `pnpm-lock.yaml` 29458 B; node 22 / pnpm 10.34.3 |
| `src/` | 6 files: `App.tsx` (7614-line monolith), `DudeAiAssistant` (529 lines), `FounderLeadership` (528 lines), `index.css` (3202 lines), `main.tsx` (10 lines) — 6th file **UNVERIFIED** by name in Phase 0 |
| API calls | 3× `fetch()` same-origin: `/api/v1/pricing/*`, `/api/v1/public/entities` |
| Routing | Hash routing `#dashboard/` + `#public/`; no router / test / lint |
| Deps state | No `node_modules` installed |
| Env | Single `VITE_ENTERPRISE_CONTACT_EMAIL` |
| `public/` | 922 KB portrait asset |

---

## 8. Lab Harness (verified)

| Item | Verified fact |
|---|---|
| Root script | `lab_demo_verify.sh`, 139 lines, `set -e` only; hardcoded `BINARY` absolute path; CWD-polluting |
| Platform copy | 218 lines, `set -euo pipefail`, repo-relative `REPO_ROOT` + `RECEIPT_BIN` override, temp-dir isolated, tracked |
| Trap handling | **No trap in either script** (verified) |
| `lab_keys/` | EMPTY (verified) |
| `lab_config/auth_config.json` | 310 B, keys `[policies, tenants]` |
| `valid_contract_debug.json` | 1989 B, schema 1.0 contract input |
| `tampered_receipt.json` | 10543 B, minified 22-key receipt |

---

## 9. Secrets Presence — NAMES ONLY, NO VALUES (verified)

| Path | Verified presence fact | Severity | Owner | Status |
|---|---|---|---|---|
| `scripts/qcore-pov/secrets/admin_password.txt` | 25 B, mode 644, TRACKED (commit `02707f8`) | High | Security | OPEN |
| `.admin_password` | 19 B, mode 600, untracked but present in history (`372b69a` removal, `9b92d49` freeze) — history rewrite still required | High | Security | OPEN |
| `.env` | 1939 B, untracked, ignored (`.gitignore:97`); key-names identical to `.env.example` | Info | Platform | ACKNOWLEDGED |
| `.gitignore` gaps | `lab_keys/`, `secrets/`, `vardhan_receipt_idempotency` NOT ignored | Medium | Platform | OPEN |

No secret values are recorded in this baseline. See `docs/SECURITY_FINDINGS_REGISTER.md`.

---

## 10. CI (verified — workflow inventory only)

8 workflows (verified names):

| # | Workflow file (name as verified) |
|---|---|
| 1 | `ci-correctness-benchmarks` |
| 2 | `enterprise-release` |
| 3 | `platform-web-contract` |
| 4 | `platform-web` |
| 5 | `pov-docker-validation` |
| 6 | `security` (`cargo-audit` / `cargo-deny` / `check_rustls_lock` / `secret-scan`) |
| 7 | `sovereign-ci` |
| 8 | `unified-local-runtime` |

**UNVERIFIED:** Workflow pass/fail status, last-green commit, and required-checks enforcement were not re-verified in Phase 0. No CI outcome is claimed here.

---

## 11. Known Gaps Carried Forward (verified from 2026-10-13 gate report)

| Gap | Title | Status |
|---|---|---|
| G1 | Pentest / ISO evidence missing | OPEN — see `docs/RELEASE_GATES.md` |
| G2 | File-vs-durable idempotency split-brain | OPEN — see §5 |
| G3 | mTLS unverified | OPEN |
| G4 | HSM unbound | OPEN |

---

## 12. Phase 0 Limitations (explicit)

1. This baseline is a **documentation snapshot** of verified brief evidence; it is not a test report.
2. Every `UNVERIFIED` tag above must be cleared by a future phase with a concrete command, log, or artifact reference before any production claim.
3. No performance, chaos, or adversarial result is implied.

---

*End of Production Readiness Baseline — 2026-10-16.*
