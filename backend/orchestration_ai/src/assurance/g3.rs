use super::contracts::AssuranceStatus;
use super::gates::{DegeneracyCriteria, EvaluationWindow, G3Utility, UtilityPolicy};

pub trait MetricsProvider {
    fn get_coverage_samples(&self, window: &EvaluationWindow) -> Option<u32>;
    fn get_rejection_rate(&self, window: &EvaluationWindow) -> Option<u8>;
}

pub struct G3UtilityEngine<M: MetricsProvider> {
    pub metrics: M,
}

impl<M: MetricsProvider> G3Utility for G3UtilityEngine<M> {
    fn evaluate(
        &self,
        policy: &UtilityPolicy,
        criteria: &DegeneracyCriteria,
        window: &EvaluationWindow,
    ) -> AssuranceStatus {
        let samples = match self.metrics.get_coverage_samples(window) {
            Some(s) => s,
            None => return AssuranceStatus::Indeterminate, // Provider absent or metrics unavailable
        };

        let rej_rate = match self.metrics.get_rejection_rate(window) {
            Some(r) => r,
            None => return AssuranceStatus::Indeterminate, // Provider absent
        };

        if samples < criteria.min_coverage_samples {
            return AssuranceStatus::Indeterminate;
        }

        if rej_rate > criteria.max_rejection_rate {
            return AssuranceStatus::Fail; // Paralysis / reject-all detected
        }

        let utility_score = 100_u8.saturating_sub(rej_rate);
        if utility_score < policy.min_utility {
            return AssuranceStatus::Fail; // Utility floor breached
        }

        AssuranceStatus::Pass
    }
}
