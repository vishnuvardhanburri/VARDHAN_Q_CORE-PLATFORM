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
- PQ cryptography and existing trust/receipt architecture
- ML-KEM / ML-DSA integration
- Trust boundary and authority/governance
- Transaction state machine
- Signed receipts, ledger and independent verification
- Intelligence → Q-Core path
- AER-KEP-Q with exposure detection, quarantine/recovery and authenticated epochs
- Restart-safe AER-KEP-Q runtime state
- Durable idempotency foundation
- CI/build infrastructure

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
Build common-core adapters/configuration for banking, healthcare, government, telecom, energy/critical infrastructure, insurance, and education/research.
Each package: asset model, threat model, workflows, policies, risk model, compliance/control mapping, dashboards, integrations, reporting and deployment templates.

### Phase 3 — Continuous Security Operations
- Continuous monitoring/verification
- Exposure detection and risk scoring
- Security posture and policy drift
- Crypto posture and key lifecycle
- AER-KEP-Q operations
- Alerts and incident workflows
- Safe automated remediation
- Executive reporting

### Phase 4 — Compliance & Assurance Engineering
- Control mapping
- Audit evidence collection/export
- Immutable receipts/evidence
- Compliance dashboards
- Vulnerability management
- SBOM and secure-release evidence
- Incident records
- Access reviews
- Policy history

### Phase 5 — Enterprise Integrations
IAM, SIEM/SOC, cloud, Kubernetes, databases, network, KMS/HSM, ITSM and sector-specific integration interfaces.

### Phase 6 — Resilience & Enterprise Deployment
HA, distributed idempotency, failover, DR, backup/restore, HSM/KMS deployment interfaces, key rotation, multi-region, isolated/air-gapped deployment profiles, zero-downtime upgrades, rollback protection and failure testing.

### Phase 7 — Independent Security Assurance
Engineering support for independent pentest, architecture review, AER-KEP-Q cryptographic review, threat-model review, red-team, secure-code assessment, ISO 27001 program, SOC 2 readiness/attestation and customer assurance packages.

### Phase 8 — Global Commercial Platform
Global deployment readiness across target jurisdictions and the seven industries; partner/channel interfaces; pilot → production → recurring ARR → expansion.

## Assurance target
Planned external evidence, not claimed until actually completed:
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

## Completion rules
- Preserve existing cryptographic/trust architecture unless a security defect requires change.
- Do not claim an algorithm or protocol is novel/proven without independent evidence.
- Every phase must leave testable code or documented external evidence.
- Security-sensitive changes require explicit tests and verification.
- External certification/audit results are marked pending until independently completed.
- Final engineering completion is separate from certification, legal, customer and market work.

## Current execution status
- Phase 0: substantially complete
- Phase 1: engineering execution in progress
- Phases 2–8: queued after dependency completion
- External assurance: pending independent providers
