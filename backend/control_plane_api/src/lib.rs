//! Enterprise control-plane API for Vardhan Technologies.

use axum::{extract::{Path, State}, http::StatusCode, middleware, response::{IntoResponse, Response}, routing::{get, post}, Extension, Json, Router};
use auth_service::{auth_router, middleware::AuthenticatedUser, AuthState};
use core_crypto::aer_kep_q_runtime::AerKepQRuntime;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sled::Db;
use std::{net::SocketAddr, sync::{Arc, Mutex}};
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use uuid::Uuid;

pub mod billing;
pub mod billing_api;
pub mod enterprise_api;
pub mod enterprise_sso;
pub mod operations_api;
pub mod receipt_key_registry;
pub mod receipt_transport;
pub mod receipt_verification;
pub mod saml_service;
pub mod webauthn_api;

const ORG_PREFIX: &[u8] = b"org:";
pub(crate) const MEMBER_PREFIX: &[u8] = b"member:";
const SUB_PREFIX: &[u8] = b"sub:";
const USAGE_PREFIX: &[u8] = b"usage:";

#[derive(Clone)]
pub struct ControlPlaneState { pub db: Arc<Db>, pub aer_kep_q: Option<Arc<Mutex<AerKepQRuntime>>>, pub auth: AuthState }
#[derive(Debug, Clone, Serialize)]
pub struct Plan { pub id: &'static str, pub name: &'static str, pub tier: &'static str, pub contact_sales: bool, pub entitlements: &'static [&'static str] }
pub const PLANS: &[Plan] = &[
    Plan { id: "foundation", name: "Foundation", tier: "enterprise", contact_sales: true, entitlements: &["intelligence", "q_core", "audit", "api"] },
    Plan { id: "enterprise", name: "Enterprise", tier: "enterprise_plus", contact_sales: true, entitlements: &["intelligence", "q_core", "audit", "api", "rbac", "integrations", "compliance", "usage"] },
    Plan { id: "advanced_resilience", name: "Advanced Resilience", tier: "advanced_resilience", contact_sales: true, entitlements: &["intelligence", "q_core", "audit", "api", "rbac", "integrations", "compliance", "usage", "aer_kep_q", "ha", "dr", "hsm_kms"] },
    Plan { id: "strategic", name: "Strategic / Sovereign", tier: "strategic", contact_sales: true, entitlements: &["intelligence", "q_core", "audit", "api", "rbac", "integrations", "compliance", "usage", "aer_kep_q", "ha", "dr", "hsm_kms", "sovereign_deployment", "air_gapped", "dedicated_assurance"] },
];
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Organization { pub id: String, pub name: String, pub owner: String, pub created_at_ms: u128 }
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subscription { pub organization_id: String, pub plan_id: String, pub status: String, pub provider: String, pub external_customer_id: Option<String>, pub external_subscription_id: Option<String> }
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Usage { pub organization_id: String, pub transactions: u64, pub bytes_processed: u64 }
#[derive(Debug, Deserialize)]
pub struct CreateOrganizationRequest { pub name: String }
#[derive(Debug, Deserialize)]
pub struct SetPlanRequest { pub plan_id: String }

pub(crate) fn key(prefix: &[u8], value: &str) -> Vec<u8> { let mut out = prefix.to_vec(); out.extend_from_slice(value.as_bytes()); out }
fn member_key(org_id: &str, username: &str) -> Vec<u8> { key(MEMBER_PREFIX, &format!("{org_id}:{username}")) }
pub(crate) fn json_error(status: StatusCode, message: &str) -> Response { (status, Json(json!({ "error": message }))).into_response() }
pub(crate) fn load_json<T: for<'de> Deserialize<'de>>(db: &Db, k: &[u8]) -> Result<Option<T>, String> { let value = db.get(k).map_err(|e| format!("control-plane store read failed: {e}"))?; value.map(|bytes| serde_json::from_slice(&bytes).map_err(|e| format!("invalid stored state: {e}"))).transpose() }
pub(crate) fn save_json<T: Serialize>(db: &Db, k: &[u8], value: &T) -> Result<(), String> { let bytes = serde_json::to_vec(value).map_err(|e| format!("state serialization failed: {e}"))?; db.insert(k, bytes).map(|_| ()).map_err(|e| format!("control-plane store write failed: {e}")) }
pub(crate) fn is_member(db: &Db, org_id: &str, username: &str) -> Result<bool, String> { Ok(db.get(member_key(org_id, username)).map_err(|e| format!("membership read failed: {e}"))?.is_some()) }
pub(crate) fn plan(plan_id: &str) -> Option<&'static Plan> { PLANS.iter().find(|p| p.id == plan_id) }

pub fn router(control: ControlPlaneState, auth: AuthState, allowed_origins: CorsLayer) -> Router {
    let protected = Router::new()
        .route("/api/v1/me", get(me))
        .route("/api/v1/organizations", get(list_organizations).post(create_organization))
        .route("/api/v1/organizations/{id}", get(get_organization))
        .route("/api/v1/organizations/{id}/entitlements", get(billing_api::verified_entitlements))
        .route("/api/v1/organizations/{id}/subscription", get(subscription).post(set_subscription))
        .route("/api/v1/organizations/{id}/usage", get(usage))
        .route("/api/v1/organizations/{id}/usage/record", post(record_usage))
        .route("/api/v1/organizations/{id}/security/posture", get(operations_api::security_posture))
        .route("/api/v1/organizations/{id}/findings", get(operations_api::findings))
        .route("/api/v1/organizations/{id}/incidents", get(operations_api::incidents))
        .route("/api/v1/organizations/{id}/transactions", get(operations_api::transactions).post(operations_api::ingest_transaction))
        .route("/api/v1/organizations/{id}/aer-kep-q/status", get(operations_api::aer_kep_q_status))
        .route("/api/v1/organizations/{id}/members", get(enterprise_api::list_members))
        .route("/api/v1/organizations/{id}/members/{member}/role", post(enterprise_api::set_member_role))
        .route("/api/v1/organizations/{id}/invitations", get(enterprise_api::list_invitations).post(enterprise_api::create_invitation))
        .route("/api/v1/organizations/{id}/invitations/{invitation_id}", post(enterprise_api::revoke_invitation))
        .route("/api/v1/invitations/accept", post(enterprise_api::accept_invitation))
        .route("/api/v1/auth/webauthn/register/start", post(webauthn_api::registration_start))
        .route("/api/v1/auth/webauthn/register/finish", post(webauthn_api::registration_finish))
        .layer(middleware::from_fn_with_state(auth.sessions.clone(), auth_service::require_session));
    let public_service = Router::new().route("/api/v1/organizations/{id}/qcore/receipts", post(receipt_transport::ingest_receipt)).with_state(control.clone());
    let billing_public = Router::new().route("/api/v1/billing/webhook", post(billing_api::billing_webhook)).with_state(control.clone());
    let scim = Router::new()
        .route("/scim/v2.0/ServiceProviderConfig", get(enterprise_api::scim_service_provider_config))
        .route("/scim/v2.0/organizations/{id}/Users", get(enterprise_api::scim_list_users))
        .route("/scim/v2.0/organizations/{id}/Users/{external_id}", axum::routing::put(enterprise_api::scim_upsert_user).patch(enterprise_api::scim_upsert_user).delete(enterprise_api::scim_delete_user))
        .with_state(control.clone());
    let sso = Router::new()
        .route("/api/v1/auth/oidc/start", get(enterprise_sso::oidc_start))
        .route("/api/v1/auth/oidc/callback", get(enterprise_sso::oidc_callback))
        .route("/api/v1/auth/saml/metadata", get(enterprise_sso::saml_metadata))
        .route("/api/v1/auth/saml/acs", post(saml_service::saml_acs))
        .route("/api/v1/auth/webauthn/auth/start", post(webauthn_api::authentication_start))
        .route("/api/v1/auth/webauthn/auth/finish", post(webauthn_api::authentication_finish))
        .with_state(control.clone());
    Router::new()
        .merge(auth_router(auth.clone()))
        .merge(billing_public)
        .merge(public_service)
        .merge(scim)
        .merge(sso)
        .route("/api/v1/platform/health", get(health))
        .route("/api/v1/catalog/plans", get(catalog))
        .merge(protected.with_state(control))
        .layer(TraceLayer::new_for_http())
        .layer(allowed_origins)
        .layer(tower_http::request_id::PropagateRequestIdLayer::x_request_id())
}

async fn health() -> Json<Value> { Json(json!({ "service": "vardhan-control-plane", "status": "operational", "mode": "enterprise", "authentication": "server_enforced", "demo_authentication": false })) }
async fn catalog() -> Json<&'static [Plan]> { Json(PLANS) }
async fn me(Extension(user): Extension<AuthenticatedUser>) -> Json<Value> { Json(json!({ "username": user.username, "authenticated": true, "role": user.role.as_str() })) }
async fn create_organization(State(state): State<ControlPlaneState>, Extension(user): Extension<AuthenticatedUser>, Json(req): Json<CreateOrganizationRequest>) -> Response { let name=req.name.trim(); if name.len()<2||name.len()>120{return json_error(StatusCode::BAD_REQUEST,"Organization name must be 2-120 characters.");} let id=Uuid::new_v4().to_string(); let org=Organization{id:id.clone(),name:name.to_string(),owner:user.username.clone(),created_at_ms:std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d|d.as_millis()).unwrap_or_default()}; if let Err(e)=save_json(&state.db,&key(ORG_PREFIX,&id),&org){return json_error(StatusCode::INTERNAL_SERVER_ERROR,&e);} if let Err(e)=state.db.insert(member_key(&id,&user.username),b"owner"){return json_error(StatusCode::INTERNAL_SERVER_ERROR,&format!("membership write failed: {e}"));} let sub=Subscription{organization_id:id.clone(),plan_id:"foundation".into(),status:"provisioning".into(),provider:"unconfigured".into(),external_customer_id:None,external_subscription_id:None}; if let Err(e)=save_json(&state.db,&key(SUB_PREFIX,&id),&sub){return json_error(StatusCode::INTERNAL_SERVER_ERROR,&e);} (StatusCode::CREATED,Json(json!({"organization":org,"subscription":sub}))).into_response() }
async fn list_organizations(State(state): State<ControlPlaneState>, Extension(user): Extension<AuthenticatedUser>) -> impl IntoResponse { let mut organizations=Vec::new(); for item in state.db.scan_prefix(ORG_PREFIX){let Ok((_,value))=item else{continue};let Ok(org)=serde_json::from_slice::<Organization>(&value) else{continue};if is_member(&state.db,&org.id,&user.username).unwrap_or(false){organizations.push(org);}} Json(json!({"organizations":organizations})) }
async fn get_organization(State(state): State<ControlPlaneState>, Extension(user): Extension<AuthenticatedUser>, Path(id): Path<String>) -> impl IntoResponse { match load_json::<Organization>(&state.db,&key(ORG_PREFIX,&id)){Ok(Some(org)) if is_member(&state.db,&id,&user.username).unwrap_or(false)=>Json(json!({"organization":org})).into_response(),Ok(Some(_))=>json_error(StatusCode::FORBIDDEN,"Organization access denied."),Ok(None)=>json_error(StatusCode::NOT_FOUND,"Organization not found."),Err(e)=>json_error(StatusCode::INTERNAL_SERVER_ERROR,&e)} }
async fn subscription(State(state): State<ControlPlaneState>, Extension(user): Extension<AuthenticatedUser>, Path(id): Path<String>) -> impl IntoResponse { if !is_member(&state.db,&id,&user.username).unwrap_or(false){return json_error(StatusCode::FORBIDDEN,"Organization access denied.");} match load_json::<Subscription>(&state.db,&key(SUB_PREFIX,&id)){Ok(Some(sub))=>Json(json!({"subscription":sub})).into_response(),Ok(None)=>json_error(StatusCode::NOT_FOUND,"Subscription not found."),Err(e)=>json_error(StatusCode::INTERNAL_SERVER_ERROR,&e)} }
async fn set_subscription(State(state): State<ControlPlaneState>, Extension(user): Extension<AuthenticatedUser>, Path(id): Path<String>, Json(req): Json<SetPlanRequest>) -> impl IntoResponse { if !is_member(&state.db,&id,&user.username).unwrap_or(false){return json_error(StatusCode::FORBIDDEN,"Organization access denied.");} if plan(&req.plan_id).is_none(){return json_error(StatusCode::BAD_REQUEST,"Unknown plan.");} let Some(mut sub)=load_json::<Subscription>(&state.db,&key(SUB_PREFIX,&id)).unwrap_or(None) else{return json_error(StatusCode::NOT_FOUND,"Subscription not found.");}; sub.status="awaiting_billing_activation".into(); if let Err(e)=save_json(&state.db,&key(SUB_PREFIX,&id),&sub){return json_error(StatusCode::INTERNAL_SERVER_ERROR,&e);} (StatusCode::ACCEPTED,Json(json!({"subscription":sub,"requested_plan":req.plan_id,"activation":"pending_billing_verification"}))).into_response() }
async fn usage(State(state): State<ControlPlaneState>, Extension(user): Extension<AuthenticatedUser>, Path(id): Path<String>) -> impl IntoResponse { if !is_member(&state.db,&id,&user.username).unwrap_or(false){return json_error(StatusCode::FORBIDDEN,"Organization access denied.");} let usage=load_json::<Usage>(&state.db,&key(USAGE_PREFIX,&id)).unwrap_or(None).unwrap_or(Usage{organization_id:id,..Usage::default()}); Json(json!({"usage":usage})).into_response() }
#[derive(Debug,Deserialize)]struct RecordUsageRequest{pub bytes_processed:u64,pub transactions:u64}
async fn record_usage(State(state): State<ControlPlaneState>, Extension(user): Extension<AuthenticatedUser>, Path(id): Path<String>, Json(req): Json<RecordUsageRequest>) -> impl IntoResponse { if !is_member(&state.db,&id,&user.username).unwrap_or(false){return json_error(StatusCode::FORBIDDEN,"Organization access denied.");} let mut usage=load_json::<Usage>(&state.db,&key(USAGE_PREFIX,&id)).unwrap_or(None).unwrap_or(Usage{organization_id:id.clone(),..Usage::default()});usage.bytes_processed=usage.bytes_processed.saturating_add(req.bytes_processed);usage.transactions=usage.transactions.saturating_add(req.transactions);if let Err(e)=save_json(&state.db,&key(USAGE_PREFIX,&id),&usage){return json_error(StatusCode::INTERNAL_SERVER_ERROR,&e);}Json(json!({"usage":usage})).into_response()}
pub async fn serve(state: ControlPlaneState, auth: AuthState, addr: SocketAddr, cors: CorsLayer) -> Result<(), std::io::Error> { let app=router(state,auth,cors); let listener=tokio::net::TcpListener::bind(addr).await?; tracing::info!(%addr,"Vardhan enterprise control plane listening"); axum::serve(listener,app).await.map_err(std::io::Error::other) }
