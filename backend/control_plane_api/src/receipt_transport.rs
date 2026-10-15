use crate::{durable_event_queue::DurableEventQueue, ControlPlaneState};
use crate::qcore_telemetry::{QCoreReceiptTelemetry, QCoreTransactionTelemetry, ReceiptVerificationState, QCoreTelemetryStore};
use crate::receipt_key_registry::ReceiptKeyRegistry;
use crate::receipt_verification::verify_receipt;
use axum::{body::Bytes, extract::{Path, State}, http::{HeaderMap, StatusCode}, response::IntoResponse, Json};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use serde_json::json;
use std::time::{SystemTime, UNIX_EPOCH};

type HmacSha256 = Hmac<Sha256>;
const MAX_SKEW_MS: u64 = 300_000;
const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;
const TRANSPORT_VERSION: &str = "2";
const PROTOCOL_DOMAIN: &[u8] = b"VARDHAN-QCORE-RECEIPT-TRANSPORT-V2";
const REPLAY_PREFIX: &[u8] = b"qcore:transport-replay:";

pub async fn ingest_receipt(
    State(state): State<ControlPlaneState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    if body.len() > MAX_BODY_BYTES {
        return (StatusCode::PAYLOAD_TOO_LARGE, Json(json!({"error":"receipt body exceeds 2 MiB limit"}))).into_response();
    }
    let Some(secret) = std::env::var("VARDHAN_QCORE_SERVICE_SECRET").ok().filter(|v| !v.is_empty()) else {
        return (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error":"Q-Core service authentication is not configured"}))).into_response();
    };
    let Some(version) = header_text(&headers, "x-vardhan-transport-version") else { return bad("missing transport version"); };
    if version != TRANSPORT_VERSION { return bad("unsupported transport version"); }
    let Some(service_id) = header_text(&headers, "x-vardhan-service-id") else { return bad("missing service id"); };
    let Some(timestamp) = header_text(&headers, "x-vardhan-timestamp").and_then(|v| v.parse::<u64>().ok()) else { return bad("invalid service timestamp"); };
    let Some(nonce) = header_text(&headers, "x-vardhan-nonce") else { return bad("missing service nonce"); };
    let Some(signature) = header_text(&headers, "x-vardhan-signature") else { return bad("missing service signature"); };
    if !fresh(timestamp) { return bad("service request timestamp outside replay window"); }

    let canonical = canonical_request(&id, &service_id, timestamp, &nonce, &body);
    let Ok(expected) = hex::decode(signature) else { return bad("invalid service signature encoding"); };
    let Ok(mut mac) = HmacSha256::new_from_slice(secret.as_bytes()) else { return bad("service authentication unavailable"); };
    mac.update(&canonical);
    if mac.verify_slice(&expected).is_err() { return (StatusCode::UNAUTHORIZED, Json(json!({"error":"service signature verification failed"}))).into_response(); }

    let replay_key = replay_key(&id, &service_id, &nonce);
    match state.db.compare_and_swap(&replay_key, None as Option<&[u8]>, Some(b"used")) {
        Ok(Ok(_)) => {}
        Ok(Err(_)) => return (StatusCode::CONFLICT, Json(json!({"error":"replayed service request"}))).into_response(),
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error":"replay store unavailable"}))).into_response(),
    }

    let registry = ReceiptKeyRegistry::new(state.db.clone());
    let Ok(issuer) = registry.resolve_active(&id, &service_id) else {
        return (StatusCode::UNAUTHORIZED, Json(json!({"error":"issuer key is not registered and active for this organization"}))).into_response();
    };
    let Ok(receipt) = serde_json::from_slice::<vardhan_verifier::VerifiableReceipt>(&body) else { return bad("invalid receipt JSON"); };
    if receipt.tenant_id != id { return bad("receipt tenant does not match organization"); }
    let verification = match verify_receipt(&body, &id, &issuer) {
        Ok(result) if result.is_valid() => result,
        Ok(result) => return (StatusCode::UNPROCESSABLE_ENTITY, Json(json!({"status":"rejected","receipt_id":receipt.receipt_id,"verification":result}))).into_response(),
        Err(error) => return (StatusCode::UNPROCESSABLE_ENTITY, Json(json!({"status":"rejected","error":error}))).into_response(),
    };

    let store = QCoreTelemetryStore::new(state.db.clone());
    let now = now_ms();
    let transaction = QCoreTransactionTelemetry {
        organization_id: id.clone(), tenant_id: receipt.tenant_id.clone(), transaction_id: receipt.transaction_id.clone(),
        state: "RECEIPTED".into(), kind: "Q_CORE_RECEIPT".into(), subject_id: receipt.subject_id.clone(),
        proposed_action: receipt.proposed_action.clone(), policy_id: receipt.policy_id.clone(), policy_version: receipt.policy_version.clone(),
        correlation_id: receipt.correlation_id.clone(), receipt_id: Some(receipt.receipt_id.clone()), outcome_code: Some(receipt.outcome_code.clone()),
        created_at_ms: receipt.timestamp_ms, updated_at_ms: now,
    };
    let telemetry = QCoreReceiptTelemetry {
        organization_id: id.clone(), receipt_id: receipt.receipt_id.clone(), transaction_id: receipt.transaction_id.clone(), tenant_id: receipt.tenant_id.clone(),
        status: "SEALED".into(), decision: receipt.decision.clone(), outcome_code: receipt.outcome_code.clone(), policy_id: receipt.policy_id.clone(),
        policy_version: receipt.policy_version.clone(), ledger_commit_index: receipt.ledger_commit_index, timestamp_ms: receipt.timestamp_ms,
        payload_hash: receipt.payload_hash.clone(), issuer_key_fingerprint: receipt.issuer_key_fingerprint.clone(), verification: ReceiptVerificationState::Verified,
    };
    tracing::debug!(transaction_id = %transaction.transaction_id, receipt_id = %receipt.receipt_id, "recording verified Q-Core receipt telemetry");
    if let Err(error) = store.record_transaction(&transaction).and_then(|_| store.record_receipt(&telemetry)) {
        return (StatusCode::CONFLICT, Json(json!({"status":"rejected","error":error.to_string()}))).into_response();
    }
    let queue = DurableEventQueue::new(state.db.clone());
    let event_payload = serde_json::to_vec(&serde_json::json!({
        "organization_id": id,
        "receipt_id": receipt.receipt_id,
        "transaction_id": receipt.transaction_id,
        "verification": verification,
    })).map_err(|e| e.to_string());
    let event_payload = match event_payload {
        Ok(payload) => payload,
        Err(error) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"status":"accepted","telemetry":"durably_recorded","event_queue":"serialization_failed","error":error}))).into_response(),
    };
    if let Err(error) = queue.enqueue(&id, "qcore.receipt.verified", event_payload, now) {
        return (StatusCode::SERVICE_UNAVAILABLE, Json(json!({
            "status":"accepted",
            "receipt_id":receipt.receipt_id,
            "transaction_id":receipt.transaction_id,
            "verification":verification,
            "telemetry":"durably_recorded",
            "event_queue":"unavailable",
            "error":error.to_string()
        }))).into_response();
    }
    Json(json!({"status":"accepted","receipt_id":receipt.receipt_id,"transaction_id":receipt.transaction_id,"verification":verification,"telemetry":"durably_recorded","event_queue":"durably_queued"})).into_response()
}

fn canonical_request(organization_id: &str, service_id: &str, timestamp: u64, nonce: &str, body: &[u8]) -> Vec<u8> {
    let path = format!("/api/v1/organizations/{organization_id}/qcore/receipts");
    let timestamp = timestamp.to_string();
    let fields: [&[u8]; 9] = [
        PROTOCOL_DOMAIN,
        TRANSPORT_VERSION.as_bytes(),
        b"POST",
        path.as_bytes(),
        organization_id.as_bytes(),
        service_id.as_bytes(),
        timestamp.as_bytes(),
        nonce.as_bytes(),
        body,
    ];
    let mut out = Vec::with_capacity(fields.iter().map(|field| 8 + field.len()).sum());
    for field in fields {
        out.extend_from_slice(&(field.len() as u64).to_be_bytes());
        out.extend_from_slice(field);
    }
    out
}

fn header_text(headers: &HeaderMap, name: &str) -> Option<String> { headers.get(name).and_then(|v| v.to_str().ok()).map(str::to_owned) }
fn fresh(timestamp: u64) -> bool { let now = now_ms(); timestamp <= now.saturating_add(MAX_SKEW_MS) && now.saturating_sub(timestamp) <= MAX_SKEW_MS }
fn replay_key(org: &str, service: &str, nonce: &str) -> Vec<u8> { format!("{}{}:{}:{}", String::from_utf8_lossy(REPLAY_PREFIX), org, service, nonce).into_bytes() }
fn now_ms() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or_default() }
fn bad(message: &str) -> axum::response::Response { (StatusCode::BAD_REQUEST, Json(json!({"error":message}))).into_response() }

