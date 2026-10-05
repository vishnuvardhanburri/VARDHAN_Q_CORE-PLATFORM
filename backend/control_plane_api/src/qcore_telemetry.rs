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
        let key = format!("{}{}:{}", std::str::from_utf8(TX_PREFIX).unwrap(), telemetry.organization_id, telemetry.transaction_id);
        let value = serde_json::to_vec(telemetry)
            .map_err(|e| TelemetryError::Serialization(e.to_string()))?;
        self.db.insert(key.as_bytes(), value)?;
        self.db.flush()?;
        Ok(())
    }

    pub fn record_receipt(
        &self,
        telemetry: &QCoreReceiptTelemetry,
    ) -> Result<(), TelemetryError> {
        validate_scope(&telemetry.organization_id, &telemetry.tenant_id)?;
        if telemetry.receipt_id.trim().is_empty() {
            return Err(TelemetryError::EmptyReceiptId);
        }
        let key = format!("{}{}:{}", std::str::from_utf8(RECEIPT_PREFIX).unwrap(), telemetry.organization_id, telemetry.receipt_id);
        let value = serde_json::to_vec(telemetry)
            .map_err(|e| TelemetryError::Serialization(e.to_string()))?;
        self.db.insert(key.as_bytes(), value)?;
        self.db.flush()?;
        Ok(())
    }

    pub fn transactions(&self, organization_id: &str) -> Result<Vec<QCoreTransactionTelemetry>, TelemetryError> {
        let prefix = format!("{}{}:", std::str::from_utf8(TX_PREFIX).unwrap(), organization_id);
        let mut out = Vec::new();
        for item in self.db.scan_prefix(prefix.as_bytes()) {
            let (_, value) = item?;
            let row: QCoreTransactionTelemetry = serde_json::from_slice(&value)
                .map_err(|e| TelemetryError::Serialization(e.to_string()))?;
            out.push(row);
        }
        out.sort_by_key(|row| row.updated_at_ms);
        Ok(out)
    }

    pub fn receipts(&self, organization_id: &str) -> Result<Vec<QCoreReceiptTelemetry>, TelemetryError> {
        let prefix = format!("{}{}:", std::str::from_utf8(RECEIPT_PREFIX).unwrap(), organization_id);
        let mut out = Vec::new();
        for item in self.db.scan_prefix(prefix.as_bytes()) {
            let (_, value) = item?;
            let row: QCoreReceiptTelemetry = serde_json::from_slice(&value)
                .map_err(|e| TelemetryError::Serialization(e.to_string()))?;
            out.push(row);
        }
        out.sort_by_key(|row| row.timestamp_ms);
        Ok(out)
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

    #[test]
    fn transaction_telemetry_is_durable_and_tenant_bound() {
        let store = QCoreTelemetryStore::new(db());
        let row = QCoreTransactionTelemetry {
            organization_id: "org-a".into(), tenant_id: "org-a".into(),
            transaction_id: "tx-1".into(), state: "RECEIPTED".into(), kind: "INTELLIGENCE_FINDING_SEALING".into(),
            subject_id: "finding-1".into(), proposed_action: "SEAL".into(), policy_id: "p1".into(),
            policy_version: "1.0".into(), correlation_id: None, receipt_id: Some("VQR-1".into()),
            outcome_code: Some("SUCCESS".into()), created_at_ms: 1, updated_at_ms: 2,
        };
        store.record_transaction(&row).unwrap();
        let rows = store.transactions("org-a").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].transaction_id, "tx-1");
    }

    #[test]
    fn cross_tenant_telemetry_is_rejected() {
        let store = QCoreTelemetryStore::new(db());
        let row = QCoreTransactionTelemetry {
            organization_id: "org-a".into(), tenant_id: "org-b".into(),
            transaction_id: "tx-1".into(), state: "REQUESTED".into(), kind: "CUSTOM".into(),
            subject_id: "s".into(), proposed_action: "x".into(), policy_id: "p".into(), policy_version: "1".into(),
            correlation_id: None, receipt_id: None, outcome_code: None, created_at_ms: 1, updated_at_ms: 1,
        };
        assert!(matches!(store.record_transaction(&row), Err(TelemetryError::TenantMismatch)));
    }
}