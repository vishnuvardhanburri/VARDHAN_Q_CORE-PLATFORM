# PQC ↔ Consensus Integration Test Plan

> **Purpose**: Validate the trust boundary between `core_crypto` (PQC identity & key establishment), `proxy_engine` (PQ handshake + AEAD transport), and `ha_cluster` (Raft consensus) **before** building higher-level pipelines (`vardhan-state`, `vardhan-sim`, `vardhan-slm`, `vardhan-solver`).

**Status**: ✅ Plan Complete → Implementation Complete → All Tests Passing (60/60)

## Test Results

```text
test result: ok. 60 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 5.47s
```

## Implementation Notes

### Test Patterns
- **Transport-level crypto tests** (Section 3, 3.1–3.11): Direct AES-256-GCM encryption/decryption with modified ciphertexts, nonces, and AAD to verify fail-closed behavior.
- **Raft state machine tests** (Sections 2, 4, 5, 7): Use `RaftNode` with `MockRpcClient` for in-memory routing; `PartitionedRpcClient` for partition simulation.
- **Identity/key-rotation tests** (Sections 1, 6): Use `QuantumNodeIdentity` with `TestProtector` (no-op `KeyProtector`) for vault round-trips. Temp files at `/tmp/pqc_*`.
- **End-to-end test** (Section 8): 3-node cluster with `tokio::spawn` run loops, verifies exactly-one-leader invariant and evidence hash correspondence.

### Helper: `PartitionedRpcClient`
Simulates network partition by returning `Err("partitioned")` for blocked peers. This correctly models a 3-node cluster where one node is isolated — it gets only its self-vote (1 of 3), which cannot reach majority (2), preventing spurious leader election. This satisfies **Invariant I8**.

### Trust Boundary Mapping
```text
Cryptographic Trust     ← Section 1 (ML-KEM, ML-DSA)
     ↓
Authenticated Transport ← Sections 2, 3 (AEAD, PQ handshake)
     ↓
Raft Consensus          ← Sections 2, 4, 5 (state machine safety)
     ↓
Durable State           ← Sections 4.3, 4.5, 7.4, 7.10 (persistence)
     ↓
Evidence                ← Sections 6, 7.7, 7.10, 8 (rotation + hash)
```

## Architecture Under Test

```text
Client Intent
     ↓
PQC Authentication       ← core_crypto::QuantumNodeIdentity (ML-KEM-1024, ML-DSA-87)
     ↓
Secure Transport         ← proxy_engine::run_initiator/responder + AeadTransport (AES-256-GCM)
     ↓
Raft Envelope            ← ha_cluster::RaftRpcEnvelope (version, sender, receiver, request_id, payload)
     ↓
Raft Consensus           ← ha_cluster::RaftNode (state machine: Follower/Candidate/Leader)
     ↓
Durable State            ← RaftPersistentState (persisted to disk)
     ↓
Evidence                 ← audit_ledger::CheckpointWriter / LedgerApplier
```

## Test Environment

- **Workspace**: `vardhan-quantum-proxy` (Cargo workspace)
- **Build dir**: `/tmp/p4-clean-checkout/` (vP8-frozen baseline) for P8 regression tests
- **Run dir**: `/Users/vishnuvardhanburri/vardhan-quantum-proxy` for new integration tests
- **Rust**: 1.98.1, edition 2021, native (darwin/arm64)
- **Test concurrency**: `--test-threads=1` for timing-sensitive and shared-state tests
- **Test runtime**: `#[tokio::test(flavor = "multi_thread", worker_threads = 4)]`

## 1. Identity & Handshake

| # | Test | Description | Invariant |
|---|------|-------------|-----------|
| 1.1 | `pqc_1_1_ml_kem_key_establishment` | Two nodes perform ML-KEM-1024 bidirectional key exchange; shared secrets match. | I5: Shared secret is identical on both sides. |
| 1.2 | `pqc_1_2_ml_dsa_identity_verification` | ML-DSA-87 identity verification succeeds for valid peer. | I5: Identity cannot silently change. |
| 1.3 | `pqc_1_3_wrong_peer_rejected` | Responder with identity B rejects connection from initiator presenting identity C. | I9: Fail-closed. |
| 1.4 | `pqc_1_4_revoked_identity_rejected` | Node whose key has been rotated (old key revoked) cannot establish new sessions. | I5, I9. |
| 1.5 | `pqc_1_5_handshake_transcript_modified` | Any byte modification to handshake frames causes failure. | I9: Fail-closed. |
| 1.6 | `pqc_1_6_protocol_version_downgrade` | Initiator advertising only v1 connecting to responder that requires v2 fails. | I9. |
| 1.7 | `pqc_1_7_expired_identity_rejected` | Identity with expired certificate/key rejected. | I5. |
| 1.8 | `pqc_1_8_node_restart_preserves_identity` | After restart (disk reload), node presents the same identity. | I5: Identity preserved across restart. |

## 2. Secure Raft Transport

Tests the full chain: PQ handshake → AEAD transport → RaftRpcEnvelope → Raft state machine.

| # | Test | Description | Invariant |
|---|------|-------------|-----------|
| 2.1 | `pqc_2_1_request_vote_over_pq_transport` | RequestVote RPC sent over authenticated PQ transport, reply received and processed. | I1: Only authenticated RPCs change state. |
| 2.2 | `pqc_2_2_append_entries_over_pq_transport` | AppendEntries RPC sent over authenticated PQ transport, log entry replicated. | I1. |
| 2.3 | `pqc_2_3_commit_propagation` | Leader commits entry, followers receive and apply via AEAD-protected AppendEntries. | I3: Only leader commits. |
| 2.4 | `pqc_2_4_leader_election` | 3-node cluster elects a leader via PQ-authenticated RequestVote. | I2: No two leaders in same term. |
| 2.5 | `pqc_2_5_leader_replacement` | Leader steps down (higher-term AppendEntries), new election occurs. | I2. |
| 2.6 | `pqc_2_6_network_partition_rejoin` | Partition heals; partitioned leader steps down, rejoins as follower. | I8. |
| 2.7 | `pqc_2_7_delayed_packets` | Delayed packets eventually processed or safely discarded by AEAD (wrong nonce). | I6: Replay rejected. |
| 2.8 | `pqc_2_8_duplicate_packets` | Duplicate envelopes detected and not double-processed. | I6. |
| 2.9 | `pqc_2_9_reordered_packets` | Reordered frames rejected by AEAD nonce sequencing (fail-closed). | I6. |
| 2.10 | `pqc_2_10_connection_interruption_reconnection` | Dropped connection recovers via RaftPeerManager reconnection. | I3, I8. |

## 3. Cryptographic Attack Matrix

Every attack MUST result in **no state transition**.

| # | Attack | Expected | Invariant |
|---|--------|----------|-----------|
| 3.1 | Ciphertext modification (bit-flip in AEAD ciphertext) | Reject (CryptoError) | I9, I1 |
| 3.2 | Invalid authentication tag (truncated tag) | Reject (CryptoError) | I9, I1 |
| 3.3 | Replay (same encrypted frame sent twice) | Reject (nonce reuse → CryptoError) | I6, I9 |
| 3.4 | Wrong sequence number (AES-256-GCM nonce mismatch) | Reject | I6, I9 |
| 3.5 | Wrong direction (initiator→responder frame replayed as responder→initiator) | Reject (AAD direction byte mismatch) | I4 |
| 3.6 | Wrong session ID (different session keys) | Reject | I4 |
| 3.7 | Wrong peer identity (valid handshake, different DSA pub key) | Reject (InvalidSignature) | I5, I9 |
| 3.8 | Downgraded crypto suite (fake protocol version in HELLO) | Reject (version negotiation failure) | I9 |
| 3.9 | Modified Raft term (envelope.term tampered) | Reject by Raft log matching rules | I2 |
| 3.10 | Modified request ID (envelope.request_id tampered) | Reply lost (request_id mismatch) | I1 |
| 3.11 | Modified log entry (payload tampering within envelope) | Reject (AEAD decryption fails) | I4 |

## 4. Consensus Safety (Under PQ Transport)

| # | Scenario | Assertion |
|---|----------|-----------|
| 4.1 | 3 nodes, leader elected via PQ transport, partition 1 node | Remaining 2 nodes elect new leader. |
| 4.2 | Old leader rejoins after partition | Old leader steps down (higher term from new leader). |
| 4.3 | Committed entries survive partition | Committed log entries present on rejoining node. |
| 4.4 | Uncommitted entries replaced | Per Raft spec — may be overwritten by new leader. |
| 4.5 | Old leader cannot write after losing leadership | submit_entry returns Err("not leader"). |
| 4.6 | Stale-term messages cannot overwrite | handle_append_entries with lower term → success=false. |
| 4.7 | Restarted nodes recover durable state | State loaded from persistence file. |

## 5. PQC + Raft Failure Matrix

Combinations of PQC-layer failure × Raft-layer failure:

| # | PQC Failure | Raft Failure | Expected Behavior |
|---|-------------|--------------|-------------------|
| 5.1 | Leader crash + handshake failure on reconnect | New election, new leader, peer manager retries |
| 5.2 | Leader crash + identity rotation | New sessions use rotated key; old key rejected |
| 5.3 | Partition + stale certificate | Partitioned leader cannot make progress |
| 5.4 | Partition + replayed AppendEntries | AEAD rejects replay; no state change |
| 5.5 | Restart + rotated signing key | Node loads new key; sessions use new identity |
| 5.6 | Network recovery + old session | Old session keys rejected; fresh handshake required |
| 5.7 | New leader + old leader reconnect | Old leader sees higher term, steps down |

## 6. Key Rotation Integration

| # | Test | Description | Invariant |
|---|------|-------------|-----------|
| 6.1 | `pqc_6_1_valid_rotation` | rotate_signing_key() produces KeyTransitionRecord; new key accepted. | I5, I7 |
| 6.2 | `pqc_6_2_simultaneous_rotation` | Two nodes rotate simultaneously; both sessions use new keys. | I5 |
| 6.3 | `pqc_6_3_rotation_during_election` | Key rotated mid-election; new leader uses new key. | I5 |
| 6.4 | `pqc_6_4_rotation_during_partition` | Rotation during partition; rejoined node uses new key. | I7 |
| 6.5 | `pqc_6_5_restart_after_rotation` | Node restarted; loads new key from vault. | I5 |
| 6.6 | `pqc_6_6_old_key_rejection` | Sessions attempted with old (revoked) key fail. | I9 |
| 6.7 | `pqc_6_7_new_key_acceptance` | Sessions with new key succeed. | I1 |
| 6.8 | `pqc_6_8_conflicting_rotation_rejection` | Two simultaneous rotations for same identity: only latest wins. | I7 |

## 7. Property / Invariant Tests

Continuous assertions run after each scenario:

```text
I1  No unauthenticated Raft RPC changes state.
I2  No stale term can modify current state.
I3  No non-leader can commit client writes.
I4  Committed state survives restart.
I5  Cryptographic identity cannot silently change.
I6  Replay cannot produce a second state transition.
I7  Key rotation cannot invalidate committed historical evidence.
I8  A network partition cannot create two valid committed histories.
I9  Failed cryptographic verification is fail-closed.
I10 Evidence corresponds to the exact committed state.
```

## 8. End-to-End Test

```text
Client Intent
     ↓
PQC Authentication    (ML-KEM-1024 + ML-DSA-87)
     ↓
Raft Proposal         (RequestVote → AppendEntries → Commit)
     ↓
Majority Commit       (3/5 nodes commit via AEAD-protected transport)
     ↓
State Transition      (ledger entry applied)
     ↓
Evidence Receipt      (checkpoint written)
     ↓
Decision/Outcome      (verified: term + commit_index + signature)
     ↓
Cryptographic Verification (independent verification of committed state)
```

Then deliberately attack every boundary at each step.

## Implementation

Tests are implemented in `backend/ha_cluster/tests/pqc_consensus_integration.rs`.

Run:
```bash
cargo test -p ha_cluster --test pqc_consensus_integration -- --test-threads=1 --nocapture
```
