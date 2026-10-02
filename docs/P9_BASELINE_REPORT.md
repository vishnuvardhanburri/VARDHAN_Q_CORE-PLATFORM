---
schema_version: "1.0"
generated_at: "2026-09-19T13:48:09+05:30"
generated_by: "P9 → P10 baseline automation"
system: "VARDHAN_QUANTUM"
machine: "darwin/arm64"
---

# VARDHAN QUANTUM — BASELINE REPORT

## 1. Frozen Reference Points

| Milestone | Tag | Commit | SHA256 (evidence) |
|---|---|---|---|
| P7.3 | vP7.3-frozen | fdba5fdb6f709a77ed8a6aa40aceb167ca716469 | dca898d9c757a12c33e807b2d61b2b05a1744d251c12b20a729fe2c06787f573 |
| P8  | vP8-frozen   | 6b43fd751c9df3539c4c9f3f104b3272c57a84bc | (see P8_EVIDENCE.md) |
| P9  | vP9-frozen   | 4c503f8fda5551920552b24e737bd8bef160532c | — |

## 2. Current Repository State

| Field | Value |
|---|---|
| Branch | main |
| HEAD | 3285b7bb329fb06fbdbbc34ba8237b7948628cf6 |
| vP8-frozen | ancestor of HEAD ✅ |
| vP9-frozen | 4c503f8f (linear from vP8-frozen) ✅ |
| Working tree | Clean ✅ |
| P7.3_EVIDENCE.md SHA256 | dca898d9c757a12c33e807b2d61b2b05a1744d251c12b20a729fe2c06787f573 ✅ |
| P8 source diff (vP8-frozen → HEAD) | NONE ✅ |

## 3. Workspace Inventory

### Backend crates (18 workspace members + 3 non-members)

| Crate | Path | Classification | Public API stability |
|---|---|---|---|
| core_crypto | backend/core_crypto | IMPLEMENTED | ML-KEM-1024, ML-DSA-87, BLAKE3, HKDF-SHA256, AES-256-GCM, Argon2id |
| proxy_engine | backend/proxy_engine | IMPLEMENTED | AeadTransport, QuantumProxyListener, MAX_FRAME_SIZE=65536 |
| audit_ledger | backend/audit_ledger | IMPLEMENTED | LedgerEntry, LedgerWriter, SegmentedLedgerWriter, CheckpointWriter, scan_ledger_segment() |
| ha_cluster | backend/ha_cluster | IMPLEMENTED | RaftNode, RaftNetworkListener, RaftPeerManager, ClusterMembership, Checkpoint |
| pq_shield | backend/pq_shield | IMPLEMENTED | IngressShield, AdminState, run_admin_server(), build_admin_router() |
| auth_service | backend/auth_service | IMPLEMENTED / NODE_LOCAL | emit_admin_audit(), login, logout, session, API keys, RBAC |
| ledger_sync | backend/ledger_sync | PARTIALLY_IMPLEMENTED | LedgerBlock, MerkleLedger, LedgerSyncChannel |
| ledger_persistence | backend/ledger_persistence | PARTIALLY_IMPLEMENTED | DiskLedgerWal |
| quantum_node | backend/quantum_node | PARTIALLY_IMPLEMENTED / TEST_ONLY | CLI (--bind, --peers, --data-dir, --genesis, --config) |
| quantum_network | backend/quantum_network | PARTIALLY_IMPLEMENTED | GossipEngine, PeerRegistry, GossipMessage |
| quantum_tui | backend/quantum_tui | IMPLEMENTED | Terminal UI dashboard |
| enterprise_tenant | backend/enterprise_tenant | SIMULATED | In-memory tenant/quota tracking |
| saas_metering | backend/saas_metering | SIMULATED | In-memory usage metering |
| orchestration_ai | backend/orchestration_ai | MOCKED | Background loop simulating AI traffic |
| poc_auditor | backend/poc_auditor | TEST_ONLY | PDF audit report generator |
| pq_verify | backend/pq_verify | TEST_ONLY (BROKEN) | main.rs:230 checkpoints_verified before definition |
| load_tester | backend/load_tester | TEST_ONLY | Synthetic traffic generator |
| mock_upstream | backend/mock_upstream | TEST_ONLY | Mock HTTP/TCP backend |
| verifier | backend/verifier | TEST_ONLY | Compliance assertions |

### Non-workspace crates
| Crate | Path | Status |
|---|---|---|
| data | backend/data | data utilities |
| ebpf_engine | backend/ebpf_engine | UNUSED (not in workspace) |

## 4. Existing Event/Audit Infrastructure

### Current audit event types (emitted by auth_service)
- `LoginFailed`
- `LoginSucceeded`
- `Logout`
- `ProfileUpdated`
- (extendable)

### Existing event infrastructure
- `auth_service/src/audit.rs`: `emit_admin_audit()`, `generate_event_id()`, `now_ms()`, `blake3_hex()`
- Event format: JSON object with fields: `event_id`, `timestamp_ms`, `event_type`, `operation`, `actor`, `actor_hash`, `node_id`, `result`, `request_id`, `details`
- Events are written to `audit_ledger::LedgerWriter` (signed with ML-DSA-87, BLAKE3 hash chain)

### Existing ledger infrastructure
- `audit_ledger::LedgerEntry`: schema_version, seq, timestamp_ms, prev_hash, event, signature, signer_pub_fingerprint
- `audit_ledger::LedgerWriter`: append-only JSONL writer with ML-DSA signatures
- `audit_ledger::SegmentedLedgerWriter`: segment rotation at 10,000 entries / 10 MB
- `audit_ledger::CheckpointWriter`: periodic Merkle-root checkpoints
- `ha_cluster::LedgerApplier`: applies committed Raft log entries to the ledger

## 5. Existing Enterprise/Identity Model

### Identities
- `core_crypto::QuantumNodeIdentity`: ML-DSA-87 key pair, node identity
- `auth_service`: Users (Argon2id passwords), API keys (BLAKE3 hashed), Sessions (DashMap)
- `ha_cluster::NodeId`: cluster node identifier
- `ha_cluster::ClusterNode`: node metadata (addr, hb_port, raft_port, state, region)
- `ha_cluster::ClusterMembership`: thread-safe membership table with region awareness

### RBAC
- `auth_service::Role`, `auth_service::Permission`
- `auth_service::authorization::AuthenticatedUser`

### Entities
- No unified enterprise model exists yet
- `enterprise_tenant`: simulated multi-tenant quota tracking (in-memory)
- No dependency graph between entities exists yet

## 6. Existing Crypto Infrastructure

### Primitives (all standardized)
| Primitive | Algorithm | FIPS |
|---|---|---|
| KEM | ML-KEM-1024 | FIPS 203 |
| Signature | ML-DSA-87 | FIPS 204 |
| Symmetric | AES-256-GCM | NIST SP 800-38D |
| Hash | BLAKE3 | — |
| KDF | HKDF-SHA256 | RFC 5869 |
| Password hash | Argon2id (m=65536, t=3, p=4, salt=32B) | RFC 9106 |

### Key lifecycle
- `core_crypto::QuantumNodeIdentity::rotate_signing_key()` — P8-003 fixed
- `KeyTransitionRecord` struct with old/new fingerprints, bytes, transition sig
- `KeyTransitionPayload` for signing transitions

## 7. Existing Transport

### AEAD Transport (proxy_engine)
- `AeadTransport`: AES-256-GCM, MAX_FRAME_SIZE=65536, 4-byte length header + 12-byte nonce + ciphertext + 16-byte GCM tag
- `run_initiator()`, `run_responder()`: PQ handshake establishing session keys
- `SUPPORTED_VERSIONS = &[1, 2]`, `CURRENT_VERSION = 2`

### Raft Transport (ha_cluster)
- `RaftNetworkListener`: TCP listener with PQ handshake + AEAD transport
- `RaftPeerManager`: TCP client with PQ handshake + AEAD transport
- Protocol: version check, receiver identity check, sender identity check

## 8. Existing Control Plane

### Raft (ha_cluster)
- `RaftNode`: leader election, log replication, persistence
- `RaftConfig`: election_timeout_min/max_ms, heartbeat_interval_ms, persist_on_submit
- `RaftRole`: Leader, Follower, Candidate
- `LedgerApplier`: applies committed entries to audit ledger

### Cluster
- `ClusterMembership`: region-aware node tracking
- `HeartbeatFrame`: heartbeat protocol with region propagation
- Drain/Dead/Healthy/Degraded states

## 9. Existing Runtime

### P9 Container Hardening
- Dockerfile.p9: rust:1.98.1-slim-bookworm, non-root UID 10001, distroless runtime
- docker-compose.p9.yml: 3-node Raft, independent PVCs, mock upstream
- Runtime policy: read_only FS, cap_drop ALL, no-new-privileges, seccomp

## 10. Gaps Identified (for Layer 6 planning)

### Critical gaps for Event Fabric + Enterprise Model
1. **No unified event schema** — auth_service emits ad-hoc JSON objects
2. **No enterprise model** — entities (User, Service, Application, Asset) exist in silos
3. **No dependency graph** — relationships between entities not modeled
4. **No event normalization layer** — each subsystem emits its own format
5. **No schema versioning** — event_schema exists only in audit_ledger
6. **No tenant_id** — no multi-tenant event isolation
7. **No evidence_ref** — events not linked to verifiable evidence
8. **No correlation_id** — cross-service event correlation not established

### Existing building blocks we can leverage
1. `audit_ledger::LedgerWriter` — append-only signed ledger ✅
2. `core_crypto::QuantumNodeIdentity` — cryptographic identity ✅
3. `ha_cluster::ClusterMembership` + `NodeId` — cluster identity ✅
4. `auth_service::emit_admin_audit()` — existing audit emission pattern ✅
5. `blake3` dependency — for event IDs and hashing ✅
6. `serde`/`serde_json` — for serialization ✅
7. `serde_cbor` (core_crypto re-export) — available if needed ✅

## 11. Test Infrastructure

### Existing test suites (all pass at vP9-frozen)
| Suite | Tests | Mode | Notes |
|---|---|---|---|
| raft_p8_byzantine | 8/8 | debug | P8.1 Byzantine faults |
| raft_p8_transport | 9/9 | debug | P8.2-3 AEAD transport |
| raft_p8_partition | 3/3 | debug | P8.4 network partition |
| raft_p8_crash_corruption | 10/10 | debug | P8.5-6 crash/corruption |
| raft_p8_key_compromise | 4+2/6 | debug | 2 expected-fail (P8-003/004) |
| raft_p8_resource_exhaustion | 7/7 | debug | P8.7 resource exhaustion |
| raft_p8_soak | 1/1 | debug | P8.8 soak |
| raft_p8_segment_retention | 13/13 | debug | P8.12 ledger rotation |
| raft_p8_regression_p8003 | 4/4 | debug | P8-003 key rotation |
| raft_p8_regression_p8004 | 4/4 | debug | P8-004 signing order |
| raft_l3_1_hardening | 12/12 | debug | P7.3.1 timing-sensitive |
| raft_l3_2_checkpoints | 27/27 | debug | P7.3.2 timing-sensitive |
| raft_l3_replication | 11/11 | debug | P7.3 replication |
| raft_l3_validation | 1/1 | debug | P7.3 validation |
| raft_l3_failure | 14/14 | debug | P7.3 failure |
| audit_ledger | 4/4 | debug | Ledger unit tests |
| **Total** | **65/65 P8 + 65/65 P7.3** | | 2 expected-fail |

## 12. Build Constraints

| Constraint | Status |
|---|---|
| pq_verify compilation | BROKEN (P7.3 pre-existing, main.rs:230) |
| Cargo.lock crates | 509 |
| Rust version | 1.98.1 |
| workspace resolver | 2 |
