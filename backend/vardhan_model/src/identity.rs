//! # Vardhan Identity (Layer 6b)
//!
//! Canonical identity references for the Vardhan enterprise model.
//! Every entity is addressable through a stable identity that may have
//! multiple cryptographic representations (node keys, user credentials, etc.).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::RwLock;

/// A stable identity reference — the universal handle for any Vardhan principal.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct PrincipalRef {
    /// The entity_id this identity refers to (e.g., "user:abc123", "svc:backend-api")
    pub entity_id: String,
    /// Kind: human, service, node, container, device, api_client, machine, ai_agent
    pub kind: PrincipalKind,
    /// Optional cryptographic fingerprint (BLAKE3 of ML-DSA key bytes for crypto identities)
    pub crypto_fingerprint: Option<String>,
}

impl PrincipalRef {
    pub fn new(entity_id: impl Into<String>, kind: PrincipalKind) -> Self {
        Self {
            entity_id: entity_id.into(),
            kind,
            crypto_fingerprint: None,
        }
    }

    pub fn with_crypto_fingerprint(mut self, fp: impl Into<String>) -> Self {
        self.crypto_fingerprint = Some(fp.into());
        self
    }

    /// Returns the principal_id string suitable for VardhanEvent.principal_id
    pub fn id(&self) -> &str {
        &self.entity_id
    }
}

/// Kind of principal in the Vardhan identity fabric.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum PrincipalKind {
    /// A human user
    Human,
    /// A backend service or microservice
    Service,
    /// A cluster node (Raft participant)
    Node,
    /// A container (Kubernetes or Docker)
    Container,
    /// A physical or virtual device
    Device,
    /// An API client / programmatic caller
    ApiClient,
    /// A machine identity (non-human, non-service)
    Machine,
    /// An AI agent (must never receive unrestricted administrator access)
    AiAgent,
}

/// In-memory principal registry (single-node, for now).
///
/// In a production deployment this would be backed by a replicated store
/// (the Raft log). For P9.1 purposes it provides the identity reference type
/// that events and entities use.
#[derive(Clone, Default)]
pub struct PrincipalRegistry {
    inner: Arc<RwLock<HashMap<String, PrincipalRef>>>,
}

impl PrincipalRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a principal. Returns error if already registered with different kind.
    pub fn register(&self, principal: PrincipalRef) -> Result<(), IdentityError> {
        let mut map = self.inner.write().unwrap();
        if let Some(existing) = map.get(&principal.entity_id) {
            if existing.kind != principal.kind {
                return Err(IdentityError::TypeMismatch {
                    id: principal.entity_id.clone(),
                    existing: existing.kind.clone(),
                    new: principal.kind.clone(),
                });
            }
        }
        map.insert(principal.entity_id.clone(), principal);
        Ok(())
    }

    /// Look up a principal by entity_id.
    pub fn lookup(&self, entity_id: &str) -> Option<PrincipalRef> {
        self.inner.read().unwrap().get(entity_id).cloned()
    }

    /// Check whether a principal exists.
    pub fn contains(&self, entity_id: &str) -> bool {
        self.inner.read().unwrap().contains_key(entity_id)
    }

    /// Number of registered principals.
    pub fn len(&self) -> usize {
        self.inner.read().unwrap().len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// Errors from the identity fabric.
#[derive(Debug, thiserror::Error)]
pub enum IdentityError {
    #[error("principal type mismatch for {id}: existing {existing:?} vs new {new:?}")]
    TypeMismatch {
        id: String,
        existing: PrincipalKind,
        new: PrincipalKind,
    },
    #[error("principal not found: {0}")]
    NotFound(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_register_and_lookup() {
        let reg = PrincipalRegistry::new();
        let p = PrincipalRef::new("svc:api", PrincipalKind::Service);
        reg.register(p.clone()).unwrap();
        let found = reg.lookup("svc:api").unwrap();
        assert_eq!(found, p);
        assert!(reg.contains("svc:api"));
        assert_eq!(reg.len(), 1);
    }

    #[test]
    fn test_type_mismatch() {
        let reg = PrincipalRegistry::new();
        reg.register(PrincipalRef::new("node-1", PrincipalKind::Node))
            .unwrap();
        let err = reg
            .register(PrincipalRef::new("node-1", PrincipalKind::Service))
            .unwrap_err();
        assert!(matches!(err, IdentityError::TypeMismatch { .. }));
    }

    #[test]
    fn test_not_found() {
        let reg = PrincipalRegistry::new();
        assert!(!reg.contains("missing"));
        assert!(reg.lookup("missing").is_none());
    }

    #[test]
    fn test_crypto_fingerprint() {
        let p = PrincipalRef::new("user:alice", PrincipalKind::Human)
            .with_crypto_fingerprint("deadbeef");
        assert_eq!(p.crypto_fingerprint.as_deref(), Some("deadbeef"));
        assert_eq!(p.id(), "user:alice");
    }

    #[test]
    fn test_all_principal_kinds_serializable() {
        for kind in [
            PrincipalKind::Human,
            PrincipalKind::Service,
            PrincipalKind::Node,
            PrincipalKind::Container,
            PrincipalKind::Device,
            PrincipalKind::ApiClient,
            PrincipalKind::Machine,
            PrincipalKind::AiAgent,
        ] {
            let json = serde_json::to_string(&kind).unwrap();
            let back: PrincipalKind = serde_json::from_str(&json).unwrap();
            assert_eq!(kind, back);
        }
    }
}
