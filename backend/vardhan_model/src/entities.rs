//! # Vardhan Enterprise Model (Layer 6c)
//!
//! First-class typed entities representing everything of interest in the
//! enterprise: tenants, organizations, applications, services, assets,
//! identities, crypto assets, business processes, risk objects, and more.
//!
//! Each entity has a stable `EntityId` that links events to the enterprise model.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// A typed entity identifier. Format: `{entity_type}:{local_id}`.
/// Examples: "tenant:acme", "user:alice@acme", "svc:api-gateway",
/// "app:customer-portal", "node:raft-a", "crypto:ml-dsa-87:node-1"
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct EntityId(String);

impl EntityId {
    pub fn new(id: impl Into<String>) -> Self {
        EntityId(id.into())
    }

    /// Parse an entity ID string. Validates non-empty.
    pub fn parse(s: &str) -> Result<Self, EntityError> {
        if s.is_empty() {
            return Err(EntityError::EmptyId);
        }
        Ok(EntityId(s.to_string()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Extract the entity type prefix (before the first colon).
    pub fn entity_type_prefix(&self) -> Option<&str> {
        self.0.split(':').next()
    }

    /// Extract the local ID (after the first colon).
    pub fn local_id(&self) -> Option<&str> {
        self.0.split_once(':').map(|(_, rest)| rest)
    }
}

impl std::fmt::Display for EntityId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::str::FromStr for EntityId {
    type Err = EntityError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::parse(s)
    }
}

/// The universe of entity types in the Vardhan enterprise model.
/// This drives the dependency graph: relationships are typed by these.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum EntityType {
    Tenant,
    Organization,
    BusinessUnit,
    Application,
    Service,
    Asset,
    Node,
    Container,
    Identity,
    CryptoAsset,
    CryptoKey,
    Certificate,
    BusinessProcess,
    Transaction,
    Risk,
    Control,
    Policy,
    Decision,
    Action,
    Outcome,
    Incident,
    Event,
}

/// Errors from entity operations.
#[derive(Debug, thiserror::Error)]
pub enum EntityError {
    #[error("empty entity ID")]
    EmptyId,
    #[error("entity not found: {0}")]
    NotFound(String),
    #[error("entity already exists: {0}")]
    AlreadyExists(String),
    #[error("invalid entity ID format: {0}")]
    InvalidFormat(String),
}

/// Trait every enterprise entity implements.
pub trait Entity {
    /// The stable identifier of this entity.
    fn entity_id(&self) -> &EntityId;

    /// The type classification.
    fn entity_type(&self) -> EntityType;

    /// Optional tenant this entity belongs to.
    fn tenant_id(&self) -> Option<&str>;

    /// Human-readable name.
    fn name(&self) -> &str;

    /// Optional metadata tags (arbitrary key-value).
    fn tags(&self) -> &BTreeMap<String, String>;
}

// ── Re-exports ────────────────────────────────────────────────────────────────

// ── Tenant ──────────────────────────────────────────────────────────────────

/// A top-level tenant in the Vardhan platform.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Tenant {
    pub entity_id: EntityId,
    pub name: String,
    #[serde(default)]
    pub tags: BTreeMap<String, String>,
    /// Cryptographic context for this tenant (e.g., ML-DSA key fingerprint)
    #[serde(default)]
    pub crypto_context: Option<String>,
    /// Whether this tenant is active
    #[serde(default = "default_true")]
    pub active: bool,
}

fn default_true() -> bool {
    true
}

impl Entity for Tenant {
    fn entity_id(&self) -> &EntityId {
        &self.entity_id
    }
    fn entity_type(&self) -> EntityType {
        EntityType::Tenant
    }
    fn tenant_id(&self) -> Option<&str> {
        None
    } // tenants are top-level
    fn name(&self) -> &str {
        &self.name
    }
    fn tags(&self) -> &BTreeMap<String, String> {
        &self.tags
    }
}

impl Tenant {
    pub fn new(id: impl Into<String>, name: impl Into<String>) -> Self {
        Self {
            entity_id: EntityId::new(id.into()),
            name: name.into(),
            tags: BTreeMap::new(),
            crypto_context: None,
            active: true,
        }
    }

    pub fn with_tag(mut self, key: impl Into<String>, val: impl Into<String>) -> Self {
        self.tags.insert(key.into(), val.into());
        self
    }

    pub fn with_crypto_context(mut self, ctx: impl Into<String>) -> Self {
        self.crypto_context = Some(ctx.into());
        self
    }
}

// ── Organization ────────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Organization {
    pub entity_id: EntityId,
    pub tenant_id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub tags: BTreeMap<String, String>,
}

impl Entity for Organization {
    fn entity_id(&self) -> &EntityId {
        &self.entity_id
    }
    fn entity_type(&self) -> EntityType {
        EntityType::Organization
    }
    fn tenant_id(&self) -> Option<&str> {
        self.tenant_id.as_deref()
    }
    fn name(&self) -> &str {
        &self.name
    }
    fn tags(&self) -> &BTreeMap<String, String> {
        &self.tags
    }
}

// ── Business Unit ───────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct BusinessUnit {
    pub entity_id: EntityId,
    pub tenant_id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub tags: BTreeMap<String, String>,
}

impl Entity for BusinessUnit {
    fn entity_id(&self) -> &EntityId {
        &self.entity_id
    }
    fn entity_type(&self) -> EntityType {
        EntityType::BusinessUnit
    }
    fn tenant_id(&self) -> Option<&str> {
        self.tenant_id.as_deref()
    }
    fn name(&self) -> &str {
        &self.name
    }
    fn tags(&self) -> &BTreeMap<String, String> {
        &self.tags
    }
}

// ── Application ─────────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Application {
    pub entity_id: EntityId,
    pub tenant_id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub tags: BTreeMap<String, String>,
    /// The criticality tier: 1 (mission-critical) to 5 (non-production)
    pub criticality: u8,
    /// Business owner contact
    pub business_owner: Option<String>,
}

impl Entity for Application {
    fn entity_id(&self) -> &EntityId {
        &self.entity_id
    }
    fn entity_type(&self) -> EntityType {
        EntityType::Application
    }
    fn tenant_id(&self) -> Option<&str> {
        self.tenant_id.as_deref()
    }
    fn name(&self) -> &str {
        &self.name
    }
    fn tags(&self) -> &BTreeMap<String, String> {
        &self.tags
    }
}

// ── Service ─────────────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Service {
    pub entity_id: EntityId,
    pub tenant_id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub tags: BTreeMap<String, String>,
    /// The application this service belongs to
    pub application_id: Option<String>,
    /// Network endpoint (e.g., "https://api.example.com:8443")
    pub endpoint: Option<String>,
}

impl Entity for Service {
    fn entity_id(&self) -> &EntityId {
        &self.entity_id
    }
    fn entity_type(&self) -> EntityType {
        EntityType::Service
    }
    fn tenant_id(&self) -> Option<&str> {
        self.tenant_id.as_deref()
    }
    fn name(&self) -> &str {
        &self.name
    }
    fn tags(&self) -> &BTreeMap<String, String> {
        &self.tags
    }
}

// ── Asset ───────────────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Asset {
    pub entity_id: EntityId,
    pub tenant_id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub tags: BTreeMap<String, String>,
    /// Asset classification: public, internal, confidential, restricted, critical
    pub classification: String,
    /// Asset owner
    pub owner: Option<String>,
}

impl Entity for Asset {
    fn entity_id(&self) -> &EntityId {
        &self.entity_id
    }
    fn entity_type(&self) -> EntityType {
        EntityType::Asset
    }
    fn tenant_id(&self) -> Option<&str> {
        self.tenant_id.as_deref()
    }
    fn name(&self) -> &str {
        &self.name
    }
    fn tags(&self) -> &BTreeMap<String, String> {
        &self.tags
    }
}

// ── Node ────────────────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Node {
    pub entity_id: EntityId,
    pub tenant_id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub tags: BTreeMap<String, String>,
    /// Network address
    pub addr: Option<String>,
    /// Region (e.g., "us-east-1")
    pub region: Option<String>,
    /// Raft role at last known state
    pub raft_role: Option<String>,
}

impl Entity for Node {
    fn entity_id(&self) -> &EntityId {
        &self.entity_id
    }
    fn entity_type(&self) -> EntityType {
        EntityType::Node
    }
    fn tenant_id(&self) -> Option<&str> {
        self.tenant_id.as_deref()
    }
    fn name(&self) -> &str {
        &self.name
    }
    fn tags(&self) -> &BTreeMap<String, String> {
        &self.tags
    }
}

// ── Container ───────────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Container {
    pub entity_id: EntityId,
    pub tenant_id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub tags: BTreeMap<String, String>,
    /// The node this container runs on
    pub host_node_id: Option<String>,
    /// Container image
    pub image: Option<String>,
}

impl Entity for Container {
    fn entity_id(&self) -> &EntityId {
        &self.entity_id
    }
    fn entity_type(&self) -> EntityType {
        EntityType::Container
    }
    fn tenant_id(&self) -> Option<&str> {
        self.tenant_id.as_deref()
    }
    fn name(&self) -> &str {
        &self.name
    }
    fn tags(&self) -> &BTreeMap<String, String> {
        &self.tags
    }
}

// ── Identity ────────────────────────────────────────────────────────────────

/// A principal identity (human, service, node, AI agent, etc.).
/// This is separate from cryptographic key material — it is the
/// logical identity that may have multiple crypto representations over time.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Identity {
    pub entity_id: EntityId,
    pub tenant_id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub tags: BTreeMap<String, String>,
    /// Kind: human, service, node, container, device, api_client, machine, ai_agent
    pub kind: String,
    /// Current cryptographic fingerprint (BLAKE3 of ML-DSA pub key)
    pub crypto_fingerprint: Option<String>,
    /// Whether this identity can receive administrator access
    #[serde(default = "default_false")]
    pub can_admin: bool,
}

fn default_false() -> bool {
    false
}

impl Entity for Identity {
    fn entity_id(&self) -> &EntityId {
        &self.entity_id
    }
    fn entity_type(&self) -> EntityType {
        EntityType::Identity
    }
    fn tenant_id(&self) -> Option<&str> {
        self.tenant_id.as_deref()
    }
    fn name(&self) -> &str {
        &self.name
    }
    fn tags(&self) -> &BTreeMap<String, String> {
        &self.tags
    }
}

impl Identity {
    /// Create an identity. AI agents NEVER get admin by default.
    pub fn new(id: impl Into<String>, name: impl Into<String>, kind: impl Into<String>) -> Self {
        let kind_str = kind.into();
        // AI agents must never receive unrestricted administrator access
        let can_admin = kind_str != "ai_agent" && kind_str != "ai-agent";
        Self {
            entity_id: EntityId::new(id.into()),
            tenant_id: None,
            name: name.into(),
            tags: BTreeMap::new(),
            kind: kind_str,
            crypto_fingerprint: None,
            can_admin,
        }
    }
}

// ── CryptoAsset, CryptoKey, Certificate ─────────────────────────────────────

/// A cryptographic asset (e.g., an ML-DSA-87 key pair, an ML-KEM-1024 keypair).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct CryptoAsset {
    pub entity_id: EntityId,
    pub tenant_id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub tags: BTreeMap<String, String>,
    /// Algorithm: "ML-DSA-87", "ML-KEM-1024", "AES-256-GCM", "BLAKE3"
    pub algorithm: String,
    /// Fingerprint: BLAKE3 of public key bytes
    pub fingerprint: String,
    /// Lifecycle state: generated, active, rotated, revoked, destroyed
    pub lifecycle_state: String,
    /// Migration state: stable, transitioning, pending_rotation
    pub migration_state: String,
    /// The identity this crypto asset belongs to
    pub owner_identity_id: Option<String>,
}

impl Entity for CryptoAsset {
    fn entity_id(&self) -> &EntityId {
        &self.entity_id
    }
    fn entity_type(&self) -> EntityType {
        EntityType::CryptoAsset
    }
    fn tenant_id(&self) -> Option<&str> {
        self.tenant_id.as_deref()
    }
    fn name(&self) -> &str {
        &self.name
    }
    fn tags(&self) -> &BTreeMap<String, String> {
        &self.tags
    }
}

// ── BusinessProcess ─────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct BusinessProcess {
    pub entity_id: EntityId,
    pub tenant_id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub tags: BTreeMap<String, String>,
    /// Business criticality: 1 (critical) to 5 (support)
    pub criticality: u8,
    /// SLA target (seconds)
    pub sla_seconds: Option<u32>,
}

impl Entity for BusinessProcess {
    fn entity_id(&self) -> &EntityId {
        &self.entity_id
    }
    fn entity_type(&self) -> EntityType {
        EntityType::BusinessProcess
    }
    fn tenant_id(&self) -> Option<&str> {
        self.tenant_id.as_deref()
    }
    fn name(&self) -> &str {
        &self.name
    }
    fn tags(&self) -> &BTreeMap<String, String> {
        &self.tags
    }
}

// ── Remaining entity types (lightweight, for graph completeness) ────────────

macro_rules! define_simple_entity {
    ($name:ident, $et:expr, $doc:expr) => {
        #[doc = $doc]
        #[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
        pub struct $name {
            pub entity_id: EntityId,
            pub tenant_id: Option<String>,
            pub name: String,
            #[serde(default)]
            pub tags: BTreeMap<String, String>,
        }
        impl Entity for $name {
            fn entity_id(&self) -> &EntityId {
                &self.entity_id
            }
            fn entity_type(&self) -> EntityType {
                $et
            }
            fn tenant_id(&self) -> Option<&str> {
                self.tenant_id.as_deref()
            }
            fn name(&self) -> &str {
                &self.name
            }
            fn tags(&self) -> &BTreeMap<String, String> {
                &self.tags
            }
        }
    };
}

define_simple_entity!(
    CryptoKey,
    EntityType::CryptoKey,
    "A cryptographic key (e.g., ML-DSA-87 private key)."
);
define_simple_entity!(
    Certificate,
    EntityType::Certificate,
    "A cryptographic certificate."
);
define_simple_entity!(
    Transaction,
    EntityType::Transaction,
    "A business transaction (e.g., payment, request)."
);
define_simple_entity!(
    Risk,
    EntityType::Risk,
    "A quantified risk to the enterprise."
);
define_simple_entity!(
    Control,
    EntityType::Control,
    "A security or operational control."
);
define_simple_entity!(Policy, EntityType::Policy, "A policy governing behavior.");
define_simple_entity!(
    Decision,
    EntityType::Decision,
    "A decision made by the control plane."
);
define_simple_entity!(
    Action,
    EntityType::Action,
    "An action taken in response to a decision."
);
define_simple_entity!(Outcome, EntityType::Outcome, "The result of an action.");
define_simple_entity!(
    Incident,
    EntityType::Incident,
    "A security or operational incident."
);
define_simple_entity!(Event, EntityType::Event, "An event recorded in the system.");

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_entity_id_format() {
        let id = EntityId::new("svc:api-gateway");
        assert_eq!(id.entity_type_prefix(), Some("svc"));
        assert_eq!(id.local_id(), Some("api-gateway"));
    }

    #[test]
    fn test_entity_id_parse() {
        let id = EntityId::parse("tenant:acme-corp").unwrap();
        assert_eq!(id.as_str(), "tenant:acme-corp");
    }

    #[test]
    fn test_entity_id_empty_rejected() {
        assert!(EntityId::parse("").is_err());
    }

    #[test]
    fn test_tenant_entity() {
        let t = Tenant::new("tenant:acme", "Acme Corp")
            .with_tag("industry", "finance")
            .with_crypto_context("fingerprint-abc123");

        assert_eq!(t.entity_type(), EntityType::Tenant);
        assert_eq!(t.tenant_id(), None); // tenants are top-level
        assert_eq!(t.name(), "Acme Corp");
        assert_eq!(t.tags().get("industry"), Some(&"finance".to_string()));
        assert!(t.active);
    }

    #[test]
    fn test_service_entity() {
        let s = Service {
            entity_id: EntityId::new("svc:api-gateway"),
            tenant_id: Some("tenant:acme".to_string()),
            name: "API Gateway".to_string(),
            tags: BTreeMap::new(),
            application_id: Some("app:platform".to_string()),
            endpoint: Some("https://api.acme.com:8443".to_string()),
        };

        assert_eq!(s.entity_type(), EntityType::Service);
        assert_eq!(s.tenant_id(), Some("tenant:acme"));
        assert_eq!(s.name(), "API Gateway");
    }

    #[test]
    fn test_identity_ai_agent_no_admin() {
        let ai = Identity::new("ai:analyst", "Analyst Bot", "ai_agent");
        assert!(!ai.can_admin, "AI agents must never get admin");
        assert_eq!(ai.kind, "ai_agent");
        assert_eq!(ai.entity_type(), EntityType::Identity);
    }

    #[test]
    fn test_identity_human_can_admin() {
        let human = Identity::new("user:alice", "Alice", "human");
        assert!(human.can_admin, "Humans can receive admin access");
    }

    #[test]
    fn test_all_entity_types_exist() {
        // Ensure all EntityType variants exist
        let _ = EntityType::Tenant;
        let _ = EntityType::Organization;
        let _ = EntityType::BusinessUnit;
        let _ = EntityType::Application;
        let _ = EntityType::Service;
        let _ = EntityType::Asset;
        let _ = EntityType::Node;
        let _ = EntityType::Container;
        let _ = EntityType::Identity;
        let _ = EntityType::CryptoAsset;
        let _ = EntityType::CryptoKey;
        let _ = EntityType::Certificate;
        let _ = EntityType::BusinessProcess;
        let _ = EntityType::Transaction;
        let _ = EntityType::Risk;
        let _ = EntityType::Control;
        let _ = EntityType::Policy;
        let _ = EntityType::Decision;
        let _ = EntityType::Action;
        let _ = EntityType::Outcome;
        let _ = EntityType::Incident;
        let _ = EntityType::Event;
    }

    #[test]
    fn test_serialization_roundtrip() {
        let t = Tenant::new("tenant:test", "Test Tenant").with_crypto_context("ctx-1");
        let json = serde_json::to_string(&t).unwrap();
        let back: Tenant = serde_json::from_str(&json).unwrap();
        assert_eq!(t, back);
    }
}
