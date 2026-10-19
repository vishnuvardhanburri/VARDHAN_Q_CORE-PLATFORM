# Vardhan Technologies — Production Roadmap

> **BE DIFFERENT**

This is the current product, engineering, assurance and commercialization roadmap. It is organized around the two-pillar platform and uses explicit production gates rather than treating documentation or feature completion as production readiness.

## 01 — Platform Mind Map

```mermaid
mindmap
  root((Vardhan Technologies))
    Vardhan Intelligence
      External Intelligence
      Internal Intelligence
      Discovery
      Collection
      Normalization
      Entity Resolution
      Enrichment
      Correlation
      Verification
      Risk Scoring
      VerifiedFindingContract
    Vardhan Q Core
      Trust Boundary
      Authority
      Policy Engine
      Transaction Engine
      Secure Execution
      PQ Security
        ML-KEM-1024
        ML-DSA-87
        AER-KEP-Q
      Key Lifecycle
      Seven Industry Planes
      Receipts
      Ledger
      Independent Verification
      HA / DR
      Enterprise Integrations
    Assurance
      Independent Architecture Review
      Penetration Test
      Red Team
      Cryptographic Review
      Secure Code Review
      Supply Chain Review
      ISO 27001
      SOC 2 Type II
      Cyber Essentials Plus
```

## 02 — How the Platform Operates

```mermaid
flowchart LR
    SRC[External + Internal Sources]
    SRC --> I1[Discover]
    I1 --> I2[Collect]
    I2 --> I3[Normalize]
    I3 --> I4[Resolve]
    I4 --> I5[Enrich]
    I5 --> I6[Correlate]
    I6 --> I7[Verify]
    I7 --> I8[Score]
    I8 --> F[VerifiedFindingContract]
    F --> T[Q Core Trust Boundary]
    T --> A[Authority + Policy]
    A --> X[Transaction Engine]
    X --> S[Secure Execution]
    S --> PQ[PQ / AER-KEP-Q]
    PQ --> R[Signed Receipt]
    R --> L[Ledger]
    L --> V[Independent Verification]
```

**Core principle:** Intelligence produces evidence-backed findings. Q Core independently validates, governs, protects, executes and proves the resulting action.

## 03 — Roadmap at a Glance

```mermaid
flowchart TB
    P0[0 · Foundation] --> P1[1 · Enterprise Control Plane]
    P1 --> P2[2 · Industry Framework]
    P2 --> P3[3 · Continuous Security Operations]
    P3 --> P4[4 · Compliance & Assurance Engineering]
    P4 --> P5[5 · Enterprise Integrations]
    P5 --> P6[6 · Resilience & Enterprise Deployment]
    P6 --> P7[7 · Independent Security Assurance]
    P7 --> P8[8 · Global Commercial Platform]
```

---

## Phase 0 — Foundation

**Status: Engineering baseline established**

- PQ cryptography: ML-KEM / ML-DSA
- Trust boundary
- Authority / governance
- Transaction state machine
- Signed receipts
- Ledger + independent verification
- Intelligence → Q Core path
- AER-KEP-Q
- Exposure detection / quarantine / recovery
- Restart-safe runtime state
- Durable idempotency
- CI / build infrastructure

**Gate:** stable foundation for enterprise platform hardening.

## Phase 1 — Enterprise Control Plane

**Status: Engineering implemented; production hardening continues**

```mermaid
flowchart LR
    O[Organizations / Tenants] --> U[Users / RBAC]
    U --> P[Policies]
    P --> C[Configuration]
    C --> API[Enterprise API]
    API --> A[Admin + Audit]
    A --> H[Health / Notifications]
```

Scope:
- organizations / tenants
- users / roles / RBAC
- projects / environments
- asset inventory
- security policies
- configuration
- secrets / key-management interfaces
- enterprise API
- admin console
- audit trail
- notifications
- health / status
- entitlements / licensing

## Phase 2 — Seven Industry Framework

**Status: Common architecture established; industry-depth execution continues**

```mermaid
flowchart TB
    Q[Q Core Common Substrate]
    Q --> B[Banking / Financial Services]
    Q --> H[Healthcare]
    Q --> G[Government / Public Sector]
    Q --> T[Telecom]
    Q --> E[Energy / Critical Infrastructure]
    Q --> I[Insurance]
    Q --> R[Education / Research]
```

Each plane must provide:
- industry asset model
- threat model
- security workflows
- policies
- risk model
- compliance/control mappings
- dashboards
- integrations
- reporting
- deployment templates

The seven planes share the same trust, cryptographic, governance, transaction, evidence and integration substrate.

## Phase 3 — Continuous Security Operations

**Status: Engineering foundation established; production data/connectors continue**

```mermaid
flowchart LR
    M[Continuous Monitoring] --> E[Exposure Detection]
    E --> R[Risk Scoring]
    R --> P[Security Posture]
    P --> A[Alerts / Incidents]
    A --> X[Governed Remediation]
    X --> M
```

Scope:
- continuous monitoring
- exposure detection
- risk scoring
- security posture
- policy drift
- crypto posture
- key lifecycle
- AER-KEP-Q operations
- alerts
- incident workflows
- safe automated remediation
- executive reporting

## Phase 4 — Compliance & Assurance Engineering

**Status: Engineering controls implemented; external assurance remains separate**

- control mapping
- audit evidence
- immutable receipts
- compliance dashboards
- evidence export
- security reports
- vulnerability management
- SBOM
- secure release evidence
- incident records
- access reviews
- policy history

Target mappings include NIST CSF 2.0, PCI DSS, SOC 2, NIST SP 800-53, HIPAA, SOX, GDPR and ISO 27001 as applicable. **A mapping is not a certification.**

## Phase 5 — Enterprise Integrations

**Status: Integration architecture established; deployment-specific connectors continue**

```mermaid
mindmap
  root((Q Core Integrations))
    IAM
    SIEM / SOC
    Cloud
    Kubernetes
    Databases
    Network
    KMS / HSM
    ITSM
    Industry Systems
    Security Products
```

Goal: integrate into existing enterprise infrastructure rather than require customers to rebuild it.

## Phase 6 — Resilience & Enterprise Deployment

**Status: Engineering baseline established; real-world failure validation remains a gate**

```mermaid
flowchart LR
    N[Multi-node HA] --> F[Failover]
    F --> DR[Disaster Recovery]
    DR --> B[Backup / Restore]
    B --> MR[Multi-region]
    MR --> U[Zero-downtime Upgrade]
    U --> RB[Rollback Protection]
    RB --> N
```

Scope:
- multi-node HA
- distributed idempotency
- failover
- disaster recovery
- backup / restore
- HSM / KMS deployment
- key rotation
- multi-region
- offline / isolated deployment where applicable
- zero-downtime upgrades
- rollback protection
- real failure testing

---

# Phase 7 — Independent Security Assurance

**Status: External assurance gate**

## Assurance Stack

```mermaid
flowchart TB
    A[Architecture Review]
    B[Secure Code Review]
    C[Penetration Test]
    D[Red Team]
    E[AER-KEP-Q Cryptographic Review]
    F[Supply Chain Review]
    G[HSM / KMS Assessment]
    H[Remediation]
    I[Independent Retest]
    A --> H
    B --> H
    C --> H
    D --> H
    E --> H
    F --> H
    G --> H
    H --> I
```

## Certification & Assurance Badges

> **These are roadmap targets, not certifications currently held.** A badge becomes an official claim only after the corresponding certificate, attestation or independent assessment is actually issued.

| Roadmap target | What it demonstrates | Gate |
|---|---|---|
| ![Cyber Essentials](https://img.shields.io/badge/Cyber_Essentials-TARGET-1f2937) | UK baseline cyber controls | Readiness + certification |
| ![Cyber Essentials Plus](https://img.shields.io/badge/Cyber_Essentials_Plus-TARGET-1f2937) | Independently tested baseline controls | External technical assessment |
| ![ISO 27001](https://img.shields.io/badge/ISO_27001-TARGET-1f2937) | Information security management system | Certification audit |
| ![SOC 2 Type II](https://img.shields.io/badge/SOC_2_Type_II-TARGET-1f2937) | Operating effectiveness of security controls | Type II observation period + attestation |
| ![PCI DSS](https://img.shields.io/badge/PCI_DSS-TARGET-1f2937) | Payment-card security where applicable | Applicable-scope assessment |
| ![NIST](https://img.shields.io/badge/NIST_Control_Mapping-TARGET-1f2937) | Control framework alignment | Evidence-backed mapping |
| ![Independent Pentest](https://img.shields.io/badge/Independent_Pentest-REQUIRED-1f2937) | External technical attack validation | Pentest + remediation + retest |
| ![Red Team](https://img.shields.io/badge/Red_Team-REQUIRED-1f2937) | Adversarial end-to-end validation | Red-team exercise + remediation |
| ![Crypto Review](https://img.shields.io/badge/Cryptographic_Review-REQUIRED-1f2937) | Independent cryptographic assessment | AER-KEP-Q + crypto architecture review |
| ![HSM KMS](https://img.shields.io/badge/HSM_KMS_Assessment-REQUIRED-1f2937) | Production key-custody assurance | Deployment assessment |

### Assurance sequence

```mermaid
flowchart LR
    R[Readiness Assessment]
    R --> CE[Cyber Essentials]
    CE --> CEP[Cyber Essentials Plus]
    R --> ISO[ISO 27001 Program]
    ISO --> ISOC[ISO 27001 Certification]
    R --> SOC[SOC 2 Controls]
    SOC --> T1[Readiness / Type I where used]
    T1 --> T2[SOC 2 Type II]
    R --> PT[Independent Pentest]
    R --> RT[Red Team]
    R --> CR[AER-KEP-Q Crypto Review]
    R --> HSM[HSM / KMS Assessment]
    PT --> FIX[Remediation]
    RT --> FIX
    CR --> FIX
    HSM --> FIX
    FIX --> RETEST[Independent Retest]
```

Required external work includes:
- independent architecture review
- external penetration test
- red-team assessment
- AER-KEP-Q cryptographic review
- threat-model review
- secure-code assessment
- supply-chain assessment
- ISO 27001 program / certification as applicable
- SOC 2 readiness / Type II attestation as applicable
- Cyber Essentials / Cyber Essentials Plus as applicable to UK operations
- customer-specific assurance packages

These assurance tracks overlap but are **not substitutes for one another**. Certification does not by itself prove that every customer deployment is secure.

---

# Phase 8 — Global Commercial Platform

**Status: Future commercial execution**

```mermaid
flowchart LR
    P[Pilot] --> PR[Production]
    PR --> ARR[Annual Platform Revenue]
    ARR --> EX[Expansion]
    EX --> MC[Multi-country / Multi-industry]
    MC --> GC[Global Commercial Scale]
```

Scope:
- global enterprise sales
- strategic bank pilots
- sector specialists
- government / regulated-market programs
- integrators and channel partners
- production expansion
- multi-country deployment
- annual recurring platform contracts
- industry-specific expansion

---

## Production Gate — Non-Negotiable

```mermaid
flowchart TB
    E[Engineering] --> T[Test Evidence]
    T --> CI[Green CI]
    CI --> SC[Supply Chain Verification]
    SC --> RT[Runtime / Integration Evidence]
    RT --> DEP[Deployment Security]
    DEP --> EXT[Independent Security Review]
    EXT --> FIX[Remediation]
    FIX --> RETEST[Independent Retest]
    RETEST --> ASSURE[Applicable Certification / Assurance]
    ASSURE --> PILOT[Controlled Enterprise Pilot]
    PILOT --> PROD[Production]
```

The platform must **not** be described as fully production-ready merely because compilation succeeds.

Production gate requires, as applicable:

- green CI for the exact release commit
- runtime/integration evidence
- supply-chain verification
- deployment-specific security configuration
- HSM/KMS controls where required
- resilience/failure testing
- independent security assessment
- remediation and independent retest
- applicable certification / assurance completion

## What Is Already Different

```text
Intelligence
   ↓
Evidence
   ↓
VerifiedFindingContract
   ↓
Independent Trust Validation
   ↓
Policy / Authority
   ↓
Secure Transaction
   ↓
PQ / Cryptographic Protection
   ↓
Signed Evidence
   ↓
Ledger
   ↓
Independent Proof
```

The differentiation is the integrated control path—not a claim of a new cryptographic primitive.

## Source of Truth

- `README.md` — concise platform entry point and visual overview
- `docs/VARDHAN_ARCHITECTURE_REALTIME.md` — visual architecture and runtime behavior
- `docs/BACKEND_ARCHITECTURE_AUDIT.md` — backend architecture and technical boundaries
- `runtime/` — current runtime status, tests, errors and reports
- this file — current product roadmap, assurance roadmap and production gates
