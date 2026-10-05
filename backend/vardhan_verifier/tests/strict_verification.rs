use ed25519_dalek::{Signer, SigningKey};
use fips204::ml_dsa_87;
use fips204::traits::{SerDes, Signer as PqSigner};
use std::time::{SystemTime, UNIX_EPOCH};
use vardhan_verifier::{canonical_payload, VerifiableDualSignature, VerifiableEvidenceCommitment, VerifiableReceipt, VardhanVerifier};

fn receipt() -> VerifiableReceipt {
    let tenant_id = "tenant-strict".to_string();
    let transaction_id = "tx-strict".to_string();
    let payload = canonical_payload(
        &tenant_id, &transaction_id, "SEAL", "policy-1", "1.0", "", &[],
        "gate:VardhanGate", "AUTHORIZED", "SUCCESS",
    );
    let payload_hash = blake3::hash(payload.as_bytes()).to_string();
    VerifiableReceipt {
        receipt_id: "VQR-strict".into(), schema_version: "1.0".into(), transaction_id, tenant_id,
        subject_id: "subject-1".into(), actor_identity: "svc-1".into(), proposed_action: "SEAL".into(),
        policy_id: "policy-1".into(), policy_version: "1.0".into(), state_hash_at_decision: None,
        evidence_commitments: Vec::<VerifiableEvidenceCommitment>::new(), authority_reference: "gate:VardhanGate".into(),
        decision: "AUTHORIZED".into(), outcome_code: "SUCCESS".into(),
        timestamp_ms: SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64,
        ledger_commit_index: 1, parent_receipt_id: None, correlation_id: None, payload_hash,
        issuer_key_fingerprint: "issuer".into(),
        signatures: VerifiableDualSignature { ed25519_sig: String::new(), ed25519_key_id: "ed-key".into(), ml_dsa_87_sig: String::new(), ml_dsa_87_key_id: "pq-key".into() },
    }
}

#[test]
fn strict_verification_requires_and_checks_both_signatures() {
    let ed = SigningKey::from_bytes(&[7u8; 32]);
    let (pq_pk, pq_sk) = ml_dsa_87::try_keygen().unwrap();
    let mut r = receipt();
    r.signatures.ed25519_sig = hex::encode(ed.sign(r.payload_hash.as_bytes()).to_bytes());
    r.signatures.ml_dsa_87_sig = hex::encode(pq_sk.try_sign(r.payload_hash.as_bytes(), &[]).unwrap());
    let result = VardhanVerifier::with_defaults().verify_strict(&r, &ed.verifying_key().to_bytes(), &pq_pk.into_bytes());
    assert!(result.is_valid(), "strict verification failed: {:?}", result.failures);
}

#[test]
fn strict_verification_rejects_tampered_pq_signature() {
    let ed = SigningKey::from_bytes(&[7u8; 32]);
    let (pq_pk, pq_sk) = ml_dsa_87::try_keygen().unwrap();
    let mut r = receipt();
    r.signatures.ed25519_sig = hex::encode(ed.sign(r.payload_hash.as_bytes()).to_bytes());
    let mut pq_sig = pq_sk.try_sign(r.payload_hash.as_bytes(), &[]).unwrap();
    pq_sig[0] ^= 1;
    r.signatures.ml_dsa_87_sig = hex::encode(pq_sig);
    let result = VardhanVerifier::with_defaults().verify_strict(&r, &ed.verifying_key().to_bytes(), &pq_pk.into_bytes());
    assert!(!result.is_valid());
    assert!(result.failures.iter().any(|f| f.check == "ml_dsa_87_signature_valid"));
}
