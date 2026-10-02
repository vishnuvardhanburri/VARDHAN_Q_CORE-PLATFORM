use super::authorization::PolicyEvaluation;
use super::contracts::{AssuranceStatus, SecurityIR};
use super::gates::G4PolicyEnforcement;

pub trait FormalPolicyVerifier {
    /// Connects to the underlying policy engine/SMT solver.
    /// Emits a fully populated PolicyEvaluation containing actual configuration hashes,
    /// rule IDs, evaluated constraints, and the cryptographically valid ProofRef.
    fn evaluate_policy(&self, ir: &SecurityIR) -> Result<PolicyEvaluation, String>;
}

pub struct G4EnforcementEngine<V: FormalPolicyVerifier> {
    pub verifier: V,
}

impl<V: FormalPolicyVerifier> G4PolicyEnforcement for G4EnforcementEngine<V> {
    fn evaluate(&self, ir: &SecurityIR) -> Result<PolicyEvaluation, AssuranceStatus> {
        // We explicitly forbid generating an empty PolicyEvaluation with synthetic strings.
        // We defer to the formal verification engine.
        match self.verifier.evaluate_policy(ir) {
            Ok(evaluation) => {
                // Return the generated evaluation.
                // Note: The Assembler will later inspect `evaluation.status`
                // to determine if it is PASS, REJECT, or INDETERMINATE.
                Ok(evaluation)
            }
            Err(_) => {
                // If the verifier is disconnected, missing, or errors out:
                Err(AssuranceStatus::Indeterminate)
            }
        }
    }
}
