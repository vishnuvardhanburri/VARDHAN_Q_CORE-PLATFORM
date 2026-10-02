use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(untagged)]
pub enum TransitionType {
    Known(KnownTransitionType),
    /// Explicit legacy fallback.
    Unknown(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum KnownTransitionType {
    // A. VERIFIED-HISTORICAL
    #[serde(rename = "ENTITY_CREATE")]       EntityCreate,
    #[serde(rename = "ATTRIBUTE_UPDATE")]    AttributeUpdate,
    #[serde(rename = "CONFIG_UPDATE")]       ConfigUpdate,
    #[serde(rename = "DELETE_TENANT")]       DeleteTenant,
    #[serde(rename = "DEACTIVATE")]          Deactivate,
    #[serde(rename = "ARCHIVE")]             Archive,
    #[serde(rename = "DELETE_ENTITY")]       DeleteEntity,
    #[serde(rename = "DEPRECATE")]           Deprecate,
    #[serde(rename = "DELETE_RELATIONSHIP")] DeleteRelationship,

    // B. NEW-CANONICAL-PROOFMESH
    #[serde(rename = "VERIFICATION_CLAIM_CREATE")]    VerificationClaimCreate,
    #[serde(rename = "EXECUTION_PLAN_CREATE")]         ExecutionPlanCreate,
    #[serde(rename = "VERIFICATION_RUN_RECORD_CREATE")] VerificationRunRecordCreate,
    #[serde(rename = "REPLAY_CAPSULE_CREATE")]         ReplayCapsuleCreate,
    #[serde(rename = "QUORUM_SNAPSHOT_CREATE")]         QuorumSnapshotCreate,
    #[serde(rename = "VERIFICATION_FINDING_CREATE")]   VerificationFindingCreate,
    #[serde(rename = "FAULT_SCENARIO_CREATE")]          FaultScenarioCreate,
}
