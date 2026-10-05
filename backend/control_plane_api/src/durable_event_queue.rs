use blake3::Hasher;
use serde::{Deserialize, Serialize};
use sled::Db;
use std::sync::Arc;
use thiserror::Error;

const PREFIX: &[u8] = b"qcore:event:";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum EventState {
    Pending,
    InFlight,
    Acked,
    DeadLetter,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DurableEvent {
    pub organization_id: String,
    pub event_id: String,
    pub kind: String,
    pub payload_hash: String,
    pub payload: Vec<u8>,
    pub state: EventState,
    pub attempts: u32,
    pub available_at_ms: u64,
    pub last_error: Option<String>,
}

#[derive(Debug, Error)]
pub enum QueueError {
    #[error("organization id is required")]
    MissingOrganization,
    #[error("event kind is required")]
    MissingKind,
    #[error("event already exists with conflicting content")]
    Conflict,
    #[error("event not found")]
    NotFound,
    #[error("event is not claimable")]
    NotClaimable,
    #[error("event has reached its retry limit")]
    Poison,
    #[error("event storage failed: {0}")]
    Storage(#[from] sled::Error),
    #[error("event serialization failed: {0}")]
    Serialization(String),
    #[error("compare-and-swap failed: {0}")]
    CompareAndSwap(String),
}

#[derive(Clone)]
pub struct DurableEventQueue {
    db: Arc<Db>,
    max_attempts: u32,
}

impl DurableEventQueue {
    pub fn new(db: Arc<Db>) -> Self {
        Self { db, max_attempts: 5 }
    }

    pub fn with_max_attempts(db: Arc<Db>, max_attempts: u32) -> Self {
        Self { db, max_attempts: max_attempts.max(1) }
    }

    pub fn deterministic_id(organization_id: &str, kind: &str, payload: &[u8]) -> String {
        let mut h = Hasher::new();
        h.update(organization_id.as_bytes());
        h.update(&[0]);
        h.update(kind.as_bytes());
        h.update(&[0]);
        h.update(payload);
        h.finalize().to_hex().to_string()
    }

    pub fn enqueue(
        &self,
        organization_id: &str,
        kind: &str,
        payload: Vec<u8>,
        available_at_ms: u64,
    ) -> Result<String, QueueError> {
        if organization_id.trim().is_empty() {
            return Err(QueueError::MissingOrganization);
        }
        if kind.trim().is_empty() {
            return Err(QueueError::MissingKind);
        }
        let event_id = Self::deterministic_id(organization_id, kind, &payload);
        let payload_hash = blake3::hash(&payload).to_hex().to_string();
        let event = DurableEvent {
            organization_id: organization_id.to_owned(),
            event_id: event_id.clone(),
            kind: kind.to_owned(),
            payload_hash,
            payload,
            state: EventState::Pending,
            attempts: 0,
            available_at_ms,
            last_error: None,
        };
        let key = event_key(organization_id, &event_id);
        let encoded = serde_json::to_vec(&event).map_err(|e| QueueError::Serialization(e.to_string()))?;
        if let Some(existing) = self.db.get(&key)? {
            let previous: DurableEvent = serde_json::from_slice(&existing).map_err(|e| QueueError::Serialization(e.to_string()))?;
            if previous.payload_hash == event.payload_hash && previous.kind == event.kind {
                return Ok(event_id);
            }
            return Err(QueueError::Conflict);
        }
        self.db.insert(key, encoded)?;
        self.db.flush()?;
        Ok(event_id)
    }

    pub fn claim_next(&self, organization_id: &str, now_ms: u64) -> Result<Option<DurableEvent>, QueueError> {
        let prefix = org_prefix(organization_id);
        let mut candidates = Vec::new();
        for entry in self.db.scan_prefix(&prefix) {
            let (key, value) = entry?;
            let event: DurableEvent = serde_json::from_slice(&value).map_err(|e| QueueError::Serialization(e.to_string()))?;
            if event.state == EventState::Pending && event.available_at_ms <= now_ms {
                candidates.push((key, event));
            }
        }
        candidates.sort_by_key(|(_, event)| (event.available_at_ms, event.event_id.clone()));
        for (key, mut event) in candidates {
            event.state = EventState::InFlight;
            event.attempts = event.attempts.saturating_add(1);
            let previous = match self.db.get(&key)? {
                Some(value) => value,
                None => continue,
            };
            let encoded = serde_json::to_vec(&event).map_err(|e| QueueError::Serialization(e.to_string()))?;
            match self.db.compare_and_swap(&key, Some(previous.as_ref()), Some(encoded.as_slice())) {
                Ok(Ok(_)) => {
                    self.db.flush()?;
                    return Ok(Some(event));
                }
                Ok(Err(_)) => {
                    // Another worker claimed this event; try the next candidate.
                    continue;
                }
                Err(error) => return Err(QueueError::Storage(error)),
            }
        }
        Ok(None)
    }

    pub fn ack(&self, organization_id: &str, event_id: &str) -> Result<(), QueueError> {
        self.transition(organization_id, event_id, EventState::Acked, None)
    }

    pub fn requeue(
        &self,
        organization_id: &str,
        event_id: &str,
        now_ms: u64,
        error: &str,
    ) -> Result<EventState, QueueError> {
        let key = event_key(organization_id, event_id);
        let Some(value) = self.db.get(&key)? else { return Err(QueueError::NotFound); };
        let mut event: DurableEvent = serde_json::from_slice(&value).map_err(|e| QueueError::Serialization(e.to_string()))?;
        if event.state != EventState::InFlight {
            return Err(QueueError::NotClaimable);
        }
        if event.attempts >= self.max_attempts {
            event.state = EventState::DeadLetter;
            event.last_error = Some(error.to_owned());
        } else {
            event.state = EventState::Pending;
            let backoff = 1_000u64.saturating_mul(2u64.saturating_pow(event.attempts.min(10)));
            event.available_at_ms = now_ms.saturating_add(backoff);
            event.last_error = Some(error.to_owned());
        }
        let state = event.state.clone();
        self.db.insert(key, serde_json::to_vec(&event).map_err(|e| QueueError::Serialization(e.to_string()))?)?;
        self.db.flush()?;
        Ok(state)
    }

    pub fn get(&self, organization_id: &str, event_id: &str) -> Result<DurableEvent, QueueError> {
        let Some(value) = self.db.get(event_key(organization_id, event_id))? else { return Err(QueueError::NotFound); };
        serde_json::from_slice(&value).map_err(|e| QueueError::Serialization(e.to_string()))
    }

    fn transition(
        &self,
        organization_id: &str,
        event_id: &str,
        next: EventState,
        error: Option<String>,
    ) -> Result<(), QueueError> {
        let key = event_key(organization_id, event_id);
        let Some(value) = self.db.get(&key)? else { return Err(QueueError::NotFound); };
        let mut event: DurableEvent = serde_json::from_slice(&value).map_err(|e| QueueError::Serialization(e.to_string()))?;
        if event.state != EventState::InFlight {
            return Err(QueueError::NotClaimable);
        }
        event.state = next;
        event.last_error = error;
        self.db.insert(key, serde_json::to_vec(&event).map_err(|e| QueueError::Serialization(e.to_string()))?)?;
        self.db.flush()?;
        Ok(())
    }
}

fn org_prefix(org: &str) -> Vec<u8> {
    let mut out = PREFIX.to_vec();
    out.extend_from_slice(org.as_bytes());
    out.push(b':');
    out
}

fn event_key(org: &str, event_id: &str) -> Vec<u8> {
    let mut out = org_prefix(org);
    out.extend_from_slice(event_id.as_bytes());
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Arc<Db> { Arc::new(sled::Config::new().temporary(true).open().unwrap()) }

    #[test]
    fn duplicate_enqueue_is_idempotent() {
        let q = DurableEventQueue::new(db());
        let a = q.enqueue("org-a", "receipt.verified", b"one".to_vec(), 1).unwrap();
        let b = q.enqueue("org-a", "receipt.verified", b"one".to_vec(), 1).unwrap();
        assert_eq!(a, b);
        assert!(matches!(q.get("org-a", &a).unwrap().state, EventState::Pending));
    }

    #[test]
    fn different_payload_cannot_reuse_event_identity() {
        let q = DurableEventQueue::new(db());
        let first = q.enqueue("org-a", "receipt.verified", b"one".to_vec(), 1).unwrap();
        let second = q.enqueue("org-a", "receipt.verified", b"two".to_vec(), 1).unwrap();
        assert_ne!(first, second);
    }

    #[test]
    fn claim_ack_and_order_are_durable() {
        let db = db();
        let q = DurableEventQueue::new(db.clone());
        let first = q.enqueue("org-a", "a", b"1".to_vec(), 1).unwrap();
        let second = q.enqueue("org-a", "b", b"2".to_vec(), 2).unwrap();
        let claimed = q.claim_next("org-a", 2).unwrap().unwrap();
        assert_eq!(claimed.event_id, first);
        q.ack("org-a", &first).unwrap();
        let claimed2 = q.claim_next("org-a", 2).unwrap().unwrap();
        assert_eq!(claimed2.event_id, second);
        let q2 = DurableEventQueue::new(db);
        assert_eq!(q2.get("org-a", &first).unwrap().state, EventState::Acked);
    }

    #[test]
    fn retries_backoff_and_poison_after_limit() {
        let q = DurableEventQueue::with_max_attempts(db(), 2);
        let id = q.enqueue("org-a", "x", b"x".to_vec(), 1).unwrap();
        let _ = q.claim_next("org-a", 1).unwrap().unwrap();
        assert_eq!(q.requeue("org-a", &id, 1, "first").unwrap(), EventState::Pending);
        let _ = q.claim_next("org-a", 3_001).unwrap().unwrap();
        assert_eq!(q.requeue("org-a", &id, 3_001, "second").unwrap(), EventState::DeadLetter);
        assert_eq!(q.get("org-a", &id).unwrap().state, EventState::DeadLetter);
    }

    #[test]
    fn claim_is_tenant_scoped() {
        let q = DurableEventQueue::new(db());
        q.enqueue("org-a", "x", b"a".to_vec(), 1).unwrap();
        assert!(q.claim_next("org-b", 1).unwrap().is_none());
    }
}
