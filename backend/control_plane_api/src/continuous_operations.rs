//! Phase 3 — Continuous Security Operations.
//!
//! This module adds durable, tenant-bound operational state on top of the
//! authoritative Q-Core telemetry, security findings/incidents, issuer-key
//! registry and optional AER-KEP-Q runtime. It never upgrades caller claims
//! into verified security facts.

use crate::{
    qcore_telemetry::QCoreTelemetryStore,
    receipt_key_registry::{KeyState, ReceiptKeyRegistry},
    security_operations::SecurityOperationsStore,
    ControlPlaneState,
};
use auth_service::AuthenticatedUser;
use axum::{extract::{Path, State}, http::StatusCode, response::{IntoResponse, Response}, Extension, Json};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sled::Db;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;

const ALERT_PREFIX: &[u8] = b"security:alert:";
const BASELINE_PREFIX: &[u8] = b"security:policy-baseline:";
const DRIFT_PREFIX: &[u8] = b"security:policy-drift:";
const REMEDIATION_PREFIX: &[u8] = b"security:remediation:";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SecurityAlert {
    pub organization_id: String,
    pub alert_id: String,
    pub signal_id: String,
    pub source: String,
    pub severity: String,
    pub status: String,
    pub title: String,
    pub message: String,
    pub evidence_refs: Vec<String>,
    pub correlation_id: String,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MonitoringSignalInput {
    pub signal_id: String,
    pub source: String,
    pub severity: String,
    pub title: String,
    pub message: String,
    pub evidence_refs: Vec<String>,
    pub correlation_id: Option<String>,
    pub observed_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PolicyBaseline {
    pub organization_id: String,
    pub policy_id: String,
    pub policy_version: String,
    pub policy_hash: String,
    pub registered_by: String,
    pub registered_at_ms: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PolicyBaselineInput {
    pub policy_id: String,
    pub policy_version: String,
    pub policy: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PolicyDriftRecord {
    pub organization_id: String,
    pub drift_id: String,
    pub policy_id: String,
    pub baseline_version: Option<String>,
    pub baseline_hash: Option<String>,
    pub observed_version: String,
    pub observed_hash: String,
    pub status: String,
    pub observed_at_ms: u64,
    pub observed_by: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PolicyObservationInput {
    pub policy_id: String,
    pub policy_version: String,
    pub policy: Value,
    pub observed_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RemediationAction {
    pub organization_id: String,
    pub remediation_id: String,
    pub action: String,
    pub finding_id: Option<String>,
    pub incident_id: Option<String>,
    pub status: String,
    pub rationale: String,
    pub proposed_by: String,
    pub approved_by: Option<String>,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RemediationInput {
    pub action: String,
    pub finding_id: Option<String>,
    pub incident_id: Option<String>,
    pub rationale: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RemediationTransitionInput {
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CryptoPosture {
    pub status: String,
    pub key_registry: KeyRegistryPosture,
    pub receipt_verification: ReceiptVerificationPosture,
}

#[derive(Debug, Clone, Serialize)]
pub struct KeyRegistryPosture {
    pub status: String,
    pub total: usize,
    pub active: usize,
    pub rotating: usize,
    pub deprecated: usize,
    pub retired: usize,
    pub revoked: usize,
    pub issuers: Vec<KeyLifecycleView>,
}

#[derive(Debug, Clone, Serialize)]
pub struct KeyLifecycleView {
    pub service_id: String,
    pub ed25519_key_id: String,
    pub ml_dsa_87_key_id: String,
    pub issuer_key_fingerprint: String,
    pub state: KeyState,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReceiptVerificationPosture {
    pub status: String,
    pub total_receipts: usize,
    pub verified: usize,
    pub pending_verification: usize,
    pub rejected: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct AerPosture {
    pub status: String,
    pub runtime_attachment: String,
    pub domain_id: Option<String>,
    pub active_epoch: Option<u64>,
    pub epoch_status: Option<String>,
    pub pending_messages: Option<usize>,
    pub exposure_status: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ContinuousOperationsSnapshot {
    pub organization_id: String,
    pub data_state: String,
    pub generated_at_ms: u64,
    pub monitoring: MonitoringPosture,
    pub risk: RiskPosture,
    pub alerts: AlertSummary,
    pub policy_drift: PolicyDriftSummary,
    pub crypto_posture: CryptoPosture,
    pub aer_kep_q: AerPosture,
    pub incidents: IncidentSummary,
}

#[derive(Debug, Clone, Serialize)]
pub struct MonitoringPosture {
    pub status: String,
    pub last_observed_at_ms: Option<u64>,
    pub signals_observed: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct RiskPosture {
    pub status: String,
    pub highest_risk_band: String,
    pub high_or_critical_findings: usize,
    pub open_incidents: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct AlertSummary {
    pub total: usize,
    pub open: usize,
    pub acknowledged: usize,
    pub by_severity: Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct PolicyDriftSummary {
    pub total_observations: usize,
    pub drifted: usize,
    pub in_sync: usize,
    pub baseline_missing: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct IncidentSummary {
    pub total: usize,
    pub open: usize,
    pub acknowledged: usize,
    pub resolved: usize,
}

#[derive(Debug, Error)]
pub enum ContinuousOperationsError {
    #[error("organization is required")]
    EmptyOrganization,
    #[error("signal id is required")]
    EmptySignalId,
    #[error("source is not allowed")]
    InvalidSource,
    #[error("severity is not allowed")]
    InvalidSeverity,
    #[error("alert title is required")]
    EmptyTitle,
    #[error("evidence reference is required")]
    MissingEvidence,
    #[error("monitoring signal conflicts with an existing identity")]
    SignalConflict,
    #[error("policy identity is required")]
    InvalidPolicy,
    #[error("policy baseline already exists with different content")]
    BaselineConflict,
    #[error("policy observation conflict")]
    ObservationConflict,
    #[error("unsupported remediation action")]
    UnsupportedRemediation,
    #[error("remediation not found")]
    RemediationNotFound,
    #[error("invalid remediation transition")]
    InvalidRemediationTransition,
    #[error("incident is required for this remediation")]
    MissingIncident,
    #[error("incident operation failed: {0}")]
    Incident(String),
    #[error("storage failed: {0}")]
    Storage(#[from] sled::Error),
    #[error("telemetry read failed: {0}")]
    Telemetry(String),
    #[error("security operations read failed: {0}")]
    Security(String),
    #[error("key registry read failed: {0}")]
    KeyRegistry(String),
    #[error("serialization failed: {0}")]
    Serialization(String),
}

#[derive(Clone)]
pub struct ContinuousOperationsStore {
    db: Arc<Db>,
}

impl ContinuousOperationsStore {
    pub fn new(db: Arc<Db>) -> Self {
        Self { db }
    }

    pub fn record_monitoring_signal(
        &self,
        organization_id: &str,
        input: &MonitoringSignalInput,
    ) -> Result<SecurityAlert, ContinuousOperationsError> {
        validate_org(organization_id)?;
        if input.signal_id.trim().is_empty() {
            return Err(ContinuousOperationsError::EmptySignalId);
        }
        validate_source(&input.source)?;
        let severity = normalize_severity(&input.severity)?;
        if input.title.trim().is_empty() {
            return Err(ContinuousOperationsError::EmptyTitle);
        }
        if input.evidence_refs.is_empty() || input.evidence_refs.iter().any(|v| v.trim().is_empty()) {
            return Err(ContinuousOperationsError::MissingEvidence);
        }
        let alert_id = format!(
            "ALR-{}",
            &blake3::hash(format!("{}:{}", organization_id, input.signal_id).as_bytes())
                .to_hex()
                .to_string()[..24]
        );
        let key = alert_key(organization_id, &alert_id);
        let alert = SecurityAlert {
            organization_id: organization_id.to_owned(),
            alert_id,
            signal_id: input.signal_id.clone(),
            source: input.source.trim().to_ascii_lowercase(),
            severity,
            status: "open".into(),
            title: input.title.trim().to_owned(),
            message: input.message.trim().to_owned(),
            evidence_refs: input.evidence_refs.clone(),
            correlation_id: input
                .correlation_id
                .clone()
                .unwrap_or_else(|| format!("corr-{}", input.signal_id)),
            created_at_ms: input.observed_at_ms,
            updated_at_ms: input.observed_at_ms,
        };
        let value = serde_json::to_vec(&alert)
            .map_err(|e| ContinuousOperationsError::Serialization(e.to_string()))?;
        if let Some(existing) = self.db.get(&key)? {
            let previous: SecurityAlert = serde_json::from_slice(&existing)
                .map_err(|e| ContinuousOperationsError::Serialization(e.to_string()))?;
            if existing.as_ref() == value.as_slice() {
                return Ok(previous);
            }
            return Err(ContinuousOperationsError::SignalConflict);
        }
        self.db.insert(key, value)?;
        self.db.flush()?;
        Ok(alert)
    }

    pub fn alerts(&self, organization_id: &str) -> Result<Vec<SecurityAlert>, ContinuousOperationsError> {
        validate_org(organization_id)?;
        let prefix = format!(
            "{}{}:",
            std::str::from_utf8(ALERT_PREFIX).unwrap(),
            organization_id
        );
        let mut items = Vec::new();
        for entry in self.db.scan_prefix(prefix.as_bytes()) {
            let (_, value) = entry?;
            items.push(
                serde_json::from_slice(&value)
                    .map_err(|e| ContinuousOperationsError::Serialization(e.to_string()))?,
            );
        }
        items.sort_by_key(|item: &SecurityAlert| item.updated_at_ms);
        Ok(items)
    }

    pub fn transition_alert(
        &self,
        organization_id: &str,
        alert_id: &str,
        target: &str,
        now_ms: u64,
    ) -> Result<SecurityAlert, ContinuousOperationsError> {
        let key = alert_key(organization_id, alert_id);
        let Some(value) = self.db.get(&key)? else {
            return Err(ContinuousOperationsError::SignalConflict);
        };
        let mut alert: SecurityAlert = serde_json::from_slice(&value)
            .map_err(|e| ContinuousOperationsError::Serialization(e.to_string()))?;
        let target = target.trim().to_ascii_lowercase();
        if !matches!(target.as_str(), "open" | "acknowledged" | "resolved")
            || alert_rank(&target) < alert_rank(&alert.status)
        {
            return Err(ContinuousOperationsError::InvalidRemediationTransition);
        }
        alert.status = target;
        alert.updated_at_ms = now_ms;
        self.db.insert(
            key,
            serde_json::to_vec(&alert)
                .map_err(|e| ContinuousOperationsError::Serialization(e.to_string()))?,
        )?;
        self.db.flush()?;
        Ok(alert)
    }

    pub fn register_policy_baseline(
        &self,
        organization_id: &str,
        input: &PolicyBaselineInput,
        actor: &str,
        now_ms: u64,
    ) -> Result<PolicyBaseline, ContinuousOperationsError> {
        validate_org(organization_id)?;
        validate_policy_identity(&input.policy_id, &input.policy_version)?;
        let policy_hash = canonical_hash(&input.policy);
        let baseline = PolicyBaseline {
            organization_id: organization_id.to_owned(),
            policy_id: input.policy_id.trim().to_owned(),
            policy_version: input.policy_version.trim().to_owned(),
            policy_hash,
            registered_by: actor.to_owned(),
            registered_at_ms: now_ms,
        };
        let key = baseline_key(organization_id, &baseline.policy_id);
        let value = serde_json::to_vec(&baseline)
            .map_err(|e| ContinuousOperationsError::Serialization(e.to_string()))?;
        if let Some(existing) = self.db.get(&key)? {
            let previous: PolicyBaseline = serde_json::from_slice(&existing)
                .map_err(|e| ContinuousOperationsError::Serialization(e.to_string()))?;
            if previous.policy_hash == baseline.policy_hash
                && previous.policy_version == baseline.policy_version
            {
                return Ok(previous);
            }
            return Err(ContinuousOperationsError::BaselineConflict);
        }
        self.db.insert(key, value)?;
        self.db.flush()?;
        Ok(baseline)
    }

    pub fn policy_observation(
        &self,
        organization_id: &str,
        input: &PolicyObservationInput,
        actor: &str,
    ) -> Result<PolicyDriftRecord, ContinuousOperationsError> {
        validate_org(organization_id)?;
        validate_policy_identity(&input.policy_id, &input.policy_version)?;
        let observed_hash = canonical_hash(&input.policy);
        let baseline = self.db.get(baseline_key(organization_id, input.policy_id.trim()))?;
        let baseline = baseline
            .map(|value| serde_json::from_slice::<PolicyBaseline>(&value))
            .transpose()
            .map_err(|e| ContinuousOperationsError::Serialization(e.to_string()))?;
        let (status, baseline_version, baseline_hash) = match baseline {
            Some(ref b) if b.policy_hash == observed_hash => {
                ("in_sync".to_owned(), Some(b.policy_version.clone()), Some(b.policy_hash.clone()))
            }
            Some(ref b) => (
                "drifted".to_owned(),
                Some(b.policy_version.clone()),
                Some(b.policy_hash.clone()),
            ),
            None => ("baseline_missing".to_owned(), None, None),
        };
        let drift_id = format!(
            "DRIFT-{}",
            &blake3::hash(
                format!(
                    "{}:{}:{}:{}",
                    organization_id, input.policy_id, input.observed_at_ms, observed_hash
                )
                .as_bytes(),
            )
            .to_hex()
            .to_string()[..24]
        );
        let record = PolicyDriftRecord {
            organization_id: organization_id.to_owned(),
            drift_id: drift_id.clone(),
            policy_id: input.policy_id.trim().to_owned(),
            baseline_version,
            baseline_hash,
            observed_version: input.policy_version.trim().to_owned(),
            observed_hash,
            status,
            observed_at_ms: input.observed_at_ms,
            observed_by: actor.to_owned(),
        };
        let key = drift_key(organization_id, &drift_id);
        let value = serde_json::to_vec(&record)
            .map_err(|e| ContinuousOperationsError::Serialization(e.to_string()))?;
        if let Some(existing) = self.db.get(&key)? {
            if existing.as_ref() == value.as_slice() {
                return Ok(record);
            }
            return Err(ContinuousOperationsError::ObservationConflict);
        }
        self.db.insert(key, value)?;
        self.db.flush()?;
        Ok(record)
    }

    pub fn policy_drift(&self, organization_id: &str) -> Result<Vec<PolicyDriftRecord>, ContinuousOperationsError> {
        validate_org(organization_id)?;
        let prefix = format!(
            "{}{}:",
            std::str::from_utf8(DRIFT_PREFIX).unwrap(),
            organization_id
        );
        let mut items = Vec::new();
        for entry in self.db.scan_prefix(prefix.as_bytes()) {
            let (_, value) = entry?;
            items.push(
                serde_json::from_slice(&value)
                    .map_err(|e| ContinuousOperationsError::Serialization(e.to_string()))?,
            );
        }
        items.sort_by_key(|item: &PolicyDriftRecord| item.observed_at_ms);
        Ok(items)
    }

    pub fn propose_remediation(
        &self,
        organization_id: &str,
        input: &RemediationInput,
        actor: &str,
        now_ms: u64,
    ) -> Result<RemediationAction, ContinuousOperationsError> {
        validate_org(organization_id)?;
        let action = input.action.trim().to_ascii_uppercase();
        if action != "ACKNOWLEDGE_INCIDENT" && action != "REVALIDATE_POLICY" {
            return Err(ContinuousOperationsError::UnsupportedRemediation);
        }
        if action == "ACKNOWLEDGE_INCIDENT" && input.incident_id.as_deref().unwrap_or("").trim().is_empty() {
            return Err(ContinuousOperationsError::MissingIncident);
        }
        if input.rationale.trim().is_empty() {
            return Err(ContinuousOperationsError::InvalidRemediationTransition);
        }
        let remediation_id = format!(
            "REM-{}",
            &blake3::hash(
                format!(
                    "{}:{}:{}:{}:{}",
                    organization_id,
                    action,
                    input.finding_id.as_deref().unwrap_or(""),
                    input.incident_id.as_deref().unwrap_or(""),
                    input.rationale.trim()
                )
                .as_bytes(),
            )
            .to_hex()
            .to_string()[..24]
        );
        let item = RemediationAction {
            organization_id: organization_id.to_owned(),
            remediation_id: remediation_id.clone(),
            action,
            finding_id: input.finding_id.clone(),
            incident_id: input.incident_id.clone(),
            status: "proposed".into(),
            rationale: input.rationale.trim().to_owned(),
            proposed_by: actor.to_owned(),
            approved_by: None,
            created_at_ms: now_ms,
            updated_at_ms: now_ms,
        };
        let key = remediation_key(organization_id, &remediation_id);
        let value = serde_json::to_vec(&item)
            .map_err(|e| ContinuousOperationsError::Serialization(e.to_string()))?;
        if let Some(existing) = self.db.get(&key)? {
            let previous: RemediationAction = serde_json::from_slice(&existing)
                .map_err(|e| ContinuousOperationsError::Serialization(e.to_string()))?;
            if existing.as_ref() == value.as_slice() {
                return Ok(previous);
            }
        } else {
            self.db.insert(key, value)?;
            self.db.flush()?;
        }
        self.db
            .get(remediation_key(organization_id, &remediation_id))?
            .ok_or(ContinuousOperationsError::RemediationNotFound)
            .and_then(|value| {
                serde_json::from_slice(&value)
                    .map_err(|e| ContinuousOperationsError::Serialization(e.to_string()))
            })
    }

    pub fn remediations(&self, organization_id: &str) -> Result<Vec<RemediationAction>, ContinuousOperationsError> {
        validate_org(organization_id)?;
        let prefix = format!(
            "{}{}:",
            std::str::from_utf8(REMEDIATION_PREFIX).unwrap(),
            organization_id
        );
        let mut items = Vec::new();
        for entry in self.db.scan_prefix(prefix.as_bytes()) {
            let (_, value) = entry?;
            items.push(
                serde_json::from_slice(&value)
                    .map_err(|e| ContinuousOperationsError::Serialization(e.to_string()))?,
            );
        }
        items.sort_by_key(|item: &RemediationAction| item.updated_at_ms);
        Ok(items)
    }

    pub fn transition_remediation(
        &self,
        organization_id: &str,
        remediation_id: &str,
        target: &str,
        actor: &str,
        now_ms: u64,
    ) -> Result<RemediationAction, ContinuousOperationsError> {
        let key = remediation_key(organization_id, remediation_id);
        let Some(value) = self.db.get(&key)? else {
            return Err(ContinuousOperationsError::RemediationNotFound);
        };
        let mut item: RemediationAction = serde_json::from_slice(&value)
            .map_err(|e| ContinuousOperationsError::Serialization(e.to_string()))?;
        let target = target.trim().to_ascii_lowercase();

        match (item.status.as_str(), target.as_str()) {
            ("proposed", "approved") => item.approved_by = Some(actor.to_owned()),
            ("proposed", "rejected") => {}
            ("approved", "completed") => {}
            ("approved", "failed") => {}
            _ => return Err(ContinuousOperationsError::InvalidRemediationTransition),
        }

        if target == "completed" && item.action == "ACKNOWLEDGE_INCIDENT" {
            let incident_id = item
                .incident_id
                .as_deref()
                .ok_or(ContinuousOperationsError::MissingIncident)?;
            let incident = SecurityOperationsStore::new(self.db.clone())
                .transition_incident(organization_id, incident_id, "acknowledged", now_ms)
                .map_err(|e| ContinuousOperationsError::Incident(e.to_string()))?;
            if incident.status != "acknowledged" && incident.status != "resolved" {
                return Err(ContinuousOperationsError::Incident(
                    "incident did not reach acknowledged state".into(),
                ));
            }
        }

        item.status = target;
        item.updated_at_ms = now_ms;
        self.db.insert(
            key,
            serde_json::to_vec(&item)
                .map_err(|e| ContinuousOperationsError::Serialization(e.to_string()))?,
        )?;
        self.db.flush()?;
        Ok(item)
    }
}

pub async fn operations(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(id): Path<String>,
) -> Response {
    if !crate::is_member(&state.db, &id, &user.username).unwrap_or(false) {
        return denied();
    }
    match build_snapshot(&state, &id) {
        Ok(snapshot) => Json(snapshot).into_response(),
        Err(error) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"status":"unavailable","error":error.to_string()})),
        ).into_response(),
    }
}

pub async fn executive_report(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(id): Path<String>,
) -> Response {
    if !crate::is_member(&state.db, &id, &user.username).unwrap_or(false) {
        return denied();
    }
    Json(json!({
        "report_type": "executive_security_operations",
        "source": "durable_control_plane_state",
        "snapshot": match build_snapshot(&state, &id) {
            Ok(snapshot) => snapshot,
            Err(error) => return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({"status":"unavailable","error":error.to_string()})),
            ).into_response(),
        },
    }))
    .into_response()
}

pub async fn alerts(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(id): Path<String>,
) -> Response {
    if !crate::is_member(&state.db, &id, &user.username).unwrap_or(false) {
        return denied();
    }
    match ContinuousOperationsStore::new(state.db.clone()).alerts(&id) {
        Ok(items) => Json(json!({
            "organization_id": id,
            "items": items,
            "total": items.len(),
            "data_state": if items.is_empty() { "not_populated" } else { "populated" },
        })).into_response(),
        Err(error) => (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"status":"unavailable","error":error.to_string()}))).into_response(),
    }
}

pub async fn ingest_monitoring_signal(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(id): Path<String>,
    Json(input): Json<MonitoringSignalInput>,
) -> Response {
    if !can_operate(&state, &id, &user) {
        return denied();
    }
    match ContinuousOperationsStore::new(state.db.clone()).record_monitoring_signal(&id, &input) {
        Ok(alert) => (StatusCode::ACCEPTED, Json(json!({"status":"observed","alert":alert}))).into_response(),
        Err(error) => (StatusCode::BAD_REQUEST, Json(json!({"status":"rejected","error":error.to_string()}))).into_response(),
    }
}

pub async fn transition_alert(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path((id, alert_id)): Path<(String, String)>,
    Json(input): Json<RemediationTransitionInput>,
) -> Response {
    if !can_operate(&state, &id, &user) {
        return denied();
    }
    match ContinuousOperationsStore::new(state.db.clone())
        .transition_alert(&id, &alert_id, &input.status, now_ms())
    {
        Ok(alert) => (StatusCode::OK, Json(json!({"status":"updated","alert":alert}))).into_response(),
        Err(error) => (StatusCode::BAD_REQUEST, Json(json!({"status":"rejected","error":error.to_string()}))).into_response(),
    }
}

pub async fn baseline_policy(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(id): Path<String>,
    Json(input): Json<PolicyBaselineInput>,
) -> Response {
    if !can_operate(&state, &id, &user) {
        return denied();
    }
    match ContinuousOperationsStore::new(state.db.clone())
        .register_policy_baseline(&id, &input, &user.username, now_ms())
    {
        Ok(baseline) => (StatusCode::CREATED, Json(json!({"status":"registered","baseline":baseline}))).into_response(),
        Err(error) => (StatusCode::BAD_REQUEST, Json(json!({"status":"rejected","error":error.to_string()}))).into_response(),
    }
}

pub async fn observe_policy(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(id): Path<String>,
    Json(input): Json<PolicyObservationInput>,
) -> Response {
    if !can_operate(&state, &id, &user) {
        return denied();
    }
    match ContinuousOperationsStore::new(state.db.clone()).policy_observation(&id, &input, &user.username) {
        Ok(observation) => (StatusCode::ACCEPTED, Json(json!({"status":observation.status,"observation":observation}))).into_response(),
        Err(error) => (StatusCode::BAD_REQUEST, Json(json!({"status":"rejected","error":error.to_string()}))).into_response(),
    }
}

pub async fn policy_drift(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(id): Path<String>,
) -> Response {
    if !crate::is_member(&state.db, &id, &user.username).unwrap_or(false) {
        return denied();
    }
    match ContinuousOperationsStore::new(state.db.clone()).policy_drift(&id) {
        Ok(items) => Json(json!({
            "organization_id": id,
            "items": items,
            "total": items.len(),
            "data_state": if items.is_empty() { "not_populated" } else { "populated" },
        })).into_response(),
        Err(error) => (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"status":"unavailable","error":error.to_string()}))).into_response(),
    }
}

pub async fn remediations(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(id): Path<String>,
) -> Response {
    if !crate::is_member(&state.db, &id, &user.username).unwrap_or(false) {
        return denied();
    }
    match ContinuousOperationsStore::new(state.db.clone()).remediations(&id) {
        Ok(items) => Json(json!({
            "organization_id": id,
            "items": items,
            "total": items.len(),
            "data_state": if items.is_empty() { "not_populated" } else { "populated" },
        })).into_response(),
        Err(error) => (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"status":"unavailable","error":error.to_string()}))).into_response(),
    }
}

pub async fn propose_remediation(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(id): Path<String>,
    Json(input): Json<RemediationInput>,
) -> Response {
    if !can_operate(&state, &id, &user) {
        return denied();
    }
    match ContinuousOperationsStore::new(state.db.clone())
        .propose_remediation(&id, &input, &user.username, now_ms())
    {
        Ok(remediation) => (StatusCode::CREATED, Json(json!({"status":"proposed","remediation":remediation}))).into_response(),
        Err(error) => (StatusCode::BAD_REQUEST, Json(json!({"status":"rejected","error":error.to_string()}))).into_response(),
    }
}

pub async fn transition_remediation(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path((id, remediation_id)): Path<(String, String)>,
    Json(input): Json<RemediationTransitionInput>,
) -> Response {
    if !can_operate(&state, &id, &user) {
        return denied();
    }
    match ContinuousOperationsStore::new(state.db.clone()).transition_remediation(
        &id,
        &remediation_id,
        &input.status,
        &user.username,
        now_ms(),
    ) {
        Ok(remediation) => (StatusCode::OK, Json(json!({"status":"updated","remediation":remediation}))).into_response(),
        Err(error) => (StatusCode::BAD_REQUEST, Json(json!({"status":"rejected","error":error.to_string()}))).into_response(),
    }
}

pub async fn crypto_posture(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(id): Path<String>,
) -> Response {
    if !crate::is_member(&state.db, &id, &user.username).unwrap_or(false) {
        return denied();
    }
    match build_crypto_posture(&state, &id) {
        Ok(posture) => Json(posture).into_response(),
        Err(error) => (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"status":"unavailable","error":error.to_string()}))).into_response(),
    }
}

pub async fn audit(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(id): Path<String>,
) -> Response {
    if !crate::is_member(&state.db, &id, &user.username).unwrap_or(false) {
        return denied();
    }
    let operations = ContinuousOperationsStore::new(state.db.clone());
    let alerts = match operations.alerts(&id) {
        Ok(value) => value,
        Err(error) => return (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"status":"unavailable","error":error.to_string()}))).into_response(),
    };
    let drift = match operations.policy_drift(&id) {
        Ok(value) => value,
        Err(error) => return (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"status":"unavailable","error":error.to_string()}))).into_response(),
    };
    let remediations = match operations.remediations(&id) {
        Ok(value) => value,
        Err(error) => return (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"status":"unavailable","error":error.to_string()}))).into_response(),
    };
    Json(json!({
        "organization_id": id,
        "source": "durable_control_plane_state",
        "alerts": alerts,
        "policy_drift": drift,
        "remediations": remediations,
    }))
    .into_response()
}

pub fn build_snapshot(
    state: &ControlPlaneState,
    organization_id: &str,
) -> Result<ContinuousOperationsSnapshot, ContinuousOperationsError> {
    let operations = ContinuousOperationsStore::new(state.db.clone());
    let alerts = operations.alerts(organization_id)?;
    let drift = operations.policy_drift(organization_id)?;
    let security = SecurityOperationsStore::new(state.db.clone());
    let findings = security
        .findings(organization_id)
        .map_err(|e| ContinuousOperationsError::Security(e.to_string()))?;
    let incidents = security
        .incidents(organization_id)
        .map_err(|e| ContinuousOperationsError::Security(e.to_string()))?;
    let telemetry = QCoreTelemetryStore::new(state.db.clone());
    let transactions = telemetry
        .transactions(organization_id)
        .map_err(|e| ContinuousOperationsError::Telemetry(e.to_string()))?;
    let receipts = telemetry
        .receipts(organization_id)
        .map_err(|e| ContinuousOperationsError::Telemetry(e.to_string()))?;
    let crypto = build_crypto_posture(state, organization_id)?;
    let aer = build_aer_posture(state, organization_id);
    let latest_observation = transactions
        .iter()
        .map(|item| item.updated_at_ms)
        .chain(receipts.iter().map(|item| item.timestamp_ms))
        .chain(alerts.iter().map(|item| item.updated_at_ms))
        .max();
    let high_or_critical = findings
        .iter()
        .filter(|f| matches!(f.risk_band.as_str(), "high" | "critical"))
        .count();
    let open_incidents = incidents.iter().filter(|i| i.status == "open").count();
    let highest_risk_band = highest_risk(
        findings
            .iter()
            .map(|f| f.risk_band.as_str())
            .chain(alerts.iter().map(|a| a.severity.as_str())),
    );
    let monitoring_status = if latest_observation.is_some() {
        "active"
    } else {
        "not_populated"
    };
    let total_data = transactions.len()
        + receipts.len()
        + findings.len()
        + incidents.len()
        + alerts.len()
        + drift.len();
    Ok(ContinuousOperationsSnapshot {
        organization_id: organization_id.to_owned(),
        data_state: if total_data == 0 {
            "not_populated"
        } else {
            "populated"
        }
        .into(),
        generated_at_ms: now_ms(),
        monitoring: MonitoringPosture {
            status: monitoring_status.into(),
            last_observed_at_ms: latest_observation,
            signals_observed: transactions.len() + receipts.len() + alerts.len(),
        },
        risk: RiskPosture {
            status: highest_risk_band.clone(),
            highest_risk_band,
            high_or_critical_findings: high_or_critical,
            open_incidents,
        },
        alerts: AlertSummary {
            total: alerts.len(),
            open: alerts.iter().filter(|a| a.status == "open").count(),
            acknowledged: alerts.iter().filter(|a| a.status == "acknowledged").count(),
            by_severity: json!({
                "critical": alerts.iter().filter(|a| a.severity == "critical").count(),
                "high": alerts.iter().filter(|a| a.severity == "high").count(),
                "medium": alerts.iter().filter(|a| a.severity == "medium").count(),
                "low": alerts.iter().filter(|a| a.severity == "low").count(),
                "info": alerts.iter().filter(|a| a.severity == "info").count(),
            }),
        },
        policy_drift: PolicyDriftSummary {
            total_observations: drift.len(),
            drifted: drift.iter().filter(|d| d.status == "drifted").count(),
            in_sync: drift.iter().filter(|d| d.status == "in_sync").count(),
            baseline_missing: drift.iter().filter(|d| d.status == "baseline_missing").count(),
        },
        crypto_posture: crypto,
        aer_kep_q: aer,
        incidents: IncidentSummary {
            total: incidents.len(),
            open: open_incidents,
            acknowledged: incidents.iter().filter(|i| i.status == "acknowledged").count(),
            resolved: incidents.iter().filter(|i| i.status == "resolved").count(),
        },
    })
}

fn build_crypto_posture(state: &ControlPlaneState, organization_id: &str) -> Result<CryptoPosture, ContinuousOperationsError> {
    let registry = ReceiptKeyRegistry::new(state.db.clone());
    let keys = registry.list(organization_id).map_err(|e| ContinuousOperationsError::KeyRegistry(e.to_string()))?;
    let mut issuers = Vec::with_capacity(keys.len());
    let mut active = 0;
    let mut rotating = 0;
    let mut deprecated = 0;
    let mut retired = 0;
    let mut revoked = 0;
    for key in keys {
        match key.state {
            KeyState::Active => active += 1,
            KeyState::Rotating => rotating += 1,
            KeyState::Deprecated => deprecated += 1,
            KeyState::Retired => retired += 1,
            KeyState::Revoked => revoked += 1,
        }
        issuers.push(KeyLifecycleView {
            service_id: key.service_id,
            ed25519_key_id: key.ed25519_key_id,
            ml_dsa_87_key_id: key.ml_dsa_87_key_id,
            issuer_key_fingerprint: key.issuer_key_fingerprint,
            state: key.state,
        });
    }
    let receipts = QCoreTelemetryStore::new(state.db.clone())
        .receipts(organization_id)
        .map_err(|e| ContinuousOperationsError::Telemetry(e.to_string()))?;
    let verified = receipts.iter().filter(|r| matches!(r.verification, crate::qcore_telemetry::ReceiptVerificationState::Verified)).count();
    let pending = receipts.iter().filter(|r| matches!(r.verification, crate::qcore_telemetry::ReceiptVerificationState::PendingVerification)).count();
    let rejected = receipts.iter().filter(|r| matches!(r.verification, crate::qcore_telemetry::ReceiptVerificationState::Rejected)).count();
    Ok(CryptoPosture {
        status: if keys.is_empty() && receipts.is_empty() { "not_populated".into() } else { "available".into() },
        key_registry: KeyRegistryPosture {
            status: if keys.is_empty() { "not_populated".into() } else { "available".into() },
            total: keys.len(),
            active,
            rotating,
            deprecated,
            retired,
            revoked,
            issuers,
        },
        receipt_verification: ReceiptVerificationPosture {
            status: if receipts.is_empty() { "not_populated".into() } else { "available".into() },
            total_receipts: receipts.len(),
            verified,
            pending_verification: pending,
            rejected,
        },
    })
}

fn build_aer_posture(state: &ControlPlaneState, organization_id: &str) -> AerPosture {
    let Some(runtime) = &state.aer_kep_q else {
        return AerPosture {
            status: "unavailable".into(),
            runtime_attachment: "not_configured".into(),
            domain_id: None,
            active_epoch: None,
            epoch_status: None,
            pending_messages: None,
            exposure_status: None,
        };
    };
    let Ok(runtime) = runtime.lock() else {
        return AerPosture {
            status: "degraded".into(),
            runtime_attachment: "attached".into(),
            domain_id: None,
            active_epoch: None,
            epoch_status: None,
            pending_messages: None,
            exposure_status: None,
        };
    };
    if runtime.domain_id() != organization_id {
        return AerPosture {
            status: "unbound".into(),
            runtime_attachment: "attached".into(),
            domain_id: Some(runtime.domain_id().to_owned()),
            active_epoch: None,
            epoch_status: None,
            pending_messages: None,
            exposure_status: None,
        };
    }
    AerPosture {
        status: "operational".into(),
        runtime_attachment: "attached".into(),
        domain_id: Some(runtime.domain_id().to_owned()),
        active_epoch: Some(runtime.active_epoch()),
        epoch_status: Some(format!("{:?}", runtime.status())),
        pending_messages: Some(runtime.pending_for_epoch(runtime.active_epoch()).len()),
        exposure_status: Some("monitored".into()),
    }
}

fn validate_org(organization_id: &str) -> Result<(), ContinuousOperationsError> {
    if organization_id.trim().is_empty() {
        Err(ContinuousOperationsError::EmptyOrganization)
    } else {
        Ok(())
    }
}

fn validate_source(source: &str) -> Result<(), ContinuousOperationsError> {
    if matches!(source.trim().to_ascii_lowercase().as_str(), "intelligence" | "q_core" | "monitoring" | "operator" | "system") {
        Ok(())
    } else {
        Err(ContinuousOperationsError::InvalidSource)
    }
}

fn normalize_severity(value: &str) -> Result<String, ContinuousOperationsError> {
    let value = value.trim().to_ascii_lowercase();
    if matches!(value.as_str(), "critical" | "high" | "medium" | "low" | "info") {
        Ok(value)
    } else {
        Err(ContinuousOperationsError::InvalidSeverity)
    }
}

fn validate_policy_identity(policy_id: &str, version: &str) -> Result<(), ContinuousOperationsError> {
    if policy_id.trim().is_empty() || version.trim().is_empty() {
        Err(ContinuousOperationsError::InvalidPolicy)
    } else {
        Ok(())
    }
}

fn canonical_hash(policy: &Value) -> String {
    let bytes = serde_json::to_vec(policy).unwrap_or_default();
    blake3::hash(&bytes).to_hex().to_string()
}

fn highest_risk<'a, I>(bands: I) -> String
where
    I: Iterator<Item = &'a str>,
{
    let mut highest = "info";
    for band in bands {
        if risk_rank(band) > risk_rank(highest) {
            highest = band;
        }
    }
    highest.to_owned()
}

fn risk_rank(value: &str) -> u8 {
    match value {
        "critical" => 5,
        "high" => 4,
        "medium" => 3,
        "low" => 2,
        _ => 1,
    }
}

fn alert_rank(value: &str) -> u8 {
    match value {
        "open" => 10,
        "acknowledged" => 20,
        "resolved" => 30,
        _ => 0,
    }
}

fn alert_key(org: &str, id: &str) -> Vec<u8> {
    scoped_key(ALERT_PREFIX, org, id)
}

fn baseline_key(org: &str, id: &str) -> Vec<u8> {
    scoped_key(BASELINE_PREFIX, org, id)
}

fn drift_key(org: &str, id: &str) -> Vec<u8> {
    scoped_key(DRIFT_PREFIX, org, id)
}

fn remediation_key(org: &str, id: &str) -> Vec<u8> {
    scoped_key(REMEDIATION_PREFIX, org, id)
}

fn scoped_key(prefix: &[u8], org: &str, id: &str) -> Vec<u8> {
    let mut out = prefix.to_vec();
    out.extend_from_slice(org.as_bytes());
    out.push(b':');
    out.extend_from_slice(id.as_bytes());
    out
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or_default()
}

fn denied() -> Response {
    (StatusCode::FORBIDDEN, Json(json!({"error":"Organization access denied."}))).into_response()
}

fn can_operate(state: &ControlPlaneState, org_id: &str, user: &AuthenticatedUser) -> bool {
    matches!(
        crate::member_role(&state.db, org_id, &user.username).ok().flatten().as_deref(),
        Some("owner" | "security_admin" | "operator")
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{qcore_telemetry::{QCoreReceiptTelemetry, ReceiptVerificationState}, SecurityOperationsStore};

    fn db() -> Arc<Db> {
        Arc::new(sled::Config::new().temporary(true).open().unwrap())
    }

    fn signal() -> MonitoringSignalInput {
        MonitoringSignalInput {
            signal_id: "sig-1".into(),
            source: "monitoring".into(),
            severity: "high".into(),
            title: "External exposure observed".into(),
            message: "A monitored surface changed.".into(),
            evidence_refs: vec!["evidence-1".into()],
            correlation_id: Some("corr-1".into()),
            observed_at_ms: 10,
        }
    }

    #[test]
    fn monitoring_signal_is_idempotent_and_tenant_bound() {
        let db = db();
        let store = ContinuousOperationsStore::new(db.clone());
        let first = store.record_monitoring_signal("org-a", &signal()).unwrap();
        let second = store.record_monitoring_signal("org-a", &signal()).unwrap();
        assert_eq!(first, second);
        assert_eq!(store.alerts("org-a").unwrap().len(), 1);
        assert!(store.record_monitoring_signal("org-b", &signal()).unwrap().alert_id.starts_with("ALR-"));
        assert_eq!(store.alerts("org-a").unwrap().len(), 1);
        assert_eq!(store.alerts("org-b").unwrap().len(), 1);
    }

    #[test]
    fn policy_observation_detects_drift_without_fabricating_a_baseline() {
        let db = db();
        let store = ContinuousOperationsStore::new(db);
        let missing = store.policy_observation(
            "org-a",
            &PolicyObservationInput {
                policy_id: "p1".into(),
                policy_version: "1".into(),
                policy: json!({"threshold": 10}),
                observed_at_ms: 1,
            },
            "operator",
        ).unwrap();
        assert_eq!(missing.status, "baseline_missing");

        let baseline = store.register_policy_baseline(
            "org-a",
            &PolicyBaselineInput {
                policy_id: "p2".into(),
                policy_version: "1".into(),
                policy: json!({"enabled": true, "threshold": 10}),
            },
            "operator",
            2,
        ).unwrap();
        let synced = store.policy_observation(
            "org-a",
            &PolicyObservationInput {
                policy_id: "p2".into(),
                policy_version: "1".into(),
                policy: json!({"enabled": true, "threshold": 10}),
                observed_at_ms: 3,
            },
            "operator",
        ).unwrap();
        assert_eq!(synced.status, "in_sync");
        assert_eq!(synced.baseline_hash, Some(baseline.policy_hash));

        let drifted = store.policy_observation(
            "org-a",
            &PolicyObservationInput {
                policy_id: "p2".into(),
                policy_version: "2".into(),
                policy: json!({"enabled": false, "threshold": 10}),
                observed_at_ms: 4,
            },
            "operator",
        ).unwrap();
        assert_eq!(drifted.status, "drifted");
    }

    #[test]
    fn remediation_requires_approval_and_has_no_backward_transition() {
        let db = db();
        let store = ContinuousOperationsStore::new(db);
        let proposed = store.propose_remediation(
            "org-a",
            &RemediationInput {
                action: "REVALIDATE_POLICY".into(),
                finding_id: Some("f-1".into()),
                incident_id: None,
                rationale: "Policy observation is stale.".into(),
            },
            "operator",
            1,
        ).unwrap();
        assert_eq!(proposed.status, "proposed");
        let approved = store.transition_remediation("org-a", &proposed.remediation_id, "approved", "security_admin", 2).unwrap();
        assert_eq!(approved.status, "approved");
        assert!(store.transition_remediation("org-a", &proposed.remediation_id, "proposed", "operator", 3).is_err());
        let completed = store.transition_remediation("org-a", &proposed.remediation_id, "completed", "security_admin", 4).unwrap();
        assert_eq!(completed.status, "completed");
    }

    #[test]
    fn acknowledge_incident_remediation_moves_incident_to_acknowledged() {
        let db = db();
        let telemetry = QCoreTelemetryStore::new(db.clone());
        telemetry.record_receipt(&QCoreReceiptTelemetry {
            organization_id: "org-a".into(),
            receipt_id: "VQR-1".into(),
            transaction_id: "tx-1".into(),
            tenant_id: "org-a".into(),
            status: "SEALED".into(),
            decision: "AUTHORIZED".into(),
            outcome_code: "SUCCESS".into(),
            policy_id: "p1".into(),
            policy_version: "1".into(),
            ledger_commit_index: 1,
            timestamp_ms: 1,
            payload_hash: "hash".into(),
            issuer_key_fingerprint: "fp".into(),
            verification: ReceiptVerificationState::Verified,
        }).unwrap();
        let security = SecurityOperationsStore::new(db.clone());
        let finding = crate::security_operations::SecurityFindingInput {
            finding_id: "f-1".into(),
            receipt_id: "VQR-1".into(),
            severity: "high".into(),
            status: "open".into(),
            evidence_refs: vec!["ev".into()],
            risk_score: 80,
            created_at_ms: 1,
            updated_at_ms: 2,
        };
        security.record_finding("org-a", &finding).unwrap();
        let incident_id = security.incidents("org-a").unwrap()[0].incident_id.clone();
        let store = ContinuousOperationsStore::new(db);
        let remediation = store.propose_remediation(
            "org-a",
            &RemediationInput {
                action: "ACKNOWLEDGE_INCIDENT".into(),
                finding_id: Some("f-1".into()),
                incident_id: Some(incident_id.clone()),
                rationale: "Operator-approved acknowledgement.".into(),
            },
            "operator",
            3,
        ).unwrap();
        store.transition_remediation("org-a", &remediation.remediation_id, "approved", "security_admin", 4).unwrap();
        let completed = store.transition_remediation("org-a", &remediation.remediation_id, "completed", "security_admin", 5).unwrap();
        assert_eq!(completed.status, "completed");
        let incident = security.incidents("org-a").unwrap().into_iter().find(|i: &SecurityIncident| i.incident_id == incident_id).unwrap();
        assert_eq!(incident.status, "acknowledged");
    }
}
