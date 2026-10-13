use axum::{extract::{State, Path}, http::StatusCode, response::IntoResponse, Json};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use crate::ControlPlaneState;
use std::sync::Arc;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum MigrationLifecycleState {
    DISCOVERED,
    ASSESSED,
    BLUEPRINT_PROPOSED,
    AUTHORIZED,
    TESTED,
    EXECUTED,
    INDEPENDENTLY_VERIFIED,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct QuantumMigrationPassport {
    pub passport_id: String,
    pub migration_id: String,
    pub asset_id: String,
    pub blueprint_hash: String,
    pub blueprint_version: String,
    pub authorization_receipt_id: Option<String>,
    pub execution_evidence: Option<ExecutionEvidence>,
    pub verification_status: Option<VerificationStatus>,
    pub lifecycle_state: MigrationLifecycleState,
    pub timestamp_chain: Vec<PassportEvent>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExecutionEvidence {
    pub pre_migration_hash: String,
    pub post_migration_hash: String,
    pub execution_log_ref: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VerificationStatus {
    pub verified: bool,
    pub verifier_id: String,
    pub verification_receipt_id: Option<String>,
    pub failure_reasons: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PassportEvent {
    pub timestamp: u64,
    pub event: String,
    pub actor: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdatePassportRequest {
    pub state: MigrationLifecycleState,
    pub evidence: Value,
}

pub async fn get_passport(
    State(state): State<ControlPlaneState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let key = format!("passport:{}", id);
    match crate::load_json::<QuantumMigrationPassport>(&state.db, key.as_bytes()) {
        Ok(Some(passport)) => (StatusCode::OK, Json(passport)).into_response(),
        Ok(None) => (StatusCode::NOT_FOUND, Json(json!({"error": "Passport not found"}))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e}))).into_response(),
    }
}

pub async fn create_passport(
    State(state): State<ControlPlaneState>,
    Path(_id): Path<String>,
    Json(payload): Json<QuantumMigrationPassport>,
) -> impl IntoResponse {
    let key = format!("passport:{}", payload.passport_id);
    if let Err(e) = crate::save_json(&state.db, key.as_bytes(), &payload) {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e}))).into_response();
    }
    (StatusCode::CREATED, Json(payload)).into_response()
}

pub async fn update_passport_state(
    State(state): State<ControlPlaneState>,
    Path((org_id, id)): Path<(String, String)>,
    Json(req): Json<UpdatePassportRequest>,
) -> impl IntoResponse {
    let key = format!("passport:{}", id);
    let mut passport = match crate::load_json::<QuantumMigrationPassport>(&state.db, key.as_bytes()) {
        Ok(Some(p)) => p,
        Ok(None) => return (StatusCode::NOT_FOUND, Json(json!({"error": "Passport not found"}))).into_response(),
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e}))).into_response(),
    };

    // Honest Lifecycle Guard: Reject invalid transitions
    let current_state = &passport.lifecycle_state;
    let next_state = &req.state;

    let valid = match (current_state, next_state) {
        (MigrationLifecycleState::DISCOVERED, MigrationLifecycleState::ASSESSED) => true,
        (MigrationLifecycleState::ASSESSED, MigrationLifecycleState::BLUEPRINT_PROPOSED) => true,
        (MigrationLifecycleState::BLUEPRINT_PROPOSED, MigrationLifecycleState::AUTHORIZED) => true,
        (MigrationLifecycleState::AUTHORIZED, MigrationLifecycleState::TESTED) => true,
        (MigrationLifecycleState::TESTED, MigrationLifecycleState::EXECUTED) => true,
        (MigrationLifecycleState::EXECUTED, MigrationLifecycleState::INDEPENDENTLY_VERIFIED) => true,
        _ => false,
    };

    if !valid {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": format!("Invalid lifecycle transition from {:?} to {:?}", current_state, next_state)}))).into_response();
    }

    // Independent Verification Guard:
    // If transitioning to INDEPENDENTLY_VERIFIED, we MUST cryptographically verify the receipt.
    if let MigrationLifecycleState::INDEPENDENTLY_VERIFIED = next_state {
        let receipt_id = match &passport.authorization_receipt_id {
            Some(id) => id,
            None => return (StatusCode::BAD_REQUEST, Json(json!({"error": "Cannot verify without an authorization receipt"}))).into_response(),
        };

        // 1. Retrieve the canonical receipt record from the store.
        // We use the receipt_id as the key in the control plane DB.
        let receipt_key = format!("receipt:{}", receipt_id);
        let receipt = match crate::load_json::<vardhan_verifier::VerifiableReceipt>(&state.db, receipt_key.as_bytes()) {
            Ok(Some(r)) => r,
            Ok(None) => return (StatusCode::BAD_REQUEST, Json(json!({"error": format!("Receipt record {} not found in trusted store", receipt_id)}))).into_response(),
            Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": format!("Registry error: {}", e)}))).into_response(),
        };

        // 2. Binding Check: Receipt subject must match Passport asset
        if receipt.subject_id != passport.asset_id {
            return (StatusCode::BAD_REQUEST, Json(json!({"error": format!("Receipt binding mismatch: receipt subject {} does not match passport asset {}", receipt.subject_id, passport.asset_id)}))).into_response();
        }

        // 3. Trust-Key Resolution: Get authoritative public keys for the issuer.
        // The receipt identifies its issuer via its tenant_id and the keys used.
        // We assume the registry maps organization_id to the issuer keys.
        let issuer_keys = match state.db.get(format!("qcore:issuer-key:{}", receipt.tenant_id).as_bytes()) {
             // Note: This is a simplified resolution; a real registry would use the service_id.
             // For now, we retrieve the latest active key for the tenant.
             Ok(Some(bytes)) => serde_json::from_slice::<crate::receipt_key_registry::ReceiptIssuerKey>(&bytes).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": format!("Key corruption: {}", e)})))),
             _ => Err((StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Trusted issuer keys not found in registry"})))),
        };

        let keys = match issuer_keys {
            Ok(k) => k,
            Err(e) => return e.into_response(),
        };

        // 4. Cryptographic Verification
        let verifier = vardhan_verifier::VardhanVerifier::with_defaults();
        let result = verifier.verify(
            &receipt,
            Some(&keys.ed25519_public_key),
            Some(&keys.ml_dsa_87_public_key),
        );

        if !result.is_valid() {
            let reasons: Vec<String> = result.failures.iter().map(|f| format!("{}: {}", f.check, f.reason)).collect();
            return (StatusCode::BAD_REQUEST, Json(json!({
                "error": "Cryptographic verification failed",
                "details": reasons
            }))).into_response();
        }
    }

    passport.lifecycle_state = req.state;

    // Update evidence if provided
    if let Some(receipt_id) = req.evidence.as_str() {
        passport.authorization_receipt_id = Some(receipt_id.to_string());
    }

    if let Some(exec) = req.evidence.as_object() {
        if let Some(evidence) = serde_json::from_value::<ExecutionEvidence>(serde_json::Value::Object(exec.clone())).ok() {
            passport.execution_evidence = Some(evidence);
        }
    }

    let timestamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64;
    passport.timestamp_chain.push(PassportEvent {
        timestamp,
        event: format!("Transition to {:?}", passport.lifecycle_state),
        actor: "system".to_string(),
    });

    if let Err(e) = crate::save_json(&state.db, key.as_bytes(), &passport) {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e}))).into_response();
    }

    (StatusCode::OK, Json(passport)).into_response()
}
