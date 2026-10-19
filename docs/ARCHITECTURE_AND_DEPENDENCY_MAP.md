# Architecture & Dependency Map — Vardhan Q-Core

| Field | Value |
|---|---|
| Date | 2026-10-16 |
| Host | darwin / arm64 |
| Author | Autonomous Engineering Director (Leader-Boss) |
| Mission Phase | Phase 0 — Baseline |
| Source of truth | **Only verified evidence** from the Phase 0 task brief. Anything inferred is marked **UNVERIFIED**. No secret values. Crate list from `cargo metadata --no-deps` (33 members). Routes from `backend/control_plane_api/src/lib.rs:221-412`. |

---

## 1. System Topology (verified components)

```text
                    +------------------ INTELLIGENCE UI :3000 ------------------+
                    | React 19 + Vite 8 + Tailwind v4 (read-only reference)   |
                    | hash routes #dashboard/ #public/; same-origin fetch     |
                    |   /api/v1/pricing/*, /api/v1/public/entities (3x fetch) |
                    +--------------------------------+------------------------+
                                                     | same-origin (UNVERIFIED wiring)
                                                     v
  +----------------+   :9090    +-------------+   :8080 COLLISION   +---------------------------+
  | mock_upstream  +----------->+ pq_shield   +-------------------->+ control-plane :8080       |
  | bind :9090     | upstream   | listen :8080|                     | + pq_shield listen :8080  |
  +----------------+            +-------------+                     | + vardhan-receipt Serve   |
                                                                    | + load_tester target      |
                                                                    | + verifier dial           |
                                                                    +-------------+-------------+
                                                                                  |
                    +-------------------------------------------------------------+------------------------------+
                    | control_plane_api (sled 0.34)                                                             |
                    | durable_event_queue.rs PREFIX qcore:event:                                                |
                    | routes lib.rs:221-412 (me/orgs/entitlements/members/auth/webauthn/oidc/saml/qcore/        |
                    |   receipts/billing-webhook/health/catalog-plans/scim + security/* + passports/findings/   |
                    |   incidents/transactions/aer-kep-q/status)                                                |
                    +-------------------------------------------------------------+------------------------------+
                                                                                  |
           +------------------------------------------+---------------------------+------------------------------+
           |                                          |                           |                              |
  +--------+--------+  +----------------+  +----------+---------+  +--------------+-----------+  +---------------+
  | auth_service    |  | core_crypto    |  | vardhan_receipt  |  | vardhan_verifier /       |  | sled-backed     |
  | (sled 0.34)     |  | ed25519 2.1    |  | (sled 0.34)      |  | pq_verify (bin, offline   |  | receipt_        |
  |                 |  | ml-kem 0.2     |  | blake3           |  | bundle) / verifier (bin,  |  | generator       |
  |                 |  | fips204 0.4    |  | pqcrypto-mldsa   |  | adversarial TCP client    |  | (sled 0.34)     |
  |                 |  | blake3 1.5     |  | 0.1.2 + ed25519  |  | -> 127.0.0.1:8080)        |  |                 |
  |                 |  | aes-gcm/hkdf/  |  | DUAL-SIGN        |  |                           |  |                 |
  |                 |  | sha3           |  | ML-DSA-87 + Ed   |  |                           |  |                 |
  +--------+--------+  +----------------+  +----------+---------+  +--------------+-----------+  +---------------+
           |                                          |
  +--------+------------------------------------------+------------------+-------------------------------------+
  | quantum_node (:8443 default/TLS example) | quantum_network | ha_cluster (:18090 raft, :18080 hb UDP, |
  | proxy_engine | orchestration_ai | decision_twin | proofmesh | ledger_persistence | ledger_sync |        |
  | audit_ledger | authority_gate | enterprise_tenant | saas_metering | vardhan_* (hybrid_core, keystore, |
  | model, state, transaction, idempotency[G2], ebpf_user) | quantum_tui | poc_auditor | load_tester |        |
  +-------------------------------------------------------------------------------------------------------+
  C/eBPF: ebpf_kernel (NOT a Cargo member) <-> vardhan_ebpf_user  |  Admin :8081  |  OTLP test :4318
  Compose volumes: control-plane-data / keystore-data / idempotency-data / auth-config-data; .vardhan_data/
```

---

## 2. Crate Inventory — 33 members (`cargo metadata --no-deps`)

| # | Crate | Role (verified brief) | Key local refs |
|---|---|---|---|
| 1 | `audit_ledger` | Ledger / audit | — |
| 2 | `auth_service` | Auth; sled 0.34 | storage: sled 0.34 |
| 3 | `authority_gate` | Policy gate | — |
| 4 | `control_plane_api` | REST control plane; sled 0.34; durable queue | `backend/control_plane_api/src/lib.rs:221-412`, `backend/control_plane_api/src/durable_event_queue.rs` (`qcore:event:`) |
| 5 | `core_crypto` | Primitives: ed25519-dalek 2.1, ml-kem 0.2, fips204 0.4, blake3 1.5, aes-gcm, hkdf, sha3 | — |
| 6 | `decision_twin` | Decision twin | — |
| 7 | `enterprise_tenant` | Multitenancy | — |
| 8 | `ha_cluster` | HA / raft-heartbeat ports | ports 18090, 18080 |
| 9 | `ledger_persistence` | Ledger persistence | — |
| 10 | `ledger_sync` | Ledger sync | — |
| 11 | `load_tester` | Load gen → :8080 | port 8080 target |
| 12 | `mock_upstream` | Fake upstream bind :9090 | port 9090 |
| 13 | `orchestration_ai` | Orchestration | — |
| 14 | `poc_auditor` | PoC audit | — |
| 15 | `pq_shield` | Shield listen :8080, upstream :9090 | ports 8080 / 9090 |
| 16 | `pq_verify` | Offline verify bundle (bin) | §3 |
| 17 | `proofmesh` | Proof mesh | — |
| 18 | `proxy_engine` | Proxy | — |
| 19 | `quantum_network` | Network | — |
| 20 | `quantum_node` | Node default :8443 / TLS example | port 8443 |
| 21 | `quantum_tui` | TUI | — |
| 22 | `receipt_generator` | Receipt gen; sled 0.34 | storage: sled 0.34 |
| 23 | `vardhan_ebpf_user` | eBPF userspace (kernel part is C `ebpf_kernel`, non-member) | non-member: `ebpf_kernel` (C/eBPF) |
| 24 | `vardhan_hybrid_core` | Hybrid core | — |
| 25 | `vardhan_idempotency` | Idempotency (G2 split-brain party) | G2 |
| 26 | `vardhan_keystore` | Keystore | compose vol `keystore-data` |
| 27 | `vardhan_model` | Model | — |
| 28 | `vardhan_receipt` | Dual-sign receipts; sled 0.34, blake3, pqcrypto-mldsa 0.1.2, ed25519-dalek; Serve :8080 | §3, port 8080 |
| 29 | `vardhan_state` | State | — |
| 30 | `vardhan_transaction` | Transactions | — |
| 31 | `vardhan_verifier` | Verify lib path | §3 |
| 32 | `verifier` | Adversarial TCP client → 127.0.0.1:8080 (bin) | port 8080 dial |
| 33 | `quantum_tui` duplicate guard | — | listed once above; total verified = 33 per brief |

> Non-member: `ebpf_kernel` — C/eBPF, not in `cargo metadata --no-deps`. Interacts with `vardhan_ebpf_user` (exact ABI **UNVERIFIED** in Phase 0).

**UNVERIFIED:** Inter-crate dependency edges (which crate `depends_on` which) were not re-extracted from `Cargo.toml` files in Phase 0. Treat cross-crate call graphs as **UNVERIFIED** until `cargo metadata --format-version 1` edges are dumped.

---

## 3. Trust & Receipt Flow (verified)

| Step | Component | Verified fact | Ref |
|---|---|---|---|
| Sign | `vardhan_receipt` | Dual-sign ML-DSA-87 + Ed25519 over BLAKE3 canonical payload; deps sled 0.34, blake3, pqcrypto-mldsa 0.1.2, ed25519-dalek | Task brief |
| Primitive supply | `core_crypto` | ed25519-dalek 2.1, ml-kem 0.2, fips204 0.4, blake3 1.5, aes-gcm, hkdf, sha3 | Task brief |
| Verify (lib) | `vardhan_verifier` + `vardhan_receipt` verify path | Both exist as verify paths | Task brief |
| Verify (offline bin) | `pq_verify` | Offline bundle binary | Task brief |
| Verify (adversarial bin) | `verifier` | TCP client dialling 127.0.0.1:8080 | Task brief |
| Serve | `vardhan-receipt` Serve on :8080 | Shares colliding port | Port registry |

**UNVERIFIED:** Canonical-payload schema, key rotation, offline-bundle freshness, adversarial harness verdict — none claimed.

---

## 4. Control-Plane Route Table (verified)

Source: `backend/control_plane_api/src/lib.rs:221-412`.

| Prefix | Routes (verified) |
|---|---|
| `/api/v1/me` | self identity |
| `/organizations` | collection + `/{id}` item |
| org sub-resources | `.../entitlements`, `.../subscription`, `.../usage`, `.../usage/record` |
| org security | `.../security/posture`, `.../security/validate`, `.../security/operations`, `.../security/executive-report`, `.../security/alerts`, `.../security/alerts/{alert_id}`, `.../security/policy-baseline`, `.../security/policy-observations`, `.../security/policy-drift`, `.../security/remediations`, `.../security/remediations/{id}`, `.../security/crypto-posture`, `.../security/audit` |
| org trust | `.../passports`, `.../passports/{id}`, `.../findings`, `.../incidents`, `.../transactions`, `.../aer-kep-q/status` |
| org access | `.../members`, `.../members/{member}/role`, `.../invitations`, `.../invitations/{id}` |
| global invitations | `/invitations/accept` |
| auth | `/auth/webauthn/*`, `/auth/oidc/*`, `/auth/saml/*` |
| qcore | `/organizations/{id}/qcore/receipts` |
| billing/catalog | `/billing/webhook`, `/catalog/plans` |
| platform | `/platform/health` |
| SCIM | `/scim/v2.0/*` |

---

## 5. Data & Volumes (verified)

| Store | Users | Ref |
|---|---|---|
| sled 0.34 | `control_plane_api`, `vardhan_receipt`, `auth_service`, `receipt_generator` | Task brief |
| Durable queue (sled `qcore:event:`) | `backend/control_plane_api/src/durable_event_queue.rs` | Task brief |
| Compose volumes | `control-plane-data`, `keystore-data`, `idempotency-data`, `auth-config-data` | Task brief |
| Local dir | `.vardhan_data/` | Task brief |
| Idempotencyówki split (G2) | in-mem vs durable vs file diverge; `vardhan_receipt_idempotency` NOT git-ignored | Task brief |

---

## 6. Port Map (verified bindings; liveness UNVERIFIED)

| Port | Bindings (verified) | Note |
|---|---|---|
| 8080 | control-plane default, `pq_shield` listen, `vardhan-receipt` Serve, `load_tester` target, `verifier` dial | **COLLISION** |
| 3000 | Intelligence UI | — |
| 9090 | `mock_upstream` bind, `pq_shield` upstream | loop pair |
| 18080 | Heartbeat UDP | — |
| 18090 | Raft | — |
| 8081 | Admin | — |
| 4318 | OTLP test | test-only |
| 8443 | `quantum_node` default / TLS example | — |
| 18081 | HA test only | test-only |

---

## 7. Frontend Reference Map (read-only; verified as stated)

| Element | Verified fact |
|---|---|
| Location | `/Users/vishnuvardhanburri/antigravity/Vardhan-Q-Core-_-Frontend--main` (NOT a git repo) |
| Stack | React 19, Vite 8, Tailwind v4, pnpm (+`pnpm-lock.yaml` 29458 B), node 22 / pnpm 10.34.3 |
| `src/` (6 files) | `App.tsx` 7614 lines (monolith), `DudeAiAssistant` 529, `FounderLeadership` 528, `index.css` 3202, `main.tsx` 10; 6th filename **UNVERIFIED** |
| Data layer | 3× same-origin `fetch()`: `/api/v1/pricing/*`, `/api/v1/public/entities` |
| Routing | hash `#dashboard/`, `#public/`; no router/test/lint; no `node_modules` |
| Env | `VITE_ENTERPRISE_CONTACT_EMAIL` only |
| Assets | `public/` 922 KB portrait |

---

## 8. CI & Lab (verified inventory)

| Area | Verified inventory |
|---|---|
| CI (8 workflows) | `ci-correctness-benchmarks`, `enterprise-release`, `platform-web-contract`, `platform-web`, `pov-docker-validation`, `security` (cargo-audit/deny/check_rustls_lock/secret-scan), `sovereign-ci`, `unified-local-runtime`. Outcomes **UNVERIFIED**. |
| Lab scripts | root `lab_demo_verify.sh` 139 lines `set -e` only, hardcoded absolute `BINARY`, CWD-polluting; platform copy 218 lines `set -euo pipefail`, `REPO_ROOT` + `RECEIPT_BIN` override, temp-dir isolated, tracked; no trap in either |
| Lab fixtures | `lab_keys/` EMPTY; `lab_config/auth_config.json` 310 B `[policies, tenants]`; `valid_contract_debug.json` 1989 B schema 1.0; `tampered_receipt.json` 10543 B minified 22-key |

---

## 9. UNVERIFIED / To-map in Next Phase

| # | Item | Clearance probe |
|---|---|---|
| 1 | Cargo dep edges (`cargo metadata --format-version 1`) | dump + check in |
| 2 | Live port listeners (`ss -tulpn`) | run on target host |
| 3 | Route→handler→authZ mapping (`lib.rs` beyond line refs) | extract table |
| 4 | sled schemas / migration story | inspect open trees |
| 5 | eBPF ABI (`ebpf_kernel` ↔ `vardhan_ebpf_user`) | pin kernel object + loader version |

---

*End of Architecture & Dependency Map — 2026-10-16.*
