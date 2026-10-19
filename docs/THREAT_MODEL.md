# VARDHAN Q-CORE — Threat Model (Phase 7, Assessment-Only)

> **Scope / honesty notice:** This is an *internal, evidence-backed threat model* produced by
> reading the repository at `BASE` (HEAD `9b0d7c7`, plus the unstaged/untracked diff noted in
> §10). It is **not** an independent audit, pentest, or certification. Every status below cites
> the code, config, or test run that justifies it; anything not verified is marked
> **UNVERIFIED**. No source files were modified in this phase — only these three assessment
> documents were created.

## 1. System & trust boundaries

```
Intelligence → TrustBoundary → Authority → Transaction → Receipt → Ledger → Verifier
```

| # | Boundary | What crosses it | Enforcement point (evidence) |
|---|----------|-----------------|------------------------------|
| B1 | Intelligence → TrustBoundary | Findings, evidence hashes, tenant/actor claims | `GatewayAuthorityEvaluator::evaluate` (`backend/vardhan_receipt/src/policy_authority.rs:229+`) — fail-closed ALLOW/DENY |
| B2 | TrustBoundary → Authority | Tenant allowlist membership, policy version, issuer binding | `TenantRegistry::is_known` + `DENY_TENANT_UNKNOWN` (`policy_authority.rs:256-267`); `AuthConfig` from external file, no hardcoded allowlists (`backend/vardhan_receipt/src/auth_config.rs:16-17`) |
| B3 | Authority → Transaction | `AuthDecision::Allow` (sole mint of Allow) | `GatewayAuthorityEvaluator` is documented as the ONLY path producing Allow (`policy_authority.rs:215-227`) |
| B4 | Transaction → Receipt | Canonical payload → BLAKE3 `payload_hash` + dual signatures | `seal` path (`backend/vardhan_receipt/src/main.rs:704-723`): `blake3::hash(canonical_receipt_payload())`, `sign_ed25519` + `sign_mldsa87` |
| B5 | Receipt → Ledger | Sealed receipt + issuer fingerprint pin | `verify_receipt` (`backend/control_plane_api/src/receipt_verification.rs:24+`): tenant match, key-ID match, fingerprint match, dual-signature verify |
| B6 | Ledger → Verifier | Stored receipt bytes | `VardhanVerifier::verify` (`backend/vardhan_verifier/src/lib.rs:166+`): schema, ID format, structural checks |
| B7 | Network edge → Control plane | HTTP API calls | axum router layering (`backend/control_plane_api/src/lib.rs:221-412`) — see §3 |

**Config-failure posture (fail-closed, verified by reading):** `GatewayAuthorityEvaluator::new`
logs an error and builds `AuthConfig::empty()` when no auth config loads (all requests DENY);
`TenantRegistry::build_with_base_dir` uses `unwrap_or_default()` → empty registry → deny-all.
This is the correct fail-closed direction.

## 2. Threat register

Status legend: **MITIGATED** (mechanism present + behavior evidence) · **PARTIAL** (mechanism
present, effectiveness or coverage gap) · **OPEN** (no effective control / decision pending).

### T1 — Unknown / spoofed tenant submits transactions
- **Severity:** High · **Exploitability:** Network (any API caller)
- **Evidence:** `TenantRegistry` built from external `AuthConfig`; unknown tenant →
  `DENY_TENANT_UNKNOWN` (`policy_authority.rs:256-267`); unit asserts at `:445`, `:455`, `:581`;
  transport layer re-checks `receipt.tenant_id != id` → reject (`receipt_transport.rs:122-123`);
  verifier tenant check (`receipt_verification.rs:31-33`).
- **Status:** **MITIGATED** (single-process). Multi-node registry consistency falls under T6/G2.
- **Owner:** Identity / Platform.

### T2 — Privilege escalation via session / role confusion
- **Severity:** High · **Exploitability:** Network (authenticated low-priv user)
- **Evidence:** Role is resolved from the persisted profile via `authoritative_role`
  (`backend/auth_service/src/profile.rs:153-159`); middleware comment explicitly forbids
  synthesizing admin from session existence (`backend/auth_service/src/middleware.rs:64-74`);
  sessions store only BLAKE3 digests, never bearer tokens
  (`backend/auth_service/src/session.rs:1`); rotation keeps a `previous_digest` grace;
  hard expiry 8 h + idle 30 min (`session.rs:16-17`).
- **Residual:** previous-token grace window length UNVERIFIED in this phase; concurrent use of
  one session from two IPs / node-binding enforcement UNVERIFIED.
- **Status:** **PARTIAL**. **Owner:** Identity.

### T3 — MFA bypass / weak second factor
- **Severity:** High · **Exploitability:** Network (credential-stuffing adjacent)
- **Evidence:** TOTP primitives: base32-only secrets, constant-time compare, ±1 step window
  (`backend/auth_service/src/mfa.rs:1-30`); enrollment secrets encrypted via `KeyProtector`,
  single-use challenges (`mfa_service.rs`); login gates on `is_enrolled` → challenge
  (`backend/auth_service/src/lib.rs:156-174`); MFA enroll/disable/session routes sit behind
  `require_session` (`lib.rs:92-122`).
- **Residual:** Recovery-code handling, challenge-expiry enforcement, and lockout-on-MFA-abuse
  were not behavior-verified in this phase.
- **Status:** **PARTIAL**. **Owner:** Identity.

### T4 — Issuer key spoofing / signature forgery
- **Severity:** High · **Exploitability:** Network (receipt forgery)
- **Evidence:** Dual signatures ML-DSA-87 + Ed25519 over BLAKE3 canonical payload
  (`vardhan_receipt/src/main.rs:355-367`, `:711-723`); verifier pins
  `ed25519_key_id`, `ml_dsa_87_key_id`, and `issuer_key_fingerprint` against the sled-backed
  `ReceiptKeyRegistry` (`receipt_verification.rs:34-43`); registry rejects conflicting
  re-registration (`receipt_key_registry.rs:57-68`); adversarial Tests 3/4/5 (bad Ed25519, bad
  ML-DSA-87, wrong trusted key) all PASS (run 2026-10-16, exit 0).
- **Status:** **MITIGATED** (single-process registry). Registry replication across nodes is
  UNVERIFIED (see T6).
- **Owner:** Cryptography / Platform.

### T5 — Key compromise / revocation failure (G4)
- **Severity:** High · **Exploitability:** Physical/host-access; insider
- **Evidence:** `KeyStatus` state machine with terminal `Revoked` and `revoke()` security log
  (`backend/vardhan_keystore/src/lib.rs:43-76`, `:146-150`); production refuses local/plaintext
  providers (`lib.rs:331-357`, `protection.rs:50-57`); fingerprint-mismatch load guards
  (`lib.rs:458`, `:491-501`); `Zeroizing`/`Zeroize` use for key material.
- **Gap G4 (OPEN):** No HSM/KMS binding in this deployment — `keystore-data` is a compose
  software volume; local provider encrypts but the KEK is stored locally (`lib.rs:318-321`).
  Rotation drill log absent.
- **Status:** **OPEN (G4)**. **Owner:** Security / Cryptography.
- **Recommendation:** Bind production KEK to HSM/cloud KMS (or Vault Transit), record a
  rotation drill, then re-verify.

### T6 — Replay / double-execution (G2)
- **Severity:** High · **Exploitability:** Network (retry/replay); failover (split-brain)
- **Evidence (single-process, good):** Durable registry is restart-safe with OS-lock-serialized
  check/register (`backend/vardhan_idempotency/src/durable.rs:1-50`); lab check 2
  (replay → `REJECTED_REPLAY`) PASS; receipt `test_q_replay_identical_transaction_rejected`
  (`main.rs:1175`), `test_r3_durable_replay_rejection` (`main.rs:1451`), adversarial Test 9
  (replay rejected) all PASS 2026-10-16; conformance 7/7 incl. concurrent-duplicate and
  restart-persistence PASS.
- **Gap G2 (OPEN):** Three divergent paths — in-memory `IdempotencyRegistry` (`lib.rs:42+`,
  `&mut self`, caller-side locking), file-locked durable registry, and sled `qcore:event:`
  queue (`durable_event_queue.rs`) — with no single durable path, no failover/concurrency
  proof, and shared-filesystem lock semantics UNVERIFIED (file states this explicitly,
  `durable.rs:4-5`). In-memory registry is invisible to the other two under failover.
- **Status:** **PARTIAL single-node / OPEN multi-node (G2)**. **Owner:** Platform.
- **Recommendation:** One durable path (or fenced adapters) + failover/concurrency test +
  confirm `vardhan_receipt_idempotency*` ignore coverage (`.gitignore` now lists it, unstaged).

### T7 — Receipt tampering / serialization ambiguity
- **Severity:** High · **Exploitability:** Network / storage
- **Evidence:** Length-prefixed canonical payload covering all governed fields incl. evidence
  commitments (`vardhan_verifier/src/lib.rs:119-165`); BLAKE3 `payload_hash`; tamper tests
  R1/R2 (`main.rs:1343`, `:1395`), `test_b_modify_evidence_hash_rejects` (`:1051`),
  `test_d_change_tenant_id_rejects` (`:1063`), F014 canonical-coverage test (`:1683`) PASS
  (69/69 receipt suite, 2026-10-16).
- **Type-mismatch note (availability/integrity, not RCE):** sealed receipts emit
  `schema_version "1.1"` (`main.rs:96`, `:149`) but fixtures/tests/contract samples use
  `"1.0"` (`:435`, `:833`, `:934`), while the verifier default supports **only**
  `["1.1"]` (`vardhan_verifier/src/lib.rs:109`). A `1.0` receipt fails default verification.
  `policy_version` is hardcoded `"1.0"` with a TODO (`main.rs:132`), risking
  policy-version-mismatch DENY drift vs the registry. Timestamp widths differ (`u128` ms in
  session paths vs `u64` ms + `as u64` truncation in `durable.rs`).
- **Status:** **PARTIAL** (crypto path MITIGATED; schema duality OPEN).
- **Owner:** Cryptography / Platform.
- **Recommendation:** Single canonical schema constant shared by sealer + verifier; registry-driven
  policy version; unify timestamp width.

### T8 — API abuse: unauthenticated admin/diag access
- **Severity:** High · **Exploitability:** Network
- **Evidence (router layers read at `control_plane_api/src/lib.rs:221-412`):** All session
  routes sit in one `protected` router with `require_session` (`:348-351`): `/api/v1/me`,
  `/api/v1/organizations*`, all `/security/*`, passports, findings, incidents, transactions,
  members, invitations, WebAuthn register. All `/api/v1/admin/*`, `/api/v1/sessions*`,
  `/api/v1/settings` are behind `require_session` in `auth_router` (`auth_service/src/lib.rs:92-122`).
  No `/metrics`, `/debug`, or `/diag` route exists in `lib.rs`. SCIM data endpoints use
  org-bound token auth with constant-time compare (`enterprise_api.rs:441-580`), and the
  discovery doc additionally requires the deployment token.
- **Routes WITHOUT session middleware (all intentional, non-session-authenticated):**
  - `/api/v1/auth/login`, `/api/v1/auth/mfa/verify`, `/api/v1/auth/logout` — credential /
    challenge entry (logout idempotent).
  - `/api/v1/auth/oidc/*`, `/api/v1/auth/saml/*`, `/api/v1/auth/webauthn/auth/*` — SSO/WebAuthn
    ceremony endpoints (public by protocol necessity).
  - `POST /api/v1/organizations/{id}/qcore/receipts` — HMAC service-authenticated
    (`x-vardhan-signature` over canonical request incl. timestamp+nonce,
    `qcore_transport.rs:55-91`; server fail-closed when unconfigured,
    `receipt_transport.rs:45`), plus tenant binding + dual-sig verify.
  - `POST /api/v1/billing/webhook` — HMAC signature (`x-vardhan-billing-signature`) + timestamp
    replay window (`billing_api.rs:64-115`); fail-closed 503 when secret unset.
  - `/api/v1/platform/health`, `/api/v1/catalog/plans` — unauthenticated informational
    (health leaks only `tls_enabled` boolean + version-ish status; acceptable).
- **No unauthenticated admin/diag route was found.** Residual: server-side nonce-replay store
  and timestamp-window sizes for the HMAC endpoints were not behavior-verified in this phase
  (receipt-level replay is still independently rejected — adversarial Test 9 PASS).
- **Status:** **MITIGATED** for session boundary; **UNVERIFIED** for HMAC endpoint hardening
  details. **Owner:** Platform / Security.

### T9 — Login brute force / rate-limit bypass — rate-limit status UNVERIFIED
- **Severity:** Medium · **Exploitability:** Network
- **Evidence:** `RateLimiter`: 10 failures / 15-min sliding window per IP, success resets
  (`backend/auth_service/src/rate_limit.rs`); wired into login (`auth_service/src/lib.rs:138`)
  and pq_shield admin (`pq_shield/src/admin.rs:82-129`); 429 test exists
  (`integration_auth.rs:132`).
- **Why UNVERIFIED:** in-memory `DashMap` (restart clears; file states multi-node bypass
  explicitly and defers to Redis/Valkey, `rate_limit.rs` SEC-009 note); coverage of the
  non-session public endpoints (HMAC ingest, billing webhook, SCIM, SSO) not verified in this
  phase; **no stale-bucket eviction** — `is_stale` is checked on read but entries are never
  swept (`rate_limit.rs:80-100`), so the map grows with distinct source IPs over process
  lifetime (memory-DoS-adjacent, normally bounded by connection IPs); no load-level 429 proof.
- **Status:** **PARTIAL implementation / UNVERIFIED effectiveness**. **Owner:** Identity / Platform.
- **Recommendation:** Periodic `retain` sweep, shared counter for multi-node, rate limits on
  HMAC/SCIM/SSO ingress, load-test 429 evidence.

### T10 — Supply chain / dependency compromise
- **Severity:** High · **Exploitability:** Build-time / upstream
- **Evidence:** CI runs `cargo audit` + `cargo deny check advisories` + rustls-floor script
  + secret scans (`.github/workflows/security.yml`, now also the tracked-secret guard —
  unstaged diff); `deny.toml` documents each ignored advisory with rationale (rustls 0.21 via
  opt-in AWS KMS path; `serde_cbor` PoC-only; `pqcrypto-*` archived with no safe upgrade);
  rustls floor PASS 2026-10-16 (`0.23.46`, legacy `0.21.12` only via KMS graph);
  `Cargo.lock` + `package-lock.json` pinned; `bom.json` SBOM present.
- **Residual:** license checking deliberately skipped for proprietary workspace crates (policy,
  documented in `deny.toml` header); `pqcrypto` migration tracked but unscheduled; legacy
  rustls reachable only via opt-in KMS path (accepted exception, not a patch).
- **Status:** **PARTIAL** (advisory coverage present; exceptions accepted with rationale).
- **Owner:** Security / Engineering Director.

### T11 — Insider / admin misuse; bootstrap secret handling
- **Severity:** High · **Exploitability:** Insider / deploy-time
- **Evidence (direction correct):** `VARDHAN_ADMIN_PASSWORD_FILE` is the required bootstrap;
  legacy `VARDHAN_ADMIN_PASSWORD` env path returns fail-closed `Err(NotFound)`
  (`secrets.rs:28-44`; `P1_FINDINGS_REGISTER.md:83-84`); negative bootstrap test exists
  (`integration_bootstrap.rs:22-23`); least-privilege RBAC (`authorization.rs:31-34`),
  owner-only role grants (`lib.rs:597`), single-consume invitation tokens
  (`enterprise_api.rs:338`), SCIM token hashes (BLAKE3) with constant-time compare.
- **Gap S-01 (OPEN, High):** `scripts/qcore-pov/secrets/admin_password.txt` (25 B, mode 644)
  is TRACKED since commit `02707f8` — any clone contains it. `.gitignore` now ignores the
  pattern (unstaged) but tracked files stay tracked; history purge + rotation pending
  (`docs/SECURITY_FINDINGS_REGISTER.md:17`, `:48`). Secret guard FAILS as expected
  (verified 2026-10-16, exit 1). CI `git grep` scan pattern (AWS IDs + PEM headers) does NOT
  match password files — S-04 PARTIAL; the new guard step closes the pattern gap but is red
  until S-01 is remediated.
- **Status:** **PARTIAL (mechanism) / OPEN (S-01)**. **Owner:** Security + Engineering Director
  (history-purge decision).
- **Recommendation:** Rotate credential, purge history (`02707f8`, `372b69a`, `9b92d49`),
  verify fresh-clone grep, keep guard green.

### T12 — Storage corruption / single-writer violation
- **Severity:** Medium · **Exploitability:** Host / failover
- **Evidence:** sled opens are per-path and single-process (`control-plane.sled` in
  `control_plane_api/src/main.rs:26`; credential/session stores in `auth_service`); sled
  refuses a second writer on the same path (fail-closed by lock); writes followed by `flush`
  in registry/queue paths.
- **Residual:** Corruption-injection / crash-recovery / backup-restore behavior UNVERIFIED;
  multi-process failover opening the same sled path is untested (overlaps G2).
- **Status:** **PARTIAL**. **Owner:** Platform.

### T13 — Network partition / consensus split-brain
- **Severity:** High · **Exploitability:** Network (multi-node only)
- **Evidence:** `backend/ha_cluster` contains raft modules (`raft.rs`, `election.rs`,
  `heartbeat.rs`, `peer_manager.rs`, `raft_listener.rs`) plus unit tests; `vardhan_state`
  models Raft terms/indices/markers. BUT: wiring is unit-level only — no multi-node
  deployment proof, no partition/leader-election/failover log; CI pins `--test-threads=1`
  partly over RAFT timing flakes (HEAD `9b0d7c7`). Prior gate and `RELEASE_GATES.md` G3/G2
  record mTLS and idempotency multi-node as open.
- **Status:** **OPEN (multi-node)**; single-node deployment assumption holds.
- **Owner:** Platform.
- **Recommendation:** Multi-node partition test (kill -9 follower/leader, clock skew, netsplit)
  + mTLS handshake proof (G3) before any clustered release claim.

### T14 — Transport eavesdropping / MITM (G3)
- **Severity:** High · **Exploitability:** Network
- **Evidence:** Optional rustls TLS behind `tls` feature + `VARDHAN_TLS_CERT_PATH/KEY_PATH`
  (`control_plane_api/src/lib.rs:414-424`, `:665-673`); health reports `plaintext_http` vs
  `tls`; default transport is plaintext; reqwest clients use rustls.
- **Gap G3 (OPEN):** No mTLS verification anywhere (client-cert accept/reject proof absent;
  only a `quantum_node` :8443 TLS example). No handshake evidence in this phase.
- **Status:** **OPEN (G3)**. **Owner:** Platform / Security.

## 3. Robustness findings (memory, races, types) — assessment only, no source changes

### R1 — RateLimiter DashMap grows without eviction (memory)
`buckets: Arc<DashMap<IpAddr, Bucket>>`; stale windows are skipped on read but never removed.
Long-lived processes accumulate one entry per distinct source IP. Normally bounded by real
connection IPs; still a slow memory-DoS surface. **Recommendation:** periodic `retain` sweep
or TTL cache. Severity Low. Owner: Identity/Platform.

### R2 — Session storage relies on lazy expiry (memory)
Expired entries are removed on the access path (`session.rs:190-215`); a full-table sweep /
background janitor was not verified. sled size then depends on access patterns.
**Recommendation:** verify or add a bounded sweep; monitor sled size. Severity Low. Owner: Identity.

### R3 — `unsafe` surface is small and mostly test-only, two items need confirmation
- Test-only `unsafe { env::set_var/remove_var }` (`vault.rs`, `protection.rs`, `auth_config.rs`,
  `main.rs` tests): env mutation is process-global; mitigated by `TEST_ENV_MUTEX` + CI
  `--test-threads=1` (commit `9b0d7c7`). Confirm every env-mutating test holds the mutex.
- `core_crypto/src/anti_tamper.rs`: fixed 648-byte `kinfo_proc` buffer + raw `sysctl` — correct
  on current macOS arm64/x86_64 but brittle across OS versions; failure mode is attestation
  bypass (fail-open debugger check), not memory unsafety (buffer is stack-local, length-bound).
- `core_crypto/src/avx512.rs`: `pub unsafe fn ntt_butterfly_avx512` — caller must guarantee
  x86_64+AVX-512 and `len >= 32`; in-repo call is test-gated on `is_x86_feature_detected`;
  production call-site gating UNVERIFIED in this phase.
- `let _ = mldsa_plain_bytes; // drop to zeroize` (`keystore lib.rs:479`): zeroization holds
  only if the type implements `ZeroizeOnDrop` — wrapper type UNVERIFIED here.
**Recommendation:** audit the three production-reachable items; keep `unsafe` out of new code.
Severity Low (test) / Medium-UNVERIFIED (avx512 callers, zeroize wrapper). Owner: Cryptography.

### R4 — In-memory idempotency register requires caller-side locking (race)
`IdempotencyRegistry` takes `&mut self` over a plain `HashMap`; `check_and_register` and
`complete`/`fail` are separate calls, so a concurrent caller without external synchronization
has a register→complete TOCTOU. No non-test sharing site was found (good — the compiler would
force the issue), and the concurrent-duplicate conformance tests PASS. Keep it that way:
any future sharing must go through `Mutex` or the durable registry.
Severity Low (contained). Owner: Platform.

### R5 — Type/domain mismatches (correctness/availability)
Schema `1.0` vs `1.1` duality (T7), hardcoded `policy_version "1.0"` TODO drift, `u128` vs
`u64` millisecond widths. None is remotely exploitable per current evidence, but the schema
duality can cause legitimate receipts to fail verification (availability) and the policy
hardcode can cause fail-closed DENY drift. Owner: Platform/Cryptography.

## 4. Recent-diff security notes (HEAD~5 + unstaged, read-only review)

- `security.yml` (+tracked-secret guard step) and `.gitignore` (secret patterns incl.
  `vardhan_receipt_idempotency*`) move in the right direction but are **unstaged**; the guard
  is red until S-01 is remediated, so wiring it into required CI now would block the pipeline
  by design — sequence rotation/purge first.
- `lab_demo_verify.sh` rework (mktemp + `trap` cleanup, Linux/macOS split, REAL vs SIMULATED
  semantics) is hygiene-positive; verified green in this phase.
- `qcore` additions (port probes warn-only, sim-mode notice) are advisory-only, no new attack
  surface.
- Large untracked surface (`docs/RELEASE_GATES.md`, `PRODUCTION_READINESS_BASELINE.md`,
  `SECURITY_FINDINGS_REGISTER.md`, `SUPPLY_CHAIN.md`, idempotency `conformance.rs`, etc.)
  awaits a commit/triage decision — audit-trail hygiene, owner Engineering Director.
- No new `unsafe`, no new public route, no new secret-handling path was introduced by the
  reviewed diff. No memory-leak, race, or type regression attributable to the diff was found.

## 5. Residual risk summary

Release remains **BLOCKED** on G1 (pentest/ISO), G2 (idempotency split-brain), G3 (mTLS),
G4 (HSM), plus S-01 (tracked credential). Internal behavior evidence is strong for the
single-node receipt path (adversarial 10/10, lab 5/5, receipt 69/69, conformance 7/7) but
constitutes **behavior evidence only** — see `docs/SECURITY_ASSESSMENT_STATUS.md`.
