//! Enterprise SSO boundary.

use crate::{is_member, ControlPlaneState};
use auth_service::AdminProfile;
use axum::{
    extract::{Form, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Redirect},
    Json,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};

const OIDC_STATE_PREFIX: &[u8] = b"oidc:state:";
const FLOW_TTL_MS: u64 = 300_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct OidcStateRecord {
    state: String,
    nonce: String,
    pkce_verifier: String,
    issuer: String,
    client_id: String,
    redirect_uri: String,
    expires_at_ms: u64,
}
#[derive(Debug, Deserialize)]
pub struct OidcCallback {
    pub code: String,
    pub state: String,
    pub iss: Option<String>,
}
#[derive(Debug, Deserialize)]
struct Discovery {
    authorization_endpoint: String,
    token_endpoint: String,
    jwks_uri: String,
    issuer: String,
}
#[derive(Debug, Deserialize)]
struct TokenResponse {
    id_token: String,
    access_token: Option<String>,
    token_type: Option<String>,
}
#[derive(Debug, Deserialize)]
struct Jwks {
    keys: Vec<Jwk>,
}
#[derive(Debug, Deserialize)]
struct Jwk {
    kid: Option<String>,
    kty: String,
    alg: Option<String>,
    n: Option<String>,
    e: Option<String>,
    crv: Option<String>,
    x: Option<String>,
    y: Option<String>,
}
#[derive(Debug, Deserialize)]
struct IdClaims {
    iss: String,
    sub: String,
    aud: serde_json::Value,
    exp: u64,
    nonce: Option<String>,
    email: Option<String>,
    preferred_username: Option<String>,
    name: Option<String>,
}
#[derive(Debug, Deserialize)]
pub struct SamlRequest {
    #[serde(rename = "SAMLResponse")]
    pub saml_response: Option<String>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or_default()
}
fn random_url_token(bytes: usize) -> String {
    let mut data = vec![0u8; bytes];
    OsRng.fill_bytes(&mut data);
    URL_SAFE_NO_PAD.encode(data)
}
fn state_key(state: &str) -> Vec<u8> {
    let mut k = OIDC_STATE_PREFIX.to_vec();
    k.extend_from_slice(state.as_bytes());
    k
}
fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}
fn configured(name: &str) -> Result<String, axum::response::Response> {
    std::env::var(name)
        .ok()
        .filter(|v| !v.trim().is_empty())
        .ok_or_else(|| {
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({"error":format!("{name} is not configured")})),
            )
                .into_response()
        })
}
async fn get_json<T: for<'de> Deserialize<'de>>(url: &str) -> Result<T, ()> {
    let response = reqwest::Client::new()
        .get(url)
        .send()
        .await
        .map_err(|_| ())?;
    if !response.status().is_success() {
        return Err(());
    }
    response.json::<T>().await.map_err(|_| ())
}

pub async fn oidc_start(State(state): State<ControlPlaneState>) -> impl IntoResponse {
    let issuer = match configured("VARDHAN_OIDC_ISSUER") {
        Ok(v) => v.trim_end_matches('/').to_string(),
        Err(e) => return e,
    };
    let client_id = match configured("VARDHAN_OIDC_CLIENT_ID") {
        Ok(v) => v,
        Err(e) => return e,
    };
    let redirect_uri = match configured("VARDHAN_OIDC_REDIRECT_URI") {
        Ok(v) => v,
        Err(e) => return e,
    };
    if !issuer.starts_with("https://") || !redirect_uri.starts_with("https://") {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error":"OIDC issuer and redirect URI must use HTTPS"})),
        )
            .into_response();
    }
    let state_value = random_url_token(32);
    let nonce = random_url_token(32);
    let verifier = random_url_token(48);
    let record = OidcStateRecord {
        state: state_value.clone(),
        nonce: nonce.clone(),
        pkce_verifier: verifier.clone(),
        issuer: issuer.clone(),
        client_id: client_id.clone(),
        redirect_uri: redirect_uri.clone(),
        expires_at_ms: now_ms() + FLOW_TTL_MS,
    };
    let bytes = match serde_json::to_vec(&record) {
        Ok(v) => v,
        Err(_) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error":"OIDC flow state serialization failed"})),
            )
                .into_response()
        }
    };
    if state.db.insert(state_key(&state_value), bytes).is_err() {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error":"OIDC flow state persistence failed"})),
        )
            .into_response();
    }
    let discovery =
        match get_json::<Discovery>(&format!("{issuer}/.well-known/openid-configuration")).await {
            Ok(v) => v,
            Err(_) => {
                let _ = state.db.remove(state_key(&state_value));
                return (
                    StatusCode::BAD_GATEWAY,
                    Json(json!({"error":"OIDC provider discovery failed"})),
                )
                    .into_response();
            }
        };
    if discovery.issuer.trim_end_matches('/') != issuer {
        let _ = state.db.remove(state_key(&state_value));
        return (
            StatusCode::BAD_GATEWAY,
            Json(json!({"error":"OIDC discovery issuer mismatch"})),
        )
            .into_response();
    }
    let url=format!("{}?response_type=code&client_id={}&redirect_uri={}&scope=openid%20profile%20email&state={}&nonce={}&code_challenge={}&code_challenge_method=S256",discovery.authorization_endpoint,urlencoding::encode(&client_id),urlencoding::encode(&redirect_uri),urlencoding::encode(&state_value),urlencoding::encode(&nonce),urlencoding::encode(&pkce_challenge(&verifier)));
    Redirect::temporary(&url).into_response()
}

pub async fn oidc_callback(
    State(state): State<ControlPlaneState>,
    Query(query): Query<OidcCallback>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let state_key = state_key(&query.state);
    let Some(bytes) = state.db.get(&state_key).ok().flatten() else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error":"OIDC state is unknown or already consumed"})),
        )
            .into_response();
    };
    let record: OidcStateRecord = match serde_json::from_slice(&bytes) {
        Ok(v) => v,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error":"OIDC state is corrupt"})),
            )
                .into_response()
        }
    };
    if record.state != query.state || now_ms() >= record.expires_at_ms {
        let _ = state.db.remove(state_key);
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error":"OIDC state expired or mismatched"})),
        )
            .into_response();
    }
    if let Some(iss) = query.iss.as_deref() {
        if iss.trim_end_matches('/') != record.issuer {
            let _ = state.db.remove(state_key);
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error":"OIDC issuer mismatch"})),
            )
                .into_response();
        }
    }
    let _ = state.db.remove(state_key);
    let client_secret = match configured("VARDHAN_OIDC_CLIENT_SECRET") {
        Ok(v) => v,
        Err(e) => return e,
    };
    let discovery = match get_json::<Discovery>(&format!(
        "{}/.well-known/openid-configuration",
        record.issuer
    ))
    .await
    {
        Ok(v) => v,
        Err(_) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({"error":"OIDC provider discovery failed"})),
            )
                .into_response()
        }
    };
    let form = [
        ("grant_type", "authorization_code"),
        ("code", query.code.as_str()),
        ("redirect_uri", record.redirect_uri.as_str()),
        ("client_id", record.client_id.as_str()),
        ("client_secret", client_secret.as_str()),
        ("code_verifier", record.pkce_verifier.as_str()),
    ];
    let response = match reqwest::Client::new()
        .post(&discovery.token_endpoint)
        .form(&form)
        .send()
        .await
    {
        Ok(v) => v,
        Err(_) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({"error":"OIDC code exchange failed"})),
            )
                .into_response()
        }
    };
    if !response.status().is_success() {
        return (
            StatusCode::BAD_GATEWAY,
            Json(json!({"error":"OIDC code exchange rejected by provider"})),
        )
            .into_response();
    }
    let token_response: TokenResponse = match response.json().await {
        Ok(v) => v,
        Err(_) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({"error":"OIDC token response invalid"})),
            )
                .into_response()
        }
    };
    let header = match decode_header(&token_response.id_token) {
        Ok(v) => v,
        Err(_) => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error":"Invalid OIDC ID token header"})),
            )
                .into_response()
        }
    };
    let jwks = match get_json::<Jwks>(&discovery.jwks_uri).await {
        Ok(v) => v,
        Err(_) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({"error":"OIDC JWKS retrieval failed"})),
            )
                .into_response()
        }
    };
    let jwk = match jwks
        .keys
        .iter()
        .find(|k| k.kid.as_deref() == header.kid.as_deref())
    {
        Some(v) => v,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error":"OIDC signing key not found"})),
            )
                .into_response()
        }
    };
    let (algorithm, decoding_key) = match jwk.kty.as_str() {
        "RSA" => {
            let (n, e) = match (jwk.n.as_deref(), jwk.e.as_deref()) {
                (Some(n), Some(e)) => (n, e),
                _ => {
                    return (
                        StatusCode::UNAUTHORIZED,
                        Json(json!({"error":"OIDC RSA key is incomplete"})),
                    )
                        .into_response()
                }
            };
            match DecodingKey::from_rsa_components(n, e) {
                Ok(k) => (Algorithm::RS256, k),
                Err(_) => {
                    return (
                        StatusCode::UNAUTHORIZED,
                        Json(json!({"error":"OIDC RSA key is invalid"})),
                    )
                        .into_response()
                }
            }
        }
        "EC" if jwk.crv.as_deref() == Some("P-256") => {
            let (x, y) = match (jwk.x.as_deref(), jwk.y.as_deref()) {
                (Some(x), Some(y)) => (x, y),
                _ => {
                    return (
                        StatusCode::UNAUTHORIZED,
                        Json(json!({"error":"OIDC EC key is incomplete"})),
                    )
                        .into_response()
                }
            };
            match DecodingKey::from_ec_components(x, y) {
                Ok(k) => (Algorithm::ES256, k),
                Err(_) => {
                    return (
                        StatusCode::UNAUTHORIZED,
                        Json(json!({"error":"OIDC EC key is invalid"})),
                    )
                        .into_response()
                }
            }
        }
        _ => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error":"Unsupported OIDC signing key type"})),
            )
                .into_response()
        }
    };
    if header.alg != algorithm {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error":"OIDC algorithm mismatch"})),
        )
            .into_response();
    }
    let mut validation = Validation::new(algorithm);
    validation.validate_aud = false;
    validation.set_required_spec_claims(&["exp", "iss", "sub"]);
    let claims = match decode::<IdClaims>(&token_response.id_token, &decoding_key, &validation) {
        Ok(v) => v.claims,
        Err(_) => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error":"OIDC ID token signature or claims invalid"})),
            )
                .into_response()
        }
    };
    if let Err(error) = validate_id_claims(&claims, &record, now_ms()) {
        return (StatusCode::UNAUTHORIZED, Json(json!({"error": error}))).into_response();
    }
    let username = claims
        .email
        .clone()
        .or(claims.preferred_username.clone())
        .unwrap_or_else(|| format!("oidc:{}", claims.sub));
    let default_org = match std::env::var("VARDHAN_OIDC_DEFAULT_ORG")
        .ok()
        .filter(|v| !v.trim().is_empty())
    {
        Some(value)
            if state
                .db
                .get(crate::key(b"org:", &value))
                .ok()
                .flatten()
                .is_some() =>
        {
            value
        }
        _ => {
            return (
                StatusCode::FORBIDDEN,
                Json(json!({"error":"OIDC tenant mapping is not configured or does not exist"})),
            )
                .into_response()
        }
    };
    if !is_member(&state.db, &default_org, &username).unwrap_or(false) {
        if !std::env::var("VARDHAN_OIDC_AUTO_PROVISION")
            .map(|v| v == "true")
            .unwrap_or(false)
        {
            return (
                StatusCode::FORBIDDEN,
                Json(
                    json!({"error":"OIDC identity is not authorized for the mapped organization"}),
                ),
            )
                .into_response();
        }
        if state
            .db
            .insert(
                crate::key(crate::MEMBER_PREFIX, &format!("{default_org}:{username}")),
                b"viewer",
            )
            .is_err()
        {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error":"OIDC membership provisioning failed"})),
            )
                .into_response();
        }
        let profile = AdminProfile {
            username: username.clone(),
            display_name: claims.name.clone().unwrap_or_else(|| username.clone()),
            email: username.clone(),
            role: "user".into(),
            updated_at_ms: now_ms() as u128,
        };
        if state.auth.credentials.save_profile(&profile).is_err() {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error":"OIDC authorization profile provisioning failed"})),
            )
                .into_response();
        }
    }
    if state
        .auth
        .credentials
        .authoritative_role(&username)
        .is_none()
    {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({"error":"OIDC identity has no authoritative authorization profile"})),
        )
            .into_response();
    }
    let ip = auth_service::resolve_ip(&headers);
    let session = state
        .auth
        .sessions
        .create_with_node(
            &username,
            ip,
            state.auth.node_id.as_deref().unwrap_or("control-plane"),
        )
        .await;
    Json(json!({"status":"authenticated","token":session.as_str(),"expires_in":8*60*60,"subject":claims.sub,"name":claims.name})).into_response()
}

fn validate_id_claims(
    claims: &IdClaims,
    record: &OidcStateRecord,
    now: u64,
) -> Result<(), &'static str> {
    if claims.iss.trim_end_matches('/') != record.issuer {
        return Err("OIDC token issuer mismatch");
    }
    let audience_ok = match &claims.aud {
        serde_json::Value::String(v) => v == &record.client_id,
        serde_json::Value::Array(v) => v
            .iter()
            .any(|x| x.as_str() == Some(record.client_id.as_str())),
        _ => false,
    };
    if !audience_ok {
        return Err("OIDC token audience mismatch");
    }
    if claims.exp.saturating_mul(1000) <= now {
        return Err("OIDC token expired");
    }
    if claims.nonce.as_deref() != Some(record.nonce.as_str()) {
        return Err("OIDC nonce mismatch");
    }
    Ok(())
}

pub async fn saml_metadata() -> impl IntoResponse {
    let entity = match std::env::var("VARDHAN_SAML_ENTITY_ID") {
        Ok(v) if !v.trim().is_empty() => v,
        _ => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                [(axum::http::header::CONTENT_TYPE, "application/json")],
                json!({"error": "VARDHAN_SAML_ENTITY_ID is not configured"}).to_string(),
            )
                .into_response();
        }
    };
    let acs = match std::env::var("VARDHAN_SAML_ACS_URL") {
        Ok(v) if !v.trim().is_empty() => v,
        _ => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                [(axum::http::header::CONTENT_TYPE, "application/json")],
                json!({"error": "VARDHAN_SAML_ACS_URL is not configured"}).to_string(),
            )
                .into_response();
        }
    };
    let xml = format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?><md:EntityDescriptor xmlns:md=\"urn:oasis:names:tc:SAML:2.0:metadata\" entityID=\"{entity}\"><md:SPSSODescriptor AuthnRequestsSigned=\"false\" WantAssertionsSigned=\"true\" protocolSupportEnumeration=\"urn:oasis:names:tc:SAML:2.0:protocol\"><md:AssertionConsumerService Binding=\"urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST\" Location=\"{acs}\" index=\"0\" isDefault=\"true\"/></md:SPSSODescriptor></md:EntityDescriptor>");
    (
        [(
            axum::http::header::CONTENT_TYPE,
            "application/samlmetadata+xml",
        )],
        xml,
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record() -> OidcStateRecord {
        OidcStateRecord {
            state: "state".into(),
            nonce: "nonce-1234567890123456".into(),
            pkce_verifier: "a".repeat(48),
            issuer: "https://idp.example.com".into(),
            client_id: "vardhan-client".into(),
            redirect_uri: "https://console.example.com/callback".into(),
            expires_at_ms: 10_000,
        }
    }

    fn claims() -> IdClaims {
        IdClaims {
            iss: "https://idp.example.com".into(),
            sub: "subject-1".into(),
            aud: serde_json::json!("vardhan-client"),
            exp: 2_000,
            nonce: Some("nonce-1234567890123456".into()),
            email: Some("user@example.com".into()),
            preferred_username: None,
            name: Some("User".into()),
        }
    }

    #[test]
    fn oidc_claim_binding_accepts_valid_claims() {
        assert!(validate_id_claims(&claims(), &record(), 1_000).is_ok());
    }

    #[test]
    fn oidc_claim_binding_rejects_wrong_issuer_audience_expiry_and_nonce() {
        let mut c = claims();
        c.iss = "https://evil.example.com".into();
        assert_eq!(
            validate_id_claims(&c, &record(), 1_000),
            Err("OIDC token issuer mismatch")
        );

        let mut c = claims();
        c.aud = serde_json::json!("wrong-client");
        assert_eq!(
            validate_id_claims(&c, &record(), 1_000),
            Err("OIDC token audience mismatch")
        );

        let mut c = claims();
        c.exp = 1;
        assert_eq!(
            validate_id_claims(&c, &record(), 1_000),
            Err("OIDC token expired")
        );

        let mut c = claims();
        c.nonce = Some("wrong-nonce".into());
        assert_eq!(
            validate_id_claims(&c, &record(), 1_000),
            Err("OIDC nonce mismatch")
        );
    }
}
