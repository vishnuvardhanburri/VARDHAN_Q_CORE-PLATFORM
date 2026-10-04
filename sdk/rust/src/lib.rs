use reqwest::{Client, Method};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum VardhanError {
    #[error("request failed: {0}")]
    Transport(#[from] reqwest::Error),
    #[error("api error {status}: {message}")]
    Api { status: u16, message: String, code: Option<String>, request_id: Option<String> },
}

#[derive(Clone)]
pub struct Vardhan { base_url: String, token: Option<String>, client: Client }

impl Vardhan {
    pub fn new(base_url: impl Into<String>, token: Option<String>) -> Self { Self { base_url: base_url.into().trim_end_matches('/').to_string(), token, client: Client::new() } }
    async fn request<T: DeserializeOwned>(&self, method: Method, path: &str) -> Result<T, VardhanError> {
        let mut req = self.client.request(method, format!("{}{}", self.base_url, path)).header("accept", "application/json").header("x-vardhan-sdk", "rust/0.1.0");
        if let Some(token) = &self.token { req = req.bearer_auth(token); }
        let response = req.send().await?;
        let status = response.status();
        let request_id = response.headers().get("x-request-id").and_then(|v| v.to_str().ok()).map(str::to_owned);
        if !status.is_success() {
            let body: serde_json::Value = response.json().await.unwrap_or_default();
            return Err(VardhanError::Api { status: status.as_u16(), message: body.get("error").and_then(|v| v.as_str()).unwrap_or("Vardhan API request failed").to_owned(), code: body.get("code").and_then(|v| v.as_str()).map(str::to_owned), request_id });
        }
        Ok(response.json().await?)
    }
    pub async fn health(&self) -> Result<serde_json::Value, VardhanError> { self.request(Method::GET, "/api/v1/platform/health").await }
    pub async fn plans(&self) -> Result<Vec<serde_json::Value>, VardhanError> { self.request(Method::GET, "/api/v1/catalog/plans").await }
    pub async fn me(&self) -> Result<serde_json::Value, VardhanError> { self.request(Method::GET, "/api/v1/me").await }
}
