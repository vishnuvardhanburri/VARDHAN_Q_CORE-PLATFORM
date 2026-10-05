# Vardhan Technologies — Enterprise Completion Matrix

This is the implementation gate for the customer-facing platform. CI is deliberately excluded from this matrix until the product surface is complete.

## Product surfaces

- [x] Premium public landing page
- [x] Enterprise command-center shell
- [x] Server-authentication boundary in web client
- [ ] Full authenticated application pages wired to authoritative APIs
- [x] AER-KEP-Q runtime attached to control-plane status API
- [x] Security posture/findings/incidents/transactions API contracts with explicit unpopulated states
- [ ] Live Q-Core transaction/receipt telemetry wired into the control plane
- [ ] Organization onboarding and invitation lifecycle
- [x] Enterprise RBAC core/API enforcement
- [ ] Enterprise RBAC UI enforcement across all resources
- [ ] SSO: OIDC
- [ ] SSO: SAML 2.0
- [ ] MFA: WebAuthn/passkeys
- [x] MFA: TOTP/recovery policy
- [x] SCIM provisioning/deprovisioning core
- [ ] SCIM HTTP endpoint and enterprise directory integration

## API / SDK

- [x] Canonical OpenAPI contract (`api/openapi.yaml`)
- [x] TypeScript/Node SDK foundation
- [x] Python SDK foundation
- [x] Go SDK foundation
- [x] Rust SDK foundation
- [x] Java SDK foundation
- [x] CLI foundation
- [ ] Complete SDK resource coverage against OpenAPI
- [ ] SDK generated-model compatibility tests
- [ ] Idempotency helpers in every SDK
- [ ] Webhook signature verification in every applicable SDK
- [x] Official API versioning/deprecation policy (`docs/API_VERSIONING_POLICY.md`)
- [ ] API contract integration tests against running control plane

## Commercial platform

- [x] Billing provider adapter boundary
- [x] Verified billing webhooks
- [x] Subscription state machine
- [x] Entitlement activation only from verified billing state
- [ ] Trials / quotes / enterprise contracts
- [ ] Invoice/tax metadata
- [ ] Usage event ledger
- [ ] Usage reconciliation
- [ ] Metering limits and overage policy

## Enterprise operations

- [ ] IAM integrations
- [ ] SIEM/SOC integrations
- [ ] ITSM integrations
- [ ] Cloud integrations
- [ ] Kubernetes integration
- [ ] KMS/HSM integration
- [ ] Webhook/event bus
- [ ] Notifications
- [ ] Audit/evidence export
- [ ] Customer API key lifecycle

## Platform resilience

- [ ] Distributed session store
- [ ] Multi-node HA
- [ ] Durable queue/event processing
- [ ] Backup/restore
- [ ] Disaster recovery runbooks
- [ ] Multi-region strategy
- [ ] HSM/KMS production deployment path
- [ ] Zero-downtime upgrade path
- [ ] Rollback protection
- [ ] Failure-injection tests

## Assurance

- [ ] External architecture review
- [ ] Secure-code review
- [ ] Penetration test
- [ ] Red-team assessment
- [ ] AER-KEP-Q independent cryptographic review
- [ ] Supply-chain assessment
- [ ] Independent remediation retest
- [ ] Cyber Essentials where applicable
- [ ] Cyber Essentials Plus where applicable
- [ ] ISO 27001 program/certification
- [ ] SOC 2 Type II program/attestation
- [ ] PCI DSS where applicable
- [ ] Customer-specific assurance packages

## Release gate

The platform is not described as production-ready until every applicable unchecked item above has implementation evidence, tests, and an owner. CI is a separate final gate and is intentionally handled after product completion.
