//! MFA policy and challenge state machine.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::mfa::verify_totp;

const CHALLENGE_TTL: Duration = Duration::from_secs(300);

#[derive(Clone, Debug)]
pub struct MfaChallenge {
    pub id: String,
    pub username: String,
    pub expires_at: Instant,
}

#[derive(Clone, Default)]
pub struct MfaPolicy {
    required: bool,
    challenges: Arc<Mutex<HashMap<String, MfaChallenge>>>,
}

impl MfaPolicy {
    pub fn new(required: bool) -> Self {
        Self {
            required,
            challenges: Arc::new(Mutex::new(HashMap::new())),
        }
    }
    pub fn required(&self) -> bool {
        self.required
    }

    pub fn issue(&self, username: &str, id: String) -> MfaChallenge {
        let challenge = MfaChallenge {
            id: id.clone(),
            username: username.to_string(),
            expires_at: Instant::now() + CHALLENGE_TTL,
        };
        self.challenges
            .lock()
            .expect("MFA challenge mutex poisoned")
            .insert(id, challenge.clone());
        challenge
    }

    pub fn verify(&self, challenge_id: &str, code: &str, secret: &str) -> bool {
        let challenge = match self
            .challenges
            .lock()
            .expect("MFA challenge mutex poisoned")
            .remove(challenge_id)
        {
            Some(c) => c,
            None => return false,
        };
        if Instant::now() >= challenge.expires_at {
            return false;
        }
        verify_totp(secret, code).unwrap_or(false)
    }
}
