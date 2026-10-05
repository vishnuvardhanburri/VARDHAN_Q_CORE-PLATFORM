use crate::{is_member, key, load_json, save_json, ControlPlaneState};
use axum::{extract::{Path, State}, http::{HeaderMap, StatusCode}, response::IntoResponse, Extension, Json};
use auth_service::AuthenticatedUser;
use blake3::Hasher;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const INVITE_PREFIX: &[u8] = b"invite:";
const SCIM_PREFIX: &[u8] = b"scim:user:";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Invitation {
    pub id: String,
    pub organization_id: String,
    pub email: String,
    pub role: String,
    pub token_hash: String,
    pub created_at_ms: u64,
    pub expires_at_ms: u64,
    pub accepted_at_ms: Option<u64>,
    pub revoked: bool,
}

#[derive(Debug, Deserialize)]
pub struct CreateInvitationRequest { pub email: String, pub role: Option<String>, pub expires_in_hours: Option<u64> }

#[derive(Debug, Deserialize)]
pub struct AcceptInvitationRequest { pub token: String }

#[derive(Debug, Deserialize)]
pub struct SetRoleRequest { pub role: String }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScimProvisionedUser {
    pub external_id: String,
    pub user_name: String,
    pub display_name: Option<String>,
    pub active: bool,
    pub role: String,
    pub updated_at_ms: u64,
}

#[derive(Debug, Deserialize)]
pub struct ScimUserRequest {
    pub external_id: Option<String>,
    pub user_name: Option<String>,
    pub display_name: Option<String>,
    pub active: Option<bool>,
}

fn now_ms() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or_default() }
fn hash_token(token: &str) -> String { let mut h = Hasher::new(); h.update(token.as_bytes()); h.finalize().to_hex().to_string() }
fn invitation_key(org: &str, id: &str) -> Vec<u8> { key(INVITE_PREFIX, &format!("{org}:{id}")) }
fn scim_key(org: &str, external_id: &str) -> Vec<u8> { key(SCIM_PREFIX, &format!("{org}:{external_id}")) }
fn bad(status: StatusCode, message: &str) -> axum::response::Response { (status, Json(json!({"error":message}))).into_response() }

fn role_allowed(role: &str) -> bool {
    matches!(role.trim().to_ascii_lowercase().as_str(), "owner" | "security_admin" | "auditor" | "operator" | "analyst" | "viewer")
}

fn org_role(state: &ControlPlaneState, org: &str, username: &str) -> Option<String> {
    state.db.get(crate::key(crate::MEMBER_PREFIX, &format!("{org}:{username}"))).ok().flatten()
        .and_then(|v| String::from_utf8(v.to_vec()).ok())
}

fn require_org_admin(state: &ControlPlaneState, org: &str, user: &AuthenticatedUser) -> Result<(), axum::response::Response> {
    if !is_member(&state.db, org, &user.username).unwrap_or(false) { return Err(bad(StatusCode::FORBIDDEN, "Organization access denied.")); }
    match org_role(state, org, &user.username).unwrap_or_default().as_str() {
        "owner" | "security_admin" => Ok(()),
        _ => Err(bad(StatusCode::FORBIDDEN, "Organization administration permission required.")),
    }
}

pub async fn list_members(State(state): State<ControlPlaneState>, Extension(user): Extension<AuthenticatedUser>, Path(org): Path<String>) -> impl IntoResponse {
    if !is_member(&state.db, &org, &user.username).unwrap_or(false) { return bad(StatusCode::FORBIDDEN, "Organization access denied."); }
    let prefix = format!("{}{}:", String::from_utf8_lossy(crate::MEMBER_PREFIX), org);
    let mut members = Vec::new();
    for item in state.db.scan_prefix(prefix.as_bytes()) {
        if let Ok((key_bytes, value)) = item {
            if let Ok(key_text) = String::from_utf8(key_bytes.to_vec()) {
                if let Some(username) = key_text.rsplit(':').next() {
                    members.push(json!({"username":username,"role":String::from_utf8_lossy(&value)}));
                }
            }
        }
    }
    Json(json!({"organization_id":org,"members":members})).into_response()
}

pub async fn set_member_role(State(state): State<ControlPlaneState>, Extension(user): Extension<AuthenticatedUser>, Path((org, member)): Path<(String,String)>, Json(req): Json<SetRoleRequest>) -> impl IntoResponse {
    if let Err(response) = require_org_admin(&state, &org, &user) { return response; }
    let role = req.role.trim().to_ascii_lowercase();
    if !role_allowed(&role) { return bad(StatusCode::BAD_REQUEST, "Unsupported organization role."); }
    if !is_member(&state.db, &org, &member).unwrap_or(false) { return bad(StatusCode::NOT_FOUND, "Member not found."); }
    if role != "owner" && org_role(&state, &org, &user.username).as_deref() == Some("owner") {
        if org_role(&state, &org, &member).as_deref() == Some("owner") { return bad(StatusCode::CONFLICT, "Owner role requires explicit ownership transfer."); }
    }
    if let Err(e) = state.db.insert(crate::key(crate::MEMBER_PREFIX, &format!("{org}:{member}")), role.as_bytes()) { return bad(StatusCode::INTERNAL_SERVER_ERROR, &format!("membership write failed: {e}")); }
    Json(json!({"status":"updated","username":member,"role":role})).into_response()
}

pub async fn create_invitation(State(state): State<ControlPlaneState>, Extension(user): Extension<AuthenticatedUser>, Path(org): Path<String>, Json(req): Json<CreateInvitationRequest>) -> impl IntoResponse {
    if let Err(response) = require_org_admin(&state, &org, &user) { return response; }
    let email = req.email.trim().to_ascii_lowercase();
    if !email.contains('@') || email.len() > 320 { return bad(StatusCode::BAD_REQUEST, "Valid invitation email required."); }
    let role = req.role.unwrap_or_else(|| "viewer".into()).trim().to_ascii_lowercase();
    if !role_allowed(&role) { return bad(StatusCode::BAD_REQUEST, "Unsupported invitation role."); }
    let now = now_ms();
    let expires = now.saturating_add(req.expires_in_hours.unwrap_or(72).clamp(1, 720) * 60 * 60 * 1000);
    let token = format!("vqi_{}", Uuid::new_v4());
    let invitation = Invitation { id: Uuid::new_v4().to_string(), organization_id: org.clone(), email, role, token_hash: hash_token(&token), created_at_ms: now, expires_at_ms: expires, accepted_at_ms: None, revoked: false };
    if let Err(e) = save_json(&state.db, &invitation_key(&org, &invitation.id), &invitation) { return bad(StatusCode::INTERNAL_SERVER_ERROR, &e); }
    Json(json!({"status":"created","invitation_id":invitation.id,"organization_id":org,"email":invitation.email,"role":invitation.role,"expires_at_ms":expires,"token":token})).into_response()
}

pub async fn list_invitations(State(state): State<ControlPlaneState>, Extension(user): Extension<AuthenticatedUser>, Path(org): Path<String>) -> impl IntoResponse {
    if let Err(response) = require_org_admin(&state, &org, &user) { return response; }
    let prefix = format!("{}{}:", String::from_utf8_lossy(INVITE_PREFIX), org);
    let mut items = Vec::new();
    for item in state.db.scan_prefix(prefix.as_bytes()) {
        if let Ok((_, value)) = item { if let Ok(mut invitation) = serde_json::from_slice::<Invitation>(&value) { invitation.token_hash.clear(); items.push(invitation); } }
    }
    Json(json!({"organization_id":org,"invitations":items})).into_response()
}

pub async fn revoke_invitation(State(state): State<ControlPlaneState>, Extension(user): Extension<AuthenticatedUser>, Path((org,id)): Path<(String,String)>) -> impl IntoResponse {
    if let Err(response) = require_org_admin(&state, &org, &user) { return response; }
    let Some(mut invitation) = load_json::<Invitation>(&state.db, &invitation_key(&org, &id)).unwrap_or(None) else { return bad(StatusCode::NOT_FOUND, "Invitation not found."); };
    invitation.revoked = true;
    if let Err(e) = save_json(&state.db, &invitation_key(&org, &id), &invitation) { return bad(StatusCode::INTERNAL_SERVER_ERROR, &e); }
    Json(json!({"status":"revoked","invitation_id":id})).into_response()
}

pub async fn accept_invitation(State(state): State<ControlPlaneState>, Extension(user): Extension<AuthenticatedUser>, Json(req): Json<AcceptInvitationRequest>) -> impl IntoResponse {
    let token_hash = hash_token(req.token.trim());
    let now = now_ms();
    let mut matched = None;
    for item in state.db.scan_prefix(INVITE_PREFIX) {
        if let Ok((key_bytes, value)) = item {
            if let Ok(invitation) = serde_json::from_slice::<Invitation>(&value) {
                if invitation.token_hash == token_hash { matched = Some((key_bytes, invitation)); break; }
            }
        }
    }
    let Some((key_bytes, mut invitation)) = matched else { return bad(StatusCode::NOT_FOUND, "Invitation token is invalid."); };
    if invitation.revoked || invitation.accepted_at_ms.is_some() || now >= invitation.expires_at_ms { return bad(StatusCode::CONFLICT, "Invitation is expired, revoked, or already accepted."); }
    if invitation.email != user.username.to_ascii_lowercase() { return bad(StatusCode::FORBIDDEN, "Invitation identity does not match the authenticated user."); }
    state.db.insert(crate::key(crate::MEMBER_PREFIX, &format!("{}:{}", invitation.organization_id, user.username)), invitation.role.as_bytes()).map_err(|e| e.to_string()).ok();
    invitation.accepted_at_ms = Some(now);
    if let Ok(bytes) = serde_json::to_vec(&invitation) { let _ = state.db.insert(key_bytes, bytes); }
    Json(json!({"status":"accepted","organization_id":invitation.organization_id,"role":invitation.role})).into_response()
}

fn scim_authorized(headers: &HeaderMap) -> bool {
    let Some(expected) = std::env::var("VARDHAN_SCIM_TOKEN_HASH").ok().filter(|v| !v.trim().is_empty()) else { return false; };
    let Some(value) = headers.get("authorization").and_then(|v| v.to_str().ok()) else { return false; };
    let Some(token) = value.strip_prefix("Bearer ") else { return false; };
    subtle::ConstantTimeEq::ct_eq(hash_token(token).as_bytes(), expected.trim().as_bytes()).into()
}

pub async fn scim_list_users(State(state): State<ControlPlaneState>, headers: HeaderMap, Path(org): Path<String>) -> impl IntoResponse {
    if !scim_authorized(&headers) { return bad(StatusCode::UNAUTHORIZED, "Invalid SCIM credentials."); }
    let prefix = format!("{}{}:", String::from_utf8_lossy(SCIM_PREFIX), org);
    let mut resources = Vec::new();
    for item in state.db.scan_prefix(prefix.as_bytes()) { if let Ok((_, value)) = item { if let Ok(u) = serde_json::from_slice::<ScimProvisionedUser>(&value) { resources.push(json!({"schemas":["urn:ietf:params:scim:schemas:core:2.0:User"],"id":u.external_id,"externalId":u.external_id,"userName":u.user_name,"displayName":u.display_name,"active":u.active})); } } }
    Json(json!({"schemas":["urn:ietf:params:scim:api:messages:2.0:ListResponse"],"totalResults":resources.len(),"Resources":resources})).into_response()
}

pub async fn scim_upsert_user(State(state): State<ControlPlaneState>, headers: HeaderMap, Path((org, external_id)): Path<(String,String)>, Json(req): Json<ScimUserRequest>) -> impl IntoResponse {
    if !scim_authorized(&headers) { return bad(StatusCode::UNAUTHORIZED, "Invalid SCIM credentials."); }
    let id = req.external_id.unwrap_or(external_id);
    let user_name = req.user_name.unwrap_or_else(|| id.clone()).trim().to_ascii_lowercase();
    if id.trim().is_empty() || user_name.trim().is_empty() { return bad(StatusCode::BAD_REQUEST, "SCIM externalId and userName are required."); }
    let now = now_ms();
    let current = load_json::<ScimProvisionedUser>(&state.db, &scim_key(&org, &id)).unwrap_or(None);
    let user = ScimProvisionedUser { external_id:id.clone(), user_name:user_name.clone(), display_name:req.display_name.or_else(|| current.as_ref().and_then(|u| u.display_name.clone())), active:req.active.unwrap_or_else(|| current.as_ref().map(|u|u.active).unwrap_or(true)), role:current.map(|u|u.role).unwrap_or_else(||"viewer".into()), updated_at_ms:now };
    if let Err(e) = save_json(&state.db, &scim_key(&org,&id), &user) { return bad(StatusCode::INTERNAL_SERVER_ERROR, &e); }
    if user.active { let _ = state.db.insert(crate::key(crate::MEMBER_PREFIX, &format!("{}:{}", org, user.user_name)), user.role.as_bytes()); }
    else { let _ = state.db.remove(crate::key(crate::MEMBER_PREFIX, &format!("{}:{}", org, user.user_name))); }
    (StatusCode::OK, Json(json!({"schemas":["urn:ietf:params:scim:schemas:core:2.0:User"],"id":user.external_id,"externalId":user.external_id,"userName":user.user_name,"displayName":user.display_name,"active":user.active}))).into_response()
}

pub async fn scim_delete_user(State(state): State<ControlPlaneState>, headers: HeaderMap, Path((org, external_id)): Path<(String,String)>) -> impl IntoResponse {
    if !scim_authorized(&headers) { return bad(StatusCode::UNAUTHORIZED, "Invalid SCIM credentials."); }
    let Some(mut user) = load_json::<ScimProvisionedUser>(&state.db, &scim_key(&org,&external_id)).unwrap_or(None) else { return bad(StatusCode::NOT_FOUND, "SCIM user not found."); };
    user.active = false; user.updated_at_ms = now_ms();
    let _ = save_json(&state.db, &scim_key(&org,&external_id), &user);
    let _ = state.db.remove(crate::key(crate::MEMBER_PREFIX, &format!("{}:{}", org, user.user_name)));
    StatusCode::NO_CONTENT.into_response()
}

pub async fn scim_service_provider_config(headers: HeaderMap) -> impl IntoResponse {
    if !scim_authorized(&headers) { return bad(StatusCode::UNAUTHORIZED, "Invalid SCIM credentials."); }
    Json(json!({"schemas":["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],"patch":{"supported":true},"bulk":{"supported":false},"filter":{"supported":true,"maxResults":100},"changePassword":{"supported":false},"sort":{"supported":false},"etag":{"supported":true},"authenticationSchemes":[{"type":"httpbasic","name":"Bearer","description":"Bearer token provisioned through deployment secret boundary"}]})).into_response()
}
