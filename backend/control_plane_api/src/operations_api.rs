use crate::{is_member, ControlPlaneState};
use axum::{extract::{Path, State}, response::IntoResponse, Extension, Json};
use auth_service::middleware::AuthenticatedUser;
use serde_json::json;

fn denied() -> axum::response::Response { (axum::http::StatusCode::FORBIDDEN, Json(json!({"error":"Organization access denied."}))).into_response() }
fn member(state: &ControlPlaneState, org_id: &str, user: &AuthenticatedUser) -> bool { is_member(&state.db, org_id, &user.username).unwrap_or(false) }

pub async fn security_posture(State(state): State<ControlPlaneState>, Extension(user): Extension<AuthenticatedUser>, Path(id): Path<String>) -> impl IntoResponse {
    if !member(&state, &id, &user) { return denied(); }
    Json(json!({ "organization_id": id, "status": "operational", "data_state": "not_populated", "findings": {"total": 0, "critical": 0, "high": 0, "medium": 0, "low": 0}, "incidents": {"open": 0}, "crypto_posture": {"status": "available", "source": "control-plane"}, "note": "No security findings are fabricated. Intelligence ingestion must populate this view." }))
}

pub async fn findings(State(state): State<ControlPlaneState>, Extension(user): Extension<AuthenticatedUser>, Path(id): Path<String>) -> impl IntoResponse {
    if !member(&state, &id, &user) { return denied(); }
    Json(json!({ "organization_id": id, "items": [], "total": 0, "data_state": "not_populated", "next_cursor": null }))
}

pub async fn incidents(State(state): State<ControlPlaneState>, Extension(user): Extension<AuthenticatedUser>, Path(id): Path<String>) -> impl IntoResponse {
    if !member(&state, &id, &user) { return denied(); }
    Json(json!({ "organization_id": id, "items": [], "total": 0, "data_state": "not_populated", "next_cursor": null }))
}

pub async fn transactions(State(state): State<ControlPlaneState>, Extension(user): Extension<AuthenticatedUser>, Path(id): Path<String>) -> impl IntoResponse {
    if !member(&state, &id, &user) { return denied(); }
    Json(json!({ "organization_id": id, "items": [], "total": 0, "data_state": "not_populated", "next_cursor": null, "trust_boundary": "server_enforced", "receipt_authentication": "platform_crypto_path" }))
}

pub async fn aer_kep_q_status(State(state): State<ControlPlaneState>, Extension(user): Extension<AuthenticatedUser>, Path(id): Path<String>) -> impl IntoResponse {
    if !member(&state, &id, &user) { return denied(); }
    let Some(runtime) = &state.aer_kep_q else {
        return Json(json!({ "organization_id": id, "status": "unavailable", "runtime_attachment": "not_configured", "security_model": "quarantine_reissue", "cipher_suite": "ML-KEM-1024", "epoch_visibility": "runtime_only", "pending_messages": null, "exposure": {"status": "runtime_only", "quarantine": "enabled"}, "note": "AER-KEP-Q requires the control-plane deployment crypto identity and vault boundary." }));
    };
    let Ok(runtime) = runtime.lock() else {
        return Json(json!({ "organization_id": id, "status": "degraded", "runtime_attachment": "attached", "error": "runtime_lock_unavailable" }));
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
    }))
}
