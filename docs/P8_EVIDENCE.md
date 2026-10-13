# P8 Adversarial Validation — Evidence Report

## Campaign Summary

| Metric | Count |
|--------|-------|
| Original P8 attack campaign tests (against `vP7.3-frozen`) | **44/44 PASS** |
| P8-003 regression tests | **4/4 PASS** |
| P8-004 regression tests | **4/4 PASS** |
| P8.12 segment retention tests | **13/13 PASS** |
| Audit-ledger unit tests | **4/4 PASS** |
| **Total P8 validation tests** | **65/65 PASS** |

> **The four numbers are kept deliberately separate.** The original attack
> campaign against the `vP7.3-frozen` baseline is recorded as 44/44. After
> remediation, the two high-severity findings (P8-003, P8-004) were fixed and
> verified by 8 regression tests. The final milestone P8.12 (resource limits /
> evidence retention) was validated by 13 new tests. The combined validation
> evidence is 65/65 with zero regressions across all prior suites.
>
> **Note on the 44/44 figure:** This records the historical result of the
> attack campaign run against the `vP7.3-frozen` baseline (before remediation).
> Do not describe it as 44 attack tests currently passing on `p8/remediation`
> without qualification: two of those historical attack tests
> (`p8_7d_signer_fingerprint_not_in_signature`, `p8_7e_no_signing_key_rotation_mechanism`)
> now correctly **fail** on `p8/remediation` because the vulnerabilities they
> detect (P8-003, P8-004) have been **fixed**. Their failure is the expected
> outcome and is confirmed by the passing 8/8 regression tests.

---

## Attack Campaign (44/44 against `vP7.3-frozen`)

### Phase P8.1 — Byzantine Node Injection
**File:** `raft_p8_byzantine.rs` · **Tests:** 8/8 · **Result:** PASS

| Test | Description | Finding |
|------|-------------|---------|
| p8_1a_double_vote_protection | At most 1 vote per term per voter | — |
| p8_1b_stale_leader_rejection | Lower-term AE rejected | — |
| p8_1c_wrong_prev_log_term_rejected | Log matching enforced | — |
| p8_1d_same_term_vote_limit | No double-voting in same term | — |
| p8_1e_ae_nonce_sequencing | Nonce = seq(8)‖AAD, monotonic | — |
| p8_1f_ae_nonce_monotonic | No nonce reuse under AEAD | — |
| p8_1g_protocol_version_check | Only version 1 accepted | — |
| p8_001_committed_entry_overwrite_by_byzantine | Truncation without commit_index check | **P8-001** |

### Phase P8.2 — Protocol Fuzzing (AEAD Transport)
**File:** `raft_p8_transport.rs` · **Tests:** 5/5 · **Result:** PASS

| Test | Description | Finding |
|------|-------------|---------|
| p8_2a_frame_too_large | Frame > MAX_FRAME_SIZE + 16 rejected | — |
| p8_2b_truncated_ciphertext | Partial GCM tag rejected | — |
| p8_2c_corrupted_ciphertext | Bit-flip in ciphertext detected | — |
| p8_2d_zero_length_frame | Empty frame rejected | — |
| p8_2e_valid_frame_positive | Legitimate frame accepted | — |

### Phase P8.3 — AEAD Replay / Downgrade
**File:** `raft_p8_transport.rs` · **Tests:** 4/4 · **Result:** PASS

| Test | Description | Finding |
|------|-------------|---------|
| p8_3a_replay_idempotency | Duplicate raft entry rejected | — |
| p8_3b_protocol_version_downgrade | Only version 1 accepted | — |
| p8_3c_nonce_sequencing | Monotonic nonce enforcement | — |
| p8_3d_aad_direction_binding | AAD includes session_id ‖ direction ‖ seq ‖ version ‖ len | — |

### Phase P8.4 — Network Partition
**File:** `raft_p8_partition.rs` · **Tests:** 3/3 · **Result:** PASS

| Test | Description | Finding |
|------|-------------|---------|
| p8_4a_minority_cannot_elect | Partition can't reach quorum | — |
| p8_4b_minority_writes_dont_commit | No commit without quorum | — |
| p8_4c_partition_recovery | Log convergence after recovery | — |

### Phase P8.5 — Crash During Persistence
**File:** `raft_p8_crash_corruption.rs` · **Tests:** 3/3 · **Result:** PASS

| Test | Description | Finding |
|------|-------------|---------|
| p8_5a_torn_write_raft_state | Torn write → None → fresh start | — |
| p8_5b_torn_write_ledger | Torn write → truncated to valid boundary | — |
| p8_5c_torn_write_checkpoint | Torn write → JSON parse error | — |

### Phase P8.6 — Storage Corruption
**File:** `raft_p8_crash_corruption.rs` · **Tests:** 7/7 · **Result:** PASS

| Test | Description | Finding |
|------|-------------|---------|
| p8_6a_corrupted_ledger_chain | prev_hash mismatch detected | — |
| p8_6b_corrupted_checkpoint_merkle | Signature verification fails | — |
| p8_6c_corrupted_checkpoint_sig | Invalid signature rejected | — |
| p8_6d_checkpoint_chain_break | Chain hash mismatch detected | — |
| p8_6e_corrupted_raft_state | Parse failure → fresh start | — |
| p8_6f_mid_chain_corruption | Detected by scan_existing_ledger | — |
| p8_6g_pq_verify_detection | pq_verify subprocess detects corruption | — |

### Phase P8.7 — Key Compromise / Rotation
**File:** `raft_p8_key_compromise.rs` · **Tests:** 6/6 · **Result:** PASS

| Test | Description | Finding |
|------|-------------|---------|
| p8_7a_key_substitution_detected | Wrong key → verification fails | — |
| p8_7b_key_switch_fingerprint | Signer fingerprint mismatch detected | — |
| p8_7c_forged_checkpoint_sig | Forged signature rejected | — |
| p8_7d_signer_fingerprint_not_in_signature | Fingerprint outside signed bytes | **P8-004** |
| p8_7e_no_signing_key_rotation_mechanism | No rotate API exists | **P8-003** |
| p8_7f_merkle_root_under_key_compromise | Merkle root integrity | — |

### Phase P8.8 — Resource Exhaustion
**File:** `raft_p8_resource_exhaustion.rs` · **Tests:** 7/7 · **Result:** PASS

| Test | Description | Finding |
|------|-------------|---------|
| p8_8a_oversized_frame_rejected | > MAX_FRAME_SIZE+16 rejected | — |
| p8_8b_max_frame_boundary | Exactly 256KB accepted | — |
| p8_8c_oversized_write_rejected | Oversized payload rejected | — |
| p8_8d_concurrent_no_buffer_leak | 100 concurrent frames | — |
| p8_8e_nonce_exhaustion_limit | u64 sequence → 2^64 frames | — |
| p8_8f_ledger_unbounded_growth | No size cap | **P8-005** |
| p8_8g_gcm_tag_boundary | MAX_FRAME_SIZE + 16 rejected | — |

### P8.9 — Long-Duration Distributed Soak
**File:** `raft_p8_soak.rs` · **Tests:** 1/1 · **Result:** PASS

| Test | Description | Finding |
|------|-------------|---------|
| p8_9a_continuous_soak_under_failures | 5s soak, 3-node TCP, crash/restart | I2+I3 verified |

### Phase P8.12 — Segment Retention & Evidence Governance
**File:** `raft_p8_segment_retention.rs` · **Tests:** 13/13 · **Result:** PASS

| Test | Description | Invariant |
|------|-------------|-----------|
| p8_12a | Segment rotation at `max_entries` boundary | Active segment rotates when entry count reaches limit |
| p8_12b | Multi-segment chain linkage | `prev_segment_hash` links segments; `verify_all_segments` validates continuity |
| p8_12c | Tamper detection in middle segment | `scan_ledger_segment` detects prev_hash mismatch within a segment |
| p8_12d | Restart recovery resumes correct global seq | `with_limits` restores `total_entries` and chain tip from manifest + file scan |
| p8_12e | Cross-segment merkle root | `merkle_root_across_segments` recomputes from files; tamper changes root |
| p8_12f | Disk-full during append | Write failure propagated; no partial entry in ledger |
| p8_12g | Disk-full during rotation | Rotation handles IO error gracefully |
| p8_12h | Authorized retention deletion | `RetentionAuthorization` allows deletion of archived segments |
| p8_12i | Unauthorized deletion refused | Without `RetentionAuthorization`, `delete_segment` fails |
| p8_12j | Crash during rotation recovery | Torn manifest → `with_limits` resumes from last consistent state |
| p8_12k | Segment boundary with checkpoint | `Checkpoint` seq range aligns to segment boundaries |
| p8_12l | No silent evidence loss | All committed entries present after crash + restart |
| p8_12m | `pq_verify` across segments | `pq_verify` validates all segment files + chain linkage |

---

## Remediation Regression Tests

All regression tests run on the `p8/remediation` branch (forked from
`vP7.3-frozen`), verifying the fixes work without disturbing the immutable
baseline.

### P8-003 Regression (4/4 PASS)
**File:** `raft_p8_regression_p8003.rs`

| Test | Description | Property Verified |
|------|-------------|-------------------|
| p8_10a | Key rotation produces verifiable transition | Old key signs new key (proof of continuity) |
| p8_10b | Rotated key persisted to vault | Reload has new key |
| p8_10c | KEM identity preserved | ML-KEM-1024 unchanged |
| p8_10d | Old key cannot sign after rotation | Old signature invalid against new key |

### P8-004 Regression (4/4 PASS)
**File:** `raft_p8_regression_p8004.rs`

| Test | Description | Property Verified |
|------|-------------|-------------------|
| p8_11a | Fingerprint change invalidates signature | Cryptographic binding |
| p8_11b | Tampered fingerprint breaks chain | Chain hash integrity |
| p8_11c | Valid checkpoint still verifies | No false negatives |
| p8_11d | Canonical bytes deterministic + fingerprint included | Format stability |

### P8.12 Remediation (13/13 PASS)
**File:** `raft_p8_segment_retention.rs`

| Test | Description | Property Verified |
|------|-------------|-------------------|
| p8_12a | Segment rotation at `max_entries=3` for 10 entries | Active segment rotates; ≥4 segments created; `total_entries() == 10` |
| p8_12b | Multi-segment chain linkage across 7 entries | `prev_segment_hash` links segments; `verify_all_segments` passes |
| p8_12c | Tamper detection in middle segment | `scan_ledger_segment` detects prev_hash mismatch; `scan_segmented_ledger` returns Err |
| p8_12d | Restart recovery with `with_limits` | Writer drops, new writer resumes; `total_entries == 8` preserved |
| p8_12e | Cross-segment merkle root | `merkle_root_across_segments` recomputes from files; tamper changes root |
| p8_12f | Disk-full during append | Write failure propagated; no partial entry |
| p8_12g | Disk-full during rotation | IO error during rotation handled gracefully |
| p8_12h | Authorized retention deletion | `RetentionAuthorization` allows deletion of archived segment |
| p8_12i | Unauthorized deletion refused | Without authorization, `delete_segment` returns Err |
| p8_12j | Crash during rotation recovery | Torn manifest → `with_limits` resumes from last consistent state |
| p8_12k | Segment boundary with checkpoint | `Checkpoint` seq range aligns to segment boundary |
| p8_12l | No silent evidence loss | 10 entries survive crash + restart; verified by `scan_segmented_ledger` |
| p8_12m | `pq_verify` across segments | `pq_verify` validates all segment files + chain linkage

---

## Findings Registry

| ID | Title | Severity | Attack Phase | Status |
|----|-------|----------|--------------|--------|
| P8-001 | Committed entry truncation by same-term Byzantine leader (`raft.rs:622`) | Medium | P8.1 | **Documented limitation** — transport-layer mitigated; state-machine hardening recommended |
| P8-002 | Log fork via divergent entries at same index | Medium | P8.1 | **Documented limitation** — crash-stop Raft safety validated; Byzantine behavior outside base Raft fault model |
| P8-003 | No ML-DSA-87 signing key rotation mechanism | High | P8.7 | **FIXED** on `p8/remediation` — `rotate_signing_key()` + `KeyTransitionRecord` |
| P8-004 | `signer_pub_fingerprint` not in signed canonical bytes (`audit_ledger/lib.rs:438`) | High | P8.7 | **FIXED** on `p8/remediation` — added to `canonical_bytes()` |
| P8-005 | No ledger size cap → unbounded disk growth (~9.5KB/entry) | Low | P8.8 | **FIXED** on `p8/remediation` — P8.12: `SegmentedLedgerWriter` with rotation, retention, and crash-safe recovery. 13/13 tests pass. |

---

## Branch Strategy

```
                    vP7.3-frozen (immutable baseline)
                            │
                            └── p8/remediation
                                    │
                                    ├── Commit 0d2a051: P8-004 fix (canonical_bytes)
                                    ├── Commit 4e66179: P8-003 fix (rotate_signing_key)
                                    ├── P8.12: SegmentedLedgerWriter + retention
                                    ├── raft_p8_regression_p8003.rs (4/4 tests)
                                    ├── raft_p8_regression_p8004.rs (4/4 tests)
                                    └── raft_p8_segment_retention.rs (13/13 tests)
```

The frozen P7.3 source files (`raft.rs`, `audit_ledger/src/lib.rs`,
`pq_verify/src/main.rs`, `proxy_engine/src/transport.rs`) are NOT modified
on `vP7.3-frozen`. The P8-004 fix modifies `audit_ledger/src/lib.rs` on
the `p8/remediation` branch only. P8.12 adds `SegmentedLedgerWriter`,
`SegmentManifest`, `SegmentRecord`, and `RetentionAuthorization` to
`audit_ledger/src/lib.rs` on `p8/remediation`.

---

## Remaining Work

### P8.12: Evidence Retention / Storage Governance

P8-005 must be resolved before P8 can be frozen. The design must ensure:

> **Resource limits must not silently invalidate previously committed evidence.**

The evidence lifecycle should be:

```
Hot Ledger
    │
    ├── checkpoint
    │
    ▼
Immutable Evidence Segment
    │
    ├── checkpoint reference
    ├── Merkle commitment
    ├── signer identity
    └── retention metadata
    │
    ▼
Durable Archive
    │
    ▼
Retention / deletion policy
```

P8.12 should test at minimum:
- Maximum active ledger size
- Segment rotation
- Crash during rotation
- Disk-full during append
- Disk-full during rotation
- Restart recovery
- Evidence verification across multiple segments
- Retention deletion only after policy authorization
- No silent loss of checkpointed evidence
- `pq_verify` verification across multiple segments
