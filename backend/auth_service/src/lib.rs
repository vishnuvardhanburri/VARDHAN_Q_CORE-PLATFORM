//! # auth_service
//!
//! Production authentication, session management, RBAC authorization,
//! and persistent administrative operations for Vardhan Quantum.

pub mod api_key;
pub mod audit;
pub mod authorization;
pub mod credentials;
pub mod middleware;
pub mod profile;
pub mod rate_limit;
pub mod secrets;
pub mod session;
pub mod settings;
pub mod store;

use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::{header, StatusCode},
    response::IntoResponse,
    routing::{delete, get, post},
    Json, Router,
};
use serde::Deserialize;

use crate::{rate_limit::RateLimiter, store::CredentialStore};

pub use api_key::{ApiKeyView, CreateApiKeyRequest, CreateApiKeyResponse};
pub use audit::emit_admin_audit;
pub use authorization::{AuthenticatedUser, Permission, Role};
pub use middleware::require_session;
pub use profile::{AdminProfile, ChangePasswordRequest, UpdateProfileRequest};
pub use session::{SessionInfo, SessionStore, SessionToken, SessionView};
pub use settings::{SettingsConfig, UpdateSettingsRequest};

#[derive(Clone)]
pub struct AuthState {
    pub credentials: Arc<CredentialStore>,
    pub sessions: Arc<SessionStore>,
    pub rate_limiter: Arc<RateLimiter>,
    pub ledger: Option<Arc<audit_ledger::LedgerWriter>>,
    pub identity: Option<Arc<core_crypto::QuantumNodeIdentity>>,
    pub node_id: Option<String>,
    pub admin_token: Option<String>,
}

#[derive(Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Deserialize, Default)]
pub struct FlushSessionsRequest {
    #[serde(default)]
    pub confirm: bool,
}

pub fn auth_router(state: AuthState) -> Router {
    Router::new()
        .route("/api/v1/auth/login", post(login_handler))
        .route("/api/v1/auth/logout", post(logout_handler))
        .route("/api/v1/auth/session", get(session_info_handler))
        .route("/api/v1/admin/profile", get(get_profile_handler).put(update_profile_handler))
        .route("/api/v1/admin/password", post(change_password_handler))
        .route("/api/v1/settings", get(get_settings_handler).put(update_settings_handler))
        .route("/api/v1/sessions", get(list_sessions_handler))
        .route("/api/v1/sessions/{session_id}/revoke", post(revoke_session_handler))
        .route("/api/v1/sessions/flush", post(flush_sessions_handler))
        .route("/api/v1/admin/api-keys", get(list_api_keys_handler).post(create_api_key_handler))
        .route("/api/v1/admin/api-keys/{id}", delete(revoke_api_key_handler))
        .with_state(state)
}

pub async fn login_handler(
    State(state): State<AuthState>,
    headers: axum::http::HeaderMap,
    Json(req): Json<LoginRequest>,
) -> impl IntoResponse {
    let ip = resolve_ip(&headers);
    let req_id = extract_request_id(&headers);
    let node_id = state.node_id.as_deref().unwrap_or("local-node");

    if state.rate_limiter.is_blocked(ip) {
        emit_admin_audit(state.ledger.as_ref(), state.identity.as_ref(), node_id, "LoginFailed", "unknown", "rate_limited", req_id.as_deref(), serde_json::json!({ "ip": ip.to_string(), "reason": "rate_limit_exceeded" }));
        return (StatusCode::TOO_MANY_REQUESTS, Json(serde_json::json!({ "error": "Too many attempts. Try again later." })));
    }

    let ok = state.credentials.verify(&req.username, &req.password).await;
    if ok {
        state.rate_limiter.reset(ip);
        let token = state.sessions.create_with_node(&req.username, ip, node_id).await;
        emit_admin_audit(state.ledger.as_ref(), state.identity.as_ref(), node_id, "LoginSucceeded", &req.username, "success", req_id.as_deref(), serde_json::json!({ "ip": ip.to_string(), "session_prefix": &token.as_str()[..8] }));
        tracing::info!(username_hash = %audit::blake3_hex(&req.username), ip = %ip, "LoginSucceeded");
        (StatusCode::OK, Json(serde_json::json!({ "token": token.as_str(), "expires_in": 8 * 60 * 60 })))
    } else {
        state.rate_limiter.record_failure(ip);
        emit_admin_audit(state.ledger.as_ref(), state.identity.as_ref(), node_id, "LoginFailed", "unknown", "invalid_credentials", req_id.as_deref(), serde_json::json!({ "ip": ip.to_string() }));
        (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Invalid credentials" })))
    }
}

pub async fn logout_handler(State(state): State<AuthState>, headers: axum::http::HeaderMap) -> impl IntoResponse {
    let token_str = match extract_bearer_from_headers(&headers) {
        Some(t) => t,
        None => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Missing Authorization header" }))),
    };
    let token = SessionToken::from_str(&token_str);
    match state.sessions.remove(&token).await {
        Some(entry) => {
            let node_id = state.node_id.as_deref().unwrap_or("local-node");
            emit_admin_audit(state.ledger.as_ref(), state.identity.as_ref(), node_id, "Logout", &entry.username, "success", extract_request_id(&headers).as_deref(), serde_json::json!({ "ip": resolve_ip(&headers).to_string() }));
            (StatusCode::OK, Json(serde_json::json!({ "status": "logged_out" })))
        }
        None => (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Invalid or expired session" }))),
    }
}

pub async fn session_info_handler(State(state): State<AuthState>, headers: axum::http::HeaderMap) -> impl IntoResponse {
    let token_str = match extract_bearer_from_headers(&headers) {
        Some(t) => t,
        None => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Missing Authorization header" }))),
    };
    let token = SessionToken::from_str(&token_str);
    match state.sessions.get_info(&token).await {
        Some(info) => (StatusCode::OK, Json(serde_json::json!({ "username": info.username, "issued_at_ms": info.issued_at_ms, "expires_in": info.expires_in_secs }))),
        None => (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Invalid or expired session" }))),
    }
}

pub async fn get_profile_handler(State(state): State<AuthState>, headers: axum::http::HeaderMap) -> impl IntoResponse {
    let caller = match extract_authenticated_user(&state, &headers).await { Some(u) => u, None => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Unauthorized" }))) };
    match state.credentials.get_profile(&caller.username) {
        Ok(profile) => (StatusCode::OK, Json(serde_json::to_value(profile).unwrap())),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))),
    }
}

pub async fn update_profile_handler(State(state): State<AuthState>, headers: axum::http::HeaderMap, Json(req): Json<profile::UpdateProfileRequest>) -> impl IntoResponse {
    let caller = match extract_authenticated_user(&state, &headers).await { Some(u) => u, None => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Unauthorized" }))) };
    match state.credentials.update_profile(&caller.username, req.display_name, req.email) {
        Ok(profile) => (StatusCode::OK, Json(serde_json::to_value(profile).unwrap())),
        Err(profile::ProfileError::InvalidProfileData(msg)) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": msg }))),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))),
    }
}

pub async fn change_password_handler(State(state): State<AuthState>, headers: axum::http::HeaderMap, Json(req): Json<profile::ChangePasswordRequest>) -> impl IntoResponse {
    let caller = match extract_authenticated_user(&state, &headers).await { Some(u) => u, None => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Unauthorized" }))) };
    match state.credentials.change_user_password(&caller.username, &req.current_password, &req.new_password, &req.confirm_password) {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({ "status": "password_changed" }))),
        Err(profile::ProfileError::InvalidCurrentPassword) => (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Invalid current password" }))),
        Err(profile::ProfileError::PasswordPolicyViolation(msg)) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": msg }))),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))),
    }
}

pub async fn get_settings_handler(State(state): State<AuthState>, headers: axum::http::HeaderMap) -> impl IntoResponse {
    if extract_authenticated_user(&state, &headers).await.is_none() { return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Unauthorized" }))); }
    let node_id = state.node_id.as_deref().unwrap_or("local-node");
    let fingerprint = state.identity.as_ref().map(|id| hex::encode(core_crypto::QuantumNodeIdentity::hash_ledger_block(&id.dsa_public_key_bytes()))).unwrap_or_else(|| "0".repeat(64));
    match state.credentials.get_settings(node_id, &fingerprint) {
        Ok(settings) => (StatusCode::OK, Json(serde_json::to_value(settings).unwrap())),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))),
    }
}

pub async fn update_settings_handler(State(state): State<AuthState>, headers: axum::http::HeaderMap, Json(req): Json<settings::UpdateSettingsRequest>) -> impl IntoResponse {
    let caller = match extract_authenticated_user(&state, &headers).await { Some(u) => u, None => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Unauthorized" }))) };
    if !caller.can(Permission::UpdateSettings) { return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Forbidden" }))); }
    let node_id = state.node_id.as_deref().unwrap_or("local-node");
    let fingerprint = state.identity.as_ref().map(|id| hex::encode(core_crypto::QuantumNodeIdentity::hash_ledger_block(&id.dsa_public_key_bytes()))).unwrap_or_else(|| "0".repeat(64));
    match state.credentials.update_settings(req, node_id, &fingerprint) {
        Ok(settings) => (StatusCode::OK, Json(serde_json::to_value(settings).unwrap())),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))),
    }
}

async fn extract_authenticated_user(state: &AuthState, headers: &axum::http::HeaderMap) -> Option<AuthenticatedUser> {
    let token_str = extract_bearer_from_headers(headers)?;
    let token = SessionToken::from_str(&token_str);
    let username = state.sessions.validate(&token).await?;
    state.credentials.get_user(&username)
}

fn extract_bearer_from_headers(headers: &axum::http::HeaderMap) -> Option<String> {
    let value = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    let token = value.strip_prefix("Bearer ")?.trim();
    (!token.is_empty()).then(|| token.to_string())
}

fn resolve_ip(headers: &axum::http::HeaderMap) -> std::net::IpAddr {
    headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()).and_then(|v| v.split(',').next()).and_then(|v| v.trim().parse().ok()).unwrap_or_else(|| "127.0.0.1".parse().unwrap())
}

fn extract_request_id(headers: &axum::http::HeaderMap) -> Option<String> { headers.get("x-request-id").and_then(|v| v.to_str().ok()).map(str::to_string) }

async fn list_sessions_handler(State(state): State<AuthState>, headers: axum::http::HeaderMap) -> impl IntoResponse {
    if extract_authenticated_user(&state, &headers).await.is_none() { return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Unauthorized" }))); }
    (StatusCode::OK, Json(serde_json::json!({ "sessions": state.sessions.list_sessions().await })))
}

async fn revoke_session_handler(State(state): State<AuthState>, headers: axum::http::HeaderMap, Path(session_id): Path<String>) -> impl IntoResponse {
    let caller = match extract_authenticated_user(&state, &headers).await { Some(u) => u, None => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Unauthorized" }))) };
    if !caller.can(Permission::RevokeSessions) { return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Forbidden" }))); }
    match state.sessions.revoke_by_id(&session_id).await { Some(view) => (StatusCode::OK, Json(serde_json::json!({ "session": view }))), None => (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Session not found" }))) }
}

async fn flush_sessions_handler(State(state): State<AuthState>, headers: axum::http::HeaderMap, Json(req): Json<FlushSessionsRequest>) -> impl IntoResponse {
    let caller = match extract_authenticated_user(&state, &headers).await { Some(u) => u, None => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Unauthorized" }))) };
    if !caller.can(Permission::RevokeSessions) || !req.confirm { return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Admin confirmation required" }))); }
    let token = extract_bearer_from_headers(&headers);
    let count = state.sessions.flush_except(token.as_deref()).await;
    (StatusCode::OK, Json(serde_json::json!({ "revoked": count })))
}

async fn list_api_keys_handler(State(state): State<AuthState>, headers: axum::http::HeaderMap) -> impl IntoResponse { let caller = match extract_authenticated_user(&state, &headers).await { Some(u) => u, None => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Unauthorized" }))) }; match state.credentials.list_api_keys(&caller.username) { Ok(keys) => (StatusCode::OK, Json(serde_json::json!({ "keys": keys }))), Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))) } }
async fn create_api_key_handler(State(state): State<AuthState>, headers: axum::http::HeaderMap, Json(req): Json<CreateApiKeyRequest>) -> impl IntoResponse { let caller = match extract_authenticated_user(&state, &headers).await { Some(u) => u, None => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Unauthorized" }))) }; match state.credentials.create_api_key(&caller.username, req) { Ok(key) => (StatusCode::CREATED, Json(serde_json::to_value(key).unwrap())), Err(e) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": e.to_string() }))) } }
async fn revoke_api_key_handler(State(state): State<AuthState>, headers: axum::http::HeaderMap, Path(id): Path<String>) -> impl IntoResponse { let caller = match extract_authenticated_user(&state, &headers).await { Some(u) => u, None => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Unauthorized" }))) }; match state.credentials.revoke_api_key(&caller.username, &id) { Ok(()) => (StatusCode::OK, Json(serde_json::json!({ "status": "revoked" }))), Err(e) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": e.to_string() }))) } }
