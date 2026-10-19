# P1 Tenant Isolation Acceptance

## Boundary rule

Every tenant-scoped operation must derive its effective organization/tenant from authenticated server state and must reject a request when the caller is not a member of that organization. Client-supplied tenant IDs are inputs to validate, not authorization grants.

## Resource matrix

| Resource | Required negative test |
|---|---|
| Organizations | Member of org A cannot mutate/read org B administrative state |
| Members | Org A caller cannot list/change members of org B |
| Invitations | Org A caller cannot create/list/revoke/accept invitations scoped to org B |
| Findings | Finding access cannot cross organization boundary |
| Incidents | Incident access cannot cross organization boundary |
| Transactions | Transaction creation/read must bind tenant ID to authenticated organization |
| Security posture | Org A cannot read org B posture |
| Q-Core telemetry | Receipt organization path and receipt tenant ID must agree |
| Receipt issuer keys | Service identity must resolve inside requested organization |
| Billing | Usage/subscription state must be organization-scoped |
| SCIM | Provisioning/deprovisioning must be tied to the configured enterprise organization |
| OIDC/SAML | Identity-to-organization mapping must be explicit; no implicit cross-tenant fallback |

## Cryptographic boundary

For a Q-Core receipt, tenant isolation is enforced before cryptographic acceptance and again during issuer resolution. The receipt's tenant identifier must equal the expected organization. Issuer key lookup is exact on organization/service identity, and signatures are checked against the resolved registered keys.

## Current evidence

The repository contains organization membership primitives and a running control-plane contract test that creates an organization and exercises authenticated organization-scoped resources. This is not yet equivalent to the complete negative matrix above.

## Closure requirement

P1 tenant isolation is **not closed** until at least one automated negative test exists for each resource family above, covering a caller authenticated only in organization A attempting to access organization B.
