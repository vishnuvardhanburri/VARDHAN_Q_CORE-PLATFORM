//! Production SAML 2.0 Service Provider ACS boundary.
//!
//! The handler uses saml-rs for XML parsing, XMLDSig verification, issuer/audience/
//! destination/recipient/time validation and structural XML-signature-wrapping
//! defenses. IdP metadata is pinned to an operator-supplied certificate and SAML
//! replay keys are persisted atomically in the control-plane sled store.

use axum::{extract::{Form, State}, http::StatusCode, response::IntoResponse, Json};
use serde::Deserialize;
use serde_json::json;
use std::{time::{Duration, SystemTime, UNIX_EPOCH}};
use saml_rs::{
    AcsEndpoint, BrowserInput, CertificatePem, EntityId, FormField, IdpDescriptor,
    MetadataTrustPolicy, ReplayCache, ReplayKey, ReplayPolicy, Saml, SamlError,
    SamlValidationContext, Sp, SpConfig, SpValidationPolicy, SsoResponse,
};

use crate::{is_member, ControlPlaneState};

const REPLAY_PREFIX: &[u8] = b"saml:replay:";

#[derive(Debug, Deserialize)]
pub struct SamlAcsRequest {
    #[serde(rename = "SAMLResponse")]
    pub saml_response: Option<String>,
    #[serde(rename = "RelayState")]
    pub relay_state: Option<String>,
}

struct SledReplayCache<'a> {
    db: &'a sled::Db,
}

impl<'a> ReplayCache for SledReplayCache<'a> {
    fn check_and_store(
        &mut self,
        key: ReplayKey,
        expires_at: SystemTime,
    ) -> Result<(), SamlError> {
        let cache_key = key.cache_key();
        let storage_key = {
            let mut out = REPLAY_PREFIX.to_vec();
            out.extend_from_slice(cache_key.as_bytes());
            out
        };
        let expiry_ms = expires_at
            .duration_since(UNIX_EPOCH)
            .map_err(|_| SamlError::Invalid("SAML replay expiry precedes Unix epoch".into()))?
            .as_millis() as u64;
        let new_value = expiry_ms.to_be_bytes();
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| SamlError::Invalid("system clock precedes Unix epoch".into()))?
            .as_millis() as u64;

        for _ in 0..8 {
            let existing = self
                .db
                .get(&storage_key)
                .map_err(|e| SamlError::Invalid(format!("SAML replay cache read failed: {e}")))?;

            if let Some(ref value) = existing {
                if value.len() == 8 {
                    let existing_expiry = u64::from_be_bytes(value.as_ref().try_into().unwrap());
                    if existing_expiry > now_ms {
                        return Err(SamlError::ReplayDetected { key: cache_key });
                    }
                }
            }

            match self.db.compare_and_swap(
                &storage_key,
                existing.as_deref(),
                Some(new_value.as_slice()),
            ) {
                Ok(Ok(())) => return Ok(()),
                Ok(Err(_)) => continue,
                Err(e) => return Err(SamlError::Invalid(format!("SAML replay cache CAS failed: {e}"))),
            }
        }

        Err(SamlError::Invalid("SAML replay cache contention exceeded retry budget".into()))
    }
}

fn env_required(name: &str) -> Result<String, axum::response::Response> {
    std::env::var(name)
        .ok()
        .filter(|v| !v.trim().is_empty())
        .ok_or_else(|| {
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({"error": format!("{name} is not configured")})),
            )
                .into_response()
        })
}

fn build_sp() -> Result<Saml<Sp>, String> {
    let entity_id = std::env::var("VARDHAN_SAML_ENTITY_ID")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| "https://vardhan.example.com/saml/metadata".into());
    let acs_url = std::env::var("VARDHAN_SAML_ACS_URL")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| "https://vardhan.example.com/api/v1/auth/saml/acs".into());

    let entity = EntityId::try_new(entity_id).map_err(|e| format!("invalid SAML SP entity ID: {e}"))?;
    let acs = AcsEndpoint::post(acs_url).map_err(|e| format!("invalid SAML ACS URL: {e}"))?;

    Saml::sp(
        SpConfig::builder(entity)
            .acs_endpoint(acs)
            .validation(SpValidationPolicy::strict())
            .build()
            .map_err(|e| format!("invalid SAML SP configuration: {e}"))?,
    )
    .map_err(|e| format!("SAML SP initialization failed: {e}"))
}

fn build_idp() -> Result<IdpDescriptor, String> {
    let entity_id = env_required_value("VARDHAN_SAML_IDP_ENTITY_ID")?;
    let metadata = if let Some(value) = std::env::var("VARDHAN_SAML_IDP_METADATA_XML").ok().filter(|v| !v.trim().is_empty()) {
        value
    } else if let Some(path) = std::env::var("VARDHAN_SAML_IDP_METADATA_PATH").ok().filter(|v| !v.trim().is_empty()) {
        std::fs::read_to_string(path).map_err(|e| format!("failed to read SAML IdP metadata: {e}"))?
    } else {
        return Err("VARDHAN_SAML_IDP_METADATA_XML or VARDHAN_SAML_IDP_METADATA_PATH is not configured".into());
    };
    let cert = env_required_value("VARDHAN_SAML_IDP_METADATA_CERT_PEM")?;
    let certificate = CertificatePem::new(cert);
    let certificates = [certificate];

    IdpDescriptor::from_metadata_xml_for(
        EntityId::try_new(entity_id).map_err(|e| format!("invalid SAML IdP entity ID: {e}"))?,
        &metadata,
        MetadataTrustPolicy::RequireSignature { trusted_certificates: &certificates },
    )
    .map_err(|e| format!("SAML IdP metadata trust verification failed: {e}"))
}

fn env_required_value(name: &str) -> Result<String, String> {
    std::env::var(name)
        .ok()
        .filter(|v| !v.trim().is_empty())
        .ok_or_else(|| format!("{name} is not configured"))
}

pub async fn saml_acs(
    State(state): State<ControlPlaneState>,
    Form(req): Form<SamlAcsRequest>,
) -> impl IntoResponse {
    let Some(saml_response) = req.saml_response.filter(|v| !v.trim().is_empty()) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "SAMLResponse is required"})),
        )
            .into_response();
    };

    let expected_org = match env_required("VARDHAN_SAML_DEFAULT_ORG") {
        Ok(value) => value,
        Err(response) => return response,
    };

    let sp = match build_sp() {
        Ok(value) => value,
        Err(error) => return (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error": error}))).into_response(),
    };
    let idp = match build_idp() {
        Ok(value) => value,
        Err(error) => return (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error": error}))).into_response(),
    };

    let mut replay_cache = SledReplayCache { db: &state.db };
    let validation = SamlValidationContext::new(
        SystemTime::now(),
        ReplayPolicy::RequireCache(&mut replay_cache),
    )
    .with_replay_retention(Duration::from_secs(5 * 60));

    let mut fields = vec![FormField::new("SAMLResponse", saml_response)];
    if let Some(relay_state) = req.relay_state.clone() {
        fields.push(FormField::new("RelayState", relay_state));
    }
    let input = BrowserInput::<SsoResponse>::post(fields);

    let session = match sp.accept_unsolicited_sso(&idp, input, validation) {
        Ok(value) => value,
        Err(error) => {
            tracing::warn!(error = %error, "SAML ACS validation rejected response");
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "SAML assertion validation failed"})),
            )
                .into_response();
        }
    };

    let username = session.name_id().value().trim().to_string();
    if username.is_empty() {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "SAML assertion did not contain a usable NameID"})),
        )
            .into_response();
    }

    if !is_member(&state.db, &expected_org, &username).unwrap_or(false) {
        if std::env::var("VARDHAN_SAML_AUTO_PROVISION").map(|v| v == "true").unwrap_or(false) {
            if let Err(error) = state.db.insert(
                crate::key(crate::MEMBER_PREFIX, &format!("{expected_org}:{username}")),
                b"viewer",
            ) {
                tracing::error!(%error, "SAML auto-provisioning failed");
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({"error": "SAML user provisioning failed"})),
                )
                    .into_response();
            }
        } else {
            return (
                StatusCode::FORBIDDEN,
                Json(json!({"error": "SAML identity is not a member of the configured organization"})),
            )
                .into_response();
        }
    }

    let ip = std::net::IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED);
    let issued = state
        .auth
        .sessions
        .create_with_node(&username, ip, state.auth.node_id.as_deref().unwrap_or("control-plane"))
        .await;

    Json(json!({
        "status": "authenticated",
        "token": issued.as_str(),
        "expires_in": 8 * 60 * 60,
        "subject": username,
        "issuer": session.issuer().as_str(),
        "relay_state_present": req.relay_state.is_some(),
    }))
    .into_response()
}
