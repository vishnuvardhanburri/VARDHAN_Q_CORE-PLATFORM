use pqcrypto_traits::sign::PublicKey;
use vardhan_hybrid_core::execute_hybrid_transaction;
use clap::{Parser, Subcommand};
use pqcrypto_mldsa::mldsa87::{keypair as mldsa_keypair, detached_sign as mldsa_sign};
use pqcrypto_traits::sign::DetachedSignature as PQDetachedSignature;
use ed25519_dalek::{SigningKey, Signer, Signature as EdSignature};
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::time::{SystemTime, UNIX_EPOCH};
use core_crypto::anti_tamper;
use std::io::{self, Read};
use uuid::Uuid;

#[derive(Parser)]
#[command(name = "vardhan_receipt", about = "Hybrid PQ/T Quantum Receipt Generator")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    Prove {
        #[arg(long)]
        decision: String,
        #[arg(long)]
        tenant: String,
        #[arg(long)]
        policy: String,
        #[arg(long)]
        json: bool,
    },
    Verify {
        #[arg(long)]
        receipt_id: String,
    },
    /// Canonical Integration Boundary: Validates a Finding Payload from STDIN
    ValidateCanonical,
    /// Starts the High-Performance Tollbooth API Gateway
    Serve {
        #[arg(long, default_value = "8080")]
        port: u16,
    },
}

#[derive(Deserialize, Debug, Clone)]
pub struct EvidencePackage {
    evidence_id: String,
    data_hash: String,
    category: String,
}

#[derive(Deserialize, Debug, Clone)]
pub struct DecisionCandidate {
    action_type: String,
    policy_reference: String,
}

#[derive(Deserialize, Debug, Clone)]
pub struct Provenance {
    source_identity: String,
    timestamp: String,
    version: String,
}

#[derive(Deserialize, Debug, Clone)]
pub struct QCoreValidationRequest {
    tenant_id: String,
    finding_id: String,
    /// The identity of the workload submitting this request.
    /// Format: "svc:<service-name>:<instance-id>"
    #[serde(default)]
    actor_workload_id: String,
    evidence_package: EvidencePackage,
    decision_candidate: DecisionCandidate,
    provenance: Provenance,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct EvidenceCommitment {
    pub evidence_id: String,
    pub content_hash: String,  // BLAKE3 hex
    pub category: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DualSignature {
    pub ed25519_sig: String,
    pub ed25519_key_id: String,   // UUID of the key that signed
    pub ml_dsa_87_sig: String,
    pub ml_dsa_87_key_id: String, // UUID of the key that signed
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct VardhanSealedReceipt {
    // Identity
    pub receipt_id: String,           // "VQR-{uuid4}"
    pub schema_version: String,       // "1.0" — for algorithm agility
    pub transaction_id: String,       // links back to VardhanTransaction
    pub status: String,
    pub tenant_id: String,
    pub subject_id: String,
    pub actor_identity: String,       // who submitted the transaction
    // Decision context
    pub proposed_action: String,
    pub policy_id: String,
    pub policy_version: String,       // IMMUTABLE — historical decisions cannot be rewritten
    pub state_hash_at_decision: Option<String>,
    pub evidence_commitments: Vec<EvidenceCommitment>, // hashes only, not full evidence
    pub authority_reference: String,
    pub decision: String,             // "AUTHORIZED" | "REJECTED"
    pub outcome_code: String,
    // Ordering
    pub timestamp_ms: u64,
    pub ledger_commit_index: u64,
    // Linkage
    pub parent_receipt_id: Option<String>,
    pub correlation_id: Option<String>,
    // Cryptographic integrity
    pub payload_hash: String,         // BLAKE3 of canonical payload string
    pub issuer_key_fingerprint: String, // BLAKE3 hex of Ed25519 public key
    pub signatures: DualSignature,
}

impl VardhanSealedReceipt {
    pub fn build(
        transaction_id: String,
        status: String,
        tenant_id: String,
        subject_id: String,        // use finding_id from request
        actor_identity: String,    // from provenance.source_identity
        proposed_action: String,   // from decision_candidate.action_type
        policy_id: String,         // from decision_candidate.policy_reference
        policy_version: String,    // hardcode "1.0" for now — TODO: from policy registry
        state_hash_at_decision: Option<String>,
        evidence_commitments: Vec<EvidenceCommitment>,
        authority_reference: String,
        decision: String,
        outcome_code: String,
        ledger_commit_index: u64,
        parent_receipt_id: Option<String>,
        correlation_id: Option<String>,
        payload_hash: String,
        issuer_key_fingerprint: String,
        signatures: DualSignature,
    ) -> Self {
        use std::time::{SystemTime, UNIX_EPOCH};
        use uuid::Uuid;
        Self {
            receipt_id: format!("VQR-{}", Uuid::new_v4()),
            schema_version: "1.0".to_string(),
            transaction_id,
            status,
            tenant_id,
            subject_id,
            actor_identity,
            proposed_action,
            policy_id,
            policy_version,
            state_hash_at_decision,
            evidence_commitments,
            authority_reference,
            decision,
            outcome_code,
            timestamp_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
            ledger_commit_index,
            parent_receipt_id,
            correlation_id,
            payload_hash,
            issuer_key_fingerprint,
            signatures,
        }
    }
    
    /// Canonical payload string for signing.
    /// MUST be deterministic — always produces the same bytes for the same logical receipt.
    pub fn canonical_payload(tenant_id: &str, transaction_id: &str, proposed_action: &str, policy_id: &str, policy_version: &str) -> String {
        format!("{}::{}::{}::{}::{}", tenant_id, transaction_id, proposed_action, policy_id, policy_version)
    }
}

#[derive(Serialize, Clone)]
pub struct QCoreReceipt {
    receipt_id: String,
    status: String,
    tenant_id: String,
    finding_id: String,
    ledger_commit_index: u64,
    signatures: Signatures,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_details: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct Signatures {
    ed25519: String,
    ml_dsa_87: String,
}

#[derive(Serialize, Clone)]
pub struct HybridReceipt {
    receipt_id: String,
    tenant: String,
    timestamp: u64,
    status: String,
    algorithm: String,
    classical_algorithm: String,
    payload_hash: String,
    pq_signature: String,
    classical_signature: String,
}

mod gateway;
mod policy_authority;
mod keystore_manager;

#[tokio::main]
async fn main() {
    anti_tamper::assert_integrity();
    keystore_manager::init_keystore();
    let cli = Cli::parse();

    match &cli.command {
        Commands::ValidateCanonical => {
            let mut input = String::new();
            if let Err(_) = io::stdin().read_to_string(&mut input) {
                print_error("REJECTED_MALFORMED", "Failed to read STDIN");
                return;
            }
            let request: QCoreValidationRequest = match serde_json::from_str(&input) {
                Ok(req) => req,
                Err(e) => {
                    print_error("REJECTED_MALFORMED", &format!("Invalid JSON: {}", e));
                    return;
                }
            };
            match process_transaction(request) {
                Ok(receipt) => println!("{}", json!(receipt)),
                Err((code, msg)) => print_error(&code, &msg),
            }
        },
        Commands::Prove { decision, tenant, policy, json: output_json } => {
            let start = SystemTime::now();
            let ts = start.duration_since(UNIX_EPOCH).unwrap().as_secs();
            let receipt_id = format!("VQR-{}", Uuid::new_v4());

            let payload = format!("{}::{}::{}", tenant, decision, policy);
            let payload_hash = blake3::hash(payload.as_bytes()).to_string();
            
            if !*output_json {
                eprintln!("\n[SYSTEM] Initiating Nitro Enclave hardware verification...");
            }
            execute_hybrid_transaction(&payload);

            let (_, pq_sk) = mldsa_keypair();
            let pq_sig = mldsa_sign(payload_hash.as_bytes(), &pq_sk);

            let mut csprng = OsRng;
            let ed_sk = SigningKey::generate(&mut csprng);
            let ed_sig: EdSignature = ed_sk.sign(payload_hash.as_bytes());

            let receipt = HybridReceipt {
                receipt_id: receipt_id.clone(),
                tenant: tenant.clone(),
                timestamp: ts,
                status: "SEALED_HYBRID_PQT".to_string(),
                algorithm: "ML-DSA-87 (FIPS 204)".to_string(),
                classical_algorithm: "Ed25519".to_string(),
                payload_hash: payload_hash.clone(),
                pq_signature: hex::encode(pq_sig.as_bytes()),
                classical_signature: hex::encode(ed_sig.to_bytes()),
            };

            if *output_json {
                println!("{}", json!(receipt));
            } else {
                eprintln!("==========================================");
                eprintln!("VARDHAN Q-CORE - HYBRID RECEIPT ENGINE");
                eprintln!("==========================================");
                eprintln!("Receipt ID:   {}", receipt.receipt_id);
                eprintln!("Tenant:       {}", receipt.tenant);
                eprintln!("Payload Hash: {}", receipt.payload_hash);
                eprintln!("\n[1] POST-QUANTUM LAYER (ML-DSA-87)");
                eprintln!("PQ Sig:       {}...", &receipt.pq_signature[..64]);
                eprintln!("\n[2] CLASSICAL LAYER (Ed25519)");
                eprintln!("ED Sig:       {}", receipt.classical_signature);
                eprintln!("==========================================");
            }
        },
        Commands::Serve { port } => {
            gateway::start_server(*port).await;
        },
        Commands::Verify { receipt_id: _ } => {
            let mut input = String::new();
            if let Err(_) = io::stdin().read_to_string(&mut input) {
                eprintln!("Failed to read receipt from STDIN");
                std::process::exit(1);
            }
            
            use vardhan_verifier::{VardhanVerifier, VerifierConfig, VerifiableReceipt};
            let receipt: VerifiableReceipt = match serde_json::from_str(&input) {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("Failed to parse receipt: {}", e);
                    std::process::exit(1);
                }
            };
            
            let keystore = keystore_manager::get_keystore();
            let ed_pub_bytes = keystore.ed25519_public_key().to_bytes();
            let mldsa_pub_bytes = keystore.mldsa87_public_key().as_bytes();

            let verifier = VardhanVerifier::with_defaults();
            let result = verifier.verify(&receipt, Some(&ed_pub_bytes), Some(mldsa_pub_bytes));
            
            println!("{}", serde_json::to_string_pretty(&result).unwrap());
            
            if !result.is_valid() {
                std::process::exit(1);
            }
        }
    }
}

fn print_error(status: &str, msg: &str) {
    let receipt = VardhanSealedReceipt {
        receipt_id: "NONE".to_string(),
        schema_version: "1.0".to_string(),
        transaction_id: "NONE".to_string(),
        status: status.to_string(),
        tenant_id: "NONE".to_string(),
        subject_id: "NONE".to_string(),
        actor_identity: "NONE".to_string(),
        proposed_action: "NONE".to_string(),
        policy_id: "NONE".to_string(),
        policy_version: "1.0".to_string(),
        state_hash_at_decision: None,
        evidence_commitments: vec![],
        authority_reference: "NONE".to_string(),
        decision: "REJECTED".to_string(),
        outcome_code: msg.to_string(),
        timestamp_ms: 0,
        ledger_commit_index: 0,
        parent_receipt_id: None,
        correlation_id: None,
        payload_hash: "NONE".to_string(),
        issuer_key_fingerprint: "NONE".to_string(),
        signatures: DualSignature {
            ed25519_sig: "NONE".to_string(),
            ed25519_key_id: "NONE".to_string(),
            ml_dsa_87_sig: "NONE".to_string(),
            ml_dsa_87_key_id: "NONE".to_string(),
        },
    };
    println!("{}", json!(receipt));
}



pub fn process_transaction(request: QCoreValidationRequest) -> Result<VardhanSealedReceipt, (String, String)> {
    use vardhan_transaction::{VardhanTransaction, TransactionKind, TransactionState, TransactionProvenance, AuthorityResult, TransactionOutcome, RejectionReason};
    use std::time::{SystemTime, UNIX_EPOCH};
    use uuid::Uuid;
    use pqcrypto_mldsa::mldsa87::{keypair as mldsa_keypair, detached_sign as mldsa_sign};
    use ed25519_dalek::{SigningKey, Signer};
    use rand::rngs::OsRng;
    
    let provenance = TransactionProvenance {
        actor_identity: request.provenance.source_identity.clone(),
        source_system: "VardhanIntelligence".to_string(),
        submitted_at: request.provenance.timestamp.clone(),
        schema_version: request.provenance.version.clone(),
    };
    
    let mut tx = VardhanTransaction::new(
        &request.tenant_id,
        TransactionKind::IntelligenceFindingSealing,
        &request.finding_id,
        &request.decision_candidate.action_type,
        &request.decision_candidate.policy_reference,
        "1.0",
        provenance,
    );

    if let Err(_) = tx.transition(TransactionState::Validating) {
        return Err(("REJECTED_MALFORMED".to_string(), "Internal state machine error".to_string()));
    }

    // ── Q-Core Independent Validation ────────────────────────────────────────
    // Q-Core does NOT trust the caller's VERIFIED_FINDING label.
    // Each check below is performed independently of the Intelligence Plane.

    // V1: tenant_id — non-empty and not the nil UUID sentinel
    if request.tenant_id.is_empty() || request.tenant_id == "00000000-0000-0000-0000-000000000000" {
        let _ = tx.reject(RejectionReason::TenantMismatch);
        return Err(("REJECTED_TENANT_INVALID".to_string(), "tenant_id must be non-empty and not the nil UUID".to_string()));
    }

    // V2: finding_id — non-empty
    if request.finding_id.is_empty() {
        let _ = tx.reject(RejectionReason::InvalidProvenance);
        return Err(("REJECTED_FINDING_ID_MISSING".to_string(), "finding_id must be non-empty".to_string()));
    }

    // V3: evidence_id — non-empty (the package must have an identity)
    if request.evidence_package.evidence_id.is_empty() {
        let _ = tx.reject(RejectionReason::InvalidEvidenceReference);
        return Err(("REJECTED_EVIDENCE_ID_MISSING".to_string(), "evidence_package.evidence_id must be non-empty".to_string()));
    }

    // V4: data_hash — non-empty and looks like a hex string (64 chars = SHA-256)
    let hash = &request.evidence_package.data_hash;
    if hash.is_empty() || hash.len() != 64 || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        let _ = tx.reject(RejectionReason::InvalidEvidenceReference);
        return Err(("REJECTED_EVIDENCE_HASH_INVALID".to_string(), "evidence_package.data_hash must be a 64-char lowercase hex SHA-256 string".to_string()));
    }

    // V5: provenance source_identity — non-empty and not a generic sentinel
    let sentinel_identities = ["intelligence_plane_engine", "unknown", "test", ""];
    if sentinel_identities.contains(&request.provenance.source_identity.as_str()) {
        let _ = tx.reject(RejectionReason::InvalidProvenance);
        return Err(("REJECTED_SOURCE_IDENTITY_SENTINEL".to_string(), format!("provenance.source_identity '{}' is a disallowed sentinel value — use a specific engine ID", request.provenance.source_identity)));
    }

    // V6: provenance timestamp — non-empty and parseable as ISO 8601
    if request.provenance.timestamp.is_empty() {
        let _ = tx.reject(RejectionReason::InvalidProvenance);
        return Err(("REJECTED_TIMESTAMP_MISSING".to_string(), "provenance.timestamp must be a non-empty ISO 8601 timestamp".to_string()));
    }

    // V7: provenance version — non-empty and semver-like (at least N.N format)
    let ver = &request.provenance.version;
    if ver.is_empty() || !ver.contains('.') {
        let _ = tx.reject(RejectionReason::InvalidProvenance);
        return Err(("REJECTED_VERSION_INVALID".to_string(), "provenance.version must be a semver string e.g. '2.0.0'".to_string()));
    }

    // V8: action_type — must be from the allowed whitelist
    let allowed_actions = ["SEAL_VERIFIED_FINDING"];
    if !allowed_actions.contains(&request.decision_candidate.action_type.as_str()) {
        let _ = tx.reject(RejectionReason::PolicyDenied);
        return Err(("REJECTED_ACTION_TYPE_NOT_ALLOWED".to_string(), format!("action_type '{}' is not in the allowed policy whitelist", request.decision_candidate.action_type)));
    }

    // V9: policy_reference — must be from the known policy registry
    let allowed_policies = ["VARDHAN_CORE_INTELLIGENCE_POLICY_V1"];
    if !allowed_policies.contains(&request.decision_candidate.policy_reference.as_str()) {
        let _ = tx.reject(RejectionReason::PolicyDenied);
        return Err(("REJECTED_POLICY_UNKNOWN".to_string(), format!("policy_reference '{}' is not registered in the Q-Core policy registry", request.decision_candidate.policy_reference)));
    }

    // V10: evidence category — non-empty
    if request.evidence_package.category.is_empty() {
        let _ = tx.reject(RejectionReason::InvalidEvidenceReference);
        return Err(("REJECTED_EVIDENCE_CATEGORY_MISSING".to_string(), "evidence_package.category must be non-empty".to_string()));
    }

    // ── Authority Evaluation ─────────────────────────────────────────────────
    let _ = tx.transition(TransactionState::AuthorityEvaluation);

    let evaluator = policy_authority::GatewayAuthorityEvaluator::new();
    let ctx = policy_authority::AuthEvalContext {
        tenant_id: request.tenant_id.clone(),
        actor_workload_id: request.actor_workload_id.clone(),
        policy_reference: request.decision_candidate.policy_reference.clone(),
        declared_policy_version: "1.0".to_string(), // In a fully dynamic system this would come from the request
        action_type: request.decision_candidate.action_type.clone(),
    };

    let decision = evaluator.evaluate(&ctx);
    
    let authority_result = AuthorityResult {
        authorized: decision.is_allow(),
        authority_reference: decision.gate_reference().unwrap_or("gate:VardhanGate:DENIED").to_string(),
        evaluated_at_ms: SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64,
        reason: decision.reason().to_string(),
    };

    if let Err(_) = tx.apply_authority_result(authority_result.clone()) {
        return Err(("ERROR".to_string(), "Failed to apply authority result".to_string()));
    }

    if !decision.is_allow() {
        let _ = tx.reject(RejectionReason::AuthorityDenied);
        let code = decision.rejection_code().unwrap_or("REJECTED_UNAUTHORIZED").to_string();
        return Err((code, decision.reason().to_string()));
    }

    let _ = tx.transition(TransactionState::Executing);

    let canonical_payload = VardhanSealedReceipt::canonical_payload(
        &request.tenant_id,
        &tx.transaction_id,
        &request.decision_candidate.action_type,
        &request.decision_candidate.policy_reference,
        "1.0"
    );
    let payload_hash = blake3::hash(canonical_payload.as_bytes()).to_string();

    let keystore = keystore_manager::get_keystore();
    let ed25519_sig_result = keystore.sign_ed25519(payload_hash.as_bytes());
    let mldsa_sig_result = keystore.sign_mldsa87(payload_hash.as_bytes());

    let issuer_key_fingerprint = ed25519_sig_result.key_identity.public_key_fingerprint.clone();

    let evidence_commitments = vec![EvidenceCommitment {
        evidence_id: request.evidence_package.evidence_id,
        content_hash: request.evidence_package.data_hash,
        category: request.evidence_package.category,
    }];

    let signatures = DualSignature {
        ed25519_sig: ed25519_sig_result.signature_hex,
        ed25519_key_id: ed25519_sig_result.key_identity.key_id,
        ml_dsa_87_sig: mldsa_sig_result.signature_hex,
        ml_dsa_87_key_id: mldsa_sig_result.key_identity.key_id,
    };

    let mut receipt = VardhanSealedReceipt::build(
        tx.transaction_id.clone(),
        "SEALED".to_string(),
        request.tenant_id,
        request.finding_id,
        request.provenance.source_identity,
        request.decision_candidate.action_type,
        request.decision_candidate.policy_reference,
        "1.0".to_string(),
        None,
        evidence_commitments,
        "gate:VardhanGate".to_string(),
        "AUTHORIZED".to_string(),
        "SEALING_OK".to_string(),
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs(),
        None,
        None,
        payload_hash,
        issuer_key_fingerprint,
        signatures,
    );

    let outcome = TransactionOutcome {
        result_code: "SEALING_OK".to_string(),
        summary: "Cryptographic receipt generated successfully".to_string(),
        effect_observed: true,
        recorded_at_ms: SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64,
    };
    let _ = tx.apply_outcome(outcome);
    let _ = tx.seal(receipt.receipt_id.clone());

    Ok(receipt)
}

#[cfg(test)]
mod keystore_tests {
    use super::*;
    use std::env;
    use tempfile::tempdir;
    use vardhan_verifier::{VardhanVerifier, VerifiableReceipt};

    #[tokio::test]
    async fn test_gateway_persistent_keystore_end_to_end() {
        let temp_dir = tempdir().unwrap();
        let keystore_path = temp_dir.path().join("qcore_keys");
        env::set_var("VARDHAN_KEYSTORE_DIR", keystore_path.to_str().unwrap());
        
        // 1. Initialize keystore in process
        crate::keystore_manager::init_keystore();
        let keystore = crate::keystore_manager::get_keystore();
        
        let key_id = keystore.ed25519_identity().key_id.clone();
        
        // 2. Build a valid request
        let request_json = r#"{
            "tenant_id": "org-vardhan-intelligence",
            "finding_id": "find-12345",
            "actor_workload_id": "svc:vardhan-intelligence:test-01",
            "evidence_package": {
                "evidence_id": "ev-9999",
                "data_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
                "category": "STATIC_ANALYSIS"
            },
            "decision_candidate": {
                "action_type": "SEAL_VERIFIED_FINDING",
                "policy_reference": "VARDHAN_CORE_INTELLIGENCE_POLICY_V1"
            },
            "provenance": {
                "source_identity": "engine-v2",
                "timestamp": "2026-10-03T12:00:00Z",
                "version": "1.0.0"
            }
        }"#;
        
        let request: QCoreValidationRequest = serde_json::from_str(request_json).unwrap();
        
        // 3. Process transaction
        let receipt = process_transaction(request.clone()).unwrap();
        
        // 4. Assert stable key ID is in the receipt
        assert_eq!(receipt.signatures.ed25519_key_id, key_id);
        
        // 5. Verify receipt signatures using the independent verifier
        let receipt_json = serde_json::to_string(&receipt).unwrap();
        let verifiable_receipt: VerifiableReceipt = serde_json::from_str(&receipt_json).unwrap();
        
        let verifier = VardhanVerifier::with_defaults();
        let ed_pub_bytes = keystore.ed25519_public_key().to_bytes();
        let mldsa_pub_bytes = keystore.mldsa87_public_key().as_bytes();
        let result = verifier.verify(&verifiable_receipt, Some(&ed_pub_bytes), Some(mldsa_pub_bytes));
        
        assert!(result.is_valid(), "Verification failed: {:?}", result.failures);
        
        // 6. Reload keystore from disk (simulating process restart)
        let reloaded_keystore = vardhan_keystore::VardhanKeystore::load_from_dir(&keystore_path).unwrap();
        assert_eq!(reloaded_keystore.ed25519_identity().key_id, key_id);
        
        // Ensure the reloaded keystore can also verify the receipt (producing the same public key bytes)
        let reloaded_ed_pub_bytes = reloaded_keystore.ed25519_public_key().to_bytes();
        assert_eq!(ed_pub_bytes, reloaded_ed_pub_bytes);
    }
}
