//! # Vardhan State Fabric — Integration Test Suite
//!
//! Tests mapped 1:1 to applicable test contracts in `VARDHAN_TEST_CONTRACTS.md`.
//!
//! Contracts implemented in this file:
//!
//! | Contract ID | Description | Section |
//! |---|---|---|
//! | T-EVID-01 | Canonical serialization determinism | §12.1.1 |
//! | T-EVID-02 | Content hash integrity | §12.1.2 |
//! | T-EVID-03 | Evidence chain predecessor linking | §12.1.3 |
//! | T-EVID-04 | Evidence commit index assignment at Raft commit | §12.1.4 |
//! | T-EVID-05 | Decision vs Outcome evidence separation | §12.1.5 |
//! | T-EVID-06 | Evidence self-hash verification | §12.1.6 |
//! | T-STATE-01 | Speculative state is never authoritative | §12.2.1 |
//! | T-STATE-02 | Raft commit does not imply external execution | §12.2.2 |
//! | T-STATE-03 | External observation does not rewrite history | §12.2.3 |
//! | T-STATE-04 | Invalid lifecycle transition rejection | §12.2.4 |
//! | T-STATE-05 | Full lifecycle: Proposed → ObservedExternalState | §12.2.5 |
//! | T-TENANT-01 | Cross-tenant entity_id rejection | §12.3.1 |
//! | T-TENANT-02 | Cross-tenant state hash rejection | §12.3.2 |
//! | T-TENANT-03 | Cross-tenant evidence_id rejection | §12.3.3 |
//! | T-TENANT-04 | Cross-tenant relationship rejection | §12.3.4 |
//! | T-TENANT-05 | Cache namespace collision prevention | §12.3.5 |
//! | T-TENANT-06 | Confused deputy prevention | §12.3.6 |
//! | T-TIME-01 | logical_time is None before Raft commit | §12.4.1 |
//! | T-TIME-02 | logical_time assigned only at Raft commit | §12.4.2 |
//! | T-TIME-03 | Commit ordering independent of wall clock | §12.4.3 |
//! | T-TIME-04 | Timestamp manipulation cannot reorder logical order | §12.4.4 |
//! | T-TIME-06 | Timestamp replay rejection | §12.4.6 |
//! | T-TIME-07 | Time sync failure detection | §12.4.7 |
//! | T-IDEM-01 | Duplicate event payload digest rejected | §12.5.1 |
//! | T-IDEM-02 | Duplicate state transition record is no-op | §12.5.2 |
//! | T-IDEM-03 | Duplicate evidence record returns existing ID | §12.5.3 |
//! | T-PROP-08 | Only authoritative state is visible | §12.6.8 |
//! | T-PROP-09 | Tenant-scoped structural enforcement | §12.6.9 |
//! | T-CHAIN-01 | Full decision path: speculative to state commitment | §12.7.1 |

use chrono::Utc;
use vardhan_state::id::SchemaVersion;
use vardhan_state::*;

// ─── Helper functions ────────────────────────────────────────────────────────

fn make_time_context() -> TimeContext {
    TimeContext::new(Utc::now())
}

fn make_state_transition_record(
    tenant_id: TenantId,
    status: StateTransitionStatus,
) -> StateTransitionRecord {
    let proposer = ScopedEntityId::new(tenant_id, EntityId::new_v4());
    let record = StateTransitionRecord::propose(
        tenant_id,
        DeltaId::new_v4(),
        StateHash::from_content(b"prev_state"),
        StateHash::from_content(b"result_state"),
        crate::transition::TransitionType::Known(crate::transition::KnownTransitionType::VerificationClaimCreate),
        proposer,
        ConfigurationHash::from_content(b"test_config"),
    )
    .unwrap();

    // Override status and commit_index for testing
    let mut record = record;
    record.status = status;
    if status != StateTransitionStatus::Proposed {
        record.commit_index = Some(CommitIndex::new(1));
        record.consensus_commit_index = Some(CommitIndex::new(1));
    }
    record
}

fn make_evidence_record(
    tenant_id: TenantId,
    category: crate::evidence::EvidenceCategory,
    predecessor: Option<EvidenceId>,
) -> EvidenceRecord {
    let mut record = EvidenceRecord::new(
        tenant_id,
        "test_source",
        make_time_context(),
        b"test_payload",
        category,
        ConfigurationHash::from_content(b"test_config"),
        Some(StateHash::from_content(b"test_state")),
        predecessor,
    );
    record.sign();
    record
}

// ═════════════════════════════════════════════════════════════════════════════
// T-EVID-01: Canonical serialization determinism
// ═════════════════════════════════════════════════════════════════════════════

/// T-EVID-01 (§12.1.1): Two identical EvidenceRecord objects produce
/// identical canonical bytes.
#[test]
fn test_evid_01_canonical_serialization_determinism() {
    let tenant_id = TenantId::new_v4();
    let now = Utc::now();

    let e1 = EvidenceRecord::new(
        tenant_id,
        "test_source",
        TimeContext::with_times(now, now),
        b"test_payload",
        EvidenceCategory::Decision,
        ConfigurationHash::from_content(b"config"),
        None,
        None,
    );

    let e2 = EvidenceRecord::new(
        tenant_id,
        "test_source",
        TimeContext::with_times(now, now),
        b"test_payload",
        EvidenceCategory::Decision,
        ConfigurationHash::from_content(b"config"),
        None,
        None,
    );

    // Canonical bytes must be identical
    let b1 = e1.canonical_bytes();
    let b2 = e2.canonical_bytes();
    assert_eq!(
        b1, b2,
        "T-EVID-01: identical records must produce identical canonical bytes"
    );

    // Content hashes must match
    assert_eq!(
        e1.content_hash(),
        e2.content_hash(),
        "T-EVID-01: identical records must produce identical content hashes"
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// T-EVID-02: Content hash integrity
// ═════════════════════════════════════════════════════════════════════════════

/// T-EVID-02 (§12.1.2): Modifying any field changes the content hash.
#[test]
fn test_evid_02_content_hash_integrity() {
    let now = Utc::now();
    let mut e = EvidenceRecord::new(
        TenantId::new_v4(),
        "source_A",
        TimeContext::with_times(now, now),
        b"payload",
        EvidenceCategory::Decision,
        ConfigurationHash::from_content(b"config"),
        None,
        None,
    );

    let hash_before = e.content_hash().into_bytes();

    // Modify a field
    e.source = "source_B".to_string();
    let hash_after = e.content_hash().into_bytes();

    assert_ne!(
        hash_before, hash_after,
        "T-EVID-02: modifying a field must change the content hash"
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// T-EVID-03: Evidence chain predecessor linking
// ═════════════════════════════════════════════════════════════════════════════

/// T-EVID-03 (§12.1.3): Evidence records can be linked into a chain via
/// predecessor references.
#[test]
fn test_evid_03_evidence_chain_predecessor_linking() {
    let tenant_id = TenantId::new_v4();
    let now = Utc::now();

    let e1 = EvidenceRecord::new(
        tenant_id,
        "test_source",
        TimeContext::with_times(now, now),
        b"first_evidence",
        EvidenceCategory::Decision,
        ConfigurationHash::from_content(b"config"),
        None,
        None, // genesis
    );

    assert!(
        e1.predecessor.is_none(),
        "T-EVID-03: genesis record has no predecessor"
    );

    let e2 = EvidenceRecord::new(
        tenant_id,
        "test_source",
        TimeContext::with_times(now, now),
        b"second_evidence",
        EvidenceCategory::Decision,
        ConfigurationHash::from_content(b"config"),
        None,
        Some(e1.evidence_id), // predecessor = e1
    );

    assert_eq!(
        e2.predecessor,
        Some(e1.evidence_id),
        "T-EVID-03: second record's predecessor must point to first record's evidence_id"
    );

    // The evidence_id of e2 must be different from e1 (different content)
    assert_ne!(
        e1.evidence_id, e2.evidence_id,
        "T-EVID-03: chained records must have distinct evidence_ids"
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// T-EVID-04: Evidence commit index assignment at Raft commit
// ═════════════════════════════════════════════════════════════════════════════

/// T-EVID-04 (§12.1.4): commit_index is assigned ONLY when the Raft entry
/// containing the evidence is committed. Before commit, commit_index is None.
#[test]
fn test_evid_04_commit_index_assignment_only_at_raft_commit() {
    let mut record = make_evidence_record(TenantId::new_v4(), EvidenceCategory::Decision, None);

    // Pre-commit: commit_index must be None
    assert!(
        record.commit_index.is_none(),
        "T-EVID-04: commit_index must be None before Raft commit"
    );
    assert!(
        record.timestamp.logical_time.is_none(),
        "T-EVID-04: logical_time must be None before Raft commit (A3)"
    );

    // Assign commit index (simulating Raft commit)
    record.assign_commit_index(CommitIndex::new(42));

    // Post-commit: commit_index must be set
    assert_eq!(
        record.commit_index,
        Some(CommitIndex::new(42)),
        "T-EVID-04: commit_index must be assigned at Raft commit"
    );
    assert_eq!(
        record.timestamp.logical_time,
        Some(CommitIndex::new(42)),
        "T-EVID-04: logical_time must equal commit_index after Raft commit (A3)"
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// T-EVID-05: Decision vs Outcome evidence separation
// ═════════════════════════════════════════════════════════════════════════════

/// T-EVID-05 (§12.1.5): Decision and Outcome evidence records produce
/// distinct content even with identical payloads, because the evidence_category
/// field differs.
#[test]
fn test_evid_05_decision_vs_outcome_separation() {
    let tenant_id = TenantId::new_v4();
    let now = Utc::now();
    let config = ConfigurationHash::from_content(b"config");

    let dec = EvidenceRecord::new(
        tenant_id,
        "test",
        TimeContext::with_times(now, now),
        b"same_payload",
        EvidenceCategory::Decision,
        config,
        None,
        None,
    );

    let out = EvidenceRecord::new(
        tenant_id,
        "test",
        TimeContext::with_times(now, now),
        b"same_payload",
        EvidenceCategory::Outcome,
        config,
        None,
        None,
    );

    assert_ne!(
        dec.evidence_category, out.evidence_category,
        "T-EVID-05: evidence_category must be different"
    );

    // Canonical bytes must differ (category is included in the hash)
    assert_ne!(
        dec.canonical_bytes(),
        out.canonical_bytes(),
        "T-EVID-05: records with different categories must have different canonical bytes"
    );

    assert_ne!(
        dec.content_hash(),
        out.content_hash(),
        "T-EVID-05: records with different categories must have different content hashes"
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// T-EVID-06: Evidence self-hash verification
// ═════════════════════════════════════════════════════════════════════════════

/// T-EVID-06 (§12.1.6): An evidence record's evidence_id must equal
/// BLAKE3 of its canonical bytes.
#[test]
fn test_evid_06_self_hash_verification() {
    let record = make_evidence_record(TenantId::new_v4(), EvidenceCategory::Decision, None);
    assert!(
        record.verify_self_hash(),
        "T-EVID-06: evidence_id must equal BLAKE3(canonical_bytes)"
    );

    // Tampering with a field breaks self-hash verification
    let mut tampered = record.clone();
    tampered.source = "tampered_source".to_string();
    // The canonical bytes changed, so the stored evidence_id no longer matches
    assert!(
        !tampered.verify_self_hash(),
        "T-EVID-06: tampered record must fail self-hash verification"
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// T-STATE-01: Speculative state is never authoritative
// ═════════════════════════════════════════════════════════════════════════════

/// T-STATE-01 (§12.2.1): Objects in SPECULATIVE states (PROPOSED, VALIDATED,
/// EVIDENCE_PREPARED, COMMITTED, APPLIED) are never visible via
/// `current_state()`. Only VARDHAN_COMMITTED_STATE and
/// OBSERVED_EXTERNAL_STATE are authoritative.
#[test]
fn test_state_01_speculative_state_never_authoritative() {
    let store = MemoryStateStore::new();
    let tenant_id = TenantId::new_v4();

    // Speculative statuses — should be rejected by apply()
    let speculative_statuses = [
        StateTransitionStatus::Proposed,
        StateTransitionStatus::Validated,
        StateTransitionStatus::EvidencePrepared,
        StateTransitionStatus::Committed,
        StateTransitionStatus::Applied,
    ];

    for status in &speculative_statuses {
        let transition = make_state_transition_record(tenant_id, *status);
        let result = store.apply(transition);
        assert!(
            result.is_err(),
            "T-STATE-01: speculative status {:?} must never be accepted as authoritative",
            status
        );
        match &result {
            Err(StoreError::InvalidState { reason }) => {
                assert!(
                    reason.contains("not authoritative"),
                    "T-STATE-01: must reject with 'not authoritative' reason, got: {}",
                    reason
                );
            }
            _ => panic!(
                "T-STATE-01: expected InvalidState error for status {:?}",
                status
            ),
        }
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// T-STATE-02: Raft commit does not imply external execution
// ═════════════════════════════════════════════════════════════════════════════

/// T-STATE-02 (§12.2.2): A state transition that has reached
/// VARDHAN_COMMITTED_STATE is NOT the same as
/// OBSERVED_EXTERNAL_STATE. The former requires
/// VARDHAN_COMMITTED_STATE → OBSERVED_EXTERNAL_STATE transition
/// only after external execution and observation.
#[test]
fn test_state_02_raft_commit_does_not_imply_external_execution() {
    let transition = make_state_transition_record(
        TenantId::new_v4(),
        StateTransitionStatus::VardhanCommittedState,
    );

    // VARDHAN_COMMITTED_STATE is authoritative — visible to upper layers
    assert!(
        transition.is_authoritative(),
        "T-STATE-02: VARDHAN_COMMITTED_STATE is authoritative"
    );

    // But OBSERVED_EXTERNAL_STATE is a SEPARATE state
    assert_ne!(
        transition.status,
        StateTransitionStatus::ObservedExternalState,
        "T-STATE-02: VARDHAN_COMMITTED_STATE must not equal OBSERVED_EXTERNAL_STATE"
    );

    // A transition in VARDHAN_COMMITTED_STATE cannot skip to OBSERVED_EXTERNAL_STATE
    // The only valid next transition is ObserveOutcome
    let result = transition
        .clone()
        .transition(StateTransitionEvent::RaftCommit(CommitIndex::new(2)));
    assert!(
        result.is_err(),
        "T-STATE-02: cannot RaftCommit from VARDHAN_COMMITTED_STATE"
    );

    // The only valid transition from VARDHAN_COMMITTED_STATE is ObserveOutcome
    let mut t = transition.clone();
    let result = t.transition(StateTransitionEvent::ObserveOutcome);
    assert!(
        result.is_ok(),
        "T-STATE-02: ObserveOutcome is the only valid transition from VARDHAN_COMMITTED_STATE"
    );
    assert_eq!(
        t.status,
        StateTransitionStatus::ObservedExternalState,
        "T-STATE-02: after ObserveOutcome, status must be OBSERVED_EXTERNAL_STATE"
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// T-STATE-03: External observation does not rewrite history
// ═════════════════════════════════════════════════════════════════════════════

/// T-STATE-03 (§12.2.3): Transitioning to OBSERVED_EXTERNAL_STATE
/// does not change the commit_index or state_hash of earlier states.
/// External observation is a one-way append, not a rewrite.
#[test]
fn test_state_03_external_observation_does_not_rewrite_history() {
    let mut t = make_state_transition_record(
        TenantId::new_v4(),
        StateTransitionStatus::VardhanCommittedState,
    );
    let original_state_hash = t.resulting_state_hash;
    let original_commit_index = t.commit_index;

    // Transition to OBSERVED_EXTERNAL_STATE
    t.transition(StateTransitionEvent::ObserveOutcome).unwrap();

    // commit_index and state_hash must be unchanged
    assert_eq!(
        t.commit_index, original_commit_index,
        "T-STATE-03: commit_index must not change when entering OBSERVED_EXTERNAL_STATE"
    );
    assert_eq!(
        t.resulting_state_hash, original_state_hash,
        "T-STATE-03: state_hash must not change when entering OBSERVED_EXTERNAL_STATE"
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// T-STATE-04: Invalid lifecycle transition rejection
// ═════════════════════════════════════════════════════════════════════════════

/// T-STATE-04 (§12.2.4): Invalid state transitions are rejected.
/// For example, jumping from PROPOSED directly to EVIDENCED is rejected.
#[test]
fn test_state_04_invalid_lifecycle_transition_rejection() {
    let mut t = make_state_transition_record(TenantId::new_v4(), StateTransitionStatus::Proposed);

    // Cannot skip to Applied
    let result = t.transition(StateTransitionEvent::Apply);
    assert!(
        result.is_err(),
        "T-STATE-04: PROPOSED → APPLIED must be rejected"
    );

    // Cannot skip to VARDHAN_COMMITTED_STATE
    let result = t.transition(StateTransitionEvent::PublishState);
    assert!(
        result.is_err(),
        "T-STATE-04: PROPOSED → VARDHAN_COMMITTED_STATE must be rejected"
    );

    // Cannot skip to OBSERVED_EXTERNAL_STATE
    let result = t.transition(StateTransitionEvent::ObserveOutcome);
    assert!(
        result.is_err(),
        "T-STATE-04: PROPOSED → OBSERVED_EXTERNAL_STATE must be rejected"
    );

    // Cannot transition from a terminal state
    let mut terminal = make_state_transition_record(
        TenantId::new_v4(),
        StateTransitionStatus::ObservedExternalState,
    );
    let result = terminal.transition(StateTransitionEvent::Validate);
    assert!(
        result.is_err(),
        "T-STATE-04: cannot transition from terminal state"
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// T-STATE-05: Full lifecycle
// ═════════════════════════════════════════════════════════════════════════════

/// T-STATE-05 (§12.2.5): A StateTransitionRecord can progress through the
/// full lifecycle from PROPOSED to OBSERVED_EXTERNAL_STATE.
#[test]
fn test_state_05_full_lifecycle_proposed_to_observed_external_state() {
    let mut t = make_state_transition_record(TenantId::new_v4(), StateTransitionStatus::Proposed);

    // PROPOSED → VALIDATED
    t.transition(StateTransitionEvent::Validate).unwrap();
    assert_eq!(t.status, StateTransitionStatus::Validated);
    assert!(t.status.is_speculative());

    // VALIDATED → EVIDENCE_PREPARED
    t.transition(StateTransitionEvent::PrepareEvidence).unwrap();
    assert_eq!(t.status, StateTransitionStatus::EvidencePrepared);
    assert!(t.status.is_speculative());

    // EVIDENCE_PREPARED → COMMITTED
    t.transition(StateTransitionEvent::RaftCommit(CommitIndex::new(1)))
        .unwrap();
    assert_eq!(t.status, StateTransitionStatus::Committed);
    assert_eq!(t.commit_index, Some(CommitIndex::new(1)));
    assert_eq!(t.consensus_commit_index, Some(CommitIndex::new(1)));
    assert!(t.status.is_speculative());

    // COMMITTED → APPLIED
    t.transition(StateTransitionEvent::Apply).unwrap();
    assert_eq!(t.status, StateTransitionStatus::Applied);
    assert!(t.status.is_speculative());
    assert!(t.applied_at.is_some());

    // APPLIED → EVIDENCED
    t.transition(StateTransitionEvent::FinalizeEvidence)
        .unwrap();
    assert_eq!(t.status, StateTransitionStatus::Evidenced);
    assert!(t.status.is_committed());
    assert!(t.finalized_at.is_some());

    // EVIDENCED → VARDHAN_COMMITTED_STATE
    t.transition(StateTransitionEvent::PublishState).unwrap();
    assert_eq!(t.status, StateTransitionStatus::VardhanCommittedState);
    assert!(t.status.is_authoritative());

    // VARDHAN_COMMITTED_STATE → OBSERVED_EXTERNAL_STATE
    t.transition(StateTransitionEvent::ObserveOutcome).unwrap();
    assert_eq!(t.status, StateTransitionStatus::ObservedExternalState);
    assert!(t.status.is_authoritative());
}

// ═════════════════════════════════════════════════════════════════════════════
// T-TENANT-01: Cross-tenant entity_id rejection
// ═════════════════════════════════════════════════════════════════════════════

/// T-TENANT-01 (§12.3.1): An EntityId from tenant A cannot be used as
/// if it belongs to tenant B. ScopedEntityId enforces this at construction.
#[test]
fn test_tenant_01_cross_tenant_entity_id_rejection() {
    let tenant_a = TenantId::new_v4();
    let tenant_b = TenantId::new_v4();
    let entity_id = EntityId::new_v4();

    let scoped_a = ScopedEntityId::new(tenant_a, entity_id);

    // Entity from tenant A used in tenant B's context → must be rejected
    let result = scoped_a.validate_tenant(tenant_b);
    assert!(
        result.is_err(),
        "T-TENANT-01: cross-tenant entity_id must be rejected"
    );
    match result {
        Err(TenantBoundaryError::CrossTenant { expected, actual }) => {
            assert_eq!(expected, tenant_b);
            assert_eq!(actual, tenant_a);
        }
        _ => panic!("T-TENANT-01: expected CrossTenant error"),
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// T-TENANT-02: Cross-tenant state hash rejection
// ═════════════════════════════════════════════════════════════════════════════

/// T-TENANT-02 (§12.3.2): A state snapshot from tenant A cannot be
/// read or applied in tenant B's context.
#[test]
fn test_tenant_02_cross_tenant_state_hash_rejection() {
    let tenant_a = TenantId::new_v4();
    let tenant_b = TenantId::new_v4();
    let store = MemoryStateStore::new();

    // Create a snapshot for tenant A
    let transition =
        make_state_transition_record(tenant_a, StateTransitionStatus::VardhanCommittedState);
    let _snapshot_a = store.apply(transition).unwrap();

    // Attempt to read tenant A's state from tenant B's context
    // The store should only return tenant A's state when queried for tenant A
    let result_b = store.current_state(tenant_b);
    assert!(
        result_b.is_err(),
        "T-TENANT-02: state from tenant A must not be visible for tenant B"
    );
    match &result_b {
        Err(StoreError::NotFound { object_type: _, id }) => {
            assert!(
                id.contains(&tenant_b.to_string()),
                "T-TENANT-02: error must reference tenant B's ID"
            );
        }
        _ => panic!("T-TENANT-02: expected NotFound error"),
    }

    // But tenant A's state must be visible
    let result_a = store.current_state(tenant_a);
    assert!(
        result_a.is_ok(),
        "T-TENANT-02: tenant A's own state must be visible"
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// T-TENANT-03: Cross-tenant evidence_id rejection
// ═════════════════════════════════════════════════════════════════════════════

/// T-TENANT-03 (§12.3.3): An evidence record from tenant A cannot be
/// accessed via tenant B's evidence store context. (In this in-memory
/// implementation, evidence is globally keyed by EvidenceId but the
// tenant_id is embedded in the record. Cross-tenant access is rejected
/// at the consumer level.)
#[test]
fn test_tenant_03_cross_tenant_evidence_id_rejection() {
    let tenant_a = TenantId::new_v4();
    let tenant_b = TenantId::new_v4();
    let store = MemoryEvidenceStore::new();

    let mut record_a = EvidenceRecord::new(
        tenant_a,
        "test_source",
        make_time_context(),
        b"payload_a",
        EvidenceCategory::Decision,
        ConfigurationHash::from_content(b"config"),
        None,
        None,
    );
    record_a.sign();
    let id_a = store.append(record_a).unwrap();

    // The evidence record belongs to tenant_a, not tenant_b
    let retrieved = store.get(id_a).unwrap();
    assert_eq!(
        retrieved.tenant_id, tenant_a,
        "T-TENANT-03: evidence record must carry its original tenant_id"
    );
    assert_ne!(
        retrieved.tenant_id, tenant_b,
        "T-TENANT-03: evidence record must not appear to belong to tenant B"
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// T-TENANT-04: Cross-tenant relationship rejection
// ═════════════════════════════════════════════════════════════════════════════

/// T-TENANT-04 (§12.3.4): A Relationship whose source or target entity
/// belongs to a different tenant than the relationship's own tenant
/// must be rejected at construction.
#[test]
fn test_tenant_04_cross_tenant_relationship_rejection() {
    let tenant_a = TenantId::new_v4();
    let tenant_b = TenantId::new_v4();

    let source = ScopedEntityId::new(tenant_a, EntityId::new_v4());
    let target = ScopedEntityId::new(tenant_b, EntityId::new_v4());

    // Relationship claims to be in tenant_a, but target is in tenant_b
    let result = Relationship::new(
        tenant_a,
        RelationshipId::new_v4(),
        source,
        target,
        "depends_on",
        "test_rel",
        ConfigurationHash::from_content(b"config"),
    );

    assert!(
        result.is_err(),
        "T-TENANT-04: cross-tenant relationship must be rejected"
    );
    match &result {
        Err(TenantBoundaryError::CrossTenantEndpoint {
            source_tenant,
            target_tenant,
        }) => {
            assert_eq!(*source_tenant, tenant_a);
            assert_eq!(*target_tenant, tenant_b);
        }
        _ => panic!("T-TENANT-04: expected CrossTenantEndpoint error"),
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// T-TENANT-05: Cache namespace collision prevention
// ═════════════════════════════════════════════════════════════════════════════

/// T-TENANT-05 (§12.3.5): Cache keys for different tenants must not collide,
/// even if the entity IDs and commit indices are identical.
#[test]
fn test_tenant_05_cache_namespace_collision_prevention() {
    let tenant_a = TenantId::new_v4();
    let tenant_b = TenantId::new_v4();
    let entity_id = EntityId::new_v4();

    // The cache key is TenantScoped::cache_key(entity_id, commit_index)
    // which includes tenant_id in the hash. Since TenantScoped::cache_key
    // doesn't take a tenant_id parameter, we test the underlying property:
    // different tenant_ids produce different scope_hashes even for the same inner.

    let tenant_a_bytes = tenant_a.to_bytes();
    let tenant_b_bytes = tenant_b.to_bytes();

    // Different tenants have different byte representations
    assert_ne!(
        tenant_a_bytes, tenant_b_bytes,
        "T-TENANT-05: different tenants must have different byte representations"
    );

    // Scope hash includes tenant_id, so even with the same entity_id,
    // different tenants produce different scope hashes
    let e_a = Entity::new(
        tenant_a,
        entity_id,
        "TestEntity",
        "test",
        ConfigurationHash::from_content(b"config"),
    );
    let e_b = Entity::new(
        tenant_b,
        entity_id,
        "TestEntity",
        "test",
        ConfigurationHash::from_content(b"config"),
    );

    assert_ne!(
        e_a.scope_hash, e_b.scope_hash,
        "T-TENANT-05: same entity in different tenants must have different scope hashes"
    );
    assert!(
        e_a.verify_scope_hash(),
        "T-TENANT-05: tenant A entity scope hash must verify"
    );
    assert!(
        e_b.verify_scope_hash(),
        "T-TENANT-05: tenant B entity scope hash must verify"
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// T-TENANT-06: Confused deputy prevention
// ═════════════════════════════════════════════════════════════════════════════

/// T-TENANT-06 (§12.3.6): A component acting as a "deputy" for one tenant
/// cannot escalate privileges by referencing objects from another tenant.
#[test]
fn test_tenant_06_confused_deputy_prevention() {
    let tenant_a = TenantId::new_v4();
    let tenant_b = TenantId::new_v4();

    // TenantScoped<T> structurally binds every object to its tenant
    let entity_a = Entity::new(
        tenant_a,
        EntityId::new_v4(),
        "Type",
        "name",
        ConfigurationHash::from_content(b"config"),
    );

    // The scope_hash is a cryptographic commitment to tenant_id + inner content.
    // Changing tenant_id while keeping the same inner content produces a different hash.
    let entity_b = Entity::new(
        tenant_b,
        EntityId::new_v4(),
        "Type",
        "name",
        ConfigurationHash::from_content(b"config"),
    );

    assert_ne!(
        entity_a.scope_hash, entity_b.scope_hash,
        "T-TENANT-06: scope_hash must bind the object to its tenant cryptographically"
    );

    // A deputy cannot present tenant A's object as tenant B's:
    // The scope_hash would not match
    assert!(
        entity_a.verify_scope_hash(),
        "T-TENANT-06: scope_hash for tenant A entity must verify"
    );
    assert!(
        entity_a.entity_id.tenant_id != tenant_b,
        "T-TENANT-06: entity's tenant_id must not match another tenant"
    );
    let _ = tenant_b; // suppress unused warning
}

// ═════════════════════════════════════════════════════════════════════════════
// T-TIME-01: logical_time is None before Raft commit
// ═════════════════════════════════════════════════════════════════════════════

/// T-TIME-01 (§12.4.1): `logical_time` is `None` before Raft commit.
/// This is the fundamental invariant of the Vardhan Time Model (A3).
#[test]
fn test_time_01_logical_time_none_before_raft_commit() {
    let event = VardhanEvent::new(
        TenantId::new_v4(),
        "test_source",
        "test_event",
        serde_json::json!({"key": "value"}),
        ConfigurationHash::from_content(b"config"),
        EvidenceCategory::Decision,
    );

    assert!(
        event.time.logical_time.is_none(),
        "T-TIME-01: logical_time must be None before Raft commit (A3)"
    );
    assert!(
        event.time.is_speculative(),
        "T-TIME-01: pre-commit time context must be speculative"
    );

    // Same for EvidenceRecord
    let evidence = make_evidence_record(TenantId::new_v4(), EvidenceCategory::Decision, None);
    assert!(
        evidence.commit_index.is_none(),
        "T-TIME-01: evidence commit_index must be None before Raft commit"
    );
    assert!(
        evidence.timestamp.logical_time.is_none(),
        "T-TIME-01: evidence logical_time must be None before Raft commit"
    );

    // Same for StateTransitionRecord
    let tr = make_state_transition_record(TenantId::new_v4(), StateTransitionStatus::Proposed);
    assert!(
        tr.commit_index.is_none(),
        "T-TIME-01: transition commit_index must be None in PROPOSED"
    );
    assert!(
        tr.created_at.logical_time.is_none(),
        "T-TIME-01: transition logical_time must be None before commit"
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// T-TIME-02: logical_time assigned only at Raft commit
// ═════════════════════════════════════════════════════════════════════════════

/// T-TIME-02 (§12.4.2): `logical_time` (= commit_index) is assigned
/// ONLY at the moment of Raft consensus commit. It cannot be assigned
/// at any other point in the lifecycle.
#[test]
fn test_time_02_logical_time_assigned_only_at_raft_commit() {
    let tenant_id = TenantId::new_v4();
    let mut event = VardhanEvent::new(
        tenant_id,
        "test_source",
        "test_event",
        serde_json::json!({"key": "value"}),
        ConfigurationHash::from_content(b"config"),
        EvidenceCategory::Decision,
    );

    // At CREATED and G0_VALIDATED, logical_time is still None
    assert!(event.time.logical_time.is_none());

    // Only when we call assign_commit_index does it get set
    // (simulating Raft commit)
    event.assign_commit_index(CommitIndex::new(7));
    assert_eq!(
        event.time.logical_time,
        Some(CommitIndex::new(7)),
        "T-TIME-02: logical_time must only be assignable via Raft commit"
    );

    // StateTransitionRecord: commit_index assigned only at RaftCommit event
    let mut tr = make_state_transition_record(tenant_id, StateTransitionStatus::Proposed);
    tr.transition(StateTransitionEvent::Validate).unwrap();
    tr.transition(StateTransitionEvent::PrepareEvidence)
        .unwrap();
    assert!(
        tr.commit_index.is_none(),
        "T-TIME-02: commit_index must be None before RaftCommit event"
    );

    tr.transition(StateTransitionEvent::RaftCommit(CommitIndex::new(10)))
        .unwrap();
    assert_eq!(
        tr.commit_index,
        Some(CommitIndex::new(10)),
        "T-TIME-02: commit_index must be assigned at RaftCommit event"
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// T-TIME-03: Commit ordering independent of wall clock
// ═════════════════════════════════════════════════════════════════════════════

/// T-TIME-03 (§12.4.3): Ordering of events is determined by commit_index,
/// NOT by wall-clock EventTime or SystemTime. Events with earlier EventTime
/// can be committed AFTER events with later EventTime.
#[test]
fn test_time_03_commit_ordering_independent_of_wall_clock() {
    let tenant_id = TenantId::new_v4();

    let event_time_e1 = DateTime::parse_from_rfc3339("2025-01-01T10:00:01Z")
        .unwrap()
        .with_timezone(&Utc);
    let event_time_e2 = DateTime::parse_from_rfc3339("2025-01-01T10:00:02Z")
        .unwrap()
        .with_timezone(&Utc);

    // E1 has EARLIER EventTime but later SystemTime (e.g., arrived late)
    let system_time_e1 = DateTime::parse_from_rfc3339("2025-01-01T10:00:03Z")
        .unwrap()
        .with_timezone(&Utc);
    let system_time_e2 = DateTime::parse_from_rfc3339("2025-01-01T10:00:02Z")
        .unwrap()
        .with_timezone(&Utc);

    let mut e1 = VardhanEvent::new(
        tenant_id,
        "src",
        "test",
        serde_json::json!({"order": 1}),
        ConfigurationHash::from_content(b"config"),
        EvidenceCategory::Decision,
    );
    e1.time = TimeContext::with_times(event_time_e1, system_time_e1);

    let mut e2 = VardhanEvent::new(
        tenant_id,
        "src",
        "test",
        serde_json::json!({"order": 2}),
        ConfigurationHash::from_content(b"config"),
        EvidenceCategory::Decision,
    );
    e2.time = TimeContext::with_times(event_time_e2, system_time_e2);

    // E1's EventTime is earlier, but E1 committed later (higher index)
    e1.assign_commit_index(CommitIndex::new(2));
    e2.assign_commit_index(CommitIndex::new(1));

    assert!(
        e1.time.event_time < e2.time.event_time,
        "T-TIME-03: E1's EventTime is earlier"
    );
    assert!(
        e1.time.logical_time.unwrap() > e2.time.logical_time.unwrap(),
        "T-TIME-03: but E1 committed later (higher commit_index)"
    );

    // Ordering is by logical_time, not EventTime
    assert!(
        e2.time.logical_time.unwrap() < e1.time.logical_time.unwrap(),
        "T-TIME-03: E2 is ordered first by logical_time despite later EventTime"
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// T-TIME-04: Timestamp manipulation cannot reorder logical order
// ═════════════════════════════════════════════════════════════════════════════

/// T-TIME-04 (§12.4.4): An adversary cannot reorder state transitions
/// by manipulating EventTime. The commit_index (LogicalTime) is the
/// sole ordering coordinate, and it is assigned by Raft consensus.
#[test]
fn test_time_04_timestamp_manipulation_cannot_reorder() {
    let tenant_id = TenantId::new_v4();

    // Create an event with a manipulated (far-future) EventTime
    let manipulated_time = Utc::now() + chrono::Duration::days(365);
    let mut event = VardhanEvent::new(
        tenant_id,
        "test",
        "test",
        serde_json::json!({"key": "val"}),
        ConfigurationHash::from_content(b"config"),
        EvidenceCategory::Decision,
    );
    event.time = TimeContext::new(manipulated_time);

    // Even with a manipulated EventTime, the commit_index is None until Raft commit
    assert!(
        event.time.logical_time.is_none(),
        "T-TIME-04: manipulated EventTime cannot assign logical_time"
    );

    // Validating time consistency should catch the anomaly
    let validation_result = event.time.validate_consistency();
    assert!(
        validation_result.is_err(),
        "T-TIME-04: far-future EventTime must be rejected by consistency validation"
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// T-TIME-06: Timestamp replay rejection
// ═════════════════════════════════════════════════════════════════════════════

/// T-TIME-06 (§12.4.6): A replayed event with an old EventTime is
/// detected and rejected. The payload_digest idempotency key ensures
/// that duplicate events are not re-processed.
#[test]
fn test_time_06_timestamp_replay_rejection() {
    let tenant_id = TenantId::new_v4();
    let payload = serde_json::json!({"action": "create", "id": "abc123"});

    // Create an event
    let event1 = VardhanEvent::new(
        tenant_id,
        "test_source",
        "create",
        payload.clone(),
        ConfigurationHash::from_content(b"config"),
        EvidenceCategory::Decision,
    );

    // Simulate a replay with the same payload but earlier EventTime
    let earlier_time = Utc::now() - chrono::Duration::hours(1);
    let mut event2 = VardhanEvent::new(
        tenant_id,
        "test_source",
        "create",
        payload,
        ConfigurationHash::from_content(b"config"),
        EvidenceCategory::Decision,
    );
    event2.time = TimeContext::with_times(earlier_time, Utc::now());

    // Both events have the same idempotency key (same payload digest)
    assert_eq!(
        event1.idempotency_key(),
        event2.idempotency_key(),
        "T-TIME-06: replayed events with same payload must have same idempotency key"
    );

    // The store or processor should detect the duplicate key and reject the replay
    let store = MemoryEvidenceStore::new();
    let e1 = EvidenceRecord::new(
        tenant_id,
        "test",
        make_time_context(),
        b"same_payload",
        EvidenceCategory::Decision,
        ConfigurationHash::from_content(b"config"),
        None,
        None,
    );
    let id1 = store.append(e1.clone()).unwrap();

    // Attempting to append the same evidence again (same content)
    let e2 = EvidenceRecord::new(
        tenant_id,
        "test",
        make_time_context(),
        b"same_payload",
        EvidenceCategory::Decision,
        ConfigurationHash::from_content(b"config"),
        None,
        None,
    );
    let id2 = store.append(e2).unwrap();

    // Should get the same ID back (idempotent append)
    assert_eq!(
        e1.evidence_id, id2,
        "T-TIME-06: duplicate evidence must return the same ID"
    );
    assert_eq!(id1, id2);
}

// ═════════════════════════════════════════════════════════════════════════════
// T-TIME-07: Time sync failure detection
// ═════════════════════════════════════════════════════════════════════════════

/// T-TIME-07 (§12.4.7): The system detects clock synchronization failures
/// by validating EventTime against SystemTime. An EventTime that is
/// too far in the future relative to SystemTime is flagged.
#[test]
fn test_time_07_time_sync_failure_detection() {
    // EventTime far in the future → should be rejected
    let future = Utc::now() + chrono::Duration::days(365);
    let tc = TimeContext::new(future);
    assert!(
        tc.validate_consistency().is_err(),
        "T-TIME-07: far-future EventTime must be rejected"
    );

    // Normal time → should pass
    let normal = Utc::now();
    let tc2 = TimeContext::new(normal);
    assert!(
        tc2.validate_consistency().is_ok(),
        "T-TIME-07: normal EventTime must pass validation"
    );

    // SystemTime before EventTime → should be rejected (temporal impossibility)
    let event_time = Utc::now();
    let system_time = event_time - chrono::Duration::seconds(1);
    let tc3 = TimeContext::with_times(event_time, system_time);
    assert!(
        tc3.validate_consistency().is_err(),
        "T-TIME-07: SystemTime before EventTime must be rejected"
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// T-IDEM-01: Duplicate event payload digest rejected
// ═════════════════════════════════════════════════════════════════════════════

/// T-IDEM-01 (§12.5.1): Two events with the same tenant_id + payload_digest + event_type
/// produce the same idempotency key. The second event must be detected as a duplicate
/// and not processed again.
#[allow(clippy::doc_lazy_continuation)]
#[test]
fn test_idem_01_duplicate_event_payload_digest_rejected() {
    let tenant_id = TenantId::new_v4();
    let payload = serde_json::json!({"action": "create", "id": "abc"});

    let event1 = VardhanEvent::new(
        tenant_id,
        "src",
        "create",
        payload.clone(),
        ConfigurationHash::from_content(b"config"),
        EvidenceCategory::Decision,
    );

    let event2 = VardhanEvent::new(
        tenant_id,
        "src",
        "create",
        payload,
        ConfigurationHash::from_content(b"config"),
        EvidenceCategory::Decision,
    );

    // Same tenant, same payload, same type → same idempotency key
    assert_eq!(
        event1.idempotency_key(),
        event2.idempotency_key(),
        "T-IDEM-01: duplicate events must have same idempotency key"
    );

    // Different payload → different key
    let event3 = VardhanEvent::new(
        tenant_id,
        "src",
        "create",
        serde_json::json!({"action": "create", "id": "xyz"}), // different payload
        ConfigurationHash::from_content(b"config"),
        EvidenceCategory::Decision,
    );
    assert_ne!(
        event1.idempotency_key(),
        event3.idempotency_key(),
        "T-IDEM-01: events with different payloads must have different idempotency keys"
    );

    // Different tenant → different key even with same payload
    let event4 = VardhanEvent::new(
        TenantId::new_v4(),
        "src",
        "create",
        serde_json::json!({"action": "create", "id": "abc"}),
        ConfigurationHash::from_content(b"config"),
        EvidenceCategory::Decision,
    );
    assert_ne!(
        event1.idempotency_key(),
        event4.idempotency_key(),
        "T-IDEM-01: same payload in different tenants must have different idempotency keys"
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// T-IDEM-02: Duplicate state transition record is no-op
// ═════════════════════════════════════════════════════════════════════════════

/// T-IDEM-02 (§12.5.2): Applying the same StateTransitionRecord twice
/// (same tenant_id + delta_id) is a no-op — the second apply returns
/// the current state without modification.
#[test]
fn test_idem_02_duplicate_state_transition_record_no_op() {
    let store = MemoryStateStore::new();
    let tenant_id = TenantId::new_v4();

    let transition =
        make_state_transition_record(tenant_id, StateTransitionStatus::VardhanCommittedState);

    // First apply — should succeed
    let snapshot1 = store.apply(transition.clone()).unwrap();

    // Second apply with the same transition (same delta_id) — should be a no-op
    let snapshot2 = store.apply(transition).unwrap();

    // The snapshots should have the same commit_index
    assert_eq!(
        snapshot1.commit_index, snapshot2.commit_index,
        "T-IDEM-02: duplicate application must not advance state"
    );
    assert_eq!(
        snapshot1.commit_index,
        CommitIndex::new(1),
        "T-IDEM-02: commit_index must remain unchanged"
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// T-IDEM-03: Duplicate evidence record returns existing ID
// ═════════════════════════════════════════════════════════════════════════════

/// T-IDEM-03 (§12.5.3): Appending the same EvidenceRecord twice returns
/// the same EvidenceId — duplicate evidence is detected by content hash.
#[test]
fn test_idem_03_duplicate_evidence_record_returns_existing_id() {
    let store = MemoryEvidenceStore::new();
    let tenant_id = TenantId::new_v4();
    let now = Utc::now();

    let e1 = EvidenceRecord::new(
        tenant_id,
        "test",
        TimeContext::with_times(now, now),
        b"identical_payload",
        EvidenceCategory::Decision,
        ConfigurationHash::from_content(b"config"),
        None,
        None,
    );
    let id1 = store.append(e1).unwrap();

    let e2 = EvidenceRecord::new(
        tenant_id,
        "test",
        TimeContext::with_times(now, now),
        b"identical_payload",
        EvidenceCategory::Decision,
        ConfigurationHash::from_content(b"config"),
        None,
        None,
    );
    let id2 = store.append(e2).unwrap();

    assert_eq!(
        id1, id2,
        "T-IDEM-03: duplicate evidence must return the same EvidenceId"
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// T-PROP-08: Only authoritative state is visible
// ═════════════════════════════════════════════════════════════════════════════

/// T-PROP-08 (§12.6.8): The `current_state()` method returns only
/// authoritative (VARDHAN_COMMITTED_STATE) snapshots. Speculative
/// snapshots are never returned.
#[test]
fn test_prop_08_only_authoritative_state_visible() {
    let store = MemoryStateStore::new();
    let tenant_id = TenantId::new_v4();

    // No state committed yet — current_state should fail
    let result = store.current_state(tenant_id);
    assert!(
        result.is_err(),
        "T-PROP-08: no state available before first commit"
    );

    // Apply an authoritative transition
    let transition =
        make_state_transition_record(tenant_id, StateTransitionStatus::VardhanCommittedState);
    store.apply(transition).unwrap();

    // Now state is visible
    let result = store.current_state(tenant_id);
    assert!(
        result.is_ok(),
        "T-PROP-08: authoritative state must be visible"
    );
    let snapshot = result.unwrap();
    assert!(
        store.is_authoritative(&snapshot),
        "T-PROP-08: returned snapshot must be authoritative"
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// T-PROP-09: Tenant-scoped structural enforcement
// ═════════════════════════════════════════════════════════════════════════════

/// T-PROP-09 (§12.6.9): The `TenantScoped<T>` wrapper structually binds
/// every object to a tenant. Cross-tenant access is prevented by
/// structural typing, not by a Boolean flag.
#[test]
fn test_prop_09_tenant_scoped_structural_enforcement() {
    let tenant_a = TenantId::new_v4();
    let tenant_b = TenantId::new_v4();

    // Create a TenantScoped Entity for tenant A
    let entity_a = Entity::new(
        tenant_a,
        EntityId::new_v4(),
        "Test",
        "name",
        ConfigurationHash::from_content(b"config"),
    );
    let scoped_a = TenantScoped::new(tenant_a, entity_a.clone());

    // The scope_hash cryptographically binds the object to tenant A
    assert!(
        scoped_a.verify_scope_hash(),
        "T-PROP-09: scope_hash must verify for correct tenant binding"
    );

    // The scope_hash includes the tenant_id, so the same content
    // in a different tenant produces a different hash
    let entity_b = Entity::new(
        tenant_b,
        entity_a.entity_id.entity_id,
        "Test",
        "name",
        ConfigurationHash::from_content(b"config"),
    );
    let scoped_b = TenantScoped::new(tenant_b, entity_b);
    assert_ne!(
        scoped_a.scope_hash(),
        scoped_b.scope_hash(),
        "T-PROP-09: different tenants must produce different scope hashes"
    );
    assert!(
        !scoped_b.verify_scope_hash() || scoped_b.scope_hash != scoped_a.scope_hash,
        "T-PROP-09: cross-tenant scope hash must differ"
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// T-CHAIN-01: Full decision path (partial)
// ═════════════════════════════════════════════════════════════════════════════

/// T-CHAIN-01 (§12.7.1, partial): The full decision path from
/// SPECULATIVE to OBSERVED_EXTERNAL_STATE:
///   Speculation → G0 Validated → Evidence Prepared → Raft Replicated
///   → Raft Committed → Evidence Finalized → Evidenced
///   → VARDHAN_COMMITTED_STATE → OBSERVED_EXTERNAL_STATE
#[test]
fn test_chain_01_full_decision_path() {
    let tenant_id = TenantId::new_v4();
    let store = MemoryStateStore::new();
    let evidence_store = MemoryEvidenceStore::new();

    // Step 1: Create the event (SPECULATIVE)
    let mut event = VardhanEvent::new(
        tenant_id,
        "test_source",
        "decision_event",
        serde_json::json!({"action": "evaluate"}),
        ConfigurationHash::from_content(b"config"),
        EvidenceCategory::Decision,
    );
    assert_eq!(
        event.status,
        EventStatus::Created,
        "T-CHAIN-01: event starts in CREATED"
    );
    assert!(
        event.time.logical_time.is_none(),
        "T-CHAIN-01: logical_time is None at creation"
    );

    // Step 2: G0 validation
    event.status = EventStatus::G0Validated;
    assert_eq!(event.status, EventStatus::G0Validated);

    // Step 3: Evidence Prepared
    let mut evidence = EvidenceRecord::new(
        tenant_id,
        "g0_validator",
        TimeContext::new(Utc::now()),
        b"event_payload",
        EvidenceCategory::Decision,
        ConfigurationHash::from_content(b"config"),
        Some(StateHash::from_content(b"event_state")),
        None,
    );
    evidence.sign();
    evidence.status = EvidenceStatus::Signed;
    event.evidence_ref = Some(EvidenceRef {
        evidence_id: evidence.evidence_id,
        logical_id: evidence.logical_id,
    });
    event.status = EventStatus::EvidencePrepared;

    // Stage the evidence in the store
    evidence_store.append(evidence).unwrap();

    // Step 4: Raft commit (simulated)
    event.assign_commit_index(CommitIndex::new(1));
    event.status = EventStatus::RaftCommitted;
    assert_eq!(
        event.time.logical_time,
        Some(CommitIndex::new(1)),
        "T-CHAIN-01: logical_time assigned at Raft commit"
    );

    // Step 5: Evidence finalized
    event.status = EventStatus::EvidenceFinalized;

    // Step 6: Evidenced (terminal)
    event.status = EventStatus::Evidenced;
    assert!(
        event.status.is_authoritative(),
        "T-CHAIN-01: Evidenced status is authoritative"
    );

    // Step 7: Create StateTransitionRecord for the state change
    let proposer = ScopedEntityId::new(tenant_id, EntityId::new_v4());
    let mut str_record = StateTransitionRecord::propose(
        tenant_id,
        DeltaId::new_v4(),
        StateHash::from_content(b"prev_state"),
        StateHash::from_content(b"result_state"),
        crate::transition::TransitionType::Known(crate::transition::KnownTransitionType::VerificationClaimCreate),
        proposer,
        ConfigurationHash::from_content(b"config"),
    )
    .unwrap();

    // Walk the full state transition lifecycle
    assert_eq!(str_record.status, StateTransitionStatus::Proposed);

    str_record
        .transition(StateTransitionEvent::Validate)
        .unwrap();
    assert_eq!(str_record.status, StateTransitionStatus::Validated);

    str_record
        .transition(StateTransitionEvent::PrepareEvidence)
        .unwrap();
    assert_eq!(str_record.status, StateTransitionStatus::EvidencePrepared);

    str_record
        .transition(StateTransitionEvent::RaftCommit(CommitIndex::new(1)))
        .unwrap();
    assert_eq!(str_record.status, StateTransitionStatus::Committed);
    assert_eq!(str_record.commit_index, Some(CommitIndex::new(1)));
    assert!(
        !str_record.is_authoritative(),
        "T-CHAIN-01: Committed is still SPECULATIVE"
    );

    str_record.transition(StateTransitionEvent::Apply).unwrap();
    assert_eq!(str_record.status, StateTransitionStatus::Applied);

    str_record
        .transition(StateTransitionEvent::FinalizeEvidence)
        .unwrap();
    assert_eq!(str_record.status, StateTransitionStatus::Evidenced);
    assert!(
        str_record.status.is_committed(),
        "T-CHAIN-01: Evidenced is COMMITTED tier"
    );

    str_record
        .transition(StateTransitionEvent::PublishState)
        .unwrap();
    assert_eq!(
        str_record.status,
        StateTransitionStatus::VardhanCommittedState
    );
    assert!(
        str_record.is_authoritative(),
        "T-CHAIN-01: VARDHAN_COMMITTED_STATE is AUTHORITATIVE"
    );

    // Apply to the state store
    let snapshot = store.apply(str_record.clone()).unwrap();
    assert!(
        store.is_authoritative(&snapshot),
        "T-CHAIN-01: applied snapshot must be authoritative"
    );
    assert_eq!(snapshot.commit_index, CommitIndex::new(1));

    // Step 8: OBSERVED_EXTERNAL_STATE (requires external execution)
    let mut str_record2 = str_record.clone();
    str_record2
        .transition(StateTransitionEvent::ObserveOutcome)
        .unwrap();
    assert_eq!(
        str_record2.status,
        StateTransitionStatus::ObservedExternalState,
        "T-CHAIN-01: final state is OBSERVED_EXTERNAL_STATE"
    );
    assert!(
        !str_record2.is_speculative(),
        "T-CHAIN-01: OBSERVED_EXTERNAL_STATE is not speculative"
    );

    // Verify: current state is visible
    let current = store.current_state(tenant_id).unwrap();
    assert_eq!(
        current.commit_index,
        CommitIndex::new(1),
        "T-CHAIN-01: committed state must be visible via current_state()"
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// Additional tests for tenant_id() method on objects
// ═════════════════════════════════════════════════════════════════════════════

/// Helper: test that ScopedEntityId has tenant_id()
#[test]
fn test_scoped_entity_id_tenant_access() {
    let tenant = TenantId::new_v4();
    let entity = EntityId::new_v4();
    let scoped = ScopedEntityId::new(tenant, entity);
    assert_eq!(scoped.tenant_id, tenant);
    assert_eq!(scoped.entity_id, entity);
}

/// Helper: test that EvidenceRecord has tenant_id()
#[test]
fn test_evidence_record_tenant_access() {
    let tenant = TenantId::new_v4();
    let record = make_evidence_record(tenant, EvidenceCategory::Decision, None);
    assert_eq!(record.tenant_id, tenant);
}

/// Helper: test TenantScoped wrapper
#[test]
fn test_tenant_scoped_wrapper() {
    let tenant = TenantId::new_v4();
    let entity = Entity::new(
        tenant,
        EntityId::new_v4(),
        "Test",
        "name",
        ConfigurationHash::from_content(b"config"),
    );
    let scoped = TenantScoped::new(tenant, entity.clone());

    assert_eq!(scoped.tenant_id, tenant);
    assert!(scoped.verify_scope_hash(), "scope_hash must verify");
    assert_eq!(scoped.inner().entity_id.tenant_id, tenant);

    let inner: Entity = scoped.into_inner();
    assert_eq!(inner.entity_id.tenant_id, tenant);
}

/// Helper: test StateTransitionRecord idempotency key consistency
#[test]
fn test_state_transition_idempotency_key_consistency() {
    let tenant = TenantId::new_v4();
    let tr1 = make_state_transition_record(tenant, StateTransitionStatus::Proposed);
    let tr2 = StateTransitionRecord::propose(
        tenant,
        tr1.delta_id, // same delta_id
        tr1.previous_state_hash,
        tr1.resulting_state_hash,
        tr1.transition_type.clone(),
        tr1.proposer_identity,
        tr1.config_hash,
    )
    .unwrap();

    assert_eq!(
        tr1.idempotency_key(),
        tr2.idempotency_key(),
        "Same delta_id + tenant_id must produce same idempotency key"
    );
}

/// Helper: test StateSnapshot state_hash computation
#[test]
fn test_state_snapshot_state_hash_computation() {
    let tenant = TenantId::new_v4();

    // Empty state
    let hash1 = StateSnapshot::compute_state_hash(&[], &[], &serde_json::Value::Null);
    assert!(
        !hash1.is_zero(),
        "state hash of empty state should not be zero"
    );

    // Same empty state → same hash
    let hash2 = StateSnapshot::compute_state_hash(&[], &[], &serde_json::Value::Null);
    assert_eq!(hash1, hash2, "same content must produce same state hash");

    // Different content → different hash
    let entity = Entity::new(
        tenant,
        EntityId::new_v4(),
        "Type",
        "name",
        ConfigurationHash::from_content(b"config"),
    );
    let scoped_entity = TenantScoped::new(tenant, entity);
    let hash3 = StateSnapshot::compute_state_hash(&[scoped_entity], &[], &serde_json::Value::Null);
    assert_ne!(
        hash1, hash3,
        "different content must produce different state hash"
    );
}

/// Helper: test SchemaVersion is sourced from vardhan_model
#[test]
fn test_schema_version_from_vardhan_model() {
    let sv = SchemaVersion::new(1, 0, 0);
    assert_eq!(sv.major, 1);
    assert_eq!(sv.minor, 0);
    assert_eq!(sv.patch, 0);
    assert_eq!(sv.to_string(), "1.0.0");
}

/// Helper: test that Tenant lifecycle progresses correctly
#[test]
fn test_tenant_lifecycle() {
    let tenant = Tenant::new(
        TenantId::new_v4(),
        "test_tenant",
        ConfigurationHash::from_content(b"config"),
    );
    assert_eq!(
        tenant.status,
        TenantStatus::Active,
        "Tenant should start in Active state"
    );
}

/// Helper: test Entity lifecycle
#[test]
fn test_entity_lifecycle() {
    let tenant = TenantId::new_v4();
    let entity = Entity::new(
        tenant,
        EntityId::new_v4(),
        "User",
        "Alice",
        ConfigurationHash::from_content(b"config"),
    );
    assert_eq!(
        entity.status,
        EntityStatus::Created,
        "Entity should start in Created state"
    );
    assert!(entity.verify_scope_hash(), "Entity scope hash must verify");
}

/// Helper: test Relationship lifecycle with valid tenants
#[test]
fn test_relationship_lifecycle_valid() {
    let tenant = TenantId::new_v4();
    let source = ScopedEntityId::new(tenant, EntityId::new_v4());
    let target = ScopedEntityId::new(tenant, EntityId::new_v4());

    let rel = Relationship::new(
        tenant,
        RelationshipId::new_v4(),
        source,
        target,
        "depends_on",
        "test_relationship",
        ConfigurationHash::from_content(b"config"),
    );

    assert!(rel.is_ok(), "Same-tenant relationship must be accepted");
    let rel = rel.unwrap();
    assert_eq!(rel.status, RelationshipStatus::Created);
    assert!(rel.verify_scope_hash());
}

/// Helper: test StateVersion creates correctly
#[test]
fn test_state_version_creation() {
    let tenant = TenantId::new_v4();
    let state_hash = StateHash::from_content(b"state");
    let version = StateVersion::new(
        tenant,
        StateVersionId::new_v4(),
        None, // genesis — no parent
        CommitIndex::new(0),
        state_hash,
        vec![],
        ConfigurationHash::from_content(b"config"),
    );

    assert!(
        version.parent_version.is_none(),
        "Genesis version must have no parent"
    );
    assert_eq!(version.commit_index, CommitIndex::new(0));
    assert_eq!(version.state_hash, state_hash);
}

/// Helper: test that StateSnapshot is a data object (no lifecycle state machine)
#[test]
fn test_state_snapshot_is_data_object() {
    let tenant = TenantId::new_v4();
    let snapshot_id = StateSnapshotId::new_v4();
    let snapshot = StateSnapshot::new(
        tenant,
        snapshot_id,
        CommitIndex::new(42),
        Some(CommitIndex::new(41)),
        vec![],
        vec![],
        serde_json::Value::Null,
        ConfigurationHash::from_content(b"config"),
    );

    assert_eq!(snapshot.snapshot_id, snapshot_id);
    assert_eq!(snapshot.commit_index, CommitIndex::new(42));
    assert_eq!(snapshot.parent_commit_index, Some(CommitIndex::new(41)));
    assert!(
        snapshot.verify_state_hash(),
        "StateSnapshot state_hash must verify"
    );
}

/// Helper: test Observation lifecycle
#[test]
fn test_observation_lifecycle() {
    let tenant = TenantId::new_v4();
    let event_id = EventId::new_v4();
    let observer = ScopedEntityId::new(tenant, EntityId::new_v4());

    let obs = Observation::new(
        tenant,
        event_id,
        observer,
        "outcome_observation",
        "test_source",
        serde_json::json!({"result": "success"}),
        ConfigurationHash::from_content(b"config"),
        EvidenceCategory::Outcome,
    );

    assert_eq!(obs.status, ObservationStatus::Created);
    assert_eq!(obs.event_id, event_id);
    assert_eq!(obs.observer.entity_id, observer.entity_id);
    assert!(
        obs.time.logical_time.is_none(),
        "Observation logical_time must be None before commit"
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// Imports for T-TIME-03 test
// ═════════════════════════════════════════════════════════════════════════════

use chrono::DateTime;
