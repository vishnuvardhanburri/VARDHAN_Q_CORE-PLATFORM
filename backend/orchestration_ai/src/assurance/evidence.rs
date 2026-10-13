use super::contracts::AssuranceResult;
use audit_ledger::SegmentedLedgerWriter;
use core_crypto::QuantumNodeIdentity;
use serde_json::json;
use std::sync::Arc;

pub struct EvidenceManager {
    ledger: Arc<SegmentedLedgerWriter>,
    identity: Arc<QuantumNodeIdentity>,
}

impl EvidenceManager {
    pub fn new(ledger: Arc<SegmentedLedgerWriter>, identity: Arc<QuantumNodeIdentity>) -> Self {
        Self { ledger, identity }
    }

    pub fn persist_assurance_evidence(
        &self,
        result: &AssuranceResult,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let event_val = json!({
            "event_type": "ai_assurance_evaluation",
            "candidate_id": result.candidate_id,
            "final_status": result.final_status,
            "gates_evidence": result.gates,
            "policy_evaluation_id": result.policy_evaluation_id,
            "proof_ref": result.proof_ref,
            "provenance": result.provenance,
        });

        // The appended event is actively signed using the node's PQ identity.
        self.ledger.append(event_val, &self.identity)?;

        Ok(())
    }
}
