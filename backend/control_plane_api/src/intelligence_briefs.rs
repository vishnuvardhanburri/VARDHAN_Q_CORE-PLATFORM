//! Operator-reviewed commercial intelligence briefs (read-only).
//!
//! Serves the ranked brief JSON produced by the Stage 5 research pipeline
//! (`intelligence_plane/.research/briefs/ranked.json`). This module never
//! triggers live research and never fabricates briefs: when the backing
//! file is missing or unreadable every handler fails closed with
//! `503 BRIEFS_UNAVAILABLE`.
//!
//! Tenant isolation is enforced by reusing the existing session middleware:
//! both routes live behind `auth_service::require_session` and require the
//! `AuthenticatedUser` extractor, exactly like the other protected routes.

use crate::ControlPlaneState;
use auth_service::AuthenticatedUser;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
    Extension, Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::json;

/// Environment variable overriding the ranked-brief JSON location.
pub const BRIEFS_PATH_ENV: &str = "VARDHAN_BRIEFS_PATH";
/// Default ranked-brief location (Stage 5 output, repo-relative).
pub const DEFAULT_BRIEFS_PATH: &str = "intelligence_plane/.research/briefs/ranked.json";
/// Fail-closed error code when the brief store cannot be loaded.
pub const BRIEFS_UNAVAILABLE: &str = "BRIEFS_UNAVAILABLE";
/// Error code when the brief store exists but cannot be parsed.
pub const BRIEFS_INVALID: &str = "BRIEFS_INVALID";
/// Error code when no brief exists for the requested company.
pub const BRIEF_NOT_FOUND: &str = "BRIEF_NOT_FOUND";

/// Operator review verdict for a commercial brief.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Verdict {
    Go,
    Hold,
    Drop,
}

/// One operator-reviewed commercial brief summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BriefSummary {
    pub company: String,
    pub verdict: Verdict,
    pub score: u8,
    pub signal_url: Option<String>,
    pub why_now: Option<String>,
    pub buyer_role: Option<String>,
}

/// In-memory snapshot of the ranked brief file.
#[derive(Debug, Clone, Default)]
pub struct BriefStore {
    pub briefs: Vec<BriefSummary>,
}

/// Fail-closed load/parse error carrying an HTTP status and code.
#[derive(Debug)]
pub struct BriefsError {
    pub status: StatusCode,
    pub code: &'static str,
    pub message: String,
}

impl IntoResponse for BriefsError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(json!({ "code": self.code, "error": self.message })),
        )
            .into_response()
    }
}

impl BriefStore {
    /// Resolve the ranked-brief file path (env override or Stage 5 default).
    pub fn path() -> String {
        std::env::var(BRIEFS_PATH_ENV).unwrap_or_else(|_| DEFAULT_BRIEFS_PATH.to_string())
    }

    /// Load briefs from `path`. Accepts either a bare JSON array or an
    /// object wrapping the array under `briefs` / `ranked` / `items`.
    pub fn load_from_path(path: &str) -> Result<Self, BriefsError> {
        let raw = std::fs::read_to_string(path).map_err(|e| BriefsError {
            status: StatusCode::SERVICE_UNAVAILABLE,
            code: BRIEFS_UNAVAILABLE,
            message: format!("intelligence brief store unavailable: {e}"),
        })?;
        Self::parse(&raw)
    }

    fn parse(raw: &str) -> Result<Self, BriefsError> {
        let value: serde_json::Value = serde_json::from_str(raw).map_err(|e| BriefsError {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            code: BRIEFS_INVALID,
            message: format!("intelligence brief store is not valid JSON: {e}"),
        })?;
        let invalid_shape = || BriefsError {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            code: BRIEFS_INVALID,
            message: "intelligence brief store must be a JSON array or an object wrapping one"
                .to_string(),
        };
        let items: &Vec<serde_json::Value> = match &value {
            serde_json::Value::Array(items) => items,
            serde_json::Value::Object(map) => map
                .get("briefs")
                .or_else(|| map.get("ranked"))
                .or_else(|| map.get("items"))
                .and_then(serde_json::Value::as_array)
                .ok_or_else(invalid_shape)?,
            _ => return Err(invalid_shape()),
        };
        let mut briefs = Vec::with_capacity(items.len());
        for item in items {
            let brief: BriefSummary =
                serde_json::from_value(item.clone()).map_err(|e| BriefsError {
                    status: StatusCode::INTERNAL_SERVER_ERROR,
                    code: BRIEFS_INVALID,
                    message: format!("intelligence brief entry invalid: {e}"),
                })?;
            briefs.push(brief);
        }
        Ok(Self { briefs })
    }
}

/// `GET /v1/intelligence/briefs` — list operator-reviewed briefs.
pub async fn list_briefs(
    State(_state): State<ControlPlaneState>,
    Extension(_user): Extension<AuthenticatedUser>,
) -> Response {
    match BriefStore::load_from_path(&BriefStore::path()) {
        Ok(store) => Json(store.briefs).into_response(),
        Err(e) => e.into_response(),
    }
}

/// `GET /v1/intelligence/briefs/{company}` — single brief or 404.
pub async fn get_brief(
    State(_state): State<ControlPlaneState>,
    Extension(_user): Extension<AuthenticatedUser>,
    Path(company): Path<String>,
) -> Response {
    let store = match BriefStore::load_from_path(&BriefStore::path()) {
        Ok(store) => store,
        Err(e) => return e.into_response(),
    };
    match store
        .briefs
        .iter()
        .find(|b| b.company.eq_ignore_ascii_case(&company))
    {
        Some(brief) => Json(brief).into_response(),
        None => (
            StatusCode::NOT_FOUND,
            Json(json!({
                "code": BRIEF_NOT_FOUND,
                "error": format!("no intelligence brief for company '{company}'"),
            })),
        )
            .into_response(),
    }
}

/// Protected brief routes; merged into the authenticated router in `lib.rs`.
pub fn routes() -> Router<ControlPlaneState> {
    Router::new()
        .route("/v1/intelligence/briefs", get(list_briefs))
        .route("/v1/intelligence/briefs/{company}", get(get_brief))
}
