//! Authenticated Q-Core receipt publication boundary.
//!
//! This module deliberately contains no receipt-generation logic. It publishes an already
//! sealed canonical receipt using the same service identity that the control plane resolves
//! in its persistent issuer registry. The private signing keys never leave the keystore.

use hmac::{Hmac, Mac};
use reqwest::{Client, StatusCode};
use serde::Serialize;
use sha2::Sha256;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const SERVICE_ID_ENV: &str = "VARDHAN_QCORE_SERVICE_ID";
const SERVICE_SECRET_ENV: &str = "VARDHAN_QCORE_SERVICE_SECRET";
const TRANSPORT_URL_ENV: &str = "VARDHAN_QCORE_TRANSPORT_URL";
const MAX_RECEIPT_BYTES: usize = 2 * 1024 * 1024;
const TRANSPORT_VERSION: &str = "2";
const PROTOCOL_DOMAIN: &[u8] = b"VARDHAN-QCORE-RECEIPT-TRANSPORT-V2";

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Serialize)]
pub struct PublishResult {
    pub receipt_id: String,
    pub transaction_id: String,
    pub status: String,
    pub transport_status: u16,
}

#[derive(Debug)]
pub enum PublishError {
    NotConfigured(&'static str),
    InvalidReceipt(String),
    Request(String),
    Rejected(String),
}

impl std::fmt::Display for PublishError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotConfigured(v) => write!(f, "Q-Core transport configuration missing: {v}"),
            Self::InvalidReceipt(v) => write!(f, "invalid receipt: {v}"),
            Self::Request(v) => write!(f, "Q-Core transport request failed: {v}"),
            Self::Rejected(v) => write!(f, "Q-Core transport rejected receipt: {v}"),
        }
    }
}

impl std::error::Error for PublishError {}

/// Publish a sealed receipt to the authenticated control-plane transport.
///
/// The caller supplies the organization path explicitly. The control plane independently
/// verifies the receipt tenant, issuer key IDs/fingerprint, and both signatures; this client
/// therefore never treats a successful HTTP response as cryptographic proof by itself.
pub async fn publish_receipt(
    organization_id: &str,
    receipt: &crate::VardhanSealedReceipt,
) -> Result<PublishResult, PublishError> {
    let service_id = required_env(SERVICE_ID_ENV)?;
    let secret = required_env(SERVICE_SECRET_ENV)?;
    let base_url = required_env(TRANSPORT_URL_ENV)?;

    if organization_id.trim().is_empty() {
        return Err(PublishError::InvalidReceipt(
            "organization_id is empty".into(),
        ));
    }

    let body = serde_json::to_vec(receipt)
        .map_err(|e| PublishError::InvalidReceipt(format!("serialization failed: {e}")))?;
    if body.len() > MAX_RECEIPT_BYTES {
        return Err(PublishError::InvalidReceipt(
            "receipt exceeds transport size limit".into(),
        ));
    }

    if receipt.tenant_id != organization_id {
        return Err(PublishError::InvalidReceipt(
            "receipt tenant does not match transport organization".into(),
        ));
    }

    let timestamp = now_ms();
    let nonce = Uuid::new_v4().to_string();
    let path = format!("/api/v1/organizations/{organization_id}/qcore/receipts");
    let canonical = canonical_request(organization_id, &service_id, timestamp, &nonce, &body);
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .map_err(|_| PublishError::Request("invalid HMAC secret".into()))?;
    mac.update(&canonical);
    let signature = hex::encode(mac.finalize().into_bytes());

    let url = format!("{}{}", base_url.trim_end_matches('/'), path);

    let response = Client::new()
        .post(url)
        .header("content-type", "application/json")
        .header("x-vardhan-transport-version", TRANSPORT_VERSION)
        .header("x-vardhan-service-id", &service_id)
        .header("x-vardhan-timestamp", timestamp.to_string())
        .header("x-vardhan-nonce", &nonce)
        .header("x-vardhan-signature", signature)
        .body(body)
        .send()
        .await
        .map_err(|e| PublishError::Request(e.to_string()))?;

    let status = response.status();
    let response_body = response
        .text()
        .await
        .map_err(|e| PublishError::Request(e.to_string()))?;

    if !status.is_success() {
        return Err(PublishError::Rejected(format!(
            "HTTP {}: {}",
            status.as_u16(),
            response_body
        )));
    }

    Ok(PublishResult {
        receipt_id: receipt.receipt_id.clone(),
        transaction_id: receipt.transaction_id.clone(),
        status: if status == StatusCode::OK || status == StatusCode::ACCEPTED {
            "accepted".into()
        } else {
            "published".into()
        },
        transport_status: status.as_u16(),
    })
}

fn required_env(name: &'static str) -> Result<String, PublishError> {
    std::env::var(name)
        .ok()
        .filter(|v| !v.trim().is_empty())
        .ok_or(PublishError::NotConfigured(name))
}

fn canonical_request(
    organization_id: &str,
    service_id: &str,
    timestamp: u64,
    nonce: &str,
    body: &[u8],
) -> Vec<u8> {
    let path = format!("/api/v1/organizations/{organization_id}/qcore/receipts");
    let timestamp = timestamp.to_string();
    let fields: [&[u8]; 9] = [
        PROTOCOL_DOMAIN,
        TRANSPORT_VERSION.as_bytes(),
        b"POST",
        path.as_bytes(),
        organization_id.as_bytes(),
        service_id.as_bytes(),
        timestamp.as_bytes(),
        nonce.as_bytes(),
        body,
    ];
    let mut out = Vec::with_capacity(fields.iter().map(|field| 8 + field.len()).sum());
    for field in fields {
        out.extend_from_slice(&(field.len() as u64).to_be_bytes());
        out.extend_from_slice(field);
    }
    out
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transport_signature_is_deterministic_for_same_inputs() {
        let timestamp = 1_700_000_000_000u64;
        let nonce = "nonce-1";
        let body = r#"{"receipt_id":"VQR-1"}"#;
        let secret = "test-secret";
        let canonical = canonical_request("org-a", "svc-a", timestamp, nonce, body.as_bytes());
        let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
        mac.update(&canonical);
        let first = hex::encode(mac.finalize().into_bytes());

        let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
        mac.update(&canonical);
        let second = hex::encode(mac.finalize().into_bytes());
        assert_eq!(first, second);
    }

    #[test]
    fn wrong_secret_does_not_verify() {
        let canonical = canonical_request("org-a", "svc-a", 1_700_000_000_000, "nonce", b"body");
        let mut signer = HmacSha256::new_from_slice(b"secret-a").unwrap();
        signer.update(&canonical);
        let signature = signer.finalize().into_bytes();

        let mut verifier = HmacSha256::new_from_slice(b"secret-b").unwrap();
        verifier.update(&canonical);
        assert!(verifier.verify_slice(&signature).is_err());
    }
}
