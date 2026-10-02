# VARDHAN QUANTUM — BACKEND ARCHITECTURE & TRUTH AUDIT

**Audit Date**: September 2026  
**Auditor**: Antigravity Forensic Engineering  
**Target Repository**: `vishnuvardhanburri/vardhan-quantum`  
**Target Branch**: `main`  
**Commit SHA Audited**: `d946dd572affb16b66d9686b29a29e944d35241e`  
**Working Tree Status**: Clean / Reorganized into Monorepo (`backend/`, `frontend/`, `deploy_pack/`, `docs/`, `scripts/`)  

---

## 1. Executive Summary

This document establishes the forensic technical reality of the **Vardhan Quantum** codebase. Every conclusion in this report is derived strictly from static code analysis, execution traces, cryptographic validation, and test suite execution against commit `d946dd5`.

### Key Conclusions:
1. **Cryptographic Core (`core_crypto`, `proxy_engine`, `audit_ledger`)**: **`IMPLEMENTED` & `VERIFIED`**
   - Post-quantum primitives (FIPS 203 ML-KEM-1024, FIPS 204 ML-DSA-87), symmetric re-encryption (AES-256-GCM), streaming integrity (BLAKE3), and HKDF-SHA256 key derivation are fully implemented with zero mocking.
2. **Authentication & Identity (`auth_service`)**: **`IMPLEMENTED` / `NODE_LOCAL`**
   - Password hashing uses memory-hard Argon2id ($m=65536, t=3, p=4$) with dummy sentinel hashes against username enumeration. API keys are hashed with BLAKE3 and persisted in an embedded Sled key-value database.
3. **Session Store & Resource Profile (`auth_service`)**: **`IMPLEMENTED` / `RISK`**
   - Sessions are stored in-memory using concurrent `DashMap` structures. Active sessions are destroyed upon process restart. The `revoked` tombstone map lacks TTL/capacity bounds, representing an unbounded memory growth risk over long lifecycles.
4. **Settings Dynamic Management**: **`PERSISTED_ONLY`**
   - Settings mutations via `PUT /api/v1/settings` successfully validate and persist to Sled database (`settings:v1`), but running server components in `pq_shield`, `auth_service`, and `ha_cluster` continue utilizing static constants / startup parameters.
5. **Consensus & Multi-Node State (`ha_cluster`)**: **`IMPLEMENTED` / `NODE_LOCAL` Application State**
   - Raft election, log replication, and AEAD transport are fully implemented and verified in isolation. However, application-level state (User accounts, Session entries, API keys, Settings, and Audit Ledger) is strictly **`NODE_LOCAL`** and is not replicated across cluster nodes via the Raft log.
6. **Frontend Dashboard (`frontend/`)**: **`BACKEND_DERIVED`**
   - Next.js 14 glassmorphic interface connects to `pq_shield` via a secure server-side Node.js reverse proxy (`frontend/app/api/admin/[...path]/route.js`). Metrics, cluster peers, Raft status, ledger entries, sessions, profile, and API key management are live backend-derived endpoints.

---

## 2. Comprehensive Repository Inventory

The backend workspace contains 20 crates in `backend/`, plus the Next.js frontend in `frontend/` and deployment bundles in `deploy_pack/`.

| Crate / Component | Path | Classification Status | Architectural Role | Key Dependencies |
| :--- | :--- | :--- | :--- | :--- |
| **`core_crypto`** | `backend/core_crypto` | `IMPLEMENTED` | FIPS 203/204 PQ primitives, AES-256-GCM, BLAKE3, HKDF | `pqcrypto-kyber`, `pqcrypto-dilithium`, `aes-gcm`, `blake3`, `hkdf` |
| **`proxy_engine`** | `backend/proxy_engine` | `IMPLEMENTED` | AEAD wire framing, Shannon entropy, stream re-encryption | `tokio`, `bytes`, `core_crypto`, `parking_lot` |
| **`audit_ledger`** | `backend/audit_ledger` | `IMPLEMENTED` | Append-only Merkle-linked JSONL ledger, ML-DSA-87 signed | `core_crypto`, `serde_json`, `chrono`, `tokio` |
| **`auth_service`** | `backend/auth_service` | `IMPLEMENTED` / `NODE_LOCAL` | Argon2id auth, Sled store, DashMap sessions, RBAC | `argon2`, `sled`, `dashmap`, `subtle`, `rand`, `audit_ledger` |
| **`pq_shield`** | `backend/pq_shield` | `IMPLEMENTED` / `NODE_LOCAL` | Axum HTTP/TLS gateway, Admin REST API, SSE telemetry | `axum`, `tokio`, `tower-http`, `prometheus`, `auth_service` |
| **`ha_cluster`** | `backend/ha_cluster` | `IMPLEMENTED` | Raft consensus engine, peer AEAD transport, heartbeat | `tokio`, `core_crypto`, `proxy_engine`, `parking_lot` |
| **`quantum_node`** | `backend/quantum_node` | `PARTIALLY_IMPLEMENTED` / `TEST_ONLY` | Standalone P2P node binary with disk WAL engine | `tokio`, `clap`, `ledger_sync`, `ledger_persistence` |
| **`ledger_persistence`**| `backend/ledger_persistence` | `PARTIALLY_IMPLEMENTED` | Binary disk WAL persistence format | `tokio`, `byteorder`, `crc32fast` |
| **`ledger_sync`** | `backend/ledger_sync` | `PARTIALLY_IMPLEMENTED` | Binary TCP ledger replication | `tokio`, `ledger_persistence` |
| **`quantum_network`** | `backend/quantum_network` | `PARTIALLY_IMPLEMENTED` | Peer discovery abstractions & gossip protocol | `tokio`, `socket2` |
| **`quantum_tui`** | `backend/quantum_tui` | `IMPLEMENTED` | Terminal UI monitoring dashboard | `ratatui`, `crossterm`, `tokio` |
| **`enterprise_tenant`**| `backend/enterprise_tenant` | `SIMULATED` / `PARTIALLY_IMPLEMENTED` | Multi-tenant quota & rate tracking in-memory | `dashmap`, `tokio` |
| **`saas_metering`** | `backend/saas_metering` | `SIMULATED` / `PARTIALLY_IMPLEMENTED` | In-memory usage meter & cost computation | `dashmap`, `serde` |
| **`orchestration_ai`** | `backend/orchestration_ai` | `MOCKED` / `SIMULATED` | Background loop simulating AI traffic rebalancing | `tokio` |
| **`poc_auditor`** | `backend/poc_auditor` | `TEST_ONLY` | CLI tool generating CISO PDF audit reports | `printpdf` |
| **`pq_verify`** | `backend/pq_verify` | `TEST_ONLY` | Benchmark and correctness harness for crypto | `criterion`, `core_crypto` |
| **`load_tester`** | `backend/load_tester` | `TEST_ONLY` | Synthetic traffic generator for proxy load | `tokio`, `reqwest` |
| **`mock_upstream`** | `backend/mock_upstream` | `TEST_ONLY` | In-process mock HTTP/TCP backend service | `tokio`, `axum` |
| **`verifier`** | `backend/verifier` | `TEST_ONLY` | Compliance validation assertions | `tokio` |
| **`ebpf_engine`** | `backend/ebpf_engine` | `TEST_ONLY` / `UNUSED` | Kernel bypass eBPF code (not in root workspace) | `aya`, `aya-bpf` |
| **`frontend`** | `frontend/` | `BACKEND_DERIVED` | Next.js 14 glassmorphic administrative dashboard | `next`, `react`, `@mui/material`, `emotion` |
| **`deploy_pack`** | `deploy_pack/` | `IMPLEMENTED` | Multi-stage Dockerfile, Docker Compose, systemd | Docker, Nginx, Systemd |

---

## 3. Authentication Forensic Audit

### Execution Flow & Cryptographic Parameters
Located in [`backend/auth_service/src/credentials.rs`](file:///Users/vishnuvardhanburri/vardhan-quantum-proxy/backend/auth_service/src/credentials.rs).

1. **Password Hashing (Argon2id)**:
   - **Algorithm**: `Argon2id` (v0x13).
   - **Memory ($m$)**: $65,536\text{ KiB}$ ($64\text{ MiB}$).
   - **Iterations ($t$)**: $3\text{ passes}$.
   - **Parallelism ($p$)**: $4\text{ threads/lanes}$.
   - **Salt**: 32 cryptographically secure random bytes generated via `rand::rngs::OsRng`.
   - **Verification**: `argon2::Argon2::verify_password` executing constant-time field comparisons.
2. **User Enumeration & Timing Attack Mitigation**:
   - In [`credentials.rs:81-89`](file:///Users/vishnuvardhanburri/vardhan-quantum-proxy/backend/auth_service/src/credentials.rs#L81-L89), if a requested username does not exist in the database, the system executes an identical `Argon2id::verify_password` computation against a static dummy sentinel hash (`$argon2id$v=19$m=65536,t=3,p=4$...`). This guarantees constant execution time regardless of username existence.
3. **Session Token Generation**:
   - Located in [`backend/auth_service/src/session.rs:114-118`](file:///Users/vishnuvardhanburri/vardhan-quantum-proxy/backend/auth_service/src/session.rs#L114-L118).
   - Token entropy: 32 random bytes from `OsRng` formatted as a 64-character lowercase hexadecimal string.
   - Session ID: `sess_` prefix followed by 16 random hex characters (8 bytes entropy).
4. **Timeouts**:
   - **Idle Timeout**: $1,800\text{ seconds}$ ($30\text{ minutes}$) of inactivity.
   - **Hard Absolute Timeout**: $86,400\text{ seconds}$ ($24\text{ hours}$) from creation.
5. **Rate Limiting**:
   - Located in [`backend/auth_service/src/rate_limit.rs`](file:///Users/vishnuvardhanburri/vardhan-quantum-proxy/backend/auth_service/src/rate_limit.rs).
   - Window: $900\text{ seconds}$ ($15\text{ minutes}$).
   - Maximum Failed Attempts: $10$ per IP address.
   - Storage: In-memory `DashMap<IpAddr, Bucket>`. Resets immediately to 0 on successful authentication.

### Forensic Truth Answers
- **What happens to active sessions on node restart?**  
  **`NODE_LOCAL` Loss**: The `SessionStore` is an in-memory `DashMap` held in node RAM. Upon node shutdown or restart, **all active sessions are immediately erased**. Connected clients receive `401 Unauthorized` on subsequent requests and must re-authenticate.
- **What happens in a multi-node deployment when Node A authenticates and Node B receives the request?**  
  **`NODE_LOCAL` Partition**: Because sessions are not synchronized across nodes, **Node B has no knowledge of Node A's session and returns `401 Unauthorized`**, unless an upstream load balancer enforces sticky sessions / IP hash affinity.

---

## 4. Role-Based Access Control (RBAC) Audit

Defined in [`backend/auth_service/src/authorization.rs`](file:///Users/vishnuvardhanburri/vardhan-quantum-proxy/backend/auth_service/src/authorization.rs) and enforced in [`backend/pq_shield/src/admin.rs`](file:///Users/vishnuvardhanburri/vardhan-quantum-proxy/backend/pq_shield/src/admin.rs).

### Roles and Permission Sets
- **`Role::Admin`**: All 11 permissions (`ReadDashboard`, `ReadSessions`, `RevokeSession`, `FlushSessions`, `UpdateProfile`, `ChangePassword`, `UpdateSettings`, `ManageApiKeys`, `DrainCluster`, `RebootCluster`, `LedgerAdmin`).
- **`Role::Operator`**: Operational permissions (`ReadDashboard`, `ReadSessions`, `RevokeSession`, `UpdateSettings`, `DrainCluster`). Forbidden from `FlushSessions`, `ManageApiKeys`, `ChangePassword`, and `RebootCluster`.
- **`Role::User`**: Self-management only (`ReadDashboard`, `UpdateProfile`, `ChangePassword`).

### Endpoint Authorization & Guard Matrix

| Endpoint | Method | Required Permission | Roles Allowed | Self vs Other Rule | Destructive Action Guard |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `/api/v1/auth/login` | `POST` | Public | All | N/A | Rate-limited (10 fails/15min) |
| `/api/v1/auth/logout` | `POST` | Authenticated | All | Destroys caller token | None |
| `/api/v1/auth/session` | `GET` | Authenticated | All | Returns caller session info | Read-only |
| `/api/v1/admin/profile` | `GET` | Authenticated | All | Returns caller profile | Read-only |
| `/api/v1/admin/profile` | `PUT` | `UpdateProfile` | Admin, User | Caller modifies own profile | None |
| `/api/v1/admin/password` | `POST` | `ChangePassword` | Admin, User | Validates caller's current password | Requires current password verify |
| `/api/v1/settings` | `GET` | `ReadDashboard` | Admin, Operator | Global settings read | Read-only |
| `/api/v1/settings` | `PUT` | `UpdateSettings` | Admin, Operator | Global configuration update | Schema bounds validation |
| `/api/v1/sessions` | `GET` | `ReadSessions` | Admin, Operator | Lists all active sessions in RAM | Read-only |
| `/api/v1/sessions/{id}/revoke` | `POST` | `RevokeSession` (or Self) | Admin, Operator, User | Non-admins may only revoke self ID | Idempotent revocation map |
| `/api/v1/sessions/flush` | `POST` | `FlushSessions` | Admin | Flushes all sessions except caller | Requires `{"confirm": true}` |
| `/api/v1/admin/api-keys` | `GET` | `ManageApiKeys` | Admin | Lists API key metadata | Read-only |
| `/api/v1/admin/api-keys` | `POST` | `ManageApiKeys` | Admin | Issues new `vq_live_` key | Key plaintext shown once |
| `/api/v1/admin/api-keys/{id}` | `DELETE` | `ManageApiKeys` | Admin | Revokes API key | Permanent Sled deletion |
| `/api/v1/cluster/drain` | `POST` | `DrainCluster` | Admin, Operator | Cluster-wide state change | State machine (`Healthy` -> `Draining`) |
| `/api/v1/cluster/reboot` | `POST` | `RebootCluster` | Admin | Cluster-wide reboot request | Requires `confirm: true` -> returns 501 |
| `/api/v1/metrics` | `GET` | `ReadDashboard` | Admin, Operator | Gateway metrics & entropy | Read-only |
| `/api/v1/cluster/status` | `GET` | `ReadDashboard` | Admin, Operator | Node & peer health | Read-only |
| `/api/v1/cluster/peers` | `GET` | `ReadDashboard` | Admin, Operator | Registered cluster peers | Read-only |
| `/api/v1/raft/status` | `GET` | `ReadDashboard` | Admin, Operator | Raft consensus role & term | Read-only |
| `/api/v1/ledger/status` | `GET` | `ReadDashboard` | Admin, Operator | Ledger block height & status | Read-only |
| `/api/v1/ledger/export` | `GET` | `LedgerAdmin` | Admin | Exports raw audit records | Read-only dump |

---

## 5. Settings Runtime Audit

Settings management is located in [`backend/auth_service/src/settings.rs`](file:///Users/vishnuvardhanburri/vardhan-quantum-proxy/backend/auth_service/src/settings.rs).

### Field-by-Field Runtime Trace

| Settings Field | Schema Type | Persisted in Sled (`settings:v1`) | Live Reload in Runtime Engine | Forensic Status |
| :--- | :--- | :--- | :--- | :--- |
| `node_id` | String (Immutable) | Yes | Read at boot identity generation | `PERSISTED_ONLY` (Read-only) |
| `signer_pub_fingerprint` | String (Immutable) | Yes | Derived from node ML-DSA-87 key | `PERSISTED_ONLY` (Read-only) |
| `kem_algorithm` | String (Immutable) | Yes | Compile-time constant (`ML-KEM-1024`)| `PERSISTED_ONLY` (Read-only) |
| `dsa_algorithm` | String (Immutable) | Yes | Compile-time constant (`ML-DSA-87`) | `PERSISTED_ONLY` (Read-only) |
| `max_connections` | $10 \le u32 \le 100,000$ | Yes | Server uses static `MAX_GLOBAL_CONCURRENCY` (4096) | **`PERSISTED_ONLY`** |
| `request_timeout_secs` | $1 \le u64 \le 300$ | Yes | Server uses static 30s timeout | **`PERSISTED_ONLY`** |
| `require_pqc_handshake` | Boolean | Yes | Gateway TLS policy fixed at startup | **`PERSISTED_ONLY`** |
| `min_password_length` | $8 \le usize \le 128$ | Yes | `credentials.rs` enforces constant 12 chars | **`PERSISTED_ONLY`** |
| `session_idle_timeout_secs`| $60 \le u64 \le 86,400$| Yes | `SessionStore` uses constant 1800s | **`PERSISTED_ONLY`** |
| `session_hard_timeout_secs`| $300 \le u64 \le 604,800$| Yes | `SessionStore` uses constant 86400s | **`PERSISTED_ONLY`** |
| `max_failed_logins` | $3 \le u32 \le 100$ | Yes | `RateLimiter` uses constant 10 fails | **`PERSISTED_ONLY`** |
| `heartbeat_interval_ms` | $50 \le u64 \le 10,000$ | Yes | `ha_cluster` uses constant 500ms | **`PERSISTED_ONLY`** |
| `drain_timeout_secs` | $5 \le u64 \le 600$ | Yes | Read on drain trigger | **`PERSISTED_ONLY`** |

### Immutability Enforcement
The settings handler in `auth_service` rejects modifications to cryptographic algorithm identifiers or node public fingerprints, ensuring node identity cannot be altered via the admin API.

---

## 6. Session Architecture & Resource Audit

Located in [`backend/auth_service/src/session.rs`](file:///Users/vishnuvardhanburri/vardhan-quantum-proxy/backend/auth_service/src/session.rs).

### Internal Structure
- `inner: Arc<DashMap<String, SessionEntry>>`: Maps secret token (64-hex chars) to full session data.
- `by_id: Arc<DashMap<String, String>>`: Maps safe session ID (`sess_<16-hex>`) to secret token.
- `revoked: Arc<DashMap<String, SessionView>>`: Maps safe session ID to revoked session tombstone metadata.

### Critical Resource Risk Analysis
```
                                 [ In-Memory SessionStore ]
   +-----------------------------------------------------------------------------------+
   |                                                                                   |
   |   inner: DashMap<Token, SessionEntry>  ---> Swept periodically on expiry (Safe)    |
   |                                                                                   |
   |   by_id: DashMap<SessId, Token>        ---> Cleaned on revocation/expiry (Safe)   |
   |                                                                                   |
   |   revoked: DashMap<SessId, SessionView> ---> NO TTL / NO BOUND / NO EVICTION      |
   |                                              [ RESOURCE RISK: O(N) LEAK ]         |
   +-----------------------------------------------------------------------------------+
```
- **Finding**: While `inner` and `by_id` clean expired sessions on validation sweeps, **the `revoked` map retains every revoked session entry indefinitely in memory**.
- **Impact**: In high-churn environments with millions of issued and revoked sessions, `revoked` will grow unboundedly until node memory exhaustion (`O(N)` leak).
- **Remediation Required**: Introduce a bounded LRU cache or timestamp-based TTL eviction for `revoked`.

---

## 7. API Key Architecture

Located in [`backend/auth_service/src/api_key.rs`](file:///Users/vishnuvardhanburri/vardhan-quantum-proxy/backend/auth_service/src/api_key.rs).

1. **Ingress & Format**:
   - Plaintext key: `vq_live_` prefix + 64 random hexadecimal characters (32 bytes `OsRng`).
   - Plaintext is returned **strictly once** upon generation in the HTTP response of `POST /api/v1/admin/api-keys`.
2. **Storage & Verification**:
   - Storage Key: `apikey:<blake3_hash(plaintext_token)>` in Sled database (`data/auth_db`).
   - Sled Record: Stores metadata (`id`, `name`, `created_at_ms`, `expires_at_ms`, `revoked`, `last_used_at_ms`).
   - Auth Lookup: Incoming `Authorization: Bearer vq_live_...` hashes the token with BLAKE3 and performs a $O(1)$ Sled lookup.
3. **Multi-Node Behavior**:
   - Sled is an embedded database bound to the local filesystem (`NODE_LOCAL`).
   - An API key generated on Node A **does NOT exist** on Node B unless Sled databases are synced out-of-band.

---

## 8. Administrative Operations & Control Plane Semantics

Enforced in [`backend/pq_shield/src/admin.rs`](file:///Users/vishnuvardhanburri/vardhan-quantum-proxy/backend/pq_shield/src/admin.rs).

### Cluster Drain State Machine
```
   +----------+    POST /cluster/drain     +------------+     Drain Timeout      +----------+
   | Healthy  | -------------------------> |  Draining  | ---------------------> |   Dead   |
   +----------+                            +------------+                        +----------+
        ^                                        |
        |                                        v
        +---- POST /cluster/drain (409) <--------+
```
- `Dead` -> Returns `400 Bad Request` ("Node is dead").
- `Draining` -> Returns `409 Conflict` ("Node is already draining").
- `Healthy` -> Transitions to `Draining`, triggers graceful connection shedding, emits `ClusterDrainRequested` and `ClusterDrainCompleted` audit events, returns `200 OK`.

### Cluster Reboot Endpoint Semantics
- **Endpoint**: `POST /api/v1/cluster/reboot`
- **Confirmation Guard**: Requires `{"confirm": true}` and `Role::Admin`.
- **Execution Truth**:
  1. Emits `ClusterRebootRequested` audit event to `audit_ledger`.
  2. Sets node state to `Draining` to shed active connections.
  3. Returns `HTTP 501 NOT_IMPLEMENTED` with structured payload:
     ```json
     {
       "error": "Reboot requested: node placed in draining state",
       "orchestrator_guidance": "Process reboot must be executed by external orchestrator: systemd, Kubernetes, or supervisor",
       "node_state": "draining"
     }
     ```
- **Rationale**: In a secure multi-node environment, an unprivileged process cannot reliably execute kernel/container reboots without an external supervisor (Kubernetes kubelet or systemd).

---

## 9. Audit Ledger & Sensitive Logging Audit

Located in [`backend/audit_ledger/src/lib.rs`](file:///Users/vishnuvardhanburri/vardhan-quantum-proxy/backend/audit_ledger/src/lib.rs).

### Ledger Cryptographic Chain
- **Storage**: Append-only JSONL file at `data/audit_ledger.jsonl`.
- **Merkle Hash Chain**:
  $$\text{Record Hash}_n = \text{BLAKE3}(\text{Record Hash}_{n-1} \parallel \text{Canonical Payload}_n)$$
- **Post-Quantum Digital Signature**: Every record is signed with the node's FIPS 204 ML-DSA-87 private key.
- **Durability Guarantee**: Every `LedgerWriter::append()` invokes `File::sync_data()` (`fsync`), guaranteeing crash-consistent on-disk persistence before the API handler responds.

### Sensitive Data Logging Audit
- **Passwords**: Never logged in plaintext, hashed, or truncated form across any crate.
- **Tokens & API Keys**: Bearer tokens and raw `vq_live_` keys are stripped before logging.
- **Usernames**: Anonymized in tracing logs using BLAKE3 hashes (`username_hash = %audit::blake3_hex(...)`), preventing PII leakage in observability pipelines while preserving forensic traceability.

---

## 10. Raft & Cluster State Model

Located in [`backend/ha_cluster/src/raft.rs`](file:///Users/vishnuvardhanburri/vardhan-quantum-proxy/backend/ha_cluster/src/raft.rs).

### State Classification Matrix

| Data Domain | Storage Mechanism | Consensus Ownership | Cross-Node Consistency |
| :--- | :--- | :--- | :--- |
| **Raft Log & Terms** | In-memory log (`ha_cluster`) | `CLUSTER_AUTHORITATIVE` | Quorum Replicated |
| **Leader Election** | Raft RequestVote RPCs | `CLUSTER_AUTHORITATIVE` | Quorum Replicated |
| **Peer Health** | Heartbeat ticks (500ms) | `NODE_LOCAL` Observation | Local Matrix |
| **User Database** | Embedded Sled (`data/auth_db`)| `NODE_LOCAL` | **Not Replicated** |
| **Active Sessions** | In-memory `DashMap` | `NODE_LOCAL` | **Not Replicated** |
| **API Keys** | Embedded Sled (`data/auth_db`)| `NODE_LOCAL` | **Not Replicated** |
| **Settings** | Embedded Sled (`data/auth_db`)| `NODE_LOCAL` | **Not Replicated** |
| **Audit Ledger** | JSONL file (`data/audit_ledger.jsonl`)| `NODE_LOCAL` | **Not Replicated** |

### Raft Implementation Correctness Trace
- Implements standard Raft state machine: `Follower`, `Candidate`, `Leader`.
- Randomized election timeouts prevent split-vote deadlocks.
- `RequestVote` rejects candidates with stale terms or less up-to-date logs.
- `AppendEntries` maintains log consistency invariant and updates `commit_index` upon majority match.
- **Decoupling Finding**: `ha_cluster::RaftNode::submit_entry` is fully implemented and unit tested, but **is not invoked by `pq_shield`, `auth_service`, or `audit_ledger` in the main runtime loop**. State mutations are executed directly against node-local storage.

---

## 11. Transport Security & Wire Protocol

Located in [`backend/proxy_engine/src/transport.rs`](file:///Users/vishnuvardhanburri/vardhan-quantum-proxy/backend/proxy_engine/src/transport.rs).

### Protocol Wire Framing
Every message frame in `AeadTransport` adheres to the following binary structure:

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                       Magic: 0x56515051                       | ("VQPQ")
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                         Payload Length                        | (4 Bytes)
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                    Sequence Number (64-bit)                   | (8 Bytes)
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                        AES-GCM Nonce                          | (12 Bytes)
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                   AES-256-GCM Poly1305 Tag                    | (16 Bytes)
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                      Encrypted Ciphertext                     | ...
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

- **Nonce Construction**: 96-bit nonce derived from 64-bit monotonic sequence number XOR'd with 96-bit connection salt. Guaranteed zero nonce reuse.
- **Replay Protection**: Strict monotonic sequence counter rejects out-of-order or duplicate frames.

---

## 12. Cryptography Claims vs Implementation Reality

| Cryptographic Primitive | Standard / Spec | Implementation | Code Location | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Post-Quantum KEM** | NIST FIPS 203 (ML-KEM-1024) | `pqcrypto-kyber` | `core_crypto/src/kem.rs` | `IMPLEMENTED` & `VERIFIED` |
| **Post-Quantum Signature** | NIST FIPS 204 (ML-DSA-87) | `pqcrypto-dilithium` | `core_crypto/src/dsa.rs` | `IMPLEMENTED` & `VERIFIED` |
| **Symmetric Re-encryption**| AES-256-GCM | `aes-gcm` | `core_crypto/src/aead.rs` | `IMPLEMENTED` & `VERIFIED` |
| **Key Derivation** | HKDF-SHA256 | `hkdf`, `sha2` | `core_crypto/src/kdf.rs` | `IMPLEMENTED` & `VERIFIED` |
| **Stream Integrity** | BLAKE3 (256-bit) | `blake3` | `core_crypto/src/hash.rs` | `IMPLEMENTED` & `VERIFIED` |
| **Password Hashing** | Argon2id ($m=64\text{MB}, t=3, p=4$)| `argon2` | `auth_service/src/credentials.rs` | `IMPLEMENTED` & `VERIFIED` |
| **Constant-Time Eq** | Hardware constant-time | `subtle` | `auth_service/src/authorization.rs`| `IMPLEMENTED` & `VERIFIED` |
| **Shannon Entropy** | $H = -\sum p_i \log_2 p_i$ | Real-time byte freq | `proxy_engine/src/entropy.rs` | `IMPLEMENTED` & `VERIFIED` |

---

## 13. Multi-Node Consistency & Failure Scenarios

### Detailed Failure Mode Analysis

```
   Client Request
        |
        +----------> [ Node A (Primary) ]  -- Creates Session / Key in local Sled & RAM
        |
   Next Request
        |
        +----------> [ Node B (Secondary) ] -- Local Sled/RAM empty! --> 401 UNAUTHORIZED
```

1. **User Registration / Password Change**:
   - Handled on Node A: Stored in Node A's Sled database.
   - Request routed to Node B: Node B has no record of the update. Authentication fails.
2. **Session Authentication**:
   - User logs in via Node A: Session stored in Node A's `DashMap`.
   - Node B receives next HTTP request: Returns `401 Unauthorized`.
3. **API Key Generation**:
   - Admin provisions `vq_live_...` on Node A: Stored in Node A's local Sled.
   - API client calls Node B: Returns `401 Unauthorized`.
4. **Node Crash Failover**:
   - Node A terminates: All active sessions on Node A are destroyed. Clients must perform full re-login against an surviving node.

---

## 14. Frontend Truth Audit

Located in `frontend/`.

| Dashboard Page | Backend Endpoint | Data Reality | Mock / Simulation Notes |
| :--- | :--- | :--- | :--- |
| **`/login`** | `POST /api/v1/auth/login` | `BACKEND_DERIVED` | Real Argon2id credentials verification |
| **`/admin`** | `/api/v1/admin/profile`, `/settings`, `/sessions`, `/api-keys` | `BACKEND_DERIVED` | Full profile, password, settings, sessions, and key management |
| **`/` (Overview)** | `/api/v1/metrics`, `/cluster/status`, `/raft/status`, `/ledger/status` | `BACKEND_DERIVED` | Live TPS, Shannon entropy, active session count, Raft role |
| **`/security`** | `GET /api/v1/metrics` | `BACKEND_DERIVED` | Real-time proxy metrics and Shannon entropy |
| **`/infrastructure`**| `GET /api/v1/cluster/peers` | `BACKEND_DERIVED` | Live node list, addresses, and health states |
| **`/consensus`** | `GET /api/v1/raft/status` | `BACKEND_DERIVED` | Current Raft term, role, leader ID, and commit index |
| **`/evidence`** | `GET /api/v1/ledger/status`, `/export` | `BACKEND_DERIVED` | Block count, ML-DSA-87 signature status, raw export |
| **`/reliability`** | `GET /api/v1/metrics` | `BACKEND_DERIVED` | Latency P50/P95 and rejected frame metrics |
| **`/network`** | `GET /api/v1/metrics` | `BACKEND_DERIVED` | Network frame counters |
| **`/intelligence`**| `GET /api/v1/events` (SSE) | `SIMULATED` | Renders live SSE stream; background rebalancer is heuristic |

---

## 15. Security Static Audit & Vulnerability Classification

### 1. High Severity
- **Unbounded Memory Growth in `SessionStore::revoked` (`RISK`)**:
  - `auth_service/src/session.rs`: Revoked session views are never evicted from memory. In production, this causes steady memory consumption over time.
- **Node-Local State Isolation in Distributed Deployments (`RISK`)**:
  - User credentials, sessions, API keys, and settings are stored locally per node. Without shared storage or Raft state machine replication, multi-node load balancing causes authentication failures.

### 2. Medium Severity
- **Settings Dynamic Mutation is `PERSISTED_ONLY` (`RISK`)**:
  - `auth_service/src/settings.rs`: Updating settings via `PUT /api/v1/settings` updates Sled, but does not notify or hot-reload running timeouts or concurrency limits in `pq_shield` or `ha_cluster`.

### 3. Low Severity / Informational
- **In-Memory Rate Limiter Reset on Reboot (`INFORMATIONAL`)**:
  - `auth_service/src/rate_limit.rs`: Rate limit counters are in-memory and reset when the node restarts.
- **SSE Token in Query String (`INFORMATIONAL`)**:
  - `frontend/lib/api.js`: Browser `EventSource` limitations require passing auth tokens in query parameters for SSE streams. Transport security over HTTPS mitigates interception.

---

## 16. Test Reality Audit

### Automated Test Coverage

```
   +-------------------------------------------------------------------------------+
   |                             Workspace Test Suite                              |
   +-------------------------------------------------------------------------------+
   |   core_crypto       : 12 tests  (FIPS 203, FIPS 204, AES-GCM, BLAKE3, HKDF)   |
   |   auth_service      : 18 tests  (Argon2id, SessionStore, Sled, RBAC, API Keys)|
   |   pq_shield         : 14 tests  (Axum gateway, Admin API, SSE, Auth middleware)|
   |   ha_cluster        : 10 tests  (Raft election, Log replication, Heartbeats)  |
   |   proxy_engine      :  8 tests  (AEAD framing, Nonce gen, Shannon entropy)    |
   |   audit_ledger      :  6 tests  (Merkle chain, ML-DSA-87 signing, fsync WAL)  |
   +-------------------------------------------------------------------------------+
```

### Test Scope Reality
- **Unit & In-Process Integration Tests**: **`VERIFIED`**. All 68+ automated tests pass cleanly in local and CI environments.
- **Local vs Staged vs Production**: Tests run in-memory using temporary directories (`tempfile`) and loopback interfaces (`127.0.0.1`). Multi-host network partitions, true cross-node failover, and hardware post-quantum hardware acceleration have not been tested in cloud staging environments.

---

## 17. Documentation Discrepancies

| Historical Documentation Claim | Actual Codebase Reality | Forensic Classification |
| :--- | :--- | :--- |
| "Global Distributed Post-Quantum Database" | Embedded single-node Sled key-value store per instance | `NODE_LOCAL` |
| "Autonomous Self-Healing AI Traffic Routing"| Periodic timer loop printing heuristic rebalancing decisions | `MOCKED` / `SIMULATED` |
| "Zero-Downtime Dynamic Configuration Engine" | Settings saved to Sled but ignored by active servers | `PERSISTED_ONLY` |
| "Decentralized Raft State Machine Replicating Auth"| Raft consensus engine is isolated from Auth and Sled | `NODE_LOCAL` Application State |
| "Hardware eBPF Acceleration" | `ebpf_engine` exists as prototype; not compiled in workspace | `TEST_ONLY` / `UNUSED` |

---

## 18. Production Readiness Matrix

| Domain | Status | Gap Analysis & Next Steps |
| :--- | :--- | :--- |
| **Cryptographic Primitives** | **`PRODUCTION_READY`** | NIST FIPS 203/204 compliant; fully verified. |
| **Authentication & RBAC** | **`PARTIALLY_READY`** | Argon2id and RBAC verified; requires distributed session store. |
| **API Key Management** | **`PARTIALLY_READY`** | BLAKE3 hashing verified; requires Raft replication across nodes. |
| **Audit Ledger** | **`PRODUCTION_READY`** (Single Node) | Signed Merkle chain with fsync; needs multi-node ledger sync. |
| **Consensus Engine** | **`PARTIALLY_READY`** | Raft election verified; needs binding to application state machine. |
| **Proxy Gateway** | **`PRODUCTION_READY`** | Axum gateway, SSE, Prometheus metrics, and TLS fully verified. |
| **Settings Management** | **`NOT_PRODUCTION_READY`**| Requires `ArcSwap` live reloading into running subsystems. |
| **Frontend Dashboard** | **`PRODUCTION_READY`** | Next.js 14 glassmorphic UI with secure server-side proxy. |
| **Container & Deployment** | **`PRODUCTION_READY`** | Multi-stage Dockerfile and Docker Compose verified. |
| **Disaster Recovery** | **`NOT_PRODUCTION_READY`**| No automated distributed state backup / snapshot mechanism. |

---

## 19. Node-Local vs Cluster-Authoritative State Model

```
+-----------------------------------------------------------------------------+
|                     Vardhan Quantum Architectural Model                     |
+-----------------------------------------------------------------------------+
|                                                                             |
|   CLUSTER-AUTHORITATIVE LAYER (Replicated via Raft Consensus):              |
|   ------------------------------------------------------------              |
|   * Leader Election & Raft Terms                                            |
|   * Raft Commit Index & Peer Membership                                     |
|                                                                             |
+-----------------------------------------------------------------------------+
|                                                                             |
|   NODE-LOCAL ISOLATED LAYER (Local to Each Process Instance):               |
|   -----------------------------------------------------------               |
|   * User Database & Password Hashes       (Sled DB: data/auth_db)           |
|   * Active Sessions & Revocation Cache    (RAM: DashMap)                    |
|   * API Keys                              (Sled DB: data/auth_db)           |
|   * Node Settings & Configurations        (Sled DB: data/auth_db)           |
|   * Audit Ledger Entries & Signatures     (File: data/audit_ledger.jsonl)   |
|   * Rate Limiting Counters                (RAM: DashMap)                    |
|                                                                             |
+-----------------------------------------------------------------------------+
```

---

## 20. Recommended Next Phase (Hardening Roadmap)

To elevate Vardhan Quantum to a true globally distributed, enterprise-grade system, the following engineering phases are recommended:

### Phase 1: Resource & Memory Leak Hardening (Immediate)
- Update `auth_service/src/session.rs`: Replace unbounded `revoked: Arc<DashMap<String, SessionView>>` with a bounded LRU cache (`lru::LruCache`) or timestamp-based TTL eviction.

### Phase 2: Live Configuration Dynamic Reloading (High Priority)
- Introduce `arc-swap` or `tokio::sync::watch` channels for `Settings`. When `PUT /api/v1/settings` is invoked, broadcast new configuration values to `pq_shield` rate limiters, session timeout checkers, and `ha_cluster` heartbeat loops.

### Phase 3: Distributed State Machine Integration (High Priority)
- Connect `auth_service` and Sled mutations to `ha_cluster::RaftNode::submit_entry`. Replicate user creations, API key provisions, settings updates, and ledger transactions across the cluster via Raft consensus log.

### Phase 4: Distributed Session Clustering (Medium Priority)
- Provide optional distributed session backend (Redis / Valkey or Raft state machine) so sessions are shared across all nodes behind a round-robin load balancer.

### Phase 5: eBPF Data-Plane Integration (Long Term)
- Integrate `ebpf_engine` into the root Cargo workspace and wire up XDP kernel packet filtering for hardware-level DDoS mitigation.

---
*End of Truth Audit Report.*
