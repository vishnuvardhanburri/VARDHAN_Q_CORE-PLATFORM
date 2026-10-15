# Stage 3 — £500K Production Engagement

**Offer status:** production planning brief; not a binding scope or a statement that the platform is production-ready.

## Commercial outcome

Operationalize the buyer-accepted PoV outcome for the precisely agreed production use case, with accountable operations, security controls, acceptance evidence, support, and commercial terms.

**Important:** £500,000 is the target value supplied for this stage. Before proposing it, decide whether it is a one-time implementation fee, annual license, multi-year subscription, support/assurance package, or a combination. Do not call it ARR unless the signed agreement creates recurring annual revenue.

## Entry criteria

- Discovery and PoV reports accepted.
- Buyer sponsor confirms material value and wants production deployment.
- Production use case, integrations, tenants/environments/nodes, data classes, deployment location, operating owners, and dependencies are defined.
- Production-blocking security issues have an accepted remediation plan.
- Procurement, security, privacy, legal, finance, and operations review paths are identified.
- Budget authority and decision process are confirmed.
- Price basis, term, milestones, acceptance, and responsibility boundaries are agreed.

## Scope to negotiate

The signed production SOW must specify which items apply; none is included by implication.

1. **Production architecture and deployment:** environments, tenancy/topology, network boundary, rollout/rollback, infrastructure prerequisites, integration inventory, and supported versions.
2. **Identity, policy, and trust:** OIDC/SAML, RBAC, SCIM, workload/service identity, key registry, receipt verification, and lifecycle requirements; authorization and tenant-isolation evidence.
3. **Key management and transport:** selected production KMS/HSM provider, key ownership/rotation/revocation, recovery, secret handling, TLS/mTLS, and integration tests. Do not claim these controls are ready until the selected path is integrated and verified.
4. **Durability and operations:** shared multi-node replay protection, durable queueing, backup/restore, failure handling, disaster recovery, monitoring, alert routing, capacity, runbooks, rollback, availability, and RTO/RPO.
5. **Audit and integrations:** named APIs/SDKs, external systems, evidence exports, retention/access controls, correlation fields, and integrity verification.
6. **Security assurance:** independent architecture/secure-code review, penetration test, red-team/cryptographic review where justified, remediation ownership and retest. Claim certifications or attestations only when independently awarded.
7. **Rollout and support:** cutover, training, operational ownership, release/upgrade process, incident response, support hours, severity definitions, and response/restoration commitments.

## Deliverables

- Approved production architecture and threat model.
- Implementation/configuration and enumerated integration artifacts.
- Production deployment and rollback runbooks.
- Security test evidence, dependency/supply-chain reports, and contracted independent-assessment/remediation results.
- Monitoring, audit/evidence export, recovery, and incident procedures.
- Performance/capacity results against agreed workload.
- Operations handover and training.
- Acceptance dossier mapping every contract requirement to test evidence and buyer sign-off.

## Production acceptance gate

Negotiate criteria for: valid receipts independently verifying; tampering and unauthorized key/identity use being rejected; replay protection under agreed multi-node concurrency and crash/restart scenarios; tenant isolation and authorization tests passing; selected production key-management/transport controls tested; durable and exportable correlated audit records; monitoring, incident response, backup/restore, and rollback exercised; agreed performance/availability/RTO/RPO objectives measured; required independent assessment and remediation completed; and sign-off by technical, security, operations, and commercial approvers.

Performance, availability, support response, and recovery targets must match the deployment and be agreed in writing; this template does not invent them.

## Commercial terms to settle

One-time vs recurring fee and term; license/usage entitlements and extra tenant/node/region/integration fees; payment milestones and acceptance; VAT, expenses, travel and third-party assurance costs; IP ownership and customer-data rights; confidentiality, retention/deletion and residency; support, maintenance, upgrades, SLA/service credits and end-of-life; security responsibilities, subcontractors, liability/indemnity, warranty, transition and termination; buyer dependencies/schedule relief; and change control.

These terms require legal/commercial review. This document is not legal advice.

## No-go conditions

Do not present production as ready for signature if the PoV is not accepted, production dependencies are unknown, required security reviews lack owners, selected KMS/HSM and transport paths are unverified, support/SLA obligations cannot be met, or the customer has not agreed the commercial basis and procurement path.
