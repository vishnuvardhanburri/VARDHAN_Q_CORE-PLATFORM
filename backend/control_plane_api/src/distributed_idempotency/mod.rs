use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::fmt;

pub mod migrations;
pub mod postgres_store;
pub mod sled_store;

pub use postgres_store::PostgresIdempotencyStore;
pub use sled_store::SledIdempotencyStore;

/// Current lifecycle status of an idempotency reservation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LifecycleStatus {
    /// Ingress accepted, actively being validated/processed by a worker.
    Reserved,
    /// Pre-validation passed, cryptographic receipt sealing in flight.
    Sealing,
    /// Successfully sealed and committed with durable receipt.
    Sealed,
    /// Transaction or verification failed; retry may be eligible if permitted.
    Failed,
}

impl fmt::Display for LifecycleStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Reserved => write!(f, "RESERVED"),
            Self::Sealing => write!(f, "SEALING"),
            Self::Sealed => write!(f, "SEALED"),
            Self::Failed => write!(f, "FAILED"),
        }
    }
}

impl std::str::FromStr for LifecycleStatus {
    type Err = IdempotencyError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "RESERVED" => Ok(Self::Reserved),
            "SEALING" => Ok(Self::Sealing),
            "SEALED" => Ok(Self::Sealed),
            "FAILED" => Ok(Self::Failed),
            other => Err(IdempotencyError::Storage(format!(
                "unknown lifecycle status: {other}"
            ))),
        }
    }
}

/// The result of attempting to reserve an (organization_id, idempotency_key) pair.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ReservationOutcome {
    /// New reservation granted to this instance. Caller must proceed to seal.
    Reserved { reservation_id: String },
    /// Legitimate retry: already completed and sealed with identical payload hash.
    /// Returns the cached receipt response.
    AlreadySealed {
        receipt_id: String,
        cached_response: serde_json::Value,
    },
    /// In-flight: actively locked by another node or concurrent task whose lease is active.
    InFlight {
        owner_instance_id: String,
        lease_expires_at_ms: u64,
    },
    /// Conflict: same key was previously used with a DIFFERENT payload.
    PayloadMismatch {
        existing_payload_hash: String,
        submitted_payload_hash: String,
    },
    /// Replay rejected due to terminal failure or policy.
    ReplayRejected { reason: String },
}

#[derive(Debug, thiserror::Error)]
pub enum IdempotencyError {
    #[error("Storage error: {0}")]
    Storage(String),

    #[error("Database connection failed: {0}")]
    Connection(String),

    #[error("Configuration error: {0}")]
    Configuration(String),

    #[error("Serialization error: {0}")]
    Serialization(String),

    #[error("Lock acquisition timeout")]
    LockTimeout,
}

/// Authoritative distributed idempotency interface.
/// Implementations must guarantee strict atomic coordination under concurrency.
#[async_trait]
pub trait IdempotencyStore: Send + Sync {
    /// Attempt to atomically reserve a key for processing.
    async fn reserve(
        &self,
        tenant_id: &str,
        idempotency_key: &str,
        transaction_id: &str,
        payload_hash: &str,
        lease_duration_ms: u64,
        owner_instance_id: &str,
    ) -> Result<ReservationOutcome, IdempotencyError>;

    /// Transition a reservation from RESERVED to SEALING.
    async fn mark_sealing(
        &self,
        tenant_id: &str,
        idempotency_key: &str,
        transaction_id: &str,
        owner_instance_id: &str,
    ) -> Result<(), IdempotencyError>;

    /// Commit the final sealed receipt and store the response payload for idempotent retries.
    async fn commit_sealed(
        &self,
        tenant_id: &str,
        idempotency_key: &str,
        transaction_id: &str,
        receipt_id: &str,
        receipt_json: &serde_json::Value,
        owner_instance_id: &str,
    ) -> Result<(), IdempotencyError>;

    /// Release or record a failure for a reservation.
    async fn release_or_fail(
        &self,
        tenant_id: &str,
        idempotency_key: &str,
        transaction_id: &str,
        failure_reason: &str,
        owner_instance_id: &str,
    ) -> Result<(), IdempotencyError>;

    /// Health and connectivity check.
    async fn check_health(&self) -> Result<(), IdempotencyError>;

    /// Storage backend identifier for telemetry and diagnostics.
    fn backend_name(&self) -> &'static str;
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or_default()
}
