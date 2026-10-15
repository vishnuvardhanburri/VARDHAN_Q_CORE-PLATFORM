use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::time::{SystemTime, UNIX_EPOCH};
use subtle::ConstantTimeEq;
use thiserror::Error;

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EnterpriseEventEnvelope {
    pub event_id: String,
    pub organization_id: String,
    pub event_type: String,
    pub schema_version: String,
    pub correlation_id: String,
    pub occurred_at_ms: u64,
    pub payload: serde_json::Value,
}

#[derive(Debug, Error)]
pub enum IntegrationError {
    #[error("organization id is required")]
    MissingOrganization,
    #[error("event type is required")]
    MissingEventType,
    #[error("integration secret is required")]
    MissingSecret,
    #[error("event timestamp is outside the accepted window")]
    TimestampRejected,
    #[error("signature verification failed")]
    SignatureRejected,
}

pub struct SignedWebhook;

impl SignedWebhook {
    pub fn sign(
        secret: &[u8],
        envelope: &EnterpriseEventEnvelope,
    ) -> Result<String, IntegrationError> {
        if secret.is_empty() {
            return Err(IntegrationError::MissingSecret);
        }
        let body = serde_json::to_vec(envelope).map_err(|_| IntegrationError::SignatureRejected)?;
        let mut mac =
            HmacSha256::new_from_slice(secret).map_err(|_| IntegrationError::MissingSecret)?;
        mac.update(&body);
        Ok(hex::encode(mac.finalize().into_bytes()))
    }

    pub fn verify(
        secret: &[u8],
        envelope: &EnterpriseEventEnvelope,
        signature_hex: &str,
    ) -> Result<(), IntegrationError> {
        let expected = Self::sign(secret, envelope)?;
        let provided =
            hex::decode(signature_hex).map_err(|_| IntegrationError::SignatureRejected)?;
        let expected_bytes =
            hex::decode(expected).map_err(|_| IntegrationError::SignatureRejected)?;
        if provided.as_slice().ct_eq(expected_bytes.as_slice()).into() {
            Ok(())
        } else {
            Err(IntegrationError::SignatureRejected)
        }
    }
}

pub fn build_event(
    organization_id: &str,
    event_type: &str,
    correlation_id: &str,
    payload: serde_json::Value,
) -> Result<EnterpriseEventEnvelope, IntegrationError> {
    if organization_id.trim().is_empty() {
        return Err(IntegrationError::MissingOrganization);
    }
    if event_type.trim().is_empty() {
        return Err(IntegrationError::MissingEventType);
    }
    let occurred_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| IntegrationError::TimestampRejected)?
        .as_millis() as u64;
    let event_id = blake3::hash(
        format!("{organization_id}:{event_type}:{correlation_id}:{payload}").as_bytes(),
    )
    .to_hex()
    .to_string();
    Ok(EnterpriseEventEnvelope {
        event_id,
        organization_id: organization_id.to_owned(),
        event_type: event_type.to_owned(),
        schema_version: "1.0".into(),
        correlation_id: correlation_id.to_owned(),
        occurred_at_ms,
        payload,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn envelope() -> EnterpriseEventEnvelope {
        build_event(
            "org-a",
            "receipt.verified",
            "corr-1",
            serde_json::json!({"receipt_id":"VQR-1"}),
        )
        .unwrap()
    }

    #[test]
    fn signed_event_round_trip_verifies() {
        let event = envelope();
        let sig = SignedWebhook::sign(b"secret", &event).unwrap();
        assert!(SignedWebhook::verify(b"secret", &event, &sig).is_ok());
    }

    #[test]
    fn wrong_secret_and_tampered_payload_are_rejected() {
        let mut event = envelope();
        let sig = SignedWebhook::sign(b"secret", &event).unwrap();
        assert!(matches!(
            SignedWebhook::verify(b"other", &event, &sig),
            Err(IntegrationError::SignatureRejected)
        ));
        event.payload = serde_json::json!({"receipt_id":"forged"});
        assert!(matches!(
            SignedWebhook::verify(b"secret", &event, &sig),
            Err(IntegrationError::SignatureRejected)
        ));
    }

    #[test]
    fn tenant_is_part_of_deterministic_event_identity() {
        let a = build_event(
            "org-a",
            "receipt.verified",
            "corr",
            serde_json::json!({"x":1}),
        )
        .unwrap();
        let b = build_event(
            "org-b",
            "receipt.verified",
            "corr",
            serde_json::json!({"x":1}),
        )
        .unwrap();
        assert_ne!(a.event_id, b.event_id);
    }
}
