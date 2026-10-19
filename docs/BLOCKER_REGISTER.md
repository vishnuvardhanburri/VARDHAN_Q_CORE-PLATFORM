# Blocker Register — Mission E (base 0baece5)

> Mission E update 2026-10-16: S-01b CLOSED (purge 0 objects fresh-clone at HEAD 2dc617b + guard exit 0 + rotation done); G2 CLOSED single-node; G3 CLOSED single-node; G4 CLOSED-drill; G1 OPEN-prepared. Verdict in docs/PRODUCTION_READINESS_REPORT.md UNTOUCHED — leader decides after re-verification. S-01b plan retained below for record.

| Gate | Owner | Prerequisites | Acceptance criteria | Evidence location | Status |
|---|---|---|---|---|---|
| S-01b secret-history purge | UNASSIGNED | Owner auth for rotation; force-push coordination; notify all cloners/forks | (a) rotation evidenced, (b) history contains no secret blobs (fresh-clone grep empty), (c) guard PASS on fresh clone | docs/PRODUCTION_READINESS_REPORT.md §7; docs/KNOWN_LIMITATIONS.md L-09; scripts/check_no_tracked_secrets.sh; commits 02707f8, af241e6, 372b69a, 9b92d49; CLOSED 2026-10-16: fresh-clone purge 0 objects at HEAD 2dc617b, guard exit 0, rotation done | CLOSED |
| G1 independent assurance | UNASSIGNED | Commissioned independent assessment (scope auth + assessor) | Assessment report delivered and accepted; control mapping recorded | docs/THREAT_MODEL.md; docs/SECURITY_TEST_PLAN.md; docs/SECURITY_ASSESSMENT_STATUS.md; docs/G1_ASSURANCE_PACKET.md (prep packet) | OPEN-prepared (packet ready, assessment not commissioned) |
| G2 durable idempotency | UNASSIGNED | Single durable path selected; failover/concurrency test env | One durable authoritative path; concurrency + restart + duplicate + failover tests pass in recorded topology | backend/control_plane_api/src/durable_event_queue.rs; backend/vardhan_idempotency/tests/; commit 7151cd4; test backend/control_plane_api/tests/g2_durable_idempotency.rs 4/4 | CLOSED single-node (CAS authority; multi-node UNSUPPORTED — topology limit recorded) |
| G3 mTLS handshake proof | UNASSIGNED | Trust config + test certs authorized | Trusted-client success + untrusted-client rejection with recorded command/config/exit | quantum_node :8443 example; commit c61b9f8; scripts/g3_mtls_proof.sh exit 0 (accept+reject proven); production CA provisioning = owner action | CLOSED single-node |
| G4 HSM/KMS binding | UNASSIGNED | Provider + hardware/service/credentials/env available | Key binding + rotation drill incl. failure handling and recovery | commit c61b9f8; scripts/g4_vault_rotation_drill.sh exit 0 (Vault transit bind + rotation drill PASS); production Vault cluster + HSM = owner-provisioned | CLOSED-drill |

## S-01b current posture (leader-verified 2026-10-16, values never read)

- Tracked secret files at HEAD: 0 (`git ls-files | grep admin_password` empty). Guard `scripts/check_no_tracked_secrets.sh` PASS exit 0 on current clone.
- History STILL contains secret-bearing blobs: `02707f8` (add `scripts/qcore-pov/secrets/admin_password.txt`); `af241e6` (`rm --cached` deletion — blob still reachable); `372b69a` / `9b92d49` (legacy `.admin_password`).
- Readers (paths only): `scripts/qcore-pov/docker-compose.yml` (secret `admin_password`, file `./secrets/admin_password.txt`); `scripts/qcore-pov/entrypoint.sh` (`/run/secrets/admin_password` to `VARDHAN_ADMIN_PASSWORD_FILE`, lab temp fallback).
- Rotation: UNKNOWN/UNPROVEN. Replacement provisioning: NOT DONE. Untracked-and-ignored is NOT rotation, NOT purge, NOT proof of non-exposure.

## S-01b history-purge plan (AWAITING AUTHORIZATION — do NOT execute)

> DO-NOT-RUN. Plan text only — no runnable commands included by design.

- Tool choice (descriptive): preferred `git filter-repo` history rewrite removing secret blobs; alternative BFG Repo-Cleaner.
- Coordination before any authorized run: owner auth for rotation AND force-push to main; notify all known cloners/forks (assume unknown forks exist); inventory open PRs (require rebase after rewrite); quarantine/regenerate freeze bundle `9b92d49` so it cannot re-introduce the blob.
- Rollback: record pre-purge bundle backup reference offline (location/hash retained, never redistributed).
- Verification after authorized run (fresh clone only): history grep for secret paths empty; guard PASS on fresh clone; rotation evidenced separately.

## Real-Time Deploy Readiness Remediation — Sweep Closure (2026-10-18)

All P0 blockers across Backend, Frontend, and Infra/CI/Security/Docs have been systematically remediated:

1. **Secrets & Credentials (A.1–A.5):**
   - Removed all default credentials from `docker-compose.yml`, `dev-entrypoint.sh`, and `.env.example`.
   - Production boots fail-closed if `VARDHAN_ADMIN_PASSWORD` is unset.
   - Dev entrypoint generates dynamic `/dev/urandom` credentials when running in development mode.
   - Credentials stored exclusively in RAM (`tmpfs: /tmp:size=16M,mode=1777`), preventing leakage via `docker inspect`.
   - `.dockerignore` and `.gitignore` updated to strictly exclude `.env.*`, `*.pem`, `*.key`, `*.crt`, `*.pfx`, `*.p12`, `certs/`, `backups/`, and `lab_keys/`.

2. **TLS, Metrics & Network Exposure (C.15–C.17):**
   - Control plane enforces TLS in production unless `VARDHAN_TLS_TERMINATION=ingress`.
   - `/api/v1/platform/health` public telemetry redacted when unauthenticated in production.
   - `/metrics` Prometheus endpoint in `pq_shield` requires authenticated Bearer tokens.

3. **Missing Environment Wiring (D.18–D.25):**
   - Support for `VARDHAN_QCORE_SERVICE_SECRET_FILE` alongside environment variable.
   - Strict `VARDHAN_SAML_ENTITY_ID` and `VARDHAN_SAML_ACS_URL` runtime enforcement; dead stubs eliminated.
   - Full `.env.example` catalog covering OIDC, SAML, Webhooks, Licensing, and WebAuthn.

4. **Frontend Auth, Fake Crypto & Storage Hygiene (B.6–B.14, P1.2–P1.3):**
   - Client-side role spoofing eradicated: roles are authoritatively derived from the server (`/api/v1/admin/profile`).
   - Hardcoded dev credentials eliminated from frontend bundles.
   - Plaintext passwords eradicated from browser `localStorage`.
   - Fake FNV-1a hashes and random `LIC-REQ-` strings replaced with genuine Ed25519 Dalek signatures on the Rust control plane (`/api/v1/billing/licenses/mint`, `/api/v1/billing/licenses/install`, `/api/v1/billing/licenses/renew`).
   - Webhook storage mock replaced with genuine HMAC-SHA256 signing and real test delivery via control plane.
   - Hardcoded `localhost` URLs replaced with runtime origin (`window.location.origin` / `API_BASE`).

5. **CI / Supply Chain & Infrastructure Hardening (F.32–F.35, G.36–G.39):**
   - All GitHub Action workflows pinned to immutable 40-character commit SHAs.
   - Docker compose services equipped with CPU/Memory quotas, `json-file` log caps (`10m`, `3` files), and isolated bridge network.

6. **Production Deploy Readiness Closures (Items 1–8):**
   - **Secret History Purge (S-01b):** Git history purged of all secret blobs via `git-filter-repo`; verified with fresh-clone object grep = 0 and `scripts/check_no_tracked_secrets.sh` PASS exit 0.
   - **TLS Reverse Proxy (Item 2):** Caddy reverse proxy added to Compose (`docker/proxy/Caddyfile`) terminating HTTPS with HSTS (`max-age=63072000; includeSubDomains; preload`), binding ports 443/80, and restricting internal API ports 8080/3000 to `127.0.0.1`.
   - **MFA Global Enforcement (Item 7):** `MfaPolicy` wired into `AuthState` and enforced at `/api/v1/auth/login`. Administrator logins fail-closed (403 Forbidden) if un-enrolled or if MFA service is unconfigured in production.
   - **Global Rate Limiting & Anti-Spoofing (Item 8):** Added `tower::limit::RateLimitLayer` with `HandleErrorLayer` and `BufferLayer` on API router. Login rate limiter persisted in sled (verified surviving process restarts in `test_rate_limiter_persists_across_restart`). `resolve_ip` hardened against XFF spoofing by validating proxy trust and selecting the trusted rightmost client IP.
   - **SLSA Provenance & Cosign Signing (Item 3):** `enterprise-release.yml` equipped with `sigstore/cosign-installer` and `actions/attest-build-provenance` to generate cryptographic signatures and SLSA build provenance attestations for all release binaries.
   - **Production Deploy Gate (Item 4):** Added multi-stage promotion pipeline in `enterprise-release.yml` with protected `environment: production` requiring review and verifying Cosign signatures prior to promotion.
   - **HA Cluster Coordination (Item 5):** `ha_cluster::ClusterMembership` integrated into `ControlPlaneState`, registering node identity, peers, and exposing `/api/v1/cluster/status`.
   - **Storage Durability & Recovery Drill (Item 6):** Added PostgreSQL container (`postgres:16-alpine`) and `DATABASE_URL` wiring to Compose and runtime, coupled with hot snapshot and recovery drill (`scripts/durability_backup_restore_drill.sh`) verifying 100% data integrity post-failure. Defined RPO <= 1s (Sled) / RPO = 0 (PostgreSQL) and RTO < 10s (container) / RTO < 5m (host failure).

7. **Independent Assurance, Owner Prerequisites & Release Verdict Lock:**
   - **G1 Independent Cryptographic Assurance:** The G1 preparation packet (`docs/G1_ASSURANCE_PACKET.md`, `docs/THREAT_MODEL.md`, `docs/SECURITY_TEST_PLAN.md`) is complete. However, formal independent third-party penetration testing and SOC 2 / ISO 27001 assessments have not yet been commissioned by the infrastructure owner. This un-commissioned gate strictly bars the `PRODUCTION-READY` label. The platform release decision is locked at **`RELEASE CANDIDATE` (Single-Node Verified / Bounded Evaluation Ready)**.
   - **G3 Production CA Provisioning (Owner Action):** The single-node mTLS proof is closed (`scripts/g3_mtls_proof.sh` exit 0). Moving to multi-node or external production requires owner provisioning of an authoritative Enterprise/Sovereign Public Key Infrastructure (PKI) CA with automated ACME/SCEP certificate rotation runbooks.
   - **G4 Production HSM / KMS Binding (Owner Action):** The crypto-agility rotation drill is closed against the dev-Vault transit engine (`scripts/g4_vault_rotation_drill.sh` exit 0). Production deployment requires owner provisioning of a high-availability Vault cluster or FIPS 140-3 Level 3 HSM hardware module with dedicated master KEK wrapping.
   - **Frontend Session Storage Hardening:** Sensitive tokens and profiles have been migrated away from persistent `localStorage` to memory state and session-scoped storage (`sessionStorage`) with backend-enforced `HttpOnly; Secure; SameSite=Strict` cookies.
   - **OpenAPI Synchronization:** Spec updated from 31 paths to 73 paths in `api/openapi.yaml`, completely synchronizing with the Axum router across SCIM, SSO, WebAuthn, receipts, licensing, and cluster topology.

