pub mod identity;

#[cfg(test)]
mod tests {
    use super::identity::*;
    use serde_json::json;
    use uuid::Uuid;
    use vardhan_state::transition::*;

    #[test]
    fn test_transparent_id_serialization() {
        let u = Uuid::parse_str("123e4567-e89b-12d3-a456-426614174000").unwrap();
        let plan_id = ExecutionPlanId(u);

        let serialized = serde_json::to_string(&plan_id).unwrap();
        assert_eq!(serialized, "\"123e4567-e89b-12d3-a456-426614174000\"");

        let deserialized: ExecutionPlanId = serde_json::from_str(&serialized).unwrap();
        assert_eq!(deserialized, plan_id);
    }

    #[test]
    fn test_transition_type_historical_roundtrip() {
        let t = TransitionType::Known(vardhan_state::transition::KnownTransitionType::EntityCreate);
        let s = serde_json::to_string(&t).unwrap();
        assert_eq!(s, "\"ENTITY_CREATE\"");

        let d: TransitionType = serde_json::from_str("\"ENTITY_CREATE\"").unwrap();
        assert_eq!(
            d,
            TransitionType::Known(vardhan_state::transition::KnownTransitionType::EntityCreate)
        );
    }

    #[test]
    fn test_transition_type_proofmesh_roundtrip() {
        let t = TransitionType::Known(KnownTransitionType::VerificationClaimCreate);
        let s = serde_json::to_string(&t).unwrap();
        assert_eq!(s, "\"VERIFICATION_CLAIM_CREATE\"");

        let d: TransitionType = serde_json::from_str("\"VERIFICATION_CLAIM_CREATE\"").unwrap();
        assert_eq!(
            d,
            TransitionType::Known(KnownTransitionType::VerificationClaimCreate)
        );
    }
}
pub mod adaptive_scheduler;
pub mod claim_registry;
pub mod execution_plan;
pub mod fault;
pub mod finding;
pub mod graph;
pub mod quorum;
pub mod replay;
pub mod run_record;
pub mod scope;

use vardhan_state::scope::{canonical_json, Hashable};
impl Hashable for claim_registry::VerificationClaim {
    fn canonical_bytes(&self) -> Vec<u8> {
        canonical_json(self)
    }
}
impl Hashable for execution_plan::ExecutionPlan {
    fn canonical_bytes(&self) -> Vec<u8> {
        canonical_json(self)
    }
}
impl Hashable for quorum::EvidenceQuorumSnapshot {
    fn canonical_bytes(&self) -> Vec<u8> {
        canonical_json(self)
    }
}
impl Hashable for finding::VerificationFinding {
    fn canonical_bytes(&self) -> Vec<u8> {
        canonical_json(self)
    }
}
impl Hashable for fault::FaultScenario {
    fn canonical_bytes(&self) -> Vec<u8> {
        canonical_json(self)
    }
}
impl Hashable for replay::ReplayCapsule {
    fn canonical_bytes(&self) -> Vec<u8> {
        canonical_json(self)
    }
}
impl Hashable for run_record::VerificationRunRecord {
    fn canonical_bytes(&self) -> Vec<u8> {
        canonical_json(self)
    }
}
pub mod evidence_pipeline;
pub mod executor;
