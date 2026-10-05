# P1 Security & Readiness Evidence

**Audit point-in-time:** 2026-10-05  
**Audited commit:** `93af80f9afbbf28b5a5503e93d6963f813c13170`  
**Decision:** **P1 NOT CLOSED**. The repository has a green CI baseline, but several acceptance items still require direct evidence or remediation.

## 1. Acceptance matrix

| # | P1 requirement | Status | Evidence / remaining work |
|---|---|---|---|
| 1 | Full authenticated application pages wired to authoritative APIs | **OPEN** | Current repository audit did not establish a complete page-by-page authenticated UI/API evidence trail. Do not mark complete from backend CI alone. |
| 2 | Canonical receipt producer → authenticated Q-Core telemetry publishing | **PARTIAL / VERIFIED AT GATEWAY** | `vardhan_receipt::gateway::handle_seal` calls `process_transaction`, then `qcore_transport::publish_receipt`, returning `SEALED_AND_PUBLISHED` or fail-closed `SEALED_BUT_NOT_PUBLISHED`. The standalone `ValidateCanonical` CLI calls `process_transaction` directly and does not publish. Acceptance must therefore be scoped to the HTTP gateway path unless the CLI is intentionally an offline producer. |
| 3 | Organization onboarding + invitation lifecycle | **VERIFIED BY CONTRACT COVERAGE** | Running control-plane contract test creates an organization and exercises authenticated organization-scoped APIs. Invitation lifecycle implementation exists, but dedicated negative/expiry/revocation evidence should be added before closure. |
| 4 | RBAC UI enforcement across resources | **OPEN** | Backend organization membership/RBAC exists. A complete UI enforcement matrix and negative authorization tests are not evidenced in the current audit. |
| 5 | OIDC SSO | **IMPLEMENTED; TEST EVIDENCE REQUIRED** | OIDC implementation includes authorization-code + PKCE, state/nonce, discovery/JWKS and issuer/audience/expiry validation. Add focused negative tests for nonce/state, issuer, audience, expiry, and key rotation before marking closed. |
| 6 | SAML 2.0 | **IMPLEMENTED; TEST EVIDENCE REQUIRED** | `saml_service.rs` uses strict SP validation, signed IdP metadata pinned to operator-supplied certificate, XML signature validation through `saml-rs`, replay cache, and membership/auto-provisioning gates. Dedicated adversarial SAML test evidence is still required. |
| 7 | WebAuthn/passkeys | **IMPLEMENTED; TEST EVIDENCE REQUIRED** | Durable ceremony state serialization is enabled and persistent challenges/credentials are implemented. Add explicit replay, origin/RP-ID, challenge reuse, and credential lifecycle tests to close the gate. |
| 8 | SCIM HTTP endpoint + enterprise directory lifecycle | **IMPLEMENTED; TEST EVIDENCE REQUIRED** | SCIM service-provider configuration, bearer authentication, user provisioning/deprovisioning and persistent state are present. Add negative tenant/authentication tests and lifecycle contract evidence. |
| 9 | Complete SDK resource coverage | **SUBSTANTIALLY VERIFIED** | CI reports first-party Rust, Go, TypeScript, Python and Java SDK contract coverage. Maintain a generated OpenAPI resource inventory as the authoritative completeness check. |
| 10 | Generated-model compatibility tests | **VERIFIED BY CI** | First-party SDK CI includes generated-model compatibility validation. |
| 11 | Idempotency helpers in every SDK | **PARTIAL / VERIFY INVENTORY** | Rust and Python SDKs expose idempotency helpers and request support. A repository-wide inventory is required for every applicable first-party SDK before closure. |
| 12 | Webhook signature verification in applicable SDKs | **PARTIAL / VERIFY INVENTORY** | Rust and Python implementations expose HMAC webhook verification. Confirm every applicable SDK and add positive/negative interoperability vectors. |
| 13 | API contract integration tests against running control plane | **VERIFIED BY CI** | CI run `37289101554` on commit `93af80f9afbbf28b5a5503e93d6963f813c13170` passed the running control-plane contract job. |

## 2. Security boundary observations

### Session token rotation
The control-plane contract test was updated to consume `Authorization-New-Token` after authenticated requests. This is now part of the running contract path. The acceptance gate still requires an explicit negative test proving the previous token is rejected after rotation and the replacement token remains valid.

### Secure bootstrap password
CI was updated to use `VARDHAN_ADMIN_PASSWORD_FILE` rather than the removed long-lived `VARDHAN_ADMIN_PASSWORD` bootstrap path. The acceptance gate should retain a negative startup test proving the legacy variable cannot bootstrap production credentials.

### Receipt trust boundary
The canonical receipt path is:

`VerifiedFindingContract → TrustBoundaryValidator → VardhanTransaction → authority evaluation → canonical payload → BLAKE3 payload hash → persistent Ed25519 + ML-DSA-87 signatures → sealed receipt → authenticated HMAC transport → control-plane tenant/issuer verification`

The transport signs `{timestamp}.{nonce}.{body}` with HMAC-SHA256 and binds the receipt to the organization. The control plane additionally verifies registered issuer key identity and receipt signatures.

### SAML trust boundary
The ACS path fails closed when IdP metadata, trust certificate, entity ID, or default organization configuration is missing. Signed metadata is required, strict SP validation is enabled, and replay keys are stored with atomic compare-and-swap semantics in the control-plane sled store.

## 3. Explicit residual risks before P1 closure

1. **Legacy auth-service role projection:** `extract_authenticated_user` currently constructs `AuthenticatedUser::new_admin(...)`. This must be reconciled with the intended role source before claiming end-to-end RBAC enforcement for auth-service administrative endpoints.
2. **API-key revoke authorization:** the revoke handler authenticates the caller but currently discards the caller object before revoking the key. The `ManageApiKeys` permission exists in the authorization model but must be enforced at the handler boundary.
3. **SAML adversarial tests:** implementation is present, but test evidence for signature wrapping, invalid issuer/audience/destination/recipient, replay, and expired assertions is not yet established.
4. **OIDC adversarial tests:** negative validation vectors must be captured as regression tests.
5. **WebAuthn adversarial tests:** replay and ceremony-binding tests must be captured as regression tests.
6. **SCIM tenant/authz tests:** provisioning/deprovisioning needs explicit negative isolation evidence.
7. **Tenant isolation:** add cross-organization negative tests for organizations, members, invitations, findings, incidents, transactions, security posture, Q-Core telemetry, billing, SCIM and SSO mappings.
8. **Authenticated UI evidence:** backend contract success is not sufficient to close the authenticated UI/API wiring requirement.
9. **SDK inventory:** produce a machine-readable list of applicable first-party SDK resources and verify idempotency/webhook helpers against it.

## 4. P1 closure rule

P1 is closed only when every `OPEN`, `PARTIAL`, or `IMPLEMENTED; TEST EVIDENCE REQUIRED` row above has a committed implementation plus a reproducible test/evidence reference. A green CI run alone is not sufficient.

## 5. CI baseline

Latest known green workflow:

- Run: `37289101554`
- Commit: `93af80f9afbbf28b5a5503e93d6963f813c13170`
- Workflow result: success
- Covered jobs include Rust Quantum Core, eBPF production path, Intelligence Plane, first-party SDK contracts, Zero-Knowledge Engine, and running Control Plane API contract tests.

This document intentionally distinguishes **implementation present** from **acceptance proven**.
