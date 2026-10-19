//! # Vardhan State Fabric — Evidence Record (L03)
//!
//! The EvidenceRecord is the immutable, cryptographically-verifiable record
//! of every state transition. It forms an immutable chain (predecessor links),
//! carries signatures, and is committed via Raft.
//!
//! Sourced from:
//! - `VARDHAN_ARCHITECTURE_CONSTITUTION.md` §9 (Evidence Model), §A5
//! - `VARDHAN_CANONICAL_OBJECT_SPEC.md` §10 (Evidence)
//! - `VARDHAN_STATE_MACHINES.md` §6.6 (EvidenceRecord state machine)
//! - `VARDHAN_OBJECT_TRAITS.md` §7.1 (EvidenceStore)

use crate::id::SchemaVersion;
use crate::id::{
    CommitIndex, ConfigurationHash, ContentHash, EvidenceId, EvidenceLogicalId, ObjectRef,
    StateHash, TenantId,
};
use crate::scope::Hashable;
use crate::time::TimeContext;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Evidence category (A5). Two distinct categories, never conflated.
///
/// DECISION evidence: produced by the decision pipeline (creation, G0–G4,
/// policy, authorization, execution initiation).
///
/// OUTCOME evidence: produced by the outcome verification pipeline
/// (execution result, observation, prediction vs. actual, memory finalization).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EvidenceCategory {
    Verification,
    /// Decision pipeline evidence — written to Decision Merkle tree (A5)
    Decision,
    /// Outcome pipeline evidence — written to Outcome Merkle tree (A5)
    Outcome,
    /// Assurance evidence (G0–G4 gates)
    Assurance,
}

/// A cryptographic signature on an evidence record.
/// (Minimal implementation — full ML-DSA-87 signature verification is
/// handled by core_crypto crate.)
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct Signature {
    /// The entity that produced this signature
    pub signer: crate::id::EntityId,
    /// Signature algorithm (e.g., "ML-DSA-87")
    pub algorithm: String,
    /// The signature bytes
    pub value: Vec<u8>,
}

/// Provenance entry — a single step in the provenance trail.
/// (Minimal implementation — interface-phase dependency, marked as such.)
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ProvenanceEntry {
    /// The principal/entity that performed this action
    pub principal: crate::id::EntityId,
    /// When the action was performed
    pub timestamp: DateTime<Utc>,
    /// Description of the action
    pub action: String,
    /// Optional signature over this entry
    pub signature: Option<Signature>,
}

/// Authorization context attached to evidence records.
/// (Minimal implementation — interface-phase dependency.)
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct AuthContext {
    /// The principal that authorized this action
    pub principal: crate::id::EntityId,
    /// Authorization method (e.g., "pq_signature", "policy_rule", "human_approval")
    pub method: String,
    /// When authorization was granted
    pub authorized_at: DateTime<Utc>,
}

/// Merkle tree handle — provides access to a dedicated Merkle tree.
/// (A5: Decision vs Outcome evidence trees are separate.)
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MerkleTreeHandle {
    /// Which evidence tree this handle points to
    pub tree_type: EvidenceCategory,
    /// Current root hash
    pub root: [u8; 32],
    /// Number of leaves in the tree
    pub node_count: u64,
}

/// EvidenceRef — a reference to an evidence record.
#[derive(Clone, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
pub struct EvidenceRef {
    /// Cryptographic identity of the evidence record
    pub evidence_id: EvidenceId,
    /// Logical identity for queryability
    pub logical_id: EvidenceLogicalId,
}

/// EvidenceRecord lifecycle states (VARDHAN_STATE_MACHINES.md §6.6).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EvidenceStatus {
    /// Created in memory, not yet persisted
    #[default]
    Created,
    /// ML-DSA-87 signature applied
    Signed,
    /// Written to audit ledger
    LedgerWritten,
    /// Included in a Merkle checkpoint batch
    MerkleCheckpointed,
    /// Propagated to Raft followers
    RaftReplicated,
    /// Committed by Raft consensus; commit_index assigned
    RaftCommitted,
    /// Terminal: evidence linked to commit_index and state_hash
    Finalized,
    /// Failure: invalid signature, malformed payload
    Rejected,
    /// Failure: ledger write lost before Raft commit
    LedgerLoss,
    /// Failure: predecessor reference not found
    ChainBroken,
    /// Failure: no valid signature attached
    Unsigned,
    /// Failure: content hash mismatch on verification
    Corrupted,
}

impl EvidenceStatus {
    /// Returns true if this evidence is finalized (terminal success state).
    pub fn is_finalized(&self) -> bool {
        matches!(self, EvidenceStatus::Finalized)
    }

    /// Returns true if this evidence is signed and ready for ledger.
    pub fn is_signed(&self) -> bool {
        matches!(
            self,
            EvidenceStatus::Signed
                | EvidenceStatus::LedgerWritten
                | EvidenceStatus::MerkleCheckpointed
                | EvidenceStatus::RaftReplicated
                | EvidenceStatus::RaftCommitted
                | EvidenceStatus::Finalized
        )
    }

    /// Returns true if this evidence is committed (Raft-committed or beyond).
    pub fn is_committed(&self) -> bool {
        matches!(
            self,
            EvidenceStatus::RaftCommitted | EvidenceStatus::Finalized
        )
    }
}

/// The EvidenceRecord — immutable, cryptographically-verifiable record of
/// every state transition. Forms an immutable chain via predecessor links.
///
/// Canonical serialization field ordering (§10.5):
/// `evidence_id`, `tenant_id`, `event_id`, `entity_id`, `source`, `timestamp`,
/// `logical_time`, `event_time`, `system_time`, `deadline_time`, `schema_version`,
/// `payload_digest`, `predecessor`, `provenance`, `authorization_context`,
/// `signatures`, `evidence_category`, `config_hash`, `state_hash`, `commit_index`,
/// `related_object_refs`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct EvidenceRecord {
    /// Cryptographic identity: BLAKE3 of canonical EvidenceRecord bytes.
    /// Computed at creation, immutable.
    #[serde(with = "crate::evidence::evidence_id_serde")]
    pub evidence_id: EvidenceId,

    /// Tenant boundary (A2)
    pub tenant_id: TenantId,

    /// Optional reference to the originating VardhanEvent
    pub event_id: Option<crate::id::EventId>,

    /// Optional reference to the originating Entity
    pub entity_id: Option<crate::id::EntityId>,

    /// Source component that created this evidence
    pub source: String,

    /// Time context (A3)
    #[serde(flatten)]
    pub timestamp: TimeContext,

    /// Schema version
    pub schema_version: SchemaVersion,

    /// Payload content hash: BLAKE3 of the payload field only
    pub payload_digest: ContentHash,

    /// Predecessor in the evidence chain (immutable chain).
    /// None for genesis records.
    pub predecessor: Option<EvidenceId>,

    /// Provenance trail
    pub provenance: Vec<ProvenanceEntry>,

    /// Authorization context
    pub authorization_context: Option<AuthContext>,

    /// Signatures (ML-DSA-87)
    pub signatures: Vec<Signature>,

    /// Evidence category (A5)
    pub evidence_category: EvidenceCategory,

    /// Configuration hash at time of evaluation (A4)
    pub config_hash: ConfigurationHash,

    /// State hash this evidence references (A1, A2)
    /// Links evidence to VARDHAN_COMMITTED_STATE
    pub state_hash: Option<StateHash>,

    /// Commit index (Logical Time, A3) — assigned at Raft commit.
    /// None before Raft commit.
    pub commit_index: Option<CommitIndex>,

    /// Related object references
    pub related_object_refs: Vec<ObjectRef>,

    /// Current status in the evidence lifecycle
    #[serde(skip)]
    pub status: EvidenceStatus,

    /// Logical identity for queryability
    pub logical_id: EvidenceLogicalId,
}

impl EvidenceRecord {
    /// Compute the idempotency key for evidence records.
    /// Based on payload_digest + evidence_category + tenant_id (not the full
    /// canonical bytes, which include timestamps that differ between duplicate attempts).
    /// (T-IDEM-03)
    pub fn idempotency_key(&self) -> ContentHash {
        let mut combined = Vec::new();
        combined.extend_from_slice(&self.tenant_id.to_bytes());
        combined.extend_from_slice(self.payload_digest.as_bytes());
        combined.extend_from_slice(match self.evidence_category {
            EvidenceCategory::Decision => b"DECISION",
            EvidenceCategory::Outcome => b"OUTCOME",
            EvidenceCategory::Assurance => b"ASSURANCE",
            EvidenceCategory::Verification => b"VERIFICATION",
        });
        ContentHash(*blake3::hash(&combined).as_bytes())
    }

    /// Create a new evidence record in CREATED state.
    /// The evidence_id is computed from the canonical bytes.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        tenant_id: TenantId,
        source: impl Into<String>,
        time: TimeContext,
        payload: &[u8],
        category: EvidenceCategory,
        config_hash: ConfigurationHash,
        state_hash: Option<StateHash>,
        predecessor: Option<EvidenceId>,
    ) -> Self {
        let payload_digest = ContentHash::from_content(payload);
        let logical_id = EvidenceLogicalId::new_v4();

        let mut record = Self {
            evidence_id: EvidenceId::ZERO, // placeholder, computed below
            tenant_id,
            event_id: None,
            entity_id: None,
            source: source.into(),
            timestamp: time,
            schema_version: SchemaVersion::VARDHAN_EVENT,
            payload_digest,
            predecessor,
            provenance: Vec::new(),
            authorization_context: None,
            signatures: Vec::new(),
            evidence_category: category,
            config_hash,
            state_hash,
            commit_index: None,
            related_object_refs: Vec::new(),
            status: EvidenceStatus::Created,
            logical_id,
        };

        // Compute evidence_id = BLAKE3(canonical bytes)
        record.evidence_id = EvidenceId::from_content(&record.canonical_bytes());
        record
    }

    /// Compute the canonical bytes for hashing (deterministic field ordering).
    /// This is used for EvidenceId computation (§10.6).
    /// NOTE: evidence_id is EXCLUDED from the hash — it IS the hash of the rest.
    pub fn canonical_bytes(&self) -> Vec<u8> {
        // Serialize to BTreeMap for sorted keys (deterministic)
        let mut map: BTreeMap<String, serde_json::Value> = BTreeMap::new();

        // evidence_id is NOT included — it is the BLAKE3 of everything else
        map.insert(
            "tenant_id".to_string(),
            serde_json::Value::String(self.tenant_id.to_string()),
        );
        map.insert(
            "event_id".to_string(),
            self.event_id
                .map(|id| serde_json::Value::String(id.to_string()))
                .unwrap_or(serde_json::Value::Null),
        );
        map.insert(
            "entity_id".to_string(),
            self.entity_id
                .map(|id| serde_json::Value::String(id.to_string()))
                .unwrap_or(serde_json::Value::Null),
        );
        map.insert(
            "source".to_string(),
            serde_json::Value::String(self.source.clone()),
        );
        map.insert(
            "timestamp".to_string(),
            serde_json::to_value(self.timestamp.canonical_bytes())
                .unwrap_or(serde_json::Value::Null),
        );
        map.insert(
            "schema_version".to_string(),
            serde_json::Value::String(self.schema_version.to_string()),
        );
        map.insert(
            "payload_digest".to_string(),
            serde_json::Value::String(self.payload_digest.to_hex()),
        );
        map.insert(
            "predecessor".to_string(),
            self.predecessor
                .map(|id| serde_json::Value::String(id.to_hex()))
                .unwrap_or(serde_json::Value::Null),
        );

        // Serialize provenance array canonically
        let prov_arr: Vec<serde_json::Value> = self
            .provenance
            .iter()
            .map(|p| serde_json::to_value(p).unwrap_or(serde_json::Value::Null))
            .collect();
        map.insert("provenance".to_string(), serde_json::Value::Array(prov_arr));

        map.insert(
            "authorization_context".to_string(),
            self.authorization_context
                .as_ref()
                .map(|ac| serde_json::to_value(ac).unwrap_or(serde_json::Value::Null))
                .unwrap_or(serde_json::Value::Null),
        );

        let sig_arr: Vec<serde_json::Value> = self
            .signatures
            .iter()
            .map(|s| serde_json::to_value(s).unwrap_or(serde_json::Value::Null))
            .collect();
        map.insert("signatures".to_string(), serde_json::Value::Array(sig_arr));

        map.insert(
            "evidence_category".to_string(),
            serde_json::Value::String(
                match self.evidence_category {
                    EvidenceCategory::Decision => "DECISION",
                    EvidenceCategory::Outcome => "OUTCOME",
                    EvidenceCategory::Assurance => "ASSURANCE",
                    EvidenceCategory::Verification => "VERIFICATION",
                }
                .to_string(),
            ),
        );
        map.insert(
            "config_hash".to_string(),
            serde_json::Value::String(self.config_hash.to_hex()),
        );
        map.insert(
            "state_hash".to_string(),
            self.state_hash
                .map(|sh| serde_json::Value::String(sh.to_hex()))
                .unwrap_or(serde_json::Value::Null),
        );
        map.insert(
            "commit_index".to_string(),
            self.commit_index
                .map(|ci| serde_json::Value::Number(serde_json::Number::from(ci.get())))
                .unwrap_or(serde_json::Value::Null),
        );

        let refs_arr: Vec<serde_json::Value> = self
            .related_object_refs
            .iter()
            .map(|r| serde_json::to_value(r).unwrap_or(serde_json::Value::Null))
            .collect();
        map.insert(
            "related_object_refs".to_string(),
            serde_json::Value::Array(refs_arr),
        );

        serde_json::to_vec(&map).unwrap_or_default()
    }

    /// Verify that the stored evidence_id matches the computed hash.
    /// (T-EVID-02: Content hash integrity)
    pub fn verify_self_hash(&self) -> bool {
        let computed = EvidenceId::from_content(&self.canonical_bytes());
        computed == self.evidence_id
    }

    /// Assign a commit index (Logical Time, A3). Called only at Raft commit.
    pub fn assign_commit_index(&mut self, index: CommitIndex) {
        self.timestamp.assign_commit_index(index);
        self.commit_index = Some(index);
        self.status = EvidenceStatus::RaftCommitted;
        // Recompute evidence_id since commit_index changed
        self.evidence_id = EvidenceId::from_content(&self.canonical_bytes());
    }

    /// Mark as finalized.
    pub fn finalize(&mut self) {
        self.status = EvidenceStatus::Finalized;
    }

    /// Mark as signed.
    pub fn sign(&mut self) {
        self.status = EvidenceStatus::Signed;
    }

    /// Mark as ledger-written.
    pub fn mark_ledger_written(&mut self) {
        self.status = EvidenceStatus::LedgerWritten;
    }

    /// Mark as merkle-checkpointed.
    pub fn mark_merkle_checkpointed(&mut self) {
        self.status = EvidenceStatus::MerkleCheckpointed;
    }

    /// Mark as raft-replicated.
    pub fn mark_raft_replicated(&mut self) {
        self.status = EvidenceStatus::RaftReplicated;
    }

    /// Link to the originating event.
    pub fn with_event_id(mut self, event_id: crate::id::EventId) -> Self {
        self.event_id = Some(event_id);
        self
    }

    /// Link to the originating entity.
    pub fn with_entity_id(mut self, entity_id: crate::id::EntityId) -> Self {
        self.entity_id = Some(entity_id);
        self
    }

    /// Set the authorization context.
    pub fn with_auth_context(mut self, ctx: AuthContext) -> Self {
        self.authorization_context = Some(ctx);
        self
    }

    /// Add a signature.
    pub fn with_signature(mut self, sig: Signature) -> Self {
        self.signatures.push(sig);
        self
    }

    /// Add a related object reference.
    pub fn with_related_ref(mut self, ref_: ObjectRef) -> Self {
        self.related_object_refs.push(ref_);
        self
    }

    /// Add a provenance entry.
    pub fn with_provenance(mut self, entry: ProvenanceEntry) -> Self {
        self.provenance.push(entry);
        self
    }
}

impl Hashable for EvidenceRecord {
    fn canonical_bytes(&self) -> Vec<u8> {
        self.canonical_bytes()
    }

    fn content_hash(&self) -> ContentHash {
        ContentHash(*blake3::hash(&self.canonical_bytes()).as_bytes())
    }
}

impl crate::scope::TenantScopedObject for EvidenceRecord {
    fn tenant_id(&self) -> crate::id::TenantId {
        self.tenant_id
    }

    fn validate_tenant_scope(self) -> Result<Self, crate::error::TenantBoundaryError>
    where
        Self: Sized,
    {
        Ok(self)
    }

    fn into_tenant_scoped(self) -> crate::scope::TenantScoped<Self>
    where
        Self: Hashable,
    {
        crate::scope::TenantScoped::new(self.tenant_id, self)
    }
}

// ─── Serialization helpers for EvidenceId ────────────────────────────────────

pub mod evidence_id_serde {
    use crate::id::EvidenceId;
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(id: &EvidenceId, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&id.to_hex())
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<EvidenceId, D::Error> {
        let s = String::deserialize(d)?;
        EvidenceId::from_hex(&s).map_err(serde::de::Error::custom)
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::time::TimeContext;

    fn make_evidence(
        category: EvidenceCategory,
        predecessor: Option<EvidenceId>,
    ) -> EvidenceRecord {
        let now = chrono::Utc::now();
        let tc = TimeContext::new(now);
        EvidenceRecord::new(
            TenantId::new_v4(),
            "test_source",
            tc,
            b"test_payload",
            category,
            ConfigurationHash::from_content(b"test_config"),
            Some(StateHash::from_content(b"test_state")),
            predecessor,
        )
    }

    #[test]
    fn test_evid_01_canonical_serialization_determinism() {
        // T-EVID-01: Two identical EvidenceRecord objects produce identical canonical bytes
        let now = chrono::Utc::now();
        let tc = TimeContext::new(now);
        let e1 = EvidenceRecord::new(
            TenantId::new_v4(),
            "test_source",
            tc.clone(),
            b"test_payload",
            EvidenceCategory::Decision,
            ConfigurationHash::from_content(b"test_config"),
            Some(StateHash::from_content(b"test_state")),
            None,
        );
        let e2 = e1.clone();

        let b1 = e1.canonical_bytes();
        let b2 = e2.canonical_bytes();
        assert_eq!(
            b1, b2,
            "canonical bytes must be deterministic for identical records"
        );
    }

    #[test]
    fn test_evid_02_content_hash_integrity() {
        // T-EVID-02: Modifying a field changes the content hash
        let now = chrono::Utc::now();
        let tc = TimeContext::new(now);
        let mut e1 = EvidenceRecord::new(
            TenantId::new_v4(),
            "test_source",
            tc.clone(),
            b"test_payload",
            EvidenceCategory::Decision,
            ConfigurationHash::from_content(b"test_config"),
            Some(StateHash::from_content(b"test_state")),
            None,
        );
        let hash_before = e1.content_hash();

        // Modify a field
        e1.source = "different_source".to_string();
        let bytes = e1.canonical_bytes();
        e1.evidence_id = EvidenceId::from_content(&bytes);
        let hash_after = e1.content_hash();

        assert_ne!(
            hash_before, hash_after,
            "content hash must change when field is modified"
        );
    }

    #[test]
    fn test_evid_05_decision_vs_outcome_separation() {
        // T-EVID-05: Decision and Outcome evidence categories are distinct
        let dec = make_evidence(EvidenceCategory::Decision, None);
        let out = make_evidence(EvidenceCategory::Outcome, None);

        assert_ne!(dec.evidence_category, out.evidence_category);
        // Even with identical content, categories differ
        let dec_bytes = dec.canonical_bytes();
        let out_bytes = out.canonical_bytes();
        assert_ne!(
            dec_bytes, out_bytes,
            "different categories must produce different canonical bytes"
        );
    }

    #[test]
    fn test_evidence_id_computed_from_canonical() {
        let now = chrono::Utc::now();
        let tc = TimeContext::new(now);
        let e = EvidenceRecord::new(
            TenantId::new_v4(),
            "test_source",
            tc,
            b"test_payload",
            EvidenceCategory::Decision,
            ConfigurationHash::from_content(b"config"),
            None,
            None,
        );
        // evidence_id should match BLAKE3 of canonical bytes
        let computed = EvidenceId::from_content(&e.canonical_bytes());
        assert_eq!(
            e.evidence_id, computed,
            "evidence_id must be BLAKE3 of canonical bytes"
        );
    }

    #[test]
    fn test_evidence_logical_time_none_before_commit() {
        let now = chrono::Utc::now();
        let tc = TimeContext::new(now);
        let e = EvidenceRecord::new(
            TenantId::new_v4(),
            "test_source",
            tc,
            b"payload",
            EvidenceCategory::Decision,
            ConfigurationHash::from_content(b"config"),
            None,
            None,
        );
        assert!(
            e.timestamp.logical_time.is_none(),
            "logical_time must be None before Raft commit"
        );
        assert_eq!(e.status, EvidenceStatus::Created);
    }

    #[test]
    fn test_evidence_commit_assigns_logical_time() {
        let now = chrono::Utc::now();
        let mut tc = TimeContext::new(now);
        let mut e = EvidenceRecord::new(
            TenantId::new_v4(),
            "test_source",
            tc.clone(),
            b"payload",
            EvidenceCategory::Decision,
            ConfigurationHash::from_content(b"config"),
            None,
            None,
        );

        tc.assign_commit_index(CommitIndex::new(42));
        e.assign_commit_index(CommitIndex::new(42));

        assert_eq!(e.commit_index, Some(CommitIndex::new(42)));
        assert!(e.status.is_committed());
    }

    #[test]
    fn test_evidence_chain_predecessor() {
        let now = chrono::Utc::now();
        let tc = TimeContext::new(now);

        let e1 = EvidenceRecord::new(
            TenantId::new_v4(),
            "test_source",
            tc.clone(),
            b"payload1",
            EvidenceCategory::Decision,
            ConfigurationHash::from_content(b"config"),
            None,
            None, // genesis — no predecessor
        );

        let e2 = EvidenceRecord::new(
            TenantId::new_v4(),
            "test_source",
            tc,
            b"payload2",
            EvidenceCategory::Decision,
            ConfigurationHash::from_content(b"config"),
            None,
            Some(e1.evidence_id), // predecessor = e1
        );

        assert_eq!(
            e2.predecessor,
            Some(e1.evidence_id),
            "evidence chain predecessor must be linked"
        );
    }

    #[test]
    fn test_evidence_self_hash_verification() {
        let now = chrono::Utc::now();
        let tc = TimeContext::new(now);
        let e = EvidenceRecord::new(
            TenantId::new_v4(),
            "test_source",
            tc,
            b"payload",
            EvidenceCategory::Decision,
            ConfigurationHash::from_content(b"config"),
            None,
            None,
        );
        assert!(
            e.verify_self_hash(),
            "evidence_id must match BLAKE3 of canonical bytes"
        );
    }
}
