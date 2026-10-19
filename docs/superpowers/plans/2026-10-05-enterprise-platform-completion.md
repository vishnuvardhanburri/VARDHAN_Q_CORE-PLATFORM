# Vardhan Q Core Enterprise Platform Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the remaining enterprise platform path from authenticated Q-Core receipts through verified telemetry, live operations, enterprise identity, resilience, integrations, assurance preparation, and final validation.

**Architecture:** Preserve the existing PQ/Hybrid signing, trust-boundary, authority, transaction-state-machine, receipt-sealing, ledger, independent-verification, and AER-KEP-Q primitives. Add narrowly scoped adapters at service boundaries: authenticated producer transport feeds a key-aware receipt verifier; verified events enter durable tenant-bound telemetry; operational APIs expose authoritative state to the console; resilience and integration layers consume canonical APIs rather than bypassing Q-Core.

**Tech Stack:** Rust workspace, Axum, sled/persistent stores already used by the platform, existing `core_crypto`, `ledger_persistence`, `quantum_node`, `enterprise_tenant`, `auth_service`, TypeScript enterprise console, OpenAPI/SDKs.

**Spec:** This plan implements the approved enterprise completion scope: `Q-Core receipt → authenticated service transport → verifier/key registry → durable telemetry → console`, followed by operations, identity, SDK/API, resilience, integrations, assurance preparation, and final validation.

## Global Constraints

- Existing receipt authentication and independent verification remain authoritative; telemetry never accepts an unverified caller assertion as proof.
- Tenant isolation is mandatory at transport, verification, persistence, API, and UI layers.
- No fabricated metrics, receipts, findings, incidents, epochs, or security posture values.
- Existing AER-KEP-Q remains quarantine/reissue; it is not presented as retroactive protection after complete state exposure.
- Production secret material remains behind the existing KeyProtector/HSM/KMS boundary.
- CI stays paused until product completion; local validation is still required for each task.
- Every durable state transition must be restart-safe and idempotent where applicable.
- API behavior remains fail-closed for authentication, authorization, billing entitlements, and cryptographic verification failures.

## Review Focus

- Unverified or forged receipts must never become `Verified` telemetry.
- Cross-tenant transaction, receipt, key, session, SCIM, and webhook access must fail closed.
- Duplicate/replayed receipts and service messages must be idempotent without hiding conflicting payloads.
- Restart/failover must not resurrect retired keys, sessions, epochs, transactions, or revoked memberships.
- Console values must come from authoritative APIs and explicitly represent unavailable/unpopulated state.

### Task 1: Receipt verification and authenticated service transport

**Files:**
- Modify: existing Q-Core/receipt verification boundary and `backend/control_plane_api/src/qcore_telemetry.rs`
- Create/modify: receipt transport/auth module in `backend/control_plane_api/src/`
- Test: control-plane integration tests for verified, forged, replayed, and cross-tenant receipts

**Interfaces:**
- Consumes: canonical sealed receipt plus authenticated service identity and organization context.
- Produces: `VerifiedReceiptEnvelope` containing canonical receipt identity, issuer fingerprint, verification result, correlation ID, and tenant binding; rejected envelopes never reach telemetry.

- [ ] Write failing tests proving forged signatures, wrong issuer keys, wrong tenant, replay, and malformed receipts are rejected.
- [ ] Implement authenticated service transport using the existing service-auth boundary; bind organization/tenant and correlation identifiers to the signed verification context.
- [ ] Resolve issuer verification keys through a dedicated key-registry interface rather than trusting caller-provided public keys.
- [ ] Verify the canonical receipt with the existing platform verifier and preserve the full digest/signature metadata.
- [ ] Make accepted receipt ingestion idempotent and reject conflicting duplicate receipt IDs.
- [ ] Run focused Rust integration tests and commit.

### Task 2: Key registry and receipt lifecycle

**Files:**
- Create: `backend/control_plane_api/src/receipt_key_registry.rs`
- Modify: existing crypto/key lifecycle integration points
- Test: registry lifecycle and verifier integration tests

**Interfaces:**
- `register_issuer_key(tenant_id, fingerprint, algorithm, public_key, state)`
- `resolve_issuer_key(tenant_id, fingerprint) -> ActiveOrHistoricalKey`
- `retire_issuer_key(...)`

- [ ] Test active-key verification, rotated-key verification, retired-key rejection, unknown-key rejection, and tenant isolation.
- [ ] Store only public verification material in the registry; private keys remain in KeyProtector/HSM/KMS.
- [ ] Bind key lifecycle to existing key deprecation states and audit events.
- [ ] Add deterministic registry persistence/restart tests.
- [ ] Commit.

### Task 3: Live Q-Core transaction/receipt telemetry APIs

**Files:**
- Modify: `backend/control_plane_api/src/qcore_telemetry.rs`
- Modify: `backend/control_plane_api/src/operations_api.rs`
- Modify: `backend/control_plane_api/src/lib.rs`
- Test: API authorization, pagination, filtering, receipt linkage, and posture aggregation

- [ ] Add authenticated ingestion only from Task 1.
- [ ] Expose transaction detail and receipt detail endpoints with tenant authorization.
- [ ] Add bounded pagination and stable ordering.
- [ ] Link transaction → receipt → ledger commit → verification state without inventing missing values.
- [ ] Derive security-posture transaction/receipt counts from durable telemetry.
- [ ] Add audit correlation IDs to API responses/events.
- [ ] Commit.

### Task 4: Q-Core producer integration

**Files:**
- Modify: canonical Q-Core transaction execution path
- Modify: receipt sealing/ledger integration point
- Test: end-to-end producer → transport → verifier → telemetry flow

- [ ] Identify the canonical successful transaction commit point and emit exactly one telemetry event after receipt sealing/verification prerequisites are satisfied.
- [ ] Emit failure/rejection transitions without creating false receipts.
- [ ] Verify duplicate event delivery is harmless and conflicting transaction IDs fail closed.
- [ ] Test restart between transaction commit and telemetry persistence.
- [ ] Commit.

### Task 5: Enterprise console live operational wiring

**Files:**
- Modify: `platform_web/` API client/state modules
- Modify: console pages for Overview, Security Posture, Transactions, Findings, Incidents, Q Core, AER-KEP-Q, Evidence
- Test: frontend contract tests and fail-closed UI tests

- [ ] Replace placeholder operational values with authoritative API responses.
- [ ] Show explicit empty/unpopulated states.
- [ ] Add transaction/receipt detail views and verification state.
- [ ] Show AER runtime state only when attached and authorized.
- [ ] Ensure failed API/auth/entitlement calls cannot render privileged data.
- [ ] Commit.

### Task 6: Findings → risk → incidents operational pipeline

**Files:**
- Create/modify Intelligence ingestion and operational API modules
- Modify: `operations_api.rs`
- Test: finding lifecycle, risk calculation, incident correlation, tenant isolation

- [ ] Define canonical finding schema from verified intelligence output.
- [ ] Persist finding provenance, evidence references, severity, status, and timestamps.
- [ ] Derive risk without fabricating missing intelligence.
- [ ] Correlate qualifying findings into incidents with deterministic identifiers.
- [ ] Add remediation state transitions through authorized policy paths.
- [ ] Commit.

### Task 7: OIDC/SSO completion

**Files:**
- Modify: existing OIDC module and `auth_service`
- Test: provider discovery, authorization state, code exchange, JWKS/JWT validation, issuer/audience/nonce/expiry, MFA handoff, tenant mapping

- [ ] Implement durable OIDC flow state with state/nonce/PKCE binding.
- [ ] Implement authorization URL generation and code exchange over validated HTTPS issuer endpoints.
- [ ] Implement JWKS retrieval/cache with bounded freshness and key rotation handling.
- [ ] Verify ID-token signature and claims before user mapping/session issuance.
- [ ] Map identity to tenant/membership and enforce MFA policy after OIDC.
- [ ] Add replay, expired-token, wrong-audience, wrong-issuer, nonce, and PKCE tests.
- [ ] Commit.

### Task 8: RBAC UI and SCIM HTTP lifecycle

**Files:**
- Modify: `enterprise_tenant`/authorization modules
- Create/modify: SCIM HTTP routes and provisioning store
- Modify: platform console access-control views
- Test: role escalation, cross-tenant access, SCIM create/update/deactivate/group mapping/replay

- [ ] Enforce permission checks on every protected resource, not merely route groups.
- [ ] Expose role/permission state to UI without trusting client-selected roles.
- [ ] Implement SCIM 2.0 Users, Groups, deprovisioning, idempotency, and role mapping.
- [ ] Store SCIM bearer credentials through the existing secret-protection boundary.
- [ ] Revoke access immediately on deactivation.
- [ ] Commit.

### Task 9: WebAuthn/passkeys

**Files:**
- Modify: auth service MFA module and console authentication flow
- Test: registration, assertion, origin/RP-ID, challenge replay, recovery and revocation

- [ ] Add durable WebAuthn credential metadata behind KeyProtector where secret material is required.
- [ ] Enforce challenge single-use and expiry.
- [ ] Require origin/RP-ID validation.
- [ ] Integrate passkey authentication into the existing session and MFA policy.
- [ ] Commit.

### Task 10: API/OpenAPI and SDK completion

**Files:**
- Modify: `api/openapi.yaml`
- Modify: TypeScript, Python, Go, Rust, Java SDKs and CLI
- Test: generated model compatibility and running-control-plane contract tests

- [ ] Bring OpenAPI to parity with implemented APIs.
- [ ] Complete resource coverage for auth, orgs/RBAC, assets, findings, risk, policies, transactions, Q Core, crypto, AER-KEP-Q, compliance, evidence, incidents, usage, entitlements, billing, webhooks, and health.
- [ ] Add bounded retries, idempotency keys, correlation IDs, pagination, rate-limit handling, timeout behavior, structured errors, and tenant/RBAC error mapping.
- [ ] Add webhook signature verification helpers and receipt verification helpers.
- [ ] Add compatibility tests and changelog entries.
- [ ] Commit.

### Task 11: Distributed sessions and durable event processing

**Files:**
- Modify: session store abstraction
- Create/modify: event/queue abstraction and worker integration
- Test: duplicate delivery, ordering, retry, poison event, restart recovery

- [ ] Introduce a persistence-backed session abstraction suitable for multiple control-plane nodes.
- [ ] Preserve bearer-token non-persistence and existing token-digest security model.
- [ ] Add durable event queue with idempotency and bounded retry policy.
- [ ] Ensure workers cannot process revoked-tenant or revoked-user events after authorization changes.
- [ ] Commit.

### Task 12: HA, backup/restore, DR, and upgrade safety

**Files:**
- Create/modify deployment/runtime resilience modules and runbooks
- Test: failure injection and restore scenarios

- [ ] Define multi-node control-plane ownership/coordination and health semantics.
- [ ] Add backup/restore verification including cryptographic metadata and durable stores.
- [ ] Add DR runbook and recovery-point/recovery-time evidence hooks.
- [ ] Add multi-region deployment contract without assuming synchronous cross-region crypto state.
- [ ] Add zero-downtime migration and rollback protection tests.
- [ ] Commit.

### Task 13: KMS/HSM production boundary

**Files:**
- Modify: existing `core_crypto::vault` implementations and deployment adapters
- Test: local-dev versus production fail-closed behavior and key lifecycle

- [ ] Define production KeyProtector selection from deployment configuration.
- [ ] Require KMS/HSM-backed protection for production private-key paths where policy requires it.
- [ ] Verify startup fails closed when production key protection is unavailable.
- [ ] Add key rotation/deprecation integration with receipt issuer registry and AER-KEP-Q.
- [ ] Commit.

### Task 14: Enterprise integrations

**Files:**
- Create: integration adapters under the existing backend integration boundary
- Modify: webhook/event-bus and notification modules
- Test: signed webhooks, retry, tenant isolation, credential protection

- [ ] Add IAM integration boundary.
- [ ] Add SIEM/SOC event export.
- [ ] Add ITSM integration boundary.
- [ ] Add cloud/Kubernetes integration contracts.
- [ ] Add customer API-key lifecycle with scoped permissions and revocation.
- [ ] Add signed outbound webhooks/event bus and notifications.
- [ ] Commit.

### Task 15: Compliance and evidence pipeline

**Files:**
- Create/modify compliance/evidence modules
- Modify: receipt/ledger/evidence references
- Test: evidence immutability, export completeness, access control

- [ ] Map canonical controls to evidence sources without claiming certification.
- [ ] Export immutable receipt/ledger references and audit records.
- [ ] Add vulnerability/SBOM/release evidence linkage.
- [ ] Add access-review and policy-history evidence.
- [ ] Commit.

### Task 16: Assurance preparation and security validation

**Files:**
- Modify: `runtime/`, `docs/`, threat-model/security artifacts
- Create: external-review packages and evidence indexes
- Test: security regression suite

- [ ] Package architecture review material.
- [ ] Package AER-KEP-Q cryptographic review material with explicit limitations.
- [ ] Prepare secure-code/pentest/red-team scope and evidence.
- [ ] Run dependency/supply-chain checks locally.
- [ ] Re-test Phase 7 findings and preserve evidence.
- [ ] Commit.

### Task 17: Final validation and CI re-enable gate

**Files:**
- Modify: `.github/workflows/` only after product gates pass
- Modify: `docs/ENTERPRISE_COMPLETION_MATRIX.md`
- Modify: `runtime/status.md`, `runtime/tests.md`, `runtime/errors.md`, `runtime/report.md`
- Test: full Rust, TypeScript, security, integration, resilience suites

- [ ] Run `cargo fmt --all -- --check`.
- [ ] Run the complete Rust workspace test suite.
- [ ] Run TypeScript typecheck and Vitest suites.
- [ ] Run audit/deny/SBOM validation.
- [ ] Run end-to-end receipt, AER-KEP-Q, auth, billing, RBAC/SCIM, HA/DR, and console contract tests.
- [ ] Update completion matrix only from verified evidence.
- [ ] Re-enable CI workflows.
- [ ] Verify the resulting GitHub Actions runs and fix failures before calling the platform release-gated.
- [ ] Commit final validation evidence.
