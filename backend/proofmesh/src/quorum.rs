use serde::{Deserialize, Serialize};
use std::collections::{HashSet, BTreeSet};
use vardhan_state::id::{CommitIndex, ContentHash, EvidenceId, ExecutionId};
use crate::identity::{EvidenceQuorumSnapshotId, VerificationClaimId};
use vardhan_state::authorization::ProvenanceTrail;
use vardhan_state::evidence::EvidenceRecord;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum QuorumStatus {
    Satisfied,
    Unsatisfied,
    CommonModeCompromised,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IndependenceDimensions {
    pub execution_processes: usize,
    pub fault_domains: usize,
    pub temporal_separation_ms: u64,
    pub environments: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EvidenceQuorumSnapshot {
    pub snapshot_id: EvidenceQuorumSnapshotId,
    pub claim_id: VerificationClaimId,
    pub participating_evidence_ids: Vec<EvidenceId>,
    pub evidence_types: Vec<String>,
    pub execution_ids: Vec<ExecutionId>,
    pub dimensions: IndependenceDimensions,
    pub required_quorum: usize,
    pub achieved_quorum: usize,
    pub common_mode_risk_assessment: String,
    pub as_of_commit_index: CommitIndex,
    pub policy_hash: ContentHash,
    pub config_hash: ContentHash,
    pub resulting_quorum_status: QuorumStatus,
    pub provenance: ProvenanceTrail,
}

pub struct QuorumAccumulator {
    claim_id: VerificationClaimId,
    required_quorum: usize,
    collected_evidence: Vec<EvidenceRecord>,
}

impl QuorumAccumulator {
    pub fn new(claim_id: VerificationClaimId, required_quorum: usize) -> Self {
        Self {
            claim_id,
            required_quorum,
            collected_evidence: Vec::new(),
        }
    }

    pub fn add_evidence(&mut self, evidence: EvidenceRecord) {
        self.collected_evidence.push(evidence);
    }

    pub fn evaluate(&self) -> QuorumStatus {
        if self.collected_evidence.len() < self.required_quorum {
            return QuorumStatus::Unsatisfied;
        }

        // Common-mode detection
        let mut sources = HashSet::new();
        let mut fault_domains = HashSet::new();
        let mut environments = HashSet::new();
        
        for ev in &self.collected_evidence {
            sources.insert(ev.source.clone());
            fault_domains.insert(ev.entity_id);
            if let Some(state_hash) = &ev.state_hash {
                environments.insert(state_hash.0);
            }
        }

        // If quorum requires > 1, we mandate at least 2 fault domains 
        // to prove independence. 
        if self.required_quorum > 1 && fault_domains.len() <= 1 {
            return QuorumStatus::CommonModeCompromised;
        }

        QuorumStatus::Satisfied
    }

    pub fn freeze(
        &self, 
        commit_index: CommitIndex, 
        policy_hash: ContentHash, 
        config_hash: ContentHash
    ) -> EvidenceQuorumSnapshot {
        // Ensure arrival-order independence by sorting evidence cryptographically
        let mut sorted_evidence: Vec<_> = self.collected_evidence.iter().collect();
        sorted_evidence.sort_by_key(|e| e.evidence_id);
        
        let participating_ids: Vec<EvidenceId> = sorted_evidence.iter().map(|e| e.evidence_id).collect();
        
        // Compute independence dimensions
        let mut sources = BTreeSet::new();
        let mut fault_domains = BTreeSet::new();
        let mut min_ts = u64::MAX;
        let mut max_ts = u64::MIN;

        for ev in &sorted_evidence {
            sources.insert(ev.source.clone());
            fault_domains.insert(ev.entity_id);
            
            let ts = ev.timestamp.event_time.timestamp_millis() as u64;
            if ts < min_ts { min_ts = ts; }
            if ts > max_ts { max_ts = ts; }
        }
        
        let temporal_separation_ms = if max_ts >= min_ts && min_ts != u64::MAX {
            max_ts - min_ts
        } else {
            0
        };

        let status = self.evaluate();

        EvidenceQuorumSnapshot {
            snapshot_id: EvidenceQuorumSnapshotId(uuid::Uuid::new_v4()),
            claim_id: self.claim_id,
            participating_evidence_ids: participating_ids,
            evidence_types: sorted_evidence.iter().map(|e| e.source.clone()).collect(),
            execution_ids: vec![], // Extracted from evidence payload in full impl
            dimensions: IndependenceDimensions {
                execution_processes: sources.len(),
                fault_domains: fault_domains.len(),
                temporal_separation_ms,
                environments: 1,
            },
            required_quorum: self.required_quorum,
            achieved_quorum: self.collected_evidence.len(),
            common_mode_risk_assessment: if status == QuorumStatus::CommonModeCompromised {
                "Detected lack of fault domain diversity".to_string()
            } else {
                "OK".to_string()
            },
            as_of_commit_index: commit_index,
            policy_hash,
            config_hash,
            resulting_quorum_status: status,
            provenance: ProvenanceTrail {
                generator_model: "QuorumAccumulator".to_string(),
                generation_timestamp: vardhan_state::time::now_utc().timestamp_millis() as u64,
                context_hash: "".to_string(),
            },
        }
    }
}
