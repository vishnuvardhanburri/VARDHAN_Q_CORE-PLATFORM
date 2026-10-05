use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use sled::Db;
use std::time::{SystemTime, UNIX_EPOCH};

const EVENT_PREFIX: &[u8] = b"billing:event:";
const WEBHOOK_TTL_SECS: u64 = 300;

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SubscriptionState {
    Provisioning,
    AwaitingBillingActivation,
    Trialing,
    Active,
    PastDue,
    Suspended,
    Canceled,
    Expired,
}

impl SubscriptionState {
    pub fn allows_entitlements(&self) -> bool {
        matches!(self, Self::Trialing | Self::Active)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BillingEvent {
    pub event_id: String,
    pub provider: String,
    pub event_type: String,
    pub organization_id: String,
    pub plan_id: Option<String>,
    pub external_customer_id: Option<String>,
    pub external_subscription_id: Option<String>,
    pub status: SubscriptionState,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BillingWebhookResult {
    pub accepted: bool,
    pub duplicate: bool,
    pub event_id: String,
}

pub trait BillingProviderAdapter: Send + Sync {
    fn name(&self) -> &'static str;
    fn verify_signature(&self, payload: &[u8], signature: &str, secret: &[u8]) -> bool;
}

pub struct HmacBillingProvider;

impl BillingProviderAdapter for HmacBillingProvider {
    fn name(&self) -> &'static str { "hmac" }

    fn verify_signature(&self, payload: &[u8], signature: &str, secret: &[u8]) -> bool {
        let supplied = match hex::decode(signature.trim()) {
            Ok(v) => v,
            Err(_) => return false,
        };
        let mut mac = match HmacSha256::new_from_slice(secret) {
            Ok(v) => v,
            Err(_) => return false,
        };
        mac.update(payload);
        mac.verify_slice(&supplied).is_ok()
    }
}

pub fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

pub fn verify_timestamp(timestamp: u64, now: u64) -> bool {
    timestamp <= now.saturating_add(WEBHOOK_TTL_SECS)
        && now.saturating_sub(timestamp) <= WEBHOOK_TTL_SECS
}

pub fn event_key(event_id: &str) -> Vec<u8> {
    let mut key = EVENT_PREFIX.to_vec();
    key.extend_from_slice(event_id.as_bytes());
    key
}

pub fn accept_event_once(db: &Db, event_id: &str, timestamp: u64) -> Result<bool, String> {
    if event_id.trim().is_empty() {
        return Err("billing event_id is required".into());
    }
    let key = event_key(event_id);
    if db.get(&key).map_err(|e| e.to_string())?.is_some() {
        return Ok(false);
    }
    db.insert(key, timestamp.to_be_bytes().as_slice()).map_err(|e| e.to_string())?;
    db.flush().map_err(|e| e.to_string())?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sled::Config;

    #[test]
    fn state_machine_only_active_and_trialing_receive_entitlements() {
        assert!(SubscriptionState::Active.allows_entitlements());
        assert!(SubscriptionState::Trialing.allows_entitlements());
        assert!(!SubscriptionState::PastDue.allows_entitlements());
        assert!(!SubscriptionState::Canceled.allows_entitlements());
    }

    #[test]
    fn webhook_signature_and_timestamp_are_verified() {
        let payload = br#"{"event":"ok"}"#;
        let secret = b"test-secret";
        let mut mac = HmacSha256::new_from_slice(secret).unwrap();
        mac.update(payload);
        let signature = hex::encode(mac.finalize().into_bytes());
        let adapter = HmacBillingProvider;
        assert!(adapter.verify_signature(payload, &signature, secret));
        assert!(!adapter.verify_signature(payload, "00", secret));
        assert!(verify_timestamp(1000, 1000));
        assert!(!verify_timestamp(1, 1000));
    }

    #[test]
    fn webhook_event_is_idempotent() {
        let db = Config::new().temporary(true).open().unwrap();
        assert!(accept_event_once(&db, "evt-1", 100).unwrap());
        assert!(!accept_event_once(&db, "evt-1", 100).unwrap());
    }
}
