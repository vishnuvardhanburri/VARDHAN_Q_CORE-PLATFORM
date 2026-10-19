//! # Vardhan Receipt Verifier
//!
//! Independent, deterministic verification of a `VardhanSealedReceipt`.
//!
//! ## Architectural Purpose
//!
//! The verification module exists so that a Receipt does not require trust in
//! the Vardhan platform to be validated. A third party with:
//!
//! 1. The `VardhanSealedReceipt` JSON
//! 2. The issuer's public key(s) for the key identifiers referenced in the receipt
//!
//! can independently determine:
//! - Whether the receipt is authentic (signatures valid)
//! - Whether the payload has been tampered with (hash mismatch)
//! - Whether the tenant matches the expected context
//! - Whether the schema version is supported
//! - Whether required fields are present
//! - Whether the receipt was issued in a reasonable time window
//!
//! ## What Verification Does NOT Do
//!
//! - Verification does NOT evaluate whether an Intelligence finding is semantically true.
//! - Verification does NOT re-run the policy evaluation.
//! - Verification does NOT confirm that the execution actually occurred.
//!
//! It confirms that the Receipt itself is structurally authentic and internally consistent.

use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerifiableEvidenceCommitment {
    pub evidence_id: String,
    pub content_hash: String,
    pub category: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerifiableDualSignature {
    pub ed25519_sig: String,
    pub ed25519_key_id: String,
    pub ml_dsa_87_sig: String,
    pub ml_dsa_87_key_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerifiableReceipt {
    pub receipt_id: String,
    pub schema_version: String,
    pub transaction_id: String,
    pub tenant_id: String,
    pub subject_id: String,
    pub actor_identity: String,
    pub proposed_action: String,
    pub policy_id: String,
    pub policy_version: String,
    pub state_hash_at_decision: Option<String>,
    pub evidence_commitments: Vec<VerifiableEvidenceCommitment>,
    pub authority_reference: String,
    pub decision: String,
    pub outcome_code: String,
    pub timestamp_ms: u64,
    pub ledger_commit_index: u64,
    pub parent_receipt_id: Option<String>,
    pub correlation_id: Option<String>,
    pub payload_hash: String,
    pub issuer_key_fingerprint: String,
    pub signatures: VerifiableDualSignature,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum VerificationStatus {
    Valid,
    Invalid,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerificationFailure {
    pub check: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerificationResult {
    pub status: VerificationStatus,
    pub receipt_id: String,
    pub failures: Vec<VerificationFailure>,
    pub checks_passed: Vec<String>,
    pub verified_at_ms: u64,
}

impl VerificationResult {
    pub fn is_valid(&self) -> bool {
        self.status == VerificationStatus::Valid
    }
}

#[derive(Debug, Clone)]
pub struct VerifierConfig {
    pub supported_schema_versions: Vec<String>,
    pub max_future_skew_ms: u64,
    pub expected_tenant_id: Option<String>,
}

impl Default for VerifierConfig {
    fn default() -> Self {
        Self {
            supported_schema_versions: vec!["1.1".to_string()],
            max_future_skew_ms: 60_000,
            expected_tenant_id: None,
        }
    }
}

pub struct VardhanVerifier {
    config: VerifierConfig,
}

pub fn canonical_receipt_payload(receipt: &VerifiableReceipt) -> Vec<u8> {
    let evidence = receipt
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
        receipt.schema_version.as_str(),
        receipt.receipt_id.as_str(),
        receipt.transaction_id.as_str(),
        receipt.tenant_id.as_str(),
        receipt.subject_id.as_str(),
        receipt.actor_identity.as_str(),
        receipt.proposed_action.as_str(),
        receipt.policy_id.as_str(),
        receipt.policy_version.as_str(),
        receipt.state_hash_at_decision.as_deref().unwrap_or(""),
        evidence.as_str(),
        receipt.authority_reference.as_str(),
        receipt.decision.as_str(),
        receipt.outcome_code.as_str(),
        &receipt.timestamp_ms.to_string(),
        &receipt.ledger_commit_index.to_string(),
        receipt.parent_receipt_id.as_deref().unwrap_or(""),
        receipt.correlation_id.as_deref().unwrap_or(""),
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

impl VardhanVerifier {
    pub fn new(config: VerifierConfig) -> Self {
        Self { config }
    }

    pub fn with_defaults() -> Self {
        Self::new(VerifierConfig::default())
    }

    pub fn verify(
        &self,
        receipt: &VerifiableReceipt,
        ed25519_public_key_bytes: Option<&[u8]>,
        mldsa87_public_key_bytes: Option<&[u8]>,
    ) -> VerificationResult {
        let now_ms = Self::now_ms();
        let mut failures: Vec<VerificationFailure> = Vec::new();
        let mut passed: Vec<String> = Vec::new();

        // 1. Schema
        if self
            .config
            .supported_schema_versions
            .contains(&receipt.schema_version)
        {
            passed.push("schema_version_supported".to_string());
        } else {
            failures.push(VerificationFailure {
                check: "schema_version_supported".to_string(),
                reason: format!(
                    "Schema version '{}' is not supported",
                    receipt.schema_version
                ),
            });
        }

        // 2. ID Format
        if receipt.receipt_id.starts_with("VQR-") {
            passed.push("receipt_id_format".to_string());
        } else {
            failures.push(VerificationFailure {
                check: "receipt_id_format".to_string(),
                reason: "Receipt ID must start with VQR-".to_string(),
            });
        }

        // 3. Required Fields
        let required = [
            ("transaction_id", &receipt.transaction_id),
            ("tenant_id", &receipt.tenant_id),
            ("subject_id", &receipt.subject_id),
            ("actor_identity", &receipt.actor_identity),
            ("proposed_action", &receipt.proposed_action),
            ("policy_id", &receipt.policy_id),
            ("policy_version", &receipt.policy_version),
            ("authority_reference", &receipt.authority_reference),
            ("decision", &receipt.decision),
            ("payload_hash", &receipt.payload_hash),
        ];
        for (name, val) in required {
            if val.is_empty() {
                failures.push(VerificationFailure {
                    check: format!("field_{}_present", name),
                    reason: format!("Field {} is empty", name),
                });
            } else {
                passed.push(format!("field_{}_present", name));
            }
        }

        // 4. Tenant Match
        if let Some(ref expected) = self.config.expected_tenant_id {
            if &receipt.tenant_id == expected {
                passed.push("tenant_id_matches".to_string());
            } else {
                failures.push(VerificationFailure {
                    check: "tenant_id_matches".to_string(),
                    reason: format!(
                        "Tenant mismatch: expected {}, got {}",
                        expected, receipt.tenant_id
                    ),
                });
            }
        }

        // 5. Timestamp
        if receipt.timestamp_ms <= now_ms + self.config.max_future_skew_ms {
            passed.push("timestamp_not_future".to_string());
        } else {
            failures.push(VerificationFailure {
                check: "timestamp_not_future".to_string(),
                reason: "Timestamp too far in future".to_string(),
            });
        }

        // 6. Payload Hash
        let expected_payload = canonical_receipt_payload(receipt);
        let expected_hash = blake3::hash(&expected_payload).to_string();
        if expected_hash == receipt.payload_hash {
            passed.push("payload_hash_valid".to_string());
        } else {
            failures.push(VerificationFailure {
                check: "payload_hash_valid".to_string(),
                reason: "Payload hash mismatch".to_string(),
            });
        }

        // 7. Decision Value
        if receipt.decision == "AUTHORIZED"
            || receipt.decision == "REJECTED"
            || receipt.decision == "SEALED"
        {
            passed.push("decision_is_known_value".to_string());
        } else {
            failures.push(VerificationFailure {
                check: "decision_is_known_value".to_string(),
                reason: format!("Unknown decision: {}", receipt.decision),
            });
        }

        // 8. Ed25519 Signature
        if let Some(pk_bytes) = ed25519_public_key_bytes {
            use ed25519_dalek::{Signature, Verifier, VerifyingKey};
            let res = (|| -> Result<(), String> {
                let pk_arr: [u8; 32] = pk_bytes.try_into().map_err(|_| "Invalid PK length")?;
                let vk = VerifyingKey::from_bytes(&pk_arr).map_err(|e| e.to_string())?;
                let sig_bytes =
                    hex::decode(&receipt.signatures.ed25519_sig).map_err(|e| e.to_string())?;
                let sig_arr: [u8; 64] = sig_bytes
                    .as_slice()
                    .try_into()
                    .map_err(|_| "Invalid sig length")?;
                let sig = Signature::from_bytes(&sig_arr);
                vk.verify(receipt.payload_hash.as_bytes(), &sig)
                    .map_err(|e| e.to_string())
            })();
            match res {
                Ok(()) => passed.push("ed25519_signature_valid".to_string()),
                Err(e) => failures.push(VerificationFailure {
                    check: "ed25519_signature_valid".to_string(),
                    reason: e,
                }),
            }
        } else {
            failures.push(VerificationFailure {
                check: "ed25519_signature_valid".to_string(),
                reason: "Ed25519 public key missing".to_string(),
            });
        }

        // 9. ML-DSA-87 Signature
        if let Some(pk_bytes) = mldsa87_public_key_bytes {
            let res = (|| -> Result<(), String> {
                use pqcrypto_mldsa::mldsa87::{DetachedSignature, PublicKey};
                use pqcrypto_traits::sign::{
                    DetachedSignature as PqDetachedSignature, PublicKey as PqPublicKey,
                };

                let sig_bytes =
                    hex::decode(&receipt.signatures.ml_dsa_87_sig).map_err(|e| e.to_string())?;
                let pk = PublicKey::from_bytes(pk_bytes)
                    .map_err(|e| format!("Invalid ML-DSA-87 PK: {}", e))?;
                let sig = DetachedSignature::from_bytes(&sig_bytes)
                    .map_err(|e| format!("Invalid ML-DSA-87 Sig: {}", e))?;

                pqcrypto_mldsa::mldsa87::verify_detached_signature(
                    &sig,
                    receipt.payload_hash.as_bytes(),
                    &pk,
                )
                .map(|_| ())
                .map_err(|_| "ML-DSA-87 signature verification failed".to_string())
            })();
            match res {
                Ok(()) => passed.push("mldsa87_signature_valid".to_string()),
                Err(e) => failures.push(VerificationFailure {
                    check: "mldsa87_signature_valid".to_string(),
                    reason: e,
                }),
            }
        } else {
            failures.push(VerificationFailure {
                check: "mldsa87_signature_valid".to_string(),
                reason: "ML-DSA-87 public key missing".to_string(),
            });
        }

        // 10. Key IDs and Fingerprint
        if !receipt.signatures.ed25519_key_id.is_empty()
            && !receipt.signatures.ml_dsa_87_key_id.is_empty()
        {
            passed.push("signature_key_ids_present".to_string());
        } else {
            failures.push(VerificationFailure {
                check: "signature_key_ids_present".to_string(),
                reason: "Key IDs empty".to_string(),
            });
        }
        if !receipt.issuer_key_fingerprint.is_empty() {
            passed.push("issuer_key_fingerprint_present".to_string());
        } else {
            failures.push(VerificationFailure {
                check: "issuer_key_fingerprint_present".to_string(),
                reason: "Fingerprint empty".to_string(),
            });
        }

        let status = if failures.is_empty() {
            VerificationStatus::Valid
        } else {
            VerificationStatus::Invalid
        };

        VerificationResult {
            status,
            receipt_id: receipt.receipt_id.clone(),
            failures,
            checks_passed: passed,
            verified_at_ms: now_ms,
        }
    }

    fn now_ms() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("SystemTime before UNIX_EPOCH")
            .as_millis() as u64
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_valid_receipt() -> VerifiableReceipt {
        let mut receipt = VerifiableReceipt {
            receipt_id: format!("VQR-{}", uuid::Uuid::new_v4()),
            schema_version: "1.1".to_string(),
            transaction_id: uuid::Uuid::new_v4().to_string(),
            tenant_id: "tenant-abc-123".to_string(),
            subject_id: "subject-1".to_string(),
            actor_identity: "identity-1".to_string(),
            proposed_action: "ACTION".to_string(),
            policy_id: "POL-1".to_string(),
            policy_version: "1.0".to_string(),
            state_hash_at_decision: None,
            evidence_commitments: vec![],
            authority_reference: "gate:VardhanGate".to_string(),
            decision: "AUTHORIZED".to_string(),
            outcome_code: "OK".to_string(),
            timestamp_ms: VardhanVerifier::now_ms(),
            ledger_commit_index: 1,
            parent_receipt_id: None,
            correlation_id: None,
            payload_hash: String::new(),
            issuer_key_fingerprint: "fingerprint".to_string(),
            signatures: VerifiableDualSignature {
                ed25519_sig: "a".repeat(128),
                ed25519_key_id: "key-1".to_string(),
                ml_dsa_87_sig: "b".repeat(128),
                ml_dsa_87_key_id: "key-2".to_string(),
            },
        };
        receipt.payload_hash = blake3::hash(&canonical_receipt_payload(&receipt)).to_string();
        receipt
    }

    #[test]
    fn test_valid_structural_checks() {
        let verifier = VardhanVerifier::with_defaults();
        let receipt = make_valid_receipt();
        let result = verifier.verify(&receipt, None, None);
        // Should fail because signatures are now mandatory
        assert!(!result.is_valid());
        assert!(
            result
                .failures
                .iter()
                .any(|f| f.check == "ed25519_signature_valid")
        );
    }
}
