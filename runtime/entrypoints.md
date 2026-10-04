# Runtime Entry Points

## Primary Entry Points

### 1. Q-Core Receipt Service (Production Ingress)

**Binary:** `vardhan-receipt`
**Crate:** `backend/vardhan_receipt`
**File:** `src/main.rs`
**Function:** `pub async fn main()` → `process_transaction()`

```
HTTP POST /api/v1/seal  (port 8080)
  │
  ▼
QCoreValidationRequest {
  contract: VerifiedFindingContractJSON,
  evidence_store: Evidence[],
  run_context: IntelligenceRunContext
}
  │
  ▼
process_transaction()
  1. TrustBoundaryValidator::validate()  [22 checks]
  2. GatewayAuthorityEvaluator::evaluate()  [config-driven RBAC]
  3. VardhanTransaction::transition()
  4. VardhanSealedReceipt::seal()
  5. ML-DSA-87 + Ed25519 dual signature
  6. Audit ledger append
  7. Return VardhanSealedReceipt
```

### 2. Vardhan Intelligence Engine (Discovery Engine)

**Script:** `scripts/vardhan.ts`
**Package:** `intelligence_plane`

```
npx tsx scripts/vardhan.ts --company "<domain>"
  │
  ▼
VardhanSystemManager.researchCompany()
  │
  ├── SourceDiscoveryOrchestrator.discoverSources()
  │     └── ExternalSourceRegistry
  │
  ├── DeepProspectBuilder.buildProfile()
  │     └── ProviderRegistry
  │         ├── PublicDatasetProvider
  │         ├── GitHubProvider
  │         ├── PassiveReconProvider
  │         ├── SerperSearchProvider
  │         └── JobSignalProvider
  │
  ├── TechnicalProblemDetector.detect()
  │     └── DifferentialFindingEngine
  │
  ├── FindingVerificationEngine.verify()
  │     └── VerifiedFindingContract (TS)
  │
  ├── TrustBoundaryValidator.validate()  [22 checks]
  │
  └── QCoreSubmissionOrchestrator.submitFindings()
        └── QCoreIntegrationService.submitFinding()
              └── HTTP POST → Q-Core Gateway
```

**Key sub-entry points (scripts):**

| Script | Purpose |
|---|---|
| `scripts/vardhan.ts` | Main intelligence engine |
| `scripts/e2e_validation.ts` | E2E test harness (mock server + target) |
| `scripts/autonomous-run.ts` | Autonomous research run |
| `scripts/boundary-validation.ts` | Trust boundary validation |
| `scripts/real-hunt.ts` | Real-world hunting run |
| `scripts/growjo-hunt.ts` | Growjo provider hunt |
| `scripts/validate-live-web.ts` | Live web validation |
| `scripts/batchRun.ts` | Batch processing |

### 3. PQ Verify CLI

**Binary:** `pq_verify`
**Crate:** `backend/pq_verify`
**File:** `src/main.rs`

```
./target/release/pq_verify \
  --signature <hex> \
  --message <hex> \
  --public-key <hex>
```

### 4. Vendor Admin CLI

**Binary:** `vendor_admin`
**Crate:** `backend/core_crypto`
**File:** `src/bin/vendor_admin.rs`

### 5. ZK Engine API

**Package:** `zk_engine/packages/api`
**Entry:** `src/server.ts`
**Port:** 3000

```
pnpm --filter @proofcraft/zk-engine-api dev
# or
pnpm --filter @proofcraft/zk-engine-api start
```

## Internal Entry Points (Test/Validation)

| Entry Point | Path | Run With |
|---|---|---|
| Trust Boundary Tests | `tests/trust_boundary.test.ts` | `npx tsx tests/trust_boundary.test.ts` |
| E2E Validation | `scripts/e2e_validation.ts` | `npx tsx scripts/e2e_validation.ts` |
| Production Orchestration | `tests/test_production_orchestration.ts` | `npx tsx tests/test_production_orchestration.ts` |
| Negative Path Tests | `tests/test_negative_paths.ts` | `npx tsx tests/test_negative_paths.ts` |
| Adapter Determinism | `tests/test_adapter_determinism.ts` | `npx tsx tests/test_adapter_determinism.ts` |
| Adapter Negative | `tests/test_adapter_negative.ts` | `npx tsx tests/test_adapter_negative.ts` |

## Configuration Entry Points

| Config File | Format | Loaded By |
|---|---|---|
| `auth_config.json` | JSON | `vardhan-receipt` (AuthConfigLoader) |
| `VARDHAN_ENV` | env var | All Rust crates |
| `VARDHAN_PRODUCTION_KEK` | env var | `vardhan_keystore` (production KEK) |
| `VARDHAN_KMS_PROVIDER` | env var | `vardhan_keystore` (KMS provider ID) |
| `VARDHAN_BINARY_HASH` | env var | `core_crypto::anti_tamper` (production binary integrity) |
| `VARDHAN_AUTH_CONFIG_PATH` | env var | `auth_config.rs` (explicit config path) |
