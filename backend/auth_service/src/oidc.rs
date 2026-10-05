//! Enterprise OIDC/SSO configuration and authorization-flow security contract.
//!
//! Token exchange/signature verification remains at the authentication boundary;
//! this module owns the pre-token invariants so an unbound authorization code
//! cannot be promoted to a local session.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OidcConfig {
    pub enabled: bool,
    pub issuer: String,
    pub client_id: String,
    pub redirect_uri: String,
    pub scopes: Vec<String>,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum OidcConfigError {
    #[error("OIDC issuer must use HTTPS")]
    InsecureIssuer,
    #[error("OIDC issuer is missing")]
    MissingIssuer,
    #[error("OIDC client id is missing")]
    MissingClientId,
    #[error("OIDC redirect URI must use HTTPS")]
    InsecureRedirect,
    #[error("OIDC redirect URI is missing")]
    MissingRedirect,
    #[error("OIDC flow requires the openid scope")]
    MissingOpenIdScope,
}

impl OidcConfig {
    pub fn validate(&self) -> Result<(), OidcConfigError> {
        if !self.enabled { return Ok(()); }
        if self.issuer.trim().is_empty() { return Err(OidcConfigError::MissingIssuer); }
        if !self.issuer.starts_with("https://") { return Err(OidcConfigError::InsecureIssuer); }
        if self.client_id.trim().is_empty() { return Err(OidcConfigError::MissingClientId); }
        if self.redirect_uri.trim().is_empty() { return Err(OidcConfigError::MissingRedirect); }
        if !self.redirect_uri.starts_with("https://") { return Err(OidcConfigError::InsecureRedirect); }
        if !self.scopes.iter().any(|s| s == "openid") { return Err(OidcConfigError::MissingOpenIdScope); }
        Ok(())
    }
}

/// State carried from authorization request through callback. The raw nonce
/// and PKCE verifier are never serialized into the browser-visible state value.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OidcFlowState {
    pub state: String,
    pub nonce: String,
    pub pkce_verifier: String,
    pub issuer: String,
    pub client_id: String,
    pub expires_at_ms: u64,
}

impl OidcFlowState {
    pub fn validate_callback(&self, returned_state: &str, now_ms: u64) -> Result<(), &'static str> {
        if now_ms >= self.expires_at_ms { return Err("OIDC authorization state expired"); }
        if !constant_time_equal(self.state.as_bytes(), returned_state.as_bytes()) { return Err("OIDC state mismatch"); }
        if self.nonce.len() < 16 || self.pkce_verifier.len() < 43 { return Err("OIDC flow binding is invalid"); }
        Ok(())
    }

    pub fn pkce_s256_challenge(&self) -> String {
        let digest = Sha256::digest(self.pkce_verifier.as_bytes());
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest)
    }
}

fn constant_time_equal(a: &[u8], b: &[u8]) -> bool {
    use subtle::ConstantTimeEq;
    a.ct_eq(b).into()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> OidcConfig {
        OidcConfig {
            enabled: true,
            issuer: "https://idp.example.com".into(),
            client_id: "vardhan".into(),
            redirect_uri: "https://console.example.com/auth/callback".into(),
            scopes: vec!["openid".into(), "profile".into(), "email".into()],
        }
    }

    #[test]
    fn validates_secure_config() { assert!(config().validate().is_ok()); }

    #[test]
    fn rejects_http_issuer() {
        let mut c = config(); c.issuer = "http://idp.example.com".into();
        assert_eq!(c.validate(), Err(OidcConfigError::InsecureIssuer));
    }

    #[test]
    fn rejects_http_redirect() {
        let mut c = config(); c.redirect_uri = "http://console.example.com/callback".into();
        assert_eq!(c.validate(), Err(OidcConfigError::InsecureRedirect));
    }

    #[test]
    fn rejects_missing_openid_scope() {
        let mut c = config(); c.scopes = vec!["profile".into()];
        assert_eq!(c.validate(), Err(OidcConfigError::MissingOpenIdScope));
    }

    #[test]
    fn callback_requires_state_binding() {
        let flow = OidcFlowState {
            state: "server-generated-state".into(),
            nonce: "server-generated-nonce-123456".into(),
            pkce_verifier: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~".into(),
            issuer: "https://idp.example.com".into(),
            client_id: "vardhan".into(),
            expires_at_ms: 2_000,
        };
        assert!(flow.validate_callback("wrong", 1_000).is_err());
        assert!(flow.validate_callback(&flow.state, 1_000).is_ok());
        assert!(flow.validate_callback(&flow.state, 2_000).is_err());
        assert!(!flow.pkce_s256_challenge().is_empty());
    }
}
