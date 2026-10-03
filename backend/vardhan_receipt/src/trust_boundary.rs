use crate::contract::VerifiedFindingContract;

pub struct TrustBoundaryValidator;

impl TrustBoundaryValidator {
    pub fn validate(contract: &VerifiedFindingContract) -> Result<(), String> {
        // 1. schema/version
        if contract.schema_version != "1.0" {
            return Err("Invalid schema_version, expected 1.0".to_string());
        }
        
        // 2. tenant identity
        if contract.organization.organization_id.is_empty() {
            return Err("organization_id must not be empty".to_string());
        }

        // 3. intelligence identity
        if contract.intelligence.engine_id.is_empty() || contract.intelligence.run_id.is_empty() {
            return Err("intelligence identity fields must not be empty".to_string());
        }

        // 4. organization identity
        if contract.organization.canonical_domain.is_empty() {
            return Err("canonical_domain must not be empty".to_string());
        }

        // 5. resource identity
        if contract.affected_resource.canonical_url.is_empty() || contract.affected_resource.entry_point_id.is_empty() {
            return Err("resource identity fields must not be empty".to_string());
        }

        // 6. finding identity
        if contract.finding_id.is_empty() {
            return Err("finding_id must not be empty".to_string());
        }

        // 7. evidence presence
        if contract.evidence_refs.is_empty() {
            return Err("evidence_refs must not be empty".to_string());
        }

        // 8. evidence integrity
        for ev in &contract.evidence_refs {
            if ev.content_hash.is_empty() || ev.content_hash.len() != 64 {
                return Err(format!("Invalid evidence content_hash for {}", ev.evidence_id));
            }
        }

        // 9. evidence provenance
        for ev in &contract.evidence_refs {
            if ev.evidence_origin.is_empty() {
                return Err(format!("evidence_origin missing for {}", ev.evidence_id));
            }
        }

        // 10. evidence temporal validity
        for ev in &contract.evidence_refs {
            if ev.temporal_status != "CURRENT" && ev.temporal_status != "HISTORICAL" {
                return Err(format!("Invalid temporal_status for {}: {}", ev.evidence_id, ev.temporal_status));
            }
            if ev.temporal_status == "HISTORICAL" {
                return Err(format!("Historical evidence presented as current is REJECTED: {}", ev.evidence_id));
            }
        }

        // 11. expectation linkage
        if contract.provenance_chain.expectation_id.is_empty() {
            return Err("expectation_id missing in provenance_chain".to_string());
        }

        // 12. observation linkage
        if contract.provenance_chain.observation_ids.is_empty() {
            return Err("observation_ids missing in provenance_chain".to_string());
        }

        // 13. differential linkage
        if contract.provenance_chain.differential_id.is_empty() {
            return Err("differential_id missing in provenance_chain".to_string());
        }

        // 14. verification linkage
        if contract.provenance_chain.hypothesis_id.is_empty() || contract.provenance_chain.verification_contract_id.is_empty() {
            return Err("verification linkage missing in provenance_chain".to_string());
        }

        // 15. verification status
        if contract.differential_state != "CONFIRMED_MISMATCH" {
            return Err("differential_state must be CONFIRMED_MISMATCH to be a verified finding".to_string());
        }

        // 16. materiality consistency
        if contract.materiality != "HIGH" && contract.materiality != "MEDIUM" && contract.materiality != "LOW" {
            return Err("materiality must be HIGH, MEDIUM, or LOW".to_string());
        }

        // 17. contradiction / uncertainty state
        if !contract.contradictory_evidence_ids.is_empty() {
            return Err("Contradictory evidence present, finding is REJECTED".to_string());
        }

        // 18. decision candidate
        let allowed_actions = ["SEAL_VERIFIED_FINDING"];
        if !allowed_actions.contains(&contract.decision_candidate.as_str()) {
            return Err(format!("action_type '{}' is not in the allowed policy whitelist", contract.decision_candidate));
        }

        // 19. policy reference
        let allowed_policies = ["VARDHAN_CORE_INTELLIGENCE_POLICY_V1"];
        if !allowed_policies.contains(&contract.policy_reference.as_str()) {
            return Err(format!("policy_reference '{}' is not registered in the Q-Core policy registry", contract.policy_reference));
        }

        // 20. authority context
        if contract.authorization_context.requires_authorized_assessment && contract.authorization_context.authorized_by.is_none() {
            return Err("authorization_context requires authorized_by if requires_authorized_assessment is true".to_string());
        }

        Ok(())
    }
}
