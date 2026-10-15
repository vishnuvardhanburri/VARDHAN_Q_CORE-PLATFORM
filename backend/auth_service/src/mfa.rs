//! TOTP multi-factor authentication primitives.
//!
//! Secrets are accepted only as base32 and are never returned by API methods.
//! The verifier uses a constant-time comparison and a narrow clock-skew window.

use std::time::{SystemTime, UNIX_EPOCH};

use base32::Alphabet;
use hmac::{Hmac, Mac};
use sha1::Sha1;
use subtle::ConstantTimeEq;
use thiserror::Error;

const STEP_SECS: u64 = 30;
const DIGITS: u32 = 6;
const SKEW_STEPS: i64 = 1;

type HmacSha1 = Hmac<Sha1>;

#[derive(Debug, Error)]
pub enum MfaError {
    #[error("invalid base32 TOTP secret")]
    InvalidSecret,
    #[error("invalid TOTP code")]
    InvalidCode,
    #[error("system clock is before unix epoch")]
    Clock,
}

pub fn normalize_secret(secret: &str) -> Result<Vec<u8>, MfaError> {
    let compact: String = secret
        .chars()
        .filter(|c| !c.is_ascii_whitespace())
        .collect();
    base32::decode(
        Alphabet::Rfc4648 { padding: false },
        &compact.to_ascii_uppercase(),
    )
    .filter(|v| !v.is_empty())
    .ok_or(MfaError::InvalidSecret)
}

pub fn verify_totp(secret: &str, code: &str) -> Result<bool, MfaError> {
    if code.len() != DIGITS as usize || !code.bytes().all(|b| b.is_ascii_digit()) {
        return Err(MfaError::InvalidCode);
    }
    let secret = normalize_secret(secret)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| MfaError::Clock)?
        .as_secs()
        / STEP_SECS;
    for offset in -SKEW_STEPS..=SKEW_STEPS {
        let counter = if offset < 0 {
            now.saturating_sub((-offset) as u64)
        } else {
            now.saturating_add(offset as u64)
        };
        let expected = hotp(&secret, counter)?;
        if expected.as_bytes().ct_eq(code.as_bytes()).into() {
            return Ok(true);
        }
    }
    Ok(false)
}

fn hotp(secret: &[u8], counter: u64) -> Result<String, MfaError> {
    let mut mac = HmacSha1::new_from_slice(secret).map_err(|_| MfaError::InvalidSecret)?;
    mac.update(&counter.to_be_bytes());
    let digest = mac.finalize().into_bytes();
    let offset = (digest[digest.len() - 1] & 0x0f) as usize;
    let binary = ((u32::from(digest[offset]) & 0x7f) << 24)
        | (u32::from(digest[offset + 1]) << 16)
        | (u32::from(digest[offset + 2]) << 8)
        | u32::from(digest[offset + 3]);
    Ok(format!("{:06}", binary % 10u32.pow(DIGITS)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_secret_decodes() {
        let secret = normalize_secret("JBSWY3DPEHPK3PXP").unwrap();
        assert_eq!(secret, b"Hello!\xde\xad\xbe\xef".to_vec());
    }

    #[test]
    fn malformed_code_rejected() {
        assert!(matches!(
            verify_totp("JBSWY3DPEHPK3PXP", "12x456"),
            Err(MfaError::InvalidCode)
        ));
    }
}
