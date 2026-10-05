//! Enterprise MFA service: encrypted per-user TOTP enrollment and single-use recovery codes.
use std::sync::Arc;
use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;
use core_crypto::vault::KeyProtector;
use crate::{mfa::verify_totp, mfa_store::MfaStore};

#[derive(Debug, Clone, Serialize, Deserialize)]
struct EnrollmentRecord { secret: String, recovery_codes: Vec<String> }

#[derive(Clone)]
pub struct MfaService { store: MfaStore, protector: Arc<dyn KeyProtector> }

impl MfaService {
    pub fn new(store: MfaStore, protector: Arc<dyn KeyProtector>) -> Self { Self { store, protector } }

    pub fn enroll(&self, username: &str, secret: &str) -> Result<Vec<String>, String> {
        crate::mfa::normalize_secret(secret).map_err(|e| e.to_string())?;
        let codes = (0..10).map(|_| rand::thread_rng().sample_iter(&Alphanumeric).take(16).map(char::from).collect::<String>()).collect::<Vec<_>>();
        let record = EnrollmentRecord { secret: secret.to_ascii_uppercase(), recovery_codes: codes.clone() };
        let plaintext = serde_json::to_vec(&record).map_err(|e| e.to_string())?;
        let ciphertext = self.protector.wrap(&plaintext).map_err(|e| e.to_string())?;
        self.store.set_encrypted_secret(username, &ciphertext)?;
        Ok(codes)
    }

    pub fn verify(&self, username: &str, code: &str) -> Result<bool, String> {
        let ciphertext = self.store.get_encrypted_secret(username).ok_or_else(|| "MFA enrollment not found".to_string())?;
        let plaintext = self.protector.unwrap(&ciphertext).map_err(|e| e.to_string())?;
        let record: EnrollmentRecord = serde_json::from_slice(&plaintext).map_err(|e| format!("MFA record invalid: {e}"))?;
        if verify_totp(&record.secret, code).unwrap_or(false) { return Ok(true); }
        let normalized = code.trim().to_ascii_uppercase();
        if let Some(pos) = record.recovery_codes.iter().position(|c| c == &normalized) {
            let mut updated = record;
            updated.recovery_codes.remove(pos);
            let bytes = serde_json::to_vec(&updated).map_err(|e| e.to_string())?;
            let wrapped = self.protector.wrap(&bytes).map_err(|e| e.to_string())?;
            self.store.set_encrypted_secret(username, &wrapped)?;
            return Ok(true);
        }
        Ok(false)
    }

    pub fn disable(&self, username: &str) -> Result<bool, String> { self.store.remove(username) }
}
