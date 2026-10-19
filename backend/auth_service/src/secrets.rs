//! # Secret Management for Vardhan Auth Service
//!
//! This module provides abstractions for loading sensitive bootstrap credentials
//! from secure sources, avoiding reliance on long-lived environment variables.

use std::fs;
use std::path::PathBuf;
use zeroize::Zeroizing;

#[derive(Debug, thiserror::Error)]
pub enum SecretError {
    #[error("Secret not found in source: {0}")]
    NotFound(String),
    #[error("IO error reading secret: {0}")]
    Io(#[from] std::io::Error),
    #[error("Secret is too short: minimum length is {0}")]
    TooShort(usize),
    #[error("Invalid secret format")]
    InvalidFormat,
}

/// Abstraction for reading secrets from various secure sources.
pub struct SecretReader;

impl SecretReader {
    /// Reads the admin password from the most secure available source.
    /// Order of precedence:
    /// 1. VARDHAN_ADMIN_PASSWORD_FILE (path to a restricted file)
    /// 2. VARDHAN_ADMIN_PASSWORD (env var - legacy/fallback)
    pub fn read_bootstrap_password() -> Result<Zeroizing<String>, SecretError> {
        // 1. Try secure file first
        if let Ok(path_str) = std::env::var("VARDHAN_ADMIN_PASSWORD_FILE") {
            let path = PathBuf::from(path_str);
            if path.exists() {
                let content = fs::read_to_string(&path)?;
                let trimmed = content.trim().to_string();
                if trimmed.is_empty() {
                    return Err(SecretError::InvalidFormat);
                }
                return Ok(Zeroizing::new(trimmed));
            }
        }

        // [F-C3 REMEDIATION]: VARDHAN_ADMIN_PASSWORD env var fallback removed.
        // Long-lived secrets must use file-based injection or KMS.

        Err(SecretError::NotFound(
            "No secure bootstrap password source configured (env vars disabled)".into(),
        ))
    }

    /// Reads the admin username.
    pub fn read_bootstrap_username() -> Result<String, SecretError> {
        std::env::var("VARDHAN_ADMIN_USERNAME")
            .map(|s| s.trim().to_string())
            .map_err(|_| SecretError::NotFound("VARDHAN_ADMIN_USERNAME not set".into()))
    }
}
