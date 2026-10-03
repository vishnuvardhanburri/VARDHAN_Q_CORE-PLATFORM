use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct IntelligenceIdentity {
    pub engine_id: String,
    pub engine_version: String,
    pub run_id: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct OrganizationIdentity {
    pub organization_id: String,
    pub canonical_domain: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ResourceIdentity {
    pub canonical_url: String,
    pub surface_type: String,
    pub entry_point_id: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct EvidenceRef {
    pub evidence_id: String,
    pub public_url: String,
    pub temporal_status: String,
    pub is_context_artifact: bool,
    pub evidence_origin: String,
    pub content_hash: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ProvenanceChain {
    pub expectation_id: String,
    pub observation_ids: Vec<String>,
    pub differential_id: String,
    pub hypothesis_id: String,
    pub verification_contract_id: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AuthorizationContext {
    pub requires_authorized_assessment: bool,
    pub authorized_by: Option<String>,
    pub authorization_scope: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct VerifiedFindingContract {
    pub schema_version: String,
    pub finding_id: String,
    pub intelligence: IntelligenceIdentity,
    pub organization: OrganizationIdentity,
    pub affected_resource: ResourceIdentity,
    pub technical_area: String,
    pub technical_mechanism: String,
    pub expected_behavior: String,
    pub observed_behavior: String,
    pub differential_state: String,
    pub materiality: String,
    pub evidence_refs: Vec<EvidenceRef>,
    pub provenance_chain: ProvenanceChain,
    pub contradictory_evidence_ids: Vec<String>,
    pub uncertainty: Vec<String>,
    pub benign_explanation: String,
    pub authorization_context: AuthorizationContext,
    pub decision_candidate: String,
    pub policy_reference: String,
    pub created_at: String,
    pub evidence_earliest_retrieved_at: String,
    pub evidence_latest_retrieved_at: String,
}
