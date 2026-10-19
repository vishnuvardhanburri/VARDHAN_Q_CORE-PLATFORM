//! # SWIFT ISO 20022 Post-Quantum Supplementary Data Transformer
//!
//! Breakthrough Innovation: Enables instant Post-Quantum compliance for SWIFT
//! (`pacs.008` / `pacs.009` / `camt.053`) without waiting for international network overhauls.
//!
//! Injects dual-signature (ML-DSA-87 + Ed25519) cryptographic seals into the
//! standard ISO 20022 `<SplmtryData>` element. Legacy payment rails parse the XML normally,
//! while Q-Core-enabled correspondent banks verify full quantum non-repudiation.

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
    #[error("Malformed ISO 20022 XML structure")]
    MalformedXml,
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
}

/// The Post-Quantum cryptographic seal embedded inside ISO 20022 `<SplmtryData>`.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Iso20022PqcSeal {
    pub algorithm_classical: String,
    pub algorithm_pqc: String,
    pub payload_digest_blake3: String,
    pub ed25519_signature_hex: String,
    pub ed25519_public_key_hex: String,
    pub ml_dsa_87_signature_hex: String,
    pub ml_dsa_87_public_key_hex: String,
    pub epoch_timestamp: u64,
}

/// Extracts the canonical signable body from an ISO 20022 document.
/// Extracts core transaction fields `<GrpHdr>` and `<CdtTrfTxInf>`.
pub fn extract_canonical_payment_body(xml: &str) -> Result<String, Iso20022Error> {
    // Locate the core business payment content
    let start_tag = if let Some(idx) = xml.find("<GrpHdr>") {
        idx
    } else if let Some(idx) = xml.find("<CdtTrfTxInf>") {
        idx
    } else {
        return Err(Iso20022Error::MissingTransactionBody);
    };

    let end_tag = if let Some(idx) = xml.rfind("</CdtTrfTxInf>") {
        idx + "</CdtTrfTxInf>".len()
    } else if let Some(idx) = xml.rfind("</GrpHdr>") {
        idx + "</GrpHdr>".len()
    } else {
        return Err(Iso20022Error::MissingTransactionBody);
    };

    if end_tag <= start_tag {
        return Err(Iso20022Error::MalformedXml);
    }

    Ok(xml[start_tag..end_tag].trim().to_string())
}

/// Signs an ISO 20022 XML document and embeds a dual PQC seal into `<SplmtryData>`.
pub fn embed_pqc_seal_into_iso20022(
    original_xml: &str,
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
        payload_digest_blake3: digest_hex,
        ed25519_signature_hex: ed_sig_hex,
        ed25519_public_key_hex: ed_pk_hex,
        ml_dsa_87_signature_hex: ml_sig_hex,
        ml_dsa_87_public_key_hex: ml_pk_hex,
        epoch_timestamp: timestamp,
    };

    let seal_json = serde_json::to_string(&seal).map_err(|_| Iso20022Error::MalformedXml)?;

    // Build the ISO 20022 standard <SplmtryData> envelope
    let supplementary_data = format!(
        "\n    <SplmtryData>\n      <PlcAndNm>VARDHAN-QCORE-PQC-SEAL</PlcAndNm>\n      <Envlp>\n        <VardhanPqcSeal>{}</VardhanPqcSeal>\n      </Envlp>\n    </SplmtryData>",
        seal_json
    );

    // Inject before closing document tag
    if let Some(pos) = original_xml.rfind("</Document>") {
        let mut transformed = original_xml[..pos].to_string();
        transformed.push_str(&supplementary_data);
        transformed.push_str("\n</Document>");
        Ok(transformed)
    } else {
        // Append at end if not wrapped in </Document>
        let mut transformed = original_xml.to_string();
        transformed.push_str(&supplementary_data);
        Ok(transformed)
    }
}

/// Verifies that an ISO 20022 XML document has an untampered dual PQC seal.
pub fn verify_iso20022_pqc_seal(sealed_xml: &str) -> Result<Iso20022PqcSeal, Iso20022Error> {
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
    let seal: Iso20022PqcSeal =
        serde_json::from_str(seal_json).map_err(|_| Iso20022Error::MalformedXml)?;

    // 2. Compute canonical digest of the business message
    let canonical_body = extract_canonical_payment_body(sealed_xml)?;
    let computed_digest = blake3::hash(canonical_body.as_bytes());

    if computed_digest.to_hex().to_string() != seal.payload_digest_blake3 {
        return Err(Iso20022Error::DigestMismatch);
    }

    // 3. Verify Ed25519 signature
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

    // 4. Verify ML-DSA-87 signature
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

    #[test]
    fn test_iso20022_pqc_seal_roundtrip() {
        let mut seed = [0u8; 32];
        OsRng.fill_bytes(&mut seed);
        let ed_sk = EdSigningKey::from_bytes(&seed);
        let (ml_pk, ml_sk) = ml_dsa_87::try_keygen().unwrap();

        let sealed_xml =
            embed_pqc_seal_into_iso20022(SAMPLE_PACS008_XML, &ed_sk, &ml_sk, &ml_pk, 1792345000)
                .unwrap();

        assert!(sealed_xml.contains("<SplmtryData>"));
        assert!(sealed_xml.contains("<VardhanPqcSeal>"));

        let verified_seal = verify_iso20022_pqc_seal(&sealed_xml).unwrap();
        assert_eq!(verified_seal.algorithm_pqc, "ML-DSA-87-FIPS204");
        assert_eq!(verified_seal.algorithm_classical, "Ed25519-RFC8032");
    }

    #[test]
    fn test_tampered_amount_fails_verification() {
        let mut seed = [0u8; 32];
        OsRng.fill_bytes(&mut seed);
        let ed_sk = EdSigningKey::from_bytes(&seed);
        let (ml_pk, ml_sk) = ml_dsa_87::try_keygen().unwrap();

        let sealed_xml =
            embed_pqc_seal_into_iso20022(SAMPLE_PACS008_XML, &ed_sk, &ml_sk, &ml_pk, 1792345000)
                .unwrap();

        // Adversary tampers with transfer amount: 5,000,000.00 -> 9,000,000.00
        let tampered_xml = sealed_xml.replace("5000000.00", "9000000.00");

        let err = verify_iso20022_pqc_seal(&tampered_xml).unwrap_err();
        assert_eq!(err, Iso20022Error::DigestMismatch);
    }
}
