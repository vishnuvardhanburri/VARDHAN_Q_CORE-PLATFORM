use super::authorization::PolicyEvaluation;
use super::contracts::{AssuranceStatus, SecurityIR};
use super::types::{ConfigurationHash, StateHash, TenantId};

#[derive(Debug, Clone)]
pub struct StateSnapshotRef {
    pub snapshot_id: String,
    pub state_version: u64,
    pub commit_index: u64,
    pub tenant_id: TenantId,
    pub state_hash: StateHash,
    pub config_hash: ConfigurationHash,
    pub generated_at_ms: u64,
}

pub trait G0ContextValidity {
    fn evaluate(
        &self,
        ir: &SecurityIR,
        committed_state: &StateSnapshotRef,
        config_hash: &ConfigurationHash,
        current_time_ms: u64,
    ) -> AssuranceStatus;
}

pub trait G1SemanticEquivalence {
    fn evaluate(&self, ir: &SecurityIR, canonical_ir: &SecurityIR) -> AssuranceStatus;
}

#[derive(Debug, Clone)]
pub struct PerturbationClasses {
    pub allow_reordering: bool,
    pub parameter_fuzzing: bool,
}

#[derive(Debug, Clone)]
pub struct EvaluationWindow {
    pub window_ms: u64,
}

#[derive(Debug, Clone)]
pub struct StabilityCriteria {
    pub tolerance_percent: u8,
}

pub trait PerturbationGenerator {
    fn generate_perturbation(
        &self,
        ir: &SecurityIR,
        class: &PerturbationClasses,
    ) -> Option<SecurityIR>;
}

pub trait ModelEvaluator {
    fn reevaluate(&self, ir: &SecurityIR) -> Result<SecurityIR, String>;
}

pub struct Tolerance {
    pub max_deviation_score: u8,
}

pub trait G2PerturbationRobustness {
    fn evaluate(
        &mut self,
        ir: &SecurityIR,
        generator: &dyn PerturbationGenerator,
        evaluator: &dyn ModelEvaluator,
        classes: &PerturbationClasses,
        criteria: &StabilityCriteria,
        tolerance: &Tolerance,
        window: &EvaluationWindow,
    ) -> AssuranceStatus;
}

#[derive(Debug, Clone)]
pub struct UtilityPolicy {
    pub min_utility: u8,
}

#[derive(Debug, Clone)]
pub struct DegeneracyCriteria {
    pub max_rejection_rate: u8,
    pub min_coverage_samples: u32,
}

pub trait G3Utility {
    fn evaluate(
        &self,
        policy: &UtilityPolicy,
        criteria: &DegeneracyCriteria,
        window: &EvaluationWindow,
    ) -> AssuranceStatus;
}

pub trait G4PolicyEnforcement {
    fn evaluate(&self, ir: &SecurityIR) -> Result<PolicyEvaluation, AssuranceStatus>;
}
