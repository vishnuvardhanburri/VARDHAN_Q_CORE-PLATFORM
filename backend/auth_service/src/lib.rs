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

// ── Shared state ──────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct AuthState {
    pub credentials: Arc<CredentialStore>,
    pub sessions: Arc<SessionStore>,
    pub rate_limiter: Arc<RateLimiter>,
    /// Optional durable ledger for audit events.
    pub ledger: Option<Arc<audit_ledger::LedgerWriter>>,
    /// Node identity for signing audit ledger entries with ML-DSA-87.
    pub identity: Option<Arc<core_crypto::QuantumNodeIdentity>>,
    /// Node identifier for cluster and settings reporting.
    pub node_id: Option<String>,
    /// Optional administrative fallback token.
    pub admin_token: Option<String>,
}

// ── Request type — NOT Debug to prevent password leaking into tracing ─────────

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

// ── Router ────────────────────────────────────────────────────────────────────

/// Build the auth sub-router.
pub fn auth_router(state: AuthState) -> Router {
    Router::new()
        // Authentication endpoints
        .route("/api/v1/auth/login", post(login_handler))
        .route("/api/v1/auth/logout", post(logout_handler))
        .route("/api/v1/auth/session", get(session_info_handler))
        // Profile & password endpoints
        .route(
            "/api/v1/admin/profile",
            get(get_profile_handler).put(update_profile_handler),
        )
        .route("/api/v1/admin/password", post(change_password_handler))
        // Settings endpoints
        .route(
            "/api/v1/settings",
            get(get_settings_handler).put(update_settings_handler),
        )
        // Session management endpoints (Priority 4.1 & 4.6)
        .route("/api/v1/sessions", get(list_sessions_handler))
        .route(
            "/api/v1/sessions/{session_id}/revoke",
            post(revoke_session_handler),
        )
        .route("/api/v1/sessions/flush", post(flush_sessions_handler))
        // API key management endpoints (Priority 4.2)
        .route(
            "/api/v1/admin/api-keys",
            get(list_api_keys_handler).post(create_api_key_handler),
        )
        .route(
            "/api/v1/admin/api-keys/{id}",
            delete(revoke_api_key_handler),
        )
        .with_state(state)
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/// POST /api/v1/auth/login — unauthenticated, rate-limited
pub async fn login_handler(
    State(state): State<AuthState>,
    headers: axum::http::HeaderMap,
    Json(req): Json<LoginRequest>,
) -> impl IntoResponse {
    let ip = resolve_ip(&headers);
    let req_id = extract_request_id(&headers);
    let node_id = state.node_id.as_deref().unwrap_or("local-node");

    // Rate limit check (before any crypto work)
    if state.rate_limiter.is_blocked(ip) {
        tracing::warn!(ip = %ip, "Login rate-limited");
        emit_admin_audit(
            state.ledger.as_ref(),
            state.identity.as_ref(),
            node_id,
            "LoginFailed",
            "unknown",
            "rate_limited",
            req_id.as_deref(),
            serde_json::json!({ "ip": ip.to_string(), "reason": "rate_limit_exceeded" }),
        );
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(serde_json::json!({ "error": "Too many attempts. Try again later." })),
        );
    }

    // Constant-time credential check (always runs Argon2 even for unknown usernames)
    let ok = state.credentials.verify(&req.username, &req.password).await;

    if ok {
        state.rate_limiter.reset(ip);
        let token = state
            .sessions
            .create_with_node(&req.username, ip, node_id)
            .await;

        emit_admin_audit(
            state.ledger.as_ref(),
            state.identity.as_ref(),
            node_id,
            "LoginSucceeded",
            &req.username,
            "success",
            req_id.as_deref(),
            serde_json::json!({
                "ip": ip.to_string(),
                "session_prefix": &token.as_str()[..8],
            }),
        );

        tracing::info!(username_hash = %audit::blake3_hex(&req.username), ip = %ip, "LoginSucceeded");

        (
            StatusCode::OK,
            Json(serde_json::json!({
                "token": token.as_str(),
                "expires_in": session::SESSION_HARD_EXPIRY_SECS,
            })),
        )
    } else {
        state.rate_limiter.record_failure(ip);

        emit_admin_audit(
            state.ledger.as_ref(),
            state.identity.as_ref(),
            node_id,
            "LoginFailed",
            "unknown",
            "invalid_credentials",
            req_id.as_deref(),
            serde_json::json!({ "ip": ip.to_string() }),
        );

        tracing::warn!(ip = %ip, "LoginFailed");

        (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": "Invalid credentials" })),
        )
    }
}

/// POST /api/v1/auth/logout — requires valid session
pub async fn logout_handler(
    State(state): State<AuthState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let ip = resolve_ip(&headers);
    let req_id = extract_request_id(&headers);
    let node_id = state.node_id.as_deref().unwrap_or("local-node");

    let token_str = match extract_bearer_from_headers(&headers) {
        Some(t) => t,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({ "error": "Missing Authorization header" })),
            )
        }
    };

    let token = SessionToken::from_str(&token_str);

    if let Some(entry) = state.sessions.remove(&token).await {
        emit_admin_audit(
            state.ledger.as_ref(),
            state.identity.as_ref(),
            node_id,
            "Logout",
            &entry.username,
            "success",
            req_id.as_deref(),
            serde_json::json!({ "ip": ip.to_string() }),
        );
        tracing::info!(username_hash = %audit::blake3_hex(&entry.username), ip = %ip, "Logout");
        (
            StatusCode::OK,
            Json(serde_json::json!({ "status": "logged_out" })),
        )
    } else {
        (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": "Invalid or expired session" })),
        )
    }
}

/// GET /api/v1/auth/session — requires valid session
pub async fn session_info_handler(
    State(state): State<AuthState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let token_str = match extract_bearer_from_headers(&headers) {
        Some(t) => t,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({ "error": "Missing Authorization header" })),
            )
        }
    };

    let token = SessionToken::from_str(&token_str);

    match state.sessions.get_info(&token).await {
        Some(info) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "username": info.username,
                "issued_at_ms": info.issued_at_ms,
                "expires_in": info.expires_in_secs,
            })),
        ),
        None => (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": "Invalid or expired session" })),
        ),
    }
}

/// GET /api/v1/admin/profile — authenticated
pub async fn get_profile_handler(
    State(state): State<AuthState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let caller = match extract_authenticated_user(&state, &headers).await {
        Some(u) => u,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({ "error": "Unauthorized" })),
            )
        }
    };

    match state.credentials.get_profile(&caller.username) {
        Ok(profile) => (StatusCode::OK, Json(serde_json::to_value(profile).unwrap())),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        ),
    }
}

/// PUT /api/v1/admin/profile — authenticated
pub async fn update_profile_handler(
    State(state): State<AuthState>,
    headers: axum::http::HeaderMap,
    Json(req): Json<profile::UpdateProfileRequest>,
) -> impl IntoResponse {
    let caller = match extract_authenticated_user(&state, &headers).await {
        Some(u) => u,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({ "error": "Unauthorized" })),
            )
        }
    };

    let ip = resolve_ip(&headers);
    let req_id = extract_request_id(&headers);
    let node_id = state.node_id.as_deref().unwrap_or("local-node");

    match state
        .credentials
        .update_profile(&caller.username, req.display_name, req.email)
    {
        Ok(profile) => {
            emit_admin_audit(
                state.ledger.as_ref(),
                state.identity.as_ref(),
                node_id,
                "ProfileUpdated",
                &caller.username,
                "success",
                req_id.as_deref(),
                serde_json::json!({ "ip": ip.to_string() }),
            );
            (StatusCode::OK, Json(serde_json::to_value(profile).unwrap()))
        }
        Err(profile::ProfileError::InvalidProfileData(msg)) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": msg })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        ),
    }
}

/// POST /api/v1/admin/password — authenticated
pub async fn change_password_handler(
    State(state): State<AuthState>,
    headers: axum::http::HeaderMap,
    Json(req): Json<profile::ChangePasswordRequest>,
) -> impl IntoResponse {
    let caller = match extract_authenticated_user(&state, &headers).await {
        Some(u) => u,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({ "error": "Unauthorized" })),
            )
        }
    };

    let ip = resolve_ip(&headers);
    let req_id = extract_request_id(&headers);
    let node_id = state.node_id.as_deref().unwrap_or("local-node");

    match state.credentials.change_user_password(
        &caller.username,
        &req.current_password,
        &req.new_password,
        &req.confirm_password,
    ) {
        Ok(()) => {
            emit_admin_audit(
                state.ledger.as_ref(),
                state.identity.as_ref(),
                node_id,
                "PasswordChanged",
                &caller.username,
                "success",
                req_id.as_deref(),
                serde_json::json!({ "ip": ip.to_string() }),
            );
            tracing::info!(username_hash = %audit::blake3_hex(&caller.username), ip = %ip, "PasswordChanged");
            (
                StatusCode::OK,
                Json(serde_json::json!({ "status": "password_changed" })),
            )
        }
        Err(profile::ProfileError::InvalidCurrentPassword) => {
            emit_admin_audit(
                state.ledger.as_ref(),
                state.identity.as_ref(),
                node_id,
                "AdministrativeOperationFailed",
                &caller.username,
                "invalid_password",
                req_id.as_deref(),
                serde_json::json!({ "operation": "ChangePassword" }),
            );
            (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({ "error": "Invalid current password" })),
            )
        }
        Err(profile::ProfileError::PasswordPolicyViolation(msg)) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": msg })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        ),
    }
}

/// GET /api/v1/settings — authenticated
pub async fn get_settings_handler(
    State(state): State<AuthState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    if extract_authenticated_user(&state, &headers).await.is_none() {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": "Unauthorized" })),
        );
    }

    let node_id = state.node_id.as_deref().unwrap_or("local-node");
    let fingerprint = state
        .identity
        .as_ref()
        .map(|id| {
            let pk = id.dsa_public_key_bytes();
            hex::encode(core_crypto::QuantumNodeIdentity::hash_ledger_block(&pk))
        })
        .unwrap_or_else(|| {
            "0000000000000000000000000000000000000000000000000000000000000000".to_string()
        });

    match state.credentials.get_settings(node_id, &fingerprint) {
        Ok(settings) => (
            StatusCode::OK,
            Json(serde_json::to_value(settings).unwrap()),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        ),
    }
}

/// PUT /api/v1/settings — authenticated (Admin only)
pub async fn update_settings_handler(
    State(state): State<AuthState>,
    headers: axum::http::HeaderMap,
    Json(req): Json<settings::UpdateSettingsRequest>,
) -> impl IntoResponse {
    let caller = match extract_authenticated_user(&state, &headers).await {
        Some(u) => u,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({ "error": "Unauthorized" })),
            )
        }
    };

    let req_id = extract_request_id(&headers);
    let node_id = state.node_id.as_deref().unwrap_or("local-node");

    if !caller.can(Permission::UpdateSettings) {
        emit_admin_audit(
            state.ledger.as_ref(),
            state.identity.as_ref(),
            node_id,
            "AdministrativeOperationFailed",
            &caller.username,
            "forbidden",
            req_id.as_deref(),
            serde_json::json!({ "operation": "UpdateSettings" }),
        );
        return (
            StatusCode::FORBIDDEN,
            Json(
                serde_json::json!({ "error": "Forbidden: Admin privilege required to update settings" }),
            ),
        );
    }

    let ip = resolve_ip(&headers);
    let fingerprint = state
        .identity
        .as_ref()
        .map(|id| {
            let pk = id.dsa_public_key_bytes();
            hex::encode(core_crypto::QuantumNodeIdentity::hash_ledger_block(&pk))
        })
        .unwrap_or_else(|| {
            "0000000000000000000000000000000000000000000000000000000000000000".to_string()
        });

    match state
        .credentials
        .update_settings(req, node_id, &fingerprint)
    {
        Ok(settings) => {
            emit_admin_audit(
                state.ledger.as_ref(),
                state.identity.as_ref(),
                node_id,
                "SettingsUpdated",
                &caller.username,
                "success",
                req_id.as_deref(),
                serde_json::json!({ "ip": ip.to_string() }),
            );
            tracing::info!(username_hash = %audit::blake3_hex(&caller.username), ip = %ip, "SettingsUpdated");
            (
                StatusCode::OK,
                Json(serde_json::to_value(settings).unwrap()),
            )
        }
        Err(settings::SettingsError::ImmutableFieldModified) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "Cryptographic identity is immutable and cannot be modified via API"
            })),
        ),
        Err(settings::SettingsError::ValidationError(msg)) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": msg })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        ),
    }
}

// ── Priority 4.1 & 4.6: Real Session Management Handlers ─────────────────────

/// GET /api/v1/sessions — authenticated
pub async fn list_sessions_handler(
    State(state): State<AuthState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let caller = match extract_authenticated_user(&state, &headers).await {
        Some(u) => u,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({ "error": "Unauthorized" })),
            )
        }
    };

    let all = state.sessions.list_sessions().await;
    let list = if caller.can(Permission::ReadSessions) {
        all
    } else {
        all.into_iter()
            .filter(|s| s.username == caller.username)
            .collect()
    };

    (StatusCode::OK, Json(serde_json::to_value(list).unwrap()))
}

/// POST /api/v1/sessions/{session_id}/revoke — authenticated
pub async fn revoke_session_handler(
    State(state): State<AuthState>,
    Path(session_id): Path<String>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let caller = match extract_authenticated_user(&state, &headers).await {
        Some(u) => u,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({ "error": "Unauthorized" })),
            )
        }
    };

    let req_id = extract_request_id(&headers);
    let node_id = state.node_id.as_deref().unwrap_or("local-node");

    let target = match state.sessions.get_session_by_id(&session_id).await {
        Some(s) => s,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "Session not found" })),
            )
        }
    };

    if !caller.can_revoke_session(&target.username) {
        emit_admin_audit(
            state.ledger.as_ref(),
            state.identity.as_ref(),
            node_id,
            "AdministrativeOperationFailed",
            &caller.username,
            "forbidden",
            req_id.as_deref(),
            serde_json::json!({ "operation": "RevokeSession", "session_id": session_id }),
        );
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "Forbidden: Cannot revoke another user's session" })),
        );
    }

    let is_already_revoked = target.session_state == "revoked";
    let view = state.sessions.revoke_by_id(&session_id).await;

    if !is_already_revoked {
        emit_admin_audit(
            state.ledger.as_ref(),
            state.identity.as_ref(),
            node_id,
            "SessionRevoked",
            &caller.username,
            "success",
            req_id.as_deref(),
            serde_json::json!({
                "session_id": session_id,
                "target_user_hash": audit::blake3_hex(&target.username),
            }),
        );
    }

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "status": if is_already_revoked { "already_revoked" } else { "revoked" },
            "session_id": session_id,
            "session": view,
        })),
    )
}

/// POST /api/v1/sessions/flush — authenticated (Admin only)
pub async fn flush_sessions_handler(
    State(state): State<AuthState>,
    headers: axum::http::HeaderMap,
    body: Option<Json<FlushSessionsRequest>>,
) -> impl IntoResponse {
    let caller = match extract_authenticated_user(&state, &headers).await {
        Some(u) => u,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({ "error": "Unauthorized" })),
            )
        }
    };

    let req_id = extract_request_id(&headers);
    let node_id = state.node_id.as_deref().unwrap_or("local-node");

    if !caller.can(Permission::FlushSessions) {
        emit_admin_audit(
            state.ledger.as_ref(),
            state.identity.as_ref(),
            node_id,
            "AdministrativeOperationFailed",
            &caller.username,
            "forbidden",
            req_id.as_deref(),
            serde_json::json!({ "operation": "FlushSessions" }),
        );
        return (
            StatusCode::FORBIDDEN,
            Json(
                serde_json::json!({ "error": "Forbidden: Admin privilege required for session flush" }),
            ),
        );
    }

    let is_confirmed = body.map(|b| b.confirm).unwrap_or(false)
        || headers
            .get("x-confirm")
            .and_then(|h| h.to_str().ok())
            .map(|v| v.eq_ignore_ascii_case("flush") || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false);

    if !is_confirmed {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "Session flush requires explicit confirmation ({ 'confirm': true } or X-Confirm: flush)"
            })),
        );
    }

    let caller_token = extract_bearer_from_headers(&headers);
    let count = state.sessions.flush_except(caller_token.as_deref()).await;

    emit_admin_audit(
        state.ledger.as_ref(),
        state.identity.as_ref(),
        node_id,
        "SessionsFlushed",
        &caller.username,
        "success",
        req_id.as_deref(),
        serde_json::json!({ "revoked_count": count }),
    );

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "status": "flushed",
            "revoked_count": count,
            "message": "All other active sessions revoked. Caller session preserved."
        })),
    )
}

// ── Priority 4.2: API Key Management Handlers ────────────────────────────────

/// GET /api/v1/admin/api-keys — authenticated (Admin only)
pub async fn list_api_keys_handler(
    State(state): State<AuthState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let caller = match extract_authenticated_user(&state, &headers).await {
        Some(u) => u,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({ "error": "Unauthorized" })),
            )
        }
    };

    if !caller.can(Permission::ManageApiKeys) {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "Forbidden: Admin privilege required" })),
        );
    }

    match state.credentials.list_api_keys() {
        Ok(keys) => (StatusCode::OK, Json(serde_json::to_value(keys).unwrap())),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        ),
    }
}

/// POST /api/v1/admin/api-keys — authenticated (Admin only)
pub async fn create_api_key_handler(
    State(state): State<AuthState>,
    headers: axum::http::HeaderMap,
    Json(req): Json<api_key::CreateApiKeyRequest>,
) -> impl IntoResponse {
    let caller = match extract_authenticated_user(&state, &headers).await {
        Some(u) => u,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({ "error": "Unauthorized" })),
            )
        }
    };

    let req_id = extract_request_id(&headers);
    let node_id = state.node_id.as_deref().unwrap_or("local-node");

    if !caller.can(Permission::ManageApiKeys) {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "Forbidden: Admin privilege required" })),
        );
    }

    match state
        .credentials
        .create_api_key(&req.name, req.expires_in_days, &caller.username)
    {
        Ok(response) => {
            emit_admin_audit(
                state.ledger.as_ref(),
                state.identity.as_ref(),
                node_id,
                "ApiKeyCreated",
                &caller.username,
                "success",
                req_id.as_deref(),
                serde_json::json!({
                    "key_id": response.id,
                    "name": response.name,
                }),
            );
            (
                StatusCode::CREATED,
                Json(serde_json::to_value(response).unwrap()),
            )
        }
        Err(api_key::ApiKeyError::InvalidName(msg)) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": msg })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        ),
    }
}

/// DELETE /api/v1/admin/api-keys/{id} — authenticated (Admin only)
pub async fn revoke_api_key_handler(
    State(state): State<AuthState>,
    Path(id): Path<String>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let caller = match extract_authenticated_user(&state, &headers).await {
        Some(u) => u,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({ "error": "Unauthorized" })),
            )
        }
    };

    let req_id = extract_request_id(&headers);
    let node_id = state.node_id.as_deref().unwrap_or("local-node");

    if !caller.can(Permission::ManageApiKeys) {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "Forbidden: Admin privilege required" })),
        );
    }

    match state.credentials.revoke_api_key(&id) {
        Ok(view) => {
            emit_admin_audit(
                state.ledger.as_ref(),
                state.identity.as_ref(),
                node_id,
                "ApiKeyRevoked",
                &caller.username,
                "success",
                req_id.as_deref(),
                serde_json::json!({
                    "key_id": id,
                    "name": view.name,
                }),
            );
            (StatusCode::OK, Json(serde_json::to_value(view).unwrap()))
        }
        Err(api_key::ApiKeyError::NotFound) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "API key not found" })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        ),
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

pub async fn extract_authenticated_user(
    state: &AuthState,
    headers: &axum::http::HeaderMap,
) -> Option<AuthenticatedUser> {
    let token_str = extract_bearer_from_headers(headers)?;

    // 1. Session token lookup
    let session_token = SessionToken::from_str(&token_str);
    if let Some(username) = state.sessions.validate(&session_token).await {
        let role = state
            .credentials
            .get_profile(&username)
            .map(|p| Role::from_str(&p.role))
            .unwrap_or(Role::Admin);
        return Some(AuthenticatedUser { username, role });
    }

    // 2. Fallback: constant-time check against bootstrap admin token
    if let Some(ref admin_tok) = state.admin_token {
        if !admin_tok.is_empty()
            && subtle::ConstantTimeEq::ct_eq(token_str.as_bytes(), admin_tok.as_bytes()).into()
        {
            return Some(AuthenticatedUser {
                username: "admin".to_string(),
                role: Role::Admin,
            });
        }
    }

    // 3. API key lookup
    if token_str.starts_with("vq_live_") {
        if let Ok(Some(key_view)) = state.credentials.verify_api_key(&token_str) {
            return Some(AuthenticatedUser {
                username: key_view.created_by,
                role: Role::Admin, // API keys have admin/service credentials
            });
        }
    }

    None
}

pub fn resolve_ip(headers: &axum::http::HeaderMap) -> std::net::IpAddr {
    headers
        .get("x-forwarded-for")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.split(',').next())
        .and_then(|s| s.trim().parse().ok())
        .or_else(|| {
            headers
                .get("x-real-ip")
                .and_then(|h| h.to_str().ok())
                .and_then(|s| s.trim().parse().ok())
        })
        .unwrap_or(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST))
}

pub fn extract_bearer_from_headers(headers: &axum::http::HeaderMap) -> Option<String> {
    let hdr = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    hdr.strip_prefix("Bearer ").map(|s| s.to_string())
}

pub fn extract_request_id(headers: &axum::http::HeaderMap) -> Option<String> {
    headers
        .get("x-request-id")
        .and_then(|h| h.to_str().ok())
        .map(|s| s.to_string())
}
