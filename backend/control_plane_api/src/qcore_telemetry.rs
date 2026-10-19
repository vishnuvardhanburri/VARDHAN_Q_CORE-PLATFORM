//! Durable Q-Core transaction/receipt telemetry boundary.
//!
//! This module stores control-plane telemetry only. It does not replace the
//! canonical Q-Core transaction state machine, receipt signing, or independent
//! receipt verification. A receipt is considered authenticated only when the
//! upstream crypto path has actually verified it.

use serde::{Deserialize, Serialize};
use sled::Db;
use std::sync::Arc;
use thiserror::Error;

const TX_PREFIX: &[u8] = b"qcore:tx:";
const RECEIPT_PREFIX: &[u8] = b"qcore:receipt:";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ReceiptVerificationState {
    Verified,
    PendingVerification,
    Rejected,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QCoreTransactionTelemetry {
    pub organization_id: String,
    pub transaction_id: String,
    pub tenant_id: String,
    pub state: String,
    pub kind: String,
    pub subject_id: String,
    pub proposed_action: String,
    pub policy_id: String,
    pub policy_version: String,
    pub correlation_id: Option<String>,
    pub receipt_id: Option<String>,
    pub outcome_code: Option<String>,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QCoreReceiptTelemetry {
    pub organization_id: String,
    pub receipt_id: String,
    pub transaction_id: String,
    pub tenant_id: String,
    pub status: String,
    pub decision: String,
    pub outcome_code: String,
    pub policy_id: String,
    pub policy_version: String,
    pub ledger_commit_index: u64,
    pub timestamp_ms: u64,
    pub payload_hash: String,
    pub issuer_key_fingerprint: String,
    pub verification: ReceiptVerificationState,
}

#[derive(Debug, Error)]
pub enum TelemetryError {
    #[error("organization and tenant must match")]
    TenantMismatch,
    #[error("transaction id is empty")]
    EmptyTransactionId,
    #[error("receipt id is empty")]
    EmptyReceiptId,
    #[error("stale transaction telemetry update")]
    StaleTransaction,
    #[error("receipt id already exists with different content")]
    ReceiptConflict,
    #[error("telemetry serialization failed: {0}")]
    Serialization(String),
    #[error("telemetry storage failed: {0}")]
    Storage(#[from] sled::Error),
}

#[derive(Clone)]
pub struct QCoreTelemetryStore {
    db: Arc<Db>,
}

impl QCoreTelemetryStore {
    pub fn new(db: Arc<Db>) -> Self {
        Self { db }
    }

    pub fn record_transaction(
        &self,
        telemetry: &QCoreTransactionTelemetry,
    ) -> Result<(), TelemetryError> {
        validate_scope(&telemetry.organization_id, &telemetry.tenant_id)?;
        if telemetry.transaction_id.trim().is_empty() {
            return Err(TelemetryError::EmptyTransactionId);
        }
        let key = format!(
            "{}{}:{}",
            std::str::from_utf8(TX_PREFIX).unwrap(),
            telemetry.organization_id,
            telemetry.transaction_id
        );
        if let Some(existing) = self.db.get(key.as_bytes())? {
            let previous: QCoreTransactionTelemetry = serde_json::from_slice(&existing)
                .map_err(|e| TelemetryError::Serialization(e.to_string()))?;
            if telemetry.updated_at_ms < previous.updated_at_ms
                || state_rank(&telemetry.state) < state_rank(&previous.state)
            {
                return Err(TelemetryError::StaleTransaction);
            }
        }
        let value = serde_json::to_vec(telemetry)
            .map_err(|e| TelemetryError::Serialization(e.to_string()))?;
        self.db.insert(key.as_bytes(), value)?;
        self.db.flush()?;
        Ok(())
    }

    pub fn record_receipt(&self, telemetry: &QCoreReceiptTelemetry) -> Result<(), TelemetryError> {
        validate_scope(&telemetry.organization_id, &telemetry.tenant_id)?;
        if telemetry.receipt_id.trim().is_empty() {
            return Err(TelemetryError::EmptyReceiptId);
        }
        let key = format!(
            "{}{}:{}",
            std::str::from_utf8(RECEIPT_PREFIX).unwrap(),
            telemetry.organization_id,
            telemetry.receipt_id
        );
        let value = serde_json::to_vec(telemetry)
            .map_err(|e| TelemetryError::Serialization(e.to_string()))?;
        if let Some(existing) = self.db.get(key.as_bytes())? {
            if existing.as_ref() != value.as_slice() {
                return Err(TelemetryError::ReceiptConflict);
            }
            return Ok(());
        }
        self.db.insert(key.as_bytes(), value)?;
        self.db.flush()?;
        Ok(())
    }

    pub fn transactions(
        &self,
        organization_id: &str,
    ) -> Result<Vec<QCoreTransactionTelemetry>, TelemetryError> {
        let prefix = format!(
            "{}{}:",
            std::str::from_utf8(TX_PREFIX).unwrap(),
            organization_id
        );
        let mut out = Vec::new();
        for item in self.db.scan_prefix(prefix.as_bytes()) {
            let (_, value) = item?;
            out.push(
                serde_json::from_slice(&value)
                    .map_err(|e| TelemetryError::Serialization(e.to_string()))?,
            );
        }
        out.sort_by_key(|row: &QCoreTransactionTelemetry| row.updated_at_ms);
        Ok(out)
    }

    pub fn receipts(
        &self,
        organization_id: &str,
    ) -> Result<Vec<QCoreReceiptTelemetry>, TelemetryError> {
        let prefix = format!(
            "{}{}:",
            std::str::from_utf8(RECEIPT_PREFIX).unwrap(),
            organization_id
        );
        let mut out = Vec::new();
        for item in self.db.scan_prefix(prefix.as_bytes()) {
            let (_, value) = item?;
            out.push(
                serde_json::from_slice(&value)
                    .map_err(|e| TelemetryError::Serialization(e.to_string()))?,
            );
        }
        out.sort_by_key(|row: &QCoreReceiptTelemetry| row.timestamp_ms);
        Ok(out)
    }
}

fn state_rank(state: &str) -> u8 {
    match state {
        "REQUESTED" => 10,
        "VALIDATING" => 20,
        "AUTHORITY_EVALUATION" => 30,
        "AUTHORIZED" => 40,
        "EXECUTING" => 50,
        "EXECUTED" => 60,
        "OUTCOME_RECORDED" => 70,
        "RECEIPTED" => 80,
        "VALIDATION_FAILED" | "REJECTED" | "FAILED" => 90,
        _ => 0,
    }
}

fn validate_scope(organization_id: &str, tenant_id: &str) -> Result<(), TelemetryError> {
    if organization_id.is_empty() || tenant_id.is_empty() || organization_id != tenant_id {
        return Err(TelemetryError::TenantMismatch);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn db() -> Arc<Db> {
        Arc::new(sled::Config::new().temporary(true).open().unwrap())
    }
    fn tx(state: &str, updated_at_ms: u64) -> QCoreTransactionTelemetry {
        QCoreTransactionTelemetry {
            organization_id: "org-a".into(),
            tenant_id: "org-a".into(),
            transaction_id: "tx-1".into(),
            state: state.into(),
            kind: "INTELLIGENCE_FINDING_SEALING".into(),
            subject_id: "finding-1".into(),
            proposed_action: "SEAL".into(),
            policy_id: "p1".into(),
            policy_version: "1.0".into(),
            correlation_id: None,
            receipt_id: Some("VQR-1".into()),
            outcome_code: Some("SUCCESS".into()),
            created_at_ms: 1,
            updated_at_ms,
        }
    }

    #[test]
    fn transaction_telemetry_is_durable_and_tenant_bound() {
        let store = QCoreTelemetryStore::new(db());
        store.record_transaction(&tx("RECEIPTED", 2)).unwrap();
        let rows = store.transactions("org-a").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].transaction_id, "tx-1");
    }

    #[test]
    fn stale_transaction_updates_are_rejected() {
        let store = QCoreTelemetryStore::new(db());
        store.record_transaction(&tx("EXECUTED", 10)).unwrap();
        assert!(matches!(
            store.record_transaction(&tx("VALIDATING", 11)),
            Err(TelemetryError::StaleTransaction)
        ));
        assert!(matches!(
            store.record_transaction(&tx("EXECUTED", 9)),
            Err(TelemetryError::StaleTransaction)
        ));
    }

    #[test]
    fn cross_tenant_telemetry_is_rejected() {
        let store = QCoreTelemetryStore::new(db());
        let mut row = tx("REQUESTED", 1);
        row.tenant_id = "org-b".into();
        assert!(matches!(
            store.record_transaction(&row),
            Err(TelemetryError::TenantMismatch)
        ));
    }

    #[test]
    fn receipt_registration_is_idempotent_but_conflicts_are_rejected() {
        let store = QCoreTelemetryStore::new(db());
        let row = QCoreReceiptTelemetry {
            organization_id: "org-a".into(),
            receipt_id: "VQR-1".into(),
            transaction_id: "tx-1".into(),
            tenant_id: "org-a".into(),
            status: "SEALED".into(),
            decision: "AUTHORIZED".into(),
            outcome_code: "SUCCESS".into(),
            policy_id: "p1".into(),
            policy_version: "1.0".into(),
            ledger_commit_index: 1,
            timestamp_ms: 1,
            payload_hash: "abc".into(),
            issuer_key_fingerprint: "key".into(),
            verification: ReceiptVerificationState::Verified,
        };
        store.record_receipt(&row).unwrap();
        store.record_receipt(&row).unwrap();
        let mut conflict = row.clone();
        conflict.payload_hash = "different".into();
        assert!(matches!(
            store.record_receipt(&conflict),
            Err(TelemetryError::ReceiptConflict)
        ));
    }
}
