use crate::qcore_telemetry::{QCoreTelemetryStore, ReceiptVerificationState};
use serde::{Deserialize, Serialize};
use sled::Db;
use std::sync::Arc;
use thiserror::Error;

const FINDING_PREFIX: &[u8] = b"security:finding:";
const INCIDENT_PREFIX: &[u8] = b"security:incident:";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SecurityFinding {
    pub organization_id: String,
    pub finding_id: String,
    pub receipt_id: String,
    pub severity: String,
    pub status: String,
    pub evidence_refs: Vec<String>,
    pub risk_score: u8,
    pub risk_band: String,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SecurityFindingInput {
    pub finding_id: String,
    pub receipt_id: String,
    pub severity: String,
    pub status: String,
    pub evidence_refs: Vec<String>,
    pub risk_score: u8,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SecurityIncident {
    pub organization_id: String,
    pub incident_id: String,
    pub severity: String,
    pub status: String,
    pub risk_score: u8,
    pub risk_band: String,
    pub finding_ids: Vec<String>,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
}

#[derive(Debug, Error)]
pub enum SecurityOperationsError {
    #[error("finding id is required")]
    EmptyFindingId,
    #[error("receipt id is required")]
    EmptyReceiptId,
    #[error("evidence reference is required")]
    MissingEvidence,
    #[error("unsupported severity")]
    InvalidSeverity,
    #[error("unsupported finding status")]
    InvalidStatus,
    #[error("risk score must be between 0 and 100")]
    InvalidRiskScore,
    #[error("verified Q-Core receipt is required")]
    MissingVerifiedReceipt,
    #[error("finding conflicts with an existing immutable identity")]
    FindingConflict,
    #[error("storage failed: {0}")]
    Storage(#[from] sled::Error),
    #[error("serialization failed: {0}")]
    Serialization(String),
}

#[derive(Clone)]
pub struct SecurityOperationsStore {
    db: Arc<Db>,
}

impl SecurityOperationsStore {
    pub fn new(db: Arc<Db>) -> Self { Self { db } }

    pub fn record_finding(
        &self,
        organization_id: &str,
        input: &SecurityFindingInput,
    ) -> Result<SecurityFinding, SecurityOperationsError> {
        if organization_id.trim().is_empty() || input.finding_id.trim().is_empty() {
            return Err(SecurityOperationsError::EmptyFindingId);
        }
        if input.receipt_id.trim().is_empty() { return Err(SecurityOperationsError::EmptyReceiptId); }
        if input.evidence_refs.is_empty() || input.evidence_refs.iter().any(|v| v.trim().is_empty()) {
            return Err(SecurityOperationsError::MissingEvidence);
        }
        if !matches!(input.severity.trim().to_ascii_lowercase().as_str(), "critical" | "high" | "medium" | "low" | "info") {
            return Err(SecurityOperationsError::InvalidSeverity);
        }
        if !matches!(input.status.trim().to_ascii_lowercase().as_str(), "open" | "acknowledged" | "resolved") {
            return Err(SecurityOperationsError::InvalidStatus);
        }

        let telemetry = QCoreTelemetryStore::new(self.db.clone());
        let verified = telemetry
            .receipts(organization_id)
            .map_err(|e| SecurityOperationsError::Serialization(e.to_string()))?
            .into_iter()
            .any(|receipt| {
                receipt.receipt_id == input.receipt_id
                    && receipt.verification == ReceiptVerificationState::Verified
                    && receipt.tenant_id == organization_id
            });
        if !verified { return Err(SecurityOperationsError::MissingVerifiedReceipt); }

        let finding = SecurityFinding {
            organization_id: organization_id.to_owned(),
            finding_id: input.finding_id.clone(),
            receipt_id: input.receipt_id.clone(),
            severity: input.severity.trim().to_ascii_lowercase(),
            status: input.status.trim().to_ascii_lowercase(),
            evidence_refs: input.evidence_refs.clone(),
            risk_score: input.risk_score,
            risk_band: risk_band(input.risk_score).to_owned(),
            created_at_ms: input.created_at_ms,
            updated_at_ms: input.updated_at_ms,
        };

        let key = finding_key(organization_id, &finding.finding_id);
        if let Some(existing) = self.db.get(&key)? {
            let previous: SecurityFinding = serde_json::from_slice(&existing)
                .map_err(|e| SecurityOperationsError::Serialization(e.to_string()))?;
            if previous.receipt_id != finding.receipt_id || previous.organization_id != finding.organization_id {
                return Err(SecurityOperationsError::FindingConflict);
            }
            if previous == finding { return Ok(previous); }
        }

        self.db.insert(&key, serde_json::to_vec(&finding).map_err(|e| SecurityOperationsError::Serialization(e.to_string()))?)?;
        self.db.flush()?;

        if finding.risk_score >= 70 {
            self.ensure_incident(&finding)?;
        }
        Ok(finding)
    }

    pub fn findings(&self, organization_id: &str) -> Result<Vec<SecurityFinding>, SecurityOperationsError> {
        let prefix = format!("{}{}:", std::str::from_utf8(FINDING_PREFIX).unwrap(), organization_id);
        let mut items = Vec::new();
        for entry in self.db.scan_prefix(prefix.as_bytes()) {
            let (_, value) = entry?;
            items.push(serde_json::from_slice(&value)
                .map_err(|e| SecurityOperationsError::Serialization(e.to_string()))?);
        }
        items.sort_by_key(|item: &SecurityFinding| item.updated_at_ms);
        Ok(items)
    }

    pub fn incidents(&self, organization_id: &str) -> Result<Vec<SecurityIncident>, SecurityOperationsError> {
        let prefix = format!("{}{}:", std::str::from_utf8(INCIDENT_PREFIX).unwrap(), organization_id);
        let mut items = Vec::new();
        for entry in self.db.scan_prefix(prefix.as_bytes()) {
            let (_, value) = entry?;
            items.push(serde_json::from_slice(&value)
                .map_err(|e| SecurityOperationsError::Serialization(e.to_string()))?);
        }
        items.sort_by_key(|item: &SecurityIncident| item.updated_at_ms);
        Ok(items)
    }

    pub fn transition_incident(
        &self,
        organization_id: &str,
        incident_id: &str,
        requested_status: &str,
        now_ms: u64,
    ) -> Result<SecurityIncident, SecurityOperationsError> {
        let key = incident_key(organization_id, incident_id);
        let Some(value) = self.db.get(&key)? else {
            return Err(SecurityOperationsError::FindingConflict);
        };
        let mut incident: SecurityIncident = serde_json::from_slice(&value)
            .map_err(|e| SecurityOperationsError::Serialization(e.to_string()))?;
        let current = incident.status.as_str();
        let target = requested_status.trim().to_ascii_lowercase();
        let valid_target = matches!(target.as_str(), "open" | "acknowledged" | "resolved");
        if !valid_target || status_rank(&target) < status_rank(current) {
            return Err(SecurityOperationsError::InvalidStatus);
        }
        incident.status = target;
        incident.updated_at_ms = now_ms;
        self.db.insert(
            key,
            serde_json::to_vec(&incident)
                .map_err(|e| SecurityOperationsError::Serialization(e.to_string()))?,
        )?;
        self.db.flush()?;
        Ok(incident)
    }

    fn ensure_incident(&self, finding: &SecurityFinding) -> Result<(), SecurityOperationsError> {
        let incident_id = incident_id(&finding.organization_id, &finding.finding_id);
        let key = incident_key(&finding.organization_id, &incident_id);
        let incident = if let Some(value) = self.db.get(&key)? {
            let mut item: SecurityIncident = serde_json::from_slice(&value)
                .map_err(|e| SecurityOperationsError::Serialization(e.to_string()))?;
            if !item.finding_ids.iter().any(|id| id == &finding.finding_id) {
                item.finding_ids.push(finding.finding_id.clone());
            }
            item.risk_score = item.risk_score.max(finding.risk_score);
            item.risk_band = risk_band(item.risk_score).to_owned();
            item.severity = highest_severity(&item.severity, &finding.severity).to_owned();
            item.updated_at_ms = finding.updated_at_ms;
            item
        } else {
            SecurityIncident {
                organization_id: finding.organization_id.clone(),
                incident_id,
                severity: finding.severity.clone(),
                status: "open".into(),
                risk_score: finding.risk_score,
                risk_band: risk_band(finding.risk_score).into(),
                finding_ids: vec![finding.finding_id.clone()],
                created_at_ms: finding.created_at_ms,
                updated_at_ms: finding.updated_at_ms,
            }
        };
        self.db.insert(key, serde_json::to_vec(&incident)
            .map_err(|e| SecurityOperationsError::Serialization(e.to_string()))?)?;
        self.db.flush()?;
        Ok(())
    }
}

fn finding_key(org: &str, id: &str) -> Vec<u8> {
    let mut out = FINDING_PREFIX.to_vec();
    out.extend_from_slice(org.as_bytes());
    out.push(b':');
    out.extend_from_slice(id.as_bytes());
    out
}

fn incident_key(org: &str, id: &str) -> Vec<u8> {
    let mut out = INCIDENT_PREFIX.to_vec();
    out.extend_from_slice(org.as_bytes());
    out.push(b':');
    out.extend_from_slice(id.as_bytes());
    out
}

fn incident_id(org: &str, finding_id: &str) -> String {
    let digest = blake3::hash(format!("{org}:{finding_id}").as_bytes()).to_hex().to_string();
    format!("INC-{}", &digest[..24])
}

fn highest_severity<'a>(a: &'a str, b: &'a str) -> &'a str {
    fn rank(s: &str) -> u8 {
        match s {
            "critical" => 5,
            "high" => 4,
            "medium" => 3,
            "low" => 2,
            _ => 1,
        }
    }
    if rank(a) >= rank(b) { a } else { b }
}

fn status_rank(status: &str) -> u8 {
    match status {
        "open" => 10,
        "acknowledged" => 20,
        "resolved" => 30,
        _ => 0,
    }
}

fn risk_band(score: u8) -> &'static str {
    match score {
        90..=100 => "critical",
        70..=89 => "high",
        40..=69 => "medium",
        1..=39 => "low",
        _ => "info",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::qcore_telemetry::{QCoreReceiptTelemetry, ReceiptVerificationState};

    fn db() -> Arc<Db> { Arc::new(sled::Config::new().temporary(true).open().unwrap()) }

    fn verified_receipt(store: &QCoreTelemetryStore) {
        store.record_receipt(&QCoreReceiptTelemetry {
            organization_id: "org-a".into(),
            receipt_id: "VQR-1".into(),
            transaction_id: "tx-1".into(),
            tenant_id: "org-a".into(),
            status: "SEALED".into(),
            decision: "AUTHORIZED".into(),
            outcome_code: "SUCCESS".into(),
            policy_id: "p1".into(),
            policy_version: "1.0".into(),
            ledger_commit_index: 7,
            timestamp_ms: 1,
            payload_hash: "abc".into(),
            issuer_key_fingerprint: "fp".into(),
            verification: ReceiptVerificationState::Verified,
        }).unwrap();
    }

    fn input() -> SecurityFindingInput {
        SecurityFindingInput {
            finding_id: "finding-1".into(),
            receipt_id: "VQR-1".into(),
            severity: "high".into(),
            status: "open".into(),
            evidence_refs: vec!["evidence-1".into()],
            risk_score: 82,
            created_at_ms: 1,
            updated_at_ms: 2,
        }
    }

    #[test]
    fn verified_receipt_creates_risk_and_incident() {
        let db = db();
        verified_receipt(&QCoreTelemetryStore::new(db.clone()));
        let store = SecurityOperationsStore::new(db);
        let finding = store.record_finding("org-a", &input()).unwrap();
        assert_eq!(finding.risk_band, "high");
        let incidents = store.incidents("org-a").unwrap();
        assert_eq!(incidents.len(), 1);
    }

    #[test]
    fn missing_or_cross_tenant_receipt_is_rejected() {
        let db = db();
        let store = SecurityOperationsStore::new(db.clone());
        assert!(matches!(store.record_finding("org-a", &input()), Err(SecurityOperationsError::MissingVerifiedReceipt)));
        verified_receipt(&QCoreTelemetryStore::new(db));
        let mut cross = input();
        cross.receipt_id = "VQR-2".into();
        assert!(matches!(store.record_finding("org-b", &cross), Err(SecurityOperationsError::MissingVerifiedReceipt)));
    }

    #[test]
    fn incident_state_transitions_are_monotonic() {
        let db = db();
        verified_receipt(&QCoreTelemetryStore::new(db.clone()));
        let store = SecurityOperationsStore::new(db);
        store.record_finding("org-a", &input()).unwrap();
        let incident_id = store.incidents("org-a").unwrap()[0].incident_id.clone();
        let acknowledged = store.transition_incident("org-a", &incident_id, "acknowledged", 3).unwrap();
        assert_eq!(acknowledged.status, "acknowledged");
        let resolved = store.transition_incident("org-a", &incident_id, "resolved", 4).unwrap();
        assert_eq!(resolved.status, "resolved");
        assert!(store.transition_incident("org-a", &incident_id, "open", 5).is_err());
    }

    #[test]
    fn identical_finding_is_idempotent() {
        let db = db();
        verified_receipt(&QCoreTelemetryStore::new(db.clone()));
        let store = SecurityOperationsStore::new(db);
        let first = store.record_finding("org-a", &input()).unwrap();
        let second = store.record_finding("org-a", &input()).unwrap();
        assert_eq!(first, second);
        assert_eq!(store.findings("org-a").unwrap().len(), 1);
        assert_eq!(store.incidents("org-a").unwrap().len(), 1);
    }
}
