//! Enterprise control-plane API for Vardhan Technologies.

use auth_service::{auth_router, AuthState, AuthenticatedUser};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    middleware,
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Extension, Json, Router,
};
mod receipt_api;
use core_crypto::aer_kep_q_runtime::AerKepQRuntime;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sled::Db;
use std::{
    net::SocketAddr,
    sync::{Arc, Mutex},
};
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use uuid::Uuid;

pub mod assurance_evidence;
pub mod billing;
pub mod billing_api;
pub mod continuous_operations;
pub mod distributed_idempotency;
pub mod durable_event_queue;
pub mod enterprise_api;
pub mod enterprise_integrations;
pub mod enterprise_sso;
pub mod intelligence_briefs;
pub mod operations_api;
pub mod passport_api;
pub mod qcore_telemetry;
pub mod receipt_key_registry;
pub mod receipt_transport;
pub mod receipt_verification;
pub mod resilience_contract;
pub mod saml_service;
pub mod security_operations;
pub mod webauthn_api;
pub mod webhook_api;

const ORG_PREFIX: &[u8] = b"org:";
pub(crate) const MEMBER_PREFIX: &[u8] = b"member:";
const SUB_PREFIX: &[u8] = b"sub:";
const USAGE_PREFIX: &[u8] = b"usage:";

#[derive(Clone)]
pub struct ControlPlaneState {
    pub db: Arc<Db>,
    pub aer_kep_q: Option<Arc<Mutex<AerKepQRuntime>>>,
    pub auth: AuthState,
    pub cluster: Arc<ha_cluster::ClusterMembership>,
    pub idempotency: Arc<dyn distributed_idempotency::IdempotencyStore>,
}

impl ControlPlaneState {
    pub fn new_with_sled(
        db: Arc<Db>,
        aer_kep_q: Option<Arc<Mutex<AerKepQRuntime>>>,
        auth: AuthState,
        cluster: Arc<ha_cluster::ClusterMembership>,
    ) -> Self {
        let idempotency = Arc::new(distributed_idempotency::SledIdempotencyStore::new(
            db.clone(),
        ));
        Self {
            db,
            aer_kep_q,
            auth,
            cluster,
            idempotency,
        }
    }

    pub fn new_with_store(
        db: Arc<Db>,
        aer_kep_q: Option<Arc<Mutex<AerKepQRuntime>>>,
        auth: AuthState,
        cluster: Arc<ha_cluster::ClusterMembership>,
        idempotency: Arc<dyn distributed_idempotency::IdempotencyStore>,
    ) -> Self {
        Self {
            db,
            aer_kep_q,
            auth,
            cluster,
            idempotency,
        }
    }
}
#[derive(Debug, Clone, Serialize)]
pub struct Plan {
    pub id: &'static str,
    pub name: &'static str,
    pub tier: &'static str,
    /// Product boundary identifier, ensuring Q-Core remains distinct from Vardhan Intelligence.
    pub product: &'static str,
    pub contact_sales: bool,
    pub entitlements: &'static [&'static str],
    /// Fixed commercial value in GBP. `None` for scoped (strategic) pricing.
    pub price_gbp: Option<u64>,
    /// Lower bound in GBP for scoped pricing bands. `None` for fixed-price plans.
    pub price_min_gbp: Option<u64>,
    /// Upper bound in GBP for scoped pricing bands. `None` for fixed-price plans.
    pub price_max_gbp: Option<u64>,
    /// Machine-readable billing model: `fixed_fee`, `annual_license`, or `scoped`.
    pub billing_model: &'static str,
    /// Explicit billing type: `fixed_fee`, `annual_license`, or `scoped_engagement`.
    pub billing_type: &'static str,
    /// Explicit billing cadence: `one_off`, `annual`, or `custom`.
    pub billing_period: &'static str,
    /// Human-readable commercial line, e.g. `£720,000 / year`.
    pub price_display: &'static str,
}
pub const PLANS: &[Plan] = &[
    Plan {
        id: "qcore_architecture_evaluation",
        name: "Architecture & Security Evaluation",
        tier: "professional_service",
        product: "q_core",
        contact_sales: true,
        price_gbp: Some(15000),
        price_min_gbp: None,
        price_max_gbp: None,
        billing_model: "fixed_fee",
        billing_type: "fixed_fee",
        billing_period: "one_off",
        price_display: "£15,000 fixed fee",
        entitlements: &["q_core_evaluation"],
    },
    Plan {
        id: "qcore_proof_of_value",
        name: "Bounded Proof of Value",
        tier: "professional_service",
        product: "q_core",
        contact_sales: true,
        price_gbp: Some(60000),
        price_min_gbp: None,
        price_max_gbp: None,
        billing_model: "fixed_fee",
        billing_type: "fixed_fee",
        billing_period: "one_off",
        price_display: "£60,000 fixed fee",
        entitlements: &["q_core_pov"],
    },
    Plan {
        id: "foundation",
        name: "Foundation",
        tier: "enterprise",
        product: "q_core",
        contact_sales: true,
        price_gbp: Some(360000),
        price_min_gbp: None,
        price_max_gbp: None,
        billing_model: "annual_license",
        billing_type: "annual_license",
        billing_period: "annual",
        price_display: "£360,000 / year",
        entitlements: &["q_core", "audit", "api"],
    },
    Plan {
        id: "enterprise",
        name: "Enterprise",
        tier: "enterprise_plus",
        product: "q_core",
        contact_sales: true,
        price_gbp: Some(720000),
        price_min_gbp: None,
        price_max_gbp: None,
        billing_model: "annual_license",
        billing_type: "annual_license",
        billing_period: "annual",
        price_display: "£720,000 / year",
        entitlements: &[
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
        product: "q_core",
        contact_sales: true,
        price_gbp: Some(1200000),
        price_min_gbp: None,
        price_max_gbp: None,
        billing_model: "annual_license",
        billing_type: "annual_license",
        billing_period: "annual",
        price_display: "£1,200,000 / year",
        entitlements: &[
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
        product: "q_core",
        contact_sales: true,
        price_gbp: None,
        price_min_gbp: Some(5000000),
        price_max_gbp: Some(50000000),
        billing_model: "scoped",
        billing_type: "scoped_engagement",
        billing_period: "custom",
        price_display: "£5,000,000–£50,000,000 individually scoped",
        entitlements: &[
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

pub(crate) fn key(prefix: &[u8], value: &str) -> Vec<u8> {
    let mut out = prefix.to_vec();
    out.extend_from_slice(value.as_bytes());
    out
}
fn member_key(org_id: &str, username: &str) -> Vec<u8> {
    key(MEMBER_PREFIX, &format!("{org_id}:{username}"))
}
pub(crate) fn json_error(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({ "error": message }))).into_response()
}
pub(crate) fn load_json<T: for<'de> Deserialize<'de>>(
    db: &Db,
    k: &[u8],
) -> Result<Option<T>, String> {
    let value = db
        .get(k)
        .map_err(|e| format!("control-plane store read failed: {e}"))?;
    value
        .map(|bytes| {
            serde_json::from_slice(&bytes).map_err(|e| format!("invalid stored state: {e}"))
        })
        .transpose()
}
pub(crate) fn save_json<T: Serialize>(db: &Db, k: &[u8], value: &T) -> Result<(), String> {
    let bytes =
        serde_json::to_vec(value).map_err(|e| format!("state serialization failed: {e}"))?;
    db.insert(k, bytes)
        .map(|_| ())
        .map_err(|e| format!("control-plane store write failed: {e}"))?;
    db.flush()
        .map(|_| ())
        .map_err(|e| format!("control-plane store flush failed: {e}"))
}
pub(crate) fn is_member(db: &Db, org_id: &str, username: &str) -> Result<bool, String> {
    Ok(db
        .get(member_key(org_id, username))
        .map_err(|e| format!("membership read failed: {e}"))?
        .is_some())
}
pub(crate) fn member_role(db: &Db, org_id: &str, username: &str) -> Result<Option<String>, String> {
    db.get(member_key(org_id, username))
        .map_err(|e| format!("membership read failed: {e}"))
        .map(|value| value.and_then(|bytes| String::from_utf8(bytes.to_vec()).ok()))
}
pub(crate) fn plan(plan_id: &str) -> Option<&'static Plan> {
    PLANS.iter().find(|p| p.id == plan_id)
}

pub fn router(control: ControlPlaneState, auth: AuthState, allowed_origins: CorsLayer) -> Router {
    let protected = Router::new()
        .route("/api/v1/me", get(me))
        .route(
            "/api/v1/organizations",
            get(list_organizations).post(create_organization),
        )
        .route(
            "/api/v1/organizations/{id}",
            get(get_organization).delete(enterprise_api::delete_organization),
        )
        .route(
            "/api/v1/organizations/{id}/leave",
            post(enterprise_api::leave_organization),
        )
        .route(
            "/api/v1/organizations/{id}/entitlements",
            get(billing_api::verified_entitlements),
        )
        .route(
            "/api/v1/organizations/{id}/subscription",
            get(subscription).post(set_subscription),
        )
        .route("/api/v1/organizations/{id}/usage", get(usage))
        .route(
            "/api/v1/organizations/{id}/usage/record",
            post(record_usage),
        )
        .route(
            "/api/v1/organizations/{id}/security/posture",
            get(operations_api::security_posture),
        )
        .route(
            "/api/v1/organizations/{id}/security/validate",
            post(receipt_api::validate_canonical),
        )
        .route(
            "/api/v1/organizations/{id}/security/operations",
            get(continuous_operations::operations),
        )
        .route(
            "/api/v1/organizations/{id}/security/executive-report",
            get(continuous_operations::executive_report),
        )
        .route(
            "/api/v1/organizations/{id}/security/alerts",
            get(continuous_operations::alerts)
                .post(continuous_operations::ingest_monitoring_signal),
        )
        .route(
            "/api/v1/organizations/{id}/security/alerts/{alert_id}",
            post(continuous_operations::transition_alert),
        )
        .route(
            "/api/v1/organizations/{id}/security/policy-baseline",
            post(continuous_operations::baseline_policy),
        )
        .route(
            "/api/v1/organizations/{id}/security/policy-observations",
            post(continuous_operations::observe_policy),
        )
        .route(
            "/api/v1/organizations/{id}/security/policy-drift",
            get(continuous_operations::policy_drift),
        )
        .route(
            "/api/v1/organizations/{id}/security/remediations",
            get(continuous_operations::remediations)
                .post(continuous_operations::propose_remediation),
        )
        .route(
            "/api/v1/organizations/{id}/security/remediations/{remediation_id}",
            post(continuous_operations::transition_remediation),
        )
        .route(
            "/api/v1/organizations/{id}/security/crypto-posture",
            get(continuous_operations::crypto_posture),
        )
        .route(
            "/api/v1/organizations/{id}/security/audit",
            get(continuous_operations::audit),
        )
        .route(
            "/api/v1/organizations/{id}/passports",
            post(passport_api::create_passport),
        )
        .route(
            "/api/v1/organizations/{id}/passports/{passport_id}",
            get(passport_api::get_passport).patch(passport_api::update_passport_state),
        )
        .route(
            "/api/v1/organizations/{id}/findings",
            get(operations_api::findings).post(operations_api::ingest_finding),
        )
        .route(
            "/api/v1/organizations/{id}/incidents",
            get(operations_api::incidents).post(operations_api::update_incident),
        )
        .route(
            "/api/v1/organizations/{id}/transactions",
            get(operations_api::transactions).post(operations_api::ingest_transaction),
        )
        .route(
            "/api/v1/organizations/{id}/aer-kep-q/status",
            get(operations_api::aer_kep_q_status),
        )
        .route(
            "/api/v1/organizations/{id}/members",
            get(enterprise_api::list_members),
        )
        .route(
            "/api/v1/organizations/{id}/members/{member}",
            delete(enterprise_api::delete_member),
        )
        .route(
            "/api/v1/organizations/{id}/members/{member}/role",
            post(enterprise_api::set_member_role),
        )
        .route(
            "/api/v1/organizations/{id}/webhooks",
            get(webhook_api::list_webhooks).post(webhook_api::create_webhook),
        )
        .route(
            "/api/v1/organizations/{id}/webhooks/{webhook_id}",
            delete(webhook_api::delete_webhook),
        )
        .route(
            "/api/v1/organizations/{id}/webhooks/{webhook_id}/test",
            post(webhook_api::test_webhook_delivery),
        )
        .route(
            "/api/v1/organizations/{id}/webhooks/deliveries",
            get(webhook_api::list_webhook_deliveries),
        )
        .route(
            "/api/v1/billing/subscriptions/activate",
            post(billing_api::activate_subscription),
        )
        .route(
            "/api/v1/billing/licenses/mint",
            post(billing_api::mint_license),
        )
        .route(
            "/api/v1/billing/licenses/install",
            post(billing_api::install_license),
        )
        .route(
            "/api/v1/billing/licenses/renew",
            post(billing_api::renew_license),
        )
        .route(
            "/api/v1/organizations/{id}/invitations",
            get(enterprise_api::list_invitations).post(enterprise_api::create_invitation),
        )
        .route(
            "/api/v1/organizations/{id}/invitations/{invitation_id}",
            post(enterprise_api::revoke_invitation),
        )
        .route(
            "/api/v1/invitations/accept",
            post(enterprise_api::accept_invitation),
        )
        .route(
            "/api/v1/auth/webauthn/register/start",
            post(webauthn_api::registration_start),
        )
        .route(
            "/api/v1/auth/webauthn/register/finish",
            post(webauthn_api::registration_finish),
        )
        .merge(intelligence_briefs::routes())
        .layer(middleware::from_fn_with_state(
            auth.clone(),
            auth_service::require_session,
        ));
    let public_service = Router::new()
        .route(
            "/api/v1/organizations/{id}/qcore/receipts",
            post(receipt_transport::ingest_receipt),
        )
        .with_state(control.clone());
    let billing_public = Router::new()
        .route(
            "/api/v1/billing/webhook",
            post(billing_api::billing_webhook),
        )
        .with_state(control.clone());
    let scim = Router::new()
        .route(
            "/scim/v2.0/ServiceProviderConfig",
            get(enterprise_api::scim_service_provider_config),
        )
        .route(
            "/scim/v2.0/organizations/{id}/Users",
            get(enterprise_api::scim_list_users),
        )
        .route(
            "/scim/v2.0/organizations/{id}/Users/{external_id}",
            axum::routing::put(enterprise_api::scim_upsert_user)
                .patch(enterprise_api::scim_upsert_user)
                .delete(enterprise_api::scim_delete_user),
        )
        .with_state(control.clone());
    let sso = Router::new()
        .route("/api/v1/auth/oidc/start", get(enterprise_sso::oidc_start))
        .route(
            "/api/v1/auth/oidc/callback",
            get(enterprise_sso::oidc_callback),
        )
        .route(
            "/api/v1/auth/saml/metadata",
            get(enterprise_sso::saml_metadata),
        )
        .route("/api/v1/auth/saml/acs", post(saml_service::saml_acs))
        .route(
            "/api/v1/auth/webauthn/auth/start",
            post(webauthn_api::authentication_start),
        )
        .route(
            "/api/v1/auth/webauthn/auth/finish",
            post(webauthn_api::authentication_finish),
        )
        .with_state(control.clone());
    Router::new()
        .merge(auth_router(auth.clone()))
        .merge(billing_public)
        .merge(public_service)
        .merge(scim)
        .merge(sso)
        .route(
            "/api/v1/platform/health",
            get(health).with_state(control.clone()),
        )
        .route("/api/v1/crypto/fips-status", get(fips_status))
        .route(
            "/api/v1/cluster/status",
            get(cluster_status).with_state(control.clone()),
        )
        .route("/api/v1/catalog/plans", get(catalog))
        .merge(protected.with_state(control))
        .layer(TraceLayer::new_for_http())
        .layer(allowed_origins)
        .layer(tower_http::request_id::PropagateRequestIdLayer::x_request_id())
        .layer(
            tower::ServiceBuilder::new()
                .layer(axum::error_handling::HandleErrorLayer::new(
                    |err: tower::BoxError| async move {
                        (
                            StatusCode::TOO_MANY_REQUESTS,
                            Json(serde_json::json!({
                                "error": "Global rate limit exceeded. Please throttle requests.",
                                "details": err.to_string()
                            })),
                        )
                    },
                ))
                .layer(tower::buffer::BufferLayer::new(1024))
                .layer(tower::limit::RateLimitLayer::new(
                    std::env::var("VARDHAN_GLOBAL_RATE_LIMIT_RPS")
                        .ok()
                        .and_then(|v| v.parse().ok())
                        .unwrap_or(250),
                    std::time::Duration::from_secs(1),
                )),
        )
}

// TLS support (optional, for production transport security)
#[cfg(feature = "tls")]
use axum::serve::Listener;
#[cfg(feature = "tls")]
use rustls::server::AllowAnyAuthenticatedClient;
#[cfg(feature = "tls")]
use rustls::{Certificate, PrivateKey, ServerConfig};
#[cfg(feature = "tls")]
use std::sync::Arc as StdArc;
#[cfg(feature = "tls")]
use tokio_rustls::TlsAcceptor;

async fn health(
    headers: axum::http::HeaderMap,
    State(control): State<ControlPlaneState>,
) -> axum::response::Response {
    let storage_health = control.idempotency.check_health().await;
    let storage_status = if storage_health.is_ok() {
        "healthy"
    } else {
        "unhealthy"
    };

    let is_authed = auth_service::extract_authenticated_user(&control.auth, &headers)
        .await
        .is_some();

    if storage_health.is_err() {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "service": "vardhan-control-plane",
                "status": "unhealthy",
                "storage": storage_status,
                "storage_backend": control.idempotency.backend_name()
            })),
        )
            .into_response();
    }

    if !is_authed && std::env::var("VARDHAN_ENV").as_deref() == Ok("production") {
        return (
            StatusCode::OK,
            Json(json!({
                "service": "vardhan-control-plane",
                "status": "operational",
                "storage": storage_status,
                "storage_backend": control.idempotency.backend_name()
            })),
        )
            .into_response();
    }

    let tls_enabled = std::env::var("VARDHAN_TLS_CERT_PATH")
        .map(|v| !v.is_empty())
        .unwrap_or(false);
    let transport_secure = if tls_enabled { "tls" } else { "plaintext_http" };
    (
        StatusCode::OK,
        Json(json!({
            "service": "vardhan-control-plane",
            "status": "operational",
            "mode": "enterprise",
            "authentication": "server_enforced",
            "demo_authentication": false,
            "transport": transport_secure,
            "tls_enabled": tls_enabled,
            "client_auth": client_auth_mode(),
            "storage": storage_status,
            "storage_backend": control.idempotency.backend_name(),
            "fips_140_3": core_crypto::fips140_3::get_fips_status_report().status
        })),
    )
        .into_response()
}

/// Exposes FIPS 140-3 operational state, Known Answer Test results, and algorithm approvals.
async fn fips_status() -> axum::response::Response {
    let report = core_crypto::fips140_3::get_fips_status_report();
    let status_code = if report.status == "ERROR_STATE" {
        StatusCode::SERVICE_UNAVAILABLE
    } else {
        StatusCode::OK
    };
    (
        status_code,
        Json(serde_json::to_value(&report).unwrap_or_default()),
    )
        .into_response()
}

/// Client-certificate requirement advertised by [`health`].
///
/// `mtls_required` when `VARDHAN_TLS_CLIENT_CA_PATH` names a trust anchor,
/// `none` otherwise. Pure env read so health reflects deployment intent.
fn client_auth_mode() -> &'static str {
    match std::env::var("VARDHAN_TLS_CLIENT_CA_PATH") {
        Ok(v) if !v.is_empty() => "mtls_required",
        _ => "none",
    }
}
async fn catalog() -> Json<&'static [Plan]> {
    Json(PLANS)
}
async fn cluster_status(State(control): State<ControlPlaneState>) -> Json<Value> {
    let node_id = control
        .auth
        .node_id
        .clone()
        .unwrap_or_else(|| "control-plane-01".to_string());
    let peers = control.cluster.peer_snapshot().await;
    let healthy_count = control.cluster.healthy_peers().await.len();
    Json(json!({
        "status": "operational",
        "node_id": node_id,
        "cluster_enabled": true,
        "healthy_peers_count": healthy_count,
        "peers": peers,
    }))
}
async fn me(Extension(user): Extension<AuthenticatedUser>) -> Json<Value> {
    Json(json!({ "username": user.username, "authenticated": true }))
}
async fn create_organization(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Json(req): Json<CreateOrganizationRequest>,
) -> Response {
    let name = req.name.trim();
    if name.len() < 2 || name.len() > 120 {
        return json_error(
            StatusCode::BAD_REQUEST,
            "Organization name must be 2-120 characters.",
        );
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
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("membership write failed: {e}"),
        );
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
    (
        StatusCode::CREATED,
        Json(json!({"organization":org,"subscription":sub})),
    )
        .into_response()
}
async fn list_organizations(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
) -> impl IntoResponse {
    let mut organizations = Vec::new();
    for item in state.db.scan_prefix(ORG_PREFIX) {
        let Ok((_, value)) = item else { continue };
        let Ok(org) = serde_json::from_slice::<Organization>(&value) else {
            continue;
        };
        if is_member(&state.db, &org.id, &user.username).unwrap_or(false) {
            organizations.push(org);
        }
    }
    Json(json!({"organizations":organizations}))
}
async fn get_organization(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match load_json::<Organization>(&state.db, &key(ORG_PREFIX, &id)) {
        Ok(Some(org)) if is_member(&state.db, &id, &user.username).unwrap_or(false) => {
            Json(json!({"organization":org})).into_response()
        }
        Ok(Some(_)) => json_error(StatusCode::FORBIDDEN, "Organization access denied."),
        Ok(None) => json_error(StatusCode::NOT_FOUND, "Organization not found."),
        Err(e) => json_error(StatusCode::INTERNAL_SERVER_ERROR, &e),
    }
}
async fn subscription(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    if !is_member(&state.db, &id, &user.username).unwrap_or(false) {
        return json_error(StatusCode::FORBIDDEN, "Organization access denied.");
    }
    match load_json::<Subscription>(&state.db, &key(SUB_PREFIX, &id)) {
        Ok(Some(sub)) => Json(json!({"subscription":sub})).into_response(),
        Ok(None) => json_error(StatusCode::NOT_FOUND, "Subscription not found."),
        Err(e) => json_error(StatusCode::INTERNAL_SERVER_ERROR, &e),
    }
}
async fn set_subscription(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(id): Path<String>,
    Json(req): Json<SetPlanRequest>,
) -> impl IntoResponse {
    // Subscription changes can create commercial commitments. Membership only
    // grants visibility; ownership is the server-authoritative write boundary.
    match member_role(&state.db, &id, &user.username) {
        Ok(Some(role)) if role == "owner" => {}
        _ => {
            return json_error(
                StatusCode::FORBIDDEN,
                "Organization owner permission required.",
            )
        }
    }
    if plan(&req.plan_id).is_none() {
        return json_error(StatusCode::BAD_REQUEST, "Unknown plan.");
    }
    let Some(mut sub) = load_json::<Subscription>(&state.db, &key(SUB_PREFIX, &id)).unwrap_or(None)
    else {
        return json_error(StatusCode::NOT_FOUND, "Subscription not found.");
    };
    sub.status = "awaiting_billing_activation".into();
    if let Err(e) = save_json(&state.db, &key(SUB_PREFIX, &id), &sub) {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, &e);
    }
    (StatusCode::ACCEPTED,Json(json!({"subscription":sub,"requested_plan":req.plan_id,"activation":"pending_billing_verification"}))).into_response()
}
async fn usage(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    if !is_member(&state.db, &id, &user.username).unwrap_or(false) {
        return json_error(StatusCode::FORBIDDEN, "Organization access denied.");
    }
    let usage = load_json::<Usage>(&state.db, &key(USAGE_PREFIX, &id))
        .unwrap_or(None)
        .unwrap_or(Usage {
            organization_id: id,
            ..Usage::default()
        });
    Json(json!({"usage":usage})).into_response()
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
    match member_role(&state.db, &id, &user.username) {
        Ok(Some(role)) if role == "owner" || role == "security_admin" => {}
        _ => {
            return json_error(
                StatusCode::FORBIDDEN,
                "Organization usage-write permission required.",
            )
        }
    }
    let mut usage = load_json::<Usage>(&state.db, &key(USAGE_PREFIX, &id))
        .unwrap_or(None)
        .unwrap_or(Usage {
            organization_id: id.clone(),
            ..Usage::default()
        });
    usage.bytes_processed = usage.bytes_processed.saturating_add(req.bytes_processed);
    usage.transactions = usage.transactions.saturating_add(req.transactions);
    if let Err(e) = save_json(&state.db, &key(USAGE_PREFIX, &id), &usage) {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, &e);
    }
    Json(json!({"usage":usage})).into_response()
}
/// TLS-capable listener wrapper that implements axum's `Listener` trait.
/// Wraps a TCP listener with a rustls `TlsAcceptor` so that incoming
/// connections are automatically upgraded to TLS before being passed
/// to the axum/hyper server.
#[cfg(feature = "tls")]
struct TlsListener {
    tcp: tokio::net::TcpListener,
    tls: TlsAcceptor,
}

#[cfg(feature = "tls")]
impl Listener for TlsListener {
    type Io = tokio_rustls::server::TlsStream<tokio::net::TcpStream>;
    type Addr = std::net::SocketAddr;

    async fn accept(&mut self) -> (Self::Io, Self::Addr) {
        loop {
            match self.tcp.accept().await {
                Ok((tcp_stream, addr)) => match self.tls.accept(tcp_stream).await {
                    Ok(tls_stream) => return (tls_stream, addr),
                    Err(e) => {
                        tracing::warn!("TLS handshake failed: {}", e);
                        continue;
                    }
                },
                Err(e) => {
                    tracing::warn!("TCP accept error: {}", e);
                }
            }
        }
    }

    fn local_addr(&self) -> std::io::Result<Self::Addr> {
        self.tcp.local_addr()
    }
}

/// Build a rustls [`ServerConfig`] from PEM files on disk.
///
/// When `client_ca_path` is `Some`, the PEM certificates it contains become
/// the only trust anchors for client-certificate verification and mutual TLS
/// is enforced via
/// [`AllowAnyAuthenticatedClient`](rustls::server::AllowAnyAuthenticatedClient).
/// When `None`, no client authentication is requested (existing behaviour).
///
/// Errors are fail-closed: missing/empty/unreadable files or an empty trust
/// store return `Err` so callers can refuse to start.
#[cfg(feature = "tls")]
pub fn build_server_config(
    cert_path: &std::path::Path,
    key_path: &std::path::Path,
    client_ca_path: Option<&std::path::Path>,
) -> Result<ServerConfig, std::io::Error> {
    let invalid = |msg: &str| std::io::Error::new(std::io::ErrorKind::InvalidData, msg);
    let cert_bytes = std::fs::read(cert_path).map_err(|e| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("TLS cert read failed ({}): {e}", cert_path.display()),
        )
    })?;
    let key_bytes = std::fs::read(key_path).map_err(|e| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("TLS key read failed ({}): {e}", key_path.display()),
        )
    })?;

    // rustls-pemfile 1.x: certs() returns Result<Vec<Vec<u8>>, io::Error>
    let cert_chain: Vec<Certificate> = rustls_pemfile::certs(&mut cert_bytes.as_slice())
        .map_err(|e| invalid(&format!("TLS cert parse failed: {e}")))?
        .into_iter()
        .map(Certificate)
        .collect();

    let mut keys: Vec<PrivateKey> = rustls_pemfile::pkcs8_private_keys(&mut key_bytes.as_slice())
        .map_err(|e| invalid(&format!("TLS key parse failed: {e}")))?
        .into_iter()
        .map(PrivateKey)
        .collect();

    if cert_chain.is_empty() || keys.is_empty() {
        return Err(invalid("TLS cert or key is empty"));
    }
    let key = keys.remove(0);

    match client_ca_path {
        Some(ca_path) => {
            let ca_bytes = std::fs::read(ca_path).map_err(|e| {
                std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format!("TLS client CA read failed ({}): {e}", ca_path.display()),
                )
            })?;
            let mut roots = rustls::RootCertStore::empty();
            let mut added = 0usize;
            for der in rustls_pemfile::certs(&mut ca_bytes.as_slice())
                .map_err(|e| invalid(&format!("TLS client CA parse failed: {e}")))?
            {
                roots
                    .add(&Certificate(der))
                    .map_err(|e| invalid(&format!("TLS client CA rejected: {e}")))?;
                added += 1;
            }
            if added == 0 {
                return Err(invalid("TLS client CA file contains no certificates"));
            }
            let verifier = AllowAnyAuthenticatedClient::new(roots);
            ServerConfig::builder()
                .with_safe_defaults()
                .with_client_cert_verifier(verifier.boxed())
                .with_single_cert(cert_chain, key)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
        }
        None => ServerConfig::builder()
            .with_safe_defaults()
            .with_no_client_auth()
            .with_single_cert(cert_chain, key)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e)),
    }
}

pub async fn serve(
    state: ControlPlaneState,
    auth: AuthState,
    addr: SocketAddr,
    cors: CorsLayer,
) -> Result<(), std::io::Error> {
    let app = router(state, auth, cors);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!(%addr, "Vardhan enterprise control plane listening");

    // Check for TLS configuration
    let cert_path = std::env::var("VARDHAN_TLS_CERT_PATH").ok();
    let key_path = std::env::var("VARDHAN_TLS_KEY_PATH").ok();
    // mTLS explicitly requested when VARDHAN_TLS_CLIENT_CA_PATH is set (non-empty).
    let client_ca_path = std::env::var("VARDHAN_TLS_CLIENT_CA_PATH")
        .ok()
        .filter(|v| !v.is_empty());

    // Fail closed: mTLS was explicitly requested but TLS material is unusable.
    #[cfg(not(feature = "tls"))]
    if let Some(ref ca) = client_ca_path {
        let _ = ca;
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "VARDHAN_TLS_CLIENT_CA_PATH is set but the 'tls' feature is not enabled; \
             refusing plaintext fallback when mTLS was explicitly requested",
        ));
    }
    #[cfg(feature = "tls")]
    if let Some(ref ca) = client_ca_path {
        let missing_tls_material = cert_path.as_ref().map_or(true, |v| v.is_empty())
            || key_path.as_ref().map_or(true, |v| v.is_empty())
            || !cert_path
                .as_ref()
                .map(|p| std::path::Path::new(p).exists())
                .unwrap_or(false)
            || !key_path
                .as_ref()
                .map(|p| std::path::Path::new(p).exists())
                .unwrap_or(false)
            || !std::path::Path::new(ca).exists();
        if missing_tls_material {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "VARDHAN_TLS_CLIENT_CA_PATH is set but TLS cert/key/CA material is missing; \
                 refusing plaintext fallback when mTLS was explicitly requested",
            ));
        }
    }

    match (cert_path, key_path) {
        (Some(cert), Some(key))
            if !cert.is_empty()
                && !key.is_empty()
                && std::path::Path::new(&cert).exists()
                && std::path::Path::new(&key).exists() =>
        {
            tracing::info!("TLS enabled using cert={}", cert);
            #[cfg(feature = "tls")]
            {
                tracing::info!("TLS enabled using cert from {}", cert);
                let config = build_server_config(
                    std::path::Path::new(&cert),
                    std::path::Path::new(&key),
                    client_ca_path.as_deref().map(std::path::Path::new),
                )?;
                if client_ca_path.is_some() {
                    tracing::info!("mTLS client-certificate verification enabled");
                }

                let tls_acceptor = TlsAcceptor::from(StdArc::new(config));
                let tls_listener = TlsListener {
                    tcp: listener,
                    tls: tls_acceptor,
                };

                axum::serve(tls_listener, app)
                    .with_graceful_shutdown(async {
                        tokio::signal::ctrl_c().await.ok();
                    })
                    .await
                    .map_err(std::io::Error::other)?;
                Ok(())
            }
            #[cfg(not(feature = "tls"))]
            {
                if std::env::var("VARDHAN_ENV").as_deref() == Ok("production") {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::Other,
                        "FATAL: TLS cert/key specified but 'tls' feature is not compiled in. Build with --features tls in production.",
                    ));
                }
                tracing::error!(
                    "TLS cert/key specified but the 'tls' feature is not enabled. \
                     Serving over plaintext HTTP. Enable the 'tls' feature to use TLS."
                );
                axum::serve(listener, app)
                    .await
                    .map_err(std::io::Error::other)
            }
        }
        _ => {
            if std::env::var("VARDHAN_ENV").as_deref() == Ok("production") {
                if std::env::var("VARDHAN_TLS_TERMINATION").as_deref() != Ok("ingress") {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::Other,
                        "FATAL: Production mode requires TLS. Configure VARDHAN_TLS_CERT_PATH and VARDHAN_TLS_KEY_PATH (or set VARDHAN_TLS_TERMINATION=ingress if terminated at proxy).",
                    ));
                }
                tracing::info!(
                    "Production mode running behind external TLS-terminating ingress proxy."
                );
            }
            axum::serve(listener, app)
                .await
                .map_err(std::io::Error::other)
        }
    }
}
