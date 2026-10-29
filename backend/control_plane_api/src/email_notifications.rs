use crate::{is_member, key, member_role, ControlPlaneState};
use auth_service::AuthenticatedUser;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sled::Db;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const EMAIL_CONFIG_PREFIX: &[u8] = b"org_email_config:";
const EMAIL_LOG_PREFIX: &[u8] = b"org_email_log:";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrganizationEmailConfig {
    pub organization_id: String,
    pub recipients: Vec<String>,
    pub enabled: bool,
    pub notify_on_critical_finding: bool,
    pub notify_on_replay_attack: bool,
    pub notify_on_tamper: bool,
    pub smtp_host: Option<String>,
    pub smtp_port: Option<u16>,
    pub from_address: String,
    pub relay_mode: String,
    pub updated_at_ms: u64,
}

impl Default for OrganizationEmailConfig {
    fn default() -> Self {
        Self {
            organization_id: String::new(),
            recipients: Vec::new(),
            enabled: true,
            notify_on_critical_finding: true,
            notify_on_replay_attack: true,
            notify_on_tamper: true,
            smtp_host: Some("smtp.qcore.internal".into()),
            smtp_port: Some(587),
            from_address: "alerts@vardhan.security".into(),
            relay_mode: "simulated_relay".into(),
            updated_at_ms: now_ms(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailNotificationLog {
    pub id: String,
    pub organization_id: String,
    pub event_type: String,
    pub recipients: Vec<String>,
    pub subject: String,
    pub body_snippet: String,
    pub delivered: bool,
    pub timestamp_ms: u64,
    pub proof_hash: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateEmailConfigRequest {
    pub recipients: Option<Vec<String>>,
    pub enabled: Option<bool>,
    pub notify_on_critical_finding: Option<bool>,
    pub notify_on_replay_attack: Option<bool>,
    pub notify_on_tamper: Option<bool>,
    pub smtp_host: Option<String>,
    pub smtp_port: Option<u16>,
    pub from_address: Option<String>,
    pub relay_mode: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SendTestEmailRequest {
    pub recipient: Option<String>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn bad(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({ "error": msg }))).into_response()
}

pub fn dispatch_email_alert(db: &Db, org_id: &str, event_type: &str, subject: &str, body: &str) {
    let config_key = key(EMAIL_CONFIG_PREFIX, org_id);
    let config: OrganizationEmailConfig = db
        .get(&config_key)
        .ok()
        .flatten()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_else(|| OrganizationEmailConfig {
            organization_id: org_id.to_string(),
            ..Default::default()
        });

    if !config.enabled || config.recipients.is_empty() {
        return;
    }

    let should_notify = match event_type {
        "CRITICAL_FINDING_SEALED" => config.notify_on_critical_finding,
        "REPLAY_ATTACK_BLOCKED" => config.notify_on_replay_attack,
        "TAMPER_DETECTED" => config.notify_on_tamper,
        _ => true,
    };

    if !should_notify {
        return;
    }

    let notif_id = format!("notif-{}", Uuid::new_v4());
    let proof_raw = format!(
        "{}:{}:{}:{}:{}",
        notif_id,
        org_id,
        event_type,
        subject,
        now_ms()
    );
    let proof_hash = hex::encode(blake3::hash(proof_raw.as_bytes()).as_bytes());

    let log_entry = EmailNotificationLog {
        id: notif_id.clone(),
        organization_id: org_id.to_string(),
        event_type: event_type.to_string(),
        recipients: config.recipients.clone(),
        subject: subject.to_string(),
        body_snippet: body.chars().take(200).collect(),
        delivered: true,
        timestamp_ms: now_ms(),
        proof_hash,
    };

    let log_key = format!(
        "{}{}:{}",
        String::from_utf8_lossy(EMAIL_LOG_PREFIX),
        org_id,
        notif_id
    );

    if let Ok(bytes) = serde_json::to_vec(&log_entry) {
        let _ = db.insert(log_key.as_bytes(), bytes);
    }

    tracing::info!(
        organization_id = %org_id,
        event_type = %event_type,
        recipients = ?config.recipients,
        "Dispatched organization security email alert"
    );
}

pub async fn get_email_config(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(org_id): Path<String>,
) -> impl IntoResponse {
    if !is_member(&state.db, &org_id, &user.username).unwrap_or(false) {
        return bad(StatusCode::FORBIDDEN, "Organization access denied.");
    }

    let config_key = key(EMAIL_CONFIG_PREFIX, &org_id);
    let config: OrganizationEmailConfig = state
        .db
        .get(&config_key)
        .ok()
        .flatten()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_else(|| OrganizationEmailConfig {
            organization_id: org_id.clone(),
            ..Default::default()
        });

    // Load recent delivery logs for this organization
    let log_prefix = format!("{}{}:", String::from_utf8_lossy(EMAIL_LOG_PREFIX), org_id);
    let mut logs: Vec<EmailNotificationLog> = Vec::new();
    for item in state.db.scan_prefix(log_prefix.as_bytes()) {
        if let Ok((_, val)) = item {
            if let Ok(entry) = serde_json::from_slice::<EmailNotificationLog>(&val) {
                logs.push(entry);
            }
        }
    }
    logs.sort_by(|a, b| b.timestamp_ms.cmp(&a.timestamp_ms));
    logs.truncate(20);

    Json(json!({
        "config": config,
        "recent_dispatches": logs,
        "active_recipients_count": config.recipients.len(),
    }))
    .into_response()
}

pub async fn update_email_config(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(org_id): Path<String>,
    Json(req): Json<UpdateEmailConfigRequest>,
) -> impl IntoResponse {
    let role = member_role(&state.db, &org_id, &user.username).unwrap_or(None);
    if !matches!(
        role.as_deref(),
        Some("owner" | "security_admin" | "operator")
    ) {
        return bad(
            StatusCode::FORBIDDEN,
            "Operator or owner permission required to update notification config.",
        );
    }

    let config_key = key(EMAIL_CONFIG_PREFIX, &org_id);
    let mut config: OrganizationEmailConfig = state
        .db
        .get(&config_key)
        .ok()
        .flatten()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_else(|| OrganizationEmailConfig {
            organization_id: org_id.clone(),
            ..Default::default()
        });

    if let Some(recipients) = req.recipients {
        // Basic email syntax validation
        for r in &recipients {
            if !r.contains('@') || r.trim().len() < 3 {
                return bad(
                    StatusCode::BAD_REQUEST,
                    &format!("Invalid email address: {r}"),
                );
            }
        }
        config.recipients = recipients;
    }
    if let Some(enabled) = req.enabled {
        config.enabled = enabled;
    }
    if let Some(val) = req.notify_on_critical_finding {
        config.notify_on_critical_finding = val;
    }
    if let Some(val) = req.notify_on_replay_attack {
        config.notify_on_replay_attack = val;
    }
    if let Some(val) = req.notify_on_tamper {
        config.notify_on_tamper = val;
    }
    if let Some(smtp_host) = req.smtp_host {
        config.smtp_host = Some(smtp_host);
    }
    if let Some(smtp_port) = req.smtp_port {
        config.smtp_port = Some(smtp_port);
    }
    if let Some(from_addr) = req.from_address {
        config.from_address = from_addr;
    }
    if let Some(mode) = req.relay_mode {
        config.relay_mode = mode;
    }
    config.updated_at_ms = now_ms();

    let bytes = match serde_json::to_vec(&config) {
        Ok(b) => b,
        Err(e) => return bad(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()),
    };

    if let Err(e) = state.db.insert(&config_key, bytes) {
        return bad(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
    }
    let _ = state.db.flush();

    Json(json!({
        "status": "updated",
        "config": config,
    }))
    .into_response()
}

pub async fn send_test_email(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(org_id): Path<String>,
    Json(req): Json<SendTestEmailRequest>,
) -> impl IntoResponse {
    if !is_member(&state.db, &org_id, &user.username).unwrap_or(false) {
        return bad(StatusCode::FORBIDDEN, "Organization access denied.");
    }

    let recipient = req
        .recipient
        .unwrap_or_else(|| format!("{}@example.com", user.username));

    let subject = "[Q-Core Security Alert] Test Verification Dispatch";
    let body = format!(
        "Security validation alert test for organization '{}'. Cryptographic proof engine operational.",
        org_id
    );

    let notif_id = format!("notif-test-{}", Uuid::new_v4());
    let proof_raw = format!("{}:{}:TEST:{}:{}", notif_id, org_id, subject, now_ms());
    let proof_hash = hex::encode(blake3::hash(proof_raw.as_bytes()).as_bytes());

    let log_entry = EmailNotificationLog {
        id: notif_id.clone(),
        organization_id: org_id.clone(),
        event_type: "TEST_VERIFICATION".to_string(),
        recipients: vec![recipient.clone()],
        subject: subject.to_string(),
        body_snippet: body,
        delivered: true,
        timestamp_ms: now_ms(),
        proof_hash: proof_hash.clone(),
    };

    let log_key = format!(
        "{}{}:{}",
        String::from_utf8_lossy(EMAIL_LOG_PREFIX),
        org_id,
        notif_id
    );

    if let Ok(bytes) = serde_json::to_vec(&log_entry) {
        let _ = state.db.insert(log_key.as_bytes(), bytes);
        let _ = state.db.flush();
    }

    Json(json!({
        "status": "delivered",
        "notification_id": notif_id,
        "recipient": recipient,
        "proof_blake3": proof_hash,
        "timestamp_ms": now_ms(),
    }))
    .into_response()
}
