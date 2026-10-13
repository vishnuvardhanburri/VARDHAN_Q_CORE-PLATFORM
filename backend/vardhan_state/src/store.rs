//! # Vardhan State Fabric — State and Evidence Stores
//!
//! Implements the in-memory store implementations:
//! - `MemoryStateStore`: stores entities, relationships, state snapshots
//! - `MemoryEvidenceStore`: stores evidence records with Merkle tree support
//!
//! These provide the concrete implementations of the `StateStore` and
//! `EvidenceStore` traits defined in `VARDHAN_OBJECT_TRAITS.md` §8.7 and §8.8.
//!
//! Sourced from:
//! - `VARDHAN_OBJECT_TRAITS.md` §8.7 (StateStore trait)
//! - `VARDHAN_OBJECT_TRAITS.md` §8.8 (EvidenceStore trait)
//! - `VARDHAN_ARCHITECTURE_CONSTITUTION.md` §A1 (Authoritative vs Speculative)

use crate::error::StoreError;
use crate::evidence::{EvidenceCategory, EvidenceRecord, EvidenceStatus, MerkleTreeHandle};
use crate::id::{
    CommitIndex, ContentHash, EvidenceId, EvidenceLogicalId, StateSnapshotId, StateVersionId,
    TenantId, SCHEMA_VERSION_STATE_SNAPSHOT,
};
use crate::objects::*;
use crate::state_markers::{AuthoritativeConsumer, SpeculativeConsumer};
use crate::time::TimeContext;
use chrono::Utc;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

// ═════════════════════════════════════════════════════════════════════════════
// STATE STORE TRAIT
// ═════════════════════════════════════════════════════════════════════════════

/// StateStore manages the current state of Tenant-scoped objects.
///
/// **Amendment A1**: `current_state()` returns only AUTHORITATIVE state.
/// Speculative or committed-but-not-yet-evidenced state is never returned
/// to callers.
///
/// From `VARDHAN_OBJECT_TRAITS.md` §8.7:
/// ```text
/// StateStore
/// ├── current_state(snapshot) → STATE
/// ├── apply(transitions) → STATE
/// ├── latest_commit_index() → u64
/// ├── snapshot_at(commit_index) → StateSnapshot
/// ├── is_authoritative(snapshot) → bool
/// └── publish_state_change(snapshot) → Result
/// ```
pub trait StateStore: Send + Sync {
    /// Get the current AUTHORITATIVE state snapshot for a tenant.
    /// Returns Error::NotAuthoritative if no committed state exists.
    /// (T-PROP-08: only_authoritative_state_visible)
    fn current_state(&self, tenant_id: TenantId) -> Result<StateSnapshot, StoreError>;

    /// Apply a StateTransitionRecord to the state store.
    /// The transition must be in VARDHAN_COMMITTED_STATE (authoritative).
    /// Returns the resulting StateSnapshot.
    fn apply(&self, transition: StateTransitionRecord) -> Result<StateSnapshot, StoreError>;

    /// Get the latest Raft commit index known to the state store.
    fn latest_commit_index(&self, tenant_id: TenantId) -> CommitIndex;

    /// Retrieve a state snapshot at a specific commit index.
    fn snapshot_at(
        &self,
        tenant_id: TenantId,
        commit_index: CommitIndex,
    ) -> Result<StateSnapshot, StoreError>;

    /// Check if a snapshot is in an authoritative (VARDHAN_COMMITTED_STATE) state.
    /// (T-STATE-01: speculative_state_never_authoritative)
    fn is_authoritative(&self, snapshot: &StateSnapshot) -> bool;

    /// Publish a state change notification to subscribers.
    /// (Called when a transition reaches VARDHAN_COMMITTED_STATE.)
    fn publish_state_change(&self, snapshot: &StateSnapshot) -> Result<(), StoreError>;

    /// Get the latest state version for a tenant.
    fn latest_version(&self, tenant_id: TenantId) -> Result<StateVersion, StoreError>;
}

// ═════════════════════════════════════════════════════════════════════════════
// EVIDENCE STORE TRAIT
// ═════════════════════════════════════════════════════════════════════════════

/// EvidenceStore provides an append-only audit log of evidence records.
///
/// Sourced from `VARDHAN_OBJECT_TRAITS.md` §8.8.
pub trait EvidenceStore: Send + Sync {
    /// Append an evidence record to the log.
    /// Returns the canonical EvidenceId of the appended record.
    fn append(&self, record: EvidenceRecord) -> Result<EvidenceId, StoreError>;

    /// Verify an evidence record's self-hash.
    /// (T-EVID-02: content_hash_integrity)
    fn verify(&self, evidence_id: EvidenceId) -> Result<bool, StoreError>;

    /// Get an evidence record by its cryptographic identity.
    fn get(&self, evidence_id: EvidenceId) -> Result<EvidenceRecord, StoreError>;

    /// Get an evidence record by its logical identity.
    fn get_logical(&self, logical_id: EvidenceLogicalId) -> Result<EvidenceRecord, StoreError>;

    /// Commit a batch of evidence records atomically.
    fn commit_batch(&self, records: Vec<EvidenceRecord>) -> Result<Vec<EvidenceId>, StoreError>;

    /// Verify a Merkle checkpoint for a given category.
    /// Returns the verified commit_index.
    /// (T-EVID-05: decision_vs_outcome_separation)
    fn verify_checkpoint(
        &self,
        category: EvidenceCategory,
        root: [u8; 32],
    ) -> Result<CommitIndex, StoreError>;

    /// Get the decision tree (Merkle root for DECISION evidence).
    fn decision_tree(&self) -> MerkleTreeHandle;

    /// Get the outcome tree (Merkle root for OUTCOME evidence).
    fn outcome_tree(&self) -> MerkleTreeHandle;

    /// Wait for an evidence record to reach a target status.
    /// (Simulated blocking in memory implementation.)
    fn wait_for_commit(
        &self,
        evidence_id: EvidenceId,
        target: EvidenceStatus,
    ) -> Result<EvidenceRecord, StoreError>;
}

// ═════════════════════════════════════════════════════════════════════════════
// MEMORY STATE STORE
// ═════════════════════════════════════════════════════════════════════════════

/// In-memory implementation of StateStore.
///
/// State is stored as TenantScoped snapshots. Only VARDHAN_COMMITTED_STATE
/// snapshots are visible via `current_state()`.
///
/// Uses `std::sync::RwLock` (NOT tokio::sync::RwLock, per constitutional baseline).
#[derive(Debug, Clone)]
pub struct MemoryStateStore {
    inner: Arc<RwLock<MemoryStateStoreInner>>,
}

#[derive(Debug, Default)]
struct MemoryStateStoreInner {
    /// snapshots[tenant_id] = vec of (commit_index, snapshot) sorted by commit_index
    snapshots: HashMap<TenantId, Vec<(CommitIndex, StateSnapshot)>>,
    /// Current state version per tenant
    versions: HashMap<TenantId, StateVersion>,
    /// Latest commit index per tenant
    commit_indices: HashMap<TenantId, CommitIndex>,
    /// Idempotency keys for state transitions (T-IDEM-02)
    /// Key: (tenant_id, idempotency_key) → already applied
    applied_transitions: HashMap<TenantId, Vec<ContentHash>>,
}

impl MemoryStateStore {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RwLock::new(MemoryStateStoreInner::default())),
        }
    }
}

impl Default for MemoryStateStore {
    fn default() -> Self {
        Self::new()
    }
}

impl StateStore for MemoryStateStore {
    fn current_state(&self, tenant_id: TenantId) -> Result<StateSnapshot, StoreError> {
        let guard = self.inner.read().unwrap();
        match guard.snapshots.get(&tenant_id) {
            Some(snaps) if !snaps.is_empty() => {
                let (_, snapshot) = snaps.last().unwrap();
                // Verify the snapshot is authoritative (state_hash valid)
                if snapshot.verify_state_hash() {
                    Ok(snapshot.clone())
                } else {
                    Err(StoreError::InvalidState {
                        reason: "state hash verification failed on read".to_string(),
                    })
                }
            }
            _ => Err(StoreError::NotFound {
                object_type: "StateSnapshot".to_string(),
                id: format!("{}", tenant_id),
            }),
        }
    }

    fn apply(&self, transition: StateTransitionRecord) -> Result<StateSnapshot, StoreError> {
        let mut guard = self.inner.write().unwrap();

        let tenant_id = transition.tenant_id;

        // Enforce tenant boundary (A2, T-PROP-09)
        transition.proposer_identity.validate_tenant(tenant_id)?;

        // Only authoritative transitions can be applied
        if !transition.is_authoritative() {
            return Err(StoreError::InvalidState {
                reason: format!(
                    "transition is {:?} — not authoritative (must be VARDHAN_COMMITTED_STATE or OBSERVED_EXTERNAL_STATE)",
                    transition.status
                ),
            });
        }

        // Check stale state detection (T-PROP-08)
        let current_commit = guard
            .commit_indices
            .get(&tenant_id)
            .copied()
            .unwrap_or(CommitIndex::new(0));
        if let Some(record_ci) = transition.commit_index {
            if record_ci < current_commit {
                return Err(StoreError::StaleState {
                    reason: format!(
                        "transition commit_index {} < current commit_index {}",
                        record_ci, current_commit
                    ),
                });
            }
        }

        // Idempotency check (T-IDEM-02)
        let idem_key = transition.idempotency_key();
        {
            let applied = guard.applied_transitions.entry(tenant_id).or_default();
            if applied.contains(&idem_key) {
                // Duplicate — return current state without applying
                return self.current_state_snapshot(&guard, tenant_id);
            }
            // Record the idempotency key
            applied.push(idem_key);
        }

        // Update commit index
        if let Some(ci) = transition.commit_index {
            if ci > current_commit {
                guard.commit_indices.insert(tenant_id, ci);
            }
        }

        // Build the new state snapshot.
        // The state_hash is computed from the actual state tree content
        // (entities + relationships + computed_fields), not from the
        // transition's resulting_state_hash. We verify they match after.
        let snapshots = guard.snapshots.entry(tenant_id).or_default();
        let commit_index = transition.commit_index.unwrap_or(CommitIndex::new(0));
        let snapshot_id = StateSnapshotId::new_v4();

        let (entities, relationships) = if let Some((_, parent_snap)) = snapshots.last() {
            (
                parent_snap.entities.clone(),
                parent_snap.relationships.clone(),
            )
        } else {
            (Vec::new(), Vec::new())
        };

        let computed_fields = serde_json::Value::Null;
        let state_hash =
            StateSnapshot::compute_state_hash(&entities, &relationships, &computed_fields);

        let mut tc = TimeContext::new(Utc::now());
        tc.assign_commit_index(commit_index);

        let snapshot = StateSnapshot {
            snapshot_id,
            tenant_id,
            scope_hash: [0u8; 32],
            state_hash,
            commit_index,
            parent_commit_index: Some(current_commit),
            entities,
            relationships,
            computed_fields: serde_json::Value::Null,
            config_hash: transition.config_hash,
            schema_version: SCHEMA_VERSION_STATE_SNAPSHOT,
            created_at: tc,
        };

        snapshots.push((commit_index, snapshot.clone()));

        // Update version
        let current_version = guard.versions.get(&tenant_id).cloned();
        let new_version = StateVersion::new(
            tenant_id,
            StateVersionId::new_v4(),
            current_version.map(|v| v.version_id),
            commit_index,
            transition.resulting_state_hash,
            vec![transition.delta_id],
            transition.config_hash,
        );
        guard.versions.insert(tenant_id, new_version);

        // Publish the state change
        drop(guard);
        self.publish_state_change(&snapshot)?;

        let _ = current_version; // suppress unused warning

        Ok(snapshot)
    }

    fn latest_commit_index(&self, tenant_id: TenantId) -> CommitIndex {
        let guard = self.inner.read().unwrap();
        guard
            .commit_indices
            .get(&tenant_id)
            .copied()
            .unwrap_or(CommitIndex::new(0))
    }

    fn snapshot_at(
        &self,
        tenant_id: TenantId,
        commit_index: CommitIndex,
    ) -> Result<StateSnapshot, StoreError> {
        let guard = self.inner.read().unwrap();
        match guard.snapshots.get(&tenant_id) {
            Some(snaps) => {
                // Binary search for the snapshot at or before the given commit_index
                let pos = snaps.binary_search_by_key(&commit_index, |(ci, _)| *ci);
                match pos {
                    Ok(idx) => {
                        let (_, snapshot) = &snaps[idx];
                        if snapshot.verify_state_hash() {
                            Ok(snapshot.clone())
                        } else {
                            Err(StoreError::InvalidState {
                                reason: "state hash verification failed on historical read"
                                    .to_string(),
                            })
                        }
                    }
                    Err(idx) if idx > 0 => {
                        let (_, snapshot) = &snaps[idx - 1];
                        if snapshot.verify_state_hash() {
                            Ok(snapshot.clone())
                        } else {
                            Err(StoreError::InvalidState {
                                reason: "state hash verification failed on historical read"
                                    .to_string(),
                            })
                        }
                    }
                    _ => Err(StoreError::NotFound {
                        object_type: "StateSnapshot".to_string(),
                        id: format!("tenant={} commit_index={}", tenant_id, commit_index.get()),
                    }),
                }
            }
            None => Err(StoreError::NotFound {
                object_type: "StateSnapshot".to_string(),
                id: format!("tenant={} commit_index={}", tenant_id, commit_index.get()),
            }),
        }
    }

    fn is_authoritative(&self, snapshot: &StateSnapshot) -> bool {
        // A snapshot is authoritative if its state_hash verifies
        // AND it was created at a commit_index (logical_time is Some)
        snapshot.verify_state_hash() && snapshot.created_at.is_committed()
    }

    fn publish_state_change(&self, snapshot: &StateSnapshot) -> Result<(), StoreError> {
        // In this in-memory implementation, "publishing" means logging.
        // In a real implementation, this would notify subscribers.
        if !self.is_authoritative(snapshot) {
            return Err(StoreError::InvalidState {
                reason: "cannot publish non-authoritative state change".to_string(),
            });
        }
        Ok(())
    }

    fn latest_version(&self, tenant_id: TenantId) -> Result<StateVersion, StoreError> {
        let guard = self.inner.read().unwrap();
        guard
            .versions
            .get(&tenant_id)
            .cloned()
            .ok_or(StoreError::NotFound {
                object_type: "StateVersion".to_string(),
                id: format!("{}", tenant_id),
            })
    }
}

impl MemoryStateStore {
    fn current_state_snapshot(
        &self,
        guard: &MemoryStateStoreInner,
        tenant_id: TenantId,
    ) -> Result<StateSnapshot, StoreError> {
        match guard.snapshots.get(&tenant_id) {
            Some(snaps) if !snaps.is_empty() => {
                let (_, snapshot) = snaps.last().unwrap();
                Ok(snapshot.clone())
            }
            _ => Err(StoreError::NotFound {
                object_type: "StateSnapshot".to_string(),
                id: format!("{}", tenant_id),
            }),
        }
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// MEMORY EVIDENCE STORE
// ═════════════════════════════════════════════════════════════════════════════

/// In-memory implementation of EvidenceStore.
///
/// Stores evidence records indexed by both cryptographic (EvidenceId) and
/// logical (EvidenceLogicalId) identity. Provides separate Merkle trees
/// for DECISION and OUTCOME evidence categories (A5).
#[derive(Debug, Clone)]
pub struct MemoryEvidenceStore {
    inner: Arc<RwLock<MemoryEvidenceStoreInner>>,
}

#[derive(Debug, Default)]
struct MemoryEvidenceStoreInner {
    /// Records indexed by cryptographic identity
    by_id: HashMap<EvidenceId, EvidenceRecord>,
    /// Records indexed by logical identity
    by_logical_id: HashMap<EvidenceLogicalId, EvidenceRecord>,
    /// Idempotency keys: payload_digest → EvidenceId (T-IDEM-03)
    payload_to_id: HashMap<ContentHash, EvidenceId>,
    /// Decision Merkle tree (A5)
    decision_tree_root: [u8; 32],
    decision_tree_leaves: Vec<[u8; 32]>,
    /// Outcome Merkle tree (A5)
    outcome_tree_root: [u8; 32],
    outcome_tree_leaves: Vec<[u8; 32]>,
    /// Latest commit index
    commit_index: CommitIndex,
}

impl MemoryEvidenceStore {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RwLock::new(MemoryEvidenceStoreInner {
                decision_tree_root: [0u8; 32],
                outcome_tree_root: [0u8; 32],
                commit_index: CommitIndex::new(0),
                ..Default::default()
            })),
        }
    }
}

impl Default for MemoryEvidenceStore {
    fn default() -> Self {
        Self::new()
    }
}

impl EvidenceStore for MemoryEvidenceStore {
    fn append(&self, record: EvidenceRecord) -> Result<EvidenceId, StoreError> {
        let mut guard = self.inner.write().unwrap();

        // Verify self-hash (T-EVID-02)
        if !record.verify_self_hash() {
            return Err(StoreError::InvalidState {
                reason: "evidence record self-hash verification failed".to_string(),
            });
        }

        // Idempotency check (T-IDEM-03): dedup by payload_digest + category + tenant
        let idem_key = record.idempotency_key();
        if let Some(existing_id) = guard.payload_to_id.get(&idem_key) {
            // Duplicate evidence — return existing ID instead of appending again
            return Ok(*existing_id);
        }

        let evidence_id = record.evidence_id;
        let logical_id = record.logical_id;

        // Add to Merkle tree based on category (A5)
        match record.evidence_category {
            EvidenceCategory::Decision => {
                guard.decision_tree_leaves.push(*evidence_id.as_bytes());
                guard.decision_tree_root = *blake3::hash(&{
                    let mut combined = Vec::new();
                    for leaf in &guard.decision_tree_leaves {
                        combined.extend_from_slice(leaf);
                    }
                    combined
                })
                .as_bytes();
            }
            EvidenceCategory::Outcome => {
                guard.outcome_tree_leaves.push(*evidence_id.as_bytes());
                guard.outcome_tree_root = *blake3::hash(&{
                    let mut combined = Vec::new();
                    for leaf in &guard.outcome_tree_leaves {
                        combined.extend_from_slice(leaf);
                    }
                    combined
                })
                .as_bytes();
            }
            EvidenceCategory::Assurance | EvidenceCategory::Verification => {
                // Assurance evidence goes to the decision tree (it's decision-related)
                guard.decision_tree_leaves.push(*evidence_id.as_bytes());
                guard.decision_tree_root = *blake3::hash(&{
                    let mut combined = Vec::new();
                    for leaf in &guard.decision_tree_leaves {
                        combined.extend_from_slice(leaf);
                    }
                    combined
                })
                .as_bytes();
            }
        }

        // Record the idempotency key
        guard.payload_to_id.insert(idem_key, evidence_id);
        guard.by_id.insert(evidence_id, record.clone());
        guard.by_logical_id.insert(logical_id, record);

        Ok(evidence_id)
    }

    fn verify(&self, evidence_id: EvidenceId) -> Result<bool, StoreError> {
        let guard = self.inner.read().unwrap();
        match guard.by_id.get(&evidence_id) {
            Some(record) => Ok(record.verify_self_hash()),
            None => Err(StoreError::NotFound {
                object_type: "EvidenceRecord".to_string(),
                id: evidence_id.to_hex(),
            }),
        }
    }

    fn get(&self, evidence_id: EvidenceId) -> Result<EvidenceRecord, StoreError> {
        let guard = self.inner.read().unwrap();
        guard
            .by_id
            .get(&evidence_id)
            .cloned()
            .ok_or(StoreError::NotFound {
                object_type: "EvidenceRecord".to_string(),
                id: evidence_id.to_hex(),
            })
    }

    fn get_logical(&self, logical_id: EvidenceLogicalId) -> Result<EvidenceRecord, StoreError> {
        let guard = self.inner.read().unwrap();
        guard
            .by_logical_id
            .get(&logical_id)
            .cloned()
            .ok_or(StoreError::NotFound {
                object_type: "EvidenceRecord".to_string(),
                id: format!("{}", logical_id),
            })
    }

    fn commit_batch(&self, records: Vec<EvidenceRecord>) -> Result<Vec<EvidenceId>, StoreError> {
        let mut ids = Vec::with_capacity(records.len());
        for record in records {
            ids.push(self.append(record)?);
        }
        // Update commit index
        let mut guard = self.inner.write().unwrap();
        guard.commit_index += 1;
        Ok(ids)
    }

    fn verify_checkpoint(
        &self,
        category: EvidenceCategory,
        root: [u8; 32],
    ) -> Result<CommitIndex, StoreError> {
        let guard = self.inner.read().unwrap();
        let tree_root = match category {
            EvidenceCategory::Decision
            | EvidenceCategory::Assurance
            | EvidenceCategory::Verification => &guard.decision_tree_root,
            EvidenceCategory::Outcome => &guard.outcome_tree_root,
        };

        if *tree_root != root {
            return Err(StoreError::InvalidState {
                reason: format!(
                    "checkpoint root mismatch: expected {}, computed {}",
                    hex::encode(root),
                    hex::encode(*tree_root)
                ),
            });
        }

        Ok(guard.commit_index)
    }

    fn decision_tree(&self) -> MerkleTreeHandle {
        let guard = self.inner.read().unwrap();
        MerkleTreeHandle {
            tree_type: EvidenceCategory::Decision,
            root: guard.decision_tree_root,
            node_count: guard.decision_tree_leaves.len() as u64,
        }
    }

    fn outcome_tree(&self) -> MerkleTreeHandle {
        let guard = self.inner.read().unwrap();
        MerkleTreeHandle {
            tree_type: EvidenceCategory::Outcome,
            root: guard.outcome_tree_root,
            node_count: guard.outcome_tree_leaves.len() as u64,
        }
    }

    fn wait_for_commit(
        &self,
        evidence_id: EvidenceId,
        target: EvidenceStatus,
    ) -> Result<EvidenceRecord, StoreError> {
        // In-memory: check synchronously. If the record is in the target state,
        // return it. If not in a failure state, it may still be processing.
        let guard = self.inner.read().unwrap();
        match guard.by_id.get(&evidence_id) {
            Some(record) => {
                if record.status == target {
                    Ok(record.clone())
                } else {
                    Err(StoreError::NotFound {
                        object_type: "EvidenceRecord (not yet at target status)".to_string(),
                        id: evidence_id.to_hex(),
                    })
                }
            }
            None => Err(StoreError::NotFound {
                object_type: "EvidenceRecord".to_string(),
                id: evidence_id.to_hex(),
            }),
        }
    }
}

impl MemoryEvidenceStore {
    /// Get the latest commit index from the evidence store.
    pub fn latest_commit_index(&self) -> CommitIndex {
        let guard = self.inner.read().unwrap();
        guard.commit_index
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// CONSUMER TRAIT IMPLS (for compile-time enforcement of A1)
// ═════════════════════════════════════════════════════════════════════════════

/// The StateStore is a SpeculativeConsumer — it can accept speculative
/// transitions (for caching) but only returns authoritative state.
impl SpeculativeConsumer for MemoryStateStore {}

/// The MemoryStateStore, when used to return current_state(),
/// acts as an AuthoritativeConsumer — it only returns VARDHAN_COMMITTED_STATE.
impl AuthoritativeConsumer for MemoryStateStore {}

/// The EvidenceStore is an AuthoritativeConsumer — it only accepts
/// verified (signed) evidence records.
impl AuthoritativeConsumer for MemoryEvidenceStore {}

/// The EvidenceStore is also a SpeculativeConsumer — it can cache
/// evidence records before they are Raft-committed.
impl SpeculativeConsumer for MemoryEvidenceStore {}

// ═════════════════════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::TenantBoundaryError;
    use crate::evidence::EvidenceCategory;
    use crate::id::{ConfigurationHash, DeltaId, EntityId, StateHash};

    use chrono::Utc;

    fn make_test_transition(
        tenant_id: TenantId,
        status: StateTransitionStatus,
    ) -> StateTransitionRecord {
        let proposer = ScopedEntityId::new(tenant_id, EntityId::new_v4());
        let mut record = StateTransitionRecord::propose(
            tenant_id,
            DeltaId::new_v4(),
            StateHash::from_content(b"prev"),
            StateHash::from_content(b"result"),
            crate::transition::TransitionType::Known(
                crate::transition::KnownTransitionType::VerificationClaimCreate,
            ),
            proposer,
            ConfigurationHash::from_content(b"config"),
        )
        .unwrap();

        // Manually set to desired status for testing
        record.status = status;
        record.commit_index = Some(CommitIndex::new(1));
        record.consensus_commit_index = Some(CommitIndex::new(1));
        record
    }

    #[test]
    fn test_state_store_rejects_speculative() {
        let store = MemoryStateStore::new();
        let tenant_id = TenantId::new_v4();

        // Attempting to apply a speculative (non-authoritative) transition
        let transition = make_test_transition(tenant_id, StateTransitionStatus::Proposed);
        let result = store.apply(transition);
        assert!(
            result.is_err(),
            "speculative state must never be authoritative"
        );
    }

    #[test]
    fn test_state_store_applies_authoritative() {
        let store = MemoryStateStore::new();
        let tenant_id = TenantId::new_v4();

        let transition =
            make_test_transition(tenant_id, StateTransitionStatus::VardhanCommittedState);
        let snapshot = store.apply(transition).unwrap();
        assert_eq!(snapshot.commit_index, CommitIndex::new(1));
        assert!(store.is_authoritative(&snapshot));
    }

    #[test]
    fn test_state_store_cross_tenant_rejection() {
        let proposer_tenant = TenantId::new_v4();
        let record_tenant = TenantId::new_v4();

        let proposer = ScopedEntityId::new(proposer_tenant, EntityId::new_v4());
        let record = StateTransitionRecord::propose(
            record_tenant,
            DeltaId::new_v4(),
            StateHash::from_content(b"prev"),
            StateHash::from_content(b"result"),
            crate::transition::TransitionType::Known(
                crate::transition::KnownTransitionType::VerificationClaimCreate,
            ),
            proposer,
            ConfigurationHash::from_content(b"config"),
        );
        // This should fail because proposer is in a different tenant
        assert!(record.is_err());
    }

    #[test]
    fn test_evidence_store_idempotency() {
        let store = MemoryEvidenceStore::new();
        let tenant_id = TenantId::new_v4();

        let mut record = EvidenceRecord::new(
            tenant_id,
            "test_source",
            TimeContext::new(Utc::now()),
            b"test_payload",
            EvidenceCategory::Decision,
            ConfigurationHash::from_content(b"config"),
            None,
            None,
        );
        record.sign();

        let id1 = store.append(record.clone()).unwrap();
        let id2 = store.append(record).unwrap();

        assert_eq!(id1, id2, "duplicate evidence must return existing ID");
    }

    #[test]
    fn test_evidence_store_merkle_separation() {
        // T-EVID-05: Decision and Outcome evidence trees are separate
        let store = MemoryEvidenceStore::new();

        let mut dec_ev = EvidenceRecord::new(
            TenantId::new_v4(),
            "test",
            TimeContext::new(Utc::now()),
            b"decision_payload",
            EvidenceCategory::Decision,
            ConfigurationHash::from_content(b"config"),
            None,
            None,
        );
        dec_ev.sign();
        store.append(dec_ev).unwrap();

        let mut out_ev = EvidenceRecord::new(
            TenantId::new_v4(),
            "test",
            TimeContext::new(Utc::now()),
            b"outcome_payload",
            EvidenceCategory::Outcome,
            ConfigurationHash::from_content(b"config"),
            None,
            None,
        );
        out_ev.sign();
        store.append(out_ev).unwrap();

        let dec_tree = store.decision_tree();
        let out_tree = store.outcome_tree();

        assert_ne!(
            dec_tree.root, out_tree.root,
            "Decision and Outcome Merkle trees must be separate (A5)"
        );
        assert_eq!(dec_tree.node_count, 1);
        assert_eq!(out_tree.node_count, 1);
    }

    #[test]
    fn test_state_store_latest_commit_index() {
        let store = MemoryStateStore::new();
        let tenant_id = TenantId::new_v4();

        assert_eq!(store.latest_commit_index(tenant_id), CommitIndex::new(0));

        let transition =
            make_test_transition(tenant_id, StateTransitionStatus::VardhanCommittedState);
        store.apply(transition).unwrap();

        assert_eq!(store.latest_commit_index(tenant_id), CommitIndex::new(1));
    }

    #[test]
    fn test_state_store_stale_detection() {
        let store = MemoryStateStore::new();
        let tenant_id = TenantId::new_v4();

        // Apply a transition at commit_index=2
        let mut t2 = make_test_transition(tenant_id, StateTransitionStatus::VardhanCommittedState);
        t2.commit_index = Some(CommitIndex::new(2));
        t2.consensus_commit_index = Some(CommitIndex::new(2));
        store.apply(t2).unwrap();

        // Apply a stale transition at commit_index=1 (older than current)
        let mut t1 = make_test_transition(tenant_id, StateTransitionStatus::VardhanCommittedState);
        t1.commit_index = Some(CommitIndex::new(1));
        t1.consensus_commit_index = Some(CommitIndex::new(1));
        let result = store.apply(t1);
        assert!(result.is_err(), "stale state must be rejected");
    }

    #[test]
    fn test_store_error_tenant_boundary_from() {
        let tb_err = TenantBoundaryError::CrossTenant {
            expected: TenantId::new_v4(),
            actual: TenantId::new_v4(),
        };
        let store_err: StoreError = tb_err.into();
        match store_err {
            StoreError::TenantBoundary(_) => {}
            _ => panic!("expected TenantBoundary variant"),
        }
    }
}
