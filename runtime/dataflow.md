# Runtime Dataflow

## End-to-End Flow: External Observation → Q-Core Sealing

### Step 1: External Intelligence Collection

```
┌─────────────────────┐
│ External Sources    │
│ - Public DNS        │
│ - TLS certificates  │
│ - Cloud asset APIs  │
│ - GitHub/GitLab     │
│ - Shodan/Censys     │
│ - Public breaches   │
│ - Threat feeds      │
└────────┬────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ LivePublicObservationProvider   │
│ (TS)                            │
│ - fetch_observation()           │
│ - Stores raw + normalized       │
└────────┬────────────┬───────────┘
         │            │
         ▼            ▼
┌─────────────────┐  ┌──────────────────┐
│ EvidenceLedger  │  │ EvidenceRef      │
│ (TS)            │  │ - evidence_id    │
│ - hashContent() │  │ - public_url     │
│ - full SHA-256  │  │ - content_hash   │
│ - append-only   │  │ - origin         │
└─────────────────┘  └──────────────────┘
```

### Step 2: Intelligence Analysis & Finding Generation

```
Observation Store
         │
         ▼
┌─────────────────────────────────┐
│ TechnicalProblemDetector        │
│ (TS)                            │
│ - Detects anomalies             │
│ - Differential finding engine   │
│ - Confidence scoring            │
└────────┬────────────┬───────────┘
         │            │
         ▼            ▼
┌─────────────────┐  ┌──────────────────┐
│ ProblemFinding  │  │ ExpectationEngine│
│ - technical_area │ │ - expected vs   │
│ - differential   │ │   observed      │
│ - materiality    │ │ - mismatch      │
│ - evidence_refs  │ │ - verified      │
└─────────────────┘  └──────────────────┘
```

### Step 3: Verification (Intelligence Plane)

```
ProblemFinding
         │
         ▼
┌───────────────────────────────────────┐
│ FindingVerificationEngine (TS)        │
│ - Verifies finding legitimacy         │
│ - Produces verified finding           │
│ - Generates evidence commitments      │
└────────┬──────────────────────────────┘
         │
         ▼
┌───────────────────────────────────────┐
│ VerifiedFindingContract (TS)          │
│ - 22 trust boundary checks            │
│ - Full SHA-256 evidence hashes        │
│ - Provenance chain                    │
│ - Authorization context               │
└────────┬──────────────────────────────┘
```

### Step 4: Q-Core Submission & Sealing

```
VerifiedFindingContract
         │
         ▼
┌───────────────────────────────────────┐
│ QCoreIntegrationService (TS)            │
│ - Runs TrustBoundaryValidator (22)    │
│ - HTTP POST to Q-Core Gateway         │
│   /api/v1/seal                        │
└────────┬──────────────────────────────┘
         │
         ▼
┌───────────────────────────────────────┐
│ vardhan-receipt (Rust)                │
│ process_transaction():                │
│  1. TrustBoundaryValidator (22 chks)  │
│  2. GatewayAuthorityEvaluator         │
│  3. VardhanTransaction::transition()   │
│  4. VardhanSealedReceipt sealing      │
│  5. ML-DSA-87 + Ed25519 signing       │
│  6. Audit ledger append               │
└────────┬──────────────────────────────┘
         │
         ▼
┌───────────────────────────────────────┐
│ Audit Ledger (append-only JSONL)      │
│ - prev_hash chain                     │
│ - ML-DSA-87 signature                 │
└────────┬──────────────────────────────┘
         │
         ▼
┌───────────────────────────────────────┐
│ VardhanVerifier (Rust)                │
│ - Independent re-validation           │
│ - canonical_payload() 10-field check  │
│ - ML-DSA-87 signature verification    │
└───────────────────────────────────────┘
```

## Internal Intelligence Flow

```
Asset Inventory → Internal Sources
          │
          ▼
┌─────────────────────────┐
│ VardhanSystemManager    │
│ - Coordinates discovery │
│ - Manages research      │
│   budget & state        │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│ DeepProspectBuilder     │
│ - Enriches companies    │
│ - Builds deep profiles  │
└─────────────────────────┘
```

## Intelligence → Q-Core Data Contracts

| Contract | Owner | Fields |
|---|---|---|
| `VerifiedFindingContract` | Intelligence Plane (TS) | 14 top-level fields, 22 trust boundary checks |
| `EvidenceRef` | Intelligence Plane (TS) | evidence_id, public_url, content_hash (SHA-256), temporal_status, origin |
| `VardhanSealedReceipt` | Q-Core (Rust) | 10-field canonical payload, dual signature (ML-DSA-87 + Ed25519) |
| `QCoreValidationRequest` | Q-Core (Rust) | contract, evidence_store, run_context |

## Cross-Tier Interfaces

| Direction | Interface | Protocol | Security |
|---|---|---|---|
| Intelligence → Q-Core | `QCoreIntegrationService.submitFinding()` | HTTP/REST POST `/api/v1/seal` | TLS 1.3 (caller responsibility) |
| Q-Core → Ledger | Local file I/O | JSON Lines append | Append-only, BLAKE3 chaining |
| Q-Core → Verifier | Local function call | In-process | `VardhanVerifier::verify()` |
| Crypto → KMS | Feature-gated | `aws-sdk-kms` | Production only, fail-closed |
