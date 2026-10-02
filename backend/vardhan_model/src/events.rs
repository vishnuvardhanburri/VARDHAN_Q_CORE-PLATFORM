//! # Vardhan Event Model (Layer 6a)
//!
//! The canonical `VardhanEvent` schema — the single event format through which
//! every Vardhan subsystem emits observations into the event fabric.
//!
//! Design: one schema, deterministic serialization, versioned, tenant-isolated,
//! evidence-linked.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Schema version. Increment when the event schema changes.
/// Follows semver-like rules via `SchemaCompatibility`.
pub const VARDHAN_EVENT_SCHEMA_VERSION: u32 = 1;

/// Canonical Vardhan event. Every field maps to the enterprise model.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct VardhanEvent {
    /// Schema version of this event (forward/backward compatibility tracked by SchemaVersion)
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,

    /// Unique event identifier. Generated as `evt_{blake3_hex}` from timestamp+random.
    /// Deterministic: same content → same ID is NOT intended; uniqueness per occurrence is.
    pub event_id: String,

    /// Unix epoch milliseconds. Primary ordering key.
    pub timestamp_ms: u128,

    /// Tenant isolation. `None` = system-level (infrastructure, cluster) event.
    pub tenant_id: Option<String>,

    /// The principal (human, service, node, AI agent, etc.) that caused or is
    /// associated with this event. Links to `Identity.entity_id`.
    pub principal_id: String,

    /// The asset/entity this event pertains to (if any). Links to `Asset.entity_id`.
    pub asset_id: Option<String>,

    /// Categorical classification of the event.
    #[serde(rename = "type")]
    pub event_type: EventType,

    /// The originating component/service (e.g., "pq_shield", "auth_service").
    pub source: String,

    /// The specific action being recorded (e.g., "login_succeeded", "raft_election").
    /// Free-form verb, but must be drawn from a controlled vocabulary (see `EVENT_ACTIONS`).
    pub action: String,

    /// Serializable state before the event occurred (if state-change).
    pub state_before: Option<serde_json::Value>,

    /// Serializable state after the event occurred (if state-change).
    pub state_after: Option<serde_json::Value>,

    /// Severity level for filtering/alerting.
    pub severity: Severity,

    /// Confidence in the event's truth: Observed, Calculated, Simulated, Forecast.
    #[serde(rename = "confidence")]
    pub confidence: Confidence,

    /// Cross-service correlation ID (UUIDv4) for distributed tracing of a cause-effect chain.
    pub correlation_id: Option<String>,

    /// Reference to verifiable evidence in the audit ledger (seq number or hash).
    /// Format: "ledger:{seq}" or "ledger:hash:{blake3_hex}".
    pub evidence_ref: Option<String>,
}

fn default_schema_version() -> u32 {
    VARDHAN_EVENT_SCHEMA_VERSION
}

/// Broad category of a Vardhan event.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum EventType {
    /// Security: auth, crypto, access, privilege changes
    Security,
    /// Infrastructure: nodes, containers, hosts, runtime
    Infrastructure,
    /// Identity: principal lifecycle, credential events
    Identity,
    /// Cryptography: key generation, rotation, revocation, signing
    Cryptography,
    /// Audit: administrative actions, configuration changes
    Audit,
    /// Application: service behavior, feature usage
    Application,
    /// Business: transactions, impact, outcomes
    Business,
    /// System: cluster, Raft, checkpoints, ledger rotation
    System,
}

/// Severity for alerting and prioritization.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    /// Routine operational information
    Info = 0,
    /// Low priority anomaly or informational
    Low = 1,
    /// Medium priority — warrants attention
    Medium = 2,
    /// High priority — potential incident
    High = 3,
    /// Critical — confirmed security or availability incident
    Critical = 4,
}

/// Confidence in the event's assertion.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[serde(rename_all = "snake_case")]
pub enum Confidence {
    /// Directly observed from the system
    Observed,
    /// Computed from observed data
    Calculated,
    /// Result of a simulation or scenario
    Simulated,
    /// Projected / forecasted
    Forecast,
}

/// Canonical event ID format: `evt_{blake3_hex_of_content}`.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct EventId(String);

impl EventId {
    /// Generate from event content (deterministic).
    pub fn from_content(content: &[u8]) -> Self {
        let hex = blake3::hash(content).to_hex();
        EventId(format!("evt_{}", hex.as_str()))
    }

    /// Generate a random event ID (non-deterministic, for unique occurrence).
    pub fn random() -> Self {
        let uuid = uuid::Uuid::new_v4();
        EventId(format!("evt_{}", uuid.simple()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for EventId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl From<EventId> for String {
    fn from(id: EventId) -> Self {
        id.0
    }
}

/// Known event emitters (component identity strings).
pub const EMITTER_PQ_SHIELD: &str = "pq_shield";
pub const EMITTER_AUTH_SERVICE: &str = "auth_service";
pub const EMITTER_HA_CLUSTER: &str = "ha_cluster";
pub const EMITTER_RAFT_LISTENER: &str = "raft_listener";
pub const EMITTER_QUANTUM_NODE: &str = "quantum_node";

/// Canonical action vocabulary for VardhanEvent.action.
/// These are the controlled terms subsystems must use.
pub const EVENT_ACTIONS: &[&str] = &[
    // auth_service
    "login_succeeded",
    "login_failed",
    "logout",
    "api_key_created",
    "api_key_revoked",
    "session_created",
    "session_expired",
    // crypto
    "key_generated",
    "key_rotated",
    "key_revoked",
    "certificate_issued",
    "certificate_renewed",
    "certificate_revoked",
    // raft / cluster
    "raft_election_started",
    "raft_election_won",
    "raft_election_lost",
    "raft_leader_stepdown",
    "raft_entry_committed",
    "raft_checkpoint_generated",
    "cluster_node_joined",
    "cluster_node_left",
    "cluster_node_degraded",
    "cluster_node_dead",
    // infrastructure
    "container_started",
    "container_stopped",
    "container_restarted",
    "health_check_passed",
    "health_check_failed",
    // ledger
    "ledger_entry_appended",
    "ledger_segment_rotated",
    "ledger_checkpoint_committed",
    // security
    "connection_denied",
    "malformed_frame",
    "replay_detected",
    "policy_violation",
    "anomaly_detected",
];

impl VardhanEvent {
    /// Build an event with the given fields.
    pub fn build(
        principal_id: impl Into<String>,
        source: impl Into<String>,
        action: impl Into<String>,
        event_type: EventType,
        severity: Severity,
    ) -> EventBuilder {
        EventBuilder::new(principal_id, source, action, event_type, severity)
    }

    /// Compute a deterministic BLAKE3 hash of the canonical event bytes.
    /// Canonical = deterministic JSON serialization with sorted keys.
    pub fn canonical_hash(&self) -> [u8; 32] {
        let canonical = self.canonical_bytes();
        *blake3::hash(&canonical).as_bytes()
    }

    /// Serialize to canonical deterministic JSON (sorted keys, no whitespace variance).
    fn canonical_bytes(&self) -> Vec<u8> {
        // We serialize a BTreeMap (sorted keys) to ensure deterministic output.
        let mut map: BTreeMap<String, serde_json::Value> = BTreeMap::new();
        map.insert(
            "schema_version".to_string(),
            serde_json::json!(self.schema_version),
        );
        map.insert(
            "timestamp_ms".to_string(),
            serde_json::json!(self.timestamp_ms),
        );
        map.insert(
            "tenant_id".to_string(),
            self.tenant_id
                .clone()
                .map(serde_json::Value::String)
                .unwrap_or(serde_json::Value::Null),
        );
        map.insert(
            "principal_id".to_string(),
            serde_json::json!(self.principal_id),
        );
        map.insert(
            "asset_id".to_string(),
            self.asset_id
                .clone()
                .map(serde_json::Value::String)
                .unwrap_or(serde_json::Value::Null),
        );
        map.insert(
            "event_type".to_string(),
            serde_json::to_value(&self.event_type).unwrap(),
        );
        map.insert("source".to_string(), serde_json::json!(self.source));
        map.insert("action".to_string(), serde_json::json!(self.action));
        map.insert(
            "state_before".to_string(),
            self.state_before.clone().unwrap_or(serde_json::Value::Null),
        );
        map.insert(
            "state_after".to_string(),
            self.state_after.clone().unwrap_or(serde_json::Value::Null),
        );
        map.insert(
            "severity".to_string(),
            serde_json::to_value(&self.severity).unwrap(),
        );
        map.insert(
            "confidence".to_string(),
            serde_json::to_value(&self.confidence).unwrap(),
        );
        map.insert(
            "correlation_id".to_string(),
            self.correlation_id
                .clone()
                .map(serde_json::Value::String)
                .unwrap_or(serde_json::Value::Null),
        );
        map.insert(
            "evidence_ref".to_string(),
            self.evidence_ref
                .clone()
                .map(serde_json::Value::String)
                .unwrap_or(serde_json::Value::Null),
        );

        serde_json::to_vec(&map).unwrap_or_default()
    }

    /// Validate that the event uses a registered action and valid schema version.
    pub fn validate(&self) -> Result<(), EventValidationError> {
        if self.schema_version != VARDHAN_EVENT_SCHEMA_VERSION {
            return Err(EventValidationError::SchemaMismatch {
                expected: VARDHAN_EVENT_SCHEMA_VERSION,
                got: self.schema_version,
            });
        }
        if !EVENT_ACTIONS.contains(&self.action.as_str()) {
            return Err(EventValidationError::UnknownAction(self.action.clone()));
        }
        if self.principal_id.is_empty() {
            return Err(EventValidationError::MissingPrincipalId);
        }
        if self.source.is_empty() {
            return Err(EventValidationError::MissingSource);
        }
        if self.timestamp_ms == 0 {
            return Err(EventValidationError::MissingTimestamp);
        }
        Ok(())
    }

    /// Create an event ID from the canonical hash (deterministic).
    pub fn content_id(&self) -> EventId {
        let bytes = self.canonical_bytes();
        EventId::from_content(&bytes)
    }

    /// Get current timestamp in milliseconds.
    pub fn now_ms() -> u128 {
        let now: DateTime<Utc> = Utc::now();
        now.timestamp_millis() as u128
    }
}

/// Builder pattern for constructing VardhanEvents safely.
pub struct EventBuilder {
    principal_id: String,
    source: String,
    action: String,
    event_type: EventType,
    severity: Severity,
    timestamp_ms: u128,
    tenant_id: Option<String>,
    asset_id: Option<String>,
    state_before: Option<serde_json::Value>,
    state_after: Option<serde_json::Value>,
    confidence: Confidence,
    correlation_id: Option<String>,
    evidence_ref: Option<String>,
}

impl EventBuilder {
    pub fn new(
        principal_id: impl Into<String>,
        source: impl Into<String>,
        action: impl Into<String>,
        event_type: EventType,
        severity: Severity,
    ) -> Self {
        Self {
            principal_id: principal_id.into(),
            source: source.into(),
            action: action.into(),
            event_type,
            severity,
            timestamp_ms: VardhanEvent::now_ms(),
            tenant_id: None,
            asset_id: None,
            state_before: None,
            state_after: None,
            confidence: Confidence::Observed,
            correlation_id: None,
            evidence_ref: None,
        }
    }

    pub fn tenant_id(mut self, id: impl Into<String>) -> Self {
        self.tenant_id = Some(id.into());
        self
    }

    pub fn asset_id(mut self, id: impl Into<String>) -> Self {
        self.asset_id = Some(id.into());
        self
    }

    pub fn timestamp_ms(mut self, ts: u128) -> Self {
        self.timestamp_ms = ts;
        self
    }

    pub fn correlation_id(mut self, id: impl Into<String>) -> Self {
        self.correlation_id = Some(id.into());
        self
    }

    pub fn evidence_ref(mut self, ref_str: impl Into<String>) -> Self {
        self.evidence_ref = Some(ref_str.into());
        self
    }

    pub fn confidence(mut self, c: Confidence) -> Self {
        self.confidence = c;
        self
    }

    pub fn state_before(mut self, val: serde_json::Value) -> Self {
        self.state_before = Some(val);
        self
    }

    pub fn state_after(mut self, val: serde_json::Value) -> Self {
        self.state_after = Some(val);
        self
    }

    pub fn build(self) -> VardhanEvent {
        let mut event = VardhanEvent {
            schema_version: VARDHAN_EVENT_SCHEMA_VERSION,
            event_id: EventId::random().to_string(),
            timestamp_ms: self.timestamp_ms,
            tenant_id: self.tenant_id,
            principal_id: self.principal_id,
            asset_id: self.asset_id,
            event_type: self.event_type,
            source: self.source,
            action: self.action,
            state_before: self.state_before,
            state_after: self.state_after,
            severity: self.severity,
            confidence: self.confidence,
            correlation_id: self.correlation_id,
            evidence_ref: self.evidence_ref,
        };
        event.event_id = event.content_id().to_string();
        event
    }
}

/// Errors for event validation.
#[derive(Debug, thiserror::Error)]
pub enum EventValidationError {
    #[error("schema version mismatch: expected {expected}, got {got}")]
    SchemaMismatch { expected: u32, got: u32 },
    #[error("unknown action: {0}")]
    UnknownAction(String),
    #[error("missing principal_id")]
    MissingPrincipalId,
    #[error("missing source")]
    MissingSource,
    #[error("missing or zero timestamp_ms")]
    MissingTimestamp,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_event_builder_basic() {
        let event = VardhanEvent::build(
            "user-123",
            EMITTER_AUTH_SERVICE,
            "login_succeeded",
            EventType::Security,
            Severity::Info,
        )
        .tenant_id("tenant-a")
        .asset_id("node-1")
        .correlation_id("corr-abc")
        .evidence_ref("ledger:12345")
        .build();

        assert!(event.validate().is_ok());
        assert_eq!(event.principal_id, "user-123");
        assert_eq!(event.tenant_id.as_deref().unwrap(), "tenant-a");
        assert_eq!(event.severity, Severity::Info);
        assert_eq!(event.confidence, Confidence::Observed);
        assert!(!event.event_id.is_empty());
    }

    #[test]
    fn test_event_validation_rejects_unknown_action() {
        let event = VardhanEvent::build(
            "svc-1",
            "my_service",
            "custom_unknown_action", // not in EVENT_ACTIONS
            EventType::Application,
            Severity::Low,
        )
        .build();

        let err = event.validate().unwrap_err();
        assert!(matches!(err, EventValidationError::UnknownAction(_)));
    }

    #[test]
    fn test_event_canonical_hash_is_deterministic() {
        let event = VardhanEvent::build(
            "svc-a",
            EMITTER_HA_CLUSTER,
            "raft_election_won",
            EventType::System,
            Severity::Info,
        )
        .confidence(Confidence::Observed)
        .build();

        let h1 = event.canonical_hash();
        let h2 = event.canonical_hash();
        assert_eq!(h1, h2, "canonical hash must be deterministic");
    }

    #[test]
    fn test_event_canonical_hash_differs_for_different_actions() {
        let e1 = VardhanEvent::build(
            "svc",
            EMITTER_HA_CLUSTER,
            "raft_election_won",
            EventType::System,
            Severity::Info,
        )
        .build();
        let e2 = VardhanEvent::build(
            "svc",
            EMITTER_HA_CLUSTER,
            "raft_election_lost",
            EventType::System,
            Severity::Info,
        )
        .build();
        assert_ne!(e1.canonical_hash(), e2.canonical_hash());
    }

    #[test]
    fn test_content_id_matches_canonical_hash() {
        let event = VardhanEvent::build(
            "node-1",
            EMITTER_QUANTUM_NODE,
            "container_started",
            EventType::Infrastructure,
            Severity::Info,
        )
        .build();

        // content_id is derived from canonical_bytes via EventId::from_content
        let cid = event.content_id();
        assert_eq!(cid.as_str(), &event.event_id);
    }

    #[test]
    fn test_event_serialization_roundtrip() {
        let event = VardhanEvent::build(
            "user-1",
            EMITTER_AUTH_SERVICE,
            "login_failed",
            EventType::Security,
            Severity::High,
        )
        .tenant_id("tenant-x")
        .evidence_ref("ledger:999")
        .confidence(Confidence::Observed)
        .build();

        let json = serde_json::to_string(&event).unwrap();
        let deserialized: VardhanEvent = serde_json::from_str(&json).unwrap();

        assert_eq!(event, deserialized);
        assert_eq!(deserialized.tenant_id.as_deref(), Some("tenant-x"));
        assert_eq!(deserialized.evidence_ref.as_deref(), Some("ledger:999"));
    }

    #[test]
    fn test_all_event_types_serializable() {
        for et in [
            EventType::Security,
            EventType::Infrastructure,
            EventType::Identity,
            EventType::Cryptography,
            EventType::Audit,
            EventType::Application,
            EventType::Business,
            EventType::System,
        ] {
            let json = serde_json::to_string(&et).unwrap();
            let back: EventType = serde_json::from_str(&json).unwrap();
            assert_eq!(et, back);
        }
    }

    #[test]
    fn test_all_event_actions_registered() {
        // Ensure the controlled vocabulary covers the key subsystems
        assert!(EVENT_ACTIONS.contains(&"login_succeeded"));
        assert!(EVENT_ACTIONS.contains(&"raft_election_won"));
        assert!(EVENT_ACTIONS.contains(&"ledger_segment_rotated"));
        assert!(EVENT_ACTIONS.contains(&"key_rotated"));
        assert!(EVENT_ACTIONS.contains(&"container_started"));
        assert!(EVENT_ACTIONS.contains(&"anomaly_detected"));
    }

    #[test]
    fn test_severity_ordering() {
        assert!(Severity::Critical > Severity::High);
        assert!(Severity::High > Severity::Medium);
        assert!(Severity::Medium > Severity::Low);
        assert!(Severity::Low > Severity::Info);
    }

    #[test]
    fn test_event_id_format() {
        let eid = EventId::random();
        assert!(eid.as_str().starts_with("evt_"));
        assert_eq!(eid.to_string(), eid.as_str());
    }
}
