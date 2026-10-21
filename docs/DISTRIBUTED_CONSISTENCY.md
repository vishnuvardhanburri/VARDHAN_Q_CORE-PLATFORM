# Vardhan Q-Core — Distributed Consistency, Idempotency & HA Architecture

## Document Control & System Boundary

- **Document Version:** 1.0.0
- **Classification:** Systems Engineering / Reliability & Durability Specification
- **Product:** Vardhan Q-Core
- **Scope:** Storage Engines (Sled vs PostgreSQL), Ingress Idempotency, Cluster Consensus (Raft), Multi-Node Failover, and Disaster Recovery Procedures

---

## 1. Storage Architecture & Deployment Modes

Vardhan Q-Core supports two mutually exclusive runtime storage profiles. Administrators must understand the architectural boundaries and guarantees of each profile:

```
+-------------------------------------------------------------------------+
| Single-Node Embedded Profile (Default / Bounded PoV)                    |
| - Storage Engine: Sled Embedded Key-Value Database                      |
| - Idempotency Scope: Local node process and disk volume                 |
| - Guarantees: Local ACID transactions, crash safety, fsync persistence  |
| - Constraint: MUST NOT be load-balanced across multiple nodes           |
+-------------------------------------------------------------------------+

+-------------------------------------------------------------------------+
| Clustered Enterprise Profile (Multi-Node Production)                   |
| - Storage Engine: PostgreSQL 14+ with strict transactional isolation     |
|   OR Raft-coordinated State Machine (ha_cluster module)                 |
| - Idempotency Scope: Global across all active control-plane instances    |
| - Guarantees: Serializable / Repeatable Read transactions, distributed  |
|   replay rejection via primary key / unique index constraints           |
| - Constraint: Requires DATABASE_URL pointing to redundant DB cluster     |
+-------------------------------------------------------------------------+
```

---

## 2. Idempotency & Replay Protection Invariants

### 2.1 Single-Node Guarantees (Sled CAS)
In single-node operation (`DATABASE_URL` unset):
- Transaction deduplication is enforced by `backend/vardhan_idempotency` and `backend/control_plane_api/src/receipt_transport.rs`.
- Key registration uses atomic Compare-And-Swap (CAS) on the local Sled database (`control-plane.sled`).
- Concurrent requests with identical idempotency keys on the same node are serialized: exactly one request obtains the lock and proceeds to sealing; subsequent requests receive `REJECTED_REPLAY`.
- **Restart Recovery:** Sled transactions are flushed with fsync before returning a `SEALED` status. In the event of process crash or power loss, persisted idempotency records are reloaded upon startup, preventing replay of previously processed transactions.
- **Architectural Limitation:** Multiple independent Sled instances running in separate containers do NOT share state. Running multiple containers behind a round-robin load balancer without a shared database violates the single-writer assumption and allows cross-node duplicate submission.

### 2.2 Multi-Node Cluster Guarantees (PostgreSQL Storage Engine)
In multi-node production (`DATABASE_URL` configured):
- Idempotency is enforced by the database engine via unique composite constraints:
  ```sql
  CREATE TABLE idempotency_records (
      tenant_id VARCHAR(64) NOT NULL,
      idempotency_key VARCHAR(128) NOT NULL,
      transaction_id VARCHAR(64) NOT NULL,
      status VARCHAR(32) NOT NULL,
      payload_hash CHAR(64) NOT NULL,
      created_at_ms BIGINT NOT NULL,
      PRIMARY KEY (tenant_id, idempotency_key)
  );
  ```
- Submissions across all cluster nodes execute within a database transaction:
  ```sql
  INSERT INTO idempotency_records (tenant_id, idempotency_key, transaction_id, status, payload_hash, created_at_ms)
  VALUES ($1, $2, $3, 'PENDING', $4, $5)
  ON CONFLICT (tenant_id, idempotency_key) DO NOTHING;
  ```
- If zero rows are inserted, the incoming transaction is immediately identified as a replay and rejected with status `REJECTED_REPLAY`.

---

## 3. High Availability Cluster (ha_cluster module)

For air-gapped sovereign environments where an external managed relational database is not available, Q-Core provides an embedded Raft consensus module (`backend/ha_cluster`):

### 3.1 Raft Election & Heartbeat Protocol
1. **Leader Election:**
   - Nodes operate in Follower, Candidate, or Leader states.
   - Randomized election timeouts (150ms to 300ms) prevent split votes.
   - A candidate requires a majority vote (e.g., 2 of 3, or 3 of 5 nodes) to achieve leadership.
2. **Heartbeats:**
   - The elected leader broadcasts heartbeats at 50ms intervals (`heartbeat.rs`).
   - If heartbeats cease, followers transition to Candidate state and trigger an election.
3. **Write Pipeline:**
   - Client submission requests are forwarded to the current leader.
   - The leader appends the idempotency record and transaction hash to its Raft log and replicates it to followers.
   - Once a quorum commits the log entry, the leader seals the transaction and returns the signed receipt.

### 3.2 Split-Brain Mitigation
- Quorum calculation strictly enforces `(N / 2) + 1` nodes.
- In a network partition, the partition containing the minority of nodes cannot achieve quorum and transitions to read-only or rejection mode.
- Stale leaders attempting to commit entries are rejected once a higher term is broadcast by the majority partition.

---

## 4. Disaster Recovery & Failover Drills

### 4.1 Verification Drill: `scripts/durability_backup_restore_drill.sh`
The platform includes an automated backup and restore drill script to verify disaster recovery procedures:
1. **State Snapshot:** Initiates a point-in-time snapshot of the database and key store.
2. **Simulated Crash:** Forcefully kills the active process (`kill -9`).
3. **Cold Restore:** Deploys a new container instance pointing to restored backup volumes.
4. **Consistency Verification:** Executes `lab_demo_verify.sh` against the restored node to verify:
   - Previously sealed receipts remain verifiable.
   - Idempotency records prevent re-submission of transactions completed prior to backup.
   - Signing keys reload cleanly and continue to generate valid dual-layer signatures.

### 4.2 Recovery Time & Recovery Point Objectives
- **Recovery Point Objective (RPO):**
  - PostgreSQL replication: RPO = 0 (synchronous replication) or RPO < 1s (asynchronous replication).
  - Raft cluster: RPO = 0 for all committed receipts (quorum committed before response).
  - Sled standalone: RPO = 0 for committed receipts (fsync on seal).
- **Recovery Time Objective (RTO):**
  - Standby container boot: RTO < 15 seconds.
  - PostgreSQL failover (Patroni / AWS RDS Multi-AZ): RTO < 30 seconds.
