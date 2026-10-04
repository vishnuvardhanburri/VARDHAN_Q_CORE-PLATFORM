# Runtime Services

## Service Inventory

| # | Name | Language | Package/Crate | Entry Point | Purpose |
|---|---|---|---|---|---|
| 1 | vardhan-receipt | Rust | `backend/vardhan_receipt` | `src/main.rs::main()` | Q-Core gateway: validates VerifiedFindingContract, enforces authority, transitions transaction state machine, seals receipts with ML-DSA-87 + Ed25519 |
| 2 | pq_verify | Rust | `backend/pq_verify` | `src/main.rs::main()` | Post-quantum signature verification CLI |
| 3 | vendor_admin | Rust | `backend/core_crypto` | `src/bin/vendor_admin.rs::main()` | Vendor administration tool for crypto operations |
| 4 | vardhan-intelligence | TypeScript | `intelligence_plane/` | `scripts/vardhan.ts` | Main intelligence research engine |
| 5 | zk-engine-api | TypeScript | `zk_engine/packages/api` | `src/server.ts` | ZK engine API server |
| 6 | zk-engine-cli | TypeScript | `zk_engine/packages/cli` | CLI tool | ZK proof generation/verification CLI |

## Worker / Background Processes

| Name | Language | Entry Point | Schedule | Purpose |
|---|---|---|---|---|
| SourceDiscoveryOrchestrator | TS | `intelligence_plane/src/server/SourceDiscoveryOrchestrator.ts` | Continuous | Discovers new external data sources |
| FanoutResearchExecutor | TS | `intelligence_plane/src/server/FanoutResearchExecutor.ts` | Per-company | Executes research fanout per target |
| AutonomousLoopManager | TS | `intelligence_plane/src/server/AutonomousLoopManager.ts` | Continuous | Manages autonomous research loops |

## API Services

| Service | Protocol | Port | Auth | Purpose |
|---|---|---|---|---|
| Q-Core Gateway | HTTP/REST | 8080 | API key | `/api/v1/seal` endpoint for sealing findings |
| ZK Engine API | HTTP/REST | 3000 | None (internal) | ZK proof generation API |

## CLI Tools

| Tool | Package | Entry Point | Purpose |
|---|---|---|---|
| `vardhan` | `intelligence_plane` | `scripts/vardhan.ts` | Run the intelligence engine |
| `pq_verify` | `backend/pq_verify` | `src/main.rs` | Verify PQ signatures |
| `vendor_admin` | `backend/core_crypto` | `src/bin/vendor_admin.rs` | Crypto vendor administration |

## Startup Commands

```bash
# Q-Core Receipt Service (production)
VARDHAN_ENV=production VARDHAN_PRODUCTION_KEK=<kms-provided-kek> \
  VARDHAN_KMS_PROVIDER=aws-kms \
  ./target/release/vardhan-receipt --config /etc/vardhan/auth_config.json

# Vardhan Intelligence (research)
cd intelligence_plane && npx tsx scripts/vardhan.ts --company "acme.com"

# PQ Verify
./target/release/pq_verify --signature <hex> --message <hex>

# ZK Engine
cd zk_engine && pnpm --filter @proofcraft/zk-engine-api dev
```

## Health Check Endpoints

| Service | Endpoint | Check |
|---|---|---|
| Q-Core Gateway | N/A (process-level) | Process alive, port 8080 listening |
| ZK Engine API | `/health` | Database connectivity |
| Intelligence Plane | N/A (batch) | Script exit code |
