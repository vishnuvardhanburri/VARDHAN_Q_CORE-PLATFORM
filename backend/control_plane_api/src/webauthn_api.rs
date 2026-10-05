use axum::{extract::State, http::StatusCode, response::IntoResponse, Extension, Json};
use serde::{Deserialize, Serialize};
use serde_json::json;
use url::Url;
use uuid::Uuid;
use webauthn_rs::prelude::*;
use crate::ControlPlaneState;
use auth_service::middleware::AuthenticatedUser;

const REG_PREFIX: &[u8] = b"webauthn:registration:";
const AUTH_PREFIX: &[u8] = b"webauthn:authentication:";
const PASSKEY_PREFIX: &[u8] = b"webauthn:passkeys:";
const TTL_MS: u64 = 300_000;

#[derive(Debug, Deserialize)]
pub struct UsernameRequest { pub username: String }
#[derive(Debug, Serialize)]
struct StoredRegistration { username: String, state: PasskeyRegistration, expires_at_ms: u64 }
#[derive(Debug, Serialize, Deserialize)]
struct StoredAuthentication { username: String, state: PasskeyAuthentication, expires_at_ms: u64 }

fn key(prefix: &[u8], id: &str) -> Vec<u8> { let mut k=prefix.to_vec(); k.extend_from_slice(id.as_bytes()); k }
fn now_ms() -> u64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or_default() }
fn webauthn() -> Result<Webauthn, String> {
    let rp_id=std::env::var("VARDHAN_WEBAUTHN_RP_ID").map_err(|_|"VARDHAN_WEBAUTHN_RP_ID is not configured".to_string())?;
    let origin=std::env::var("VARDHAN_WEBAUTHN_ORIGIN").map_err(|_|"VARDHAN_WEBAUTHN_ORIGIN is not configured".to_string())?;
    let url=Url::parse(&origin).map_err(|_|"VARDHAN_WEBAUTHN_ORIGIN is invalid".to_string())?;
    if url.scheme()!="https" && std::env::var("VARDHAN_WEBAUTHN_ALLOW_INSECURE_DEV").as_deref()!=Ok("true") { return Err("WebAuthn origin must use HTTPS".into()); }
    WebauthnBuilder::new(&rp_id, &url).map_err(|e|e.to_string())?.build().map_err(|e|e.to_string())
}

pub async fn registration_start(State(state): State<ControlPlaneState>, Extension(user): Extension<AuthenticatedUser>) -> impl IntoResponse {
    let webauthn=match webauthn(){Ok(v)=>v,Err(e)=>return (StatusCode::SERVICE_UNAVAILABLE,Json(json!({"error":e}))).into_response()};
    let username=user.username.clone();
    let user_id=Uuid::new_v5(&Uuid::NAMESPACE_URL,username.as_bytes());
    let existing:Vec<Passkey>=state.db.get(key(PASSKEY_PREFIX,&username)).ok().flatten().and_then(|v|serde_json::from_slice(&v).ok()).unwrap_or_default();
    let exclude=if existing.is_empty(){None}else{Some(existing.iter().map(|p|p.cred_id().clone()).collect())};
    let (challenge,registration)=match webauthn.start_passkey_registration(user_id,&username,&username,exclude){Ok(v)=>v,Err(e)=>return (StatusCode::BAD_REQUEST,Json(json!({"error":e.to_string()}))).into_response()};
    let id=Uuid::new_v4().to_string();
    let stored=StoredRegistration{username,state:registration,expires_at_ms:now_ms()+TTL_MS};
    let bytes=match serde_json::to_vec(&stored){Ok(v)=>v,Err(_)=>return (StatusCode::INTERNAL_SERVER_ERROR,Json(json!({"error":"WebAuthn state serialization failed"}))).into_response()};
    if state.db.insert(key(REG_PREFIX,&id),bytes).is_err(){return (StatusCode::INTERNAL_SERVER_ERROR,Json(json!({"error":"WebAuthn state persistence failed"}))).into_response();}
    Json(json!({"challenge_id":id,"public_key":challenge})).into_response()
}

pub async fn registration_finish(State(state): State<ControlPlaneState>, Extension(user): Extension<AuthenticatedUser>, Json(payload): Json<serde_json::Value>) -> impl IntoResponse {
    let id=payload.get("challenge_id").and_then(|v|v.as_str()).unwrap_or("");
    let credential=payload.get("credential").cloned().unwrap_or(serde_json::Value::Null);
    let Some(bytes)=state.db.remove(key(REG_PREFIX,id)).ok().flatten() else{return (StatusCode::BAD_REQUEST,Json(json!({"error":"WebAuthn registration challenge is unknown or already consumed"}))).into_response()};
    let stored:StoredRegistration=match serde_json::from_slice(&bytes){Ok(v)=>v,Err(_)=>return (StatusCode::BAD_REQUEST,Json(json!({"error":"WebAuthn registration state is invalid"}))).into_response()};
    if stored.username!=user.username||now_ms()>=stored.expires_at_ms{return (StatusCode::UNAUTHORIZED,Json(json!({"error":"WebAuthn registration state expired or identity mismatch"}))).into_response()};
    let reg:RegisterPublicKeyCredential=match serde_json::from_value(credential){Ok(v)=>v,Err(_)=>return (StatusCode::BAD_REQUEST,Json(json!({"error":"Invalid WebAuthn registration credential"}))).into_response()};
    let webauthn=match webauthn(){Ok(v)=>v,Err(e)=>return (StatusCode::SERVICE_UNAVAILABLE,Json(json!({"error":e}))).into_response()};
    let passkey=match webauthn.finish_passkey_registration(&reg,&stored.state){Ok(v)=>v,Err(e)=>return (StatusCode::UNAUTHORIZED,Json(json!({"error":e.to_string()}))).into_response()};
    let mut passkeys:Vec<Passkey>=state.db.get(key(PASSKEY_PREFIX,&user.username)).ok().flatten().and_then(|v|serde_json::from_slice(&v).ok()).unwrap_or_default();
    if passkeys.iter().any(|p|p.cred_id()==passkey.cred_id()){return (StatusCode::CONFLICT,Json(json!({"error":"Credential is already registered"}))).into_response()};
    passkeys.push(passkey);
    let _=state.db.insert(key(PASSKEY_PREFIX,&user.username),serde_json::to_vec(&passkeys).unwrap());
    Json(json!({"status":"registered"})).into_response()
}

pub async fn authentication_start(State(state): State<ControlPlaneState>, Json(req): Json<UsernameRequest>) -> impl IntoResponse {
    let username=req.username.trim().to_string();
    let passkeys:Vec<Passkey>=state.db.get(key(PASSKEY_PREFIX,&username)).ok().flatten().and_then(|v|serde_json::from_slice(&v).ok()).unwrap_or_default();
    if passkeys.is_empty(){return (StatusCode::NOT_FOUND,Json(json!({"error":"No passkey is enrolled for this identity"}))).into_response()};
    let webauthn=match webauthn(){Ok(v)=>v,Err(e)=>return (StatusCode::SERVICE_UNAVAILABLE,Json(json!({"error":e}))).into_response()};
    let (challenge,auth_state)=match webauthn.start_passkey_authentication(&passkeys){Ok(v)=>v,Err(e)=>return (StatusCode::BAD_REQUEST,Json(json!({"error":e.to_string()}))).into_response()};
    let id=Uuid::new_v4().to_string();
    let stored=StoredAuthentication{username,state:auth_state,expires_at_ms:now_ms()+TTL_MS};
    if state.db.insert(key(AUTH_PREFIX,&id),serde_json::to_vec(&stored).unwrap()).is_err(){return (StatusCode::INTERNAL_SERVER_ERROR,Json(json!({"error":"WebAuthn authentication state persistence failed"}))).into_response()};
    Json(json!({"challenge_id":id,"public_key":challenge})).into_response()
}

pub async fn authentication_finish(State(state): State<ControlPlaneState>, Json(payload): Json<serde_json::Value>) -> impl IntoResponse {
    let id=payload.get("challenge_id").and_then(|v|v.as_str()).unwrap_or("");
    let credential=payload.get("credential").cloned().unwrap_or(serde_json::Value::Null);
    let Some(bytes)=state.db.remove(key(AUTH_PREFIX,id)).ok().flatten() else{return (StatusCode::BAD_REQUEST,Json(json!({"error":"WebAuthn authentication challenge is unknown or already consumed"}))).into_response()};
    let stored:StoredAuthentication=match serde_json::from_slice(&bytes){Ok(v)=>v,Err(_)=>return (StatusCode::BAD_REQUEST,Json(json!({"error":"WebAuthn authentication state is invalid"}))).into_response()};
    if now_ms()>=stored.expires_at_ms{return (StatusCode::UNAUTHORIZED,Json(json!({"error":"WebAuthn authentication state expired"}))).into_response()};
    let credential:PublicKeyCredential=match serde_json::from_value(credential){Ok(v)=>v,Err(_)=>return (StatusCode::BAD_REQUEST,Json(json!({"error":"Invalid WebAuthn authentication credential"}))).into_response()};
    let webauthn=match webauthn(){Ok(v)=>v,Err(e)=>return (StatusCode::SERVICE_UNAVAILABLE,Json(json!({"error":e}))).into_response()};
    match webauthn.finish_passkey_authentication(&credential,&stored.state){Ok(result)=>{let token=state.auth.sessions.create_with_node(&stored.username,"0.0.0.0".parse().unwrap(),state.auth.node_id.as_deref().unwrap_or("control-plane")).await;Json(json!({"status":"authenticated","token":token.as_str(),"expires_in":8*60*60,"verified":true,"counter":result.counter})).into_response()},Err(e)=>(StatusCode::UNAUTHORIZED,Json(json!({"error":e.to_string()}))).into_response()}
}
