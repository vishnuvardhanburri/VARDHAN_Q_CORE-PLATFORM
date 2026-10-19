# Vardhan Technologies — Real-Time Architecture

> **BE DIFFERENT**

This document is the visual architecture reference for how Vardhan Technologies operates from intelligence discovery through governed security execution and independent proof.

## 1. System Mind Map

```mermaid
mindmap
  root((Vardhan Technologies))
    Vardhan Intelligence
      External Intelligence
        Internet assets
        Threat intelligence
        Vulnerabilities
        Campaigns
      Internal Intelligence
        Logs
        Events
        Assets
        Identity signals
      Discovery
      Collection
      Normalization
      Entity Resolution
      Enrichment
      Correlation
      Verification
      Confidence / Risk
      Initial Access Intelligence
      VerifiedFindingContract
    Vardhan Q Core
      Trust Boundary
      Authority
      Policy Engine
      Transaction Engine
      Secure Execution
      PQ / Quantum Security
        ML-KEM-1024
        ML-DSA-87
        Ed25519
        BLAKE3
        AER-KEP-Q
      Key Management
      Seven Industry Planes
        Banking
        Healthcare
        Government
        Telecom
        Energy
        Insurance
        Education / Research
      Receipts
      Ledger
      Independent Verification
      HA / DR
      Enterprise Integrations
```

## 2. What Happens in Real Time

```mermaid
flowchart TD
    S[External + Internal Signals] --> D[Discovery / Collection]
    D --> N[Normalize]
    N --> R[Entity Resolution]
    R --> E[Enrich]
    E --> C[Correlate]
    C --> V[Verify]
    V --> Z[Score / Confidence]
    Z --> F[VerifiedFindingContract]

    F --> TB[Q Core Trust Boundary]
    TB -->|reject| X[Evidence / Error Path]
    TB -->|accept| P[Policy + Authority]
    P --> T[Transaction State Machine]
    T --> K[Cryptographic Protection]
    K --> A[AER-KEP-Q / PQ Controls]
    T --> EX[Secure Execution]
    EX --> SR[Signed Receipt]
    SR --> L[Ledger]
    L --> IV[Independent Verification]
    IV --> OUT[Verified Outcome]
```

### The rule

**Intelligence can discover and recommend. Q Core decides what can be trusted and what can execute.**

The intelligence plane never bypasses the Q Core trust boundary.

## 3. Intelligence Pipeline

```mermaid
flowchart LR
    A[Source] --> B[Collector]
    B --> C[Normalizer]
    C --> D[Entity Resolver]
    D --> E[Enrichment]
    E --> F[Correlation Graph]
    F --> G[Verification]
    G --> H[Confidence + Risk]
    H --> I[Finding Contract]
```

### Finding model

```text
Organization
   ↓
Internet / Internal Assets
   ↓
Technology / Identity / Exposure
   ↓
Vulnerability / Threat Activity
   ↓
Likely Initial Access / Entry Point
   ↓
Evidence
   ↓
Confidence
   ↓
Risk
   ↓
VerifiedFindingContract
```

## 4. Trust Boundary

```mermaid
sequenceDiagram
    participant I as Intelligence
    participant C as Contract
    participant Q as Q Core Boundary
    participant P as Policy
    participant T as Transaction

    I->>C: Emit evidence-backed finding
    C->>Q: Submit versioned contract
    Q->>Q: Validate schema, identity, evidence,
    Q->>Q: temporal state, hashes, provenance,
    Q->>Q: authorization, policy, entry-point metadata,
    Q->>Q: verification linkage and action candidates
    alt invalid
        Q-->>I: Reject + reason
    else valid
        Q->>P: Evaluate governed action
        P->>T: Authorize transaction
    end
```

The current trust boundary is a canonical **22-check validation model**. Rust and TypeScript implementations must remain contract-compatible.

## 5. Q Core Transaction Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Requested
    Requested --> Validating
    Validating --> AuthorityEvaluation
    Validating --> Rejected
    AuthorityEvaluation --> Executing
    AuthorityEvaluation --> Rejected
    Executing --> Sealing
    Executing --> Failed
    Sealing --> Sealed
    Failed --> [*]
    Rejected --> [*]
    Sealed --> [*]
```

A transaction is not considered complete merely because an action ran. Q Core produces verifiable evidence of the governed transaction.

## 6. Cryptographic Control Plane

```mermaid
flowchart TB
    T[Governed Transaction] --> P[PQ / Hybrid Security]
    P --> K1[ML-KEM-1024]
    P --> K2[ML-DSA-87]
    P --> K3[Ed25519]
    P --> K4[BLAKE3]
    P --> K5[AER-KEP-Q]
    T --> R[Signed Receipt]
    R --> L[Ledger]
    L --> V[Independent Verification]
```

The existing receipt/governance signing path remains distinct from AER-KEP-Q. AER-KEP-Q provides confidential session key establishment and exposure-aware epoch lifecycle; it does not replace transaction authentication or governance.

## 7. AER-KEP-Q Runtime Recovery

```mermaid
sequenceDiagram
    participant S as Sender
    participant E as Receiver Epoch e
    participant D as Exposure Detector
    participant Q as Quarantine
    participant N as Fresh Epoch e+1

    S->>E: Encapsulate under pk_e
    E-->>S: Session established
    D->>E: Exposure detected
    D->>Q: Quarantine epoch e
    Q->>Q: Destroy exposed secret state
    Q->>N: Generate fresh ML-KEM-1024 epoch
    N-->>D: Authenticated fresh descriptor
    D-->>S: Reissue using epoch e+1
    S->>N: Encapsulate under pk_e+1
    N-->>S: Fresh session established
```

AER-KEP-Q does **not** retroactively recover ciphertexts whose complete decryption state was already exposed. Pending application payloads require retransmission/reissue under the fresh epoch.

## 8. Seven Industry Planes

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

Each plane consumes the common trust, crypto, policy, transaction, evidence, and integration substrate while providing industry-specific assets, threat models, workflows, policies, risk models, control mappings, dashboards, integrations, reports, and deployment templates.

## 9. Production Deployment

```mermaid
flowchart LR
    U[Enterprise Environment] --> ING[Collectors / Integrations]
    ING --> INT[Vardhan Intelligence]
    INT --> QC[Vardhan Q Core]
    QC --> IAM[IAM / RBAC]
    QC --> KMS[HSM / KMS]
    QC --> SIEM[SIEM / SOC]
    QC --> CLOUD[Cloud / Kubernetes]
    QC --> DB[Databases / Network]
    QC --> LEDGER[Evidence Ledger]
    LEDGER --> AUDIT[Audit / Compliance]
```

Production deployment must separately validate HSM/KMS custody, HA/DR, network topology, IAM, observability, backup/restore, failure behavior, and external assurance requirements.

## 10. Security Control Chain

```mermaid
flowchart LR
    ID[Identity] --> POL[Policy]
    POL --> TRUST[Trust]
    TRUST --> CRYPTO[Cryptography]
    CRYPTO --> AUTH[Authorization]
    AUTH --> EXEC[Execution]
    EXEC --> EVID[Evidence]
    EVID --> AUDIT[Audit]
```

This chain is cross-cutting across both pillars. Security is not a separate third business pillar.

## 11. Production vs Simulation

```mermaid
flowchart TB
    CODE[Implementation] --> CLASS{Production or Simulation?}
    CLASS -->|Production| TEST[Required Tests + Runtime Evidence]
    CLASS -->|Simulation| FLAG[Explicit Simulation Flag]
    TEST --> RELEASE[Release Gate]
    FLAG --> NOCLAIM[No Production Security Claim]
```

Simulation code must remain explicitly identified. A simulation is not evidence of production security.

## 12. Evidence Model

```mermaid
flowchart LR
    FIND[Finding] --> EV[Evidence]
    EV --> VER[Verification]
    VER --> CONTRACT[VerifiedFindingContract]
    CONTRACT --> DEC[Governed Decision]
    DEC --> TX[Transaction]
    TX --> REC[Receipt]
    REC --> LED[Ledger]
    LED --> PROOF[Independent Proof]
```

## 13. Failure / Recovery Model

```mermaid
flowchart TD
    E[Runtime Event] --> D{Exposure / Failure?}
    D -->|No| C[Continue Governed Operation]
    D -->|Yes| Q[Quarantine / Fail Closed]
    Q --> R[Recover / Reissue / Failover]
    R --> V[Verify Recovery State]
    V --> C
```

The system should prefer explicit failure and governed recovery over silent degradation.

## 14. Documentation Rule

The README is the short entry point. This document is the visual system reference. Detailed implementation, assurance, security findings, runtime state, and industry requirements remain in their dedicated documents.

When implementation changes, update the architecture diagram and the relevant contract/runtime documentation in the same change.
