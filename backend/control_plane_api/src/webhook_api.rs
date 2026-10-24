use crate::{is_member, key, ControlPlaneState};
use auth_service::AuthenticatedUser;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Extension, Json,
};
use hmac::{Hmac, Mac};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::Sha256;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

type HmacSha256 = Hmac<Sha256>;

const WEBHOOK_PREFIX: &[u8] = b"org_webhook:";
const WEBHOOK_LOG_PREFIX: &[u8] = b"org_webhook_log:";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookEndpoint {
    pub id: String,
    pub organization_id: String,
    pub url: String,
    pub description: String,
    pub secret: String,
    pub events: Vec<String>,
    pub status: String,
    pub created_at_ms: u64,
    pub last_delivery_ms: Option<u64>,
    pub success_rate: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookDeliveryLog {
    pub id: String,
    pub organization_id: String,
    pub webhook_id: String,
    pub event: String,
    pub status_code: u16,
    pub latency_ms: u64,
    pub timestamp_ms: u64,
    pub payload_summary: String,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateWebhookRequest {
    pub url: String,
    pub description: Option<String>,
    pub events: Option<Vec<String>>,
    pub secret: Option<String>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or_default()
}

fn json_error(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({ "error": message }))).into_response()
}

fn generate_random_secret() -> String {
    let mut bytes = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut bytes);
    format!("whsec_{}", hex::encode(bytes))
}

pub async fn list_webhooks(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(org_id): Path<String>,
) -> impl IntoResponse {
    if !is_member(&state.db, &org_id, &user.username).unwrap_or(false)
        && user.role != auth_service::authorization::Role::Admin
    {
        return json_error(StatusCode::FORBIDDEN, "Organization access denied.");
    }
    let prefix = format!("{}{}:", String::from_utf8_lossy(WEBHOOK_PREFIX), org_id);
    let mut webhooks = Vec::new();
    for (_, val) in state.db.scan_prefix(prefix.as_bytes()).flatten() {
        if let Ok(wh) = serde_json::from_slice::<WebhookEndpoint>(&val) {
            webhooks.push(wh);
        }
    }
    Json(json!({ "organization_id": org_id, "webhooks": webhooks })).into_response()
}

pub async fn create_webhook(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(org_id): Path<String>,
    Json(req): Json<CreateWebhookRequest>,
) -> impl IntoResponse {
    if !is_member(&state.db, &org_id, &user.username).unwrap_or(false)
        && user.role != auth_service::authorization::Role::Admin
    {
        return json_error(StatusCode::FORBIDDEN, "Organization access denied.");
    }
    let url = req.url.trim().to_string();
    if url.is_empty() || (!url.starts_with("https://") && !url.starts_with("http://localhost")) {
        return json_error(
            StatusCode::BAD_REQUEST,
            "Webhook URL must be a valid HTTPS endpoint.",
        );
    }
    let id = format!("wh_{}", uuid::Uuid::new_v4().simple());
    let secret = req
        .secret
        .filter(|s| s.trim().len() >= 16)
        .unwrap_or_else(generate_random_secret);
    let endpoint = WebhookEndpoint {
        id: id.clone(),
        organization_id: org_id.clone(),
        url,
        description: req.description.unwrap_or_default(),
        secret,
        events: req
            .events
            .unwrap_or_else(|| vec!["transaction.sealed".into(), "receipt.verified".into()]),
        status: "ACTIVE".into(),
        created_at_ms: now_ms(),
        last_delivery_ms: None,
        success_rate: 100.0,
    };

    let key_bytes = key(WEBHOOK_PREFIX, &format!("{}:{}", org_id, id));
    if let Err(e) = state
        .db
        .insert(key_bytes, serde_json::to_vec(&endpoint).unwrap())
    {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("Storage failure: {e}"),
        );
    }
    let _ = state.db.flush();
    (StatusCode::CREATED, Json(endpoint)).into_response()
}

pub async fn delete_webhook(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path((org_id, webhook_id)): Path<(String, String)>,
) -> impl IntoResponse {
    if !is_member(&state.db, &org_id, &user.username).unwrap_or(false)
        && user.role != auth_service::authorization::Role::Admin
    {
        return json_error(StatusCode::FORBIDDEN, "Organization access denied.");
    }
    let key_bytes = key(WEBHOOK_PREFIX, &format!("{}:{}", org_id, webhook_id));
    let removed = state.db.remove(key_bytes).ok().flatten().is_some();
    if !removed {
        return json_error(StatusCode::NOT_FOUND, "Webhook endpoint not found.");
    }
    let _ = state.db.flush();
    StatusCode::NO_CONTENT.into_response()
}

pub async fn test_webhook_delivery(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path((org_id, webhook_id)): Path<(String, String)>,
) -> impl IntoResponse {
    if !is_member(&state.db, &org_id, &user.username).unwrap_or(false)
        && user.role != auth_service::authorization::Role::Admin
    {
        return json_error(StatusCode::FORBIDDEN, "Organization access denied.");
    }
    let key_bytes = key(WEBHOOK_PREFIX, &format!("{}:{}", org_id, webhook_id));
    let Some(val) = state.db.get(key_bytes).ok().flatten() else {
        return json_error(StatusCode::NOT_FOUND, "Webhook endpoint not found.");
    };
    let mut endpoint: WebhookEndpoint = match serde_json::from_slice(&val) {
        Ok(v) => v,
        Err(_) => {
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Corrupted webhook record.",
            )
        }
    };

    let now = now_ms();
    let timestamp_sec = now / 1000;
    let payload = json!({
        "event": "webhook.test",
        "organization_id": org_id,
        "webhook_id": webhook_id,
        "timestamp": timestamp_sec,
        "message": "Vardhan Q-Core live webhook ping verification",
        "test": true
    });
    let payload_bytes = serde_json::to_vec(&payload).unwrap();

    // Compute genuine HMAC-SHA256 signature
    let signature = match HmacSha256::new_from_slice(endpoint.secret.as_bytes()) {
        Ok(mut mac) => {
            mac.update(format!("t={}:", timestamp_sec).as_bytes());
            mac.update(&payload_bytes);
            format!(
                "t={},v1={}",
                timestamp_sec,
                hex::encode(mac.finalize().into_bytes())
            )
        }
        Err(_) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, "Failed to compute HMAC."),
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap_or_default();

    let start = Instant::now();
    let delivery_result = client
        .post(&endpoint.url)
        .header("Content-Type", "application/json")
        .header("x-vardhan-signature", signature)
        .header("x-vardhan-event", "webhook.test")
        .body(payload_bytes)
        .send()
        .await;
    let latency_ms = start.elapsed().as_millis() as u64;

    let (status_code, success, error) = match delivery_result {
        Ok(res) => (res.status().as_u16(), res.status().is_success(), None),
        Err(e) => (504, false, Some(e.to_string())),
    };

    endpoint.last_delivery_ms = Some(now);
    if !success {
        endpoint.success_rate = (endpoint.success_rate * 0.9).max(0.0);
    } else {
        endpoint.success_rate = (endpoint.success_rate * 0.9 + 10.0).min(100.0);
    }
    let _ = state.db.insert(
        key(WEBHOOK_PREFIX, &format!("{}:{}", org_id, webhook_id)),
        serde_json::to_vec(&endpoint).unwrap(),
    );

    let log_id = format!("del_{}", uuid::Uuid::new_v4().simple());
    let log = WebhookDeliveryLog {
        id: log_id.clone(),
        organization_id: org_id.clone(),
        webhook_id: webhook_id.clone(),
        event: "webhook.test".into(),
        status_code,
        latency_ms,
        timestamp_ms: now,
        payload_summary: "Test ping verification".into(),
        success,
        error: error.clone(),
    };
    let log_key = key(WEBHOOK_LOG_PREFIX, &format!("{}:{}", org_id, log_id));
    let _ = state.db.insert(log_key, serde_json::to_vec(&log).unwrap());
    let _ = state.db.flush();

    (
        StatusCode::OK,
        Json(json!({
            "delivered": true,
            "status_code": status_code,
            "latency_ms": latency_ms,
            "success": success,
            "error": error,
            "timestamp_ms": now
        })),
    )
        .into_response()
}

pub async fn list_webhook_deliveries(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(org_id): Path<String>,
) -> impl IntoResponse {
    if !is_member(&state.db, &org_id, &user.username).unwrap_or(false)
        && user.role != auth_service::authorization::Role::Admin
    {
        return json_error(StatusCode::FORBIDDEN, "Organization access denied.");
    }
    let prefix = format!("{}{}:", String::from_utf8_lossy(WEBHOOK_LOG_PREFIX), org_id);
    let mut logs = Vec::new();
    for (_, val) in state.db.scan_prefix(prefix.as_bytes()).flatten() {
        if let Ok(l) = serde_json::from_slice::<WebhookDeliveryLog>(&val) {
            logs.push(l);
        }
    }
    logs.sort_by_key(|a| std::cmp::Reverse(a.timestamp_ms));
    logs.truncate(50);
    Json(json!({ "organization_id": org_id, "deliveries": logs })).into_response()
}
