use proofmesh::execution_plan::{
    ExecutionPlan, ExecutionPool, ExecutionStep, ExecutionTarget, ResourceBounds,
};
use proofmesh::executor::IsolatedExecutor;
use proofmesh::identity::{ExecutionPlanId, VerificationClaimId};
use proofmesh::quorum::{QuorumAccumulator, QuorumStatus};
use std::sync::Arc;
use vardhan_state::authorization::ProvenanceTrail;
use vardhan_state::evidence::{EvidenceCategory, EvidenceRecord, EvidenceStatus};
use vardhan_state::id::{ContentHash, StateHash};
use vardhan_state::id::{EvidenceId, EvidenceLogicalId, SchemaVersion, TenantId};
use vardhan_state::time::TimeContext;

#[tokio::test]
async fn test_adversarial_executor_shell_injection() {
    let executor = IsolatedExecutor::new();

    // Attempt shell injection in arguments
    let step = ExecutionStep {
        step_id: "step-1".to_string(),
        target: ExecutionTarget::RustTest {
            test_module: "mod".to_string(),
            target_crate: "crate".to_string(),
        },
        arguments: vec!["; rm -rf /".to_string()],
        allowed_network_access: false,
        allowed_file_read_paths: vec![],
    };

    let result = executor.execute_step(&step, 1000, 1024).await;
    assert!(result.is_err());
    assert_eq!(
        result.unwrap_err(),
        "Shell injection vectors detected in arguments"
    );
}

#[tokio::test]
async fn test_determinism_empty_plan_fails() {
    let plan = ExecutionPlan {
        plan_id: ExecutionPlanId(uuid::Uuid::new_v4()),
        claim_ref: VerificationClaimId(uuid::Uuid::new_v4()),
        steps: vec![],
        pool: ExecutionPool::Fast,
        resource_bounds: ResourceBounds {
            max_cpu_ms: 100,
            max_memory_bytes: 1024,
        },
        timeout_ms: 1000,
        seed: 42,
        env_fingerprint: "env".to_string(),
        expected_evidence: vec![],
        policy_ref: "policy".to_string(),
        config_hash: ContentHash::from([0u8; 32]),
        state_hash: StateHash::from([0u8; 32]),
        provenance: ProvenanceTrail {
            generator_model: "test".to_string(),
            generation_timestamp: 0,
            context_hash: "hash".to_string(),
        },
    };

    let res = plan.validate_determinism();
    assert!(res.is_err());
    assert_eq!(
        res.unwrap_err(),
        "ExecutionPlan must have at least one step"
    );
}

#[tokio::test]
async fn test_quorum_common_mode_detection() {
    let claim_id = VerificationClaimId(uuid::Uuid::new_v4());
    let mut accumulator = QuorumAccumulator::new(claim_id, 2);

    let mut ev1 = EvidenceRecord {
        evidence_id: EvidenceId::from([1u8; 32]),
        tenant_id: TenantId::from(uuid::Uuid::new_v4()),
        event_id: None,
        entity_id: None,
        source: "node-a-execution".to_string(),
        timestamp: TimeContext {
            logical_time: None,
            event_time: vardhan_state::time::now_utc(),
            system_time: vardhan_state::time::now_utc(),
            deadline_time: None,
            created_at: vardhan_state::time::now_utc(),
        },
        schema_version: SchemaVersion::new(1, 0, 0),
        payload_digest: ContentHash::from([0u8; 32]),
        predecessor: None,
        provenance: vec![],
        authorization_context: None,
        signatures: vec![],
        evidence_category: EvidenceCategory::Verification,
        config_hash: vardhan_state::id::ConfigurationHash::from([0u8; 32]),
        state_hash: None,
        commit_index: None,
        related_object_refs: vec![],
        status: EvidenceStatus::Created,
        logical_id: EvidenceLogicalId::from_uuid(uuid::Uuid::new_v4()),
    };

    let mut ev2 = ev1.clone();
    ev2.evidence_id = EvidenceId::from([2u8; 32]);

    accumulator.add_evidence(ev1);
    accumulator.add_evidence(ev2);

    // Evaluate: since they both have exact same source and environments (None), common mode risk!
    let status = accumulator.evaluate();
    assert_eq!(status, QuorumStatus::CommonModeCompromised);
}
