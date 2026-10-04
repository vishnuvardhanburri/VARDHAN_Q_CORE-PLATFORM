//! Enterprise OIDC/SSO configuration contract.
//!
//! This module deliberately contains configuration and validation only. Token
//! exchange/verification belongs in the authentication boundary so an
//! unverified identity can never be promoted to a local session.

use serde::{Deserialize, Serialize};

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
}

impl OidcConfig {
    pub fn validate(&self) -> Result<(), OidcConfigError> {
        if !self.enabled { return Ok(()); }
        if self.issuer.trim().is_empty() { return Err(OidcConfigError::MissingIssuer); }
        if !self.issuer.starts_with("https://") { return Err(OidcConfigError::InsecureIssuer); }
        if self.client_id.trim().is_empty() { return Err(OidcConfigError::MissingClientId); }
        if self.redirect_uri.trim().is_empty() { return Err(OidcConfigError::MissingRedirect); }
        if !self.redirect_uri.starts_with("https://") { return Err(OidcConfigError::InsecureRedirect); }
        Ok(())
    }
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
}
