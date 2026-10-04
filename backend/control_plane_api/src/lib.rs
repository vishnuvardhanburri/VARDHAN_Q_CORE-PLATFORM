//! Enterprise control-plane API for Vardhan Technologies.
//!
//! This service is intentionally fail-closed: browser/demo state is never treated
//! as authentication, tenant membership is server-side, and commercial entitlements
//! are resolved from the durable control-plane store.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    middleware,
    response::IntoResponse,
    routing::{get, post},
    Extension, Json, Router,
};
use auth_service::{auth_router, middleware::AuthenticatedUser, AuthState};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sled::Db;
use std::{net::SocketAddr, sync::Arc};
use tower_http::{cors::CorsLayer, request_id::MakeRequestUuid, trace::TraceLayer};
use uuid::Uuid;

const ORG_PREFIX: &[u8] = b"org:";
const MEMBER_PREFIX: &[u8] = b"member:";
const SUB_PREFIX: &[u8] = b"sub:";
const USAGE_PREFIX: &[u8] = b"usage:";

#[derive(Clone)]
pub struct ControlPlaneState {
    pub db: Arc<Db>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Plan {
    pub id: &'static str,
    pub name: &'static str,
    pub tier: &'static str,
    pub contact_sales: bool,
    pub entitlements: &'static [&'static str],
}

pub const PLANS: &[Plan] = &[
    Plan {
        id: "foundation",
        name: "Foundation",
        tier: "enterprise",
        contact_sales: true,
        entitlements: &["intelligence", "q_core", "audit", "api"],
    },
    Plan {
        id: "enterprise",
        name: "Enterprise",
        tier: "enterprise_plus",
        contact_sales: true,
        entitlements: &[
            "intelligence",
            "q_core",
            "audit",
            "api",
            "rbac",
            "integrations",
            "compliance",
            "usage",
        ],
    },
    Plan {
        id: "advanced_resilience",
        name: "Advanced Resilience",
        tier: "advanced_resilience",
        contact_sales: true,
        entitlements: &[
            "intelligence",
            "q_core",
            "audit",
            "api",
            "rbac",
            "integrations",
            "compliance",
            "usage",
            "aer_kep_q",
            "ha",
            "dr",
            "hsm_kms",
        ],
    },
    Plan {
        id: "strategic",
        name: "Strategic / Sovereign",
        tier: "strategic",
        contact_sales: true,
        entitlements: &[
            "intelligence",
            "q_core",
            "audit",
            "api",
            "rbac",
            "integrations",
            "compliance",
            "usage",
            "aer_kep_q",
            "ha",
            "dr",
            "hsm_kms",
            "sovereign_deployment",
            "air_gapped",
            "dedicated_assurance",
        ],
    },
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Organization {
    pub id: String,
    pub name: String,
    pub owner: String,
    pub created_at_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subscription {
    pub organization_id: String,
    pub plan_id: String,
    pub status: String,
    pub provider: String,
    pub external_customer_id: Option<String>,
    pub external_subscription_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Usage {
    pub organization_id: String,
    pub transactions: u64,
    pub bytes_processed: u64,
}

#[derive(Debug, Deserialize)]
pub struct CreateOrganizationRequest {
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct SetPlanRequest {
    pub plan_id: String,
}

fn key(prefix: &[u8], value: &str) -> Vec<u8> {
    let mut out = prefix.to_vec();
    out.extend_from_slice(value.as_bytes());
    out
}

fn member_key(org_id: &str, username: &str) -> Vec<u8> {
    key(MEMBER_PREFIX, &format!("{org_id}:{username}"))
}

fn json_error(status: StatusCode, message: &str) -> impl IntoResponse {
    (status, Json(json!({ "error": message })))
}

fn load_json<T: for<'de> Deserialize<'de>>(db: &Db, k: &[u8]) -> Result<Option<T>, String> {
    let value = db
        .get(k)
        .map_err(|e| format!("control-plane store read failed: {e}"))?;
    value
        .map(|bytes| serde_json::from_slice(&bytes).map_err(|e| format!("invalid stored state: {e}")))
        .transpose()
}

fn save_json<T: Serialize>(db: &Db, k: &[u8], value: &T) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|e| format!("state serialization failed: {e}"))?;
    db.insert(k, bytes)
        .map(|_| ())
        .map_err(|e| format!("control-plane store write failed: {e}"))
}

fn is_member(db: &Db, org_id: &str, username: &str) -> Result<bool, String> {
    Ok(db
        .get(member_key(org_id, username))
        .map_err(|e| format!("membership read failed: {e}"))?
        .is_some())
}

fn plan(plan_id: &str) -> Option<&'static Plan> {
    PLANS.iter().find(|p| p.id == plan_id)
}

pub fn router(control: ControlPlaneState, auth: AuthState, allowed_origins: CorsLayer) -> Router {
    let protected = Router::new()
        .route("/api/v1/me", get(me))
        .route("/api/v1/organizations", get(list_organizations).post(create_organization))
        .route("/api/v1/organizations/{id}", get(get_organization))
        .route("/api/v1/organizations/{id}/entitlements", get(entitlements))
        .route("/api/v1/organizations/{id}/subscription", get(subscription).post(set_subscription))
        .route("/api/v1/organizations/{id}/usage", get(usage))
        .route("/api/v1/organizations/{id}/usage/record", post(record_usage))
        .layer(middleware::from_fn_with_state(
            auth.sessions.clone(),
            auth_service::require_session,
        ));

    Router::new()
        .merge(auth_router(auth.clone()))
        .route("/api/v1/platform/health", get(health))
        .route("/api/v1/catalog/plans", get(catalog))
        .merge(protected.with_state(control))
        .layer(TraceLayer::new_for_http())
        .layer(allowed_origins)
        .layer(tower_http::request_id::PropagateRequestIdLayer::x_request_id(
            MakeRequestUuid,
        ))
}

async fn health() -> Json<Value> {
    Json(json!({
        "service": "vardhan-control-plane",
        "status": "operational",
        "mode": "enterprise",
        "authentication": "server_enforced",
        "demo_authentication": false,
    }))
}

async fn catalog() -> Json<&'static [Plan]> {
    Json(PLANS)
}

async fn me(Extension(user): Extension<AuthenticatedUser>) -> Json<Value> {
    Json(json!({ "username": user.username, "authenticated": true }))
}

async fn create_organization(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Json(req): Json<CreateOrganizationRequest>,
) -> impl IntoResponse {
    let name = req.name.trim();
    if name.len() < 2 || name.len() > 120 {
        return json_error(StatusCode::BAD_REQUEST, "Organization name must be 2-120 characters.");
    }

    let id = Uuid::new_v4().to_string();
    let org = Organization {
        id: id.clone(),
        name: name.to_string(),
        owner: user.username.clone(),
        created_at_ms: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or_default(),
    };

    if let Err(e) = save_json(&state.db, &key(ORG_PREFIX, &id), &org) {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, &e);
    }
    if let Err(e) = state.db.insert(member_key(&id, &user.username), b"owner") {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, &format!("membership write failed: {e}"));
    }
    let sub = Subscription {
        organization_id: id.clone(),
        plan_id: "foundation".into(),
        status: "provisioning".into(),
        provider: "unconfigured".into(),
        external_customer_id: None,
        external_subscription_id: None,
    };
    if let Err(e) = save_json(&state.db, &key(SUB_PREFIX, &id), &sub) {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, &e);
    }

    (StatusCode::CREATED, Json(json!({ "organization": org, "subscription": sub })))
}

async fn list_organizations(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
) -> impl IntoResponse {
    let mut organizations = Vec::new();
    for item in state.db.scan_prefix(ORG_PREFIX) {
        let Ok((_, value)) = item else { continue };
        let Ok(org) = serde_json::from_slice::<Organization>(&value) else { continue };
        if is_member(&state.db, &org.id, &user.username).unwrap_or(false) {
            organizations.push(org);
        }
    }
    Json(json!({ "organizations": organizations }))
}

async fn get_organization(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match load_json::<Organization>(&state.db, &key(ORG_PREFIX, &id)) {
        Ok(Some(org)) if is_member(&state.db, &id, &user.username).unwrap_or(false) => Json(json!({ "organization": org })).into_response(),
        Ok(Some(_)) => json_error(StatusCode::FORBIDDEN, "Organization access denied.").into_response(),
        Ok(None) => json_error(StatusCode::NOT_FOUND, "Organization not found.").into_response(),
        Err(e) => json_error(StatusCode::INTERNAL_SERVER_ERROR, &e).into_response(),
    }
}

async fn entitlements(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    if !is_member(&state.db, &id, &user.username).unwrap_or(false) {
        return json_error(StatusCode::FORBIDDEN, "Organization access denied.").into_response();
    }
    let Some(sub) = load_json::<Subscription>(&state.db, &key(SUB_PREFIX, &id)).unwrap_or(None) else {
        return json_error(StatusCode::NOT_FOUND, "Subscription not found.").into_response();
    };
    let Some(p) = plan(&sub.plan_id) else {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, "Unknown subscription plan.").into_response();
    };
    Json(json!({
        "organization_id": id,
        "plan": p,
        "subscription_status": sub.status,
        "entitlements": p.entitlements,
    })).into_response()
}

async fn subscription(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    if !is_member(&state.db, &id, &user.username).unwrap_or(false) {
        return json_error(StatusCode::FORBIDDEN, "Organization access denied.").into_response();
    }
    match load_json::<Subscription>(&state.db, &key(SUB_PREFIX, &id)) {
        Ok(Some(sub)) => Json(json!({ "subscription": sub })).into_response(),
        Ok(None) => json_error(StatusCode::NOT_FOUND, "Subscription not found.").into_response(),
        Err(e) => json_error(StatusCode::INTERNAL_SERVER_ERROR, &e).into_response(),
    }
}

async fn set_subscription(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(id): Path<String>,
    Json(req): Json<SetPlanRequest>,
) -> impl IntoResponse {
    if !is_member(&state.db, &id, &user.username).unwrap_or(false) {
        return json_error(StatusCode::FORBIDDEN, "Organization access denied.").into_response();
    }
    if !plan(&req.plan_id).is_some() {
        return json_error(StatusCode::BAD_REQUEST, "Unknown plan.").into_response();
    }
    // Plan selection is an entitlement intent only. Activation requires a configured
    // billing provider and verified commercial event; the API never self-activates paid access.
    let Some(mut sub) = load_json::<Subscription>(&state.db, &key(SUB_PREFIX, &id)).unwrap_or(None) else {
        return json_error(StatusCode::NOT_FOUND, "Subscription not found.").into_response();
    };
    sub.plan_id = req.plan_id;
    sub.status = "awaiting_billing_activation".into();
    if let Err(e) = save_json(&state.db, &key(SUB_PREFIX, &id), &sub) {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, &e).into_response();
    }
    (StatusCode::ACCEPTED, Json(json!({ "subscription": sub, "activation": "pending_billing_verification" }))).into_response()
}

async fn usage(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    if !is_member(&state.db, &id, &user.username).unwrap_or(false) {
        return json_error(StatusCode::FORBIDDEN, "Organization access denied.").into_response();
    }
    let usage = load_json::<Usage>(&state.db, &key(USAGE_PREFIX, &id)).unwrap_or(None).unwrap_or(Usage {
        organization_id: id,
        ..Usage::default()
    });
    Json(json!({ "usage": usage })).into_response()
}

#[derive(Debug, Deserialize)]
struct RecordUsageRequest {
    pub bytes_processed: u64,
    pub transactions: u64,
}

async fn record_usage(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(id): Path<String>,
    Json(req): Json<RecordUsageRequest>,
) -> impl IntoResponse {
    if !is_member(&state.db, &id, &user.username) {
        return json_error(StatusCode::FORBIDDEN, "Organization access denied.");
    }
    let mut usage = load_json::<Usage>(&state.db, &key(USAGE_PREFIX, &id)).unwrap_or(None).unwrap_or(Usage {
        organization_id: id.clone(),
        ..Usage::default()
    });
    usage.bytes_processed = usage.bytes_processed.saturating_add(req.bytes_processed);
    usage.transactions = usage.transactions.saturating_add(req.transactions);
    if let Err(e) = save_json(&state.db, &key(USAGE_PREFIX, &id), &usage) {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, &e);
    }
    Json(json!({ "usage": usage }))
}

pub async fn serve(state: ControlPlaneState, auth: AuthState, addr: SocketAddr, cors: CorsLayer) -> Result<(), std::io::Error> {
    let app = router(state, auth, cors);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!(%addr, "Vardhan enterprise control plane listening");
    axum::serve(listener, app).await
}
