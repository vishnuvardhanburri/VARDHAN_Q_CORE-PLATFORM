use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use vardhan_state::id::{ContentHash, StateHash, TenantId, DeltaId, EntityId, ConfigurationHash, CommitIndex};
use vardhan_state::time::{TimeContext, now_utc};
use crate::identity::{VerificationClaimId, CanonicalObjectRef};
use vardhan_state::authorization::ProvenanceTrail;
use vardhan_state::scope::TenantScoped;
use vardhan_state::store::StateStore;
use vardhan_state::objects::{StateTransitionRecord, StateTransitionStatus, ScopedEntityId, StateSnapshot};
use vardhan_state::transition::TransitionType;
use async_trait::async_trait;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ClaimStatus {
    Created,
    Validated,
    EvidenceGathering,
    QuorumReady,
    Certified,
    Rejected,
    Indeterminate,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VerificationClaim {
    pub claim_id: VerificationClaimId,
    pub claim_type: String,
    pub target_ref: CanonicalObjectRef,
    pub required_evidence_classes: Vec<String>,
    pub independence_requirements: Vec<String>,
    pub policy_ref: String,
    pub config_hash: ContentHash,
    pub state_hash: StateHash,
    pub provenance: ProvenanceTrail,
    pub time_context: TimeContext,
    pub status: ClaimStatus,
}

impl VerificationClaim {
    pub fn new(
        claim_id: VerificationClaimId,
        claim_type: String,
        target_ref: CanonicalObjectRef,
        policy_ref: String,
        config_hash: ContentHash,
        state_hash: StateHash,
        provenance: ProvenanceTrail,
        time_context: TimeContext,
    ) -> Self {
        Self {
            claim_id,
            claim_type,
            target_ref,
            required_evidence_classes: Vec::new(),
            independence_requirements: Vec::new(),
            policy_ref,
            config_hash,
            state_hash,
            provenance,
            time_context,
            status: ClaimStatus::Created,
        }
    }

    pub fn transition_to(&mut self, new_status: ClaimStatus) -> Result<(), &'static str> {
        match (self.status, new_status) {
            (ClaimStatus::Created, ClaimStatus::Validated) |
            (ClaimStatus::Created, ClaimStatus::Rejected) => {
                self.status = new_status;
                Ok(())
            },
            (ClaimStatus::Validated, ClaimStatus::EvidenceGathering) |
            (ClaimStatus::Validated, ClaimStatus::Rejected) => {
                self.status = new_status;
                Ok(())
            },
            (ClaimStatus::EvidenceGathering, ClaimStatus::QuorumReady) |
            (ClaimStatus::EvidenceGathering, ClaimStatus::Indeterminate) => {
                self.status = new_status;
                Ok(())
            },
            (ClaimStatus::QuorumReady, ClaimStatus::Certified) |
            (ClaimStatus::QuorumReady, ClaimStatus::Rejected) |
            (ClaimStatus::QuorumReady, ClaimStatus::Indeterminate) => {
                self.status = new_status;
                Ok(())
            },
            _ => Err("Invalid lifecycle transition"),
        }
    }
}

#[async_trait]
pub trait ConsensusSubmitter: Send + Sync {
    async fn propose_and_wait(&self, transition: StateTransitionRecord, timeout: Duration) -> Result<StateSnapshot, &'static str>;
}

pub struct ClaimRegistry<C: ConsensusSubmitter> {
    pub consensus_client: Arc<C>,
}

impl<C: ConsensusSubmitter> ClaimRegistry<C> {
    pub fn new(consensus_client: Arc<C>) -> Self {
        Self { consensus_client }
    }

    pub async fn register_claim(&self, tenant_id: TenantId, claim: VerificationClaim) -> Result<TenantScoped<VerificationClaim>, &'static str> {
        let scoped_claim = TenantScoped::new(tenant_id, claim.clone());
        let proposer = ScopedEntityId { tenant_id, entity_id: EntityId::from(uuid::Uuid::new_v4()) };
        
        // PROPOSE to real consensus, do NOT fake commit indexes locally.
        let transition = StateTransitionRecord::propose(
            tenant_id,
            DeltaId::from(uuid::Uuid::new_v4()),
            claim.state_hash,
            StateHash::from([0u8; 32]), // Computed by the state machine during apply
            TransitionType::Known(vardhan_state::transition::KnownTransitionType::VerificationClaimCreate),
            proposer,
            ConfigurationHash::from(claim.config_hash.0),
        ).map_err(|_| "Failed to propose transition")?;

        // Await the authoritative Raft commit
        let new_state = self.consensus_client.propose_and_wait(transition, Duration::from_secs(5)).await?;
        
        let mut authoritative_claim = scoped_claim.inner().clone();
        authoritative_claim.state_hash = new_state.state_hash;
        
        Ok(scoped_claim.rewrap(authoritative_claim))
    }

    pub async fn advance_claim(&self, scoped_claim: &mut TenantScoped<VerificationClaim>, new_status: ClaimStatus) -> Result<(), &'static str> {
        let mut inner = scoped_claim.inner().clone();
        inner.transition_to(new_status)?;
        
        let proposer = ScopedEntityId { tenant_id: scoped_claim.tenant_id(), entity_id: EntityId::from(uuid::Uuid::new_v4()) };
        
        let transition = StateTransitionRecord::propose(
            scoped_claim.tenant_id(),
            DeltaId::from(uuid::Uuid::new_v4()),
            inner.state_hash,
            StateHash::from([0u8; 32]),
            TransitionType::Unknown("VERIFICATION_CLAIM_UPDATE".to_string()),
            proposer,
            ConfigurationHash::from(inner.config_hash.0),
        ).map_err(|_| "Failed to propose transition")?;
        
        // Await the authoritative Raft commit
        let new_state = self.consensus_client.propose_and_wait(transition, Duration::from_secs(5)).await?;
        
        inner.state_hash = new_state.state_hash;
        *scoped_claim = scoped_claim.rewrap(inner);
        
        Ok(())
    }
}
