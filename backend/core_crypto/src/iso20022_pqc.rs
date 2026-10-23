//! # SWIFT ISO 20022 Post-Quantum Supplementary Data Transformer
//!
//! Dual-signature (ML-DSA-87 + Ed25519) cryptographic seals embedded into the
//! standard ISO 20022 `<SplmtryData>` element according to financial schemas.
//!
//! Incorporates:
//! - Institutional Key Registry authentication preventing key-substitution attacks
//! - Schema-compliant supplementary data placement inside message roots (`FIToFICstmrCdtTrf`, `FICdtTrf`, etc.)
//! - Robust namespace-aware canonical XML payment body extraction

use std::collections::HashMap;
use std::sync::RwLock;

use ed25519_dalek::{
    Signer as EdSigner, SigningKey as EdSigningKey, Verifier as EdVerifier,
    VerifyingKey as EdVerifyingKey,
};
use fips204::ml_dsa_87;
use fips204::traits::{SerDes, Signer as PqSigner, Verifier as PqVerifier};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum Iso20022Error {
    #[error("Malformed ISO 20022 XML structure: {0}")]
    MalformedXml(String),
    #[error("Missing payment instruction body (<CdtTrfTxInf> or <GrpHdr>)")]
    MissingTransactionBody,
    #[error("Missing Vardhan PQC seal in Supplementary Data envelope")]
    MissingPqcSeal,
    #[error("Classical Ed25519 signature verification failed")]
    Ed25519VerificationFailed,
    #[error("Post-Quantum ML-DSA-87 signature verification failed")]
    MlDsa87VerificationFailed,
    #[error("Payload digest mismatch (payload altered or tampered)")]
    DigestMismatch,
    #[error("Untrusted signer identity: BIC '{0}' is not registered in institutional key registry")]
    UntrustedSignerIdentity(String),
    #[error("Signer key not active for BIC '{0}'")]
    SignerKeyNotActive(String),
    #[error("Signer '{0}' is not authorized for message type '{1}'")]
    UnauthorizedMessageType(String, String),
    #[error("Public key substitution detected: presented key does not match trusted registry for BIC '{0}'")]
    KeySubstitutionDetected(String),
    #[error("Schema validation failed: {0}")]
    SchemaValidationFailed(String),
}

/// Operational status of an institutional signer in the trusted key registry.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum SignerStatus {
    Active,
    Suspended,
    Revoked,
}

/// An authorized financial institution registered with verified cryptographic keys.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct InstitutionalSigner {
    pub institution_id: String,
    pub institution_name: String,
    pub bic: String,
    pub status: SignerStatus,
    pub ed25519_public_key_hex: String,
    pub ml_dsa_87_public_key_hex: String,
    pub authorized_message_types: Vec<String>,
    pub valid_until_epoch: u64,
}

/// Registry interface for validating institutional signer identities and public keys.
pub trait InstitutionalKeyRegistry: Send + Sync {
    fn get_signer_by_bic(&self, bic: &str) -> Option<InstitutionalSigner>;

    fn validate_signer_keys(
        &self,
        bic: &str,
        message_type: &str,
        presented_ed25519_hex: &str,
        presented_ml_dsa_hex: &str,
    ) -> Result<InstitutionalSigner, Iso20022Error> {
        let signer = self
            .get_signer_by_bic(bic)
            .ok_or_else(|| Iso20022Error::UntrustedSignerIdentity(bic.to_string()))?;

        if signer.status != SignerStatus::Active {
            return Err(Iso20022Error::SignerKeyNotActive(bic.to_string()));
        }

        if !signer
            .authorized_message_types
            .iter()
            .any(|t| t == message_type || t == "*")
        {
            return Err(Iso20022Error::UnauthorizedMessageType(
                bic.to_string(),
                message_type.to_string(),
            ));
        }

        if !signer
            .ed25519_public_key_hex
            .eq_ignore_ascii_case(presented_ed25519_hex)
        {
            return Err(Iso20022Error::KeySubstitutionDetected(format!(
                "Ed25519 public key does not match trusted key for {}",
                bic
            )));
        }

        if !signer
            .ml_dsa_87_public_key_hex
            .eq_ignore_ascii_case(presented_ml_dsa_hex)
        {
            return Err(Iso20022Error::KeySubstitutionDetected(format!(
                "ML-DSA-87 public key does not match trusted key for {}",
                bic
            )));
        }

        Ok(signer)
    }
}

/// Thread-safe in-memory institutional key registry.
pub struct InMemoryInstitutionalKeyRegistry {
    signers: RwLock<HashMap<String, InstitutionalSigner>>,
}

impl InMemoryInstitutionalKeyRegistry {
    pub fn new() -> Self {
        Self {
            signers: RwLock::new(HashMap::new()),
        }
    }

    pub fn register_signer(&self, signer: InstitutionalSigner) {
        let mut map = self.signers.write().unwrap();
        map.insert(signer.bic.to_uppercase(), signer);
    }

    pub fn set_signer_status(&self, bic: &str, status: SignerStatus) -> bool {
        let mut map = self.signers.write().unwrap();
        if let Some(s) = map.get_mut(&bic.to_uppercase()) {
            s.status = status;
            true
        } else {
            false
        }
    }
}

impl Default for InMemoryInstitutionalKeyRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl InstitutionalKeyRegistry for InMemoryInstitutionalKeyRegistry {
    fn get_signer_by_bic(&self, bic: &str) -> Option<InstitutionalSigner> {
        let map = self.signers.read().unwrap();
        map.get(&bic.to_uppercase()).cloned()
    }
}

/// The Post-Quantum cryptographic seal embedded inside ISO 20022 `<SplmtryData>`.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Iso20022PqcSeal {
    pub algorithm_classical: String,
    pub algorithm_pqc: String,
    pub signer_bic: String,
    pub key_id: String,
    pub message_type: String,
    pub payload_digest_blake3: String,
    pub ed25519_signature_hex: String,
    pub ed25519_public_key_hex: String,
    pub ml_dsa_87_signature_hex: String,
    pub ml_dsa_87_public_key_hex: String,
    pub epoch_timestamp: u64,
}

/// Verification result that binds the validated institutional identity to the payment message.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct AuthenticatedPaymentSeal {
    pub seal: Iso20022PqcSeal,
    pub authenticated_institution: InstitutionalSigner,
    pub canonical_payload_digest: String,
    pub verified_at_epoch: u64,
}

/// Helper to find tags regardless of namespace prefixes (e.g. `<GrpHdr>` or `<doc:GrpHdr>`).
fn find_tag_boundary(xml: &str, local_name: &str, is_closing: bool) -> Option<usize> {
    let mut search_idx = 0;
    while let Some(rel_open) = xml[search_idx..].find('<') {
        let start = search_idx + rel_open;
        if let Some(rel_close) = xml[start..].find('>') {
            let end = start + rel_close;
            let tag_content = &xml[start + 1..end].trim();

            let matches = if is_closing {
                if let Some(stripped) = tag_content.strip_prefix('/') {
                    let name = stripped.split_whitespace().next().unwrap_or("");
                    name == local_name || name.ends_with(&format!(":{}", local_name))
                } else {
                    false
                }
            } else {
                if !tag_content.starts_with('/') && !tag_content.starts_with('?') && !tag_content.starts_with('!') {
                    let name = tag_content.split_whitespace().next().unwrap_or("");
                    let name = name.trim_end_matches('/');
                    name == local_name || name.ends_with(&format!(":{}", local_name))
                } else {
                    false
                }
            };

            if matches {
                return Some(if is_closing { end + 1 } else { start });
            }
            search_idx = end + 1;
        } else {
            break;
        }
    }
    None
}

/// Reverse search for a closing tag regardless of namespace prefixes.
fn rfind_closing_tag_boundary(xml: &str, local_name: &str) -> Option<(usize, usize)> {
    let mut last_match = None;
    let mut search_idx = 0;
    while let Some(rel_open) = xml[search_idx..].find('<') {
        let start = search_idx + rel_open;
        if let Some(rel_close) = xml[start..].find('>') {
            let end = start + rel_close;
            let tag_content = &xml[start + 1..end].trim();

            if let Some(stripped) = tag_content.strip_prefix('/') {
                let name = stripped.split_whitespace().next().unwrap_or("");
                if name == local_name || name.ends_with(&format!(":{}", local_name)) {
                    last_match = Some((start, end + 1));
                }
            }
            search_idx = end + 1;
        } else {
            break;
        }
    }
    last_match
}

/// Extracts the canonical signable body from an ISO 20022 document.
/// Accurately extracts business content across namespace-prefixed documents.
pub fn extract_canonical_payment_body(xml: &str) -> Result<String, Iso20022Error> {
    let start_idx = find_tag_boundary(xml, "GrpHdr", false)
        .or_else(|| find_tag_boundary(xml, "CdtTrfTxInf", false))
        .ok_or(Iso20022Error::MissingTransactionBody)?;

    let end_idx = rfind_closing_tag_boundary(xml, "CdtTrfTxInf")
        .map(|(_, end)| end)
        .or_else(|| rfind_closing_tag_boundary(xml, "GrpHdr").map(|(_, end)| end))
        .ok_or(Iso20022Error::MissingTransactionBody)?;

    if end_idx <= start_idx {
        return Err(Iso20022Error::MalformedXml(
            "Transaction end precedes start".into(),
        ));
    }

    // Canonicalize by trimming whitespace between tags and normalizing line breaks
    let raw_content = &xml[start_idx..end_idx];
    let normalized = raw_content
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect::<Vec<&str>>()
        .join("\n");

    Ok(normalized)
}

/// Identifies the schema-defined message root element in an ISO 20022 XML document
/// and returns the insertion index right before the closing tag.
///
/// Supported ISO 20022 message roots:
/// - `FIToFICstmrCdtTrf` (pacs.008 customer credit transfer)
/// - `FICdtTrf` (pacs.009 financial institution credit transfer)
/// - `BkToCstmrStmt` (camt.053 bank-to-customer statement)
/// - `FIToFIPmtStsRpt` (pacs.002 payment status report)
fn find_schema_compliant_insertion_point(xml: &str) -> Option<(usize, &'static str)> {
    const MESSAGE_ROOTS: [&str; 4] = [
        "FIToFICstmrCdtTrf",
        "FICdtTrf",
        "BkToCstmrStmt",
        "FIToFIPmtStsRpt",
    ];

    for root in MESSAGE_ROOTS {
        if let Some((start, _)) = rfind_closing_tag_boundary(xml, root) {
            return Some((start, root));
        }
    }

    // Fallback: before </Document> if no specific message root is recognized
    rfind_closing_tag_boundary(xml, "Document").map(|(start, _)| (start, "Document"))
}

/// Signs an ISO 20022 XML document and embeds a dual PQC seal into `<SplmtryData>`
/// strictly inside the message root element according to official ISO 20022 XSD definitions.
pub fn embed_pqc_seal_into_iso20022(
    original_xml: &str,
    signer_bic: &str,
    key_id: &str,
    message_type: &str,
    ed_signing_key: &EdSigningKey,
    ml_dsa_private_key: &ml_dsa_87::PrivateKey,
    ml_dsa_public_key: &ml_dsa_87::PublicKey,
    timestamp: u64,
) -> Result<String, Iso20022Error> {
    let canonical_body = extract_canonical_payment_body(original_xml)?;
    let digest = blake3::hash(canonical_body.as_bytes());
    let digest_hex = digest.to_hex().to_string();

    // 1. Classical signature (Ed25519)
    let ed_sig = ed_signing_key.sign(digest.as_bytes());
    let ed_sig_hex = hex::encode(ed_sig.to_bytes());
    let ed_pk_hex = hex::encode(ed_signing_key.verifying_key().to_bytes());

    // 2. Post-Quantum signature (ML-DSA-87 / FIPS 204)
    let ml_sig = ml_dsa_private_key
        .try_sign(digest.as_bytes(), &[])
        .map_err(|_| Iso20022Error::MlDsa87VerificationFailed)?;
    let ml_sig_hex = hex::encode(ml_sig);
    let ml_pk_hex = hex::encode(ml_dsa_public_key.clone().into_bytes());

    let seal = Iso20022PqcSeal {
        algorithm_classical: "Ed25519-RFC8032".into(),
        algorithm_pqc: "ML-DSA-87-FIPS204".into(),
        signer_bic: signer_bic.to_uppercase(),
        key_id: key_id.to_string(),
        message_type: message_type.to_string(),
        payload_digest_blake3: digest_hex,
        ed25519_signature_hex: ed_sig_hex,
        ed25519_public_key_hex: ed_pk_hex,
        ml_dsa_87_signature_hex: ml_sig_hex,
        ml_dsa_87_public_key_hex: ml_pk_hex,
        epoch_timestamp: timestamp,
    };

    let seal_json = serde_json::to_string(&seal)
        .map_err(|e| Iso20022Error::MalformedXml(format!("Failed to serialize seal: {}", e)))?;

    // Build standard ISO 20022 <SplmtryData> element
    let supplementary_data = format!(
        "\n    <SplmtryData>\n      <PlcAndNm>VARDHAN-QCORE-PQC-SEAL</PlcAndNm>\n      <Envlp>\n        <VardhanPqcSeal>{}</VardhanPqcSeal>\n      </Envlp>\n    </SplmtryData>\n  ",
        seal_json
    );

    // Locate the schema-compliant insertion point inside the message element
    if let Some((pos, _root_name)) = find_schema_compliant_insertion_point(original_xml) {
        let mut transformed = original_xml[..pos].trim_end().to_string();
        transformed.push_str(&supplementary_data);
        transformed.push_str(&original_xml[pos..]);
        Ok(transformed)
    } else {
        let mut transformed = original_xml.to_string();
        transformed.push_str(&supplementary_data);
        Ok(transformed)
    }
}

/// Authenticated verification of an ISO 20022 PQC seal against a trusted Institutional Key Registry.
///
/// This provides authentic non-repudiation:
/// 1. Verifies that the signer BIC is enrolled in the trusted institutional registry.
/// 2. Ensures the signer status is `Active` (rejects revoked or suspended signers).
/// 3. Confirms that the public keys in the seal match the trusted public keys registered for the institution.
/// 4. Cryptographically verifies both Ed25519 and ML-DSA-87 signatures using the TRUSTED keys.
pub fn verify_iso20022_pqc_seal_authenticated(
    sealed_xml: &str,
    registry: &dyn InstitutionalKeyRegistry,
) -> Result<AuthenticatedPaymentSeal, Iso20022Error> {
    // 1. Extract the PqcSeal JSON
    let start_tag = "<VardhanPqcSeal>";
    let end_tag = "</VardhanPqcSeal>";

    let start_idx = sealed_xml
        .find(start_tag)
        .ok_or(Iso20022Error::MissingPqcSeal)?
        + start_tag.len();
    let end_idx = sealed_xml
        .find(end_tag)
        .ok_or(Iso20022Error::MissingPqcSeal)?;

    let seal_json = &sealed_xml[start_idx..end_idx];
    let seal: Iso20022PqcSeal = serde_json::from_str(seal_json)
        .map_err(|e| Iso20022Error::MalformedXml(format!("Failed to parse PqcSeal JSON: {}", e)))?;

    // 2. Validate signer identity and public keys against the trusted registry
    let trusted_signer = registry.validate_signer_keys(
        &seal.signer_bic,
        &seal.message_type,
        &seal.ed25519_public_key_hex,
        &seal.ml_dsa_87_public_key_hex,
    )?;

    // 3. Compute canonical digest of the business message
    let canonical_body = extract_canonical_payment_body(sealed_xml)?;
    let computed_digest = blake3::hash(canonical_body.as_bytes());

    if computed_digest.to_hex().to_string() != seal.payload_digest_blake3 {
        return Err(Iso20022Error::DigestMismatch);
    }

    // 4. Verify classical signature (Ed25519) using trusted registered public key
    let ed_pk_bytes = hex::decode(&trusted_signer.ed25519_public_key_hex)
        .map_err(|_| Iso20022Error::Ed25519VerificationFailed)?;
    let ed_pk_array: [u8; 32] = ed_pk_bytes
        .try_into()
        .map_err(|_| Iso20022Error::Ed25519VerificationFailed)?;
    let ed_verifying_key = EdVerifyingKey::from_bytes(&ed_pk_array)
        .map_err(|_| Iso20022Error::Ed25519VerificationFailed)?;

    let ed_sig_bytes = hex::decode(&seal.ed25519_signature_hex)
        .map_err(|_| Iso20022Error::Ed25519VerificationFailed)?;
    let ed_sig_array: [u8; 64] = ed_sig_bytes
        .try_into()
        .map_err(|_| Iso20022Error::Ed25519VerificationFailed)?;
    let ed_sig = ed25519_dalek::Signature::from_bytes(&ed_sig_array);

    ed_verifying_key
        .verify(computed_digest.as_bytes(), &ed_sig)
        .map_err(|_| Iso20022Error::Ed25519VerificationFailed)?;

    // 5. Verify post-quantum signature (ML-DSA-87) using trusted registered public key
    let ml_pk_bytes = hex::decode(&trusted_signer.ml_dsa_87_public_key_hex)
        .map_err(|_| Iso20022Error::MlDsa87VerificationFailed)?;
    let ml_pk_array: [u8; ml_dsa_87::PK_LEN] = ml_pk_bytes
        .try_into()
        .map_err(|_| Iso20022Error::MlDsa87VerificationFailed)?;
    let ml_public_key = ml_dsa_87::PublicKey::try_from_bytes(ml_pk_array)
        .map_err(|_| Iso20022Error::MlDsa87VerificationFailed)?;

    let ml_sig_bytes = hex::decode(&seal.ml_dsa_87_signature_hex)
        .map_err(|_| Iso20022Error::MlDsa87VerificationFailed)?;
    let ml_sig_array: [u8; ml_dsa_87::SIG_LEN] = ml_sig_bytes
        .try_into()
        .map_err(|_| Iso20022Error::MlDsa87VerificationFailed)?;

    if !ml_public_key.verify(computed_digest.as_bytes(), &ml_sig_array, &[]) {
        return Err(Iso20022Error::MlDsa87VerificationFailed);
    }

    Ok(AuthenticatedPaymentSeal {
        seal,
        authenticated_institution: trusted_signer,
        canonical_payload_digest: computed_digest.to_hex().to_string(),
        verified_at_epoch: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
    })
}

/// Verifies internal cryptographic consistency of an ISO 20022 XML document.
///
/// NOTE: In production payment workflows, always prefer [`verify_iso20022_pqc_seal_authenticated`]
/// to ensure public keys are bound to a verified institutional identity.
pub fn verify_iso20022_pqc_seal(sealed_xml: &str) -> Result<Iso20022PqcSeal, Iso20022Error> {
    let start_tag = "<VardhanPqcSeal>";
    let end_tag = "</VardhanPqcSeal>";

    let start_idx = sealed_xml
        .find(start_tag)
        .ok_or(Iso20022Error::MissingPqcSeal)?
        + start_tag.len();
    let end_idx = sealed_xml
        .find(end_tag)
        .ok_or(Iso20022Error::MissingPqcSeal)?;

    let seal_json = &sealed_xml[start_idx..end_idx];
    let seal: Iso20022PqcSeal = serde_json::from_str(seal_json)
        .map_err(|e| Iso20022Error::MalformedXml(format!("Failed to parse PqcSeal JSON: {}", e)))?;

    let canonical_body = extract_canonical_payment_body(sealed_xml)?;
    let computed_digest = blake3::hash(canonical_body.as_bytes());

    if computed_digest.to_hex().to_string() != seal.payload_digest_blake3 {
        return Err(Iso20022Error::DigestMismatch);
    }

    let ed_pk_bytes = hex::decode(&seal.ed25519_public_key_hex)
        .map_err(|_| Iso20022Error::Ed25519VerificationFailed)?;
    let ed_pk_array: [u8; 32] = ed_pk_bytes
        .try_into()
        .map_err(|_| Iso20022Error::Ed25519VerificationFailed)?;
    let ed_verifying_key = EdVerifyingKey::from_bytes(&ed_pk_array)
        .map_err(|_| Iso20022Error::Ed25519VerificationFailed)?;

    let ed_sig_bytes = hex::decode(&seal.ed25519_signature_hex)
        .map_err(|_| Iso20022Error::Ed25519VerificationFailed)?;
    let ed_sig_array: [u8; 64] = ed_sig_bytes
        .try_into()
        .map_err(|_| Iso20022Error::Ed25519VerificationFailed)?;
    let ed_sig = ed25519_dalek::Signature::from_bytes(&ed_sig_array);

    ed_verifying_key
        .verify(computed_digest.as_bytes(), &ed_sig)
        .map_err(|_| Iso20022Error::Ed25519VerificationFailed)?;

    let ml_pk_bytes = hex::decode(&seal.ml_dsa_87_public_key_hex)
        .map_err(|_| Iso20022Error::MlDsa87VerificationFailed)?;
    let ml_pk_array: [u8; ml_dsa_87::PK_LEN] = ml_pk_bytes
        .try_into()
        .map_err(|_| Iso20022Error::MlDsa87VerificationFailed)?;
    let ml_public_key = ml_dsa_87::PublicKey::try_from_bytes(ml_pk_array)
        .map_err(|_| Iso20022Error::MlDsa87VerificationFailed)?;

    let ml_sig_bytes = hex::decode(&seal.ml_dsa_87_signature_hex)
        .map_err(|_| Iso20022Error::MlDsa87VerificationFailed)?;
    let ml_sig_array: [u8; ml_dsa_87::SIG_LEN] = ml_sig_bytes
        .try_into()
        .map_err(|_| Iso20022Error::MlDsa87VerificationFailed)?;

    if !ml_public_key.verify(computed_digest.as_bytes(), &ml_sig_array, &[]) {
        return Err(Iso20022Error::MlDsa87VerificationFailed);
    }

    Ok(seal)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::rngs::OsRng;
    use rand::RngCore;

    const SAMPLE_PACS008_XML: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08">
  <FIToFICstmrCdtTrf>
    <GrpHdr>
      <MsgId>VARDHAN-SWIFT-20261018-001</MsgId>
      <CreDtTm>2026-10-18T04:20:00Z</CreDtTm>
      <NbOfTxs>1</NbOfTxs>
    </GrpHdr>
    <CdtTrfTxInf>
      <PmtId>
        <EndToEndId>E2E-BARCLAYS-TO-HSBC-999</EndToEndId>
      </PmtId>
      <IntrBkSttlmAmt Ccy="GBP">5000000.00</IntrBkSttlmAmt>
      <Dbtr>
        <Nm>ACME Global Treasury</Nm>
      </Dbtr>
      <Cdtr>
        <Nm>Vardhan Sovereign Custody</Nm>
      </Cdtr>
    </CdtTrfTxInf>
  </FIToFICstmrCdtTrf>
</Document>"#;

    const NAMESPACED_PACS008_XML: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<pacs:Document xmlns:pacs="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08">
  <pacs:FIToFICstmrCdtTrf>
    <pacs:GrpHdr>
      <pacs:MsgId>VARDHAN-SWIFT-20261023-002</pacs:MsgId>
      <pacs:CreDtTm>2026-10-23T10:00:00Z</pacs:CreDtTm>
      <pacs:NbOfTxs>1</pacs:NbOfTxs>
    </pacs:GrpHdr>
    <pacs:CdtTrfTxInf>
      <pacs:PmtId>
        <pacs:EndToEndId>E2E-CHASE-TO-STANCHAR-001</pacs:EndToEndId>
      </pacs:PmtId>
      <pacs:IntrBkSttlmAmt Ccy="USD">12500000.00</pacs:IntrBkSttlmAmt>
      <pacs:Dbtr>
        <pacs:Nm>Global Tech Settlement</pacs:Nm>
      </pacs:Dbtr>
      <pacs:Cdtr>
        <pacs:Nm>Sovereign Capital Clearing</pacs:Nm>
      </pacs:Cdtr>
    </pacs:CdtTrfTxInf>
  </pacs:FIToFICstmrCdtTrf>
</pacs:Document>"#;

    fn generate_keypair() -> (EdSigningKey, ml_dsa_87::PrivateKey, ml_dsa_87::PublicKey) {
        let mut seed = [0u8; 32];
        OsRng.fill_bytes(&mut seed);
        let ed_sk = EdSigningKey::from_bytes(&seed);
        let (ml_pk, ml_sk) = ml_dsa_87::try_keygen().unwrap();
        (ed_sk, ml_sk, ml_pk)
    }

    #[test]
    fn test_schema_compliant_supplementary_data_placement() {
        let (ed_sk, ml_sk, ml_pk) = generate_keypair();

        let sealed_xml = embed_pqc_seal_into_iso20022(
            SAMPLE_PACS008_XML,
            "BARCGB22",
            "key-2026-qcore-01",
            "pacs.008.001.08",
            &ed_sk,
            &ml_sk,
            &ml_pk,
            1792345000,
        )
        .unwrap();

        // Finding 2 fix: Verify <SplmtryData> is placed INSIDE <FIToFICstmrCdtTrf>
        // and precedes </FIToFICstmrCdtTrf>, NOT directly under </Document>
        let splmtry_pos = sealed_xml.find("<SplmtryData>").unwrap();
        let message_close_pos = sealed_xml.find("</FIToFICstmrCdtTrf>").unwrap();
        let doc_close_pos = sealed_xml.find("</Document>").unwrap();

        assert!(
            splmtry_pos < message_close_pos,
            "<SplmtryData> must be inside <FIToFICstmrCdtTrf>"
        );
        assert!(
            message_close_pos < doc_close_pos,
            "</FIToFICstmrCdtTrf> must precede </Document>"
        );
    }

    #[test]
    fn test_authenticated_signer_identity_verification() {
        let (ed_sk, ml_sk, ml_pk) = generate_keypair();
        let registry = InMemoryInstitutionalKeyRegistry::new();

        let ed_pk_hex = hex::encode(ed_sk.verifying_key().to_bytes());
        let ml_pk_hex = hex::encode(ml_pk.clone().into_bytes());

        registry.register_signer(InstitutionalSigner {
            institution_id: "INST-BARCLAYS-UK".into(),
            institution_name: "Barclays Bank PLC".into(),
            bic: "BARCGB22".into(),
            status: SignerStatus::Active,
            ed25519_public_key_hex: ed_pk_hex,
            ml_dsa_87_public_key_hex: ml_pk_hex,
            authorized_message_types: vec!["pacs.008.001.08".into()],
            valid_until_epoch: 1900000000,
        });

        let sealed_xml = embed_pqc_seal_into_iso20022(
            SAMPLE_PACS008_XML,
            "BARCGB22",
            "key-2026-qcore-01",
            "pacs.008.001.08",
            &ed_sk,
            &ml_sk,
            &ml_pk,
            1792345000,
        )
        .unwrap();

        let auth_seal =
            verify_iso20022_pqc_seal_authenticated(&sealed_xml, &registry).unwrap();
        assert_eq!(auth_seal.authenticated_institution.bic, "BARCGB22");
        assert_eq!(
            auth_seal.authenticated_institution.institution_name,
            "Barclays Bank PLC"
        );
        assert_eq!(auth_seal.seal.signer_bic, "BARCGB22");
    }

    #[test]
    fn test_attacker_key_substitution_rejected() {
        // Legitimate bank keys registered in registry
        let (legit_ed_sk, _legit_ml_sk, legit_ml_pk) = generate_keypair();
        let registry = InMemoryInstitutionalKeyRegistry::new();

        registry.register_signer(InstitutionalSigner {
            institution_id: "INST-HSBC-UK".into(),
            institution_name: "HSBC Bank UK".into(),
            bic: "HBUKGB4B".into(),
            status: SignerStatus::Active,
            ed25519_public_key_hex: hex::encode(legit_ed_sk.verifying_key().to_bytes()),
            ml_dsa_87_public_key_hex: hex::encode(legit_ml_pk.into_bytes()),
            authorized_message_types: vec!["pacs.008.001.08".into()],
            valid_until_epoch: 1900000000,
        });

        // Attacker generates own rogue keys and claims to be HSBC
        let (rogue_ed_sk, rogue_ml_sk, rogue_ml_pk) = generate_keypair();
        let rogue_sealed_xml = embed_pqc_seal_into_iso20022(
            SAMPLE_PACS008_XML,
            "HBUKGB4B",
            "key-rogue-01",
            "pacs.008.001.08",
            &rogue_ed_sk,
            &rogue_ml_sk,
            &rogue_ml_pk,
            1792345000,
        )
        .unwrap();

        // Finding 1 fix: Must be rejected fail-closed because public keys in the envelope
        // do not match the trusted institutional registry for HBUKGB4B!
        let err = verify_iso20022_pqc_seal_authenticated(&rogue_sealed_xml, &registry).unwrap_err();
        match err {
            Iso20022Error::KeySubstitutionDetected(msg) => {
                assert!(msg.contains("does not match trusted key for HBUKGB4B"));
            }
            other => panic!("Expected KeySubstitutionDetected, got {:?}", other),
        }
    }

    #[test]
    fn test_untrusted_institution_rejected() {
        let (ed_sk, ml_sk, ml_pk) = generate_keypair();
        let registry = InMemoryInstitutionalKeyRegistry::new();

        let sealed_xml = embed_pqc_seal_into_iso20022(
            SAMPLE_PACS008_XML,
            "UNKNOWNBIC",
            "key-01",
            "pacs.008.001.08",
            &ed_sk,
            &ml_sk,
            &ml_pk,
            1792345000,
        )
        .unwrap();

        let err = verify_iso20022_pqc_seal_authenticated(&sealed_xml, &registry).unwrap_err();
        assert_eq!(
            err,
            Iso20022Error::UntrustedSignerIdentity("UNKNOWNBIC".into())
        );
    }

    #[test]
    fn test_revoked_signer_rejected() {
        let (ed_sk, ml_sk, ml_pk) = generate_keypair();
        let registry = InMemoryInstitutionalKeyRegistry::new();

        registry.register_signer(InstitutionalSigner {
            institution_id: "INST-REVOKED-01".into(),
            institution_name: "Compromised Bank PLC".into(),
            bic: "COMPGB22".into(),
            status: SignerStatus::Revoked,
            ed25519_public_key_hex: hex::encode(ed_sk.verifying_key().to_bytes()),
            ml_dsa_87_public_key_hex: hex::encode(ml_pk.clone().into_bytes()),
            authorized_message_types: vec!["pacs.008.001.08".into()],
            valid_until_epoch: 1900000000,
        });

        let sealed_xml = embed_pqc_seal_into_iso20022(
            SAMPLE_PACS008_XML,
            "COMPGB22",
            "key-01",
            "pacs.008.001.08",
            &ed_sk,
            &ml_sk,
            &ml_pk,
            1792345000,
        )
        .unwrap();

        let err = verify_iso20022_pqc_seal_authenticated(&sealed_xml, &registry).unwrap_err();
        assert_eq!(err, Iso20022Error::SignerKeyNotActive("COMPGB22".into()));
    }

    #[test]
    fn test_namespaced_xml_extraction_and_verification() {
        let (ed_sk, ml_sk, ml_pk) = generate_keypair();
        let registry = InMemoryInstitutionalKeyRegistry::new();

        registry.register_signer(InstitutionalSigner {
            institution_id: "INST-CHASE-US".into(),
            institution_name: "JPMorgan Chase NA".into(),
            bic: "CHASUS33".into(),
            status: SignerStatus::Active,
            ed25519_public_key_hex: hex::encode(ed_sk.verifying_key().to_bytes()),
            ml_dsa_87_public_key_hex: hex::encode(ml_pk.clone().into_bytes()),
            authorized_message_types: vec!["pacs.008.001.08".into()],
            valid_until_epoch: 1900000000,
        });

        let sealed_xml = embed_pqc_seal_into_iso20022(
            NAMESPACED_PACS008_XML,
            "CHASUS33",
            "key-chase-01",
            "pacs.008.001.08",
            &ed_sk,
            &ml_sk,
            &ml_pk,
            1792345000,
        )
        .unwrap();

        assert!(sealed_xml.contains("<SplmtryData>"));
        let auth_seal =
            verify_iso20022_pqc_seal_authenticated(&sealed_xml, &registry).unwrap();
        assert_eq!(auth_seal.authenticated_institution.bic, "CHASUS33");
    }

    #[test]
    fn test_tampered_amount_fails_verification() {
        let (ed_sk, ml_sk, ml_pk) = generate_keypair();

        let sealed_xml = embed_pqc_seal_into_iso20022(
            SAMPLE_PACS008_XML,
            "BARCGB22",
            "key-01",
            "pacs.008.001.08",
            &ed_sk,
            &ml_sk,
            &ml_pk,
            1792345000,
        )
        .unwrap();

        // Adversary tampers with transfer amount: 5000000.00 -> 9000000.00
        let tampered_xml = sealed_xml.replace("5000000.00", "9000000.00");

        let err = verify_iso20022_pqc_seal(&tampered_xml).unwrap_err();
        assert_eq!(err, Iso20022Error::DigestMismatch);
    }
}
