# Vardhan Technologies

> **BE DIFFERENT**

Security infrastructure for regulated enterprises, banks, and high-consequence digital operations.

Vardhan Technologies combines **Vardhan Intelligence** and **Vardhan Q Core** into one governed security platform.

---

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

**In simple terms:** Intelligence discovers and proves what is happening. Q Core decides what is trusted, authorized, executed, and provable.

## Two-Pillar Architecture

### 1. Vardhan Intelligence

**Discover → Collect → Normalize → Resolve → Enrich → Correlate → Verify → Score → Deliver**

- External intelligence
- Internal intelligence
- Attack-surface discovery
- Asset and technology intelligence
- Vulnerability and exposure intelligence
- Threat-actor and campaign intelligence
- Initial-access / entry-point intelligence
- Entity resolution and graph correlation
- Evidence and confidence scoring
- `VerifiedFindingContract` delivery

### 2. Vardhan Q Core

**Trust → Govern → Protect → Execute → Prove**

- Versioned trust boundary
- Authority and policy enforcement
- Transaction state machine
- Secure execution
- Post-quantum cryptography
- Key lifecycle and protection
- AER-KEP-Q
- Signed receipts and BLAKE3 integrity
- Ledger and independent verification
- HA / DR / enterprise deployment controls
- Seven industry planes

**Quantum/PQ security is inside Q Core. It is not a third business pillar.**

---

## Real-Time Finding Lifecycle

```mermaid
sequenceDiagram
    participant X as External/Internal Sources
    participant I as Vardhan Intelligence
    participant V as VerifiedFindingContract
    participant T as Q Core Trust Boundary
    participant A as Authority/Policy
    participant E as Transaction Engine
    participant C as Crypto Security
    participant L as Ledger
    participant R as Independent Verifier

    X->>I: New asset / event / threat data
    I->>I: Normalize + resolve + enrich
    I->>I: Correlate + verify + score
    I->>V: Produce verified finding
    V->>T: Submit contract
    T->>T: Validate canonical 22-check boundary
    T->>A: Valid finding
    A->>A: Evaluate policy + authority
    A->>E: Authorize governed transaction
    E->>C: Secure execution / PQ controls
    C-->>E: Cryptographic result
    E->>L: Seal signed receipt
    L->>R: Evidence / receipt
    R-->>T: Independent verification result
```

The upstream intelligence label is **never treated as sufficient trust by itself**. The Q Core boundary independently validates the contract before governed execution.

---

## Seven Industry Planes

All seven industries use the same Q Core security substrate; each plane adds domain-specific assets, workflows, policies, controls, risk models, integrations, dashboards, reporting, and deployment templates.

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

---

## Security & Cryptographic Layer

```mermaid
flowchart TB
    A[Policy / Authority] --> B[Secure Transaction]
    B --> C[Cryptographic Control]
    C --> D[ML-KEM-1024]
    C --> E[ML-DSA-87]
    C --> F[Ed25519]
    C --> G[BLAKE3]
    C --> H[AER-KEP-Q]
    B --> I[Signed Receipt]
    I --> J[Ledger]
    J --> K[Independent Verification]
```

AER-KEP-Q provides authenticated epochs, ML-KEM session establishment, transcript binding, replay protection, exposure detection, quarantine, fresh-epoch recovery, descriptor validation, and rollback protection.

It deliberately does **not** claim retroactive protection for ciphertexts whose complete decryption state was already exposed. That epoch is quarantined and new traffic moves to a fresh authenticated epoch.

AER-KEP-Q is an engineered protocol candidate built from established primitives; it is not presented as a newly invented primitive or completed peer-reviewed proof.

---

## Runtime / Production Boundary

```mermaid
flowchart LR
    D[Development] --> T[Test & Verification]
    T --> CI[CI / Supply Chain Gates]
    CI --> S[Signed Release Artifact]
    S --> P[Production Deployment]
    P --> M[Runtime Monitoring]
    M --> X[Incident / Exposure Detection]
    X --> Q[Governed Response]
    Q --> P
```

Production claims require runtime evidence in addition to compilation. The repository validates Rust, Intelligence Plane, trust-boundary integration, Linux eBPF, supply chain, and release controls in CI; deployment-specific HSM/KMS, HA/DR, and external assurance remain separate concerns.

---

## Repository Map

```text
Vardhan Technologies
│
├── backend/              Q Core Rust services + cryptographic substrate
├── intelligence_plane/   Vardhan Intelligence + evidence/verification
├── contracts/            Versioned platform contracts
├── sdks/                 TypeScript + Python SDKs
├── zk_engine/            Zero-knowledge engine
├── runtime/              Short operational status/reports
├── docs/                 Architecture, assurance, roadmap, industry docs
└── .github/              CI, security and release workflows
```

Detailed visual architecture: [`docs/VARDHAN_ARCHITECTURE_REALTIME.md`](docs/VARDHAN_ARCHITECTURE_REALTIME.md)

Product roadmap: [`docs/VARDHAN_ROADMAP.md`](docs/VARDHAN_ROADMAP.md)

---

## Roadmap

```mermaid
gantt
    title Vardhan Technologies Engineering → Assurance → Global Platform
    dateFormat YYYY-MM-DD
    axisFormat %b %Y
    section Engineering
    Foundation (Phase 0)       :done,p0,2026-01-01,2026-06-30
    Enterprise Control Plane   :done,p1,2026-05-01,2026-07-31
    Industry Framework         :done,p2,2026-06-01,2026-08-15
    Continuous Security Ops    :done,p3,2026-06-15,2026-08-31
    Compliance & Assurance Eng :done,p4,2026-07-01,2026-08-31
    Enterprise Integrations    :done,p5,2026-07-15,2026-09-15
    Resilience & Deployment    :done,p6,2026-08-01,2026-09-30
    section Assurance
    Independent Security Review :p7,2026-10-01,2026-12-31
    section Commercial
    Global Commercial Platform :p8,2027-01-01,2027-12-31
```

The dates above are planning visualization only, not delivery guarantees. See the roadmap document for evidence-backed status and gates.

---

## Validation

### Rust

```bash
cargo fmt --all -- --check
cargo test --workspace
cargo build --workspace --release
```

### Intelligence Plane

```bash
cd intelligence_plane
npm install
npx tsc -p tsconfig.xavira.json --noEmit
npx tsx tests/trust_boundary.test.ts
npx vitest run
```

### Security / Supply Chain

```bash
cargo audit
cargo deny check advisories
```

### Linux eBPF

Kernel and userspace components are compiled together in CI. Production runtime configuration uses `EBPF_OBJECT_PATH` and `EBPF_INTERFACE`.

---

## Runtime Truth

`runtime/` is intentionally small:

```text
runtime/
├── report.md
├── status.md
├── tests.md
└── errors.md
```

CI status is authoritative. Documentation must not claim a workflow is green without a verified successful run.

---

## Security Position

Vardhan Q Core is security infrastructure and a cryptographic control plane—not a collection of unrelated algorithms. Security claims are bounded by implementation evidence, test evidence, deployment configuration, and independent assurance status.

**Vardhan Technologies — BE DIFFERENT**

Proprietary. All rights reserved. © Vardhan Technologies.
