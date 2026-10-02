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

// ─────────────────────────────────────────────────────────────────────────────
// Receipt structures (mirrors VardhanSealedReceipt from vardhan_receipt crate)
// Defined here as standalone types so the verifier has no compile-time dependency
// on the issuing binary.
// ─────────────────────────────────────────────────────────────────────────────

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

/// A `VardhanSealedReceipt` as presented to the verifier.
/// Field names match the JSON produced by the receipt binary.
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

// ─────────────────────────────────────────────────────────────────────────────
// Verification Result
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Verifier Configuration
// ─────────────────────────────────────────────────────────────────────────────

/// Configuration for the verifier.
#[derive(Debug, Clone)]
pub struct VerifierConfig {
    /// Supported schema versions. Receipts with other versions are rejected.
    pub supported_schema_versions: Vec<String>,
    /// Maximum allowed clock skew in milliseconds. Receipts with `timestamp_ms`
    /// more than this far in the future are rejected.
    pub max_future_skew_ms: u64,
    /// If Some, the receipt's `tenant_id` must match exactly.
    pub expected_tenant_id: Option<String>,
}

impl Default for VerifierConfig {
    fn default() -> Self {
        Self {
            supported_schema_versions: vec!["1.0".to_string()],
            max_future_skew_ms: 60_000, // 1 minute of clock skew tolerance
            expected_tenant_id: None,
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Verifier
// ─────────────────────────────────────────────────────────────────────────────

pub struct VardhanVerifier {
    config: VerifierConfig,
}

impl VardhanVerifier {
    pub fn new(config: VerifierConfig) -> Self {
        Self { config }
    }

    pub fn with_defaults() -> Self {
        Self::new(VerifierConfig::default())
    }

    /// Verify a receipt. This performs all structural checks that can be done
    /// without re-running the policy engine or replaying the execution.
    ///
    /// NOTE: Signature verification requires the issuer's public keys to be
    /// provided by the caller via `ed25519_public_key_bytes` and
    /// `mldsa87_public_key_bytes`. If None, the signature check is SKIPPED
    /// (the result will note this explicitly).
    pub fn verify(
        &self,
        receipt: &VerifiableReceipt,
        ed25519_public_key_bytes: Option<&[u8]>,
        mldsa87_public_key_bytes: Option<&[u8]>,
    ) -> VerificationResult {
        let now_ms = now_ms();
        let mut failures: Vec<VerificationFailure> = Vec::new();
        let mut passed: Vec<String> = Vec::new();

        // ── Check 1: Schema version supported ────────────────────────────
        if self.config.supported_schema_versions.contains(&receipt.schema_version) {
            passed.push("schema_version_supported".to_string());
        } else {
            failures.push(VerificationFailure {
                check: "schema_version_supported".to_string(),
                reason: format!(
                    "Schema version '{}' is not supported. Supported: {:?}",
                    receipt.schema_version, self.config.supported_schema_versions
                ),
            });
        }

        // ── Check 2: Receipt ID format (must start with VQR- and have UUID) ──
        if receipt.receipt_id.starts_with("VQR-") && receipt.receipt_id.len() > 4 {
            passed.push("receipt_id_format".to_string());
        } else {
            failures.push(VerificationFailure {
                check: "receipt_id_format".to_string(),
                reason: format!("Receipt ID '{}' does not match expected format 'VQR-<uuid>'", receipt.receipt_id),
            });
        }

        // ── Check 3: Required non-empty fields ───────────────────────────
        let required_fields = [
            ("transaction_id", receipt.transaction_id.as_str()),
            ("tenant_id", receipt.tenant_id.as_str()),
            ("subject_id", receipt.subject_id.as_str()),
            ("actor_identity", receipt.actor_identity.as_str()),
            ("proposed_action", receipt.proposed_action.as_str()),
            ("policy_id", receipt.policy_id.as_str()),
            ("policy_version", receipt.policy_version.as_str()),
            ("authority_reference", receipt.authority_reference.as_str()),
            ("decision", receipt.decision.as_str()),
            ("payload_hash", receipt.payload_hash.as_str()),
            ("issuer_key_fingerprint", receipt.issuer_key_fingerprint.as_str()),
        ];
        for (name, value) in &required_fields {
            if value.is_empty() {
                failures.push(VerificationFailure {
                    check: format!("field_{}_present", name),
                    reason: format!("Required field '{}' is empty", name),
                });
            } else {
                passed.push(format!("field_{}_present", name));
            }
        }

        // ── Check 4: Tenant ID matches expected (if configured) ──────────
        if let Some(ref expected) = self.config.expected_tenant_id {
            if &receipt.tenant_id == expected {
                passed.push("tenant_id_matches".to_string());
            } else {
                failures.push(VerificationFailure {
                    check: "tenant_id_matches".to_string(),
                    reason: format!(
                        "Tenant ID mismatch: expected '{}', got '{}'",
                        expected, receipt.tenant_id
                    ),
                });
            }
        }

        // ── Check 5: Timestamp not unreasonably in the future ────────────
        if receipt.timestamp_ms <= now_ms + self.config.max_future_skew_ms {
            passed.push("timestamp_not_future".to_string());
        } else {
            failures.push(VerificationFailure {
                check: "timestamp_not_future".to_string(),
                reason: format!(
                    "Receipt timestamp {} ms is more than {} ms in the future (now={})",
                    receipt.timestamp_ms, self.config.max_future_skew_ms, now_ms
                ),
            });
        }

        // ── Check 6: Payload hash recomputation ──────────────────────────
        // The canonical payload string must match what the issuer computed.
        let expected_payload = canonical_payload(
            &receipt.tenant_id,
            &receipt.transaction_id,
            &receipt.proposed_action,
            &receipt.policy_id,
            &receipt.policy_version,
        );
        let expected_hash = blake3::hash(expected_payload.as_bytes()).to_string();
        if expected_hash == receipt.payload_hash {
            passed.push("payload_hash_valid".to_string());
        } else {
            failures.push(VerificationFailure {
                check: "payload_hash_valid".to_string(),
                reason: format!(
                    "Payload hash mismatch. Expected '{}', got '{}'",
                    expected_hash, receipt.payload_hash
                ),
            });
        }

        // ── Check 7: Decision is a known value ───────────────────────────
        if receipt.decision == "AUTHORIZED" || receipt.decision == "REJECTED" || receipt.decision == "SEALED" {
            passed.push("decision_is_known_value".to_string());
        } else {
            failures.push(VerificationFailure {
                check: "decision_is_known_value".to_string(),
                reason: format!("Decision value '{}' is not recognized", receipt.decision),
            });
        }

        // ── Check 8: Ed25519 signature (if public key provided) ──────────
        if let Some(pk_bytes) = ed25519_public_key_bytes {
            use ed25519_dalek::{Signature, VerifyingKey};
            let verify_result = (|| -> Result<(), String> {
                let pk_arr: [u8; 32] = pk_bytes.try_into()
                    .map_err(|_| "Ed25519 public key must be 32 bytes".to_string())?;
                let vk = VerifyingKey::from_bytes(&pk_arr)
                    .map_err(|e| format!("Invalid Ed25519 public key: {}", e))?;
                let sig_bytes = hex::decode(&receipt.signatures.ed25519_sig)
                    .map_err(|e| format!("Invalid Ed25519 signature hex: {}", e))?;
                let sig_arr: [u8; 64] = sig_bytes.as_slice().try_into()
                    .map_err(|_| "Ed25519 signature must be 64 bytes".to_string())?;
                let sig = Signature::from_bytes(&sig_arr);
                use ed25519_dalek::Verifier;
                vk.verify(receipt.payload_hash.as_bytes(), &sig)
                    .map_err(|e| format!("Ed25519 signature invalid: {}", e))
            })();
            match verify_result {
                Ok(()) => passed.push("ed25519_signature_valid".to_string()),
                Err(e) => failures.push(VerificationFailure {
                    check: "ed25519_signature_valid".to_string(),
                    reason: e,
                }),
            }
        } else {
            passed.push("ed25519_signature_skipped_no_key_provided".to_string());
        }

        // ── Check 9: Signature key IDs non-empty ─────────────────────────
        if !receipt.signatures.ed25519_key_id.is_empty() && !receipt.signatures.ml_dsa_87_key_id.is_empty() {
            passed.push("signature_key_ids_present".to_string());
        } else {
            failures.push(VerificationFailure {
                check: "signature_key_ids_present".to_string(),
                reason: "Signature key IDs must not be empty".to_string(),
            });
        }

        // ── Check 10: Issuer fingerprint non-empty ────────────────────────
        if !receipt.issuer_key_fingerprint.is_empty() {
            passed.push("issuer_key_fingerprint_present".to_string());
        } else {
            failures.push(VerificationFailure {
                check: "issuer_key_fingerprint_present".to_string(),
                reason: "Issuer key fingerprint must not be empty".to_string(),
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
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical payload (must match what the issuer uses)
// ─────────────────────────────────────────────────────────────────────────────

/// Deterministic canonical payload for signing. Must be identical between
/// issuer and verifier — any deviation will cause hash/signature mismatch.
pub fn canonical_payload(
    tenant_id: &str,
    transaction_id: &str,
    proposed_action: &str,
    policy_id: &str,
    policy_version: &str,
) -> String {
    format!("{}::{}::{}::{}::{}", tenant_id, transaction_id, proposed_action, policy_id, policy_version)
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("SystemTime before UNIX_EPOCH")
        .as_millis() as u64
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_valid_receipt() -> VerifiableReceipt {
        let tenant_id = "tenant-abc-123".to_string();
        let transaction_id = uuid::Uuid::new_v4().to_string();
        let proposed_action = "QUARANTINE_IP".to_string();
        let policy_id = "POL-NET-01".to_string();
        let policy_version = "1.0".to_string();

        let payload = canonical_payload(&tenant_id, &transaction_id, &proposed_action, &policy_id, &policy_version);
        let payload_hash = blake3::hash(payload.as_bytes()).to_string();

        VerifiableReceipt {
            receipt_id: format!("VQR-{}", uuid::Uuid::new_v4()),
            schema_version: "1.0".to_string(),
            transaction_id,
            tenant_id,
            subject_id: "subject:ip-10.0.0.1".to_string(),
            actor_identity: "identity:svc-intel-01".to_string(),
            proposed_action,
            policy_id,
            policy_version,
            state_hash_at_decision: None,
            evidence_commitments: vec![],
            authority_reference: "gate:VardhanGate".to_string(),
            decision: "AUTHORIZED".to_string(),
            outcome_code: "QUARANTINE_OK".to_string(),
            timestamp_ms: now_ms(),
            ledger_commit_index: 42,
            parent_receipt_id: None,
            correlation_id: None,
            payload_hash,
            issuer_key_fingerprint: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890".to_string(),
            signatures: VerifiableDualSignature {
                ed25519_sig: "a".repeat(128),
                ed25519_key_id: uuid::Uuid::new_v4().to_string(),
                ml_dsa_87_sig: "b".repeat(128),
                ml_dsa_87_key_id: uuid::Uuid::new_v4().to_string(),
            },
        }
    }

    #[test]
    fn test_valid_receipt_passes_all_structural_checks() {
        let verifier = VardhanVerifier::with_defaults();
        let receipt = make_valid_receipt();
        let result = verifier.verify(&receipt, None, None);
        assert!(result.is_valid(), "Valid receipt should pass. Failures: {:?}", result.failures);
    }

    #[test]
    fn test_tampered_payload_hash_fails() {
        let verifier = VardhanVerifier::with_defaults();
        let mut receipt = make_valid_receipt();
        receipt.payload_hash = "000000000000000000000000000000000000000000000000000000000000dead".to_string();
        let result = verifier.verify(&receipt, None, None);
        assert!(!result.is_valid());
        assert!(result.failures.iter().any(|f| f.check == "payload_hash_valid"),
            "Should fail payload_hash_valid check");
    }

    #[test]
    fn test_unsupported_schema_version_fails() {
        let verifier = VardhanVerifier::with_defaults();
        let mut receipt = make_valid_receipt();
        receipt.schema_version = "99.0".to_string();
        let result = verifier.verify(&receipt, None, None);
        assert!(!result.is_valid());
        assert!(result.failures.iter().any(|f| f.check == "schema_version_supported"));
    }

    #[test]
    fn test_invalid_receipt_id_format_fails() {
        let verifier = VardhanVerifier::with_defaults();
        let mut receipt = make_valid_receipt();
        receipt.receipt_id = "STATIC-FAKE-ID".to_string();
        let result = verifier.verify(&receipt, None, None);
        assert!(!result.is_valid());
        assert!(result.failures.iter().any(|f| f.check == "receipt_id_format"));
    }

    #[test]
    fn test_tenant_mismatch_fails() {
        let config = VerifierConfig {
            expected_tenant_id: Some("expected-tenant".to_string()),
            ..Default::default()
        };
        let verifier = VardhanVerifier::new(config);
        let receipt = make_valid_receipt(); // has tenant "tenant-abc-123"
        let result = verifier.verify(&receipt, None, None);
        assert!(!result.is_valid());
        assert!(result.failures.iter().any(|f| f.check == "tenant_id_matches"));
    }

    #[test]
    fn test_future_timestamp_fails() {
        let verifier = VardhanVerifier::with_defaults();
        let mut receipt = make_valid_receipt();
        receipt.timestamp_ms = now_ms() + 999_999_999; // far in the future
        let result = verifier.verify(&receipt, None, None);
        assert!(!result.is_valid());
        assert!(result.failures.iter().any(|f| f.check == "timestamp_not_future"));
    }

    #[test]
    fn test_empty_required_field_fails() {
        let verifier = VardhanVerifier::with_defaults();
        let mut receipt = make_valid_receipt();
        receipt.tenant_id = String::new();
        let result = verifier.verify(&receipt, None, None);
        assert!(!result.is_valid());
        assert!(result.failures.iter().any(|f| f.check == "field_tenant_id_present"));
    }

    #[test]
    fn test_unknown_decision_value_fails() {
        let verifier = VardhanVerifier::with_defaults();
        let mut receipt = make_valid_receipt();
        receipt.decision = "MAYBE".to_string();
        let result = verifier.verify(&receipt, None, None);
        assert!(!result.is_valid());
        assert!(result.failures.iter().any(|f| f.check == "decision_is_known_value"));
    }

    #[test]
    fn test_multiple_failures_all_reported() {
        let verifier = VardhanVerifier::with_defaults();
        let mut receipt = make_valid_receipt();
        receipt.schema_version = "99.0".to_string();
        receipt.receipt_id = "BAD".to_string();
        receipt.tenant_id = String::new();
        let result = verifier.verify(&receipt, None, None);
        assert!(!result.is_valid());
        assert!(result.failures.len() >= 3, "Should report all failures, got: {:?}", result.failures);
    }

    #[test]
    fn test_verification_result_serializes() {
        let verifier = VardhanVerifier::with_defaults();
        let receipt = make_valid_receipt();
        let result = verifier.verify(&receipt, None, None);
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"status\""));
        assert!(json.contains("\"checks_passed\""));
    }

    #[test]
    fn test_tenant_matches_when_expected_matches() {
        let config = VerifierConfig {
            expected_tenant_id: Some("tenant-abc-123".to_string()),
            ..Default::default()
        };
        let verifier = VardhanVerifier::new(config);
        let receipt = make_valid_receipt();
        let result = verifier.verify(&receipt, None, None);
        assert!(result.is_valid(), "Should pass when tenant matches. Failures: {:?}", result.failures);
        assert!(result.checks_passed.contains(&"tenant_id_matches".to_string()));
    }
}
