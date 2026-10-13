use crate::receipt_key_registry::ReceiptIssuerKey;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use fips204::ml_dsa_87;
use fips204::traits::{SerDes, Verifier as PqVerifier};
use serde::{Deserialize, Serialize};
use vardhan_verifier::{VardhanVerifier, VerificationFailure, VerificationStatus, VerifiableReceipt};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StrictVerification { pub status: VerificationStatus, pub failures: Vec<VerificationFailure>, pub checks_passed: Vec<String> }
impl StrictVerification { pub fn is_valid(&self) -> bool { self.status == VerificationStatus::Valid } }

pub fn verify_receipt(raw: &[u8], expected_tenant: &str, issuer: &ReceiptIssuerKey) -> Result<StrictVerification, String> {
    let receipt: VerifiableReceipt = serde_json::from_slice(raw).map_err(|e| format!("invalid receipt JSON: {e}"))?;
    if receipt.tenant_id != expected_tenant { return Err("receipt tenant does not match transport tenant".into()); }
    if receipt.signatures.ed25519_key_id != issuer.ed25519_key_id || receipt.signatures.ml_dsa_87_key_id != issuer.ml_dsa_87_key_id { return Err("receipt references an unregistered issuer key".into()); }
    if receipt.issuer_key_fingerprint != issuer.issuer_key_fingerprint { return Err("receipt issuer fingerprint does not match registered key".into()); }
    let structural = VardhanVerifier::new(vardhan_verifier::VerifierConfig { expected_tenant_id: Some(expected_tenant.into()), ..Default::default() }).verify(&receipt, None, None);
    let mut failures: Vec<_> = structural.failures.into_iter().filter(|f| f.reason != "Ed25519 public key missing" && f.reason != "ML-DSA-87 public key missing").collect();
    let mut checks_passed = structural.checks_passed;
    if verify_ed25519(&issuer.ed25519_public_key, receipt.payload_hash.as_bytes(), &receipt.signatures.ed25519_sig) { checks_passed.push("ed25519_signature_valid".into()); } else { failures.push(VerificationFailure { check: "ed25519_signature_valid".into(), reason: "Ed25519 signature invalid".into() }); }
    if verify_mldsa87(&issuer.ml_dsa_87_public_key, receipt.payload_hash.as_bytes(), &receipt.signatures.ml_dsa_87_sig) { checks_passed.push("ml_dsa_87_signature_valid".into()); } else { failures.push(VerificationFailure { check: "ml_dsa_87_signature_valid".into(), reason: "ML-DSA-87 signature invalid".into() }); }
    let status = if failures.is_empty() { VerificationStatus::Valid } else { VerificationStatus::Invalid };
    Ok(StrictVerification { status, failures, checks_passed })
}

fn verify_ed25519(public_key: &[u8], message: &[u8], signature_hex: &str) -> bool {
    let Ok(pk) = <[u8; 32]>::try_from(public_key) else { return false; };
    let Ok(sig_bytes) = hex::decode(signature_hex) else { return false; };
    let Ok(sig) = <[u8; 64]>::try_from(sig_bytes.as_slice()) else { return false; };
    let Ok(key) = VerifyingKey::from_bytes(&pk) else { return false; };
    key.verify(message, &Signature::from_bytes(&sig)).is_ok()
}

fn verify_mldsa87(public_key: &[u8], message: &[u8], signature_hex: &str) -> bool {
    let Ok(pk_bytes) = <[u8; ml_dsa_87::PK_LEN]>::try_from(public_key) else { return false; };
    let Ok(sig_bytes) = hex::decode(signature_hex) else { return false; };
    let Ok(sig) = <[u8; ml_dsa_87::SIG_LEN]>::try_from(sig_bytes.as_slice()) else { return false; };
    let Ok(pk) = ml_dsa_87::PublicKey::try_from_bytes(pk_bytes) else { return false; };
    pk.verify(message, &sig, &[])
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use fips204::traits::Signer as PqSigner;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn fixture() -> (ReceiptIssuerKey, VerifiableReceipt, SigningKey, ml_dsa_87::PrivateKey) {
        let ed = SigningKey::from_bytes(&[7u8; 32]);
        let (pq_pk, pq_sk) = ml_dsa_87::try_keygen().unwrap();
        let tenant = "org-a".to_string();
        let issuer = ReceiptIssuerKey { organization_id: tenant.clone(), service_id: "qcore-1".into(), ed25519_key_id: "ed-1".into(), ed25519_public_key: ed.verifying_key().to_bytes().to_vec(), ml_dsa_87_key_id: "pq-1".into(), ml_dsa_87_public_key: pq_pk.into_bytes().to_vec(), issuer_key_fingerprint: blake3::hash(ed.verifying_key().as_bytes()).to_string(), state: crate::receipt_key_registry::KeyState::Active };
        let mut receipt = VerifiableReceipt { receipt_id: "VQR-1".into(), schema_version: "1.1".into(), transaction_id: "tx-1".into(), tenant_id: tenant, subject_id: "s".into(), actor_identity: "a".into(), proposed_action: "SEAL".into(), policy_id: "p1".into(), policy_version: "1.0".into(), state_hash_at_decision: None, evidence_commitments: vec![], authority_reference: "gate".into(), decision: "AUTHORIZED".into(), outcome_code: "SUCCESS".into(), timestamp_ms: SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64, ledger_commit_index: 1, parent_receipt_id: None, correlation_id: None, payload_hash: String::new(), issuer_key_fingerprint: issuer.issuer_key_fingerprint.clone(), signatures: vardhan_verifier::VerifiableDualSignature { ed25519_sig: String::new(), ed25519_key_id: "ed-1".into(), ml_dsa_87_sig: String::new(), ml_dsa_87_key_id: "pq-1".into() } };
        receipt.payload_hash = blake3::hash(&vardhan_verifier::canonical_receipt_payload(&receipt)).to_string();
        (issuer, receipt, ed, pq_sk)
    }

    #[test]
    fn rejects_wrong_ed25519_signature() {
        let (issuer, mut receipt, _ed, pq_sk) = fixture();
        receipt.signatures.ed25519_sig = hex::encode([0u8; 64]);
        receipt.signatures.ml_dsa_87_sig = hex::encode(pq_sk.try_sign(receipt.payload_hash.as_bytes(), &[]).unwrap());
        let result = verify_receipt(&serde_json::to_vec(&receipt).unwrap(), "org-a", &issuer).unwrap();
        assert!(!result.is_valid());
        assert!(result.failures.iter().any(|f| f.check == "ed25519_signature_valid"));
    }
}
