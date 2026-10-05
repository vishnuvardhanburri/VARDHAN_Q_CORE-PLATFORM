use crate::{is_member, qcore_telemetry::{QCoreReceiptTelemetry, QCoreTelemetryStore, QCoreTransactionTelemetry, ReceiptVerificationState}, ControlPlaneState};
use axum::{extract::{Path, State}, response::{IntoResponse, Response}, Extension, Json};
use auth_service::middleware::AuthenticatedUser;
use serde::Deserialize;
use serde_json::json;

fn denied() -> Response { (axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Organization access denied."}))).into_response() }
fn member(state: &ControlPlaneState, org_id: &str, user: &AuthenticatedUser) -> bool { is_member(&state.db, org_id, &user.username).unwrap_or(false) }

#[derive(Debug, Deserialize)]
pub struct TransactionTelemetryInput {
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

#[derive(Debug, Deserialize)]
pub struct ReceiptTelemetryInput {
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

pub async fn security_posture(State(state): State<ControlPlaneState>, Extension(user): Extension<AuthenticatedUser>, Path(id): Path<String>) -> Response {
    if !member(&state, &id, &user) { return denied(); }
    let store = QCoreTelemetryStore::new(state.db.clone());
    let transactions = store.transactions(&id).unwrap_or_default();
    let receipts = store.receipts(&id).unwrap_or_default();
    Json(json!({ "organization_id": id, "status": "operational", "data_state": if transactions.is_empty() && receipts.is_empty() { "not_populated" } else { "populated" }, "findings": {"total": 0, "critical": 0, "high": 0, "medium": 0, "low": 0}, "incidents": {"open": 0}, "crypto_posture": {"status": "available", "source": "control-plane"}, "q_core": {"transactions": transactions.len(), "receipts": receipts.len()}, "note": "Security findings remain empty until Intelligence ingestion populates them." })).into_response()
}

pub async fn findings(State(state): State<ControlPlaneState>, Extension(user): Extension<AuthenticatedUser>, Path(id): Path<String>) -> Response {
    if !member(&state, &id, &user) { return denied(); }
    Json(json!({ "organization_id": id, "items": [], "total": 0, "data_state": "not_populated", "next_cursor": null })).into_response()
}

pub async fn incidents(State(state): State<ControlPlaneState>, Extension(user): Extension<AuthenticatedUser>, Path(id): Path<String>) -> Response {
    if !member(&state, &id, &user) { return denied(); }
    Json(json!({ "organization_id": id, "items": [], "total": 0, "data_state": "not_populated", "next_cursor": null })).into_response()
}

pub async fn transactions(State(state): State<ControlPlaneState>, Extension(user): Extension<AuthenticatedUser>, Path(id): Path<String>) -> Response {
    if !member(&state, &id, &user) { return denied(); }
    let store = QCoreTelemetryStore::new(state.db.clone());
    let items = store.transactions(&id).unwrap_or_default();
    let receipts = store.receipts(&id).unwrap_or_default();
    let total = items.len();
    Json(json!({ "organization_id": id, "items": items, "total": total, "receipts": receipts, "data_state": if total == 0 { "not_populated" } else { "populated" }, "next_cursor": null, "trust_boundary": "server_enforced", "receipt_authentication": "platform_crypto_path" })).into_response()
}

/// Authenticated transaction telemetry ingestion boundary.
/// Tenant/organization scope is checked before durable persistence.
pub async fn ingest_transaction(State(state): State<ControlPlaneState>, Extension(user): Extension<AuthenticatedUser>, Path(id): Path<String>, Json(input): Json<TransactionTelemetryInput>) -> impl IntoResponse {
    if !member(&state, &id, &user) { return denied(); }
    let store = QCoreTelemetryStore::new(state.db.clone());
    let telemetry = QCoreTransactionTelemetry {
        organization_id: id,
        transaction_id: input.transaction_id,
        tenant_id: input.tenant_id,
        state: input.state,
        kind: input.kind,
        subject_id: input.subject_id,
        proposed_action: input.proposed_action,
        policy_id: input.policy_id,
        policy_version: input.policy_version,
        correlation_id: input.correlation_id,
        receipt_id: input.receipt_id,
        outcome_code: input.outcome_code,
        created_at_ms: input.created_at_ms,
        updated_at_ms: input.updated_at_ms,
    };
    match store.record_transaction(&telemetry) {
        Ok(()) => Json(json!({"status":"accepted","transaction_id":telemetry.transaction_id,"data_state":"populated"})).into_response(),
        Err(err) => (axum::http::StatusCode::BAD_REQUEST, Json(json!({"status":"rejected","error":err.to_string()}))).into_response(),
    }
}

/// Authenticated receipt telemetry ingestion boundary.
/// `verification` is explicit; this endpoint never upgrades an unverified
/// receipt to Verified on its own.
pub async fn ingest_receipt(State(state): State<ControlPlaneState>, Extension(user): Extension<AuthenticatedUser>, Path(id): Path<String>, Json(input): Json<ReceiptTelemetryInput>) -> impl IntoResponse {
    if !member(&state, &id, &user) { return denied(); }
    let store = QCoreTelemetryStore::new(state.db.clone());
    let telemetry = QCoreReceiptTelemetry {
        organization_id: id,
        receipt_id: input.receipt_id,
        transaction_id: input.transaction_id,
        tenant_id: input.tenant_id,
        status: input.status,
        decision: input.decision,
        outcome_code: input.outcome_code,
        policy_id: input.policy_id,
        policy_version: input.policy_version,
        ledger_commit_index: input.ledger_commit_index,
        timestamp_ms: input.timestamp_ms,
        payload_hash: input.payload_hash,
        issuer_key_fingerprint: input.issuer_key_fingerprint,
        verification: input.verification,
    };
    match store.record_receipt(&telemetry) {
        Ok(()) => Json(json!({"status":"accepted","receipt_id":telemetry.receipt_id,"verification":telemetry.verification})).into_response(),
        Err(err) => (axum::http::StatusCode::BAD_REQUEST, Json(json!({"status":"rejected","error":err.to_string()}))).into_response(),
    }
}

pub async fn aer_kep_q_status(State(state): State<ControlPlaneState>, Extension(user): Extension<AuthenticatedUser>, Path(id): Path<String>) -> Response {
    if !member(&state, &id, &user) { return denied(); }
    let Some(runtime) = &state.aer_kep_q else {
        return Json(json!({ "organization_id": id, "status": "unavailable", "runtime_attachment": "not_configured", "security_model": "quarantine_reissue", "cipher_suite": "ML-KEM-1024", "epoch_visibility": "runtime_only", "pending_messages": null, "exposure": {"status": "runtime_only", "quarantine": "enabled"}, "note": "AER-KEP-Q requires the control-plane deployment crypto identity and vault boundary." })).into_response();
    };
    let Ok(runtime) = runtime.lock() else {
        return Json(json!({ "organization_id": id, "status": "degraded", "runtime_attachment": "attached", "error": "runtime_lock_unavailable" })).into_response();
    };
    let descriptor = runtime.descriptor().ok();
    Json(json!({
        "organization_id": id,
        "status": "operational",
        "runtime_attachment": "attached",
        "security_model": "quarantine_reissue",
        "cipher_suite": "ML-KEM-1024",
        "domain_id": runtime.domain_id(),
        "active_epoch": runtime.active_epoch(),
        "epoch_status": format!("{:?}", runtime.status()),
        "pending_messages": runtime.pending_for_epoch(runtime.active_epoch()).len(),
        "descriptor": descriptor.map(|d| json!({"epoch": d.epoch, "domain_id": d.domain_id})),
        "exposure": {"status": "monitored", "quarantine": "enabled"}
    })).into_response()
}
