//! Axum middleware: require a valid session token on protected routes.
//!
//! Usage in route builders:
//! ```rust,ignore
//! use auth_service::middleware::require_session;
//!
//! let protected = Router::new()
//!     .route("/api/v1/metrics", get(metrics_handler))
//!     .layer(middleware::from_fn_with_state(sessions.clone(), require_session));
//! ```
//!
//! The middleware injects `AuthenticatedUser` as a request extension so
//! downstream handlers can access the username without re-querying the store.

use std::sync::Arc;

use axum::{
    body::Body,
    extract::{Request, State},
    http::{header, StatusCode},
    middleware::Next,
    response::Response,
    Json,
};

use crate::session::{SessionStore, SessionToken};

use crate::authorization::{AuthenticatedUser, Role};
use crate::store::CredentialStore;

/// Axum middleware that validates the `Authorization: Bearer <token>` header
/// against the session store and loads the user's role.
///
/// - Returns `401` if the header is missing, malformed, or the token is invalid/expired.
/// - Updates `last_activity` on the session (sliding expiry).
/// - Injects `AuthenticatedUser` extension for downstream handlers.
/// - Passes OPTIONS through without auth (CORS preflight).
pub async fn require_session(
    State(state): State<crate::AuthState>,
    mut req: Request<Body>,
    next: Next,
) -> Result<Response, (StatusCode, Json<serde_json::Value>)> {
    // Pass CORS preflight without auth
    if req.method() == axum::http::Method::OPTIONS {
        return Ok(next.run(req).await);
    }

    let token_str = extract_bearer(&req).ok_or_else(|| {
        (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": "Missing or malformed Authorization header" })),
        )
    })?;

    let token = SessionToken::from_str(token_str);

    // VALIDATE AND ROTATE token to prevent theft
    let (username, new_token) = state.sessions.validate_and_rotate(&token).await.ok_or_else(|| {
        (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": "Invalid or expired session" })),
        )
    })?;

    // Load role
    let role = match state.credentials.get_profile(&username) {
        Ok(profile) => Role::from_str(&profile.role),
        Err(_) => Role::User,
    };

    // Inject authenticated user for downstream handlers
    req.extensions_mut().insert(AuthenticatedUser::new_user(username, role));
    req.extensions_mut().insert(new_token.clone());

    let mut response = next.run(req).await;

    // Add the new rotated token to the response header
    response.headers_mut().insert(
        header::HeaderName::from_static("authorization-new-token"),
        header::HeaderValue::from_str(&format!("Bearer {}", new_token.as_str())).unwrap(),
    );

    Ok(response)
}

/// Extract the bare token string from `Authorization: Bearer <token>`.
fn extract_bearer<B>(req: &Request<B>) -> Option<&str> {
    let hdr = req.headers().get(header::AUTHORIZATION)?.to_str().ok()?;
    hdr.strip_prefix("Bearer ")
}
