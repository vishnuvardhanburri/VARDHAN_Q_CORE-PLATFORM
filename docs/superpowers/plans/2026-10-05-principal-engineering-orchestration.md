# VARDHAN Q-CORE Principal Engineering Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Tasks use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile and complete P1 and Phase 2 delivery with implementation, tests, security review, evidence, and integration verification for every claim that can be demonstrated in this checkout.

**Architecture:** Preserve authoritative server-side identity, tenant, receipt, and industry-contract boundaries. Implement changes behind existing service interfaces, prove each trust boundary by adversarial tests, and record only verified evidence.

**Tech Stack:** Rust workspace/Axum/serde, existing persistence and cryptography crates, TypeScript platform web, TypeScript/Python/Go/Rust/Java SDKs, OpenAPI, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-05-vardhan-q-core-completion-design.md`

## Global Constraints

- Fail closed for identity, authorization, tenant binding, secret protection, cryptographic verification, and policy validation.
- Use TDD: demonstrate each new regression test fails before its minimal implementation change.
- Do not claim completion without a fresh command result and evidence location.
- Do not manufacture commits: this checkout currently has no Git metadata.
- Record every material scope decision in `docs/ENGINEERING_LEDGER.md`.

## Review Focus

- Cross-organization access for every protected resource family must deny even with a valid session.
- Identity ceremonies must reject replay, issuer/audience/origin/RP mismatch, expiry, and unauthorized provisioning.
- Receipt verification must use registered real keys and reject tampering, wrong tenant/service/key, and replay.
- Runtime industry contracts must reject missing controls/requirements and influence policy outcomes.
- Persistence, retries, and partial failure must not create false evidence or resurrect revoked state.

### Task 1: P1 identity and session trust

**Files:** Existing `backend/auth_service/src/`, `backend/control_plane_api/src/{enterprise_sso,saml_service,webauthn_api}.rs`; focused Rust tests.

- [ ] Inventory actual OIDC/SAML/WebAuthn/SCIM paths and write adversarial tests for every listed P1 invalid input.
- [ ] Run each new test red; implement only proven missing validation/lifecycle behavior; run focused and package tests.
- [ ] Independently review identity changes for token/session/tenant boundary bypass.
- [ ] Reconcile identity evidence with command and test references.

### Task 2: Authorization and tenant isolation

**Files:** Existing auth middleware, authorization, enterprise tenant, control-plane resources and integration tests.

- [ ] Enumerate authenticated routes and identity/role extraction callsites.
- [ ] Add cross-tenant negative contracts across organizations, members, invitations, operational resources, SSO/SCIM, API keys, usage, and telemetry.
- [ ] Repair only authorization defects proven by red tests and independently review server-authoritative role paths.

### Task 3: Receipt trust and audit/telemetry lineage

**Files:** `backend/vardhan_{transaction,receipt,verifier}/`, `backend/control_plane_api/`, audit/ledger modules and integration tests.

- [ ] Trace canonical producer to ingress and write real-key integration vectors for every required tamper/key/tenant/service/replay case.
- [ ] Close proven transport/registry/verification/lineage gaps; test persistence/reload and correlation/parent validation.
- [ ] Independently review cryptographic and replay behavior.

### Task 4: API, SDK, and console contracts

**Files:** `api/openapi.yaml`, actual `sdk/` and `sdks/` implementations, `platform_web/`, contract test suites.

- [ ] Inventory only SDKs actually present and generate a machine-readable coverage matrix.
- [ ] Add compatibility/interoperability tests for models, canonical requests, idempotency, webhook signatures, errors, timeout/retry behavior, and org handling.
- [ ] Verify console client paths consume authoritative APIs and fail closed on errors.

### Task 5: Industry runtime and policy authority

**Files:** `industries/*/plane.json`, `backend/enterprise_tenant/src/industry_contracts.rs`, policy/evidence tests.

- [ ] Validate seven contracts for uniqueness, schema, controls, services, risk weights, deployment/HSM requirements.
- [ ] Demonstrate that selected industry configuration and controls alter tenant runtime policy decisions and emit auditable evidence.
- [ ] Add rejection tests for invalid, missing-control, and cross-tenant telemetry input.

### Task 6: Resilience and production hardening

**Files:** Idempotency, persistence, queue/worker, HA, rate limit, telemetry and crypto failure boundaries; test/benchmark harnesses.

- [ ] Establish existing test baselines and failure-injection coverage.
- [ ] Add only missing bounded tests for concurrency, restart, duplicate delivery, backpressure, storage/crypto/telemetry failure, and revocation races.
- [ ] Record measured command output; do not state performance numbers without benchmarks.

### Task 7: Evidence reconciliation and final verification

**Files:** Required P1 documents, SDK matrix, engineering ledger, CI-equivalent commands.

- [ ] Reconcile contradictory P1 documentation by test evidence, leaving unsupported items NOT VERIFIED.
- [ ] Run all available focused suites, then full workspace and language-specific CI-equivalent commands that the repository supports.
- [ ] Obtain a fresh whole-change correctness/security review; fix verified findings, re-test, and record exact residual gaps.

