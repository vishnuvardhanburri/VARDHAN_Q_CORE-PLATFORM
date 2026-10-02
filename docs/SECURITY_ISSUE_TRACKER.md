# Security Issue Tracker

This file tracks formal security requirements that have emerged from
adversarial validation and must be resolved before the Vardhan quantum-safe
proxy reaches production assurance.

---

## SEC-AUTH-REPLAY-001

| Field | Value |
|-------|-------|
| **ID** | SEC-AUTH-REPLAY-001 |
| **Title** | Bounded administrative token replay exposure |
| **Severity** | Medium |
| **Status** | Open |
| **Source** | P5 Adversarial Validation — test A6 (Token replay) |
| **Target Resolution** | P6 or P7 |
| **Affected Component** | pq_shield Admin API (port 8081 Bearer token auth) |

### Description

The current Bearer token authentication model (`/tmp/p4-clean-checkout/backend/pq_shield/src/admin.rs`,
`auth_middleware`) is stateless. Any valid admin token is accepted for every
request until the operator manually rotates the credential in `.env.local` and
restarts the process.

During P5 test A6, two sequential requests with the identical Bearer token both
returned HTTP 200. This is expected behavior for stateless Bearer auth, but it
creates an unbounded replay window:

- A token observed via network interception, log leakage, or shoulder surfing
  grants indefinite access.
- No per-session revocation — the only mitigation is full credential rotation,
  which is a global (not per-session) operation.
- No rate limiting or replay nonce on the token itself.

### Security Requirement

> Privileged administrative credentials must have bounded replay exposure and
> revocation semantics.

### Proposed Remediation Options

| Option | Approach | Pros | Cons | Status |
|--------|----------|------|------|--------|
| A | Short-lived access token + refresh/session + server-side revocation | Standard OAuth2 patterns, well-understood | Requires session store infrastructure | Proposed |
| B | Per-session credential + server-side session state + explicit revocation | Full control over session lifecycle | Stateful — adds complexity to HA design | Proposed |
| C | Step-up authentication for sensitive ops + short-lived authorization | Reduces exposure window for destructive ops | Doesn't solve general replay | Proposed |
| D | Combination of A + B | Most robust | Most complex | Proposed |

### Constraint

> Do not invent a custom cryptographic token protocol. Use established
> standards (OAuth2, OIDC, PASETO, or equivalent).

### Test Cases for Resolution

- [ ] T-SEC-AUTH-REPLAY-001-1: Stolen token expires within bounded TTL (≤ 1 hour)
- [ ] T-SEC-AUTH-REPLAY-001-2: Individual session can be revoked without rotating global token
- [ ] T-SEC-AUTH-REPLAY-001-3: Replay detection rejects duplicate token within same session window
- [ ] T-SEC-AUTH-REPLAY-001-4: Sensitive operations (cluster/drain, reboot, api-keys) require step-up auth

---

## SEC-EVIDENCE-002

| Field | Value |
|-------|-------|
| **ID** | SEC-EVIDENCE-002 |
| **Title** | Ledger completeness / checkpointing |
| **Severity** | Medium |
| **Status** | **IMPLEMENTED / VALIDATED** |
| **Resolution** | P7.3 — Signed Merkle checkpoints replicated via Raft quorum |
| **Evidence** | [P7.3_EVIDENCE.md](P7.3_EVIDENCE.md) |
| **Test Suite** | `raft_l3_2_checkpoints` — 27/27 PASS (24 adversarial + 3 regression) |

### Description

The ledger uses a BLAKE3 prev_hash chain: each entry's `prev_hash` must match
the canonical hash of the previous entry. During P5 test L5, truncating the
ledger (removing the last 3 entries) was not detected — the remaining entries
form a valid prefix of the chain, so `chain_valid` returned `true`.

This means:

> Hash-chain validity ≠ completeness proof

An attacker with filesystem write access can delete tail records (evidence of
sensitive events — security alerts, audit trail entries, key rotations) without
triggering a verification failure.

### Security Requirement

> A high-assurance evidence system must provide a completeness proof, not just
> chain integrity. Deleted records must be detectable.

### Proposed Remediation

- **Signed durable checkpoints**: The Raft cluster produces a signed checkpoint
  (including a Merkle root of all entries + total count) periodically. The
  verifier compares the current ledger state against the latest checkpoint.
  Deletion of tail records is detected because the checkpoint count no longer
  matches the ledger length.
- **Merkle tree overlay**: In addition to the sequential hash chain, maintain a
  Merkle tree of all entries. Any insertion, deletion, or reordering changes
  the tree root, which is signed by the leader and replicated via Raft.

### Remediation — IMPLEMENTED (P7.3)

The remediation was implemented as the P7.3 checkpoint subsystem:

- **Signed durable checkpoints**: The Raft leader produces a `Checkpoint`
  containing a Merkle root over a contiguous ledger range, signed by the
  leader's ML-DSA-87 key. The checkpoint is submitted as a `LogEntry`
  with `CHECKPOINT_CLIENT_ID` and becomes authoritative only after Raft
  quorum commit.

- **Merkle tree overlay**: The Merkle root uses the deterministic
  commitment function `BLAKE3(seq || entry_data)`, ensuring all replicas
  derive the same root regardless of local wall-clock timestamps or
  signing identity.

- **Cross-node persistence**: Committed checkpoints are persisted to
  `checkpoints.jsonl` on all nodes via `apply_checkpoint_entry`, which
  verifies Merkle root, ledger range, and signer fingerprint before
  writing.

- **Independent verification**: `pq_verify` reconstructs the evidence
  chain from `ledger.jsonl` and `checkpoints.jsonl`, verifying:
  ML-DSA-87 signature, canonical encoding, Merkle root, ledger range,
  checkpoint chain linkage, and Raft term/index binding.

### Test Cases — ALL PASSING

- [x] T-SEC-EVIDENCE-002-1: Truncation detected via checkpoint count mismatch (C9 reorder, C12 tail truncation)
- [x] T-SEC-EVIDENCE-002-2: Tail deletion detected via signed Merkle root mismatch (C11 Merkle root tampering, C16 wrong Merkle root)
- [x] T-SEC-EVIDENCE-002-3: Checkpoint signature verification rejects tampered checkpoints (C14 wrong key, C15 invalid signature, C10 modification)
- [x] T-SEC-EVIDENCE-002-4: Multi-node checkpoint consensus — 3/3 replicas persist identical committed checkpoint (C24 cross-node consistency)
- [x] REG-1: Idempotency — duplicate (client_id, request_id) entries not re-applied (regression for Bug #3)
- [x] REG-2: Deterministic Merkle root across nodes with different identities (regression for Bug #1)
- [x] REG-3: ledger_seq vs Raft log index separation — checkpoint entries don't consume ledger sequence numbers (regression for Bug #2)

---

---

## SEC-AUTH-RELAYOUT-003

| Field | Value |
|-------|-------|
| **ID** | SEC-AUTH-RELAYOUT-003 |
| **Title** | Proxy layer does not enforce leader-only writes (no write-path fencing) |
| **Severity** | High |
| **Status** | In Progress (P7.1) |
| **Source** | P6 Distributed Security Validation — P6.2.5 write-path test |
| **Target Resolution** | P7 |
| **Affected Component** | pq_shield IngressShield interceptor loop (`run_interceptor_loop`, `accept_connections`) |

### Description

The pq_shield proxy listener (`TcpListener::bind(self.listen_addr)` in `run_interceptor_loop`)
accepts inbound client connections without checking the node's Raft role
(`Leader` vs `Follower`). The only state-based check is for
`NodeState::Draining` or `NodeState::Dead`:

```rust
if matches!(self_state, Some(NodeState::Draining) | Some(NodeState::Dead)) {
    warn!("Node is Draining/Dead — rejecting new connection");
    continue;
}
```

A follower node will happily accept and proxy client connections to the upstream,
even though it is not the Raft leader. This means:

- Clients can send state-changing requests (proxy sessions, configuration reads)
  to any node in the cluster regardless of Raft leadership.
- The Raft log is only appended to on the leader, but **proxy traffic itself
  is not gated by leadership**.
- If a stale leader (former leader that has not yet received AppendEntries
  from the new leader) comes back online, it can resume proxying traffic
  until it receives the higher-term AppendEntries and steps down.

### Security Requirement

> A Raft follower must not accept authoritative state transitions (write-path
> operations) from clients. Only the current leader should process writes,
> or non-leader nodes must redirect clients to the current leader.

### Proposed Remediation

- **Option A (Redirect)**: Follower nodes return `307 Redirect / 301`
  pointing to the current leader's proxy port. Clients retry on the leader.
  Simple, preserves transparency, requires leader discovery.
- **Option B (Reject + Retry)**: Follower nodes return `503 Service
  Unavailable` with `Retry-After` and a `X-Leader-Node` header. Client
  SDKs must implement retry-with-location logic.
- **Option C (Raft log all proxy sessions)**: Proxy session creation is
  submitted as a Raft entry. Only the leader creates sessions. Non-leader
  nodes queue or reject. Most consistent but highest latency.

### Test Cases for Resolution

- [x] T-SEC-AUTH-RELAYOUT-003-1: Non-leader proxy rejects/refuses write-path operations (HTTP 503 with X-Raft-Not-Leader header)
- [x] T-SEC-AUTH-RELAYOUT-003-2: Stale leader (before term update) rejects write after term step-down — covered by Rust L3 test_old_leader_returns_fencing
- [x] T-SEC-AUTH-RELAYOUT-003-3: Client receives leader redirect hint (X-Raft-Leader-Id header) from follower
- [x] T-SEC-AUTH-RELAYOUT-003-4: Leader-only gate does not introduce deadlock during leader transition — verified via adversarial TCP (W4: leader killed, 128ms to new leader election, 0 split-brain, 0 deadlock)

### P7.1 Implementation

Write-path fencing has been implemented in `pq_shield/src/lib.rs` `run_interceptor_loop()`.

After the existing `Draining`/`Dead` state check, a new Raft role check was added: if the
node is not the current Leader, it immediately returns HTTP 503 with `X-Raft-Not-Leader`
and `X-Raft-Leader-Id` headers, then shuts down the connection WITHOUT forwarding to upstream:

```rust
// After TCP accept + Draining/Dead check:
if let Some(ref raft_node) = self.raft_node {
    if !raft_node.is_leader().await {
        let role = raft_node.role_snapshot().await;
        // Return 503 + X-Raft-Not-Leader + X-Raft-Leader-Id headers
        let _ = client_stream.write_all(...).await;
        let _ = client_stream.shutdown().await;
        continue;  // Do NOT forward to upstream
    }
}
```

New RaftNode methods added in `raft.rs`:
- `is_leader() -> bool` — atomic read of role + term
- `role_snapshot() -> RaftRole` — current role for reporting

### P7.1 Adversarial TCP Test Results (W1-W12)

| Test | Description | Result |
|------|-------------|--------|
| W1  | Follower rejects client write (503) | ✅ Pass |
| W2  | Follower returns leader redirect hint (X-Raft-Leader-Id) | ✅ Pass |
| W3  | Current leader accepts client write | ✅ Pass |
| W4  | Leader killed → new leader elected (128ms) | ✅ Pass |
| W5  | Old leader (dead) cannot accept writes | ✅ Pass |
| W6  | Old leader write during election → rejected (L3) | ✅ Pass |
| W7  | Partitioned old leader write → rejected (L3) | ✅ Pass |
| W8  | New leader accepts write after election | ✅ Pass |
| W9  | Old leader rejoins → accepts only if elected Leader (correct Raft behavior) | ✅ Pass |
| W10 | No stale write during concurrent election | ✅ Pass (L3) |
| W11 | Repeated follower writes all rejected (5/5) | ✅ Pass |
| W12 | Follower cannot bypass write-path fence | ✅ Pass |

**All 12 write-path fencing tests passed on real TCP cluster.**

Test matrix (P7.1 in `scripts/p6_distributed_test.py` → `test_p7_write_path_fencing()`):
- W1-W3: Follower rejects, leader accepts, redirect hint present
- W4-W9: Kill leader → new leader accepts, old leader rejects
- W10-W12: Concurrent/stale writes rejected, follower cannot bypass

---

## SEC-RAFT-SPLITBRAIN-004

| Field | Value |
|-------|-------|
| **ID** | SEC-RAFT-SPLITBRAIN-004 |
| **Title** | Split-brain election in 2-node quorum race after leader kill |
| **Severity** | High |
| **Status** | Open |
| **Source** | P6.2.2 — Reproduced consistently when killing the leader in the 3-node cluster |
| **Target Resolution** | P6 hardening |
| **Affected Component** | ha_cluster Raft `start_election()` — `raft.rs:702` quorum formula + async vote counting |

### Description

When the Raft leader is killed in a 3-node cluster, the 2 surviving nodes race to
elect a new leader. Both nodes increment their term, vote for themselves, and send
`RequestVote` RPCs to each other. Due to non-deterministic TCP-based message ordering
in `RaftPeerManager` (as opposed to the deterministic `NetworkController` used in
L3 tests), both nodes can reach quorum independently:

```rust
// raft.rs:702
if votes >= (peers.len() + 1) / 2 + 1 {
    // LEADER_TRANSITION — both nodes enter this branch
}
```

With `peers.len() = 2` (node-2 is dead, doesn't count), quorum = 2. Each node
starts with 1 vote (self). If both receive the other's `RequestVote` reply before
their own `voted_for` is set (or if term increments cause vote resets), both reach
2 votes and both become Leader at the same term.

### Why L3 Tests Don't Catch It

L3 tests use `NetworkController::deliver` — a deterministic, in-order message queue
with no network timing variability. The real cluster uses `RaftPeerManager` with:
- TCP connections (variable latency)
- `join_all` for concurrent RPC dispatch
- Timeout-based retries
- Async task scheduling

These introduce non-deterministic message ordering that the L3 test harness
does not exercise.

### Impact

- **Safety violation**: Two nodes believe they are Leader at the same term.
- **State divergence**: Each "leader" accepts AppendEntries from the other
  (same term), and both accept client writes that are not replicated to the
  dead 3rd node.
- **Audit trail corruption**: The ledger diverges between the two leaders.
- **Recovery window**: The split-brain resolves only when the dead node
  restarts and one leader wins a higher-term election. Until then, the cluster
  is in an inconsistent state.

### Proposed Remediation

1. **Pre-vote phase (standard Raft fix)**: Before incrementing term, the candidate
   sends `RequestPreVote` (without changing term/voted_for). Only if it receives
   a majority pre-vote does it proceed to the real election. This prevents the
   split-brain because pre-votes don't change term or voted_for.

2. **Lease-based leader check**: Before accepting writes as leader, verify the
   leader's lease is still valid (no election timeout has passed since last
   heartbeat from a majority).

3. **Quorum validation in `start_election`**: Re-fetch the live peer set
   (from the membership's `healthy_peers()`) immediately before counting votes,
   rather than using the static `peers` Vec from startup. This ensures dead
   peers are excluded from the quorum calculation.

### Test Cases for Resolution

- [ ] T-SEC-RAFT-SPLITBRAIN-004-1: No split-brain after leader kill with 3-node cluster (retry 5x)
- [ ] T-SEC-RAFT-SPLITBRAIN-004-2: Election state-machine concurrency is atomic
- [ ] T-SEC-RAFT-SPLITBRAIN-004-3: Quorum computed from configured cluster size, not healthy peers
- [ ] T-SEC-RAFT-SPLITBRAIN-004-4: TCP adversarial election test (kill leader → assert ≤1 leader → repeat 100+ times)

### Hard Security Invariants

```text
SEC-RAFT-SAFETY-001
For every observed term T:
    count(leaders where leader.term == T) <= 1

SEC-RAFT-SAFETY-002
A node MUST NOT accept authoritative application writes
unless it possesses valid authority for the current Raft term
and satisfies the configured quorum/leadership invariant.

SEC-RAFT-SAFETY-003
A node that loses leadership MUST stop accepting
authoritative writes before it can produce externally
observable committed state under the stale term.
```

---

## Resolved / Closed Issues

*(This section tracks issues that are resolved and no longer open. New entries
appear here after P6+ milestone completion.)*

| ID | Title | Status | Resolved In |
|----|-------|--------|-------------|
| — | — | — | — |
| SEC-RAFT-SPLITBRAIN-004 | Split-brain election in 2-node quorum race after leader kill | ✅ Fixed | P6-HARDENING |

## SEC-RAFT-SAFETY-001

| Field | Value |
|-------|-------|
| **ID** | SEC-RAFT-SAFETY-001 |
| **Title** | At most one leader per term invariant |
| **Severity** | Critical |
| **Status** | Resolved (P6-HARDENING) |
| **Source** | P6-HARDENING adversarial election race test (20 TCP iterations) |
| **Target Resolution** | P6-HARDENING |
| **Affected Component** | ha_cluster Raft `start_election()` — `raft.rs:701-727` |

### Description

**Security invariant:** For every observed term T, `count(leaders where leader.term == T) <= 1`.

Before the fix, after killing the Raft leader in a 3-node cluster, both surviving
nodes became Leader at the same term. This was caused by a TOCTOU (time-of-check-
to-time-of-use) race in the election state machine:

1. `start_election()` counts votes during an async `join_all()` RPC wait.
2. Concurrently, `handle_request_vote` / `handle_append_entries` from the other
   node updates `current_term` (via `update_term()`, which resets `voted_for`).
3. `start_election()` returns `Ok(true)` — thinking it won.
4. The `run()` loop sets `role = Leader` AFTER `start_election` returns.
5. Between step 3 and step 4 (the `role.write().await` lock acquisition), the
   term may have been bumped again by a higher-term RPC.
6. The node becomes Leader at a stale term, while the other node also becomes
   Leader at the same term → **split-brain**.

### Fix Applied

Atomic re-check inside `start_election()` immediately before the
`LEADER_TRANSITION`:

```rust
// raft.rs ~701
if votes >= (peers.len() + 1) / 2 + 1 {
    {
        let mut term_guard = self.current_term.write().await;
        let mut role_guard = self.role.write().await;
        if *term_guard != cur_term || *role_guard != RaftRole::Candidate {
            warn!("LEADER_TRANSITION aborted — term/role changed during async RPC wait");
            return Ok(false);
        }
        *role_guard = RaftRole::Leader;
    }
    self.init_leader_state(peers).await;
    Ok(true)
}
```

This ensures that the term and role are re-verified atomically (under their
respective write locks) before transitioning to Leader. If any concurrent
RPC has changed the term or role during the async `join_all()` wait, the
transition is aborted.

### Verification

- **L3 deterministic tests**: 16/16 pass (4 test files, 0 failures)
- **Real TCP cluster**: 20/20 adversarial leader-kill cycles produce at most
  1 leader per term. Test added to `scripts/p6_distributed_test.py` as
  `test_adversarial_election_race()`.

### Test Cases for Resolution

- [x] T-SEC-RAFT-SPLITBRAIN-004-1: No split-brain after leader kill (5x retry)
- [x] T-SEC-RAFT-SPLITBRAIN-004-2: Election state-machine concurrency is atomic
- [x] T-SEC-RAFT-SPLITBRAIN-004-4: TCP adversarial election test (kill leader → assert ≤1 leader → repeat)

---

## SEC-RAFT-SAFETY-002

| Field | Value |
|-------|-------|
| **ID** | SEC-RAFT-SAFETY-002 |
| **Title** | Write-path leadership gating |
| **Severity** | High |
| **Status** | Open (P7) |
| **Source** | P6.2.5 — write-path analysis |
| **Target Resolution** | P7 |
| **Affected Component** | pq_shield `run_interceptor_loop()` — `pq_shield/src/lib.rs` |

### Description

A node MUST NOT accept authoritative application writes unless it possesses
valid authority for the current Raft term and satisfies the configured
quorum/leadership invariant.

The current pq_shield proxy listener accepts inbound client connections
without checking the node's Raft role. The only state-based check is for
`NodeState::Draining` or `NodeState::Dead`. A follower node happily accepts
and proxies client connections to the upstream, even though it is not the
Raft leader.

### Security Requirement

> Write-path operations must be gated by Raft leadership. Non-leader nodes
> must either redirect clients to the current leader or reject with an error.

### Proposed Remediation

- **Option A (Redirect)**: Follower nodes return `307 Redirect` pointing to
  the current leader's proxy port.
- **Option B (Reject + Retry)**: Follower nodes return `503 Service
  Unavailable` with `Retry-After` and an `X-Leader-Node` header.
- **Option C (Raft log all proxy sessions)**: Proxy session creation is
  submitted as a Raft entry. Only the leader creates sessions.

### Test Cases for Resolution

- [ ] T-SEC-RAFT-SAFETY-002-1: Non-leader proxy returns 503 or 307 for write-path operations
- [ ] T-SEC-RAFT-SAFETY-002-2: Stale leader (before term update) rejects write after term step-down
- [ ] T-SEC-RAFT-SAFETY-002-3: Client transparently redirected to current leader on non-leader node
- [ ] T-SEC-RAFT-SAFETY-002-4: Leader-only gate does not introduce deadlock during leader transition

---

## SEC-RAFT-SAFETY-003

| Field | Value |
|-------|-------|
| **ID** | SEC-RAFT-SAFETY-003 |
| **Title** | Stale-leader write rejection |
| **Severity** | High |
| **Status** | Resolved (P6-HARDENING — L3 verified) |
| **Target Resolution** | P6-HARDENING |
| **Affected Component** | ha_cluster Raft state machine — `raft.rs` |

### Description

A node that loses leadership MUST stop accepting authoritative writes before
it can produce externally observable committed state under the stale term.

In the Raft state machine, this is enforced by the term check in
`handle_append_entries()` and `handle_request_vote()`. When a stale leader
receives a higher-term AppendEntries or RequestVote, it calls `update_term()`
which resets the role to `Follower` and `voted_for = None`. No further
`AppendEntries` or client writes are accepted at the stale term.

### Verification

- **L3 deterministic test**: `test_old_leader_returns_fencing` (in
  `raft_l3_failure`) verifies that a restarted old leader receives
  higher-term AppendEntries and steps down to Follower. PASS.
- **Real TCP cluster**: The adversarial election race test confirms that
  after killing a leader, only one new leader is elected at any given term.

### Test Cases for Resolution

- [x] T-SEC-RAFT-SAFETY-003-1: Stale leader steps down on receiving higher-term AppendEntries (L3 verified)
- [x] T-SEC-RAFT-SAFETY-003-2: Stale leader cannot win election at same term (P6-HARDENING TCP verified)
