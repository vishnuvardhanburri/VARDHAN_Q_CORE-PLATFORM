//! # auth_service
//!
//! Production authentication, session management, MFA, SSO configuration,
//! RBAC authorization, and persistent administrative operations.

pub mod api_key;
pub mod audit;
pub mod authorization;
pub mod credentials;
pub mod mfa;
pub mod mfa_policy;
pub mod mfa_store;
pub mod mfa_challenge_store;
pub mod mfa_service;
pub mod oidc;
pub mod middleware;
pub mod profile;
pub mod rate_limit;
pub mod secrets;
pub mod session;
pub mod settings;
pub mod store;

use std::sync::Arc;

use axum::{extract::{Path, State}, http::{header, StatusCode}, response::IntoResponse, routing::{delete, get, post}, Json, Router};
use serde::Deserialize;

use crate::{rate_limit::RateLimiter, store::CredentialStore};

pub use api_key::{ApiKeyView, CreateApiKeyRequest, CreateApiKeyResponse};
pub use audit::emit_admin_audit;
pub use authorization::{AuthenticatedUser, Permission, Role};
pub use middleware::require_session;
pub use profile::{AdminProfile, ChangePasswordRequest, UpdateProfileRequest};
pub use session::{SessionInfo, SessionStore, SessionToken, SessionView};
pub use settings::{SettingsConfig, UpdateSettingsRequest};
pub use mfa::{normalize_secret, verify_totp, MfaError};
pub use mfa_policy::{MfaChallenge, MfaPolicy};
pub use mfa_store::MfaStore;
pub use mfa_challenge_store::{MfaChallengeStore, StoredMfaChallenge};
pub use mfa_service::MfaService;
pub use oidc::{OidcConfig, OidcConfigError};

#[derive(Clone)]
pub struct AuthState {
    pub credentials: Arc<CredentialStore>,
    pub sessions: Arc<SessionStore>,
    pub rate_limiter: Arc<RateLimiter>,
    pub mfa: Option<Arc<MfaService>>,
    pub ledger: Option<Arc<audit_ledger::LedgerWriter>>,
    pub identity: Option<Arc<core_crypto::QuantumNodeIdentity>>,
    pub node_id: Option<String>,
    pub admin_token: Option<String>,
}

#[derive(Deserialize)]
pub struct LoginRequest { pub username: String, pub password: String }

#[derive(Deserialize)]
pub struct MfaVerifyRequest { pub challenge_id: String, pub code: String }

#[derive(Deserialize)]
pub struct MfaEnrollRequest { pub secret: String }

#[derive(Deserialize, Default)]
pub struct FlushSessionsRequest { #[serde(default)] pub confirm: bool }

pub fn auth_router(state: AuthState) -> Router {
    Router::new()
        .route("/api/v1/auth/login", post(login_handler))
        .route("/api/v1/auth/mfa/verify", post(mfa_verify_handler))
        .route("/api/v1/auth/mfa/enroll", post(mfa_enroll_handler))
        .route("/api/v1/auth/mfa/disable", post(mfa_disable_handler))
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

pub async fn login_handler(State(state): State<AuthState>, headers: axum::http::HeaderMap, Json(req): Json<LoginRequest>) -> impl IntoResponse {
    let ip = resolve_ip(&headers);
    let req_id = extract_request_id(&headers);
    let node_id = state.node_id.as_deref().unwrap_or("local-node");
    if state.rate_limiter.is_blocked(ip) {
        emit_admin_audit(state.ledger.as_ref(), state.identity.as_ref(), node_id, "LoginFailed", "unknown", "rate_limited", req_id.as_deref(), serde_json::json!({ "ip": ip.to_string(), "reason": "rate_limit_exceeded" }));
        return (StatusCode::TOO_MANY_REQUESTS, Json(serde_json::json!({ "error": "Too many attempts. Try again later." })));
    }
    let ok = state.credentials.verify(&req.username, &req.password).await;
    if ok {
        if let Some(mfa) = state.mfa.as_ref() {
            if mfa.is_enrolled(&req.username) {
                match mfa.issue_challenge(&req.username) {
                    Ok(challenge) => {
                        state.rate_limiter.reset(ip);
                        emit_admin_audit(state.ledger.as_ref(), state.identity.as_ref(), node_id, "LoginMfaRequired", &req.username, "challenge_issued", req_id.as_deref(), serde_json::json!({ "ip": ip.to_string() }));
                        return (StatusCode::ACCEPTED, Json(serde_json::json!({ "status": "mfa_required", "challenge_id": challenge.id, "expires_at_ms": challenge.expires_at_ms })));
                    }
                    Err(_) => return (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({ "error": "MFA challenge service unavailable" }))),
                }
            }
        }
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

async fn mfa_verify_handler(State(state): State<AuthState>, headers: axum::http::HeaderMap, Json(req): Json<MfaVerifyRequest>) -> impl IntoResponse {
    let ip = resolve_ip(&headers);
    if state.rate_limiter.is_blocked(ip) { return (StatusCode::TOO_MANY_REQUESTS, Json(serde_json::json!({ "error": "Too many attempts. Try again later." }))); }
    let Some(mfa) = state.mfa.as_ref() else { return (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({ "error": "MFA is not configured" }))); };
    match mfa.verify_challenge(&req.challenge_id, &req.code) {
        Ok(username) => {
            state.rate_limiter.reset(ip);
            let node_id = state.node_id.as_deref().unwrap_or("local-node");
            let token = state.sessions.create_with_node(&username, ip, node_id).await;
            emit_admin_audit(state.ledger.as_ref(), state.identity.as_ref(), node_id, "LoginMfaSucceeded", &username, "success", extract_request_id(&headers).as_deref(), serde_json::json!({ "ip": ip.to_string() }));
            (StatusCode::OK, Json(serde_json::json!({ "token": token.as_str(), "expires_in": 8 * 60 * 60 })))
        }
        Err(_) => {
            state.rate_limiter.record_failure(ip);
            (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Invalid MFA challenge or code" })))
        }
    }
}

async fn mfa_enroll_handler(State(state): State<AuthState>, headers: axum::http::HeaderMap, Json(req): Json<MfaEnrollRequest>) -> impl IntoResponse {
    let caller = match extract_authenticated_user(&state, &headers).await { Some(u) => u, None => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Unauthorized" }))) };
    let Some(mfa) = state.mfa.as_ref() else { return (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({ "error": "MFA is not configured" }))); };
    match mfa.enroll(&caller.username, &req.secret) {
        Ok(recovery_codes) => (StatusCode::OK, Json(serde_json::json!({ "status": "enrolled", "recovery_codes": recovery_codes }))),
        Err(e) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": e }))),
    }
}

async fn mfa_disable_handler(State(state): State<AuthState>, headers: axum::http::HeaderMap) -> impl IntoResponse {
    let caller = match extract_authenticated_user(&state, &headers).await { Some(u) => u, None => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Unauthorized" }))) };
    let Some(mfa) = state.mfa.as_ref() else { return (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({ "error": "MFA is not configured" }))); };
    match mfa.disable(&caller.username) {
        Ok(true) => (StatusCode::OK, Json(serde_json::json!({ "status": "disabled" }))),
        Ok(false) => (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "MFA enrollment not found" }))),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e }))),
    }
}

pub async fn logout_handler(State(state): State<AuthState>, headers: axum::http::HeaderMap) -> impl IntoResponse {
    let token_str = match extract_bearer_from_headers(&headers) { Some(t) => t, None => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Missing Authorization header" }))) };
    match state.sessions.remove(&SessionToken::from_str(&token_str)).await {
        Some(entry) => { let node_id = state.node_id.as_deref().unwrap_or("local-node"); emit_admin_audit(state.ledger.as_ref(), state.identity.as_ref(), node_id, "Logout", &entry.username, "success", extract_request_id(&headers).as_deref(), serde_json::json!({ "ip": resolve_ip(&headers).to_string() })); (StatusCode::OK, Json(serde_json::json!({ "status": "logged_out" }))) }
        None => (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Invalid or expired session" }))),
    }
}

pub async fn session_info_handler(State(state): State<AuthState>, headers: axum::http::HeaderMap) -> impl IntoResponse {
    let token_str = match extract_bearer_from_headers(&headers) { Some(t) => t, None => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Missing Authorization header" }))) };
    match state.sessions.get_info(&SessionToken::from_str(&token_str)).await {
        Some(info) => (StatusCode::OK, Json(serde_json::json!({ "username": info.username, "issued_at_ms": info.issued_at_ms, "expires_in": info.expires_in_secs }))),
        None => (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Invalid or expired session" }))),
    }
}

pub async fn get_profile_handler(State(state): State<AuthState>, headers: axum::http::HeaderMap) -> impl IntoResponse {
    let caller = match extract_authenticated_user(&state, &headers).await { Some(u) => u, None => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Unauthorized" }))) };
    match state.credentials.get_profile(&caller.username) { Ok(p) => (StatusCode::OK, Json(serde_json::to_value(p).unwrap())), Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))) }
}

pub async fn update_profile_handler(State(state): State<AuthState>, headers: axum::http::HeaderMap, Json(req): Json<profile::UpdateProfileRequest>) -> impl IntoResponse {
    let caller = match extract_authenticated_user(&state, &headers).await { Some(u) => u, None => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Unauthorized" }))) };
    match state.credentials.update_profile(&caller.username, req.display_name, req.email) { Ok(p) => (StatusCode::OK, Json(serde_json::to_value(p).unwrap())), Err(profile::ProfileError::InvalidProfileData(msg)) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": msg }))), Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))) }
}

pub async fn change_password_handler(State(state): State<AuthState>, headers: axum::http::HeaderMap, Json(req): Json<profile::ChangePasswordRequest>) -> impl IntoResponse {
    let caller = match extract_authenticated_user(&state, &headers).await { Some(u) => u, None => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Unauthorized" }))) };
    match state.credentials.change_user_password(&caller.username, &req.current_password, &req.new_password, &req.confirm_password) { Ok(()) => (StatusCode::OK, Json(serde_json::json!({ "status": "password_changed" }))), Err(profile::ProfileError::InvalidCurrentPassword) => (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Invalid current password" }))), Err(profile::ProfileError::PasswordPolicyViolation(msg)) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": msg }))), Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))) }
}

pub async fn get_settings_handler(State(state): State<AuthState>, headers: axum::http::HeaderMap) -> impl IntoResponse { if extract_authenticated_user(&state, &headers).await.is_none() { return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Unauthorized" }))); } let node_id = state.node_id.as_deref().unwrap_or("local-node"); let fingerprint = state.identity.as_ref().map(|id| hex::encode(core_crypto::QuantumNodeIdentity::hash_ledger_block(&id.dsa_public_key_bytes()))).unwrap_or_else(|| "0".repeat(64)); match state.credentials.get_settings(node_id, &fingerprint) { Ok(s) => (StatusCode::OK, Json(serde_json::to_value(s).unwrap())), Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))) } }

pub async fn update_settings_handler(State(state): State<AuthState>, headers: axum::http::HeaderMap, Json(req): Json<settings::UpdateSettingsRequest>) -> impl IntoResponse { let caller = match extract_authenticated_user(&state, &headers).await { Some(u) => u, None => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Unauthorized" }))) }; if !caller.can(Permission::UpdateSettings) { return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Forbidden" }))); } let node_id = state.node_id.as_deref().unwrap_or("local-node"); let fingerprint = state.identity.as_ref().map(|id| hex::encode(core_crypto::QuantumNodeIdentity::hash_ledger_block(&id.dsa_public_key_bytes()))).unwrap_or_else(|| "0".repeat(64)); match state.credentials.update_settings(req, node_id, &fingerprint) { Ok(s) => (StatusCode::OK, Json(serde_json::to_value(s).unwrap())), Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))) } }

pub async fn extract_authenticated_user(state: &AuthState, headers: &axum::http::HeaderMap) -> Option<AuthenticatedUser> { let token = extract_bearer_from_headers(headers)?; let username = state.sessions.validate(&SessionToken::from_str(&token)).await?; Some(AuthenticatedUser::new_admin(username)) }
fn extract_bearer_from_headers(headers: &axum::http::HeaderMap) -> Option<String> { let value = headers.get(header::AUTHORIZATION)?.to_str().ok()?; let token = value.strip_prefix("Bearer ")?.trim(); (!token.is_empty()).then(|| token.to_string()) }
pub fn resolve_ip(headers: &axum::http::HeaderMap) -> std::net::IpAddr { headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()).and_then(|v| v.split(',').next()).and_then(|v| v.trim().parse().ok()).unwrap_or_else(|| "127.0.0.1".parse().unwrap()) }
pub fn extract_request_id(headers: &axum::http::HeaderMap) -> Option<String> { headers.get("x-request-id").and_then(|v| v.to_str().ok()).map(str::to_string) }

pub async fn list_sessions_handler(State(state): State<AuthState>, headers: axum::http::HeaderMap) -> impl IntoResponse { if extract_authenticated_user(&state, &headers).await.is_none() { return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Unauthorized" }))); } (StatusCode::OK, Json(serde_json::json!({ "sessions": state.sessions.list_sessions().await }))) }
pub async fn revoke_session_handler(State(state): State<AuthState>, Path(id): Path<String>, headers: axum::http::HeaderMap) -> impl IntoResponse { let caller = match extract_authenticated_user(&state, &headers).await { Some(u) => u, None => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Unauthorized" }))) }; if !caller.can(Permission::RevokeSession) { return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Forbidden" }))); } match state.sessions.revoke_by_id(&id).await { Some(v) => (StatusCode::OK, Json(serde_json::json!({ "session": v }))), None => (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Session not found" }))) } }
pub async fn flush_sessions_handler(State(state): State<AuthState>, headers: axum::http::HeaderMap, body: Option<Json<FlushSessionsRequest>>) -> impl IntoResponse { let caller = match extract_authenticated_user(&state, &headers).await { Some(u) => u, None => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Unauthorized" }))) }; let req = body.map(|Json(req)| req).unwrap_or_default(); if !caller.can(Permission::RevokeSession) || !req.confirm { return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "Admin confirmation required" }))); } let count = state.sessions.flush_except(extract_bearer_from_headers(&headers).as_deref()).await; (StatusCode::OK, Json(serde_json::json!({ "revoked": count }))) }
pub async fn list_api_keys_handler(State(state): State<AuthState>, headers: axum::http::HeaderMap) -> impl IntoResponse { let caller = match extract_authenticated_user(&state, &headers).await { Some(u) => u, None => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Unauthorized" }))) }; match state.credentials.list_api_keys() { Ok(k) => (StatusCode::OK, Json(serde_json::json!({ "keys": k }))), Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))) } }
pub async fn create_api_key_handler(State(state): State<AuthState>, headers: axum::http::HeaderMap, Json(req): Json<CreateApiKeyRequest>) -> impl IntoResponse { let caller = match extract_authenticated_user(&state, &headers).await { Some(u) => u, None => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Unauthorized" }))) }; match state.credentials.create_api_key(&req.name, req.expires_in_days, &caller.username) { Ok(k) => (StatusCode::CREATED, Json(serde_json::to_value(k).unwrap())), Err(e) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": e.to_string() }))) } }
pub async fn revoke_api_key_handler(State(state): State<AuthState>, Path(id): Path<String>, headers: axum::http::HeaderMap) -> impl IntoResponse { let caller = match extract_authenticated_user(&state, &headers).await { Some(u) => u, None => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "Unauthorized" }))) }; let _ = caller; match state.credentials.revoke_api_key(&id) { Ok(view) => (StatusCode::OK, Json(serde_json::json!({ "status": "revoked", "key": view }))), Err(e) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": e.to_string() }))) } }
