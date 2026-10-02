use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct TenantId(pub String);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct StateHash(pub String);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct ConfigurationHash(pub String);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct Signature(pub String);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct NodeId(pub String);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct SessionId(pub String);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ReasonCode {
    pub code: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ComponentId {
    Node(NodeId),
    Session(SessionId),
    GlobalCluster,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ActionId {
    DrainNode,
    RevokeSession,
    // Future actions...
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum PrimitiveParameters {
    DrainNode {
        node_id: NodeId,
        graceful_timeout_ms: u64,
    },
    RevokeSession {
        session_id: SessionId,
        reason: ReasonCode,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ReversibilityModel {
    FullyReversible,
    ManualInterventionRequired,
    Irreversible,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum BlastRadiusDescriptor {
    SingleSession,
    SingleNode,
    ClusterWide,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct _LegacyProvenanceTrail {
    pub generator_model: String,
    pub generation_timestamp: u64,
    pub context_hash: String,
}
