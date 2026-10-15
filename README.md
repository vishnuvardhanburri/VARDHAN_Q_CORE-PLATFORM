# Vardhan Technologies

> **BE DIFFERENT**

**Post-quantum security infrastructure for regulated enterprises, banks, and high-consequence digital operations.**

Vardhan Technologies combines **Vardhan Intelligence** and **Vardhan Q Core** into one governed security platform.

## Assurance & Certification Roadmap

> These are **target assurance outcomes**, not certifications already held. Badges become claimable only after the corresponding assessment, certification or attestation is actually completed.

| Assurance | Purpose | Target status |
|---|---|---|
| ![Cyber Essentials](https://img.shields.io/badge/Cyber_Essentials-Target-1f2937) | Baseline UK cyber controls | Planned |
| ![Cyber Essentials Plus](https://img.shields.io/badge/Cyber_Essentials_Plus-Target-1f2937) | Independently tested baseline controls | Planned |
| ![ISO 27001](https://img.shields.io/badge/ISO_27001-Target-1f2937) | Information security management system | Planned |
| ![SOC 2 Type II](https://img.shields.io/badge/SOC_2_Type_II-Target-1f2937) | Operating effectiveness of security controls | Planned |
| ![PCI DSS](https://img.shields.io/badge/PCI_DSS-Target-1f2937) | Payment-card environments where applicable | Applicable deployments |
| ![NIST](https://img.shields.io/badge/NIST_Mappings-Target-1f2937) | Control and assurance mapping | Engineering mapping |
| ![Independent Pentest](https://img.shields.io/badge/Independent_Pentest-Target-1f2937) | External technical validation | Required |
| ![Crypto Review](https://img.shields.io/badge/Cryptographic_Review-Target-1f2937) | Independent review of cryptographic design | Required |

**Important:** Vardhan does not use target badges as proof of certification. Formal certificates, reports and attestations will be published only when issued by the relevant independent assessor or certification body.

---

## Platform Mind Map

```mermaid
mindmap
  root((Vardhan Technologies))
    Vardhan Intelligence
      External Intelligence
      Internal Intelligence
      Discovery
      Asset Intelligence
      Threat Intelligence
      Entry-Point Intelligence
      Entity Resolution
      Correlation
      Verification
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
      Independent Security Review
      Cryptographic Review
      Pentest
      Red Team
      ISO 27001
      SOC 2 Type II
      Cyber Essentials Plus
```

## How Vardhan Actually Works

```mermaid
flowchart LR
    A[External Intelligence] --> C[Discovery & Collection]
    B[Internal Intelligence] --> C
    C --> D[Normalize]
    D --> E[Entity Resolution]
    E --> F[Enrich & Correlate]
    F --> G[Verify & Score]
    G --> H[VerifiedFindingContract]
    H --> I[Q Core Trust Boundary]
    I --> J[Authority & Policy]
    J --> K[Transaction Engine]
    K --> L[Secure Execution]
    L --> M[Signed Receipt]
    M --> N[Ledger]
    N --> O[Independent Verification]
    P[PQ / Quantum Security] --> L
    Q[AER-KEP-Q] --> P
    R[7 Industry Planes] --> J
```

**In simple terms:** Intelligence discovers and proves what is happening. Q Core decides what is trusted, authorized, protected, executed, and provable.

## Commercial Engagement Path

Vardhan's target enterprise engagement sequence is buyer-gated: **£15K architecture/security discovery → £60K bounded proof of value → £500K production engagement**. These are target contract values, not booked revenue or a claim of production readiness. Each stage requires buyer evidence, written acceptance criteria, and an executed agreement before the next stage begins.

- [Commercial path and stage gates](docs/commercial/README.md)
- [£15K discovery scope](docs/commercial/DISCOVERY_15K_SCOPE.md)
- [£60K proof-of-value scope](docs/commercial/POV_60K_SCOPE.md)
- [£500K production scope](docs/commercial/PRODUCTION_500K_SCOPE.md)
- [First buyer problem-validation outreach](docs/commercial/FIRST_BUYER_OUTREACH.md)
- [LGT buyer hypothesis and tailored first-contact brief](docs/commercial/LGT_TARGET_HYPOTHESIS.md)

## Two-Pillar Architecture

### Vardhan Intelligence

**Discover → Collect → Normalize → Resolve → Enrich → Correlate → Verify → Score → Deliver**

- External and internal intelligence
- Attack-surface discovery
- Asset, technology, vulnerability and exposure intelligence
- Threat actors and campaigns
- Initial-access / entry-point intelligence
- Entity resolution and graph correlation
- Evidence and confidence scoring
- `VerifiedFindingContract`

### Vardhan Q Core

**Trust → Govern → Protect → Execute → Prove**

- Trust boundary and authority
- Policy and transaction state machine
- Secure execution
- PQ cryptography and key lifecycle
- AER-KEP-Q
- Signed receipts and BLAKE3 integrity
- Ledger and independent verification
- HA / DR and enterprise deployment
- Seven industry planes

**Quantum/PQ security is inside Q Core. It is not a third business pillar.**

---

## Real-Time Operational Flow

```mermaid
sequenceDiagram
    participant X as Sources
    participant I as Intelligence
    participant V as VerifiedFindingContract
    participant T as Trust Boundary
    participant A as Authority
    participant E as Transaction Engine
    participant C as Crypto Security
    participant L as Ledger
    participant R as Independent Verifier

    X->>I: Asset / event / threat data
    I->>I: Normalize + resolve + enrich
    I->>I: Correlate + verify + score
    I->>V: Evidence-backed finding
    V->>T: Contract submission
    T->>T: Canonical validation
    T->>A: Valid finding
    A->>E: Authorized transaction
    E->>C: Secure / PQ execution
    C-->>E: Cryptographic result
    E->>L: Signed receipt
    L->>R: Evidence
    R-->>T: Independent verification
```

## Seven Industry Planes

```mermaid
flowchart TB
    Q[Q Core Common Security Substrate]
    Q --> B[Banking / Financial Services]
    Q --> H[Healthcare]
    Q --> G[Government / Public Sector]
    Q --> T[Telecom]
    Q --> E[Energy / Critical Infrastructure]
    Q --> I[Insurance]
    Q --> R[Education / Research]
```

Each plane uses the common Q Core substrate while adding domain-specific assets, threat models, workflows, policies, controls, risk models, integrations, dashboards, reporting and deployment templates.

## Cryptographic & Resilience Flow

```mermaid
flowchart TB
    P[Policy / Authority] --> X[Secure Transaction]
    X --> K[Cryptographic Control]
    K --> MK[ML-KEM-1024]
    K --> MD[ML-DSA-87]
    K --> ED[Ed25519]
    K --> B[BLAKE3]
    K --> A[AER-KEP-Q]
    A --> E[Active Epoch]
    E --> D[Exposure Detection]
    D --> Q[Quarantine Exposed Epoch]
    Q --> N[Fresh Authenticated Epoch]
    N --> R[Reissue Pending Application Payloads]
    X --> SR[Signed Receipt]
    SR --> L[Ledger]
    L --> IV[Independent Verification]
```

AER-KEP-Q is an engineered protocol candidate using established primitives. It does not claim retroactive protection for ciphertexts whose complete decryption state was already exposed, nor does the repository claim a newly invented primitive or completed peer-reviewed proof.

---

## Roadmap Mind Map

```mermaid
mindmap
  root((Vardhan Technologies))
    Phase 0 Foundation
      PQ Crypto
      Trust Boundary
      Receipts
      Ledger
      AER-KEP-Q
      Durable Idempotency
    Phase 1 Enterprise Control Plane
      Tenancy
      RBAC
      Policies
      APIs
      Admin
    Phase 2 Industry Framework
      Banking
      Healthcare
      Government
      Telecom
      Energy
      Insurance
      Education
    Phase 3 Security Operations
      Monitoring
      Exposure
      Risk
      Incidents
      Remediation
    Phase 4 Assurance
      Evidence
      Compliance Mapping
      SBOM
      Vulnerability Management
    Phase 5 Integrations
      IAM
      SIEM
      Cloud
      Kubernetes
      KMS / HSM
      ITSM
    Phase 6 Resilience
      HA
      DR
      Failover
      Backup
      Multi-region
      Zero-downtime
    Phase 7 Independent Assurance
      Pentest
      Red Team
      Crypto Review
      Architecture Review
      ISO 27001
      SOC 2 Type II
    Phase 8 Global Platform
      Enterprise Pilots
      Strategic Contracts
      Global Expansion
```

Detailed roadmap: [`docs/VARDHAN_ROADMAP.md`](docs/VARDHAN_ROADMAP.md)

Detailed architecture: [`docs/VARDHAN_ARCHITECTURE_REALTIME.md`](docs/VARDHAN_ARCHITECTURE_REALTIME.md)

---

## Runtime / Production Boundary

```mermaid
flowchart LR
    D[Development] --> T[Test & Verification]
    T --> CI[CI / Supply Chain Gates]
    CI --> S[Signed Release Artifact]
    S --> P[Production Deployment]
    P --> M[Runtime Monitoring]
    M --> X[Exposure / Incident Detection]
    X --> Q[Governed Response]
    Q --> P
```

Production claims require runtime evidence in addition to compilation. Deployment-specific HSM/KMS, HA/DR and external assurance remain separate gates.

## Repository Map

```text
Vardhan Technologies
├── backend/              Q Core Rust services + cryptographic substrate
├── intelligence_plane/   Vardhan Intelligence + evidence/verification
├── contracts/            Versioned platform contracts
├── sdks/                 TypeScript + Python SDKs
├── zk_engine/            Zero-knowledge engine
├── runtime/              Operational status and reports
├── docs/                 Architecture, assurance, roadmap, industry docs
└── .github/              CI, security and release workflows
```

## Validation

```bash
cargo fmt --all -- --check
cargo test --workspace
cargo build --workspace --release
cargo audit
cargo deny check advisories
```

For the Intelligence Plane, run its typecheck, trust-boundary tests and Vitest suite. Linux eBPF kernel/userspace compatibility is validated in CI.

## Runtime Truth

CI status is authoritative. Documentation must not claim a workflow is green without a verified successful run.

**Vardhan Technologies — BE DIFFERENT**

Proprietary. All rights reserved. © Vardhan Technologies.
