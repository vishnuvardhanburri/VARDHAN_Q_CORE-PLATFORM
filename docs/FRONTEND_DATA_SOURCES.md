# VARDHAN QUANTUM — FRONTEND DATA SOURCES & FIELD BINDING SPECIFICATION

**Purpose**: Formal data dictionary mapping every metric, table, chart, and status indicator in the Vardhan Quantum Control Plane and Public Surfaces to its authoritative backend Rust source.

---

## 1. Backend REST & Stream Endpoints

| Axum Endpoint | HTTP Method | Crate Handler | Returned Payload Fields | UI Consumer Component |
| :--- | :--- | :--- | :--- | :--- |
| `/api/v1/status` | `GET` | `pq_shield::admin::status_handler` | `node_id`, `state`, `uptime_secs`, `version`, `pqc_suite`, `memory_rss_bytes` | Command Center, Header Beacon, Node Health |
| `/api/v1/raft/state` | `GET` | `ha_cluster::admin::raft_handler` | `term`, `role` (Leader/Follower/Candidate), `leader_id`, `commit_index`, `last_applied`, `peers` | Consensus View, Global Topology |
| `/api/v1/cluster/nodes` | `GET` | `ha_cluster::admin::nodes_handler` | Array of `{ id, address, role, state, last_heartbeat_ms, rtt_ms }` | Cluster Topology, Node Inventory |
| `/api/v1/cluster/drain` | `POST` | `ha_cluster::admin::drain_handler` | `{ success, previous_state, current_state }` | Node Actions, Drain State Machine |
| `/api/v1/sessions` | `GET` | `auth_service::session::list_handler`| Array of `{ session_id, username, created_at_ms, last_activity_ms, ip_address }` | Active Sessions Manager, SOC Operator View |
| `/api/v1/sessions/{id}/revoke`| `POST` | `auth_service::session::revoke_handler`| `{ success, revoked_id, timestamp_ms }` | Session Revocation Trigger |
| `/api/v1/ledger/records`| `GET` | `audit_ledger::records_handler` | Array of `{ sequence, block_hash, parent_hash, signature, event_type, actor, timestamp }` | Merkle Audit Ledger Viewer |
| `/api/v1/ledger/verify` | `POST` | `audit_ledger::verify_handler` | `{ chain_valid, broken_sequence, verified_count, last_signature_valid }` | Cryptographic Evidence Verification |
| `/api/v1/profile` | `GET` | `auth_service::profile_handler` | `{ id, username, email, role, mfa_enabled, last_login_ms }` | User Avatar, Profile Drawer |
| `/api/v1/admin/api-keys`| `GET` | `auth_service::api_key_handler` | Array of `{ id, name, key_hash, created_at_ms, expires_at_ms, revoked }` | Developer & Ingress Key Manager |
| `/events` | `GET` (SSE) | `pq_shield::admin::sse_handler` | Real-time SSE stream of `{ type, timestamp, node_id, payload }` | Live Event Stream, Security Center Ticker |

---

## 2. Strict Truth Fallback Specifications

When any endpoint fails, returns an empty array, or is unconfigured, components MUST NOT inject simulated values. They must render the following standard fallback contracts:

1. **Numeric Metrics (e.g. Entropy, RPS, Latency)**:
   - If offline: Render `--` with a tooltip: `Telemetry Stream Inactive`.
2. **Status Badges (e.g. Raft Role, Node State)**:
   - If unreachable: Render `STATUS UNKNOWN` (Slate badge).
3. **Audit Ledger**:
   - If no records exist or ledger is uninitialized: Render empty table state: `No Cryptographic Audit Records Found in Durable Storage`.
4. **Active Sessions**:
   - If empty: Render `No Active Remote Ingress Sessions`.
5. **AI Decisions**:
   - If AI module is idle or unconfigured: Render `Deterministic Policy Active (No Autonomous Action Recorded)`.
