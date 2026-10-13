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

use axum::{
    body::Body,
    extract::{Request, State},
    http::{header, StatusCode},
    middleware::Next,
    response::Response,
    Json,
};

use crate::authorization::AuthenticatedUser;
use crate::session::SessionToken;

/// Axum middleware that validates the `Authorization: Bearer <token>` header
/// against the session store and loads the user's persisted role.
///
/// - Returns `401` if the header is missing, malformed, invalid/expired, or the
///   authenticated identity has no valid persisted profile role.
/// - Rotates the session token to prevent replay of an observed session token.
/// - Injects `AuthenticatedUser` extension for downstream handlers.
/// - Passes OPTIONS through without auth (CORS preflight).
pub async fn require_session(
    State(state): State<crate::AuthState>,
    mut req: Request<Body>,
    next: Next,
) -> Result<Response, (StatusCode, Json<serde_json::Value>)> {
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

    let (username, new_token) = state.sessions.validate_and_rotate(&token).await.ok_or_else(|| {
        (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": "Invalid or expired session" })),
        )
    })?;

    // Authorization must come from persisted role state. Never synthesize an
    // administrative role from the mere existence of a valid session.
    let role = state.credentials.authoritative_role(&username).ok_or_else(|| {
        (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": "Authenticated identity has no valid role profile" })),
        )
    })?;

    req.extensions_mut().insert(AuthenticatedUser::new_user(username, role));
    req.extensions_mut().insert(new_token.clone());

    let mut response = next.run(req).await;

    response.headers_mut().insert(
        header::HeaderName::from_static("authorization-new-token"),
        header::HeaderValue::from_str(&format!("Bearer {}", new_token.as_str())).unwrap(),
    );

    Ok(response)
}

fn extract_bearer<B>(req: &Request<B>) -> Option<&str> {
    let hdr = req.headers().get(header::AUTHORIZATION)?.to_str().ok()?;
    hdr.strip_prefix("Bearer ")
}
