# VARDHAN Q-CORE Completion Design

## Intent and success criteria

Deliver all requested P1 and Phase 2 capabilities as real, fail-closed production paths. A capability is eligible for a verified gate only when its implementation, automated negative/positive tests, review result, reproducible command, and evidence reference agree. Existing functionality is reused; documentation claims alone are not evidence.

## Audit findings that govern this work

- The workspace contains a large Rust control plane, existing P1/P2 implementations, SDKs, a console, and CI workflows; this is not a blank implementation.
- `docs/P1_SECURITY_READINESS_EVIDENCE.md` records open/partial identity, receipt, tenant, and evidence gaps while `docs/P1_SELF_AUDIT.md` claims P1 completion. The readiness document governs until direct tests resolve each disagreement.
- The workspace has no `.git` metadata, branch, remote, or history. Changes can be implemented and validated locally, but authentic commits to `main` cannot be produced from this checkout. This is a delivery-environment blocker, not evidence of completion.

## Architecture and trust boundaries

Identity requests enter through durable, tenant-bound state: OIDC/SAML assertions and WebAuthn challenges are single-use, expiry-bound, issuer/audience/origin/RP-bound, and map only to authoritative server-side memberships. SCIM credentials are organization-bound and all provisioning is idempotent.

Authorization derives actor identity, membership, permissions, and resource organization from authoritative server state. Route/UI scope never substitutes for a resource ownership check.

Receipt trust flows only from canonical transaction sealing through authenticated service transport, tenant-scoped issuer-key registry, real Ed25519 and ML-DSA-87 verification, replay/idempotency protection, and durable audit/telemetry evidence. Caller-provided keys, tenant IDs, or verification assertions are never authoritative.

Industry plane JSON is loaded as typed validated runtime configuration. Industry controls and risk policy are evaluated at tenant runtime and produce tenant-bound auditable decisions. Invalid or incomplete planes fail closed.

## Delivery ordering

1. Establish a fact-based inventory and red/green tests around existing P1 trust boundaries.
2. Close identity, authorization, receipt, and telemetry gaps first because all later domains depend on them.
3. Complete SDK/API/console contracts against those authoritative paths.
4. Complete industry runtime/policy, then resilience and durable evidence around the finalized interfaces.
5. Reconcile every security document only from fresh commands; run a final independent review and CI-equivalent suite.

## Security invariants

- Unknown, expired, replayed, malformed, cross-tenant, or unauthorized inputs are denied.
- No session or projected role grants administrator access without an authoritative membership/permission check.
- Real signature verification is never mocked at a production boundary.
- Durable audit evidence carries tenant, correlation, lineage, and parent linkage where applicable.
- No certificate, performance, coverage, or gate claim is inferred from a passing unrelated suite.

