# CI and Enterprise Platform Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore authoritative CI to green and close the remaining production-facing platform gaps without weakening the security architecture or overstating assurance.

**Architecture:** Fix the reported CI failure at its source, then verify the full repository gate. Separately, inventory the customer-facing platform surface and implement only gaps that are grounded in the current repository, preserving the Intelligence → Trust Boundary → Q Core architecture and existing cryptographic controls.

**Tech Stack:** Rust workspace, TypeScript intelligence plane, GitHub Actions, existing backend services, existing documentation/runtime evidence.

**Spec:** Current repository architecture, roadmap, Phase 7 findings/remediation, and the user-approved requirement for a premium enterprise customer platform.

## Global Constraints

- Do not weaken security checks to make CI pass.
- Do not claim certifications that are not obtained.
- Do not replace existing receipt/signing architecture.
- Preserve tenant isolation, authority, transaction-state, ledger, and verification boundaries.
- Premium frontend must be enterprise-security product UX, not a generic SaaS dashboard.
- Every completion claim requires fresh verification evidence.

## Review Focus

- Rust formatting failure in eBPF userspace: CI must pass `cargo fmt --all -- --check`.
- Supply-chain secret scan must remain enforced and failures must be distinguishable from repository formatting/build failures.
- eBPF userspace/kernel ABI must remain aligned after formatting changes.
- Customer-facing platform must not expose backend-only functionality without authorization and audit boundaries.
- Pricing/billing must use explicit entitlements and tenant-safe state, not client-side pricing decisions.

---

### Task 1: Fix the reported CI formatting failure

**Files:**
- Modify: `backend/ebpf_engine/ebpf_user/src/main.rs`
- Test: repository-wide formatter gate

**Interfaces:**
- Consumes: existing `EBPF_OBJECT_PATH`, `EBPF_INTERFACE`, and `ALLOWED_PEERS` runtime configuration.
- Produces: formatter-clean Rust source with unchanged runtime behavior.

- [ ] **Step 1:** Reproduce with `cargo fmt --all -- --check`.
- [ ] **Step 2:** Apply rustfmt-only formatting to the reported lines.
- [ ] **Step 3:** Run `cargo fmt --all -- --check` and the eBPF crate tests/build.
- [ ] **Step 4:** Commit the minimal CI fix.

### Task 2: Run the authoritative repository verification matrix

**Files:**
- Read: `.github/workflows/sovereign-ci.yml`
- Read: `.github/workflows/security.yml`
- Read: `.github/workflows/enterprise-release.yml`
- Read: `Cargo.toml`

- [ ] **Step 1:** Verify workspace tests and formatter.
- [ ] **Step 2:** Verify TypeScript compilation and tests using the repository's current supported commands.
- [ ] **Step 3:** Verify `cargo audit` and `cargo deny check advisories`.
- [ ] **Step 4:** Inspect resulting GitHub Actions runs and individual failed jobs.
- [ ] **Step 5:** Record only fresh evidence in runtime status.

### Task 3: Complete the premium customer-platform foundation inventory

**Files:**
- Read: repository tree and existing backend/API modules.
- Create/modify only where an actual missing implementation is confirmed.

- [ ] **Step 1:** Identify existing auth, tenant, authorization, API, audit, notification, and usage primitives.
- [ ] **Step 2:** Identify whether pricing, entitlements, billing, frontend, landing, login, onboarding, and customer workspace code exists.
- [ ] **Step 3:** Define the smallest production-ready vertical slice from landing → auth → tenant → workspace → API.
- [ ] **Step 4:** Do not fabricate UI completion where no frontend exists.

### Task 4: Implement missing commercial API primitives

**Files:**
- Use existing backend service conventions; exact paths determined from Task 3 inventory.

- [ ] **Step 1:** Add tenant-scoped plan/entitlement model if absent.
- [ ] **Step 2:** Add server-side entitlement evaluation.
- [ ] **Step 3:** Add pricing/catalog read API.
- [ ] **Step 4:** Add usage/entitlement audit events.
- [ ] **Step 5:** Add tests for tenant isolation, unknown plan, disabled feature, and authorized access.

### Task 5: Build premium customer-facing platform surface

**Files:**
- Create: frontend application in the repository's chosen existing-supported location, only after Task 3 establishes the correct integration point.
- Test: frontend unit/integration/accessibility checks.

- [ ] **Step 1:** Establish the visual system: dark enterprise security aesthetic, restrained motion, depth, grid/lighting, typography, and data visualization primitives.
- [ ] **Step 2:** Build landing page with product architecture, assurance roadmap, industries, security model, and enterprise CTA.
- [ ] **Step 3:** Build authentication and organization onboarding.
- [ ] **Step 4:** Build customer workspace for Intelligence and Q Core.
- [ ] **Step 5:** Build security operations, findings, assets, risk, policies, crypto posture, AER-KEP-Q, compliance, evidence, reports, integrations, API, admin, usage, pricing, and settings surfaces.
- [ ] **Step 6:** Wire authorization/entitlements to server responses; no client-side security decisions.
- [ ] **Step 7:** Add loading, error, empty, offline, permission-denied, and audit-visible states.

### Task 6: Final production gate

- [ ] **Step 1:** Run complete repository verification.
- [ ] **Step 2:** Confirm CI green on the final commit.
- [ ] **Step 3:** Inspect security workflow and release workflow for regressions.
- [ ] **Step 4:** Update runtime evidence.
- [ ] **Step 5:** Report remaining gaps honestly, especially external assurance and any customer integrations requiring credentials.
