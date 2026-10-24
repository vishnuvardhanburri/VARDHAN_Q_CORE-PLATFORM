# Vardhan Technologies — Q Core

### Top-Level Post-Quantum Cryptographic (PQC) Core Platform for Global Banking and Financial Infrastructure

**Production status: LOCAL POV VERIFIED | STAGING ACCEPTANCE VERIFIED | PRODUCTION BLOCKED (NOT APPROVED FOR LIVE RAILS).**

Vardhan Q Core is a top-level post-quantum cryptographic (PQC) and quantum-resilient financial transaction infrastructure platform. Engineered from first principles for mission-critical banking environments, Q Core provides quantum-safe digital signatures, immutable finding receipts, deterministic idempotency, exact minor-unit financial arithmetic, and high-throughput tamper-evident audit chaining.

---

## Global Banking Scope and Regulatory Alignment

While the initial deployment and regulatory sandboxing anchor in the **United Kingdom** (Bank of England RTGS/CHAPS renewal, Faster Payments Service, and PRA/FCA Operational Resilience SS1/21 & PS21/3), the platform architecture is engineered for the **entire global banking sector**, Tier 1 international financial institutions, correspondent banking networks, central banks, and market infrastructures across major financial hubs:

- **United Kingdom (Initial Anchor):** Bank of England Real-Time Gross Settlement (RTGS), CHAPS, Faster Payments Service (FPS), and UK Banking Reform / PRA/FCA regulatory frameworks.
- **United States:** Federal Reserve Fedwire Funds Service, FedNow Service, The Clearing House (CHIPS, RTP), and OCC / NYDFS Part 500 compliance.
- **Eurozone:** European Central Bank TARGET2 / T2, EURO1, STEP2, and EU Digital Operational Resilience Act (DORA).
- **Switzerland:** SIX Swiss Interbank Clearing (SIC) and FINMA operational resilience requirements.
- **Asia-Pacific:** Monetary Authority of Singapore (FAST / MEPS+), Hong Kong Monetary Authority (HKICL / CHATS), and Bank of Japan Financial Network System (BOJ-NET).
- **International Messaging Standards:** SWIFT ISO 20022 `pacs.008.001.08` (Financial Institutional Customer Credit Transfer) and `pacs.009.001.08` (Financial Institution Transfer) with hybrid dual-signing.
- **Interbank Settlement Principles:** BIS CPMI-IOSCO Principles for Financial Market Infrastructures (PFMI).

### Core Cryptographic and Invariant Engine

- **Dual-Signature Hybrid Scheme:** Classical Ed25519 (RFC 8032) paired with NIST FIPS 204 ML-DSA-87 (quantum-resistant digital signatures) for post-quantum defense with backwards compatibility.
- **Post-Quantum Key Encapsulation:** NIST FIPS 203 ML-KEM-1024 for quantum-safe transport channel key establishment.
- **Cryptographic Digest:** BLAKE3 256-bit tree-hashing substrate delivering high-speed integrity verification.
- **Ephemeral Key Rotation:** AER-KEP-Q deterministic epoch-transition protocol.
- **Exact Financial Arithmetic:** Pure integer minor-unit accounting (`amount_minor_units: u128`), decimal scale tracking (`amount_scale: u32`), and ISO 4217 minor-unit exponent mapping. Binary floating-point representation drift is eliminated.
- **Audit Ledger Substrate:** Cross-process advisory locking (`fs2`) with O(1) trailing-seek verification, preventing multi-process line interleaving and guaranteeing sequential hash chaining.

---

## Bank Deployment Readiness Level

Vardhan Q Core maintains an evidence-backed, 3-tier operational deployment boundary:

```
+-----------------------------------------------------------------------------+
| LEVEL 1: LOCAL POV & SANDBOX EVALUATION                                     |
| Status: VERIFIED & OPERATIONAL                                              |
| - 33/33 E2E lifecycle checks passed                                         |
| - Dual Ed25519 + ML-DSA-87 signatures verified                              |
| - 1,529.5 req/sec sustained throughput under concurrency                    |
| - 432 ms database restore RTO (20,100 entities, 100% financial sum check)   |
| - Exact minor-unit financial limits and pacs.008/pacs.009 validation        |
| - Strict Clippy (0 warnings, -D warnings) across all workspace crates       |
| - Zero tracked secrets, clean CycloneDX SBOM (554 components)               |
+-----------------------------------------------------------------------------+
                                      |
                                      v
+-----------------------------------------------------------------------------+
| LEVEL 2: MULTI-NODE STAGING & COUNTERPARTY INTEROPERABILITY                 |
| Status: STAGING ACCEPTANCE VERIFIED                                         |
| - Enterprise Docker Compose secrets fail-closed validation verified         |
| - Loopback interface isolation (127.0.0.1) on all published ports           |
| - Raft HA clustering: 14/14 node failure, split-brain, and recovery tests   |
| - Automated deployment record pruning active (1 deployment retained)        |
| - Strict TLS verification with configured test CA trust anchors             |
+-----------------------------------------------------------------------------+
                                      |
                                      v
+-----------------------------------------------------------------------------+
| LEVEL 3: PRODUCTION LIVE RAILS & INSTITUTIONAL CLEARING                     |
| Status: PRODUCTION BLOCKED (NOT APPROVED FOR LIVE RAILS)                    |
| The platform is strictly blocked from live banking transactions until the   |
| following five external institutional prerequisites are satisfied:          |
|                                                                             |
| 1. BLK-001: Banking PKI & Trust Federation (counterparty root CA/HSM)       |
| 2. BLK-002: CMVP / FIPS 140-3 Cryptographic Module Laboratory Certification  |
| 3. BLK-003: AER-KEP-Q Independent Specialist Cryptographic Review           |
| 4. BLK-004: Payment-Network Counterparty Sandbox Certification              |
| 5. BLK-005: Institutional Governance & Regulatory Non-Objection (PRA/FCA)   |
+-----------------------------------------------------------------------------+
```

---

## Authoritative Institutional Commercial Catalogue

The commercial model progresses from bounded technical problem validation to enterprise annual subscriptions and bespoke sovereign infrastructure. Codified in [docs/COMMERCIAL_PRICING_MODEL.md](docs/COMMERCIAL_PRICING_MODEL.md) and exposed via `GET /api/v1/catalog/plans`:

### 1. Commercial Entry Stages (Fixed-Fee Bounded Engagements)

- **Architecture & Security Discovery (`qcore_architecture_evaluation`): £15,000 fixed fee**  
  Fixed-scope evaluation assessing one specific customer workflow for submission integrity, policy enforcement, replay protection, and verifiable trust receipts. Delivery target: 48 hours after prerequisites and access are established.
- **Proof of Value (`qcore_proof_of_value`): £60,000 fixed fee**  
  Time-boxed 10-day evaluation executed in a bounded, authorized environment evaluating dual-signature verification against pre-agreed criteria. Delivers recorded test evidence, measured criteria results, and a formal go/no-go recommendation.

### 2. Annual Production Licences (Recurring Subscriptions)

- **Foundation (`foundation`): £360,000 / year**  
  Production single-tenant receipt signing and local verification (`q_core`, `audit`, `api`).
- **Enterprise (`enterprise`): £720,000 / year**  
  Multi-user global financial enterprise control plane with SCIM 2.0 provisioning, WebAuthn MFA, role-based IAM, enterprise SIEM integrations, and telemetry (`q_core`, `audit`, `api`, `rbac`, `integrations`, `compliance`, `usage`).
- **Advanced Resilience (`advanced_resilience`): £1,200,000 / year**  
  Dedicated cryptographic resilience tier for mission-critical interbank rails: post-quantum key epoch transitions (`aer_kep_q`), high-availability clustered nodes (`ha`), deterministic disaster recovery (`dr`), and hardware vault protection hooks (`hsm_kms`).

### 3. Strategic / Sovereign Enclave Deployments

- **Strategic / Sovereign (`strategic`): Individually Scoped (£5,000,000 to £50,000,000, £12,000,000 baseline target)**  
  Air-gapped and sovereign enclave deployments engineered for central banks, sovereign wealth funds, and national defense/settlement clearing systems (`sovereign_deployment`, `air_gapped`, `dedicated_assurance`).

> [!NOTE]
> **Historical Note on Earlier Documents:** Earlier preliminary sales briefs referenced a generic "£500,000 production engagement" placeholder. That historical figure has been superseded by the structured annual licensing catalogue above.

- [Commercial pricing model](docs/COMMERCIAL_PRICING_MODEL.md)
- [Commercial path and stage gates](docs/commercial/README.md)
- [Discovery scope (£15K)](docs/commercial/DISCOVERY_15K_SCOPE.md)
- [Proof-of-value scope (£60K)](docs/commercial/POV_60K_SCOPE.md)
- [Production engagement brief (historical £500K reference)](docs/commercial/PRODUCTION_500K_SCOPE.md)
- [UK institutional assurance pack](docs/UK_INSTITUTIONAL_ASSURANCE_PACK.md)

---

## Repository Map

The repository is organized into clearly separated architectural planes, cryptographic crates, verification tools, user surfaces, and institutional assurance dossiers:

```text
VARDHAN_Q_CORE-PLATFORM/
├── backend/                                Q Core Rust Workspace (16 crates)
│   ├── control_plane_api/                  Axum REST API server (port 8080), health gates, catalog
│   │   ├── src/distributed_idempotency/    PostgreSQL distributed idempotency store with retry backoff
│   │   ├── src/receipt_api.rs              Receipt sealing, query, and verification endpoints
│   │   └── src/catalog.rs                  Authoritative commercial licensing catalog API
│   ├── core_crypto/                        Hybrid cryptographic primitives engine
│   │   ├── src/payment_gate.rs             Exact minor-unit financial limits, pacs.008 / pacs.009
│   │   ├── src/hybrid_scheme.rs            Ed25519 + ML-DSA-87 dual signing implementation
│   │   └── src/aer_kep_q.rs                AER-KEP-Q epoch transition protocol candidate
│   ├── vardhan_receipt/                    Finding receipts and tamper-evident audit chaining
│   │   └── src/audit_trail.rs              Append-only JSONL audit log with fs2 advisory locking
│   ├── auth_service/                       Session management, WebAuthn MFA, and token validation
│   ├── ha_cluster/                         Raft consensus engine, peer manager, and 14 failure tests
│   ├── vardhan_keystore/                   Cryptographic key custody (local dev + Vault/KMS hooks)
│   ├── audit_ledger/                       Cryptographic hash chain structures and verification
│   ├── enterprise_tenant/                  Tenant isolation, SCIM 2.0 provisioning, role-based IAM
│   ├── pq_shield/                          Post-quantum ingress packet filter and shield
│   ├── vardhan_verifier/                   Standalone verification library
│   ├── pq_verify/                          Audit bundle verification CLI tool
│   ├── pacs008/                            ISO 20022 pacs.008 financial message schema validation
│   ├── pacs009/                            ISO 20022 pacs.009 financial institution transfer validation
│   ├── compliance_engine/                  Regulatory compliance rules and policy verification
│   ├── zero_knowledge/                     Rust zero-knowledge interface bindings
│   └── telemetry/                          Structured metrics, tracing, and audit telemetry
├── intelligence_plane/                     React 19 / Vite Enterprise UI and Autonomous Discovery Plane
│   ├── src/components/                     Interactive control plane, tenant management, audit visualizer
│   └── src/server/                         Discovery engines, surface analyzers, and artifact gates
├── platform_web/                           Static lightweight enterprise console (HTML/JS)
│   ├── test.mjs                            Console surface verification suite (13 surfaces, 17 APIs)
│   └── console.html                        Operational web contract interface
├── sdk/                                    First-party multi-language client SDKs
│   ├── ts/                                 TypeScript / JavaScript SDK
│   ├── python/                             Python SDK with full type annotations
│   ├── go/                                 Go client SDK
│   ├── java/                               Java SDK for enterprise banking integration
│   └── rust/                               Native Rust client library
├── sdks/                                   Internal SDK bindings consumed by the intelligence plane
├── zk_engine/                              Standalone Zero-Knowledge Engine (Node.js monorepo)
├── scripts/                                Acceptance testing, verification, and benchmark harnesses
│   ├── e2e_lifecycle_validation.py         Comprehensive 33/33 end-to-end lifecycle verification suite
│   ├── verify_live_runtime.py              Live real-time acceptance drill with strict TLS and dynamic auth
│   ├── check_enterprise_compose_secrets.sh Fail-closed validation guard for enterprise Compose secrets
│   ├── benchmark_representative_restore.sh Representative database restore benchmark (432 ms RTO)
│   ├── check_no_tracked_secrets.sh         Repository secret pattern scanner and git hygiene check
│   └── lab_demo_verify.sh                  Lab security and tamper verification harness (5/5 checks)
├── certs/                                  TLS trust anchors and local certificates
│   └── caddy_local_root.crt                CA trust anchor for live acceptance verification
├── docker/                                 Container definitions and base images
├── docker-compose.yml                      Canonical local development stack (Control Plane + Frontend)
├── docker-compose.enterprise.yml           Hardened enterprise staging Compose (fail-closed secrets, 127.0.0.1)
├── docs/                                   Architectural specifications and institutional assurance
│   ├── UK_INSTITUTIONAL_ASSURANCE_PACK.md  Comprehensive UK banking assurance pack and threat model
│   ├── COMMERCIAL_PRICING_MODEL.md         Authoritative multi-tier commercial pricing model
│   ├── PRODUCTION_READINESS_REPORT.md      Current verified production readiness status and evidence
│   ├── PRODUCTION_ACCEPTANCE_TESTS.md      Complete matrix of verified tests and commands
│   ├── PRODUCTION_READINESS_BASELINE.md    Candidate commit baseline and source inventory
│   ├── PRODUCTION_ARCHITECTURE.md          Runtime topology, trust boundaries, and component interaction
│   ├── OPEN_RISKS_AND_EXTERNAL_DEPENDENCIES.md Open risks, remediations, and remaining external blockers
│   └── commercial/                         Gated commercial engagement scopes and outreach dossiers
├── .github/workflows/                      Automated GitHub Actions CI/CD pipelines
│   ├── enterprise-release.yml              Enterprise release gate, signed packages, staging deployment
│   ├── correctness-perf.yml                Correctness, E2E lifecycle (33/33), benchmarks, resilience
│   ├── ci.yml                              Unified CI: multi-platform build, SDK contracts, ZK engine
│   ├── security.yml                        Supply chain security: audit, deny, SBOM, secret scanning
│   ├── platform-web-contract.yml           Frontend web contract and console sanity verification
│   └── clean-deployments.yml               Automated deployment pruning on main branch
├── qcore                                   Unified CLI entry point for local operations
└── Cargo.toml                              Workspace root manifest defining all Rust members
```

---

## Quick Start

```bash
# 1. Inspect local environment prerequisites
./qcore doctor

# 2. Build Rust binaries and prepare configurations
./qcore setup

# 3. Start the local stack via Docker Compose
./qcore up

# 4. Execute the complete test suite
./qcore test

# 5. Run the PoV security and benchmark suite
./qcore pov
```

### Local Service Endpoints

| Service | Port / URL | Description |
|---|---|---|
| Control Plane REST API | `http://127.0.0.1:8080` | Rust Axum API with JSON / HTTPS |
| Platform Health Endpoint | `http://127.0.0.1:8080/api/v1/platform/health` | Returns operational health and self-test telemetry |
| Intelligence Plane UI | `http://127.0.0.1:3000` | React / Vite enterprise console |
| Local Database | `127.0.0.1:5432` | PostgreSQL with distributed idempotency schema |

### `./qcore` Operational Commands

| Command | Description |
|---|---|
| `./qcore doctor` | Check OS, Rust, Docker, Node.js, Python, disk space, and port availability |
| `./qcore setup` | Compile Rust binaries, generate auth keys, and initialize directories |
| `./qcore up` | Start control plane and intelligence plane containers via Docker Compose |
| `./qcore status` | Query container health status and service endpoints |
| `./qcore logs [service]` | Stream service logs with optional component filtering |
| `./qcore test` | Execute format checks, Rust workspace tests, SDK checks, E2E lifecycle, and HA tests |
| `./qcore pov` | Execute Docker-based security, throughput, and cryptographic benchmark suite |
| `./qcore down` | Gracefully shut down services and clean up network resources |
| `./qcore clean` | Clean compilation artifacts while preserving database state |
| `./qcore clean --destructive` | Remove all build artifacts, volumes, and persisted state |

---

## Technical Specifications and Boundary Documentation

- [Readiness report](docs/PRODUCTION_READINESS_REPORT.md)
- [Baseline and inventory](docs/PRODUCTION_READINESS_BASELINE.md)
- [Actual architecture](docs/PRODUCTION_ARCHITECTURE.md)
- [Acceptance tests](docs/PRODUCTION_ACCEPTANCE_TESTS.md)
- [Open risks and external dependencies](docs/OPEN_RISKS_AND_EXTERNAL_DEPENDENCIES.md)
- [UK institutional assurance pack](docs/UK_INSTITUTIONAL_ASSURANCE_PACK.md)
- [Commercial pricing model](docs/COMMERCIAL_PRICING_MODEL.md)
- [Cryptographic design and key lifecycle](docs/CRYPTOGRAPHIC_DESIGN_AND_KEY_LIFECYCLE.md)
- [ISO 20022 validation and interoperability](docs/ISO20022_VALIDATION_AND_INTEROPERABILITY.md)
- [Idempotency and recovery](docs/IDEMPOTENCY_AND_RECOVERY.md)
- [Secure deployment runbook](docs/SECURE_DEPLOYMENT.md)
- [HA/DR runbook](docs/HA_DR_RUNBOOK.md)
- [Incident response plan](docs/INCIDENT_RESPONSE.md)

---

## Runtime Truth

Passing CI is one prerequisite to acceptance. Current limitations and fresh local results are recorded in the production readiness report. Passing automated CI does not constitute regulatory certification or production approval for live banking rails.

**Vardhan Technologies — BE DIFFERENT**

Proprietary. All rights reserved. © Vardhan Technologies.
