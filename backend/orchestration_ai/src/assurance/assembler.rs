use super::authorization::PolicyEvaluation;
use super::contracts::{AssuranceResult, AssuranceStatus, GateResults, SecurityIR};

pub trait IdentityGenerator {
    fn derive_assurance_result_id(&self, ir: &SecurityIR, pe: Option<&PolicyEvaluation>) -> String;
}

pub struct AssuranceAssembler<I: IdentityGenerator> {
    pub identity_gen: I,
}

impl<I: IdentityGenerator> AssuranceAssembler<I> {
    pub fn assemble(
        &self,
        ir: &SecurityIR,
        candidate_id: String,
        g0_status: AssuranceStatus,
        g1_status: AssuranceStatus,
        g2_status: AssuranceStatus,
        g3_status: AssuranceStatus,
        g4_result: Result<PolicyEvaluation, AssuranceStatus>,
    ) -> AssuranceResult {
        let (g4_status, pe_ref, proof_ref, pe_opt) = match &g4_result {
            Ok(pe) => (
                match pe.status { vardhan_state::authorization::PolicyStatus::Pass => AssuranceStatus::Pass, vardhan_state::authorization::PolicyStatus::Fail => AssuranceStatus::Fail, vardhan_state::authorization::PolicyStatus::Indeterminate => AssuranceStatus::Indeterminate },
                Some("policy".to_string()),
                pe.proof_ref.as_ref().map(|_| "evidence".to_string()),
                Some(pe),
            ),
            Err(status) => (status.clone(), None, None, None),
        };

        // Strict constitutional hierarchy for final status emission.
        let final_status = if g0_status == AssuranceStatus::Reject
            || g1_status == AssuranceStatus::Reject
            || g2_status == AssuranceStatus::Reject
            || g3_status == AssuranceStatus::Reject
            || g4_status == AssuranceStatus::Reject
        {
            AssuranceStatus::Reject
        } else if g0_status == AssuranceStatus::Timeout
            || g1_status == AssuranceStatus::Timeout
            || g2_status == AssuranceStatus::Timeout
            || g3_status == AssuranceStatus::Timeout
            || g4_status == AssuranceStatus::Timeout
        {
            AssuranceStatus::Timeout
        } else if g0_status == AssuranceStatus::Indeterminate
            || g1_status == AssuranceStatus::Indeterminate
            || g2_status == AssuranceStatus::Indeterminate
            || g3_status == AssuranceStatus::Indeterminate
            || g4_status == AssuranceStatus::Indeterminate
        {
            AssuranceStatus::Indeterminate
        } else if g0_status == AssuranceStatus::Fail
            || g1_status == AssuranceStatus::Fail
            || g2_status == AssuranceStatus::Fail
            || g3_status == AssuranceStatus::Fail
            || g4_status == AssuranceStatus::Fail
        {
            AssuranceStatus::Fail
        } else {
            // Unconditional PASS requires strictly completed gate evidence.
            AssuranceStatus::Pass
        };

        let assurance_result_id = self.identity_gen.derive_assurance_result_id(ir, pe_opt);

        AssuranceResult {
            assurance_result_id,
            candidate_id,
            final_status,
            gates: GateResults {
                g0_status,
                g1_status,
                g2_status,
                g3_status,
                g4_status,
            },
            proof_ref,
            policy_evaluation_id: pe_ref,
            provenance: ir.provenance.clone(),
        }
    }
}
