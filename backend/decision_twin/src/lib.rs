use authority_gate::ActionStatus;
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TwinState {
    Created,
    AssurancePending,
    RevalidationRequired,
    Authorized,
    Executing,
    Executed,
    Expired,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecisionCandidate {
    pub candidate_id: String,
    pub proposed_action: String,
    pub config_hash: String,
    pub tenant_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecisionTwin {
    pub authorization_id: String,
    pub state: TwinState,
    pub candidate: DecisionCandidate,
    pub final_status: ActionStatus,
    pub created_at: u64,
}

impl DecisionTwin {
    pub fn new(candidate: DecisionCandidate) -> Self {
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("SystemTime before UNIX_EPOCH")
            .as_millis() as u64;
        Self {
            authorization_id: format!("auth-{}", Uuid::new_v4()),
            state: TwinState::Created,
            candidate,
            final_status: ActionStatus::Indeterminate,
            created_at: now_ms,
        }
    }

    /// Enforces the lifecycle state machine defined in A8.
    pub fn transition(&mut self, new_state: TwinState) -> Result<(), String> {
        match (&self.state, &new_state) {
            (TwinState::Created, TwinState::AssurancePending) => self.state = new_state,
            (TwinState::AssurancePending, TwinState::Authorized) => {
                self.state = new_state;
                self.final_status = ActionStatus::Pass;
            }
            (TwinState::Authorized, TwinState::Executing) => self.state = new_state,
            (TwinState::Executing, TwinState::Executed) => self.state = new_state,

            // A8 Revalidation triggers
            (TwinState::Authorized, TwinState::RevalidationRequired) => {
                self.state = new_state;
                self.final_status = ActionStatus::Indeterminate;
            }
            (TwinState::RevalidationRequired, TwinState::AssurancePending) => {
                self.state = new_state
            }

            // Terminal fallback states
            (_, TwinState::Expired | TwinState::Cancelled | TwinState::Failed) => {
                self.state = new_state
            }

            _ => {
                return Err(format!(
                    "Invalid state transition from {:?} to {:?}",
                    self.state, new_state
                ));
            }
        }
        Ok(())
    }
}

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{RwLock, mpsc};

/// Thread-safe active memory storage for Decision Twins during their lifecycle.
/// Resolves immediately to the Audit Ledger upon reaching terminal states.
#[derive(Clone)]
pub struct DecisionTwinStore {
    twins: Arc<RwLock<HashMap<String, DecisionTwin>>>,
}

impl DecisionTwinStore {
    pub fn new() -> Self {
        Self {
            twins: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn insert(&self, twin: DecisionTwin) {
        let mut map = self.twins.write().await;
        map.insert(twin.authorization_id.clone(), twin);
    }

    pub async fn get(&self, auth_id: &str) -> Option<DecisionTwin> {
        let map = self.twins.read().await;
        map.get(auth_id).cloned()
    }
}

/// The inbound asynchronous queue for Intelligence models to submit candidates.
pub struct DecisionCandidateQueue {
    sender: mpsc::Sender<DecisionCandidate>,
    receiver: mpsc::Receiver<DecisionCandidate>,
}

impl DecisionCandidateQueue {
    pub fn new(capacity: usize) -> Self {
        let (sender, receiver) = mpsc::channel(capacity);
        Self { sender, receiver }
    }

    pub fn get_sender(&self) -> mpsc::Sender<DecisionCandidate> {
        self.sender.clone()
    }

    pub async fn recv(&mut self) -> Option<DecisionCandidate> {
        self.receiver.recv().await
    }
}
