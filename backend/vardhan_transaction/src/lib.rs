//! # Vardhan Transaction
//!
//! A **Transaction** represents a single consequential operation that passes through
//! the governed Q-Core lifecycle. It is **not** a Receipt.
//!
//! ## Architectural Invariants
//!
//! - `Transaction != Receipt`  — Transaction is the governed operation.
//!   Receipt is the verifiable proof of that operation.
//! - Every Transaction must have an explicit, auditable lifecycle.
//! - Tenant isolation is mandatory — a Transaction cannot cross tenant boundaries.
//! - Idempotency: a Transaction with a given `idempotency_key` must not execute twice.
//! - Historical facts must not be silently rewritten; use `FAILED` or `REJECTED`
//!   rather than deleting past records.
//!
//! ## Transaction Lifecycle
//!
//! ```text
//! REQUESTED
//!   → VALIDATING
//!     → AUTHORITY_EVALUATION
//!       → AUTHORIZED         (happy path)
//!       → REJECTED           (policy/authority denied)
//!     → VALIDATION_FAILED    (malformed, tenant mismatch, replay, etc.)
//!   → EXECUTING
//!     → EXECUTED             (success)
//!     → FAILED               (execution error)
//!   → OUTCOME_RECORDED
//!   → RECEIPTED              (terminal — Receipt has been sealed)
//! ```

use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

// ─────────────────────────────────────────────────────────────────────────────
// Transaction Kind
// ─────────────────────────────────────────────────────────────────────────────

/// The class of consequential operation this Transaction represents.
///
/// This is intentionally extensible — do NOT add business-specific variants
/// directly. Instead use the `Custom(String)` variant for domain-specific kinds
/// while keeping core infrastructure kinds explicit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TransactionKind {
    /// A privileged access grant or revocation.
    PrivilegedAccessChange,
    /// A security or firewall policy modification.
    SecurityPolicyChange,
    /// An infrastructure deployment or rollback.
    InfrastructureDeployment,
    /// A configuration change to a running system.
    ConfigurationChange,
    /// A database or state store operation.
    DatabaseOperation,
    /// A cryptographic key rotation or revocation.
    KeyRotation,
    /// A workload migration between environments.
    WorkloadMigration,
    /// An authorization decision for an automated agent or AI.
    AutomatedAuthorization,
    /// An action produced by an AI/LLM that has been submitted for governance.
    /// NOTE: AI output alone is NOT authority. It becomes an input to governance.
    AiAgentAction,
    /// An incident-response action.
    IncidentResponseAction,
    /// A compliance decision or attestation.
    ComplianceDecision,
    /// An active defense action (eBPF, firewall, block).
    ActiveDefenseAction,
    /// An intelligence finding submitted to Q-Core for sealing.
    IntelligenceFindingSealing,
    /// Catch-all for domain-specific transaction types.
    Custom(String),
}

// ─────────────────────────────────────────────────────────────────────────────
// Transaction State Machine
// ─────────────────────────────────────────────────────────────────────────────

/// The full state machine lifecycle of a Vardhan Transaction.
///
/// Terminal states: `Receipted`, `Rejected`, `ValidationFailed`, `Failed`.
/// Only `Receipted` produces a Receipt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TransactionState {
    /// Initial state — the transaction has been submitted but not yet validated.
    Requested,
    /// Schema, tenant, provenance, and idempotency are being validated.
    Validating,
    /// Schema/tenant/provenance validation failed — this is a terminal rejection.
    ValidationFailed,
    /// Authority and policy are being evaluated.
    AuthorityEvaluation,
    /// Authority evaluation approved the transaction.
    Authorized,
    /// Authority evaluation or policy denied the transaction — terminal.
    Rejected,
    /// The authorized action is being executed.
    Executing,
    /// Execution completed successfully.
    Executed,
    /// Execution failed — terminal (not a rejection; the action was attempted).
    Failed,
    /// Outcome has been observed and recorded.
    OutcomeRecorded,
    /// Receipt has been cryptographically sealed — terminal success state.
    Receipted,
}

impl TransactionState {
    /// Returns true if this is a terminal state (no further transitions allowed).
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            Self::ValidationFailed | Self::Rejected | Self::Failed | Self::Receipted
        )
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Evidence Reference
// ─────────────────────────────────────────────────────────────────────────────

/// A reference to evidence that informed this transaction.
/// Stores the ID and a content hash (commitment) rather than the full evidence,
/// so the Receipt can reference evidence without embedding it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvidenceRef {
    /// Stable ID of the evidence record.
    pub evidence_id: String,
    /// BLAKE3 or SHA-256 hash of the evidence payload at time of reference.
    pub content_hash: String,
    /// Human-readable category (e.g. "NETWORK_ANOMALY", "POLICY_VIOLATION").
    pub category: String,
}

// ─────────────────────────────────────────────────────────────────────────────
// Outcome
// ─────────────────────────────────────────────────────────────────────────────

/// The observed outcome of an executed transaction.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransactionOutcome {
    /// Machine-readable result code.
    pub result_code: String,
    /// Human-readable summary (kept short — not a log dump).
    pub summary: String,
    /// Whether the intended effect was observed.
    pub effect_observed: bool,
    /// Timestamp (milliseconds since UNIX epoch) at which outcome was recorded.
    pub recorded_at_ms: u64,
}

// ─────────────────────────────────────────────────────────────────────────────
// Provenance
// ─────────────────────────────────────────────────────────────────────────────

/// Provenance records who submitted this transaction, from where, and when.
/// This is NOT identity verification — that is a separate concern.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransactionProvenance {
    /// Identity of the submitting actor (verified identity string, not raw claim).
    pub actor_identity: String,
    /// Source system or component that generated this transaction.
    pub source_system: String,
    /// ISO 8601 timestamp of original submission.
    pub submitted_at: String,
    /// Schema version of the payload that was submitted.
    pub schema_version: String,
}

// ─────────────────────────────────────────────────────────────────────────────
// Transaction
// ─────────────────────────────────────────────────────────────────────────────

/// A **Vardhan Transaction** — the canonical representation of a consequential
/// governed operation within Vardhan Quantum.
///
/// This is distinct from a Receipt. A Transaction is the operation and its
/// lifecycle. A Receipt is the cryptographic proof that the lifecycle occurred.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VardhanTransaction {
    // ── Identity ──────────────────────────────────────────────────────────
    /// Unique identifier for this transaction. UUID v4.
    pub transaction_id: String,
    /// Tenant this transaction belongs to. Hard boundary — must match throughout.
    pub tenant_id: String,
    /// Optional correlation ID linking this transaction to a parent or related transaction.
    pub correlation_id: Option<String>,
    /// Optional idempotency key. If provided, duplicate submissions with the same key
    /// and tenant MUST be detected and rejected without re-execution.
    pub idempotency_key: Option<String>,

    // ── Classification ───────────────────────────────────────────────────
    /// What class of operation this transaction represents.
    pub kind: TransactionKind,

    // ── State ────────────────────────────────────────────────────────────
    /// Current lifecycle state.
    pub state: TransactionState,
    /// Timestamp (ms since UNIX epoch) when the transaction was created.
    pub created_at_ms: u64,
    /// Timestamp (ms since UNIX epoch) of the most recent state transition.
    pub updated_at_ms: u64,

    // ── Subject and Provenance ───────────────────────────────────────────
    /// The resource or entity that is the subject of this operation.
    pub subject_id: String,
    /// Provenance of the transaction submission.
    pub provenance: TransactionProvenance,

    // ── Decision Context ─────────────────────────────────────────────────
    /// The proposed action (human-readable label, e.g. "QUARANTINE_IP").
    pub proposed_action: String,
    /// Reference to the policy that will/did govern this transaction.
    pub policy_id: String,
    /// Specific version of the policy applied. Must be immutable for historical verification.
    pub policy_version: String,
    /// Hash of the system state at the time of decision.
    pub state_hash_at_decision: Option<String>,
    /// References to evidence that informed this transaction.
    pub evidence_refs: Vec<EvidenceRef>,

    // ── Authority ────────────────────────────────────────────────────────
    /// The authority evaluation result, if completed.
    pub authority_result: Option<AuthorityResult>,

    // ── Outcome ──────────────────────────────────────────────────────────
    /// The observed execution outcome, if the transaction was executed.
    pub outcome: Option<TransactionOutcome>,

    // ── Receipt Reference ────────────────────────────────────────────────
    /// The ID of the Receipt that was sealed for this transaction, if complete.
    pub receipt_id: Option<String>,

    // ── Rejection Reason ─────────────────────────────────────────────────
    /// If rejected or failed, a structured reason.
    pub rejection_reason: Option<RejectionReason>,
}

/// The result of an authority evaluation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthorityResult {
    pub authorized: bool,
    pub authority_reference: String,
    pub evaluated_at_ms: u64,
    pub reason: String,
}

/// Structured reason for rejection or failure.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RejectionReason {
    TenantMismatch,
    InvalidProvenance,
    MalformedPayload,
    DuplicateIdempotencyKey,
    ReplayDetected,
    PolicyDenied,
    AuthorityDenied,
    ExecutionFailed(String),
    InvalidEvidenceReference,
    StalePolicyVersion,
    MissingRequiredField(String),
}

// ─────────────────────────────────────────────────────────────────────────────
// Transaction Builder
// ─────────────────────────────────────────────────────────────────────────────

impl VardhanTransaction {
    /// Create a new transaction in the `Requested` state.
    pub fn new(
        tenant_id: impl Into<String>,
        kind: TransactionKind,
        subject_id: impl Into<String>,
        proposed_action: impl Into<String>,
        policy_id: impl Into<String>,
        policy_version: impl Into<String>,
        provenance: TransactionProvenance,
    ) -> Self {
        let now_ms = now_ms();
        Self {
            transaction_id: Uuid::new_v4().to_string(),
            tenant_id: tenant_id.into(),
            correlation_id: None,
            idempotency_key: None,
            kind,
            state: TransactionState::Requested,
            created_at_ms: now_ms,
            updated_at_ms: now_ms,
            subject_id: subject_id.into(),
            provenance,
            proposed_action: proposed_action.into(),
            policy_id: policy_id.into(),
            policy_version: policy_version.into(),
            state_hash_at_decision: None,
            evidence_refs: Vec::new(),
            authority_result: None,
            outcome: None,
            receipt_id: None,
            rejection_reason: None,
        }
    }

    /// Attempt a state transition. Returns Err if the transition is not allowed.
    ///
    /// This enforces the state machine invariant: only valid transitions proceed.
    /// Invalid transitions return an error and leave the transaction unchanged.
    pub fn transition(&mut self, new_state: TransactionState) -> Result<(), TransactionError> {
        if self.state.is_terminal() {
            return Err(TransactionError::AlreadyTerminal {
                current: self.state.clone(),
            });
        }

        let allowed = matches!(
            (&self.state, &new_state),
            (TransactionState::Requested, TransactionState::Validating)
            | (TransactionState::Validating, TransactionState::AuthorityEvaluation)
            | (TransactionState::Validating, TransactionState::ValidationFailed)
            | (TransactionState::AuthorityEvaluation, TransactionState::Authorized)
            | (TransactionState::AuthorityEvaluation, TransactionState::Rejected)
            | (TransactionState::Authorized, TransactionState::Executing)
            | (TransactionState::Executing, TransactionState::Executed)
            | (TransactionState::Executing, TransactionState::Failed)
            | (TransactionState::Executed, TransactionState::OutcomeRecorded)
            | (TransactionState::OutcomeRecorded, TransactionState::Receipted)
        );

        if !allowed {
            return Err(TransactionError::InvalidTransition {
                from: self.state.clone(),
                to: new_state,
            });
        }

        self.state = new_state;
        self.updated_at_ms = now_ms();
        Ok(())
    }

    /// Record an authority evaluation result and advance to `Authorized` or `Rejected`.
    pub fn apply_authority_result(
        &mut self,
        result: AuthorityResult,
    ) -> Result<(), TransactionError> {
        let next_state = if result.authorized {
            TransactionState::Authorized
        } else {
            TransactionState::Rejected
        };

        if !result.authorized {
            self.rejection_reason = Some(RejectionReason::AuthorityDenied);
        }
        self.authority_result = Some(result);
        self.transition(next_state)
    }

    /// Record the execution outcome and advance to `Executed` or `Failed`.
    pub fn apply_outcome(&mut self, outcome: TransactionOutcome) -> Result<(), TransactionError> {
        let next_state = if outcome.effect_observed {
            TransactionState::Executed
        } else {
            let reason = outcome.summary.clone();
            self.rejection_reason = Some(RejectionReason::ExecutionFailed(reason));
            TransactionState::Failed
        };
        self.outcome = Some(outcome);
        self.transition(next_state)
    }

    /// Attach the sealed receipt ID and advance to `Receipted` (terminal success).
    pub fn seal(&mut self, receipt_id: impl Into<String>) -> Result<(), TransactionError> {
        self.transition(TransactionState::OutcomeRecorded)?;
        self.receipt_id = Some(receipt_id.into());
        self.transition(TransactionState::Receipted)
    }

    /// Reject with an explicit reason (validation failure path).
    pub fn reject(
        &mut self,
        reason: RejectionReason,
    ) -> Result<(), TransactionError> {
        self.rejection_reason = Some(reason);
        // Determine which terminal state to go to based on current state
        let terminal = match &self.state {
            TransactionState::Validating => TransactionState::ValidationFailed,
            TransactionState::AuthorityEvaluation => TransactionState::Rejected,
            _ => TransactionState::Rejected,
        };
        self.state = terminal;
        self.updated_at_ms = now_ms();
        Ok(())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub enum TransactionError {
    InvalidTransition {
        from: TransactionState,
        to: TransactionState,
    },
    AlreadyTerminal {
        current: TransactionState,
    },
}

impl std::fmt::Display for TransactionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidTransition { from, to } => {
                write!(f, "Invalid transition: {:?} → {:?}", from, to)
            }
            Self::AlreadyTerminal { current } => {
                write!(f, "Transaction is already in terminal state: {:?}", current)
            }
        }
    }
}

impl std::error::Error for TransactionError {}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("SystemTime before UNIX_EPOCH")
        .as_millis() as u64
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_provenance() -> TransactionProvenance {
        TransactionProvenance {
            actor_identity: "identity:svc-intel-01".into(),
            source_system: "vardhan-intelligence".into(),
            submitted_at: "2026-10-03T12:00:00Z".into(),
            schema_version: "1.0.0".into(),
        }
    }

    fn make_tx() -> VardhanTransaction {
        VardhanTransaction::new(
            "tenant-abc",
            TransactionKind::ActiveDefenseAction,
            "subject:ip-192.168.1.100",
            "QUARANTINE_IP",
            "POL-NET-01",
            "1.0",
            make_provenance(),
        )
    }

    #[test]
    fn test_new_transaction_starts_in_requested() {
        let tx = make_tx();
        assert_eq!(tx.state, TransactionState::Requested);
        assert!(tx.created_at_ms > 0, "created_at_ms must be real clock");
        assert!(!tx.transaction_id.is_empty());
    }

    #[test]
    fn test_valid_happy_path_lifecycle() {
        let mut tx = make_tx();
        tx.transition(TransactionState::Validating).unwrap();
        tx.transition(TransactionState::AuthorityEvaluation).unwrap();

        tx.apply_authority_result(AuthorityResult {
            authorized: true,
            authority_reference: "gate:VardhanGate".into(),
            evaluated_at_ms: now_ms(),
            reason: "Policy POL-NET-01 v1.0 passed".into(),
        }).unwrap();

        assert_eq!(tx.state, TransactionState::Authorized);
        tx.transition(TransactionState::Executing).unwrap();

        tx.apply_outcome(TransactionOutcome {
            result_code: "QUARANTINE_OK".into(),
            summary: "IP quarantined at kernel level via eBPF".into(),
            effect_observed: true,
            recorded_at_ms: now_ms(),
        }).unwrap();

        let receipt_id = format!("VQR-{}", Uuid::new_v4());
        tx.seal(&receipt_id).unwrap();

        assert_eq!(tx.state, TransactionState::Receipted);
        assert_eq!(tx.receipt_id.as_deref(), Some(receipt_id.as_str()));
        assert!(tx.state.is_terminal());
    }

    #[test]
    fn test_rejected_by_authority() {
        let mut tx = make_tx();
        tx.transition(TransactionState::Validating).unwrap();
        tx.transition(TransactionState::AuthorityEvaluation).unwrap();

        tx.apply_authority_result(AuthorityResult {
            authorized: false,
            authority_reference: "gate:VardhanGate".into(),
            evaluated_at_ms: now_ms(),
            reason: "Policy POL-NET-01 explicitly denies QUARANTINE_IP for this tenant".into(),
        }).unwrap();

        assert_eq!(tx.state, TransactionState::Rejected);
        assert!(tx.state.is_terminal());
        assert!(matches!(tx.rejection_reason, Some(RejectionReason::AuthorityDenied)));
    }

    #[test]
    fn test_validation_failure_path() {
        let mut tx = make_tx();
        tx.transition(TransactionState::Validating).unwrap();
        tx.reject(RejectionReason::TenantMismatch).unwrap();

        assert_eq!(tx.state, TransactionState::ValidationFailed);
        assert!(tx.state.is_terminal());
        assert!(matches!(tx.rejection_reason, Some(RejectionReason::TenantMismatch)));
    }

    #[test]
    fn test_no_transition_from_terminal_state() {
        let mut tx = make_tx();
        tx.transition(TransactionState::Validating).unwrap();
        tx.reject(RejectionReason::MalformedPayload).unwrap();

        // Must fail — already terminal
        let err = tx.transition(TransactionState::AuthorityEvaluation);
        assert!(err.is_err());
        let msg = err.unwrap_err().to_string();
        assert!(msg.contains("terminal"), "Error should mention terminal state");
    }

    #[test]
    fn test_invalid_transition_rejected() {
        let mut tx = make_tx();
        // Cannot jump from Requested directly to Authorized
        let err = tx.transition(TransactionState::Authorized);
        assert!(err.is_err());
    }

    #[test]
    fn test_duplicate_receipt_id_uniqueness() {
        // Every transaction must produce a unique receipt ID — never static
        let receipt_ids: Vec<String> = (0..1000)
            .map(|_| format!("VQR-{}", Uuid::new_v4()))
            .collect();
        let unique: std::collections::HashSet<_> = receipt_ids.iter().collect();
        assert_eq!(unique.len(), 1000, "All 1000 receipt IDs must be unique");
    }

    #[test]
    fn test_execution_failure_path() {
        let mut tx = make_tx();
        tx.transition(TransactionState::Validating).unwrap();
        tx.transition(TransactionState::AuthorityEvaluation).unwrap();
        tx.apply_authority_result(AuthorityResult {
            authorized: true,
            authority_reference: "gate:VardhanGate".into(),
            evaluated_at_ms: now_ms(),
            reason: "Approved".into(),
        }).unwrap();
        tx.transition(TransactionState::Executing).unwrap();
        tx.apply_outcome(TransactionOutcome {
            result_code: "EXEC_ERR_TIMEOUT".into(),
            summary: "eBPF program attach timed out".into(),
            effect_observed: false,
            recorded_at_ms: now_ms(),
        }).unwrap();

        assert_eq!(tx.state, TransactionState::Failed);
        assert!(tx.state.is_terminal());
        assert!(matches!(
            tx.rejection_reason,
            Some(RejectionReason::ExecutionFailed(_))
        ));
    }

    #[test]
    fn test_tenant_id_is_preserved() {
        let tx = make_tx();
        assert_eq!(tx.tenant_id, "tenant-abc");
    }

    #[test]
    fn test_policy_version_preserved_immutably() {
        let tx = make_tx();
        assert_eq!(tx.policy_version, "1.0");
        // The policy_version field is set at creation and never mutated by transitions.
        // This ensures historical verification can always determine what policy applied.
    }
}
