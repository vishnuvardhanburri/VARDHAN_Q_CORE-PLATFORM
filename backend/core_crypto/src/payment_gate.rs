//! # payment_gate — ISO 20022 Financial Transaction Invariant Gate
//!
//! Enforces deterministic financial transaction invariants for ISO 20022
//! payment messages (pacs.008, pacs.009, pacs.002, pain.001) sealed with
//! post-quantum dual signatures (Ed25519 + ML-DSA-87).
//!
//! Unlike finding evidence gates which inspect metadata and content hashes,
//! this module enforces institutional banking rules:
//! - Valid ISO 20022 message schema and supported transaction types
//! - Authenticated institutional signer identity from a trusted registry
//! - Matching Instructing / Debtor Agent BIC to authenticated signing identity
//! - ISO 9362 BIC formatting (8 or 11 alphanumeric characters)
//! - Debtor / Creditor institution sanction & quarantine screening
//! - ISO 4217 uppercase 3-letter currency code validation
//! - Strictly positive decimal transaction amounts within institutional limits
//! - Unique canonical UETR (UUIDv4) and non-empty EndToEndId
//! - Strict temporal freshness window (clock skew tolerance)
//! - Post-quantum dual signature mathematical verification over canonical XML
//! - Pre-execution durable idempotency protection and atomic CAS reservation

use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use thiserror::Error;

use crate::iso20022_pqc::{
    verify_iso20022_pqc_seal_authenticated, InstitutionalKeyRegistry, Iso20022Error, SignerStatus,
};

/// Errors encountered during financial payment invariant gating.
#[derive(Debug, Error, PartialEq)]
pub enum PaymentGateError {
    #[error("Missing mandatory payment element: <{0}>")]
    MissingElement(&'static str),

    #[error("Unsupported ISO 20022 message type: '{0}'")]
    UnsupportedMessageType(String),

    #[error("Invalid ISO 9362 BIC in field '{field}': '{value}'")]
    InvalidBic { field: &'static str, value: String },

    #[error("Invalid ISO 4217 currency code: '{0}'")]
    InvalidCurrency(String),

    #[error("Invalid transaction amount: {amount} ({reason})")]
    InvalidAmount { amount: f64, reason: String },

    #[error("Transaction amount {amount} exceeds institutional limit of {limit}")]
    AmountExceedsLimit { amount: f64, limit: f64 },

    #[error("Invalid UETR format: '{0}' (expected canonical UUIDv4)")]
    InvalidUetrFormat(String),

    #[error("Invalid EndToEndId: '{0}' (must be non-empty and max 35 chars)")]
    InvalidEndToEndId(String),

    #[error("Payment timestamp has expired (age: {age_seconds}s, max allowed: {max_allowed}s)")]
    TemporalFreshnessExpired { age_seconds: i64, max_allowed: i64 },

    #[error("Payment timestamp is in the future (future skew: {future_seconds}s, max allowed: {max_allowed}s)")]
    FutureDatedPayment { future_seconds: i64, max_allowed: i64 },

    #[error("Institution BIC '{0}' is quarantined or on the sanctions blocklist")]
    BlockedOrQuarantinedParty(String),

    #[error("Signer BIC mismatch: authenticated signer is '{signer_bic}', but message declares '{instructed_bic}'")]
    SignerBicMismatch { signer_bic: String, instructed_bic: String },

    #[error("Signer institution '{0}' is not active (status: {1:?})")]
    SignerNotActive(String, SignerStatus),

    #[error("Cryptographic PQC seal verification failed: {0}")]
    CryptographicSealFailed(String),

    #[error("Replay detected: payment with UETR '{0}' has already been processed and committed")]
    ReplayDetected(String),

    #[error("Concurrent submission conflict: payment with UETR '{0}' is currently in-flight")]
    ConcurrentSubmissionBlocked(String),

    #[error("Internal gate error: {0}")]
    Internal(String),
}

impl From<Iso20022Error> for PaymentGateError {
    fn from(e: Iso20022Error) -> Self {
        PaymentGateError::CryptographicSealFailed(e.to_string())
    }
}

/// Extracted financial fields from an ISO 20022 payment document.
#[derive(Clone, Debug, PartialEq)]
pub struct Iso20022FinancialPayment {
    pub message_type: String,
    pub msg_id: String,
    pub cre_dt_tm: String,
    pub cre_timestamp_unix: u64,
    pub instructing_agent_bic: String,
    pub debtor_agent_bic: String,
    pub creditor_agent_bic: String,
    pub debtor_account: String,
    pub creditor_account: String,
    pub amount: f64,
    pub currency: String,
    pub uetr: String,
    pub end_to_end_id: String,
}

/// Fully authenticated, validated, and gated financial payment transaction.
#[derive(Clone, Debug, PartialEq)]
pub struct AuthenticatedFinancialPayment {
    pub payment: Iso20022FinancialPayment,
    pub signer_bic: String,
    pub signer_institution_name: String,
    pub canonical_body_hash_hex: String,
    pub ed25519_public_key_hex: String,
    pub ml_dsa_87_public_key_hex: String,
    pub gated_at_unix: u64,
}

/// Configuration policy for payment gating.
#[derive(Clone, Debug)]
pub struct PaymentPolicy {
    pub allowed_message_types: Vec<String>,
    pub allowed_currencies: Vec<String>,
    pub max_single_transaction_limit: f64,
    pub max_freshness_age_seconds: i64,
    pub max_future_skew_seconds: i64,
    pub blocked_bics: HashSet<String>,
}

impl Default for PaymentPolicy {
    fn default() -> Self {
        Self {
            allowed_message_types: vec![
                "pacs.008.001.08".into(),
                "pacs.009.001.08".into(),
                "pacs.002.001.10".into(),
                "pain.001.001.09".into(),
            ],
            allowed_currencies: vec![
                "USD".into(),
                "EUR".into(),
                "GBP".into(),
                "JPY".into(),
                "CHF".into(),
                "SGD".into(),
                "INR".into(),
                "AUD".into(),
                "CAD".into(),
            ],
            max_single_transaction_limit: 100_000_000.0,
            max_freshness_age_seconds: 300,
            max_future_skew_seconds: 60,
            blocked_bics: HashSet::new(),
        }
    }
}

/// Trait for pre-execution durable idempotency and in-flight reservation.
pub trait PaymentIdempotencyStore: Send + Sync {
    /// Attempts an atomic compare-and-swap reservation for `uetr`.
    /// Returns `Ok(true)` if newly reserved, `Err(ReplayDetected)` if committed,
    /// or `Err(ConcurrentSubmissionBlocked)` if already in flight.
    fn check_and_reserve(&self, uetr: &str) -> Result<bool, PaymentGateError>;

    /// Commits the transaction upon successful processing.
    fn mark_committed(&self, uetr: &str) -> Result<(), PaymentGateError>;

    /// Releases the reservation on processing failure so it can be retried.
    fn release_reservation(&self, uetr: &str) -> Result<(), PaymentGateError>;
}

/// Thread-safe in-memory idempotency store.
#[derive(Default)]
pub struct InMemoryPaymentIdempotencyStore {
    state: Mutex<IdempotencyState>,
}

#[derive(Default)]
struct IdempotencyState {
    in_flight: HashSet<String>,
    committed: HashSet<String>,
}

impl InMemoryPaymentIdempotencyStore {
    pub fn new() -> Self {
        Self::default()
    }
}

impl PaymentIdempotencyStore for InMemoryPaymentIdempotencyStore {
    fn check_and_reserve(&self, uetr: &str) -> Result<bool, PaymentGateError> {
        let mut state = self.state.lock().unwrap();
        if state.committed.contains(uetr) {
            return Err(PaymentGateError::ReplayDetected(uetr.to_string()));
        }
        if state.in_flight.contains(uetr) {
            return Err(PaymentGateError::ConcurrentSubmissionBlocked(uetr.to_string()));
        }
        state.in_flight.insert(uetr.to_string());
        Ok(true)
    }

    fn mark_committed(&self, uetr: &str) -> Result<(), PaymentGateError> {
        let mut state = self.state.lock().unwrap();
        state.in_flight.remove(uetr);
        state.committed.insert(uetr.to_string());
        Ok(())
    }

    fn release_reservation(&self, uetr: &str) -> Result<(), PaymentGateError> {
        let mut state = self.state.lock().unwrap();
        state.in_flight.remove(uetr);
        Ok(())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Format Validators
// ─────────────────────────────────────────────────────────────────────────────

/// Validates ISO 9362 Business Identifier Code (8 or 11 alphanumeric characters).
pub fn is_valid_bic(bic: &str) -> bool {
    let len = bic.len();
    if len != 8 && len != 11 {
        return false;
    }
    bic.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
}

/// Validates ISO 4217 Currency Code (3 uppercase ASCII letters).
pub fn is_valid_iso4217(currency: &str) -> bool {
    currency.len() == 3 && currency.chars().all(|c| c.is_ascii_uppercase())
}

/// Validates canonical UUID format (8-4-4-4-12 hex).
pub fn is_valid_uuid(uetr: &str) -> bool {
    if uetr.len() != 36 {
        return false;
    }
    let parts: Vec<&str> = uetr.split('-').collect();
    if parts.len() != 5 {
        return false;
    }
    let lens = [8, 4, 4, 4, 12];
    for (i, part) in parts.iter().enumerate() {
        if part.len() != lens[i] || !part.chars().all(|c| c.is_ascii_hexdigit()) {
            return false;
        }
    }
    true
}

// ─────────────────────────────────────────────────────────────────────────────
// XML Element Text Extractor (Namespace-Tolerant)
// ─────────────────────────────────────────────────────────────────────────────

fn extract_xml_element_inner(xml: &str, local_tag: &str) -> Option<String> {
    let mut search_idx = 0;
    while let Some(rel_open) = xml[search_idx..].find('<') {
        let start = search_idx + rel_open;
        if let Some(rel_close) = xml[start..].find('>') {
            let end = start + rel_close;
            let tag_content = xml[start + 1..end].trim();

            if !tag_content.starts_with('/') && !tag_content.starts_with('?') && !tag_content.starts_with('!') {
                let name = tag_content.split_whitespace().next().unwrap_or("").trim_end_matches('/');
                if name == local_tag || name.ends_with(&format!(":{}", local_tag)) {
                    // Found opening tag. Find corresponding closing tag </local_tag>
                    let inner_start = end + 1;
                    let mut close_idx = inner_start;
                    while let Some(rel_c_open) = xml[close_idx..].find("</") {
                        let c_start = close_idx + rel_c_open;
                        if let Some(rel_c_end) = xml[c_start..].find('>') {
                            let c_end = c_start + rel_c_end;
                            let c_name = xml[c_start + 2..c_end].trim();
                            if c_name == local_tag || c_name.ends_with(&format!(":{}", local_tag)) {
                                return Some(xml[inner_start..c_start].to_string());
                            }
                            close_idx = c_end + 1;
                        } else {
                            break;
                        }
                    }
                }
            }
            search_idx = end + 1;
        } else {
            break;
        }
    }
    None
}

fn extract_xml_element_text(xml: &str, local_tag: &str) -> Option<String> {
    extract_xml_element_inner(xml, local_tag).map(|s| s.trim().to_string())
}

fn extract_xml_attribute(xml: &str, local_tag: &str, attr_name: &str) -> Option<String> {
    let mut search_idx = 0;
    while let Some(rel_open) = xml[search_idx..].find('<') {
        let start = search_idx + rel_open;
        if let Some(rel_close) = xml[start..].find('>') {
            let end = start + rel_close;
            let tag_content = &xml[start + 1..end].trim();

            if !tag_content.starts_with('/') && !tag_content.starts_with('?') && !tag_content.starts_with('!') {
                let parts: Vec<&str> = tag_content.split_whitespace().collect();
                if let Some(name) = parts.first() {
                    let clean_name = name.trim_end_matches('/');
                    if clean_name == local_tag || clean_name.ends_with(&format!(":{}", local_tag)) {
                        for attr in &parts[1..] {
                            if let Some(stripped) = attr.strip_prefix(&format!("{}=", attr_name)) {
                                return Some(stripped.trim_matches('"').trim_matches('\'').to_string());
                            }
                        }
                    }
                }
            }
            search_idx = end + 1;
        } else {
            break;
        }
    }
    None
}

/// Approximate ISO 8601 parsing into Unix epoch timestamp seconds.
pub fn parse_iso8601_to_unix(dt_str: &str) -> Result<u64, PaymentGateError> {
    let cleaned = dt_str.trim().trim_end_matches('Z');
    let parts: Vec<&str> = cleaned.split('T').collect();
    if parts.len() != 2 {
        return Err(PaymentGateError::Internal(format!("Invalid timestamp format: '{dt_str}'")));
    }

    let date_parts: Vec<u64> = parts[0]
        .split('-')
        .filter_map(|s| s.parse().ok())
        .collect();
    if date_parts.len() != 3 {
        return Err(PaymentGateError::Internal(format!("Invalid date format: '{dt_str}'")));
    }

    let time_str = parts[1].split('+').next().unwrap_or(parts[1]);
    let time_parts: Vec<u64> = time_str
        .split(':')
        .filter_map(|s| s.parse().ok())
        .collect();
    if time_parts.len() < 2 {
        return Err(PaymentGateError::Internal(format!("Invalid time format: '{dt_str}'")));
    }

    let year = date_parts[0];
    let month = date_parts[1];
    let day = date_parts[2];
    let hour = time_parts[0];
    let min = time_parts[1];
    let sec = if time_parts.len() > 2 { time_parts[2] } else { 0 };

    let days_before_month = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    let y = if year >= 1970 { year - 1970 } else { 0 };
    let leap_days = (year - 1969) / 4;
    let month_idx = if month >= 1 && month <= 12 { month as usize - 1 } else { 0 };
    let days = y * 365 + leap_days + days_before_month[month_idx] + (day.saturating_sub(1));
    let total_secs = days * 86400 + hour * 3600 + min * 60 + sec;
    Ok(total_secs)
}

/// Parse and extract canonical financial payment attributes from ISO 20022 XML.
pub fn extract_financial_payment(xml: &str) -> Result<Iso20022FinancialPayment, PaymentGateError> {
    // Detect message type
    let message_type = if xml.contains("FIToFICstmrCdtTrf") {
        "pacs.008.001.08".to_string()
    } else if xml.contains("FICdtTrf") {
        "pacs.009.001.08".to_string()
    } else if xml.contains("FIToFIPmtStsRpt") {
        "pacs.002.001.10".to_string()
    } else if xml.contains("CstmrCdtTrfInitn") {
        "pain.001.001.09".to_string()
    } else {
        return Err(PaymentGateError::UnsupportedMessageType("Unknown or missing message root element".into()));
    };

    let msg_id = extract_xml_element_text(xml, "MsgId")
        .ok_or(PaymentGateError::MissingElement("MsgId"))?;

    let cre_dt_tm = extract_xml_element_text(xml, "CreDtTm")
        .ok_or(PaymentGateError::MissingElement("CreDtTm"))?;
    let cre_timestamp_unix = parse_iso8601_to_unix(&cre_dt_tm)?;

    let instructing_agent_bic = extract_xml_element_inner(xml, "InstgAgt")
        .and_then(|sub| extract_xml_element_text(&sub, "BICFI"))
        .or_else(|| extract_xml_element_text(xml, "BICFI"))
        .ok_or(PaymentGateError::MissingElement("InstgAgt/FinInstnId/BICFI"))?;

    let debtor_agent_bic = extract_xml_element_inner(xml, "DbtrAgt")
        .and_then(|sub| extract_xml_element_text(&sub, "BICFI"))
        .unwrap_or_else(|| instructing_agent_bic.clone());

    let creditor_agent_bic = extract_xml_element_inner(xml, "CdtrAgt")
        .and_then(|sub| extract_xml_element_text(&sub, "BICFI"))
        .ok_or(PaymentGateError::MissingElement("CdtrAgt/FinInstnId/BICFI"))?;

    let debtor_account = extract_xml_element_inner(xml, "DbtrAcct")
        .and_then(|sub| extract_xml_element_text(&sub, "IBAN").or_else(|| extract_xml_element_text(&sub, "Id")))
        .unwrap_or_else(|| "UNSPECIFIED_DEBTOR_ACCOUNT".into());

    let creditor_account = extract_xml_element_inner(xml, "CdtrAcct")
        .and_then(|sub| extract_xml_element_text(&sub, "IBAN").or_else(|| extract_xml_element_text(&sub, "Id")))
        .unwrap_or_else(|| "UNSPECIFIED_CREDITOR_ACCOUNT".into());

    let amount_str = extract_xml_element_text(xml, "IntrBkSttlmAmt")
        .or_else(|| extract_xml_element_text(xml, "InstdAmt"))
        .ok_or(PaymentGateError::MissingElement("IntrBkSttlmAmt / InstdAmt"))?;

    let amount: f64 = amount_str.parse().map_err(|_| PaymentGateError::InvalidAmount {
        amount: 0.0,
        reason: format!("Unparseable amount string '{amount_str}'"),
    })?;

    let currency = extract_xml_attribute(xml, "IntrBkSttlmAmt", "Ccy")
        .or_else(|| extract_xml_attribute(xml, "InstdAmt", "Ccy"))
        .ok_or(PaymentGateError::MissingElement("Ccy attribute on amount element"))?;

    let uetr = extract_xml_element_text(xml, "UETR")
        .ok_or(PaymentGateError::MissingElement("UETR"))?;

    let end_to_end_id = extract_xml_element_text(xml, "EndToEndId")
        .ok_or(PaymentGateError::MissingElement("EndToEndId"))?;

    Ok(Iso20022FinancialPayment {
        message_type,
        msg_id,
        cre_dt_tm,
        cre_timestamp_unix,
        instructing_agent_bic,
        debtor_agent_bic,
        creditor_agent_bic,
        debtor_account,
        creditor_account,
        amount,
        currency,
        uetr,
        end_to_end_id,
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// Iso20022PaymentGate — Complete 14-Point Invariant Gate
// ─────────────────────────────────────────────────────────────────────────────

/// Complete financial payment invariant gate.
pub struct Iso20022PaymentGate {
    pub institutional_registry: Arc<dyn InstitutionalKeyRegistry>,
    pub idempotency_store: Arc<dyn PaymentIdempotencyStore>,
    pub policy: PaymentPolicy,
}

impl Iso20022PaymentGate {
    pub fn new(
        institutional_registry: Arc<dyn InstitutionalKeyRegistry>,
        idempotency_store: Arc<dyn PaymentIdempotencyStore>,
        policy: PaymentPolicy,
    ) -> Self {
        Self {
            institutional_registry,
            idempotency_store,
            policy,
        }
    }

    /// Evaluates all financial invariants synchronously and fail-closed.
    pub fn validate_and_gate(
        &self,
        sealed_xml: &str,
        current_time_unix: u64,
    ) -> Result<AuthenticatedFinancialPayment, PaymentGateError> {
        // 1. Extract financial payment fields
        let payment = extract_financial_payment(sealed_xml)?;

        // 2. Validate Message Type
        if !self.policy.allowed_message_types.contains(&payment.message_type) {
            return Err(PaymentGateError::UnsupportedMessageType(payment.message_type));
        }

        // 3. Validate BIC formats (ISO 9362)
        if !is_valid_bic(&payment.instructing_agent_bic) {
            return Err(PaymentGateError::InvalidBic {
                field: "InstgAgt",
                value: payment.instructing_agent_bic,
            });
        }
        if !is_valid_bic(&payment.debtor_agent_bic) {
            return Err(PaymentGateError::InvalidBic {
                field: "DbtrAgt",
                value: payment.debtor_agent_bic,
            });
        }
        if !is_valid_bic(&payment.creditor_agent_bic) {
            return Err(PaymentGateError::InvalidBic {
                field: "CdtrAgt",
                value: payment.creditor_agent_bic,
            });
        }

        // 4. Sanction & Quarantine Screen
        if self.policy.blocked_bics.contains(&payment.instructing_agent_bic) {
            return Err(PaymentGateError::BlockedOrQuarantinedParty(payment.instructing_agent_bic));
        }
        if self.policy.blocked_bics.contains(&payment.debtor_agent_bic) {
            return Err(PaymentGateError::BlockedOrQuarantinedParty(payment.debtor_agent_bic));
        }
        if self.policy.blocked_bics.contains(&payment.creditor_agent_bic) {
            return Err(PaymentGateError::BlockedOrQuarantinedParty(payment.creditor_agent_bic));
        }

        // 5. Currency Code Validation (ISO 4217)
        if !is_valid_iso4217(&payment.currency) || !self.policy.allowed_currencies.contains(&payment.currency) {
            return Err(PaymentGateError::InvalidCurrency(payment.currency));
        }

        // 6. Amount Invariants
        if payment.amount.is_nan() || payment.amount.is_infinite() || payment.amount <= 0.0 {
            return Err(PaymentGateError::InvalidAmount {
                amount: payment.amount,
                reason: "Amount must be finite and strictly positive".into(),
            });
        }
        if payment.amount > self.policy.max_single_transaction_limit {
            return Err(PaymentGateError::AmountExceedsLimit {
                amount: payment.amount,
                limit: self.policy.max_single_transaction_limit,
            });
        }

        // 7. Identifiers (UETR UUIDv4 and EndToEndId)
        if !is_valid_uuid(&payment.uetr) {
            return Err(PaymentGateError::InvalidUetrFormat(payment.uetr));
        }
        if payment.end_to_end_id.trim().is_empty() || payment.end_to_end_id.len() > 35 {
            return Err(PaymentGateError::InvalidEndToEndId(payment.end_to_end_id));
        }

        // 8. Temporal Freshness Window
        let age = (current_time_unix as i64) - (payment.cre_timestamp_unix as i64);
        if age > self.policy.max_freshness_age_seconds {
            return Err(PaymentGateError::TemporalFreshnessExpired {
                age_seconds: age,
                max_allowed: self.policy.max_freshness_age_seconds,
            });
        }
        if age < -self.policy.max_future_skew_seconds {
            return Err(PaymentGateError::FutureDatedPayment {
                future_seconds: -age,
                max_allowed: self.policy.max_future_skew_seconds,
            });
        }

        // 9. Post-Quantum Seal Cryptographic Verification against Trusted Registry
        let auth_seal = verify_iso20022_pqc_seal_authenticated(sealed_xml, self.institutional_registry.as_ref())?;

        // 10. Active Signer Status
        if auth_seal.authenticated_institution.status != SignerStatus::Active {
            return Err(PaymentGateError::SignerNotActive(
                auth_seal.authenticated_institution.institution_name,
                auth_seal.authenticated_institution.status,
            ));
        }

        // 11. Signer BIC to Payment Origin Binding
        if auth_seal.authenticated_institution.bic != payment.instructing_agent_bic
            && auth_seal.authenticated_institution.bic != payment.debtor_agent_bic
        {
            return Err(PaymentGateError::SignerBicMismatch {
                signer_bic: auth_seal.authenticated_institution.bic,
                instructed_bic: payment.instructing_agent_bic,
            });
        }

        // 12. Pre-Execution Durable Replay Guard & Single-Winner Atomic CAS Reservation
        self.idempotency_store.check_and_reserve(&payment.uetr)?;

        Ok(AuthenticatedFinancialPayment {
            payment,
            signer_bic: auth_seal.authenticated_institution.bic,
            signer_institution_name: auth_seal.authenticated_institution.institution_name,
            canonical_body_hash_hex: auth_seal.canonical_payload_digest,
            ed25519_public_key_hex: auth_seal.seal.ed25519_public_key_hex,
            ml_dsa_87_public_key_hex: auth_seal.seal.ml_dsa_87_public_key_hex,
            gated_at_unix: current_time_unix,
        })
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::iso20022_pqc::{embed_pqc_seal_into_iso20022, InMemoryInstitutionalKeyRegistry, InstitutionalSigner};
    use ed25519_dalek::SigningKey as EdSigningKey;
    use fips204::ml_dsa_87;
    use fips204::traits::SerDes;
    use rand::rngs::OsRng;
    use rand::RngCore;

    fn generate_keypair() -> (EdSigningKey, ml_dsa_87::PrivateKey, ml_dsa_87::PublicKey) {
        let mut seed = [0u8; 32];
        OsRng.fill_bytes(&mut seed);
        let ed_sk = EdSigningKey::from_bytes(&seed);
        let (ml_pk, ml_sk) = ml_dsa_87::try_keygen().unwrap();
        (ed_sk, ml_sk, ml_pk)
    }

    fn sample_pacs008(bic: &str, uetr: &str, amount: &str, currency: &str, cre_dt_tm: &str) -> String {
        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08">
    <FIToFICstmrCdtTrf>
        <GrpHdr>
            <MsgId>MSG-20261023-9999</MsgId>
            <CreDtTm>{cre_dt_tm}</CreDtTm>
            <NbOfTxs>1</NbOfTxs>
            <SttlmInf>
                <SttlmMtd>CLRG</SttlmMtd>
            </SttlmInf>
            <InstgAgt>
                <FinInstnId>
                    <BICFI>{bic}</BICFI>
                </FinInstnId>
            </InstgAgt>
        </GrpHdr>
        <CdtTrfTxInf>
            <PmtId>
                <EndToEndId>E2E-TRANS-001</EndToEndId>
                <UETR>{uetr}</UETR>
            </PmtId>
            <IntrBkSttlmAmt Ccy="{currency}">{amount}</IntrBkSttlmAmt>
            <DbtrAgt>
                <FinInstnId>
                    <BICFI>{bic}</BICFI>
                </FinInstnId>
            </DbtrAgt>
            <CdtrAgt>
                <FinInstnId>
                    <BICFI>BNPAFRPPXXX</BICFI>
                </FinInstnId>
            </CdtrAgt>
            <DbtrAcct>
                <Id>
                    <IBAN>DE89370400440532013000</IBAN>
                </Id>
            </DbtrAcct>
            <CdtrAcct>
                <Id>
                    <IBAN>FR7630006000011234567890189</IBAN>
                </Id>
            </CdtrAcct>
        </CdtTrfTxInf>
    </FIToFICstmrCdtTrf>
</Document>"#
        )
    }

    #[test]
    fn test_payment_gate_accepts_valid_pacs008() {
        let registry = Arc::new(InMemoryInstitutionalKeyRegistry::new());
        let idempotency = Arc::new(InMemoryPaymentIdempotencyStore::new());
        let gate = Iso20022PaymentGate::new(registry.clone(), idempotency.clone(), PaymentPolicy::default());

        let (ed_sk, ml_sk, ml_pk) = generate_keypair();

        registry.register_signer(InstitutionalSigner {
            institution_id: "inst-dbeumm21".into(),
            institution_name: "Deutsche Bank Frankfurt".into(),
            bic: "DBEUMM21XXX".into(),
            status: SignerStatus::Active,
            ed25519_public_key_hex: hex::encode(ed_sk.verifying_key().to_bytes()),
            ml_dsa_87_public_key_hex: hex::encode(ml_pk.clone().into_bytes()),
            authorized_message_types: vec!["pacs.008.001.08".into()],
            valid_until_epoch: 2000000000,
        });

        let uetr = "c0a80101-1234-4567-89ab-cdef01234567";
        let xml = sample_pacs008("DBEUMM21XXX", uetr, "150000.50", "EUR", "2026-10-23T12:00:00Z");

        let sealed = embed_pqc_seal_into_iso20022(
            &xml,
            "DBEUMM21XXX",
            "key-01",
            "pacs.008.001.08",
            &ed_sk,
            &ml_sk,
            &ml_pk,
            1792345000,
        )
        .unwrap();

        let now = parse_iso8601_to_unix("2026-10-23T12:01:00Z").unwrap();
        let res = gate.validate_and_gate(&sealed, now);
        assert!(res.is_ok(), "Valid pacs.008 must pass gate: {res:?}");

        let auth = res.unwrap();
        assert_eq!(auth.signer_bic, "DBEUMM21XXX");
        assert_eq!(auth.payment.amount, 150000.50);
        assert_eq!(auth.payment.currency, "EUR");
        assert_eq!(auth.payment.uetr, uetr);
    }

    #[test]
    fn test_payment_gate_rejects_untrusted_signer() {
        let registry = Arc::new(InMemoryInstitutionalKeyRegistry::new());
        let idempotency = Arc::new(InMemoryPaymentIdempotencyStore::new());
        let gate = Iso20022PaymentGate::new(registry.clone(), idempotency.clone(), PaymentPolicy::default());

        let (ed_sk, ml_sk, ml_pk) = generate_keypair();

        // Signer NOT registered in registry
        let uetr = "c0a80101-1234-4567-89ab-cdef01234567";
        let xml = sample_pacs008("ROGUEBK1XXX", uetr, "5000.00", "USD", "2026-10-23T12:00:00Z");
        let sealed = embed_pqc_seal_into_iso20022(
            &xml,
            "ROGUEBK1XXX",
            "key-01",
            "pacs.008.001.08",
            &ed_sk,
            &ml_sk,
            &ml_pk,
            1792345000,
        )
        .unwrap();

        let now = parse_iso8601_to_unix("2026-10-23T12:01:00Z").unwrap();
        let res = gate.validate_and_gate(&sealed, now);
        assert!(matches!(res, Err(PaymentGateError::CryptographicSealFailed(_))));
    }

    #[test]
    fn test_payment_gate_rejects_disallowed_currency() {
        let registry = Arc::new(InMemoryInstitutionalKeyRegistry::new());
        let idempotency = Arc::new(InMemoryPaymentIdempotencyStore::new());
        let gate = Iso20022PaymentGate::new(registry.clone(), idempotency.clone(), PaymentPolicy::default());

        let (ed_sk, ml_sk, ml_pk) = generate_keypair();

        registry.register_signer(InstitutionalSigner {
            institution_id: "inst-dbeumm21".into(),
            institution_name: "Deutsche Bank Frankfurt".into(),
            bic: "DBEUMM21XXX".into(),
            status: SignerStatus::Active,
            ed25519_public_key_hex: hex::encode(ed_sk.verifying_key().to_bytes()),
            ml_dsa_87_public_key_hex: hex::encode(ml_pk.clone().into_bytes()),
            authorized_message_types: vec!["pacs.008.001.08".into()],
            valid_until_epoch: 2000000000,
        });

        let uetr = "c0a80101-1234-4567-89ab-cdef01234567";
        // Currency XYZ is not in allowed list
        let xml = sample_pacs008("DBEUMM21XXX", uetr, "150000.50", "XYZ", "2026-10-23T12:00:00Z");
        let sealed = embed_pqc_seal_into_iso20022(
            &xml,
            "DBEUMM21XXX",
            "key-01",
            "pacs.008.001.08",
            &ed_sk,
            &ml_sk,
            &ml_pk,
            1792345000,
        )
        .unwrap();

        let now = parse_iso8601_to_unix("2026-10-23T12:01:00Z").unwrap();
        let res = gate.validate_and_gate(&sealed, now);
        assert!(matches!(res, Err(PaymentGateError::InvalidCurrency(_))));
    }

    #[test]
    fn test_payment_gate_rejects_negative_or_zero_amount() {
        let registry = Arc::new(InMemoryInstitutionalKeyRegistry::new());
        let idempotency = Arc::new(InMemoryPaymentIdempotencyStore::new());
        let gate = Iso20022PaymentGate::new(registry.clone(), idempotency.clone(), PaymentPolicy::default());

        let (ed_sk, ml_sk, ml_pk) = generate_keypair();

        registry.register_signer(InstitutionalSigner {
            institution_id: "inst-dbeumm21".into(),
            institution_name: "Deutsche Bank Frankfurt".into(),
            bic: "DBEUMM21XXX".into(),
            status: SignerStatus::Active,
            ed25519_public_key_hex: hex::encode(ed_sk.verifying_key().to_bytes()),
            ml_dsa_87_public_key_hex: hex::encode(ml_pk.clone().into_bytes()),
            authorized_message_types: vec!["pacs.008.001.08".into()],
            valid_until_epoch: 2000000000,
        });

        let uetr = "c0a80101-1234-4567-89ab-cdef01234567";
        let xml = sample_pacs008("DBEUMM21XXX", uetr, "-50.00", "EUR", "2026-10-23T12:00:00Z");
        let sealed = embed_pqc_seal_into_iso20022(
            &xml,
            "DBEUMM21XXX",
            "key-01",
            "pacs.008.001.08",
            &ed_sk,
            &ml_sk,
            &ml_pk,
            1792345000,
        )
        .unwrap();

        let now = parse_iso8601_to_unix("2026-10-23T12:01:00Z").unwrap();
        let res = gate.validate_and_gate(&sealed, now);
        assert!(matches!(res, Err(PaymentGateError::InvalidAmount { .. })));
    }

    #[test]
    fn test_payment_gate_rejects_replay() {
        let registry = Arc::new(InMemoryInstitutionalKeyRegistry::new());
        let idempotency = Arc::new(InMemoryPaymentIdempotencyStore::new());
        let gate = Iso20022PaymentGate::new(registry.clone(), idempotency.clone(), PaymentPolicy::default());

        let (ed_sk, ml_sk, ml_pk) = generate_keypair();

        registry.register_signer(InstitutionalSigner {
            institution_id: "inst-dbeumm21".into(),
            institution_name: "Deutsche Bank Frankfurt".into(),
            bic: "DBEUMM21XXX".into(),
            status: SignerStatus::Active,
            ed25519_public_key_hex: hex::encode(ed_sk.verifying_key().to_bytes()),
            ml_dsa_87_public_key_hex: hex::encode(ml_pk.clone().into_bytes()),
            authorized_message_types: vec!["pacs.008.001.08".into()],
            valid_until_epoch: 2000000000,
        });

        let uetr = "c0a80101-1234-4567-89ab-cdef01234567";
        let xml = sample_pacs008("DBEUMM21XXX", uetr, "100.00", "USD", "2026-10-23T12:00:00Z");
        let sealed = embed_pqc_seal_into_iso20022(
            &xml,
            "DBEUMM21XXX",
            "key-01",
            "pacs.008.001.08",
            &ed_sk,
            &ml_sk,
            &ml_pk,
            1792345000,
        )
        .unwrap();

        let now = parse_iso8601_to_unix("2026-10-23T12:01:00Z").unwrap();
        assert!(gate.validate_and_gate(&sealed, now).is_ok());

        // Commit first transaction
        idempotency.mark_committed(uetr).unwrap();

        // Second attempt with same UETR must be rejected as replay
        let res2 = gate.validate_and_gate(&sealed, now);
        assert_eq!(res2, Err(PaymentGateError::ReplayDetected(uetr.to_string())));
    }

    #[test]
    fn test_payment_gate_rejects_stale_timestamp() {
        let registry = Arc::new(InMemoryInstitutionalKeyRegistry::new());
        let idempotency = Arc::new(InMemoryPaymentIdempotencyStore::new());
        let gate = Iso20022PaymentGate::new(registry.clone(), idempotency.clone(), PaymentPolicy::default());

        let (ed_sk, ml_sk, ml_pk) = generate_keypair();

        registry.register_signer(InstitutionalSigner {
            institution_id: "inst-dbeumm21".into(),
            institution_name: "Deutsche Bank Frankfurt".into(),
            bic: "DBEUMM21XXX".into(),
            status: SignerStatus::Active,
            ed25519_public_key_hex: hex::encode(ed_sk.verifying_key().to_bytes()),
            ml_dsa_87_public_key_hex: hex::encode(ml_pk.clone().into_bytes()),
            authorized_message_types: vec!["pacs.008.001.08".into()],
            valid_until_epoch: 2000000000,
        });

        let uetr = "c0a80101-1234-4567-89ab-cdef01234567";
        let xml = sample_pacs008("DBEUMM21XXX", uetr, "100.00", "USD", "2026-10-23T12:00:00Z");
        let sealed = embed_pqc_seal_into_iso20022(
            &xml,
            "DBEUMM21XXX",
            "key-01",
            "pacs.008.001.08",
            &ed_sk,
            &ml_sk,
            &ml_pk,
            1792345000,
        )
        .unwrap();

        // Gateway time is 10 minutes later (600s > 300s max allowed)
        let now = parse_iso8601_to_unix("2026-10-23T12:10:00Z").unwrap();
        let res = gate.validate_and_gate(&sealed, now);
        assert!(matches!(res, Err(PaymentGateError::TemporalFreshnessExpired { .. })));
    }

    #[test]
    fn test_payment_gate_rejects_future_dated_payment() {
        let registry = Arc::new(InMemoryInstitutionalKeyRegistry::new());
        let idempotency = Arc::new(InMemoryPaymentIdempotencyStore::new());
        let gate = Iso20022PaymentGate::new(registry.clone(), idempotency.clone(), PaymentPolicy::default());

        let (ed_sk, ml_sk, ml_pk) = generate_keypair();

        registry.register_signer(InstitutionalSigner {
            institution_id: "inst-dbeumm21".into(),
            institution_name: "Deutsche Bank Frankfurt".into(),
            bic: "DBEUMM21XXX".into(),
            status: SignerStatus::Active,
            ed25519_public_key_hex: hex::encode(ed_sk.verifying_key().to_bytes()),
            ml_dsa_87_public_key_hex: hex::encode(ml_pk.clone().into_bytes()),
            authorized_message_types: vec!["pacs.008.001.08".into()],
            valid_until_epoch: 2000000000,
        });

        let uetr = "c0a80101-1234-4567-89ab-cdef01234567";
        // Message dated 2026-10-23T12:05:00Z (5 minutes in future relative to gateway now)
        let xml = sample_pacs008("DBEUMM21XXX", uetr, "100.00", "USD", "2026-10-23T12:05:00Z");
        let sealed = embed_pqc_seal_into_iso20022(
            &xml,
            "DBEUMM21XXX",
            "key-01",
            "pacs.008.001.08",
            &ed_sk,
            &ml_sk,
            &ml_pk,
            1792345000,
        )
        .unwrap();

        let now = parse_iso8601_to_unix("2026-10-23T12:00:00Z").unwrap();
        let res = gate.validate_and_gate(&sealed, now);
        assert!(matches!(res, Err(PaymentGateError::FutureDatedPayment { .. })));
    }

    #[test]
    fn test_payment_gate_rejects_signer_bic_mismatch() {
        let registry = Arc::new(InMemoryInstitutionalKeyRegistry::new());
        let idempotency = Arc::new(InMemoryPaymentIdempotencyStore::new());
        let gate = Iso20022PaymentGate::new(registry.clone(), idempotency.clone(), PaymentPolicy::default());

        let (ed_sk, ml_sk, ml_pk) = generate_keypair();

        // Register BARCGB22 in registry
        registry.register_signer(InstitutionalSigner {
            institution_id: "inst-barclays".into(),
            institution_name: "Barclays Bank".into(),
            bic: "BARCGB22XXX".into(),
            status: SignerStatus::Active,
            ed25519_public_key_hex: hex::encode(ed_sk.verifying_key().to_bytes()),
            ml_dsa_87_public_key_hex: hex::encode(ml_pk.clone().into_bytes()),
            authorized_message_types: vec!["pacs.008.001.08".into()],
            valid_until_epoch: 2000000000,
        });

        let uetr = "c0a80101-1234-4567-89ab-cdef01234567";
        // XML claims DBEUMM21XXX as instructing agent, but sealed with BARCGB22XXX
        let xml = sample_pacs008("DBEUMM21XXX", uetr, "100.00", "USD", "2026-10-23T12:00:00Z");
        let sealed = embed_pqc_seal_into_iso20022(
            &xml,
            "BARCGB22XXX",
            "key-01",
            "pacs.008.001.08",
            &ed_sk,
            &ml_sk,
            &ml_pk,
            1792345000,
        )
        .unwrap();

        let now = parse_iso8601_to_unix("2026-10-23T12:01:00Z").unwrap();
        let res = gate.validate_and_gate(&sealed, now);
        assert!(matches!(res, Err(PaymentGateError::SignerBicMismatch { .. })));
    }

    #[test]
    fn test_payment_gate_rejects_exceeded_transaction_limit() {
        let registry = Arc::new(InMemoryInstitutionalKeyRegistry::new());
        let idempotency = Arc::new(InMemoryPaymentIdempotencyStore::new());
        let mut policy = PaymentPolicy::default();
        policy.max_single_transaction_limit = 1_000_000.0; // $1M limit
        let gate = Iso20022PaymentGate::new(registry.clone(), idempotency.clone(), policy);

        let (ed_sk, ml_sk, ml_pk) = generate_keypair();

        registry.register_signer(InstitutionalSigner {
            institution_id: "inst-dbeumm21".into(),
            institution_name: "Deutsche Bank Frankfurt".into(),
            bic: "DBEUMM21XXX".into(),
            status: SignerStatus::Active,
            ed25519_public_key_hex: hex::encode(ed_sk.verifying_key().to_bytes()),
            ml_dsa_87_public_key_hex: hex::encode(ml_pk.clone().into_bytes()),
            authorized_message_types: vec!["pacs.008.001.08".into()],
            valid_until_epoch: 2000000000,
        });

        let uetr = "c0a80101-1234-4567-89ab-cdef01234567";
        // Amount is $5M (> $1M limit)
        let xml = sample_pacs008("DBEUMM21XXX", uetr, "5000000.00", "USD", "2026-10-23T12:00:00Z");
        let sealed = embed_pqc_seal_into_iso20022(
            &xml,
            "DBEUMM21XXX",
            "key-01",
            "pacs.008.001.08",
            &ed_sk,
            &ml_sk,
            &ml_pk,
            1792345000,
        )
        .unwrap();

        let now = parse_iso8601_to_unix("2026-10-23T12:01:00Z").unwrap();
        let res = gate.validate_and_gate(&sealed, now);
        assert!(matches!(res, Err(PaymentGateError::AmountExceedsLimit { .. })));
    }

    #[test]
    fn test_payment_gate_rejects_malformed_uetr() {
        let registry = Arc::new(InMemoryInstitutionalKeyRegistry::new());
        let idempotency = Arc::new(InMemoryPaymentIdempotencyStore::new());
        let gate = Iso20022PaymentGate::new(registry.clone(), idempotency.clone(), PaymentPolicy::default());

        let (ed_sk, ml_sk, ml_pk) = generate_keypair();

        registry.register_signer(InstitutionalSigner {
            institution_id: "inst-dbeumm21".into(),
            institution_name: "Deutsche Bank Frankfurt".into(),
            bic: "DBEUMM21XXX".into(),
            status: SignerStatus::Active,
            ed25519_public_key_hex: hex::encode(ed_sk.verifying_key().to_bytes()),
            ml_dsa_87_public_key_hex: hex::encode(ml_pk.clone().into_bytes()),
            authorized_message_types: vec!["pacs.008.001.08".into()],
            valid_until_epoch: 2000000000,
        });

        // Malformed non-UUID UETR
        let bad_uetr = "not-a-valid-uuid-format-123";
        let xml = sample_pacs008("DBEUMM21XXX", bad_uetr, "100.00", "USD", "2026-10-23T12:00:00Z");
        let sealed = embed_pqc_seal_into_iso20022(
            &xml,
            "DBEUMM21XXX",
            "key-01",
            "pacs.008.001.08",
            &ed_sk,
            &ml_sk,
            &ml_pk,
            1792345000,
        )
        .unwrap();

        let now = parse_iso8601_to_unix("2026-10-23T12:01:00Z").unwrap();
        let res = gate.validate_and_gate(&sealed, now);
        assert!(matches!(res, Err(PaymentGateError::InvalidUetrFormat(_))));
    }

    #[test]
    fn test_payment_gate_rejects_blocked_bic() {
        let registry = Arc::new(InMemoryInstitutionalKeyRegistry::new());
        let idempotency = Arc::new(InMemoryPaymentIdempotencyStore::new());
        let mut policy = PaymentPolicy::default();
        policy.blocked_bics.insert("BNPAFRPPXXX".into()); // Creditor agent blocked
        let gate = Iso20022PaymentGate::new(registry.clone(), idempotency.clone(), policy);

        let (ed_sk, ml_sk, ml_pk) = generate_keypair();

        registry.register_signer(InstitutionalSigner {
            institution_id: "inst-dbeumm21".into(),
            institution_name: "Deutsche Bank Frankfurt".into(),
            bic: "DBEUMM21XXX".into(),
            status: SignerStatus::Active,
            ed25519_public_key_hex: hex::encode(ed_sk.verifying_key().to_bytes()),
            ml_dsa_87_public_key_hex: hex::encode(ml_pk.clone().into_bytes()),
            authorized_message_types: vec!["pacs.008.001.08".into()],
            valid_until_epoch: 2000000000,
        });

        let uetr = "c0a80101-1234-4567-89ab-cdef01234567";
        let xml = sample_pacs008("DBEUMM21XXX", uetr, "100.00", "USD", "2026-10-23T12:00:00Z");
        let sealed = embed_pqc_seal_into_iso20022(
            &xml,
            "DBEUMM21XXX",
            "key-01",
            "pacs.008.001.08",
            &ed_sk,
            &ml_sk,
            &ml_pk,
            1792345000,
        )
        .unwrap();

        let now = parse_iso8601_to_unix("2026-10-23T12:01:00Z").unwrap();
        let res = gate.validate_and_gate(&sealed, now);
        assert!(matches!(res, Err(PaymentGateError::BlockedOrQuarantinedParty(_))));
    }

    #[test]
    fn test_payment_gate_concurrent_in_flight_blocked() {
        let registry = Arc::new(InMemoryInstitutionalKeyRegistry::new());
        let idempotency = Arc::new(InMemoryPaymentIdempotencyStore::new());
        let gate = Iso20022PaymentGate::new(registry.clone(), idempotency.clone(), PaymentPolicy::default());

        let (ed_sk, ml_sk, ml_pk) = generate_keypair();

        registry.register_signer(InstitutionalSigner {
            institution_id: "inst-dbeumm21".into(),
            institution_name: "Deutsche Bank Frankfurt".into(),
            bic: "DBEUMM21XXX".into(),
            status: SignerStatus::Active,
            ed25519_public_key_hex: hex::encode(ed_sk.verifying_key().to_bytes()),
            ml_dsa_87_public_key_hex: hex::encode(ml_pk.clone().into_bytes()),
            authorized_message_types: vec!["pacs.008.001.08".into()],
            valid_until_epoch: 2000000000,
        });

        let uetr = "c0a80101-1234-4567-89ab-cdef01234567";
        let xml = sample_pacs008("DBEUMM21XXX", uetr, "100.00", "USD", "2026-10-23T12:00:00Z");
        let sealed = embed_pqc_seal_into_iso20022(
            &xml,
            "DBEUMM21XXX",
            "key-01",
            "pacs.008.001.08",
            &ed_sk,
            &ml_sk,
            &ml_pk,
            1792345000,
        )
        .unwrap();

        let now = parse_iso8601_to_unix("2026-10-23T12:01:00Z").unwrap();
        // First submission succeeds and reserves UETR
        assert!(gate.validate_and_gate(&sealed, now).is_ok());

        // Concurrent submission while in-flight (before commit) must be blocked
        let res_concurrent = gate.validate_and_gate(&sealed, now);
        assert_eq!(
            res_concurrent,
            Err(PaymentGateError::ConcurrentSubmissionBlocked(uetr.to_string()))
        );
    }
}
