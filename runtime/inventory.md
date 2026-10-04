# Runtime Inventory

## Complete Inventory

### Rust Backend Crates (31 in workspace)

| Crate | Classification | Production? | Owner Module |
|---|---|---|---|
| `core_crypto` | Core crypto (ML-KEM, ML-DSA, AER-KEP-Q) | ✅ Production | Crypto subsystem |
| `vardhan_receipt` | Q-Core gateway, receipt sealing | ✅ Production | Q-Core Transaction Engine |
| `vardhan_verifier` | Independent receipt verification | ✅ Production | Q-Core Verification |
| `vardhan_keystore` | Key management & protection | ✅ Production | Q-Core Cryptography |
| `vardhan_transaction` | Transaction state machine | ✅ Production | Q-Core Transactions |
| `vardhan_state` | Tenant-scoped state management | ✅ Production | Q-Core State |
| `vardhan_model` | Type definitions & data model | ✅ Production | Core model |
| `vardhan_idempotency` | Persistent idempotency | ✅ Production | Q-Core Idempotency |
| `audit_ledger` | Append-only audit trail | ✅ Production | Q-Core Ledger |
| `authority_gate` | Authority & RBAC | ✅ Production | Q-Core Authority |
| `enterprise_tenant` | Enterprise control plane | ✅ Production | Q-Core Enterprise |
| `ledger_sync` | Merkle-backed ledger | ✅ Production | Q-Core Ledger |
| `ledger_persistence` | Encrypted persistence | ✅ Production | Storage layer |
| `proxy_engine` | PQ session proxy | ✅ Production | Crypto transport |
| `pq_shield` | PQ shield operations | ✅ Production | Crypto shielding |
| `pq_verify` | PQ verification CLI | ✅ Production | Tooling |
| `ha_cluster` | HA cluster (raft) | ✅ Production | Resilience |
| `hybrid_core` | Hybrid crypto simulation | ⚠️ Simulation | Crypto (non-prod) |
| `poc_auditor` | PoC audit tooling | ❌ Experimental | Tooling |
| `load_tester` | Load testing | ❌ Test | Testing |
| `mock_upstream` | Mock upstream server | ❌ Test | Testing |
| `verifier` | Receipt verification | ✅ Production | Q-Core Verification |
| `decision_twin` | Decision twin | ⚠️ Simulation | Intelligence support |
| `orchestration_ai` | AI orchestration | ⚠️ Experimental | Intelligence support |
| `quantum_node` | Quantum node simulation | ⚠️ Simulation | Crypto (non-prod) |
| `quantum_network` | Quantum network simulation | ⚠️ Simulation | Crypto (non-prod) |
| `quantum_tui` | Quantum terminal UI | ⚠️ Simulation | Tooling |
| `auth_service` | Authentication service | ⚠️ Experimental | Security |
| `enterprise_tenant` | Enterprise platform | ✅ Production | Q-Core Enterprise |
| `saas_metering` | Metering | ✅ Production | Enterprise |
| `ebpf_engine/ebpf_user` | eBPF user-space | ✅ Production (Linux) | Observability |

### eBPF Kernel Module

| Path | Classification | Production? |
|---|---|---|
| `backend/ebpf_engine/ebpf_kernel` | eBPF kernel module | ✅ Production (Linux only, not in workspace) |

### TypeScript Projects

| Project | Classification | Production? | Entry Point |
|---|---|---|---|
| `intelligence_plane` | Vardhan Intelligence engine | ✅ Production | `scripts/vardhan.ts` |
| `zk_engine` | Zero-knowledge proof engine | ✅ Production | `packages/api/src/server.ts` |

### SDK

| SDK | Language | Production? |
|---|---|---|
| `sdks/typescript/vardhan-qcore` | TypeScript | ✅ Production |
| `sdks/python/vardhan_qcore` | Python | ✅ Production |

### Smart Contracts

| Contract | Blockchain | Production? |
|---|---|---|
| `contracts/VardhanZKVerifier.sol` | Ethereum/EVM | ✅ Production |

### Shell Scripts

| Script | Classification |
|---|---|
| `scripts/aws_deploy_region.sh` | Production (deployment) |
| `scripts/deploy_edge_node.sh` | Production (deployment) |
| `scripts/run_cluster.sh` | Production (HA cluster) |
| `scripts/test_p3_kms_gate.sh` | Test |
| `scripts/ciso_demo.sh` | Demo |
| `scripts/ciso_wireshark_demo.sh` | Demo |
| `scripts/e2e_vertical_slice.sh` | Test |
| `scripts/p2_verify_gate.sh` | Test |
| `scripts/p5_adversarial_test.py` | Test |
| `scripts/p6_distributed_test.py` | Test |
| `scripts/patch_handshake.py` | Test |
| `scripts/realtime_traffic_test.py` | Test |

### CI/CD Workflows

| Workflow | Purpose | Production? |
|---|---|---|
| `.github/workflows/security.yml` | Security scanning | ✅ Production |
| `.github/workflows/enterprise-release.yml` | Enterprise release | ✅ Production |
| `.github/workflows/sovereign-ci.yml` | Sovereign CI | ✅ Production |

### Runtime Files

| File | Purpose |
|---|---|
| `runtime/architecture.md` | Platform architecture |
| `runtime/inventory.md` | This file — complete inventory |
| `runtime/dependencies.md` | Dependency graph |
| `runtime/entrypoints.md` | Entry points |
| `runtime/configuration.md` | Configuration reference |
| `runtime/health.md` | Health checks |
| `runtime/errors.md` | Error classification |
| `runtime/tests.md` | Test inventory |
| `runtime/status.md` | Status summary |
| `runtime/report.md` | Report |
| `runtime/phase7-assessment.md` | Phase 7 security assessment |
| `runtime/phase7-remediation.md` | Phase 7 remediation record |
| `runtime/engineering-status.md` | Engineering status |

### Documentation

| Path | Purpose |
|---|---|
| `docs/enterprise/` | Enterprise documentation |
| `docs/vardhan-intelligence/` | (to be created) Intelligence architecture |
| `docs/qcore/` | (to be created) Q-Core architecture |
| `docs/industries/` | (to be created) Industry planes |
| `VARDHAN_*.md` (root) | Various architecture docs |

### Docker

| File | Purpose |
|---|---|
| `docker/Dockerfile.ebpf` | eBPF kernel module build |

### Configuration

| File | Purpose |
|---|---|
| `Cargo.toml` | Rust workspace root |
| `Cargo.lock` | Pinned dependency versions |
| `deny.toml` | cargo-deny policy |
| `.cargo/audit.toml` | cargo-audit ignore list |
| `bom.json` | SBOM (CycloneDX) |
| `.github/workflows/security.yml` | Security CI |

## Environment Variables

| Variable | Component | Production Required? |
|---|---|---|
| `VARDHAN_ENV` | All Rust crates, TS | No (defaults to development) |
| `VARDHAN_PRODUCTION_KEK` | vardhan_keystore | ✅ Yes |
| `VARDHAN_KMS_PROVIDER` | vardhan_keystore | ✅ Yes |
| `VARDHAN_AUTH_CONFIG_PATH` | vardhan_receipt | ✅ Yes |
| `VARDHAN_BINARY_HASH` | core_crypto | ✅ Yes |
| `VARDHAN_IDEMPOTENCY_DIR` | All | No (has default) |
| `GROQ_API_KEY` | intelligence_plane | Yes (for LLM) |
| `SERPER_API_KEY` | intelligence_plane | Yes (for web search) |
| `GITHUB_TOKEN` | intelligence_plane | No (rate limit) |
