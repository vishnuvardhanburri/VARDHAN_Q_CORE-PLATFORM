//! Experimental ISO 20022 dual-signature envelope, application profile V2.
//! See docs/ISO20022_VALIDATION_AND_INTEROPERABILITY.md for supported structure,
//! canonical representation and limitations. No network/XSD conformance claim.

use crate::payment_xml;
use std::collections::HashMap;
use std::sync::RwLock;

use ed25519_dalek::{
    Signer as EdSigner, SigningKey as EdSigningKey, VerifyingKey as EdVerifyingKey,
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
    #[error(
        "Untrusted signer identity: BIC '{0}' is not registered in institutional key registry"
    )]
    UntrustedSignerIdentity(String),
    #[error("Signer key not active for BIC '{0}'")]
    SignerKeyNotActive(String),
    #[error("Signer '{0}' is not authorized for message type '{1}'")]
    UnauthorizedMessageType(String, String),
    #[error("Public key substitution detected: presented key does not match trusted registry for BIC '{0}'")]
    KeySubstitutionDetected(String),
    #[error("Signer key expired for BIC '{0}'")]
    SignerKeyExpired(String),
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

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| Iso20022Error::SchemaValidationFailed("Trusted clock unavailable".into()))?
            .as_secs();
        if signer.valid_until_epoch <= now {
            return Err(Iso20022Error::SignerKeyExpired(bic.to_owned()));
        }
        if !signer.bic.eq_ignore_ascii_case(bic) || signer.institution_id.trim().is_empty() {
            return Err(Iso20022Error::UntrustedSignerIdentity(bic.to_owned()));
        }
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

/// Application canonical representation V2 (not W3C C14N).
pub fn extract_canonical_payment_body(xml: &str) -> Result<String, Iso20022Error> {
    Ok(payment_xml::canonical(&payment_xml::parse(xml)?))
}

fn signing_input(seal: &Iso20022PqcSeal) -> Result<Vec<u8>, Iso20022Error> {
    if seal.algorithm_classical != "Ed25519-RFC8032"
        || seal.algorithm_pqc != "ML-DSA-87-FIPS204"
        || seal.key_id.trim().is_empty()
        || seal.signer_bic.trim().is_empty()
    {
        return Err(payment_xml::invalid(
            "Invalid seal algorithm or identity metadata",
        ));
    }
    serde_json::to_vec(&(
        "VARDHAN-ISO20022-SEAL-V2",
        &seal.algorithm_classical,
        &seal.algorithm_pqc,
        &seal.signer_bic,
        &seal.key_id,
        &seal.message_type,
        &seal.payload_digest_blake3,
        &seal.ed25519_public_key_hex,
        &seal.ml_dsa_87_public_key_hex,
        seal.epoch_timestamp,
    ))
    .map_err(|_| payment_xml::invalid("Seal serialization failed"))
}

fn parse_seal(xml: &str) -> Result<Iso20022PqcSeal, Iso20022Error> {
    let doc = payment_xml::parse(xml)?;
    let seal: Iso20022PqcSeal = serde_json::from_str(&payment_xml::seal_json(&doc)?)
        .map_err(|_| payment_xml::invalid("Invalid seal JSON"))?;
    if seal.message_type != payment_xml::message_type(&doc) {
        return Err(payment_xml::invalid(
            "Seal message type does not match document namespace",
        ));
    }
    signing_input(&seal)?;
    Ok(seal)
}

/// Signs the entire parsed business document and seal metadata under profile V2.
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
    let doc = payment_xml::parse(original_xml)?;
    if message_type != payment_xml::message_type(&doc) {
        return Err(payment_xml::invalid(
            "Message type does not match document namespace",
        ));
    }
    let digest = blake3::hash(payment_xml::canonical(&doc).as_bytes());
    let mut seal = Iso20022PqcSeal {
        algorithm_classical: "Ed25519-RFC8032".into(),
        algorithm_pqc: "ML-DSA-87-FIPS204".into(),
        signer_bic: signer_bic.to_uppercase(),
        key_id: key_id.to_owned(),
        message_type: message_type.to_owned(),
        payload_digest_blake3: digest.to_hex().to_string(),
        ed25519_signature_hex: String::new(),
        ml_dsa_87_signature_hex: String::new(),
        ed25519_public_key_hex: hex::encode(ed_signing_key.verifying_key().to_bytes()),
        ml_dsa_87_public_key_hex: hex::encode(ml_dsa_public_key.clone().into_bytes()),
        epoch_timestamp: timestamp,
    };
    let input = signing_input(&seal)?;
    seal.ed25519_signature_hex = hex::encode(ed_signing_key.sign(&input).to_bytes());
    seal.ml_dsa_87_signature_hex = hex::encode(
        ml_dsa_private_key
            .try_sign(&input, &[])
            .map_err(|_| Iso20022Error::MlDsa87VerificationFailed)?,
    );
    let json = serde_json::to_string(&seal)
        .map_err(|_| payment_xml::invalid("Seal serialization failed"))?;
    payment_xml::embed(original_xml, &json)
}

/// Authenticated verification of an ISO 20022 PQC seal against a trusted Institutional Key Registry.
///
/// This checks the configured institutional registry and signatures; tenant authorization
/// and production key custody are separate requirements:
/// 1. Verifies that the signer BIC is enrolled in the trusted institutional registry.
/// 2. Ensures the signer status is `Active` (rejects revoked or suspended signers).
/// 3. Confirms that the public keys in the seal match the trusted public keys registered for the institution.
/// 4. Cryptographically verifies both Ed25519 and ML-DSA-87 signatures using the TRUSTED keys.
pub fn verify_iso20022_pqc_seal_authenticated(
    sealed_xml: &str,
    registry: &dyn InstitutionalKeyRegistry,
) -> Result<AuthenticatedPaymentSeal, Iso20022Error> {
    let seal = parse_seal(sealed_xml)?;
    let input = signing_input(&seal)?;

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
        .verify_strict(&input, &ed_sig)
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

    if !ml_public_key.verify(&input, &ml_sig_array, &[]) {
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
    let seal = parse_seal(sealed_xml)?;
    let input = signing_input(&seal)?;

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
        .verify_strict(&input, &ed_sig)
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

    if !ml_public_key.verify(&input, &ml_sig_array, &[]) {
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
    fn test_supplementary_data_placement() {
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
        let splmtry_pos = sealed_xml.find("<SplmtryData xmlns=").unwrap();
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
            valid_until_epoch: u64::MAX, // Positive fixture must not expire with wall time.
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

        let auth_seal = verify_iso20022_pqc_seal_authenticated(&sealed_xml, &registry).unwrap();
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
            valid_until_epoch: u64::MAX, // Positive fixture must not expire with wall time.
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
            valid_until_epoch: u64::MAX, // Positive fixture must not expire with wall time.
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
            valid_until_epoch: u64::MAX, // Positive fixture must not expire with wall time.
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

        assert!(sealed_xml.contains("<SplmtryData xmlns="));
        let auth_seal = verify_iso20022_pqc_seal_authenticated(&sealed_xml, &registry).unwrap();
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

    #[test]
    fn regression_expired_registry_key_rejected() {
        let registry = InMemoryInstitutionalKeyRegistry::new();
        registry.register_signer(InstitutionalSigner {
            institution_id: "synthetic-bank".into(),
            institution_name: "Test".into(),
            bic: "BARCGB22".into(),
            status: SignerStatus::Active,
            ed25519_public_key_hex: "00".into(),
            ml_dsa_87_public_key_hex: "00".into(),
            authorized_message_types: vec!["pacs.008.001.08".into()],
            valid_until_epoch: 1,
        });
        assert!(registry
            .validate_signer_keys("BARCGB22", "pacs.008.001.08", "00", "00")
            .is_err());
    }

    #[test]
    fn regression_malformed_and_ambiguous_xml_rejected() {
        let malformed = SAMPLE_PACS008_XML.replace("</Document>", "");
        assert!(extract_canonical_payment_body(&malformed).is_err());
        let duplicate = SAMPLE_PACS008_XML.replace("<GrpHdr>", "<GrpHdr/><GrpHdr>");
        assert!(extract_canonical_payment_body(&duplicate).is_err());
        let wrong_namespace = SAMPLE_PACS008_XML.replace("pacs.008.001.08", "pacs.008.001.99");
        assert!(extract_canonical_payment_body(&wrong_namespace).is_err());
    }

    #[test]
    fn regression_seal_metadata_is_authenticated() {
        let (ed, sk, pk) = generate_keypair();
        let sealed = embed_pqc_seal_into_iso20022(
            SAMPLE_PACS008_XML,
            "BARCGB22",
            "key-01",
            "pacs.008.001.08",
            &ed,
            &sk,
            &pk,
            1792345000,
        )
        .unwrap();
        assert!(verify_iso20022_pqc_seal(&sealed.replace("key-01", "key-02")).is_err());
        assert!(verify_iso20022_pqc_seal(&sealed.replace("1792345000", "1792345001")).is_err());
        assert!(verify_iso20022_pqc_seal(&sealed.replace("Ed25519-RFC8032", "none")).is_err());
    }

    #[test]
    fn xml_security_limits_and_namespace_substitution() {
        for xml in [
            SAMPLE_PACS008_XML.replace("UTF-8", "ISO-8859-1"),
            SAMPLE_PACS008_XML.replace("version=\"1.0\"", "version=\"1.1\""),
            SAMPLE_PACS008_XML.replace(
                "<Document ",
                "<!DOCTYPE Document [<!ENTITY x SYSTEM 'file:///etc/passwd'>]><Document ",
            ),
            SAMPLE_PACS008_XML.replace("<GrpHdr>", "<GrpHdr xmlns='urn:attacker'>"),
            SAMPLE_PACS008_XML.replace("<GrpHdr>", "<!--<GrpHdr>--><GrpHdr>"),
            SAMPLE_PACS008_XML
                .replace("<GrpHdr>", &format!("<GrpHdr>{}", "<x>".repeat(70)))
                .replace("</GrpHdr>", &format!("{}</GrpHdr>", "</x>".repeat(70))),
            " ".repeat(crate::payment_xml::MAX_XML_BYTES + 1),
        ] {
            assert!(extract_canonical_payment_body(&xml).is_err());
        }
    }

    #[test]
    fn seal_escaping_duplicate_seals_and_exact_character_binding() {
        let (ed, sk, pk) = generate_keypair();
        let sealed = embed_pqc_seal_into_iso20022(
            SAMPLE_PACS008_XML,
            "BARCGB22",
            "key<&01",
            "pacs.008.001.08",
            &ed,
            &sk,
            &pk,
            1792345000,
        )
        .unwrap();
        assert_eq!(verify_iso20022_pqc_seal(&sealed).unwrap().key_id, "key<&01");
        assert!(embed_pqc_seal_into_iso20022(
            &sealed,
            "BARCGB22",
            "key-02",
            "pacs.008.001.08",
            &ed,
            &sk,
            &pk,
            1792345000
        )
        .is_err());
        assert!(verify_iso20022_pqc_seal(
            &sealed.replace("ACME Global Treasury", " ACME Global Treasury ")
        )
        .is_err());
        let doc = crate::payment_xml::parse(&sealed).unwrap();
        let supplementary = doc
            .descendants()
            .find(|n| n.is_element() && n.tag_name().name() == "SplmtryData")
            .unwrap();
        let duplicate = sealed.replace(
            "</FIToFICstmrCdtTrf>",
            &format!("{}</FIToFICstmrCdtTrf>", &sealed[supplementary.range()]),
        );
        assert!(verify_iso20022_pqc_seal(&duplicate).is_err());
    }
}
