use super::contracts::{AssuranceStatus, SecurityIR};
use super::gates::{G0ContextValidity, StateSnapshotRef};
use super::types::ConfigurationHash;

pub trait IntegrityVerifier {
    fn verify_signature(&self, ir: &SecurityIR) -> bool;
}

pub struct G0Validator<V: IntegrityVerifier> {
    pub current_schema_version: u16,
    pub max_freshness_ms: u64,
    pub verifier: V,
}

impl<V: IntegrityVerifier> G0ContextValidity for G0Validator<V> {
    fn evaluate(
        &self,
        ir: &SecurityIR,
        committed_state: &StateSnapshotRef,
        config_hash: &ConfigurationHash,
        current_time_ms: u64,
    ) -> AssuranceStatus {
        if ir.schema_version != self.current_schema_version {
            return AssuranceStatus::Reject;
        }
        if ir.tenant_scope != committed_state.tenant_id {
            return AssuranceStatus::Reject;
        }
        if config_hash != &committed_state.config_hash {
            return AssuranceStatus::Reject;
        }
        if ir.assumed_system_state_hash != committed_state.state_hash {
            return AssuranceStatus::Reject;
        }

        if current_time_ms < committed_state.generated_at_ms {
            return AssuranceStatus::Indeterminate;
        }

        let age = current_time_ms - committed_state.generated_at_ms;
        if age > self.max_freshness_ms {
            return AssuranceStatus::Timeout;
        }

        // Actual Cryptographic Verification Boundary
        if !self.verifier.verify_signature(ir) {
            return AssuranceStatus::Reject;
        }

        AssuranceStatus::Pass
    }
}
