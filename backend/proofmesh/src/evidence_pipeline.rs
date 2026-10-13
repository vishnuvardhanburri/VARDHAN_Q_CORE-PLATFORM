use crate::run_record::VerificationRunRecord;
use crate::scope::CanonicalTenantId;
use core_crypto::QuantumNodeIdentity;
use std::sync::Arc;
use std::time::Duration;
use vardhan_state::evidence::{EvidenceCategory, EvidenceRecord, EvidenceStatus, Signature};
use vardhan_state::id::EntityId;
use vardhan_state::id::{
    ConfigurationHash, ContentHash, EvidenceId, EvidenceLogicalId, SchemaVersion,
};
use vardhan_state::store::EvidenceStore;
use vardhan_state::time::{now_utc, TimeContext};

pub struct EvidencePipeline<E: EvidenceStore> {
    pub evidence_store: Arc<E>,
    pub node_identity: Arc<QuantumNodeIdentity>,
}

impl<E: EvidenceStore + Send + Sync> EvidencePipeline<E> {
    pub fn new(evidence_store: Arc<E>, node_identity: Arc<QuantumNodeIdentity>) -> Self {
        Self {
            evidence_store,
            node_identity,
        }
    }

    pub async fn process_verification_run(
        &self,
        tenant_id: CanonicalTenantId,
        run_record: &mut VerificationRunRecord,
    ) -> Result<(), &'static str> {
        let payload =
            serde_json::to_vec(run_record).map_err(|_| "Failed to serialize run record")?;
        let payload_digest = ContentHash::from(*blake3::hash(&payload).as_bytes());

        let config_hash = ConfigurationHash::from(run_record.config_hash.0);
        let ts = now_utc();

        // Use genuine node identity bounds
        let dsa_pub = self.node_identity.dsa_public_key_bytes();
        let pub_hash = blake3::hash(&dsa_pub);
        let mut uuid_bytes = [0u8; 16];
        uuid_bytes.copy_from_slice(&pub_hash.as_bytes()[0..16]);
        let signer_entity_id = EntityId::from(uuid::Uuid::from_bytes(uuid_bytes));

        // Canonicalization schema strictly over all fields via Explicit Envelope
        let logical_id = EvidenceLogicalId::from_uuid(uuid::Uuid::new_v4());

        let signing_envelope = crate::identity::ProofMeshEvidenceSigningEnvelopeV1 {
            domain_separator: "VARDHAN_PROOFMESH_1.0",
            schema_version: &SchemaVersion::new(1, 0, 0),
            tenant_id: &tenant_id.0,
            logical_id: &logical_id,
            payload_digest: &payload_digest,
            evidence_category: &EvidenceCategory::Verification,
            source: "proofmesh.verification_run",
            config_hash: &config_hash,
            state_hash: Some(&run_record.state_hash),
            timestamp_system_ms: ts.timestamp_millis() as u64,
            related_object_refs: &[],
            provenance: &[],
            authorization_context: None,
        };

        let canonical_buffer = serde_json::to_vec(&signing_envelope)
            .map_err(|_| "Failed to serialize canonical envelope")?;

        // Genuine ML-DSA-87 Signing via core_crypto
        let signature_bytes = self
            .node_identity
            .sign_payload(&canonical_buffer)
            .map_err(|_| "ML-DSA-87 signature failed")?;

        let mut evidence = EvidenceRecord {
            evidence_id: EvidenceId::from([0u8; 32]), // Placeholder
            tenant_id: tenant_id.0,
            event_id: None,
            entity_id: Some(signer_entity_id),
            source: "proofmesh.verification_run".to_string(),
            timestamp: TimeContext {
                logical_time: None,
                event_time: ts,
                system_time: ts,
                deadline_time: None,
                created_at: ts,
            },
            schema_version: SchemaVersion::new(1, 0, 0),
            payload_digest,
            predecessor: None,
            provenance: vec![],
            authorization_context: None,
            signatures: vec![Signature {
                signer: signer_entity_id,
                algorithm: "ML-DSA-87".to_string(),
                value: signature_bytes,
            }],
            evidence_category: EvidenceCategory::Verification,
            config_hash,
            state_hash: Some(run_record.state_hash),
            commit_index: None,
            related_object_refs: vec![],
            status: EvidenceStatus::Created,
            logical_id: logical_id.clone(),
        };

        // Finalize Identity - deterministically hash the full serialized struct
        let finalized_bytes =
            serde_json::to_vec(&evidence).map_err(|_| "Failed to serialize signed evidence")?;
        evidence.evidence_id = EvidenceId::from(*blake3::hash(&finalized_bytes).as_bytes());
        let final_evidence_id = evidence.evidence_id;

        // Append to Raft store
        self.evidence_store
            .append(evidence.clone())
            .map_err(|_| "Failed to append to EvidenceStore")?;

        // Bounded Wait for commit
        let timeout_duration = Duration::from_secs(5);
        let start = std::time::Instant::now();
        let mut committed = false;

        loop {
            if start.elapsed() > timeout_duration {
                break;
            }
            match self.evidence_store.get(final_evidence_id) {
                Ok(stored_record) => {
                    if stored_record.commit_index.is_some() {
                        committed = true;
                        break;
                    }
                }
                Err(_) => {}
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }

        if !committed {
            return Err("Evidence commit timed out before reaching quorum replication");
        }

        run_record.evidence_ref = Some(final_evidence_id);
        Ok(())
    }
}
