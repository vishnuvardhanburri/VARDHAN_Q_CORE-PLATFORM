# P8 Findings Record

All findings are against the `vP7.3-frozen` baseline.

---

## P8-001: Committed Entry Truncation by Same-Term Byzantine Leader

| Field | Value |
|-------|-------|
| **ID** | P8-001 |
| **Attack** | P8.1 — Byzantine node injection |
| **Invariant** | I3 (no committed state-machine command applied differently) |
| **Severity** | Medium |
| **Status** | Documented |
| **Root Cause** | `log.truncate(prev_idx)` at `raft.rs:622` does not check `commit_index` |
| **Test** | `p8_001_committed_entry_overwrite_by_byzantine` |

### Description

When a follower receives `AppendEntries` with `prev_log_index=0` and a
different entry at the same position, it truncates its log unconditionally.
If the entry being truncated was already committed
(`commit_index >= prev_log_index`), the committed entry is silently
overwritten.

This violates I3: a committed command is applied differently across replicas.

### Attack Vector

A node with valid transport credentials (ML-KEM/ML-DSA authenticated session)
sends `AppendEntries` with the same term as the current leader but a
different `leader_id` and `entries`. The follower accepts the overwrite
because:

1. The term matches (not rejected by the stale-leader check)
2. `prev_log_index=0` passes the log matching check
3. `log.truncate(0)` removes the committed entry without checking `commit_index`

### Mitigation

In production, the AEAD transport (ML-KEM-1024 key exchange + ML-DSA-87
signatures) authenticates all Raft peers. Only nodes with valid,
CA-signed node identities can establish connections to the
`RaftNetworkListener`. This means a Byzantine leader would need to:

1. Compromise a legitimate node's ML-DSA-87 private signing key, OR
2. Compromise the node identity at the KMS/HSM level (P3.3)

Standard Raft does not protect against Byzantine failures by design —
it assumes authenticated, fail-stop peers. The transport layer provides
the authentication boundary.

---

## P8-002: Log Fork via Divergent Entries

| Field | Value |
|-------|-------|
| **ID** | P8-002 |
| **Attack** | P8.1 — Byzantine node injection |
| **Invariant** | I3 (log consistency) |
| **Severity** | Medium |
| **Status** | Documented |
| **Root Cause** | `handle_append_entries` accepts entries at the same index with different data from different senders. No quorum-level log hash check exists. |
| **Test** | `p8_1g_fork_via_conflicting_prev_log` |

### Description

A Byzantine leader can send different entries at the same log index to
different followers. Each follower individually accepts the entry (same
`prev_log_index`/`prev_log_term`), creating a divergent log. I3 is only
enforced when a legitimate leader's heartbeat overwrites the fork.

### Mitigation

Quorum intersection + ML-KEM/ML-DSA transport authentication. A Byzantine
node would need to compromise a legitimate node's identity to become leader.

---

## P8-003: No Signing Key Rotation Mechanism

| Field | Value |
|-------|-------|
| **ID** | P8-003 |
| **Attack** | P8.7 — Key compromise |
| **Invariant** | I10 (key lifecycle management) |
| **Severity** | High |
| **Status** | **FIXED** on `p8/remediation` branch |
| **Root Cause** | `core_crypto::QuantumNodeIdentity` had no method to rotate the ML-DSA-87 signing key. `rotate_key_protector` only re-wrapped the key at rest with a different protector — it did NOT generate a new signing key pair. |
| **Test** | `p8_7e_no_signing_key_rotation_mechanism` (baseline vulnerability) → `p8_10a_key_rotation_produces_verifiable_transition` (regression) |
| **Fix Commit** | `p8/remediation` branch — `core_crypto/src/lib.rs` `rotate_signing_key()` + `KeyTransitionRecord`

### Description

If the ML-DSA-87 signing key is compromised, there is no way to:
1. Generate a new signing key pair and transition to it
2. Revoke a compromised signing key
3. Mark entries/checkpoints as signed with a pre-compromise vs post-compromise key

Session/API key revocation exists (`SessionStore::revoke_by_id`), but
signing key revocation does not.

### Impact

A compromised signing key allows an attacker to forge ledger entries and
checkpoints indefinitely. Recovery requires manual key regeneration and
re-seeding all nodes — no hot rotation path exists.

### Remediation

Add `QuantumNodeIdentity::rotate_signing_key()` that:
1. Generates a new ML-DSA-87 keypair
2. Signs the new public key with the old key (proof of continuity)
3. Publishes the new key fingerprint in the next ledger entry / checkpoint
4. Maintains a key history for verification of past signatures

### Fix Verification (P8.10)

The fix was implemented on the `p8/remediation` branch (`core_crypto/src/lib.rs`,
`rotate_signing_key()`) and verified by 4 regression tests in `raft_p8_regression_p8003.rs`:

| Test | Description | Expected After Fix |
|------|-------------|-------------------|
| `p8_10a` | Rotation produces verifiable KeyTransitionRecord | ✅ Old key signs new key |
| `p8_10b` | New key persisted to vault | ✅ Reload has new key |
| `p8_10c` | KEM identity preserved | ✅ ML-KEM unchanged |
| `p8_10d` | Old key cannot sign after rotation | ✅ Old signature invalid against new key |

All 4/4 regression tests pass on `p8/remediation`.

---

## P8-004: signer_pub_fingerprint Not in Signed Canonical Bytes

| Field | Value |
|-------|-------|
| **ID** | P8-004 |
| **Attack** | P8.7 — Key compromise |
| **Invariant** | I7 (signature integrity) |
| **Severity** | High |
| **Status** | **FIXED** on `p8/remediation` branch |
| **Root Cause** | `Checkpoint::canonical_bytes()` included cluster_id, config_epoch, raft_term, raft_log_index, ledger ranges, merkle_root, previous_checkpoint_hash, timestamp_ms, and version — but NOT `signer_pub_fingerprint`. |
| **Test** | `p8_7d_signer_fingerprint_not_in_signature` (baseline vulnerability) → `p8_11a_fingerprint_change_invalidates_signature` (regression) |
| **Fix Commit** | `p8/remediation` branch — `audit_ledger/src/lib.rs` `canonical_bytes()` now includes `signer_pub_fingerprint` in the signed buffer |

### Description

An attacker who compromises the signing key can forge a checkpoint and then
change the `signer_pub_fingerprint` field to claim a different signer
without invalidating the signature. The signature remains valid because
the fingerprint is not part of the signed canonical bytes.

`pq_verify` catches this via a **separate** fingerprint comparison check
(line 383-389 of `main.rs`), but the signature itself does not
cryptographically bind the identity. This means:

1. A tampered fingerprint passes signature verification
2. If `pq_verify` is bypassed or the fingerprint check is removed, the
   attack succeeds silently
3. Any consumer that relies only on signature verification (not the
   separate fingerprint check) is vulnerable

### Impact

An attacker with a compromised key can forge checkpoints claiming to be
signed by a different key. This undermines non-repudiation guarantees.

### Remediation

Include `signer_pub_fingerprint` in `Checkpoint::canonical_bytes()` so that
any change to the fingerprint invalidates the signature. This provides
defense-in-depth alongside the existing separate fingerprint check in pq_verify.


### Remediation (Optional)

**Optional:** Maintain the separate fingerprint check in `pq_verify` for
defense-in-depth, but the signature itself now cryptographically binds the identity.

### Fix Verification (P8.11)

The fix was implemented on the `p8/remediation` branch (`audit_ledger/src/lib.rs`,
`canonical_bytes()`) and verified by 4 regression tests in `raft_p8_regression_p8004.rs`:

| Test | Description | Expected After Fix |
|------|-------------|-------------------|
| `p8_11a` | Tamper fingerprint → signature invalid | ✅ Signature fails |
| `p8_11b` | Tampered fingerprint → chain hash changes | ✅ Chain breaks |
| `p8_11c` | Valid checkpoint with correct fingerprint | ✅ Still verifies |
| `p8_11d` | Canonical bytes deterministic & includes fp | ✅ Fingerprint in bytes |

All 4/4 regression tests pass on `p8/remediation`.

If Byzantine fault tolerance is required (beyond standard Raft's
fail-stop model), add a commit-index guard before truncation:

```rust
// At raft.rs:622, before log.truncate(prev_idx):
let commit_idx = *self.commit_index.read().await;
if prev_idx < commit_idx as usize {
    return AppendEntriesReply {
        term: reply_term,
        success: false,
    };
}
```

This would reject any AppendEntries that would truncate committed entries,
adding defense-in-depth at the Raft layer.

### Regression Test

`p8_001_committed_entry_overwrite_by_byzantine` — sends a same-term
Byzantine AppendEntries that attempts to truncate a committed entry and
documents the outcome.

---

## P8-002: Log Fork via Divergent Entries at Same Index

| Field | Value |
|-------|-------|
| **ID** | P8-002 |
| **Attack** | P8.1 — Byzantine node injection |
| **Invariant** | I3 (fork detection) |
| **Severity** | Low |
| **Status** | Documented |
| **Root Cause** | No cross-follower consistency check on same-index entries |
| **Test** | `p8_1g_fork_via_conflicting_prev_log` |

### Description

A Byzantine leader with a valid term can send different entries at the
same log index to different followers. The followers individually accept
the entries (log matching passes), creating a fork. The fork is resolved
when the legitimate leader's heartbeat overwrites the divergent entries
via quorum intersection — but the divergence exists in the window between
fork creation and legitimate leader recovery.

### Attack Vector

1. Legitimate leader (term 3) sends entry E1 at index 1 to all followers
2. Byzantine leader (term 5, claiming to be a new leader) sends entry E2
   to follower B and entry E3 to follower C, both at index 2 (prev_log_index=1,
   prev_log_term=3 matches)
3. Both followers accept the divergent entries

### Mitigation

- Quorum intersection: with 3 nodes, any two quorums intersect, so a
  legitimate leader will always have the correct entry
- Transport authentication: only authenticated nodes can send AppendEntries
- `pq_verify` detects forks: the checkpoint Merkle root will differ from
  the actual ledger content if entries were tampered

### Note

This is inherent to standard Raft without Byzantine fault tolerance.
The protection model relies on authenticated channels, not on the Raft
protocol alone.

---

## Summary

| ID | Finding | Invariant | Severity | Status |
|----|---------|-----------|----------|--------|
| P8-001 | Committed entry truncation | I3 | Medium | Documented |
| P8-002 | Log fork via divergent entries | I3 | Low | Documented |
| P8-003 | No ML-DSM-87 signing key rotation | Operational | High | **FIXED** on `p8/remediation` (P8.10) |
| P8-004 | `signer_pub_fingerprint` not in canonical bytes | I4 | High | **FIXED** on `p8/remediation` (P8.11) |
| P8-005 | Unbounded ledger growth | I8 | Low | **FIXED** on `p8/remediation` (P8.12) |

Both findings are **expected for standard Raft** (fail-stop model without
Byzantine fault tolerance). They are mitigated by the Vardhan transport
layer's ML-KEM/ML-DSA authentication, which prevents unauthenticated nodes
from sending Raft messages. No code changes to the P7.3 baseline are
required — the findings are documented as inherent limitations of the
non-Byzantine consensus model.
