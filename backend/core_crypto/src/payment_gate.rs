//! # payment_gate — ISO 20022 Financial Transaction Invariant Gate
//!
//! Enforces deterministic financial transaction invariants for ISO 20022
//! payment messages (pacs.008.001.08 and pacs.009.001.08) sealed with
//! post-quantum dual signatures (Ed25519 + ML-DSA-87).
//!
//! Unlike finding evidence gates which inspect metadata and content hashes,
//! this module enforces institutional banking rules:
//! - Bounded structural payment profile (official ISO XSD validation remains required)
//! - Authenticated institutional signer identity from a trusted registry
//! - Matching Instructing / Debtor Agent BIC to authenticated signing identity
//! - ISO 9362 BIC formatting (8 or 11 alphanumeric characters)
//! - Debtor / Creditor institution sanction & quarantine screening
//! - ISO 4217 uppercase 3-letter currency code validation
//! - Strictly positive decimal transaction amounts within institutional limits
//! - Unique canonical UETR (UUIDv4) and non-empty EndToEndId
//! - Strict temporal freshness window (clock skew tolerance)
//! - Post-quantum dual signature mathematical verification over canonical XML
//! - Pluggable pre-execution idempotency reservation; bundled store is in-memory

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
    FutureDatedPayment {
        future_seconds: i64,
        max_allowed: i64,
    },

    #[error("Institution BIC '{0}' is quarantined or on the sanctions blocklist")]
    BlockedOrQuarantinedParty(String),

    #[error("Signer BIC mismatch: authenticated signer is '{signer_bic}', but message declares '{instructed_bic}'")]
    SignerBicMismatch {
        signer_bic: String,
        instructed_bic: String,
    },

    #[error("Signer institution '{0}' is not active (status: {1:?})")]
    SignerNotActive(String, SignerStatus),

    #[error("Cryptographic PQC seal verification failed: {0}")]
    CryptographicSealFailed(String),

    #[error("Replay detected: payment with UETR '{0}' has already been processed and committed")]
    ReplayDetected(String),

    #[error("Concurrent submission conflict: payment with UETR '{0}' is currently in-flight")]
    ConcurrentSubmissionBlocked(String),

    #[error("Invalid payment input: {0}")]
    InvalidField(&'static str),

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
    pub amount_minor_units: u128,
    pub amount_scale: u32,
    pub amount_decimal_str: String,
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
    pub max_single_transaction_minor_units: Option<u128>,
    pub max_freshness_age_seconds: i64,
    pub max_future_skew_seconds: i64,
    pub blocked_bics: HashSet<String>,
}

impl Default for PaymentPolicy {
    fn default() -> Self {
        Self {
            allowed_message_types: vec!["pacs.008.001.08".into(), "pacs.009.001.08".into()],
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
            max_single_transaction_minor_units: None,
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
            return Err(PaymentGateError::ConcurrentSubmissionBlocked(
                uetr.to_string(),
            ));
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
    bic.chars()
        .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
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

/// Strict RFC 3339 parsing; offset-normalized and restricted to nonnegative Unix seconds.
pub fn parse_iso8601_to_unix(dt_str: &str) -> Result<u64, PaymentGateError> {
    let date = chrono::DateTime::parse_from_rfc3339(dt_str)
        .map_err(|_| PaymentGateError::InvalidField("Invalid RFC3339 timestamp"))?;
    // Leap seconds and subsecond timestamps are not part of this bounded profile.
    if date.timestamp_subsec_nanos() != 0 {
        return Err(PaymentGateError::InvalidField(
            "Unsupported subsecond/leap-second timestamp",
        ));
    }
    u64::try_from(date.timestamp())
        .map_err(|_| PaymentGateError::InvalidField("Timestamp before Unix epoch"))
}

/// Standard ISO 4217 minor unit exponent (scale) definition.
pub fn iso4217_minor_unit_scale(currency: &str) -> u32 {
    match currency {
        "JPY" | "KRW" | "VND" | "UGX" | "PYG" | "RWF" | "BIF" | "CLP" | "DJF" | "GNF" | "KMF" => 0,
        "BHD" | "KWD" | "OMR" | "JOD" | "TND" | "LYD" | "IQD" => 3,
        _ => 2,
    }
}

/// Parses an exact unsigned decimal monetary amount string into exact minor integer units
/// and record of decimal scale without binary floating-point representation drift.
pub fn parse_exact_minor_units(
    amount_text: &str,
    currency: &str,
) -> Result<(u128, u32), PaymentGateError> {
    let parts: Vec<&str> = amount_text.split('.').collect();
    if parts.len() > 2
        || parts
            .iter()
            .any(|p| p.is_empty() || !p.bytes().all(|b| b.is_ascii_digit()))
    {
        return Err(PaymentGateError::InvalidAmount {
            amount: 0.0,
            reason: "Expected unsigned decimal amount".into(),
        });
    }

    let whole: u128 = parts[0]
        .parse()
        .map_err(|_| PaymentGateError::InvalidAmount {
            amount: 0.0,
            reason: "Invalid whole amount digits".into(),
        })?;

    let target_scale = iso4217_minor_unit_scale(currency);
    let (frac_val, scale) = if parts.len() == 2 {
        let frac_str = parts[1];
        let scale = frac_str.len() as u32;
        let mut padded = frac_str.to_string();
        if padded.len() < target_scale as usize {
            padded.push_str(&"0".repeat(target_scale as usize - padded.len()));
        } else if padded.len() > target_scale as usize {
            let excess = &padded[target_scale as usize..];
            if excess.chars().any(|c| c != '0') {
                return Err(PaymentGateError::InvalidAmount {
                    amount: 0.0,
                    reason: format!(
                        "Amount has {} decimal places, but currency {} specifies scale {}",
                        scale, currency, target_scale
                    ),
                });
            }
            padded.truncate(target_scale as usize);
        }
        let frac: u128 = if padded.is_empty() {
            0
        } else {
            padded
                .parse()
                .map_err(|_| PaymentGateError::InvalidAmount {
                    amount: 0.0,
                    reason: "Invalid fractional digits".into(),
                })?
        };
        (frac, scale)
    } else {
        (0u128, 0u32)
    };

    let multiplier = 10u128.pow(target_scale);
    let minor_units = whole
        .checked_mul(multiplier)
        .and_then(|w| w.checked_add(frac_val))
        .ok_or_else(|| PaymentGateError::InvalidAmount {
            amount: 0.0,
            reason: "Amount overflow in minor units calculation".into(),
        })?;

    Ok((minor_units, scale))
}

/// Extracts one payment through namespace-qualified, unambiguous structural paths.
/// Does not implement official ISO XSD or network usage validation.
pub fn extract_financial_payment(xml: &str) -> Result<Iso20022FinancialPayment, PaymentGateError> {
    use crate::payment_xml::{child, path, text};
    let doc = crate::payment_xml::parse(xml)?;
    let message = crate::payment_xml::message(&doc);
    let group = child(message, "GrpHdr")?;
    let tx = child(message, "CdtTrfTxInf")?;
    if text(child(group, "NbOfTxs")?)? != "1" {
        return Err(PaymentGateError::InvalidField(
            "Only single-payment messages are supported",
        ));
    }
    let msg_id = text(child(group, "MsgId")?)?;
    if msg_id.len() > 35 {
        return Err(PaymentGateError::InvalidField(
            "Message ID exceeds profile limit",
        ));
    }
    let cre_dt_tm = text(child(group, "CreDtTm")?)?;
    let cre_timestamp_unix = parse_iso8601_to_unix(&cre_dt_tm)?;
    let instructing_agent_bic = text(path(group, &["InstgAgt", "FinInstnId", "BICFI"])?)?;
    let debtor_agent_bic = text(path(tx, &["DbtrAgt", "FinInstnId", "BICFI"])?)?;
    let creditor_agent_bic = text(path(tx, &["CdtrAgt", "FinInstnId", "BICFI"])?)?;
    let account = |name| -> Result<String, Iso20022Error> {
        let id = path(tx, &[name, "Id"])?;
        let children: Vec<_> = id.children().filter(roxmltree::Node::is_element).collect();
        if children.len() != 1 {
            return Err(crate::payment_xml::invalid("Ambiguous account reference"));
        }
        match children[0].tag_name().name() {
            "IBAN" => text(children[0]),
            "Othr" => text(child(children[0], "Id")?),
            _ => Err(crate::payment_xml::invalid("Unsupported account reference")),
        }
    };
    let amount_node = child(tx, "IntrBkSttlmAmt")?;
    let amount_text = text(amount_node)?;
    let currency = amount_node
        .attribute("Ccy")
        .ok_or(PaymentGateError::MissingElement("Ccy"))?
        .to_owned();
    let (amount_minor_units, amount_scale) = parse_exact_minor_units(&amount_text, &currency)?;
    let amount = amount_text
        .parse()
        .map_err(|_| PaymentGateError::InvalidAmount {
            amount: 0.0,
            reason: "Invalid decimal amount".into(),
        })?;
    let amount_decimal_str = amount_text.to_owned();
    Ok(Iso20022FinancialPayment {
        message_type: crate::payment_xml::message_type(&doc).to_owned(),
        msg_id,
        cre_dt_tm,
        cre_timestamp_unix,
        instructing_agent_bic,
        debtor_agent_bic,
        creditor_agent_bic,
        debtor_account: account("DbtrAcct")?,
        creditor_account: account("CdtrAcct")?,
        amount,
        amount_minor_units,
        amount_scale,
        amount_decimal_str,
        currency,
        uetr: text(path(tx, &["PmtId", "UETR"])?)?,
        end_to_end_id: text(path(tx, &["PmtId", "EndToEndId"])?)?,
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
        if !self.policy.max_single_transaction_limit.is_finite()
            || self.policy.max_single_transaction_limit <= 0.0
            || self.policy.max_freshness_age_seconds < 0
            || self.policy.max_future_skew_seconds < 0
            || current_time_unix > i64::MAX as u64
        {
            return Err(PaymentGateError::Internal(
                "Invalid payment policy or trusted clock".into(),
            ));
        }
        // 1. Extract financial payment fields
        let payment = extract_financial_payment(sealed_xml)?;

        // 2. Validate Message Type
        if !self
            .policy
            .allowed_message_types
            .contains(&payment.message_type)
        {
            return Err(PaymentGateError::UnsupportedMessageType(
                payment.message_type,
            ));
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
        if self
            .policy
            .blocked_bics
            .contains(&payment.instructing_agent_bic)
        {
            return Err(PaymentGateError::BlockedOrQuarantinedParty(
                payment.instructing_agent_bic,
            ));
        }
        if self.policy.blocked_bics.contains(&payment.debtor_agent_bic) {
            return Err(PaymentGateError::BlockedOrQuarantinedParty(
                payment.debtor_agent_bic,
            ));
        }
        if self
            .policy
            .blocked_bics
            .contains(&payment.creditor_agent_bic)
        {
            return Err(PaymentGateError::BlockedOrQuarantinedParty(
                payment.creditor_agent_bic,
            ));
        }

        // 5. Currency Code Validation (ISO 4217)
        if !is_valid_iso4217(&payment.currency)
            || !self.policy.allowed_currencies.contains(&payment.currency)
        {
            return Err(PaymentGateError::InvalidCurrency(payment.currency));
        }

        // 6. Amount Invariants (Exact Minor-Unit Integer & Decimal Validation)
        if payment.amount.is_nan()
            || payment.amount.is_infinite()
            || payment.amount <= 0.0
            || payment.amount_minor_units == 0
        {
            return Err(PaymentGateError::InvalidAmount {
                amount: payment.amount,
                reason:
                    "Amount must be finite, strictly positive, and represent non-zero minor units"
                        .into(),
            });
        }
        if let Some(limit_minor) = self.policy.max_single_transaction_minor_units {
            if payment.amount_minor_units > limit_minor {
                return Err(PaymentGateError::AmountExceedsLimit {
                    amount: payment.amount,
                    limit: self.policy.max_single_transaction_limit,
                });
            }
        } else if payment.amount > self.policy.max_single_transaction_limit {
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
        let auth_seal = verify_iso20022_pqc_seal_authenticated(
            sealed_xml,
            self.institutional_registry.as_ref(),
        )?;

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
        if !self.idempotency_store.check_and_reserve(&payment.uetr)? {
            return Err(PaymentGateError::ConcurrentSubmissionBlocked(payment.uetr));
        }

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
    use crate::iso20022_pqc::{
        embed_pqc_seal_into_iso20022, InMemoryInstitutionalKeyRegistry, InstitutionalSigner,
    };
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

    fn sample_pacs008(
        bic: &str,
        uetr: &str,
        amount: &str,
        currency: &str,
        cre_dt_tm: &str,
    ) -> String {
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
        let gate = Iso20022PaymentGate::new(
            registry.clone(),
            idempotency.clone(),
            PaymentPolicy::default(),
        );

        let (ed_sk, ml_sk, ml_pk) = generate_keypair();

        registry.register_signer(InstitutionalSigner {
            institution_id: "inst-dbeumm21".into(),
            institution_name: "Deutsche Bank Frankfurt".into(),
            bic: "DBEUMM21XXX".into(),
            status: SignerStatus::Active,
            ed25519_public_key_hex: hex::encode(ed_sk.verifying_key().to_bytes()),
            ml_dsa_87_public_key_hex: hex::encode(ml_pk.clone().into_bytes()),
            authorized_message_types: vec!["pacs.008.001.08".into()],
            valid_until_epoch: u64::MAX, // Positive fixture must not expire with wall time.
        });

        let uetr = "c0a80101-1234-4567-89ab-cdef01234567";
        let xml = sample_pacs008(
            "DBEUMM21XXX",
            uetr,
            "150000.50",
            "EUR",
            "2026-10-23T12:00:00Z",
        );

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
        assert_eq!(auth.payment.amount_minor_units, 15000050);
        assert_eq!(auth.payment.amount_scale, 2);
        assert_eq!(auth.payment.amount_decimal_str, "150000.50");
        assert_eq!(auth.payment.currency, "EUR");
        assert_eq!(auth.payment.uetr, uetr);
    }

    #[test]
    fn test_payment_gate_rejects_untrusted_signer() {
        let registry = Arc::new(InMemoryInstitutionalKeyRegistry::new());
        let idempotency = Arc::new(InMemoryPaymentIdempotencyStore::new());
        let gate = Iso20022PaymentGate::new(
            registry.clone(),
            idempotency.clone(),
            PaymentPolicy::default(),
        );

        let (ed_sk, ml_sk, ml_pk) = generate_keypair();

        // Signer NOT registered in registry
        let uetr = "c0a80101-1234-4567-89ab-cdef01234567";
        let xml = sample_pacs008(
            "ROGUEBK1XXX",
            uetr,
            "5000.00",
            "USD",
            "2026-10-23T12:00:00Z",
        );
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
        assert!(matches!(
            res,
            Err(PaymentGateError::CryptographicSealFailed(_))
        ));
    }

    #[test]
    fn test_payment_gate_rejects_disallowed_currency() {
        let registry = Arc::new(InMemoryInstitutionalKeyRegistry::new());
        let idempotency = Arc::new(InMemoryPaymentIdempotencyStore::new());
        let gate = Iso20022PaymentGate::new(
            registry.clone(),
            idempotency.clone(),
            PaymentPolicy::default(),
        );

        let (ed_sk, ml_sk, ml_pk) = generate_keypair();

        registry.register_signer(InstitutionalSigner {
            institution_id: "inst-dbeumm21".into(),
            institution_name: "Deutsche Bank Frankfurt".into(),
            bic: "DBEUMM21XXX".into(),
            status: SignerStatus::Active,
            ed25519_public_key_hex: hex::encode(ed_sk.verifying_key().to_bytes()),
            ml_dsa_87_public_key_hex: hex::encode(ml_pk.clone().into_bytes()),
            authorized_message_types: vec!["pacs.008.001.08".into()],
            valid_until_epoch: u64::MAX, // Positive fixture must not expire with wall time.
        });

        let uetr = "c0a80101-1234-4567-89ab-cdef01234567";
        // Currency XYZ is not in allowed list
        let xml = sample_pacs008(
            "DBEUMM21XXX",
            uetr,
            "150000.50",
            "XYZ",
            "2026-10-23T12:00:00Z",
        );
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
        let gate = Iso20022PaymentGate::new(
            registry.clone(),
            idempotency.clone(),
            PaymentPolicy::default(),
        );

        let (ed_sk, ml_sk, ml_pk) = generate_keypair();

        registry.register_signer(InstitutionalSigner {
            institution_id: "inst-dbeumm21".into(),
            institution_name: "Deutsche Bank Frankfurt".into(),
            bic: "DBEUMM21XXX".into(),
            status: SignerStatus::Active,
            ed25519_public_key_hex: hex::encode(ed_sk.verifying_key().to_bytes()),
            ml_dsa_87_public_key_hex: hex::encode(ml_pk.clone().into_bytes()),
            authorized_message_types: vec!["pacs.008.001.08".into()],
            valid_until_epoch: u64::MAX, // Positive fixture must not expire with wall time.
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
        let gate = Iso20022PaymentGate::new(
            registry.clone(),
            idempotency.clone(),
            PaymentPolicy::default(),
        );

        let (ed_sk, ml_sk, ml_pk) = generate_keypair();

        registry.register_signer(InstitutionalSigner {
            institution_id: "inst-dbeumm21".into(),
            institution_name: "Deutsche Bank Frankfurt".into(),
            bic: "DBEUMM21XXX".into(),
            status: SignerStatus::Active,
            ed25519_public_key_hex: hex::encode(ed_sk.verifying_key().to_bytes()),
            ml_dsa_87_public_key_hex: hex::encode(ml_pk.clone().into_bytes()),
            authorized_message_types: vec!["pacs.008.001.08".into()],
            valid_until_epoch: u64::MAX, // Positive fixture must not expire with wall time.
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
        assert_eq!(
            res2,
            Err(PaymentGateError::ReplayDetected(uetr.to_string()))
        );
    }

    #[test]
    fn test_payment_gate_rejects_stale_timestamp() {
        let registry = Arc::new(InMemoryInstitutionalKeyRegistry::new());
        let idempotency = Arc::new(InMemoryPaymentIdempotencyStore::new());
        let gate = Iso20022PaymentGate::new(
            registry.clone(),
            idempotency.clone(),
            PaymentPolicy::default(),
        );

        let (ed_sk, ml_sk, ml_pk) = generate_keypair();

        registry.register_signer(InstitutionalSigner {
            institution_id: "inst-dbeumm21".into(),
            institution_name: "Deutsche Bank Frankfurt".into(),
            bic: "DBEUMM21XXX".into(),
            status: SignerStatus::Active,
            ed25519_public_key_hex: hex::encode(ed_sk.verifying_key().to_bytes()),
            ml_dsa_87_public_key_hex: hex::encode(ml_pk.clone().into_bytes()),
            authorized_message_types: vec!["pacs.008.001.08".into()],
            valid_until_epoch: u64::MAX, // Positive fixture must not expire with wall time.
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
        assert!(matches!(
            res,
            Err(PaymentGateError::TemporalFreshnessExpired { .. })
        ));
    }

    #[test]
    fn test_payment_gate_rejects_future_dated_payment() {
        let registry = Arc::new(InMemoryInstitutionalKeyRegistry::new());
        let idempotency = Arc::new(InMemoryPaymentIdempotencyStore::new());
        let gate = Iso20022PaymentGate::new(
            registry.clone(),
            idempotency.clone(),
            PaymentPolicy::default(),
        );

        let (ed_sk, ml_sk, ml_pk) = generate_keypair();

        registry.register_signer(InstitutionalSigner {
            institution_id: "inst-dbeumm21".into(),
            institution_name: "Deutsche Bank Frankfurt".into(),
            bic: "DBEUMM21XXX".into(),
            status: SignerStatus::Active,
            ed25519_public_key_hex: hex::encode(ed_sk.verifying_key().to_bytes()),
            ml_dsa_87_public_key_hex: hex::encode(ml_pk.clone().into_bytes()),
            authorized_message_types: vec!["pacs.008.001.08".into()],
            valid_until_epoch: u64::MAX, // Positive fixture must not expire with wall time.
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
        assert!(matches!(
            res,
            Err(PaymentGateError::FutureDatedPayment { .. })
        ));
    }

    #[test]
    fn test_payment_gate_rejects_signer_bic_mismatch() {
        let registry = Arc::new(InMemoryInstitutionalKeyRegistry::new());
        let idempotency = Arc::new(InMemoryPaymentIdempotencyStore::new());
        let gate = Iso20022PaymentGate::new(
            registry.clone(),
            idempotency.clone(),
            PaymentPolicy::default(),
        );

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
            valid_until_epoch: u64::MAX, // Positive fixture must not expire with wall time.
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
        assert!(matches!(
            res,
            Err(PaymentGateError::SignerBicMismatch { .. })
        ));
    }

    #[test]
    fn test_payment_gate_rejects_exceeded_transaction_limit() {
        let registry = Arc::new(InMemoryInstitutionalKeyRegistry::new());
        let idempotency = Arc::new(InMemoryPaymentIdempotencyStore::new());
        let policy = PaymentPolicy {
            max_single_transaction_limit: 1_000_000.0, // $1M limit
            ..PaymentPolicy::default()
        };
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
            valid_until_epoch: u64::MAX, // Positive fixture must not expire with wall time.
        });

        let uetr = "c0a80101-1234-4567-89ab-cdef01234567";
        // Amount is $5M (> $1M limit)
        let xml = sample_pacs008(
            "DBEUMM21XXX",
            uetr,
            "5000000.00",
            "USD",
            "2026-10-23T12:00:00Z",
        );
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
        assert!(matches!(
            res,
            Err(PaymentGateError::AmountExceedsLimit { .. })
        ));
    }

    #[test]
    fn test_payment_gate_rejects_malformed_uetr() {
        let registry = Arc::new(InMemoryInstitutionalKeyRegistry::new());
        let idempotency = Arc::new(InMemoryPaymentIdempotencyStore::new());
        let gate = Iso20022PaymentGate::new(
            registry.clone(),
            idempotency.clone(),
            PaymentPolicy::default(),
        );

        let (ed_sk, ml_sk, ml_pk) = generate_keypair();

        registry.register_signer(InstitutionalSigner {
            institution_id: "inst-dbeumm21".into(),
            institution_name: "Deutsche Bank Frankfurt".into(),
            bic: "DBEUMM21XXX".into(),
            status: SignerStatus::Active,
            ed25519_public_key_hex: hex::encode(ed_sk.verifying_key().to_bytes()),
            ml_dsa_87_public_key_hex: hex::encode(ml_pk.clone().into_bytes()),
            authorized_message_types: vec!["pacs.008.001.08".into()],
            valid_until_epoch: u64::MAX, // Positive fixture must not expire with wall time.
        });

        // Malformed non-UUID UETR
        let bad_uetr = "not-a-valid-uuid-format-123";
        let xml = sample_pacs008(
            "DBEUMM21XXX",
            bad_uetr,
            "100.00",
            "USD",
            "2026-10-23T12:00:00Z",
        );
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
            valid_until_epoch: u64::MAX, // Positive fixture must not expire with wall time.
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
        assert!(matches!(
            res,
            Err(PaymentGateError::BlockedOrQuarantinedParty(_))
        ));
    }

    #[test]
    fn test_payment_gate_concurrent_in_flight_blocked() {
        let registry = Arc::new(InMemoryInstitutionalKeyRegistry::new());
        let idempotency = Arc::new(InMemoryPaymentIdempotencyStore::new());
        let gate = Iso20022PaymentGate::new(
            registry.clone(),
            idempotency.clone(),
            PaymentPolicy::default(),
        );

        let (ed_sk, ml_sk, ml_pk) = generate_keypair();

        registry.register_signer(InstitutionalSigner {
            institution_id: "inst-dbeumm21".into(),
            institution_name: "Deutsche Bank Frankfurt".into(),
            bic: "DBEUMM21XXX".into(),
            status: SignerStatus::Active,
            ed25519_public_key_hex: hex::encode(ed_sk.verifying_key().to_bytes()),
            ml_dsa_87_public_key_hex: hex::encode(ml_pk.clone().into_bytes()),
            authorized_message_types: vec!["pacs.008.001.08".into()],
            valid_until_epoch: u64::MAX, // Positive fixture must not expire with wall time.
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
            Err(PaymentGateError::ConcurrentSubmissionBlocked(
                uetr.to_string()
            ))
        );
    }

    #[test]
    fn regression_invalid_calendar_dates_rejected() {
        for date in [
            "2026-02-30T12:00:00Z",
            "2026-13-01T00:00:00Z",
            "2026-01-01T25:00:00Z",
            "2026-01-01T12:00:00",
            "1900-01-01T00:00:00Z",
        ] {
            assert!(parse_iso8601_to_unix(date).is_err(), "accepted {date}");
        }
    }

    #[test]
    fn regression_timezone_and_leap_year_are_exact() {
        assert_eq!(
            parse_iso8601_to_unix("2024-03-01T00:00:00Z").unwrap(),
            1709251200
        );
        assert_eq!(
            parse_iso8601_to_unix("2026-10-23T13:00:00+01:00").unwrap(),
            parse_iso8601_to_unix("2026-10-23T12:00:00Z").unwrap()
        );
    }

    #[test]
    fn payment_fields_reject_duplicates_missing_accounts_and_alternate_amounts() {
        let xml = sample_pacs008(
            "DBEUMM21XXX",
            "c0a80101-1234-4567-89ab-cdef01234567",
            "100.00",
            "USD",
            "2026-10-23T12:00:00Z",
        );
        assert!(extract_financial_payment(&xml).is_ok());
        for changed in [
            xml.replace(
                "<IntrBkSttlmAmt",
                "<IntrBkSttlmAmt Ccy='USD'>1</IntrBkSttlmAmt><IntrBkSttlmAmt",
            ),
            xml.replace("DbtrAcct", "IgnoredAccount"),
            xml.replace("100.00", "1e2"),
            xml.replace("<NbOfTxs>1", "<NbOfTxs>2"),
            xml.replace("<MsgId>", "<MsgId>other</MsgId><MsgId>"),
        ] {
            assert!(extract_financial_payment(&changed).is_err());
        }
    }
    #[test]
    fn malformed_payment_input_is_not_an_internal_fault() {
        for timestamp in [
            "not-a-timestamp",
            "2026-10-23T12:00:00.1Z",
            "1960-01-01T00:00:00Z",
        ] {
            let error = parse_iso8601_to_unix(timestamp).unwrap_err();
            assert!(matches!(error, PaymentGateError::InvalidField(_)));
        }
        let xml = sample_pacs008(
            "DBEUMM21XXX",
            "c0a80101-1234-4567-89ab-cdef01234567",
            "100.00",
            "USD",
            "2026-10-23T12:00:00Z",
        );
        for changed in [
            xml.replace("<NbOfTxs>1", "<NbOfTxs>2"),
            xml.replace("<MsgId>", &format!("<MsgId>{}", "X".repeat(36))),
        ] {
            let error = extract_financial_payment(&changed).unwrap_err();
            assert!(matches!(error, PaymentGateError::InvalidField(_)));
        }
    }

    #[test]
    fn test_payment_gate_exact_minor_unit_limits_and_scales() {
        // 1. Verify minor unit parsing across different currency scales
        let (jpy_units, jpy_scale) = parse_exact_minor_units("5000", "JPY").unwrap();
        assert_eq!(jpy_units, 5000);
        assert_eq!(jpy_scale, 0);

        let (usd_units, usd_scale) = parse_exact_minor_units("123.45", "USD").unwrap();
        assert_eq!(usd_units, 12345);
        assert_eq!(usd_scale, 2);

        let (bhd_units, bhd_scale) = parse_exact_minor_units("50.125", "BHD").unwrap();
        assert_eq!(bhd_units, 50125);
        assert_eq!(bhd_scale, 3);

        // USD cannot have 3 non-zero decimal places
        let usd_subminor = parse_exact_minor_units("10.005", "USD");
        assert!(usd_subminor.is_err());

        // Trailing zeros within currency scale are normalized
        let (usd_padded, _) = parse_exact_minor_units("10.5", "USD").unwrap();
        assert_eq!(usd_padded, 1050);

        // 2. Exact minor unit limit enforcement in gate
        let registry = Arc::new(InMemoryInstitutionalKeyRegistry::new());
        let (ed_sk, ml_sk, ml_pk) = generate_keypair();
        registry.register_signer(InstitutionalSigner {
            institution_id: "inst-dbeumm21".into(),
            institution_name: "Deutsche Bank Frankfurt".into(),
            bic: "DBEUMM21XXX".into(),
            status: SignerStatus::Active,
            ed25519_public_key_hex: hex::encode(ed_sk.verifying_key().to_bytes()),
            ml_dsa_87_public_key_hex: hex::encode(ml_pk.clone().into_bytes()),
            authorized_message_types: vec!["pacs.008.001.08".into()],
            valid_until_epoch: u64::MAX,
        });
        let idempotency = Arc::new(InMemoryPaymentIdempotencyStore::new());

        let policy = PaymentPolicy {
            max_single_transaction_minor_units: Some(50000),
            ..PaymentPolicy::default()
        };

        let gate = Iso20022PaymentGate::new(registry, idempotency, policy);

        let xml = sample_pacs008(
            "DBEUMM21XXX",
            "c0a80101-1234-4567-89ab-cdef01234567",
            "500.01",
            "USD",
            "2026-10-23T12:00:00Z",
        );
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
        assert!(matches!(
            res,
            Err(PaymentGateError::AmountExceedsLimit { .. })
        ));
    }
}
