import re

with open("backend/vardhan_receipt/src/main.rs", "r") as f:
    content = f.read()

# Make structs public and cloneable
structs_to_pub = ["EvidencePackage", "DecisionCandidate", "Provenance", "QCoreValidationRequest", "QCoreReceipt", "Signatures", "HybridReceipt"]
for struct_name in structs_to_pub:
    content = content.replace(f"struct {struct_name}", f"#[derive(Clone)]\npub struct {struct_name}")

content = content.replace("#[derive(Deserialize, Debug)]\n#[derive(Clone)]", "#[derive(Deserialize, Debug, Clone)]")
content = content.replace("#[derive(Serialize)]\n#[derive(Clone)]", "#[derive(Serialize, Clone)]")

# Insert mod gateway
content = content.replace("fn main() {", "mod gateway;\n\n#[tokio::main]\nasync fn main() {")

# Extract the validation logic into process_transaction
validation_logic = """
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
        return Err(("REJECTED_MALFORMED".to_string(), "Internal State Machine Error".to_string()));
    }

    if request.tenant_id.is_empty() || request.tenant_id == "00000000-0000-0000-0000-000000000000" {
        let _ = tx.reject(RejectionReason::TenantMismatch);
        return Err(("REJECTED_UNAUTHORIZED".to_string(), "Invalid Tenant ID".to_string()));
    }

    if request.provenance.timestamp.is_empty() {
        let _ = tx.reject(RejectionReason::InvalidProvenance);
        return Err(("REJECTED_PROVENANCE".to_string(), "Missing timestamp".to_string()));
    }

    let _ = tx.transition(TransactionState::AuthorityEvaluation);
    
    let authority_result = if request.decision_candidate.action_type == "UNAUTHORIZED_ACTION" {
        AuthorityResult {
            authorized: false,
            authority_reference: "gate:VardhanGate".to_string(),
            evaluated_at_ms: SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64,
            reason: "Action type violates tenant policy".to_string(),
        }
    } else {
        AuthorityResult {
            authorized: true,
            authority_reference: "gate:VardhanGate".to_string(),
            evaluated_at_ms: SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64,
            reason: "Policy approved".to_string(),
        }
    };
    
    if let Err(_) = tx.apply_authority_result(authority_result.clone()) {
        return Err(("ERROR".to_string(), "Failed to apply authority result".to_string()));
    }
    
    if !authority_result.authorized {
        return Err(("REJECTED_UNAUTHORIZED".to_string(), authority_result.reason));
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

    let (_, pq_sk) = mldsa_keypair();
    let pq_sig = mldsa_sign(payload_hash.as_bytes(), &pq_sk);

    let mut csprng = OsRng;
    let ed_sk = SigningKey::generate(&mut csprng);
    let ed_sig: ed25519_dalek::Signature = ed_sk.sign(payload_hash.as_bytes());

    let issuer_key_fingerprint = blake3::hash(ed_sk.verifying_key().as_bytes()).to_string();

    let evidence_commitments = vec![EvidenceCommitment {
        evidence_id: request.evidence_package.evidence_id,
        content_hash: request.evidence_package.data_hash,
        category: request.evidence_package.category,
    }];

    let signatures = DualSignature {
        ed25519_sig: hex::encode(ed_sig.to_bytes()),
        ed25519_key_id: Uuid::new_v4().to_string(),
        ml_dsa_87_sig: hex::encode(pq_sig.as_bytes()),
        ml_dsa_87_key_id: Uuid::new_v4().to_string(),
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
"""

content = content + "\n\n" + validation_logic

import textwrap
pattern = re.compile(r"Commands::ValidateCanonical => \{.*?(?=\s+Commands::Prove)", re.DOTALL)
new_block = """Commands::ValidateCanonical => {
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
        },"""

content = re.sub(pattern, new_block, content)

serve_pattern = re.compile(r"(Commands::Verify\s*\{\s*receipt_id:\s*_\s*\}\s*=>\s*\{.*?\})", re.DOTALL)

def repl_fn(m):
    return m.group(1) + """
        Commands::Serve { port } => {
            gateway::start_server(*port).await;
        }"""
content = re.sub(serve_pattern, repl_fn, content)

with open("backend/vardhan_receipt/src/main.rs", "w") as f:
    f.write(content)

