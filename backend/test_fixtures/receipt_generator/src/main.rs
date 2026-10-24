use control_plane_api::receipt_key_registry::{KeyState, ReceiptIssuerKey};
use ed25519_dalek::{Signer, SigningKey};
use fips204::ml_dsa_87;
use fips204::traits::{SerDes, Signer as PqSigner};
use std::env;
use uuid::Uuid;
use vardhan_verifier::{VerifiableDualSignature, VerifiableReceipt};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().collect();
    if args.len() < 5 {
        eprintln!("Usage: receipt_generator <db_path> <org_id> <asset_id> <mode>");
        eprintln!("Modes: genuine, modified_payload, bad_ed_sig, bad_pq_sig, wrong_key, wrong_subject, wrong_tenant");
        std::process::exit(1);
    }

    let db_path = &args[1];
    let org_id = &args[2];
    let asset_id = &args[3];
    let mode = &args[4];

    let mut csprng = rand::rngs::OsRng;
    let ed_sk = SigningKey::generate(&mut csprng);
    let (pq_pk, pq_sk) = ml_dsa_87::try_keygen_vt().unwrap();

    let ed_pk_bytes = ed_sk.verifying_key().to_bytes().to_vec();
    let pq_pk_bytes = pq_pk.into_bytes().to_vec();

    let db = sled::open(db_path)?;

    // For 'wrong_key' mode, we seed the DB with a different key than the one we sign with
    let (seed_ed_pk, seed_pq_pk) = if mode == "wrong_key" {
        let ed_sk_wrong = SigningKey::generate(&mut csprng);
        let (pq_pk_wrong, _) = ml_dsa_87::try_keygen_vt().unwrap();
        (
            ed_sk_wrong.verifying_key().to_bytes().to_vec(),
            pq_pk_wrong.into_bytes().to_vec(),
        )
    } else {
        (ed_pk_bytes.clone(), pq_pk_bytes.clone())
    };

    let issuer = ReceiptIssuerKey {
        organization_id: org_id.to_string(),
        service_id: "test-service".to_string(),
        ed25519_key_id: "ed-test-1".into(),
        ed25519_public_key: seed_ed_pk,
        ml_dsa_87_key_id: "pq-test-1".into(),
        ml_dsa_87_public_key: seed_pq_pk,
        issuer_key_fingerprint: blake3::hash(&ed_pk_bytes).to_string(), // Use actual signing key fingerprint
        state: KeyState::Active,
    };

    let key_key = format!("qcore:issuer-key:{}", org_id);
    db.insert(key_key.as_bytes(), serde_json::to_vec(&issuer)?)?;

    let mut r = VerifiableReceipt {
        receipt_id: format!("VQR-{}", Uuid::new_v4()),
        schema_version: "1.1".into(),
        transaction_id: Uuid::new_v4().to_string(),
        tenant_id: org_id.to_string(),
        subject_id: asset_id.to_string(),
        actor_identity: "test-admin".into(),
        proposed_action: "MIGRATE".into(),
        policy_id: "POL-TEST".into(),
        policy_version: "1.0".into(),
        state_hash_at_decision: None,
        evidence_commitments: vec![],
        authority_reference: "test-auth".into(),
        decision: "AUTHORIZED".into(),
        outcome_code: "OK".into(),
        timestamp_ms: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_millis() as u64,
        ledger_commit_index: 1,
        parent_receipt_id: None,
        correlation_id: None,
        payload_hash: String::new(),
        issuer_key_fingerprint: issuer.issuer_key_fingerprint.clone(),
        signatures: VerifiableDualSignature {
            ed25519_sig: String::new(),
            ed25519_key_id: "ed-test-1".into(),
            ml_dsa_87_sig: String::new(),
            ml_dsa_87_key_id: "pq-test-1".into(),
        },
    };

    if mode == "wrong_subject" {
        r.subject_id = format!("{}-WRONG", asset_id);
    } else if mode == "wrong_tenant" {
        r.tenant_id = format!("{}-WRONG", org_id);
    }

    // Initial payload hash for signing
    r.payload_hash = blake3::hash(&vardhan_verifier::canonical_receipt_payload(&r)).to_string();

    // Signatures
    let mut ed_sig = hex::encode(ed_sk.sign(r.payload_hash.as_bytes()).to_bytes());
    let mut pq_sig = hex::encode(pq_sk.try_sign_ct(r.payload_hash.as_bytes()).unwrap());

    if mode == "bad_ed_sig" {
        ed_sig = hex::encode([0u8; 64]);
    } else if mode == "bad_pq_sig" {
        pq_sig = hex::encode([0u8; 2400]); // Approx ML-DSA-87 size
    }

    r.signatures.ed25519_sig = ed_sig;
    r.signatures.ml_dsa_87_sig = pq_sig;

    // If modified_payload, change a field AFTER signing
    if mode == "modified_payload" {
        r.decision = "REJECTED".into();
    }

    let receipt_key = format!("receipt:{}", r.receipt_id);
    db.insert(receipt_key.as_bytes(), serde_json::to_vec(&r)?)?;

    println!("RECEIPT_ID={}", r.receipt_id);

    Ok(())
}
