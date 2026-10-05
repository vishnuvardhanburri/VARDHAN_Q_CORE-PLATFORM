pub mod models;

use hmac::{Hmac, Mac};
use reqwest::{Client, Method};
use serde::de::DeserializeOwned;
use serde_json::Value;
use sha2::Sha256;
use thiserror::Error;
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Error)]
pub enum VardhanError {
    #[error("request failed: {0}")]
    Transport(#[from] reqwest::Error),
    #[error("api error {status}: {message}")]
    Api { status: u16, message: String, code: Option<String>, request_id: Option<String> },
    #[error("invalid webhook signature")]
    InvalidWebhookSignature,
}

#[derive(Clone)]
pub struct Vardhan { base_url: String, token: Option<String>, client: Client }

impl Vardhan {
    pub fn new(base_url: impl Into<String>, token: Option<String>) -> Self { Self { base_url: base_url.into().trim_end_matches('/').to_string(), token, client: Client::new() } }
    pub fn idempotency_key() -> String { Uuid::new_v4().to_string() }
    async fn request<T: DeserializeOwned>(&self, method: Method, path: &str, body: Option<Value>, idempotency_key: Option<&str>) -> Result<T, VardhanError> {
        let mut req = self.client.request(method.clone(), format!("{}{}", self.base_url, path)).header("accept", "application/json").header("x-vardhan-sdk", "rust/0.3.0");
        if let Some(token) = &self.token { req = req.bearer_auth(token); }
        if let Some(key) = idempotency_key { req = req.header("Idempotency-Key", key); } else if method == Method::POST { req = req.header("Idempotency-Key", Self::idempotency_key()); }
        if let Some(body) = body { req = req.json(&body); }
        let response = req.send().await?;
        let status = response.status();
        let request_id = response.headers().get("x-request-id").and_then(|v| v.to_str().ok()).map(str::to_owned);
        let payload: Value = response.json().await.unwrap_or(Value::Null);
        if !status.is_success() { return Err(VardhanError::Api { status: status.as_u16(), message: payload.get("error").and_then(|v| v.as_str()).unwrap_or("Vardhan API request failed").to_owned(), code: payload.get("code").and_then(|v| v.as_str()).map(str::to_owned), request_id }); }
        serde_json::from_value(payload).map_err(|e| VardhanError::Api { status: status.as_u16(), message: format!("invalid API response: {e}"), code: None, request_id })
    }
    async fn get(&self, path: &str) -> Result<Value, VardhanError> { self.request(Method::GET, path, None, None).await }
    async fn post(&self, path: &str, body: Value, idempotency_key: Option<&str>) -> Result<Value, VardhanError> { self.request(Method::POST, path, Some(body), idempotency_key).await }
    pub async fn health(&self) -> Result<Value, VardhanError> { self.get("/api/v1/platform/health").await }
    pub async fn plans(&self) -> Result<Value, VardhanError> { self.get("/api/v1/catalog/plans").await }
    pub async fn me(&self) -> Result<Value, VardhanError> { self.get("/api/v1/me").await }
    pub async fn organizations(&self) -> Result<Value, VardhanError> { self.get("/api/v1/organizations").await }
    pub async fn organization(&self, organization_id: &str) -> Result<Value, VardhanError> { self.get(&format!("/api/v1/organizations/{organization_id}")).await }
    pub async fn entitlements(&self, organization_id: &str) -> Result<Value, VardhanError> { self.get(&format!("/api/v1/organizations/{organization_id}/entitlements")).await }
    pub async fn subscription(&self, organization_id: &str) -> Result<Value, VardhanError> { self.get(&format!("/api/v1/organizations/{organization_id}/subscription")).await }
    pub async fn usage(&self, organization_id: &str) -> Result<Value, VardhanError> { self.get(&format!("/api/v1/organizations/{organization_id}/usage")).await }
    pub async fn members(&self, organization_id: &str) -> Result<Value, VardhanError> { self.get(&format!("/api/v1/organizations/{organization_id}/members")).await }
    pub async fn invitations(&self, organization_id: &str) -> Result<Value, VardhanError> { self.get(&format!("/api/v1/organizations/{organization_id}/invitations")).await }
    pub async fn security_posture(&self, organization_id: &str) -> Result<Value, VardhanError> { self.get(&format!("/api/v1/organizations/{organization_id}/security/posture")).await }
    pub async fn findings(&self, organization_id: &str) -> Result<Value, VardhanError> { self.get(&format!("/api/v1/organizations/{organization_id}/findings")).await }
    pub async fn incidents(&self, organization_id: &str) -> Result<Value, VardhanError> { self.get(&format!("/api/v1/organizations/{organization_id}/incidents")).await }
    pub async fn transactions(&self, organization_id: &str) -> Result<Value, VardhanError> { self.get(&format!("/api/v1/organizations/{organization_id}/transactions")).await }
    pub async fn aer_kep_q_status(&self, organization_id: &str) -> Result<Value, VardhanError> { self.get(&format!("/api/v1/organizations/{organization_id}/aer-kep-q/status")).await }
    pub async fn ingest_transaction(&self, organization_id: &str, body: Value, idempotency_key: &str) -> Result<Value, VardhanError> { self.post(&format!("/api/v1/organizations/{organization_id}/transactions"), body, Some(idempotency_key)).await }
    pub async fn create_organization(&self, body: Value, idempotency_key: &str) -> Result<Value, VardhanError> { self.post("/api/v1/organizations", body, Some(idempotency_key)).await }
        pub async fn create_invitation(&self, organization_id: &str, body: Value, idempotency_key: &str) -> Result<Value, VardhanError> { self.post(&format!("/api/v1/organizations/{organization_id}/invitations"), body, Some(idempotency_key)).await }
    pub async fn request_plan(&self, organization_id: &str, body: Value, idempotency_key: &str) -> Result<Value, VardhanError> { self.post(&format!("/api/v1/organizations/{organization_id}/subscription"), body, Some(idempotency_key)).await }
    pub async fn record_usage(&self, organization_id: &str, body: Value, idempotency_key: &str) -> Result<Value, VardhanError> { self.post(&format!("/api/v1/organizations/{organization_id}/usage/record"), body, Some(idempotency_key)).await }
    pub async fn update_member_role(&self, organization_id: &str, member: &str, body: Value, idempotency_key: &str) -> Result<Value, VardhanError> { self.post(&format!("/api/v1/organizations/{organization_id}/members/{member}/role"), body, Some(idempotency_key)).await }
    pub async fn revoke_invitation(&self, organization_id: &str, invitation_id: &str, idempotency_key: &str) -> Result<Value, VardhanError> { self.post(&format!("/api/v1/organizations/{organization_id}/invitations/{invitation_id}"), serde_json::json!({}), Some(idempotency_key)).await }
    pub async fn accept_invitation(&self, body: Value, idempotency_key: &str) -> Result<Value, VardhanError> { self.post("/api/v1/invitations/accept", body, Some(idempotency_key)).await }
    pub fn verify_webhook_signature(secret: &str, body: &[u8], signature_hex: &str, timestamp: Option<u64>, tolerance_secs: u64) -> Result<(), VardhanError> { if let Some(ts) = timestamp { let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs(); if now.saturating_sub(ts) > tolerance_secs || ts.saturating_sub(now) > tolerance_secs { return Err(VardhanError::InvalidWebhookSignature); } } let expected = hex::decode(signature_hex).map_err(|_| VardhanError::InvalidWebhookSignature)?; let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).map_err(|_| VardhanError::InvalidWebhookSignature)?; mac.update(body); mac.verify_slice(&expected).map_err(|_| VardhanError::InvalidWebhookSignature) }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn idempotency_key_is_unique_uuid() { let a = Vardhan::idempotency_key(); let b = Vardhan::idempotency_key(); assert_ne!(a, b); assert!(Uuid::parse_str(&a).is_ok()); }
    #[test] fn webhook_signature_rejects_tampering() { let secret = "enterprise-secret"; let body = br#"{\"event\":\"subscription.updated\"}"#; let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap(); mac.update(body); let signature = hex::encode(mac.finalize().into_bytes()); assert!(Vardhan::verify_webhook_signature(secret, body, &signature, None, 300).is_ok()); assert!(Vardhan::verify_webhook_signature(secret, br#"{\"event\":\"tampered\"}"#, &signature, None, 300).is_err()); }
}
