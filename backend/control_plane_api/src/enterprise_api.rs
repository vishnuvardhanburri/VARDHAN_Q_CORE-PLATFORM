use crate::{is_member, key, load_json, member_role, save_json, ControlPlaneState};
use auth_service::AuthenticatedUser;
use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Extension, Json,
};
use blake3::Hasher;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const INVITE_PREFIX: &[u8] = b"invite:";
const SCIM_PREFIX: &[u8] = b"scim:user:";
const SCIM_TOKEN_PREFIX: &[u8] = b"scim:token:";

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
pub struct CreateInvitationRequest {
    pub email: String,
    pub role: Option<String>,
    pub expires_in_hours: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub struct AcceptInvitationRequest {
    pub token: String,
}

#[derive(Debug, Deserialize)]
pub struct SetRoleRequest {
    pub role: String,
}

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
#[serde(rename_all = "camelCase")]
pub struct ScimUserRequest {
    pub external_id: Option<String>,
    pub user_name: Option<String>,
    pub display_name: Option<String>,
    pub active: Option<bool>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or_default()
}
fn hash_token(token: &str) -> String {
    let mut h = Hasher::new();
    h.update(token.as_bytes());
    h.finalize().to_hex().to_string()
}
fn invitation_key(org: &str, id: &str) -> Vec<u8> {
    key(INVITE_PREFIX, &format!("{org}:{id}"))
}
fn scim_key(org: &str, external_id: &str) -> Vec<u8> {
    key(SCIM_PREFIX, &format!("{org}:{external_id}"))
}
fn scim_token_key(org: &str) -> Vec<u8> {
    key(SCIM_TOKEN_PREFIX, org)
}
fn bad(status: StatusCode, message: &str) -> axum::response::Response {
    (status, Json(json!({"error":message}))).into_response()
}

fn role_allowed(role: &str) -> bool {
    matches!(
        role.trim().to_ascii_lowercase().as_str(),
        "owner" | "security_admin" | "auditor" | "operator" | "analyst" | "viewer"
    )
}

fn org_role(state: &ControlPlaneState, org: &str, username: &str) -> Option<String> {
    member_role(&state.db, org, username).ok().flatten()
}

#[allow(clippy::result_large_err)]
fn require_org_admin(
    state: &ControlPlaneState,
    org: &str,
    user: &AuthenticatedUser,
) -> Result<(), axum::response::Response> {
    if !is_member(&state.db, org, &user.username).unwrap_or(false) {
        return Err(bad(StatusCode::FORBIDDEN, "Organization access denied."));
    }
    match org_role(state, org, &user.username)
        .unwrap_or_default()
        .as_str()
    {
        "owner" | "security_admin" => Ok(()),
        _ => Err(bad(
            StatusCode::FORBIDDEN,
            "Organization administration permission required.",
        )),
    }
}

pub async fn list_members(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(org): Path<String>,
) -> impl IntoResponse {
    if !is_member(&state.db, &org, &user.username).unwrap_or(false) {
        return bad(StatusCode::FORBIDDEN, "Organization access denied.");
    }
    let prefix = format!("{}{}:", String::from_utf8_lossy(crate::MEMBER_PREFIX), org);
    let mut members = Vec::new();
    for (key_bytes, value) in state.db.scan_prefix(prefix.as_bytes()).flatten() {
        if let Ok(key_text) = String::from_utf8(key_bytes.to_vec()) {
            if let Some(username) = key_text.rsplit(':').next() {
                members.push(json!({"username":username,"role":String::from_utf8_lossy(&value)}));
            }
        }
    }
    Json(json!({"organization_id":org,"members":members})).into_response()
}

pub async fn set_member_role(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path((org, member)): Path<(String, String)>,
    Json(req): Json<SetRoleRequest>,
) -> impl IntoResponse {
    if let Err(response) = require_org_admin(&state, &org, &user) {
        return response;
    }
    let role = req.role.trim().to_ascii_lowercase();
    if !role_allowed(&role) {
        return bad(StatusCode::BAD_REQUEST, "Unsupported organization role.");
    }
    if !is_member(&state.db, &org, &member).unwrap_or(false) {
        return bad(StatusCode::NOT_FOUND, "Member not found.");
    }
    if role == "owner" || org_role(&state, &org, &member).as_deref() == Some("owner") {
        return bad(
            StatusCode::CONFLICT,
            "Owner role requires explicit ownership transfer.",
        );
    }
    if let Err(e) = state.db.insert(
        crate::key(crate::MEMBER_PREFIX, &format!("{org}:{member}")),
        role.as_bytes(),
    ) {
        return bad(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("membership write failed: {e}"),
        );
    }
    Json(json!({"status":"updated","username":member,"role":role})).into_response()
}

pub async fn create_invitation(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(org): Path<String>,
    Json(req): Json<CreateInvitationRequest>,
) -> impl IntoResponse {
    if let Err(response) = require_org_admin(&state, &org, &user) {
        return response;
    }
    let email = req.email.trim().to_ascii_lowercase();
    if !email.contains('@') || email.len() > 320 {
        return bad(StatusCode::BAD_REQUEST, "Valid invitation email required.");
    }
    let role = req
        .role
        .unwrap_or_else(|| "viewer".into())
        .trim()
        .to_ascii_lowercase();
    if !role_allowed(&role) {
        return bad(StatusCode::BAD_REQUEST, "Unsupported invitation role.");
    }
    if role == "owner" {
        return bad(
            StatusCode::CONFLICT,
            "Owner role requires explicit ownership transfer.",
        );
    }
    let now = now_ms();
    // An outstanding invitation is an authority grant.  Do not mint multiple
    // active grants for the same identity in the same organization.
    let prefix = format!("{}{}:", String::from_utf8_lossy(INVITE_PREFIX), org);
    for (_, value) in state.db.scan_prefix(prefix.as_bytes()).flatten() {
        if let Ok(existing) = serde_json::from_slice::<Invitation>(&value) {
            if existing.email == email
                && !existing.revoked
                && existing.accepted_at_ms.is_none()
                && now < existing.expires_at_ms
            {
                return bad(
                    StatusCode::CONFLICT,
                    "An active invitation already exists for this identity.",
                );
            }
        }
    }
    let expires =
        now.saturating_add(req.expires_in_hours.unwrap_or(72).clamp(1, 720) * 60 * 60 * 1000);
    let token = format!("vqi_{}", Uuid::new_v4());
    let invitation = Invitation {
        id: Uuid::new_v4().to_string(),
        organization_id: org.clone(),
        email,
        role,
        token_hash: hash_token(&token),
        created_at_ms: now,
        expires_at_ms: expires,
        accepted_at_ms: None,
        revoked: false,
    };
    if let Err(e) = save_json(
        &state.db,
        &invitation_key(&org, &invitation.id),
        &invitation,
    ) {
        return bad(StatusCode::INTERNAL_SERVER_ERROR, &e);
    }
    Json(json!({"status":"created","invitation_id":invitation.id,"organization_id":org,"email":invitation.email,"role":invitation.role,"expires_at_ms":expires,"token":token})).into_response()
}

pub async fn list_invitations(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(org): Path<String>,
) -> impl IntoResponse {
    if let Err(response) = require_org_admin(&state, &org, &user) {
        return response;
    }
    let prefix = format!("{}{}:", String::from_utf8_lossy(INVITE_PREFIX), org);
    let mut items = Vec::new();
    for (_, value) in state.db.scan_prefix(prefix.as_bytes()).flatten() {
        if let Ok(mut invitation) = serde_json::from_slice::<Invitation>(&value) {
            invitation.token_hash.clear();
            items.push(invitation);
        }
    }
    Json(json!({"organization_id":org,"invitations":items})).into_response()
}

pub async fn revoke_invitation(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path((org, id)): Path<(String, String)>,
) -> impl IntoResponse {
    if let Err(response) = require_org_admin(&state, &org, &user) {
        return response;
    }
    let Some(mut invitation) =
        load_json::<Invitation>(&state.db, &invitation_key(&org, &id)).unwrap_or(None)
    else {
        return bad(StatusCode::NOT_FOUND, "Invitation not found.");
    };
    invitation.revoked = true;
    if let Err(e) = save_json(&state.db, &invitation_key(&org, &id), &invitation) {
        return bad(StatusCode::INTERNAL_SERVER_ERROR, &e);
    }
    Json(json!({"status":"revoked","invitation_id":id})).into_response()
}

pub async fn accept_invitation(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Json(req): Json<AcceptInvitationRequest>,
) -> impl IntoResponse {
    let token_hash = hash_token(req.token.trim());
    let now = now_ms();
    let mut matched = None;
    for (key_bytes, value) in state.db.scan_prefix(INVITE_PREFIX).flatten() {
        if let Ok(invitation) = serde_json::from_slice::<Invitation>(&value) {
            if subtle::ConstantTimeEq::ct_eq(
                invitation.token_hash.as_bytes(),
                token_hash.as_bytes(),
            )
            .into()
            {
                matched = Some((key_bytes, value.to_vec(), invitation));
                break;
            }
        }
    }
    let Some((key_bytes, original_bytes, mut invitation)) = matched else {
        return bad(StatusCode::NOT_FOUND, "Invitation token is invalid.");
    };
    if invitation.revoked || invitation.accepted_at_ms.is_some() || now >= invitation.expires_at_ms
    {
        return bad(
            StatusCode::CONFLICT,
            "Invitation is expired, revoked, or already accepted.",
        );
    }
    if invitation.email != user.username.to_ascii_lowercase() {
        return bad(
            StatusCode::FORBIDDEN,
            "Invitation identity does not match the authenticated user.",
        );
    }
    invitation.accepted_at_ms = Some(now);
    let Ok(updated_bytes) = serde_json::to_vec(&invitation) else {
        return bad(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Invitation state serialization failed.",
        );
    };
    // Exactly one acceptor may consume a token, including across concurrent
    // control-plane requests.  A stale write is a conflict, never a retry.
    match state
        .db
        .compare_and_swap(&key_bytes, Some(original_bytes), Some(updated_bytes))
    {
        Ok(Ok(())) => {}
        Ok(Err(_)) => {
            return bad(
                StatusCode::CONFLICT,
                "Invitation is expired, revoked, or already accepted.",
            )
        }
        Err(_) => {
            return bad(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Invitation state persistence failed.",
            )
        }
    }
    if state
        .db
        .insert(
            crate::key(
                crate::MEMBER_PREFIX,
                &format!("{}:{}", invitation.organization_id, user.username),
            ),
            invitation.role.as_bytes(),
        )
        .is_err()
    {
        return bad(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Membership persistence failed.",
        );
    }
    Json(json!({"status":"accepted","organization_id":invitation.organization_id,"role":invitation.role})).into_response()
}

/// Stores only a digest and binds it to exactly one organization.  Deployment
/// tooling must call this when configuring a SCIM directory connection.
pub fn set_scim_token_hash(
    state: &ControlPlaneState,
    org: &str,
    token_hash: &str,
) -> Result<(), String> {
    if load_json::<crate::Organization>(&state.db, &key(crate::ORG_PREFIX, org))
        .map_err(|e| e.to_string())?
        .is_none()
    {
        return Err("organization does not exist".into());
    }
    if token_hash.trim().len() != 64 || !token_hash.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("SCIM token digest must be a BLAKE3 hex digest".into());
    }
    state
        .db
        .insert(scim_token_key(org), token_hash.trim().as_bytes())
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn scim_authorized(state: &ControlPlaneState, headers: &HeaderMap, org: &str) -> bool {
    // Production credentials are persisted per organization.  The environment
    // compatibility path is deliberately also organization-bound, never global.
    let expected = state
        .db
        .get(scim_token_key(org))
        .ok()
        .flatten()
        .and_then(|value| String::from_utf8(value.to_vec()).ok())
        .or_else(|| match std::env::var("VARDHAN_SCIM_ORGANIZATION") {
            Ok(configured_org) if configured_org == org => {
                std::env::var("VARDHAN_SCIM_TOKEN_HASH").ok()
            }
            _ => None,
        });
    let Some(expected) = expected.filter(|v| !v.trim().is_empty()) else {
        return false;
    };
    let Some(value) = headers.get("authorization").and_then(|v| v.to_str().ok()) else {
        return false;
    };
    let Some(token) = value.strip_prefix("Bearer ") else {
        return false;
    };
    subtle::ConstantTimeEq::ct_eq(hash_token(token).as_bytes(), expected.trim().as_bytes()).into()
}

#[derive(Debug, Deserialize, Default)]
pub struct ScimListQuery {
    pub start_index: Option<usize>,
    pub count: Option<usize>,
    pub filter: Option<String>,
}

fn scim_org_exists(state: &ControlPlaneState, org: &str) -> bool {
    load_json::<crate::Organization>(&state.db, &key(crate::ORG_PREFIX, org))
        .ok()
        .flatten()
        .is_some()
}

pub async fn scim_list_users(
    State(state): State<ControlPlaneState>,
    headers: HeaderMap,
    Path(org): Path<String>,
    Query(query): Query<ScimListQuery>,
) -> impl IntoResponse {
    // Authenticate before disclosing org existence: an unauthenticated probe
    // must not learn whether an organization id is valid (enumeration).
    if !scim_authorized(&state, &headers, &org) {
        return bad(StatusCode::UNAUTHORIZED, "Invalid SCIM credentials.");
    }
    if !scim_org_exists(&state, &org) {
        return bad(StatusCode::NOT_FOUND, "Organization not found.");
    }
    let prefix = format!("{}{}:", String::from_utf8_lossy(SCIM_PREFIX), org);
    let mut resources = Vec::new();
    for (_, value) in state.db.scan_prefix(prefix.as_bytes()).flatten() {
        if let Ok(u) = serde_json::from_slice::<ScimProvisionedUser>(&value) {
            resources.push(json!({"schemas":["urn:ietf:params:scim:schemas:core:2.0:User"],"id":u.external_id,"externalId":u.external_id,"userName":u.user_name,"displayName":u.display_name,"active":u.active}));
        }
    }
    if let Some(filter) = query.filter.as_deref() {
        let expected = filter
            .trim()
            .strip_prefix("userName eq ")
            .and_then(|value| value.trim().strip_prefix('"'))
            .and_then(|value| value.strip_suffix('"'));
        let Some(expected) = expected else {
            return bad(
                StatusCode::BAD_REQUEST,
                "Only userName eq \"value\" SCIM filters are supported.",
            );
        };
        resources.retain(|resource| {
            resource.get("userName").and_then(|value| value.as_str()) == Some(expected)
        });
    }
    resources.sort_by(|left, right| left["id"].as_str().cmp(&right["id"].as_str()));
    let total = resources.len();
    let start = query.start_index.unwrap_or(1).saturating_sub(1);
    let count = query.count.unwrap_or(100).clamp(1, 100);
    let resources: Vec<_> = resources.into_iter().skip(start).take(count).collect();
    Json(json!({"schemas":["urn:ietf:params:scim:api:messages:2.0:ListResponse"],"totalResults":total,"startIndex":start + 1,"itemsPerPage":resources.len(),"Resources":resources})).into_response()
}

pub async fn scim_upsert_user(
    State(state): State<ControlPlaneState>,
    headers: HeaderMap,
    Path((org, external_id)): Path<(String, String)>,
    Json(req): Json<ScimUserRequest>,
) -> impl IntoResponse {
    // Authenticate before disclosing org existence (enumeration resistance).
    if !scim_authorized(&state, &headers, &org) {
        return bad(StatusCode::UNAUTHORIZED, "Invalid SCIM credentials.");
    }
    if !scim_org_exists(&state, &org) {
        return bad(StatusCode::NOT_FOUND, "Organization not found.");
    }
    if req
        .external_id
        .as_deref()
        .is_some_and(|id| id != external_id)
    {
        return bad(
            StatusCode::BAD_REQUEST,
            "SCIM externalId must match the resource path.",
        );
    }
    let id = external_id;
    let current = load_json::<ScimProvisionedUser>(&state.db, &scim_key(&org, &id)).unwrap_or(None);
    let user_name = req
        .user_name
        .or_else(|| current.as_ref().map(|user| user.user_name.clone()))
        .unwrap_or_else(|| id.clone())
        .trim()
        .to_ascii_lowercase();
    if id.trim().is_empty() || user_name.trim().is_empty() {
        return bad(
            StatusCode::BAD_REQUEST,
            "SCIM externalId and userName are required.",
        );
    }
    let now = now_ms();
    let user = ScimProvisionedUser {
        external_id: id.clone(),
        user_name: user_name.clone(),
        display_name: req
            .display_name
            .or_else(|| current.as_ref().and_then(|u| u.display_name.clone())),
        active: req
            .active
            .unwrap_or_else(|| current.as_ref().map(|u| u.active).unwrap_or(true)),
        role: current
            .as_ref()
            .map(|u| u.role.clone())
            .unwrap_or_else(|| "viewer".into()),
        updated_at_ms: now,
    };
    if let Err(e) = save_json(&state.db, &scim_key(&org, &id), &user) {
        return bad(StatusCode::INTERNAL_SERVER_ERROR, &e);
    }
    if let Some(previous) = current
        .as_ref()
        .filter(|previous| previous.user_name != user.user_name)
    {
        let _ = state.db.remove(crate::key(
            crate::MEMBER_PREFIX,
            &format!("{}:{}", org, previous.user_name),
        ));
    }
    if user.active {
        let _ = state.db.insert(
            crate::key(crate::MEMBER_PREFIX, &format!("{}:{}", org, user.user_name)),
            user.role.as_bytes(),
        );
    } else {
        let _ = state.db.remove(crate::key(
            crate::MEMBER_PREFIX,
            &format!("{}:{}", org, user.user_name),
        ));
    }
    (StatusCode::OK, Json(json!({"schemas":["urn:ietf:params:scim:schemas:core:2.0:User"],"id":user.external_id,"externalId":user.external_id,"userName":user.user_name,"displayName":user.display_name,"active":user.active}))).into_response()
}

pub async fn scim_delete_user(
    State(state): State<ControlPlaneState>,
    headers: HeaderMap,
    Path((org, external_id)): Path<(String, String)>,
) -> impl IntoResponse {
    // Authenticate before disclosing org existence (enumeration resistance).
    if !scim_authorized(&state, &headers, &org) {
        return bad(StatusCode::UNAUTHORIZED, "Invalid SCIM credentials.");
    }
    if !scim_org_exists(&state, &org) {
        return bad(StatusCode::NOT_FOUND, "Organization not found.");
    }
    let Some(mut user) =
        load_json::<ScimProvisionedUser>(&state.db, &scim_key(&org, &external_id)).unwrap_or(None)
    else {
        return bad(StatusCode::NOT_FOUND, "SCIM user not found.");
    };
    user.active = false;
    user.updated_at_ms = now_ms();
    let _ = save_json(&state.db, &scim_key(&org, &external_id), &user);
    let _ = state.db.remove(crate::key(
        crate::MEMBER_PREFIX,
        &format!("{}:{}", org, user.user_name),
    ));
    StatusCode::NO_CONTENT.into_response()
}

pub async fn scim_service_provider_config(headers: HeaderMap) -> impl IntoResponse {
    // This capability document carries no organization data.  It remains
    // separately authenticated by the deployment token; all data-bearing
    // endpoints additionally require an organization-bound token.
    let Some(expected) = std::env::var("VARDHAN_SCIM_TOKEN_HASH")
        .ok()
        .filter(|v| !v.trim().is_empty())
    else {
        return bad(StatusCode::UNAUTHORIZED, "Invalid SCIM credentials.");
    };
    let Some(token) = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
    else {
        return bad(StatusCode::UNAUTHORIZED, "Invalid SCIM credentials.");
    };
    if !bool::from(subtle::ConstantTimeEq::ct_eq(
        hash_token(token).as_bytes(),
        expected.trim().as_bytes(),
    )) {
        return bad(StatusCode::UNAUTHORIZED, "Invalid SCIM credentials.");
    }
    Json(json!({"schemas":["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],"patch":{"supported":true},"bulk":{"supported":false},"filter":{"supported":true,"maxResults":100},"changePassword":{"supported":false},"sort":{"supported":false},"etag":{"supported":true},"authenticationSchemes":[{"type":"httpbasic","name":"Bearer","description":"Bearer token provisioned through deployment secret boundary"}]})).into_response()
}

pub async fn delete_organization(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(org): Path<String>,
) -> impl IntoResponse {
    let org_obj = match crate::load_json::<crate::Organization>(
        &state.db,
        &crate::key(crate::ORG_PREFIX, &org),
    ) {
        Ok(Some(o)) => o,
        _ => return bad(StatusCode::NOT_FOUND, "Organization not found."),
    };

    // Only organization owner or platform admin can delete an organization
    let is_owner = org_role(&state, &org, &user.username).as_deref() == Some("owner")
        || org_obj.owner == user.username;
    if !is_owner && user.role != auth_service::authorization::Role::Admin {
        return bad(
            StatusCode::FORBIDDEN,
            "Only the organization owner or platform admin can delete an organization.",
        );
    }

    // Cascade deletion across sled db
    let delete_prefixes: Vec<Vec<u8>> = vec![
        format!("{}{}:", String::from_utf8_lossy(crate::MEMBER_PREFIX), org).into_bytes(),
        format!("{}{}:", String::from_utf8_lossy(INVITE_PREFIX), org).into_bytes(),
        format!("{}{}:", String::from_utf8_lossy(SCIM_PREFIX), org).into_bytes(),
        format!("org_webhook:{}:", org).into_bytes(),
        format!("org_webhook_log:{}:", org).into_bytes(),
        format!("passport:{}:", org).into_bytes(),
        format!("security:policy-baseline:{}:", org).into_bytes(),
        format!("security:policy-obs:{}:", org).into_bytes(),
        format!("security:policy-drift:{}:", org).into_bytes(),
        format!("security:remediation:{}:", org).into_bytes(),
        format!("security:alert:{}:", org).into_bytes(),
    ];

    for prefix in delete_prefixes {
        for (k, _) in state.db.scan_prefix(&prefix).flatten() {
            let _ = state.db.remove(k);
        }
    }

    // Delete single-key records
    let _ = state.db.remove(scim_token_key(&org));
    let _ = state.db.remove(crate::key(b"sub:", &org));
    let _ = state.db.remove(crate::key(b"billing:verified:", &org));
    let _ = state.db.remove(crate::key(b"lic:", &org));
    let _ = state.db.remove(crate::key(crate::ORG_PREFIX, &org));
    let _ = state.db.flush();

    StatusCode::NO_CONTENT.into_response()
}

pub async fn delete_member(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path((org, member)): Path<(String, String)>,
) -> impl IntoResponse {
    if let Err(response) = require_org_admin(&state, &org, &user) {
        return response;
    }

    if !is_member(&state.db, &org, &member).unwrap_or(false) {
        return bad(StatusCode::NOT_FOUND, "Member not found.");
    }

    // Prevent deleting the sole owner
    if org_role(&state, &org, &member).as_deref() == Some("owner") {
        let owner_count = count_owners(&state, &org);
        if owner_count <= 1 {
            return bad(
                StatusCode::BAD_REQUEST,
                "Cannot delete the sole owner of an organization. Transfer ownership first.",
            );
        }
    }

    let member_key = crate::key(crate::MEMBER_PREFIX, &format!("{}:{}", org, member));
    let _ = state.db.remove(member_key);
    let _ = state.db.flush();
    StatusCode::NO_CONTENT.into_response()
}

pub async fn leave_organization(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(org): Path<String>,
) -> impl IntoResponse {
    if !is_member(&state.db, &org, &user.username).unwrap_or(false) {
        return bad(StatusCode::NOT_FOUND, "Not a member of this organization.");
    }

    // Prevent sole owner from abandoning organization
    if org_role(&state, &org, &user.username).as_deref() == Some("owner") {
        let owner_count = count_owners(&state, &org);
        if owner_count <= 1 {
            return bad(
                StatusCode::BAD_REQUEST,
                "The sole owner cannot leave without transferring ownership or deleting the organization.",
            );
        }
    }

    let member_key = crate::key(crate::MEMBER_PREFIX, &format!("{}:{}", org, user.username));
    let _ = state.db.remove(member_key);
    let _ = state.db.flush();
    (
        StatusCode::OK,
        Json(json!({ "left": true, "organization_id": org })),
    )
        .into_response()
}

fn count_owners(state: &ControlPlaneState, org: &str) -> usize {
    let prefix = format!("{}{}:", String::from_utf8_lossy(crate::MEMBER_PREFIX), org);
    let mut count = 0;
    for (_, value) in state.db.scan_prefix(prefix.as_bytes()).flatten() {
        if String::from_utf8_lossy(&value) == "owner" {
            count += 1;
        }
    }
    count
}
