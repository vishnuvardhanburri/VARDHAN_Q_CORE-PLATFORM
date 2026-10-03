#[cfg(test)]
mod tests {
    use crate::assurance::assembler::*;
    use crate::assurance::contracts::*;
    use crate::assurance::g0::*;
    use crate::assurance::g1::*;
    use crate::assurance::g3::*;
    use crate::assurance::g4::*;
    use crate::assurance::gates::*;
    use crate::assurance::types::*;
    use uuid::Uuid;
    use vardhan_state::authorization::{PolicyEvaluation, ProvenanceTrail};
    use vardhan_state::id::{ConfigurationHash, EvidenceId, StateHash, TenantId};

    struct MockCrypto {
        valid: bool,
    }
    impl IntegrityVerifier for MockCrypto {
        fn verify_signature(&self, _ir: &SecurityIR) -> bool {
            self.valid
        }
    }

    struct MockProver {
        res: Result<bool, String>,
    }
    impl SemanticProver for MockProver {
        fn prove_equivalence(&self, _ir: &SecurityIR, _c: &SecurityIR) -> Result<bool, String> {
            self.res.clone()
        }
    }

    struct MockMetrics {
        cov: Option<u32>,
        rej: Option<u8>,
    }
    impl MetricsProvider for MockMetrics {
        fn get_coverage_samples(&self, _w: &EvaluationWindow) -> Option<u32> {
            self.cov
        }
        fn get_rejection_rate(&self, _w: &EvaluationWindow) -> Option<u8> {
            self.rej
        }
    }

    struct MockVerifier {
        res: Result<PolicyEvaluation, String>,
    }
    impl FormalPolicyVerifier for MockVerifier {
        fn evaluate_policy(&self, _ir: &SecurityIR) -> Result<PolicyEvaluation, String> {
            self.res.clone()
        }
    }

    struct MockIdGen;
    impl IdentityGenerator for MockIdGen {
        fn derive_assurance_result_id(
            &self,
            _ir: &SecurityIR,
            _pe: Option<&PolicyEvaluation>,
        ) -> String {
            "canonical_derived_id".to_string()
        }
    }

    fn base_ir() -> SecurityIR {
        SecurityIR {
            schema_version: 1,
            tenant_scope: crate::assurance::types::TenantId("t1".to_string()),
            assumed_system_state_hash: crate::assurance::types::StateHash("s1".to_string()),
            intent: SecurityIntent {
                description: "".to_string(),
            },
            target_component: ComponentId::GlobalCluster,
            action_primitive: ActionId::DrainNode,
            parameters: PrimitiveParameters::DrainNode {
                node_id: NodeId("n1".to_string()),
                graceful_timeout_ms: 1000,
            },
            constraints: vec![],
            expected_effect: EffectDescriptor {
                expected_outcome: "".to_string(),
            },
            reversibility: ReversibilityModel::FullyReversible,
            blast_radius: BlastRadiusDescriptor::SingleNode,
            provenance: ProvenanceTrail {
                generator_model: "m".to_string(),
                generation_timestamp: 100,
                context_hash: "c".to_string(),
            },
            integrity_signature: Signature("sig".to_string()),
        }
    }

    fn base_snap() -> StateSnapshotRef {
        StateSnapshotRef {
            snapshot_id: "snap1".to_string(),
            state_version: 1,
            commit_index: 10,
            tenant_id: crate::assurance::types::TenantId("t1".to_string()),
            state_hash: crate::assurance::types::StateHash("s1".to_string()),
            config_hash: crate::assurance::types::ConfigurationHash("c1".to_string()),
            generated_at_ms: 100,
        }
    }

    #[test]
    fn test_g0_crypto_verification() {
        let mut g0 = G0Validator {
            current_schema_version: 1,
            max_freshness_ms: 500,
            verifier: MockCrypto { valid: false },
        };
        assert_eq!(
            g0.evaluate(
                &base_ir(),
                &base_snap(),
                &crate::assurance::types::ConfigurationHash("c1".to_string()),
                150
            ),
            AssuranceStatus::Reject
        );
        g0.verifier.valid = true;
        assert_eq!(
            g0.evaluate(
                &base_ir(),
                &base_snap(),
                &crate::assurance::types::ConfigurationHash("c1".to_string()),
                150
            ),
            AssuranceStatus::Pass
        );
    }
}
