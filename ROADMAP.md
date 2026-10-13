# Vardhan Q Core — Master Roadmap

## Goal
Build Vardhan Q Core into an enterprise-grade, post-quantum security control plane suitable for UK/global enterprise and regulated-industry pilots.

## Non-negotiable architecture
Intelligence → Verification → VerifiedFindingContract → Trust Boundary → Q-Core Gateway → Authority → Transaction State Machine → Existing PQ/Hybrid Signing → Ledger → Independent Verification.

AER-KEP-Q is an asynchronous exposure-resilient key-establishment subsystem. It complements, and does not replace, receipt authentication or the existing trust/ledger cryptography.

## Product structure
Common Vardhan Q Core platform with seven industry packages:
1. Banking & Financial Services
2. Healthcare
3. Government & Public Sector
4. Telecom
5. Energy & Critical Infrastructure
6. Insurance
7. Education & Research

## Security levels
Deployment/assurance tiers:
1. Foundation
2. Protected
3. Enterprise
4. High Assurance
5. Critical
6. Resilience
7. Sovereign / Strategic

Levels increase controls, isolation, monitoring, resilience, cryptographic requirements and assurance. They are not seven new cryptographic algorithms.

## Engineering roadmap
### Phase 0 — Foundation
Status: substantially complete.

### Phase 1 — Enterprise Control Plane
- Multi-tenant organization/project/environment model
- Users, roles and RBAC
- Asset inventory
- Security policies and configuration
- Secrets/key-management interfaces
- Enterprise API
- Admin console integration
- Audit trail
- Notifications and health/status
- Entitlements/licensing
- Tenant isolation tests

### Phase 2 — Seven Industry Packages
Banking; Healthcare; Government; Telecom; Energy/Critical Infrastructure; Insurance; Education/Research.
Each package: asset model, threat model, workflows, policies, risk model, compliance/control mapping, dashboards, integrations, reporting and deployment templates.

### Phase 3 — Continuous Security Operations
Continuous monitoring/verification, exposure detection, risk scoring, security posture, policy drift, crypto posture, key lifecycle, AER-KEP-Q operations, alerts, incidents, safe remediation and executive reporting.

### Phase 4 — Compliance & Assurance Engineering
Control mapping, audit evidence collection/export, immutable evidence, compliance dashboards, vulnerability management, SBOM, secure-release evidence, incident records, access reviews and policy history.

### Phase 5 — Enterprise Integrations
IAM, SIEM/SOC, cloud, Kubernetes, databases, network, KMS/HSM, ITSM and sector-specific integration interfaces.

### Phase 6 — Resilience & Enterprise Deployment
HA, distributed idempotency, failover, DR, backup/restore, HSM/KMS deployment interfaces, key rotation, multi-region, isolated/air-gapped deployment profiles, zero-downtime upgrades, rollback protection and failure testing.

### Phase 7 — Independent Security Assurance
Engineering support for independent pentest, architecture review, AER-KEP-Q cryptographic review, threat-model review, red-team, secure-code assessment, ISO 27001 program, SOC 2 readiness/attestation and customer assurance packages.

### Phase 8 — Global Commercial Platform
Global deployment readiness, target-jurisdiction controls, seven-industry coverage, partner/channel interfaces and pilot → production → recurring ARR → expansion.

## Assurance target — external work
Planned only until independently completed:
- ISO 27001
- SOC 2 Type I
- SOC 2 Type II
- Cyber Essentials Plus
- Independent penetration test
- Independent architecture/security review
- External red-team
- Independent AER-KEP-Q cryptographic review
- HSM/KMS assessment
- Vulnerability assessment and remediation/retest

## Rules
- Preserve existing cryptographic/trust architecture unless a security defect requires change.
- Do not claim a protocol or algorithm is novel/proven without independent evidence.
- Every engineering phase requires testable code and verification.
- External assurance is never marked complete by repository code alone.
- Engineering completion is separate from certification, legal, customer and market work.

## Status
Phase 0 substantially complete. Phase 1 is the active engineering target. External assurance remains pending.
