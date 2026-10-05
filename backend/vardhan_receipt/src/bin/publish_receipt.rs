//! Thin operational entrypoint for authenticated Q-Core receipt publication.
use serde::{Deserialize, Serialize};
use std::io::{self, Read};

#[path = "../qcore_transport.rs"]
mod qcore_transport;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EvidenceCommitment { pub evidence_id: String, pub content_hash: String, pub category: String }
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DualSignature { pub ed25519_sig: String, pub ed25519_key_id: String, pub ml_dsa_87_sig: String, pub ml_dsa_87_key_id: String }
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VardhanSealedReceipt {
    pub receipt_id: String, pub schema_version: String, pub transaction_id: String, pub status: String,
    pub tenant_id: String, pub subject_id: String, pub actor_identity: String, pub proposed_action: String,
    pub policy_id: String, pub policy_version: String, pub state_hash_at_decision: Option<String>,
    pub evidence_commitments: Vec<EvidenceCommitment>, pub authority_reference: String, pub decision: String,
    pub outcome_code: String, pub timestamp_ms: u64, pub ledger_commit_index: u64,
    pub parent_receipt_id: Option<String>, pub correlation_id: Option<String>, pub payload_hash: String,
    pub issuer_key_fingerprint: String, pub signatures: DualSignature,
}

#[tokio::main]
async fn main() {
    let organization_id = std::env::var("VARDHAN_QCORE_ORGANIZATION_ID").ok().filter(|v| !v.trim().is_empty()).unwrap_or_else(|| {
        eprintln!("VARDHAN_QCORE_ORGANIZATION_ID is required"); std::process::exit(2)
    });
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).unwrap_or_else(|e| { eprintln!("stdin read failed: {e}"); std::process::exit(2) });
    let receipt: VardhanSealedReceipt = serde_json::from_str(&input).unwrap_or_else(|e| { eprintln!("invalid canonical receipt JSON: {e}"); std::process::exit(2) });
    match qcore_transport::publish_receipt(&organization_id, &receipt).await {
        Ok(result) => println!("{}", serde_json::to_string(&result).unwrap()),
        Err(error) => { eprintln!("{error}"); std::process::exit(1); }
    }
}
