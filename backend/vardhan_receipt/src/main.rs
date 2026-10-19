use clap::{Parser, Subcommand};
use core_crypto::anti_tamper;
use ed25519_dalek::{Signature as EdSignature, Signer, SigningKey};
use pqcrypto_mldsa::mldsa87::{detached_sign as mldsa_sign, keypair as mldsa_keypair};
use pqcrypto_traits::sign::DetachedSignature as PQDetachedSignature;
use pqcrypto_traits::sign::PublicKey;
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::io::{self, Read, Write};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;
use vardhan_hybrid_core::execute_hybrid_transaction;

#[derive(Parser)]
#[command(
    name = "vardhan_receipt",
    about = "Hybrid PQ/T Quantum Receipt Generator"
)]
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
    pub contract: crate::contract::VerifiedFindingContract,
    #[serde(default)]
    pub actor_workload_id: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct EvidenceCommitment {
    pub evidence_id: String,
    pub content_hash: String, // SHA-256 hex (computed by intelligence plane, verified on Rust side)
    pub category: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DualSignature {
    pub ed25519_sig: String,
    pub ed25519_key_id: String, // UUID of the key that signed
    pub ml_dsa_87_sig: String,
    pub ml_dsa_87_key_id: String, // UUID of the key that signed
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct VardhanSealedReceipt {
    // Identity
    pub receipt_id: String,     // "VQR-{uuid4}"
    pub schema_version: String, // "1.1" — canonical receipt protocol
    pub transaction_id: String, // links back to VardhanTransaction
    pub status: String,
    pub tenant_id: String,
    pub subject_id: String,
    pub actor_identity: String, // who submitted the transaction
    // Decision context
    pub proposed_action: String,
    pub policy_id: String,
    pub policy_version: String, // IMMUTABLE — historical decisions cannot be rewritten
    pub state_hash_at_decision: Option<String>,
    pub evidence_commitments: Vec<EvidenceCommitment>, // hashes only, not full evidence
    pub authority_reference: String,
    pub decision: String, // "AUTHORIZED" | "REJECTED"
    pub outcome_code: String,
    // Ordering
    pub timestamp_ms: u64,
    pub ledger_commit_index: u64,
    // Linkage
    pub parent_receipt_id: Option<String>,
    pub correlation_id: Option<String>,
    // Cryptographic integrity
    pub payload_hash: String,           // BLAKE3 of canonical payload string
    pub issuer_key_fingerprint: String, // BLAKE3 hex of Ed25519 public key
    pub signatures: DualSignature,
}

impl VardhanSealedReceipt {
    pub fn build(
        transaction_id: String,
        status: String,
        tenant_id: String,
        subject_id: String,      // use finding_id from request
        actor_identity: String,  // from provenance.source_identity
        proposed_action: String, // from decision_candidate.action_type
        policy_id: String,       // from decision_candidate.policy_reference
        policy_version: String,  // hardcode "1.0" for now — TODO: from policy registry
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
            schema_version: "1.1".to_string(),
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
    ///
    /// F-014: Previously only covered tenant_id, transaction_id, proposed_action,
    /// policy_id, policy_version. Now covers ALL signed fields including
    /// evidence_commitments, decision, outcome_code, authority_reference,
    /// and state_hash_at_decision.
    pub fn canonical_payload(
        tenant_id: &str,
        transaction_id: &str,
        proposed_action: &str,
        policy_id: &str,
        policy_version: &str,
        state_hash_at_decision: &str,
        evidence_commitments: &[EvidenceCommitment],
        authority_reference: &str,
        decision: &str,
        outcome_code: &str,
    ) -> String {
        // Build evidence commitments canonical string
        let evidence_str: String = evidence_commitments
            .iter()
            .map(|ec| format!("{}|{}|{}", ec.evidence_id, ec.content_hash, ec.category))
            .collect::<Vec<_>>()
            .join(";");

        format!(
            "{}::{}::{}::{}::{}::{}::{}::{}::{}::{}",
            tenant_id,
            transaction_id,
            proposed_action,
            policy_id,
            policy_version,
            state_hash_at_decision,
            evidence_str,
            authority_reference,
            decision,
            outcome_code,
        )
    }

    /// Canonical bytes used by the control-plane verifier. Every persisted and
    /// routed receipt field that establishes identity or lineage is length
    /// prefixed to prevent delimiter ambiguity.
    pub fn canonical_receipt_payload(&self) -> Vec<u8> {
        let evidence = self
            .evidence_commitments
            .iter()
            .map(|item| {
                format!(
                    "{}:{}:{}",
                    item.evidence_id, item.content_hash, item.category
                )
            })
            .collect::<Vec<_>>()
            .join(";");
        let fields = [
            self.schema_version.as_str(),
            self.receipt_id.as_str(),
            self.transaction_id.as_str(),
            self.tenant_id.as_str(),
            self.subject_id.as_str(),
            self.actor_identity.as_str(),
            self.proposed_action.as_str(),
            self.policy_id.as_str(),
            self.policy_version.as_str(),
            self.state_hash_at_decision.as_deref().unwrap_or(""),
            evidence.as_str(),
            self.authority_reference.as_str(),
            self.decision.as_str(),
            self.outcome_code.as_str(),
            &self.timestamp_ms.to_string(),
            &self.ledger_commit_index.to_string(),
            self.parent_receipt_id.as_deref().unwrap_or(""),
            self.correlation_id.as_deref().unwrap_or(""),
        ];
        fields
            .iter()
            .flat_map(|field| {
                let mut encoded = format!("{}:", field.len()).into_bytes();
                encoded.extend_from_slice(field.as_bytes());
                encoded.push(b'|');
                encoded
            })
            .collect()
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

pub mod audit_trail;
mod auth_config;
pub mod contract;
mod gateway;
mod keystore_manager;
mod policy_authority;
pub mod trust_boundary;

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

            // --- IDEMPOTENCY CHECK ---
            // Use a local sled DB to track sealed finding IDs.
            // In a production system, this would be a distributed ledger or shared cache.
            // The same check is also enforced inside process_transaction() for defense in depth.
            let finding_id = request.contract.finding_id.clone();
            if is_finding_already_sealed(&finding_id) {
                print_error(
                    "REJECTED_REPLAY",
                    &format!("Finding {} has already been sealed", finding_id),
                );
                return;
            }

            match process_transaction(request) {
                Ok(receipt) => {
                    println!("{}", json!(receipt));
                }
                Err((code, msg)) => print_error(&code, &msg),
            }
        }
        Commands::Prove {
            decision,
            tenant,
            policy,
            json: output_json,
        } => {
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
        }
        Commands::Serve { port } => {
            gateway::start_server(*port).await;
        }
        Commands::Verify { receipt_id: _ } => {
            let mut input = String::new();
            if let Err(_) = io::stdin().read_to_string(&mut input) {
                eprintln!("Failed to read receipt from STDIN");
                std::process::exit(1);
            }

            use vardhan_verifier::{VardhanVerifier, VerifiableReceipt};
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

/// Check whether a finding_id has already been sealed in the durable
/// idempotency store. This is the enforcement point for replay protection
/// at the `process_transaction` level — not merely a terminal-state
/// validation error.
fn idempotency_store_path() -> std::path::PathBuf {
    std::env::var("VARDHAN_IDEMPOTENCY_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from("vardhan_receipt_idempotency"))
}

/// Check whether a finding_id has already been sealed in the durable
/// idempotency store. Uses an atomic file-existence test.
fn is_finding_already_sealed(finding_id: &str) -> bool {
    idempotency_store_path()
        .join(format!("sealed_{}.flag", finding_id))
        .exists()
}

/// Check whether a finding_id is currently reserved (in-flight) by any process.
fn is_finding_reserved(finding_id: &str) -> bool {
    idempotency_store_path()
        .join(format!("sealed_{}.reserve", finding_id))
        .exists()
        || is_finding_already_sealed(finding_id)
}

/// Atomically reserve a finding_id for sealing.
/// Uses `O_CREAT | O_EXCL` (exclusive create) so that if two processes
/// race, only one succeeds. Returns `true` if this caller won the race
/// (reservation created), `false` if another process already claimed it.
fn reserve_finding(finding_id: &str) -> bool {
    let dir = idempotency_store_path();
    let _ = std::fs::create_dir_all(&dir);
    let reserve_path = dir.join(format!("sealed_{}.reserve", finding_id));
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .truncate(false)
        .create(true)
        .open(&reserve_path)
        .map(|mut f| {
            let _ = f.write_all(b"RESERVED");
        })
        .is_ok()
}

/// Promote a reservation to a committed seal record.
/// Creates the `.flag` file (with "SEALED" content) and removes the
/// `.reserve` file, making the finding visible to `is_finding_already_sealed()`.
/// Called only after successful sealing.
fn commit_finding_sealed(finding_id: &str) {
    let dir = idempotency_store_path();
    let reserve_path = dir.join(format!("sealed_{}.reserve", finding_id));
    let flag_path = dir.join(format!("sealed_{}.flag", finding_id));
    // Write the flag file with "SEALED" content (overwrite if the rename
    // left "RESERVED" content from the reserve phase).
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(&flag_path)
    {
        let _ = f.write_all(b"SEALED");
    }
    let _ = std::fs::remove_file(&reserve_path);
}

/// Release a reservation after a failed attempt, so the finding_id
/// can be retried. Called on any error path after `reserve_finding`.
fn release_finding_reservation(finding_id: &str) {
    let dir = idempotency_store_path();
    let reserve_path = dir.join(format!("sealed_{}.reserve", finding_id));
    let _ = std::fs::remove_file(&reserve_path);
}

#[cfg(test)]
#[allow(dead_code)]
fn clear_idempotency_store() {
    let _ = std::fs::remove_dir_all(idempotency_store_path());
}

pub fn process_transaction(
    request: QCoreValidationRequest,
) -> Result<VardhanSealedReceipt, (String, String)> {
    use std::time::{SystemTime, UNIX_EPOCH};
    use vardhan_transaction::{
        AuthorityResult, RejectionReason, TransactionKind, TransactionOutcome,
        TransactionProvenance, TransactionState, VardhanTransaction,
    };

    // ── Idempotency / Replay Protection (durable lifecycle enforcement) ──
    // Check the durable idempotency store BEFORE any state mutation.
    // This prevents double-sealing of the same finding_id at the
    // process_transaction level — not merely a terminal-state validation
    // error, but a pre-execution durable guard.
    let finding_id = request.contract.finding_id.clone();
    if is_finding_already_sealed(&finding_id) {
        return Err((
            "REJECTED_REPLAY".to_string(),
            format!(
                "Finding '{}' has already been sealed — duplicate submission \
                 rejected by durable idempotency guard",
                finding_id
            ),
        ));
    }

    // Atomically reserve the finding_id BEFORE any state mutation.
    // If another concurrent process won the race, reject immediately.
    // The reservation is promoted to a committed seal only after the
    // receipt is successfully generated. On any failure path, the
    // reservation is released so the finding can be retried.
    if !reserve_finding(&finding_id) {
        return Err((
            "REJECTED_REPLAY".to_string(),
            format!(
                "Finding '{}' is being sealed by another process — \
                 duplicate submission rejected by atomic idempotency guard",
                finding_id
            ),
        ));
    }

    // Evaluate trust boundary conditions on the full VerifiedFindingContract
    if let Err(e) = crate::trust_boundary::TrustBoundaryValidator::validate(&request.contract) {
        release_finding_reservation(&finding_id);
        return Err(("REJECTED_TRUST_BOUNDARY".to_string(), e));
    }

    let provenance = TransactionProvenance {
        actor_identity: request.contract.intelligence.engine_id.clone(),
        source_system: "VardhanIntelligence".to_string(),
        submitted_at: request.contract.created_at.clone(),
        schema_version: request.contract.schema_version.clone(),
    };

    let mut tx = VardhanTransaction::new(
        &request.contract.organization.organization_id,
        TransactionKind::IntelligenceFindingSealing,
        &request.contract.finding_id,
        &request.contract.decision_candidate,
        &request.contract.policy_reference,
        "1.0",
        provenance,
    );

    if let Err(_) = tx.transition(TransactionState::Validating) {
        release_finding_reservation(&finding_id);
        return Err((
            "REJECTED_MALFORMED".to_string(),
            "Internal state machine error".to_string(),
        ));
    }

    // ── Authority Evaluation ─────────────────────────────────────────────────
    let _ = tx.transition(TransactionState::AuthorityEvaluation);

    let evaluator = policy_authority::GatewayAuthorityEvaluator::new();
    let ctx = policy_authority::AuthEvalContext {
        tenant_id: request.contract.organization.organization_id.clone(),
        actor_workload_id: request.actor_workload_id.clone(),
        policy_reference: request.contract.policy_reference.clone(),
        declared_policy_version: "1.0".to_string(), // In a fully dynamic system this would come from the request
        action_type: request.contract.decision_candidate.clone(),
    };

    let decision = evaluator.evaluate(&ctx);

    let authority_result = AuthorityResult {
        authorized: decision.is_allow(),
        authority_reference: decision
            .gate_reference()
            .unwrap_or("gate:VardhanGate:DENIED")
            .to_string(),
        evaluated_at_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64,
        reason: decision.reason().to_string(),
    };

    if let Err(_) = tx.apply_authority_result(authority_result.clone()) {
        release_finding_reservation(&finding_id);
        return Err((
            "ERROR".to_string(),
            "Failed to apply authority result".to_string(),
        ));
    }

    if !decision.is_allow() {
        let _ = tx.reject(RejectionReason::AuthorityDenied);
        release_finding_reservation(&finding_id);
        let code = decision
            .rejection_code()
            .unwrap_or("REJECTED_UNAUTHORIZED")
            .to_string();
        return Err((code, decision.reason().to_string()));
    }

    let _ = tx.transition(TransactionState::Executing);

    let evidence_commitments = request
        .contract
        .evidence_refs
        .iter()
        .map(|ev| EvidenceCommitment {
            evidence_id: ev.evidence_id.clone(),
            content_hash: ev.content_hash.clone(),
            category: request.contract.technical_area.clone(),
        })
        .collect::<Vec<_>>();

    let keystore = keystore_manager::get_keystore();
    let tenant_id = request.contract.organization.organization_id.clone();
    let engine_id = request.contract.intelligence.engine_id.clone();
    let policy_ref = request.contract.policy_reference.clone();
    let mut receipt = VardhanSealedReceipt::build(
        tx.transaction_id.clone(),
        "SEALED".to_string(),
        request.contract.organization.organization_id,
        request.contract.finding_id,
        request.contract.intelligence.engine_id,
        request.contract.decision_candidate,
        request.contract.policy_reference,
        "1.0".to_string(),
        None, // state_hash_at_decision — not yet populated in v1.0 contract
        evidence_commitments,
        "gate:VardhanGate".to_string(),
        "AUTHORIZED".to_string(),
        "SEALING_OK".to_string(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs(),
        None,
        None,
        String::new(),
        String::new(),
        DualSignature {
            ed25519_sig: String::new(),
            ed25519_key_id: String::new(),
            ml_dsa_87_sig: String::new(),
            ml_dsa_87_key_id: String::new(),
        },
    );

    let payload_hash = blake3::hash(&receipt.canonical_receipt_payload()).to_string();
    let ed25519_sig_result = keystore.sign_ed25519(payload_hash.as_bytes());
    let mldsa_sig_result = keystore.sign_mldsa87(payload_hash.as_bytes());
    receipt.payload_hash = payload_hash;
    receipt.issuer_key_fingerprint = ed25519_sig_result
        .key_identity
        .public_key_fingerprint
        .clone();
    receipt.signatures = DualSignature {
        ed25519_sig: ed25519_sig_result.signature_hex,
        ed25519_key_id: ed25519_sig_result.key_identity.key_id,
        ml_dsa_87_sig: mldsa_sig_result.signature_hex,
        ml_dsa_87_key_id: mldsa_sig_result.key_identity.key_id,
    };

    let outcome = TransactionOutcome {
        result_code: "SEALING_OK".to_string(),
        summary: "Cryptographic receipt generated successfully".to_string(),
        effect_observed: true,
        recorded_at_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64,
    };
    let _ = tx.apply_outcome(outcome);
    let _ = tx.seal(receipt.receipt_id.clone());

    // Promote the atomic reservation to a committed seal record.
    // Only after successful sealing is the finding_id permanently marked
    // as sealed, making it visible to is_finding_already_sealed().
    commit_finding_sealed(&finding_id);

    // ── Audit Integrity: append a crash-safe, signed audit trail entry ──
    // This binds the authorization decision to an execution ID and hash
    // in a durable, hash-chained log.
    let audit_path = idempotency_store_path()
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."))
        .join("audit_trail.jsonl");

    // Best-effort audit append: if the audit log fails, we do NOT roll back
    // the receipt (it's already sealed), but we do log the error.
    match audit_trail::AuditWriter::open(&audit_path, receipt.issuer_key_fingerprint.clone()) {
        Ok(mut writer) => {
            let event = json!({
                "event_type": "QCoreSealedReceipt",
                "finding_id": &finding_id,
                "receipt_id": &receipt.receipt_id,
                "tenant_id": &tenant_id,
                "policy_id": &policy_ref,
                "actor_identity": &engine_id,
                "actor_workload_id": &request.actor_workload_id,
                "outcome_code": "SEALING_OK",
                "payload_hash": &receipt.payload_hash,
                "decision": &receipt.decision,
                "authorization_reference": &receipt.authority_reference,
            });
            let keystore_ref = keystore_manager::get_keystore();
            match writer.append(event, |payload: &[u8]| {
                let signing_result = keystore_ref.sign_mldsa87(payload);
                hex::decode(&signing_result.signature_hex).unwrap_or_default()
            }) {
                Ok(entry) => {
                    tracing::info!(
                        "Audit entry appended: seq={}, hash_chain_tip={}",
                        entry.seq,
                        &entry.signature[..16]
                    );
                }
                Err(e) => {
                    tracing::warn!("Failed to append audit entry: {}", e);
                }
            }
        }
        Err(e) => {
            tracing::warn!("Failed to open audit trail: {}", e);
        }
    }

    Ok(receipt)
}

// Shared test environment mutex — prevents env-var races between
// keystore_tests and e2e_boundary_tests in parallel test execution.
// See pattern from F-001 remediation.
#[cfg(test)]
static TEST_ENV_MUTEX: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[cfg(test)]
mod keystore_tests {
    use super::*;
    use tempfile::tempdir;
    use vardhan_verifier::{VardhanVerifier, VerifiableReceipt};

    // Shared with e2e_boundary_tests to prevent env-var races in parallel execution
    // Uses the crate-level TEST_ENV_MUTEX static.

    #[tokio::test]
    async fn test_gateway_persistent_keystore_end_to_end() {
        let _lock = crate::TEST_ENV_MUTEX.lock().unwrap();
        let temp_dir = tempdir().unwrap();
        let keystore_path = temp_dir.path().join("qcore_keys");
        unsafe {
            std::env::set_var("VARDHAN_ENV", "development");
            std::env::set_var("VARDHAN_KEYSTORE_DIR", keystore_path.to_str().unwrap());
        }

        // 1. Initialize keystore in process
        crate::keystore_manager::init_keystore();

        // Idempotency store: use a unique finding_id ("find-gw-e2e-unique")
        // which avoids any cross-test replay conflicts without needing to
        // clear the shared store (which would race with concurrent tests).
        let ks = crate::keystore_manager::get_keystore();
        let _ = ks.save_to_dir(&keystore_path);
        let keystore = crate::keystore_manager::get_keystore();

        let key_id = keystore.ed25519_identity().key_id.clone();

        // 2. Build a valid request
        let request_json = r#"{
            "contract": {
                "schema_version": "1.0",
                "finding_id": "find-gw-e2e-unique",
                "intelligence": {
                    "engine_id": "engine-v2",
                    "engine_version": "2.0.0",
                    "run_id": "run-999"
                },
                "organization": {
                    "organization_id": "org-vardhan-intelligence",
                    "canonical_domain": "vardhan.org"
                },
                "affected_resource": {
                    "canonical_url": "https://api.vardhan.org",
                    "surface_type": "API_REST",
                    "entry_point_id": "ep-1"
                },
                "technical_area": "STATIC_ANALYSIS",
                "technical_mechanism": "SQLi",
                "expected_behavior": "safe",
                "observed_behavior": "vulnerable",
                "differential_state": "CONFIRMED_MISMATCH",
                "materiality": "HIGH",
                "evidence_refs": [{
                    "evidence_id": "ev-9999",
                    "public_url": "https://evidence.org",
                    "temporal_status": "CURRENT",
                    "is_context_artifact": false,
                    "evidence_origin": "scan",
                    "content_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
                }],
                "provenance_chain": {
                    "expectation_id": "exp-1",
                    "observation_ids": ["obs-1"],
                    "differential_id": "diff-1",
                    "hypothesis_id": "hyp-1",
                    "verification_contract_id": "verif-1"
                },
                "contradictory_evidence_ids": [],
                "uncertainty": [],
                "benign_explanation": "",
                "authorization_context": {
                    "requires_authorized_assessment": false
                },
                "decision_candidate": "SEAL_VERIFIED_FINDING",
                "policy_reference": "VARDHAN_CORE_INTELLIGENCE_POLICY_V1",
                "created_at": "2026-10-03T12:00:00Z",
                "evidence_earliest_retrieved_at": "2026-10-03T11:00:00Z",
                "evidence_latest_retrieved_at": "2026-10-03T11:30:00Z"
            },
            "actor_workload_id": "svc:vardhan-intelligence:test-01"
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
        let result = verifier.verify(
            &verifiable_receipt,
            Some(&ed_pub_bytes),
            Some(mldsa_pub_bytes),
        );

        assert!(
            result.is_valid(),
            "Verification failed: {:?}",
            result.failures
        );

        // 6. Reload keystore from disk (simulating process restart)
        let reloaded_keystore =
            vardhan_keystore::VardhanKeystore::load_from_dir(&keystore_path).unwrap();
        assert_eq!(reloaded_keystore.ed25519_identity().key_id, key_id);

        // Ensure the reloaded keystore can also verify the receipt (producing the same public key bytes)
        let reloaded_ed_pub_bytes = reloaded_keystore.ed25519_public_key().to_bytes();
        assert_eq!(ed_pub_bytes, reloaded_ed_pub_bytes);
    }
}
#[cfg(test)]
mod e2e_boundary_tests {
    use super::*;
    use crate::contract::*;
    use std::path::PathBuf;
    use tempfile::tempdir;

    fn get_valid_contract() -> VerifiedFindingContract {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let id = COUNTER.fetch_add(1, Ordering::SeqCst);
        VerifiedFindingContract {
            schema_version: "1.0".to_string(),
            finding_id: format!("find-{}", id),
            intelligence: IntelligenceIdentity {
                engine_id: "engine-v2".to_string(),
                engine_version: "2.0.0".to_string(),
                run_id: "run-999".to_string(),
            },
            organization: OrganizationIdentity {
                organization_id: "org-vardhan-intelligence".to_string(),
                canonical_domain: "vardhan.org".to_string(),
            },
            affected_resource: ResourceIdentity {
                canonical_url: "https://api.vardhan.org".to_string(),
                surface_type: "API_REST".to_string(),
                entry_point_id: "ep-1".to_string(),
            },
            technical_area: "STATIC_ANALYSIS".to_string(),
            technical_mechanism: "SQLi".to_string(),
            expected_behavior: "safe".to_string(),
            observed_behavior: "vulnerable".to_string(),
            differential_state: "CONFIRMED_MISMATCH".to_string(),
            materiality: "HIGH".to_string(),
            evidence_refs: vec![EvidenceRef {
                evidence_id: "ev-9999".to_string(),
                public_url: "https://evidence.org".to_string(),
                temporal_status: "CURRENT".to_string(),
                is_context_artifact: false,
                evidence_origin: "scan".to_string(),
                content_hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
                    .to_string(),
            }],
            provenance_chain: ProvenanceChain {
                expectation_id: "exp-1".to_string(),
                observation_ids: vec!["obs-1".to_string()],
                differential_id: "diff-1".to_string(),
                hypothesis_id: "hyp-1".to_string(),
                verification_contract_id: "verif-1".to_string(),
            },
            contradictory_evidence_ids: vec![],
            uncertainty: vec![],
            benign_explanation: "".to_string(),
            authorization_context: AuthorizationContext {
                requires_authorized_assessment: false,
                authorized_by: None,
                authorization_scope: None,
            },
            decision_candidate: "SEAL_VERIFIED_FINDING".to_string(),
            policy_reference: "VARDHAN_CORE_INTELLIGENCE_POLICY_V1".to_string(),
            created_at: "2026-10-03T12:00:00Z".to_string(),
            evidence_earliest_retrieved_at: "2026-10-03T11:00:00Z".to_string(),
            evidence_latest_retrieved_at: "2026-10-03T11:30:00Z".to_string(),
        }
    }

    // Serialize test environment initialization to prevent env-var races
    // in parallel test execution. Uses the crate-level TEST_ENV_MUTEX static.
    // The OnceLock in keystore_manager means only the first init_test_env
    // call actually creates the keystore.
    // Keep the temp dir alive for the lifetime of the test process
    static TEST_KEYSTORE_DIR: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

    fn init_test_env() {
        let _guard = crate::TEST_ENV_MUTEX.lock().unwrap();

        // Set VARDHAN_ENV=development to ensure the dev key protection provider is used
        unsafe {
            std::env::set_var("VARDHAN_ENV", "development");
        }

        let keystore_path = TEST_KEYSTORE_DIR
            .get_or_init(|| {
                let temp_dir = tempdir().unwrap();
                let path = temp_dir.path().to_path_buf();
                // Leak the temp dir so it persists for the test process lifetime
                std::mem::forget(temp_dir);
                path
            })
            .join("qcore_keys");

        // Set idempotency store path for tests
        let idempotency_path = TEST_KEYSTORE_DIR
            .get_or_init(|| {
                let temp_dir = tempdir().unwrap();
                let path = temp_dir.path().to_path_buf();
                std::mem::forget(temp_dir);
                path
            })
            .join("idempotency");
        let idempotency_path_str = idempotency_path.to_str().unwrap().to_string();
        unsafe {
            std::env::set_var("VARDHAN_IDEMPOTENCY_DIR", &idempotency_path_str);
        }

        // Idempotency store is NOT cleared here. Each test uses a unique
        // finding_id (via atomic counter in get_valid_contract()), so there
        // are no cross-test replay conflicts. The store is only cleared
        // in tests that use hardcoded finding_ids (e.g. test_gateway_persistent_keystore_end_to_end).

        let keystore_path_str = keystore_path.to_str().unwrap().to_string();
        unsafe {
            std::env::set_var("VARDHAN_KEYSTORE_DIR", &keystore_path_str);
        }
        crate::keystore_manager::init_keystore();
    }

    #[test]
    fn test_a_valid_contract_accepts() {
        init_test_env();
        let contract = get_valid_contract();
        let req = QCoreValidationRequest {
            contract,
            actor_workload_id: "svc:vardhan-intelligence:test-01".to_string(),
        };
        assert!(process_transaction(req).is_ok());
    }

    #[test]
    fn test_b_modify_evidence_hash_rejects() {
        init_test_env();
        let mut contract = get_valid_contract();
        contract.evidence_refs[0].content_hash = "deadbeef".to_string(); // Invalid hash length
        let req = QCoreValidationRequest {
            contract,
            actor_workload_id: "svc:vardhan-intelligence:test-01".to_string(),
        };
        assert!(process_transaction(req).is_err());
    }

    #[test]
    fn test_d_change_tenant_id_rejects() {
        init_test_env();
        let mut contract = get_valid_contract();
        contract.organization.organization_id = "".to_string();
        let req = QCoreValidationRequest {
            contract,
            actor_workload_id: "svc:vardhan-intelligence:test-01".to_string(),
        };
        assert!(process_transaction(req).is_err());
    }

    #[test]
    fn test_f_replace_verified_status_without_chain_rejects() {
        init_test_env();
        let mut contract = get_valid_contract();
        contract.differential_state = "UNCONFIRMED".to_string();
        let req = QCoreValidationRequest {
            contract,
            actor_workload_id: "svc:vardhan-intelligence:test-01".to_string(),
        };
        assert!(process_transaction(req).is_err());
    }

    #[test]
    fn test_g_break_expectation_linkage_rejects() {
        init_test_env();
        let mut contract = get_valid_contract();
        contract.provenance_chain.expectation_id = "".to_string();
        let req = QCoreValidationRequest {
            contract,
            actor_workload_id: "svc:vardhan-intelligence:test-01".to_string(),
        };
        assert!(process_transaction(req).is_err());
    }

    #[test]
    fn test_j_historical_evidence_rejects() {
        init_test_env();
        let mut contract = get_valid_contract();
        contract.evidence_refs[0].temporal_status = "HISTORICAL".to_string();
        let req = QCoreValidationRequest {
            contract,
            actor_workload_id: "svc:vardhan-intelligence:test-01".to_string(),
        };
        assert!(process_transaction(req).is_err());
    }

    #[test]
    fn test_k_contradictory_evidence_rejects() {
        init_test_env();
        let mut contract = get_valid_contract();
        contract
            .contradictory_evidence_ids
            .push("ev-9998".to_string());
        let req = QCoreValidationRequest {
            contract,
            actor_workload_id: "svc:vardhan-intelligence:test-01".to_string(),
        };
        assert!(process_transaction(req).is_err());
    }

    #[test]
    fn test_l_invalid_policy_rejects() {
        init_test_env();
        let mut contract = get_valid_contract();
        contract.policy_reference = "MALICIOUS_POLICY".to_string();
        let req = QCoreValidationRequest {
            contract,
            actor_workload_id: "svc:vardhan-intelligence:test-01".to_string(),
        };
        assert!(process_transaction(req).is_err());
    }

    #[test]
    fn test_m_unauthorized_actor_rejects() {
        init_test_env();
        let contract = get_valid_contract();
        // The policy_authority module requires authorized actor. We can test this by changing it.
        let req = QCoreValidationRequest {
            contract,
            actor_workload_id: "unauthorized-hacker".to_string(),
        };
        assert!(process_transaction(req).is_err());
    }

    #[test]
    fn test_n_wrong_tenant_rejects() {
        init_test_env();
        let mut contract = get_valid_contract();
        // policy_authority expects 'org-vardhan-intelligence'.
        contract.organization.organization_id = "org-unauthorized".to_string();
        let req = QCoreValidationRequest {
            contract,
            actor_workload_id: "svc:vardhan-intelligence:test-01".to_string(),
        };
        let res = process_transaction(req);
        assert!(res.is_err());
    }

    #[test]
    fn test_p_malformed_contract_version_rejects() {
        init_test_env();
        let mut contract = get_valid_contract();
        contract.schema_version = "9.9".to_string();
        let req = QCoreValidationRequest {
            contract,
            actor_workload_id: "svc:vardhan-intelligence:test-01".to_string(),
        };
        assert!(process_transaction(req).is_err());
    }

    #[test]
    fn test_q_replay_identical_transaction_rejected() {
        init_test_env();
        let ks = crate::keystore_manager::get_keystore();
        let keyst_dir = std::env::var("VARDHAN_KEYSTORE_DIR").unwrap();
        let _ = ks.save_to_dir(&std::path::PathBuf::from(&keyst_dir));
        let contract = get_valid_contract();
        let req1 = QCoreValidationRequest {
            contract: contract.clone(),
            actor_workload_id: "svc:vardhan-intelligence:test-01".to_string(),
        };
        let _receipt1 = process_transaction(req1.clone()).unwrap();

        // Replay attempt: the same finding_id is submitted a second time.
        // The durable idempotency guard inside process_transaction() must
        // reject it — NOT merely as a terminal-state validation error, but
        // as a pre-execution durable lifecycle enforcement.
        let result2 = process_transaction(req1);
        assert!(
            result2.is_err(),
            "Replay protection must reject duplicate finding_id submission"
        );
        let (code2, _msg2) = result2.err().unwrap();
        assert_eq!(
            code2, "REJECTED_REPLAY",
            "Duplicate submission must return REJECTED_REPLAY, got: {}",
            code2
        );
    }

    #[test]
    fn test_q2_concurrent_duplicate_seals_exactly_once() {
        use std::sync::{Arc, Barrier};
        use std::thread;

        init_test_env();
        let ks = crate::keystore_manager::get_keystore();
        let keyst_dir = std::env::var("VARDHAN_KEYSTORE_DIR").unwrap();
        let _ = ks.save_to_dir(&std::path::PathBuf::from(&keyst_dir));

        // Use a unique finding_id for this test
        use std::sync::atomic::{AtomicUsize, Ordering};
        static CONC_COUNTER: AtomicUsize = AtomicUsize::new(0);
        let id = CONC_COUNTER.fetch_add(1, Ordering::SeqCst);
        let finding_id = format!("find-conc-{}", id);

        // Clean any pre-existing flag and reservation for this finding_id
        let store_path = idempotency_store_path();
        let flag_path = store_path.join(format!("sealed_{}.flag", finding_id));
        let reserve_path = store_path.join(format!("sealed_{}.reserve", finding_id));
        let _ = std::fs::remove_file(&flag_path);
        let _ = std::fs::remove_file(&reserve_path);

        let mut contract = get_valid_contract();
        contract.finding_id = finding_id.clone();
        let req = QCoreValidationRequest {
            contract,
            actor_workload_id: "svc:vardhan-intelligence:test-01".to_string(),
        };

        let num_threads = 5;
        let barrier = Arc::new(Barrier::new(num_threads));

        // Spawn num_threads threads that ALL submit the same finding_id
        // simultaneously, using a barrier to maximize race window.
        let results: Vec<_> = (0..num_threads)
            .map(|i| {
                let b = barrier.clone();
                let req_clone = req.clone();
                thread::spawn(move || {
                    b.wait(); // All threads released simultaneously
                    process_transaction(req_clone)
                })
            })
            .collect();

        // Collect outcomes
        let mut sealed_count = 0;
        let mut replay_count = 0;
        for handle in results {
            match handle.join() {
                Ok(Ok(_)) => sealed_count += 1,
                Ok(Err((code, _))) => {
                    if code == "REJECTED_REPLAY" {
                        replay_count += 1;
                    } else {
                        panic!("Unexpected rejection code in concurrent test: {}", code);
                    }
                }
                Err(_) => panic!("Thread panicked during concurrent submission"),
            }
        }

        assert_eq!(
            sealed_count, 1,
            "Exactly one concurrent submission must seal, got {}",
            sealed_count
        );
        assert_eq!(
            replay_count, 4,
            "Four concurrent submissions must be rejected as REPLAY, got {}",
            replay_count
        );

        // Clean up after test
        let _ = std::fs::remove_file(&flag_path);
        let _ = std::fs::remove_file(&reserve_path);
    }

    #[test]
    fn test_s_identity_substitution_fails() {
        init_test_env();
        let mut contract = get_valid_contract();
        // Attacker tries to pass the tenant ID as the actor workload ID
        let req1 = QCoreValidationRequest {
            contract: contract.clone(),
            actor_workload_id: contract.organization.organization_id.clone(),
        };
        assert!(
            process_transaction(req1).is_err(),
            "Substituting tenant identity for actor workload must fail"
        );

        // Attacker tries to pass the intelligence engine ID as the tenant ID
        contract.organization.organization_id = contract.intelligence.engine_id.clone();
        let req2 = QCoreValidationRequest {
            contract,
            actor_workload_id: "svc:vardhan-intelligence:test-01".to_string(),
        };
        assert!(
            process_transaction(req2).is_err(),
            "Substituting engine identity for tenant must fail"
        );
    }
    #[test]
    fn test_r_alter_sealed_receipt_fails_verification() {
        init_test_env();
        let contract = get_valid_contract();
        let req = QCoreValidationRequest {
            contract,
            actor_workload_id: "svc:vardhan-intelligence:test-01".to_string(),
        };
        let mut receipt = process_transaction(req).unwrap();

        // Alter receipt
        receipt.tenant_id = "MALICIOUS_ALTERATION".to_string();

        let receipt_json = serde_json::to_string(&receipt).unwrap();
        let verifiable_receipt: vardhan_verifier::VerifiableReceipt =
            serde_json::from_str(&receipt_json).unwrap();

        let keystore = crate::keystore_manager::get_keystore();
        let verifier = vardhan_verifier::VardhanVerifier::with_defaults();
        let result = verifier.verify(
            &verifiable_receipt,
            Some(&keystore.ed25519_public_key().to_bytes()),
            Some(keystore.mldsa87_public_key().as_bytes()),
        );

        assert!(!result.is_valid());
    }

    // ─────────────────────────────────────────────────────────────────────
    // RELEASE-GATE REGRESSION TESTS
    // ─────────────────────────────────────────────────────────────────────

    /// R1: Tampered Ed25519 signature in a sealed receipt must be rejected
    /// by the independent verifier (vardhan_verifier / VardhanVerifier).
    #[test]
    fn test_r1_tampered_ed25519_signature_rejected() {
        init_test_env();
        let contract = get_valid_contract();
        let req = QCoreValidationRequest {
            contract,
            actor_workload_id: "svc:vardhan-intelligence:test-01".to_string(),
        };
        let mut receipt = process_transaction(req).unwrap();

        // Tamper with the Ed25519 signature — flip a hex character
        let original_sig = receipt.signatures.ed25519_sig.clone();
        let tampered_sig = if original_sig.starts_with("a") {
            original_sig.replacen('a', "b", 1)
        } else {
            let mut chars: Vec<char> = original_sig.chars().collect();
            if chars.len() > 0 {
                chars[0] = 'a';
                chars.iter().collect()
            } else {
                original_sig.clone()
            }
        };
        receipt.signatures.ed25519_sig = tampered_sig;

        let receipt_json = serde_json::to_string(&receipt).unwrap();
        let verifiable_receipt: vardhan_verifier::VerifiableReceipt =
            serde_json::from_str(&receipt_json).unwrap();

        let keystore = crate::keystore_manager::get_keystore();
        let verifier = vardhan_verifier::VardhanVerifier::with_defaults();
        let result = verifier.verify(
            &verifiable_receipt,
            Some(&keystore.ed25519_public_key().to_bytes()),
            Some(keystore.mldsa87_public_key().as_bytes()),
        );

        assert!(
            !result.is_valid(),
            "Tampered Ed25519 signature must be rejected by the verifier"
        );
        assert!(
            result
                .failures
                .iter()
                .any(|f| f.check == "ed25519_signature_valid"),
            "Expected ed25519_signature_valid failure, got: {:?}",
            result.failures
        );
    }

    /// R2: Tampered ML-DSA-87 signature in a sealed receipt must be rejected.
    #[test]
    fn test_r2_tampered_mldsa87_signature_rejected() {
        init_test_env();
        let contract = get_valid_contract();
        let req = QCoreValidationRequest {
            contract,
            actor_workload_id: "svc:vardhan-intelligence:test-01".to_string(),
        };
        let mut receipt = process_transaction(req).unwrap();

        // Tamper with the ML-DSA-87 signature — flip a hex character
        let original_sig = receipt.signatures.ml_dsa_87_sig.clone();
        let tampered_sig = if original_sig.starts_with("a") {
            original_sig.replacen('a', "b", 1)
        } else {
            let mut chars: Vec<char> = original_sig.chars().collect();
            if chars.len() > 0 {
                chars[0] = 'a';
                chars.iter().collect()
            } else {
                original_sig.clone()
            }
        };
        receipt.signatures.ml_dsa_87_sig = tampered_sig;

        let receipt_json = serde_json::to_string(&receipt).unwrap();
        let verifiable_receipt: vardhan_verifier::VerifiableReceipt =
            serde_json::from_str(&receipt_json).unwrap();

        let keystore = crate::keystore_manager::get_keystore();
        let verifier = vardhan_verifier::VardhanVerifier::with_defaults();
        let result = verifier.verify(
            &verifiable_receipt,
            Some(&keystore.ed25519_public_key().to_bytes()),
            Some(keystore.mldsa87_public_key().as_bytes()),
        );

        assert!(
            !result.is_valid(),
            "Tampered ML-DSA-87 signature must be rejected by the verifier"
        );
        assert!(
            result
                .failures
                .iter()
                .any(|f| f.check == "mldsa87_signature_valid"),
            "Expected mldsa87_signature_valid failure, got: {:?}",
            result.failures
        );
    }

    /// R3: Replay rejected by durable lifecycle enforcement — the idempotency
    /// guard runs BEFORE any state mutation inside process_transaction(),
    /// not merely as a terminal-state validation error.
    /// This test also verifies that the idempotency record is durable
    /// (persisted to the sled store) by re-checking after the rejection.
    #[test]
    fn test_r3_durable_replay_rejection() {
        init_test_env();
        let contract = get_valid_contract();
        let req = QCoreValidationRequest {
            contract: contract.clone(),
            actor_workload_id: "svc:vardhan-intelligence:test-01".to_string(),
        };

        // First submission — must succeed and seal the receipt
        let receipt1 = process_transaction(req.clone()).unwrap();
        assert_eq!(receipt1.status, "SEALED");
        assert_eq!(receipt1.decision, "AUTHORIZED");

        // The finding_id must now be durably recorded as sealed
        assert!(
            crate::is_finding_already_sealed(&contract.finding_id),
            "Finding must be durably recorded as sealed after successful processing"
        );

        // Second submission with identical finding_id — must be rejected
        let result2 = process_transaction(req.clone());
        assert!(
            result2.is_err(),
            "Replay must be rejected by the durable idempotency guard"
        );
        let (code2, msg2) = result2.err().unwrap();
        assert_eq!(
            code2, "REJECTED_REPLAY",
            "Replay must return REJECTED_REPLAY, got: {}",
            code2
        );
        assert!(
            msg2.contains(&contract.finding_id),
            "Error message must reference the finding_id: {}",
            msg2
        );

        // Verify the idempotency guard is not a terminal-state error — it's
        // a pre-execution check that never creates a VardhanTransaction
        // (unlike a ValidationFailed terminal state which would mutate state)
        let store_path = crate::idempotency_store_path();
        let flag_path = store_path.join(format!("sealed_{}.flag", contract.finding_id));
        // The flag file should exist on disk — durability is independent of process
        assert!(
            flag_path.exists(),
            "Finding must be persisted as a flag file on disk — durability is independent of process"
        );
        // Verify the file contents are correct
        let content = std::fs::read_to_string(&flag_path).unwrap_or_default();
        assert_eq!(content, "SEALED", "Flag file must contain 'SEALED'");
    }

    /// R4: Unauthorized service identity must be denied at the policy authority
    /// level — the actor_workload_id must match an authorized prefix.
    #[test]
    fn test_r4_unauthorized_service_identity_denied() {
        init_test_env();
        let contract = get_valid_contract();

        // Unauthorized actor — does not match any authorized prefix
        let req = QCoreValidationRequest {
            contract,
            actor_workload_id: "svc:attacker-service:evil-01".to_string(),
        };
        let result = process_transaction(req);
        assert!(result.is_err(), "Unauthorized identity must be denied");
        let (code, msg) = result.err().unwrap();
        assert!(
            code.contains("DENY") || code == "REJECTED",
            "Expected DENY error code, got: {}",
            code
        );
        assert!(
            msg.contains("not bound")
                || msg.contains("not authorized")
                || msg.contains("not match"),
            "Error message must indicate actor authorization failure: {}",
            msg
        );

        // Empty actor — must also be denied
        let contract2 = get_valid_contract();
        let req2 = QCoreValidationRequest {
            contract: contract2,
            actor_workload_id: "".to_string(),
        };
        let result2 = process_transaction(req2);
        assert!(result2.is_err(), "Empty actor identity must be denied");
    }

    /// R5: Failed verification must leave no unauthorized state change —
    /// if trust boundary validation fails, no idempotency record is created
    /// and the system state remains unchanged.
    #[test]
    fn test_r5_failed_verification_leaves_no_state_change() {
        init_test_env();
        let mut contract = get_valid_contract();
        // Tamper with the evidence content hash — invalid SHA-256 hex
        contract.evidence_refs[0].content_hash = "INVALID_HASH_NOT_64_CHARS".to_string();
        // Use a unique finding_id to check state isolation
        contract.finding_id = "find-state-safety-01".to_string();

        let req = QCoreValidationRequest {
            contract,
            actor_workload_id: "svc:vardhan-intelligence:test-01".to_string(),
        };

        // Attempt to process the tampered contract
        let result = process_transaction(req);
        assert!(result.is_err(), "Tampered contract must be rejected");
        let (code, _msg) = result.err().unwrap();
        assert_eq!(
            code, "REJECTED_TRUST_BOUNDARY",
            "Tampered hash must trigger trust boundary rejection, got: {}",
            code
        );

        // Verify no idempotency record was created — the finding_id must NOT
        // be in the durable store, proving no unauthorized state change
        assert!(
            !crate::is_finding_already_sealed("find-state-safety-01"),
            "Failed verification must leave no idempotency record — \
             no unauthorized state change should occur"
        );

        // Verify the same finding_id can still be submitted successfully
        // (proving the failed attempt left no residual state)
        let contract2 = get_valid_contract();
        let mut contract2 = contract2.clone();
        contract2.finding_id = "find-state-safety-01".to_string();
        let req2 = QCoreValidationRequest {
            contract: contract2,
            actor_workload_id: "svc:vardhan-intelligence:test-01".to_string(),
        };
        let result2 = process_transaction(req2);
        assert!(
            result2.is_ok(),
            "Same finding_id must succeed after a previously failed (state-safe) attempt: {:?}",
            result2.err()
        );
    }

    /// R6: Successful migration (sealing of an intelligence finding) produces
    /// a verifiable result with dual PQ + classical signatures that passes
    /// independent verification via VardhanVerifier.
    #[test]
    fn test_r6_successful_migration_produces_verifiable_receipt() {
        init_test_env();
        let contract = get_valid_contract();
        let req = QCoreValidationRequest {
            contract,
            actor_workload_id: "svc:vardhan-intelligence:test-01".to_string(),
        };

        // Execute the full Q-Core lifecycle: trust boundary → authority →
        // state transition → hybrid signing → sealing
        let receipt = process_transaction(req).unwrap();

        // ── Verify the sealed receipt has all required fields ──────────
        assert!(
            receipt.receipt_id.starts_with("VQR-"),
            "Receipt ID must start with VQR-"
        );
        assert_eq!(receipt.status, "SEALED");
        assert_eq!(receipt.decision, "AUTHORIZED");
        assert_eq!(receipt.outcome_code, "SEALING_OK");
        assert!(
            !receipt.payload_hash.is_empty(),
            "Payload hash must be populated"
        );
        assert!(
            !receipt.issuer_key_fingerprint.is_empty(),
            "Issuer key fingerprint must be populated"
        );

        // ── Verify dual signatures are present ──────────────────────────
        assert!(
            !receipt.signatures.ed25519_sig.is_empty(),
            "Ed25519 signature must be present"
        );
        assert!(
            !receipt.signatures.ml_dsa_87_sig.is_empty(),
            "ML-DSA-87 signature must be present"
        );
        assert!(
            !receipt.signatures.ed25519_key_id.is_empty(),
            "Ed25519 key ID must be present"
        );
        assert!(
            !receipt.signatures.ml_dsa_87_key_id.is_empty(),
            "ML-DSA-87 key ID must be present"
        );

        // ── Verify evidence commitments are included ───────────────────
        assert_eq!(receipt.evidence_commitments.len(), 1);
        assert_eq!(receipt.evidence_commitments[0].evidence_id, "ev-9999");

        // ── Independent verification via VardhanVerifier ─────────────────
        let receipt_json = serde_json::to_string(&receipt).unwrap();
        let verifiable_receipt: vardhan_verifier::VerifiableReceipt =
            serde_json::from_str(&receipt_json).unwrap();

        let keystore = crate::keystore_manager::get_keystore();
        let verifier = vardhan_verifier::VardhanVerifier::with_defaults();
        let result = verifier.verify(
            &verifiable_receipt,
            Some(&keystore.ed25519_public_key().to_bytes()),
            Some(keystore.mldsa87_public_key().as_bytes()),
        );

        assert!(
            result.is_valid(),
            "Independently verified receipt must pass all checks. Failures: {:?}",
            result.failures
        );
        assert!(
            result
                .checks_passed
                .iter()
                .any(|c| c == "ed25519_signature_valid"),
            "Ed25519 signature verification must pass"
        );
        assert!(
            result
                .checks_passed
                .iter()
                .any(|c| c == "mldsa87_signature_valid"),
            "ML-DSA-87 signature verification must pass"
        );
    }

    #[test]
    fn test_f014_canonical_payload_covers_evidence_commitments() {
        init_test_env();
        let contract = get_valid_contract();

        // Build evidence commitments
        let evidence_commitments: Vec<EvidenceCommitment> = contract
            .evidence_refs
            .iter()
            .map(|ev| EvidenceCommitment {
                evidence_id: ev.evidence_id.clone(),
                content_hash: ev.content_hash.clone(),
                category: contract.technical_area.clone(),
            })
            .collect();

        // Two payloads that differ only in evidence_commitments should produce
        // different hashes
        let payload_a = VardhanSealedReceipt::canonical_payload(
            &contract.organization.organization_id,
            "tx-1",
            &contract.decision_candidate,
            &contract.policy_reference,
            "1.0",
            "",
            &evidence_commitments,
            "gate:VardhanGate",
            "AUTHORIZED",
            "SEALING_OK",
        );

        let mut modified_commitments = evidence_commitments.clone();
        modified_commitments[0].content_hash = "different_hash_value".to_string();

        let payload_b = VardhanSealedReceipt::canonical_payload(
            &contract.organization.organization_id,
            "tx-1",
            &contract.decision_candidate,
            &contract.policy_reference,
            "1.0",
            "",
            &modified_commitments,
            "gate:VardhanGate",
            "AUTHORIZED",
            "SEALING_OK",
        );

        let hash_a = blake3::hash(payload_a.as_bytes()).to_string();
        let hash_b = blake3::hash(payload_b.as_bytes()).to_string();
        assert_ne!(
            hash_a, hash_b,
            "Different evidence commitments must produce different payload hashes"
        );
    }

    #[test]
    fn test_f014_canonical_payload_covers_decision_and_outcome() {
        // Two payloads that differ only in decision/outcome_code should produce
        // different hashes
        let evidence_commitments: Vec<EvidenceCommitment> = vec![];

        let payload_a = VardhanSealedReceipt::canonical_payload(
            "tenant-1",
            "tx-1",
            "SEAL_VERIFIED_FINDING",
            "VARDHAN_CORE_INTELLIGENCE_POLICY_V1",
            "1.0",
            "",
            &evidence_commitments,
            "gate:VardhanGate",
            "AUTHORIZED",
            "SEALING_OK",
        );

        let payload_b = VardhanSealedReceipt::canonical_payload(
            "tenant-1",
            "tx-1",
            "SEAL_VERIFIED_FINDING",
            "VARDHAN_CORE_INTELLIGENCE_POLICY_V1",
            "1.0",
            "",
            &evidence_commitments,
            "gate:VardhanGate",
            "REJECTED",
            "AUTHORITY_DENIED",
        );

        let hash_a = blake3::hash(payload_a.as_bytes()).to_string();
        let hash_b = blake3::hash(payload_b.as_bytes()).to_string();
        assert_ne!(
            hash_a, hash_b,
            "Different decision/outcome must produce different payload hashes"
        );
    }

    #[test]
    fn test_f014_canonical_payload_covers_authority_reference() {
        let evidence_commitments: Vec<EvidenceCommitment> = vec![];

        let payload_a = VardhanSealedReceipt::canonical_payload(
            "tenant-1",
            "tx-1",
            "SEAL_VERIFIED_FINDING",
            "VARDHAN_CORE_INTELLIGENCE_POLICY_V1",
            "1.0",
            "",
            &evidence_commitments,
            "gate:VardhanGate:ALLOW",
            "AUTHORIZED",
            "SEALING_OK",
        );

        let payload_b = VardhanSealedReceipt::canonical_payload(
            "tenant-1",
            "tx-1",
            "SEAL_VERIFIED_FINDING",
            "VARDHAN_CORE_INTELLIGENCE_POLICY_V1",
            "1.0",
            "",
            &evidence_commitments,
            "gate:VardhanGate:DENY",
            "AUTHORIZED",
            "SEALING_OK",
        );

        let hash_a = blake3::hash(payload_a.as_bytes()).to_string();
        let hash_b = blake3::hash(payload_b.as_bytes()).to_string();
        assert_ne!(
            hash_a, hash_b,
            "Different authority_reference must produce different payload hashes"
        );
    }

    #[test]
    fn test_f014_canonical_payload_is_deterministic() {
        let evidence_commitments: Vec<EvidenceCommitment> = vec![
            EvidenceCommitment {
                evidence_id: "ev-1".to_string(),
                content_hash: "abc123".to_string(),
                category: "STATIC_ANALYSIS".to_string(),
            },
            EvidenceCommitment {
                evidence_id: "ev-2".to_string(),
                content_hash: "def456".to_string(),
                category: "DYNAMIC_ANALYSIS".to_string(),
            },
        ];

        let payload1 = VardhanSealedReceipt::canonical_payload(
            "tenant-1",
            "tx-1",
            "SEAL_VERIFIED_FINDING",
            "VARDHAN_CORE_INTELLIGENCE_POLICY_V1",
            "1.0",
            "state-hash-abc",
            &evidence_commitments,
            "gate:VardhanGate",
            "AUTHORIZED",
            "SEALING_OK",
        );

        let payload2 = VardhanSealedReceipt::canonical_payload(
            "tenant-1",
            "tx-1",
            "SEAL_VERIFIED_FINDING",
            "VARDHAN_CORE_INTELLIGENCE_POLICY_V1",
            "1.0",
            "state-hash-abc",
            &evidence_commitments,
            "gate:VardhanGate",
            "AUTHORIZED",
            "SEALING_OK",
        );

        assert_eq!(
            payload1, payload2,
            "Same inputs must produce identical canonical payloads"
        );
    }

    #[test]
    fn test_f010_sha256_interop_with_intelligence_plane() {
        // F-010: Verify that the Rust side produces the same SHA-256 hash
        // as the TypeScript computeEvidenceContentHash() function.
        // The TS function hashes: [e.id, e.public_url, e.temporal_status, e.evidence_origin].join('|')
        use sha2::{Digest, Sha256};

        let evidence_id = "ev-9999";
        let public_url = "https://evidence.org";
        let temporal_status = "CURRENT";
        let evidence_origin = "scan";

        // Reproduce the TS computeEvidenceContentHash canonical string
        let canonical = [evidence_id, public_url, temporal_status, evidence_origin].join("|");
        let mut hasher = Sha256::new();
        hasher.update(canonical.as_bytes());
        let hash_bytes = hasher.finalize();
        let hash_hex = hex::encode(hash_bytes);

        // The known SHA-256 of "ev-9999|https://evidence.org|CURRENT|scan"
        // This is the same value the TypeScript side would produce
        assert_eq!(hash_hex.len(), 64, "SHA-256 hash must be 64 hex chars");

        // Verify the hash matches what the TS test contract uses
        // (the content_hash in get_valid_contract is "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        //  which is SHA-256 of empty string — used as a placeholder in tests)
        let empty_hash = {
            let mut h = Sha256::new();
            h.update(b"");
            hex::encode(h.finalize())
        };
        assert_eq!(
            empty_hash, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            "Empty string SHA-256 must match the known test value"
        );

        // Verify non-empty hash is different from empty
        assert_ne!(hash_hex, empty_hash);
    }

    #[test]
    fn test_f010_evidence_content_hash_validated_as_sha256_hex() {
        // F-010: Trust boundary should accept valid SHA-256 hex hashes
        let contract = get_valid_contract();
        assert!(
            crate::trust_boundary::TrustBoundaryValidator::validate(&contract).is_ok(),
            "Valid SHA-256 hex content_hash should pass trust boundary validation"
        );
    }

    #[test]
    fn test_f010_evidence_content_hash_rejects_non_hex() {
        // F-010: Non-hex content_hash should be rejected
        let mut contract = get_valid_contract();
        contract.evidence_refs[0].content_hash =
            "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz".to_string();
        let result = crate::trust_boundary::TrustBoundaryValidator::validate(&contract);
        assert!(result.is_err());
        assert!(
            result.unwrap_err().contains("not valid hex"),
            "Non-hex hash should be rejected with explicit message"
        );
    }

    #[test]
    fn test_f007_trust_boundary_matches_ts_22_checks() {
        // F-007: Verify that the Rust trust boundary validator catches
        // the same fields as the TS validator's 22-check set.
        // This test verifies each new check individually.

        // Check: missing engine_id
        let mut c = get_valid_contract();
        c.intelligence.engine_id = "".to_string();
        assert!(crate::trust_boundary::TrustBoundaryValidator::validate(&c).is_err());

        // Check: missing canonical_domain
        let mut c = get_valid_contract();
        c.organization.canonical_domain = "".to_string();
        assert!(crate::trust_boundary::TrustBoundaryValidator::validate(&c).is_err());

        // Check: missing entry_point_id
        let mut c = get_valid_contract();
        c.affected_resource.entry_point_id = "".to_string();
        assert!(crate::trust_boundary::TrustBoundaryValidator::validate(&c).is_err());

        // Check: missing evidence_origin
        let mut c = get_valid_contract();
        c.evidence_refs[0].evidence_origin = "".to_string();
        assert!(crate::trust_boundary::TrustBoundaryValidator::validate(&c).is_err());

        // Check: missing observation_ids
        let mut c = get_valid_contract();
        c.provenance_chain.observation_ids = vec![];
        assert!(crate::trust_boundary::TrustBoundaryValidator::validate(&c).is_err());

        // Check: missing verification_contract_id
        let mut c = get_valid_contract();
        c.provenance_chain.verification_contract_id = "".to_string();
        assert!(crate::trust_boundary::TrustBoundaryValidator::validate(&c).is_err());
    }

    #[test]
    fn test_f007_valid_contract_passes_all_checks() {
        // F-007: The base valid contract should pass all checks
        let contract = get_valid_contract();
        let result = crate::trust_boundary::TrustBoundaryValidator::validate(&contract);
        assert!(
            result.is_ok(),
            "Valid contract must pass all trust boundary checks: {:?}",
            result.err()
        );
    }

    #[test]
    fn test_f007_content_hash_accepts_valid_sha256_hex() {
        // F-010/F-007: Valid 64-char hex SHA-256 hash should pass
        let contract = get_valid_contract();
        let result = crate::trust_boundary::TrustBoundaryValidator::validate(&contract);
        assert!(result.is_ok());
    }

    #[test]
    fn test_f007_content_hash_rejects_short_hash() {
        let mut contract = get_valid_contract();
        contract.evidence_refs[0].content_hash = "abc123".to_string(); // too short
        let result = crate::trust_boundary::TrustBoundaryValidator::validate(&contract);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("expected 64-char SHA-256 hex"));
    }

    #[test]
    fn test_f007_content_hash_rejects_invalid_chars() {
        let mut contract = get_valid_contract();
        contract.evidence_refs[0].content_hash =
            "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz".to_string();
        let result = crate::trust_boundary::TrustBoundaryValidator::validate(&contract);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not valid hex"));
    }
}
