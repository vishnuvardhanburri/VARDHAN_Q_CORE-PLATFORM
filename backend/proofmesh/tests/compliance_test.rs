use proofmesh::identity::VerificationClaimId;
use proofmesh::quorum::{QuorumAccumulator, QuorumStatus};
use vardhan_state::evidence::{EvidenceCategory, EvidenceRecord};
use vardhan_state::id::{
    CommitIndex, ConfigurationHash, ContentHash, EntityId, StateHash, TenantId,
};
use vardhan_state::time::{now_utc, TimeContext};

fn mock_evidence(id: u8, entity: u8, src: &str, env: u8) -> EvidenceRecord {
    let ts = now_utc();
    let tc = TimeContext {
        logical_time: None,
        event_time: ts,
        system_time: ts,
        deadline_time: None,
        created_at: ts,
    };
    let mut ev = EvidenceRecord::new(
        TenantId::new_v4(),
        src.to_string(),
        tc,
        b"payload",
        EvidenceCategory::Verification,
        ConfigurationHash::from([env; 32]),
        Some(StateHash::from([env; 32])),
        None,
    );
    ev.evidence_id = vardhan_state::id::EvidenceId::from([id; 32]);
    ev.entity_id = Some(EntityId::from(uuid::Uuid::from_bytes([entity; 16])));
    ev
}

#[test]
fn test_quorum_common_mode_failures() {
    let claim_id = VerificationClaimId(uuid::Uuid::new_v4());
    let mut quorum = QuorumAccumulator::new(claim_id.clone(), 2);

    quorum.add_evidence(mock_evidence(1, 42, "validator_A", 100));
    quorum.add_evidence(mock_evidence(2, 42, "validator_A", 100));
    assert_eq!(quorum.evaluate(), QuorumStatus::CommonModeCompromised);

    quorum.add_evidence(mock_evidence(3, 99, "validator_B", 100));
    assert_eq!(quorum.evaluate(), QuorumStatus::Satisfied);
}

#[test]
fn test_deterministic_snapshot_generation() {
    let claim_id = VerificationClaimId(uuid::Uuid::new_v4());
    let mut quorum = QuorumAccumulator::new(claim_id.clone(), 2);

    quorum.add_evidence(mock_evidence(1, 10, "src1", 1));
    quorum.add_evidence(mock_evidence(2, 20, "src2", 2));

    let snap1 = quorum.freeze(
        CommitIndex(100),
        ContentHash::from([0; 32]),
        ContentHash::from([0; 32]),
    );

    let mut quorum2 = QuorumAccumulator::new(claim_id, 2);
    quorum2.add_evidence(mock_evidence(2, 20, "src2", 2));
    quorum2.add_evidence(mock_evidence(1, 10, "src1", 1));

    let snap2 = quorum2.freeze(
        CommitIndex(100),
        ContentHash::from([0; 32]),
        ContentHash::from([0; 32]),
    );

    assert_eq!(
        snap1.participating_evidence_ids,
        snap2.participating_evidence_ids
    );
    assert_eq!(snap1.dimensions.fault_domains, 2);
}

#[test]
fn test_multi_dimensional_independence() {
    let claim_id = VerificationClaimId(uuid::Uuid::new_v4());
    let mut quorum = QuorumAccumulator::new(claim_id.clone(), 3);

    quorum.add_evidence(mock_evidence(1, 10, "srcA", 1));
    quorum.add_evidence(mock_evidence(2, 20, "srcB", 2));
    quorum.add_evidence(mock_evidence(3, 30, "srcC", 3));

    assert_eq!(quorum.evaluate(), QuorumStatus::Satisfied);
}
