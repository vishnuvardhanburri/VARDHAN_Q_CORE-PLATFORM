use crate::identity::{ExecutionPlanId, FaultScenarioId, ReplayCapsuleId, VerificationClaimId};
use serde::{Deserialize, Serialize};
use vardhan_state::authorization::ProvenanceTrail;
use vardhan_state::id::{ContentHash, StateHash};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ExecutionPool {
    Fast,
    Security,
    Distributed,
    Fuzz,
    Fault,
    Replay,
    Deep,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ExecutionTarget {
    RustTest {
        test_module: String,
        target_crate: String,
    },
    CargoNextest {
        profile: String,
        filter_expr: String,
    },
    Replay {
        capsule_ref: ReplayCapsuleId,
    },
    FaultHarness {
        scenario_ref: FaultScenarioId,
    },
    InternalVerification {
        routine_name: String,
    },
    // Explicitly removed: Process(String) - no arbitrary command execution allowed in ProofMesh
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResourceBounds {
    pub max_cpu_ms: u64,
    pub max_memory_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExecutionStep {
    pub step_id: String,
    pub target: ExecutionTarget,
    pub arguments: Vec<String>, // Constrained to test harness arguments, not arbitrary shell commands
    pub allowed_network_access: bool,
    pub allowed_file_read_paths: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExecutionPlan {
    pub plan_id: ExecutionPlanId,
    pub claim_ref: VerificationClaimId,
    pub steps: Vec<ExecutionStep>,
    pub pool: ExecutionPool,
    pub resource_bounds: ResourceBounds,
    pub timeout_ms: u64,
    pub seed: u64,
    pub env_fingerprint: String,
    pub expected_evidence: Vec<String>,
    pub policy_ref: String,
    pub config_hash: ContentHash,
    pub state_hash: StateHash,
    pub provenance: ProvenanceTrail,
}

impl ExecutionPlan {
    pub fn validate_determinism(&self) -> Result<(), &'static str> {
        if self.timeout_ms == 0 {
            return Err("ExecutionPlan requires a bounded timeout");
        }
        if self.steps.is_empty() {
            return Err("ExecutionPlan must have at least one step");
        }
        for step in &self.steps {
            if step.allowed_network_access && self.pool != ExecutionPool::Distributed {
                return Err("Network access only allowed in Distributed pool");
            }
        }
        Ok(())
    }
}
