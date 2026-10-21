use crate::billing::{
    event_key, now_secs, verify_timestamp, BillingEvent, BillingProviderAdapter,
    HmacBillingProvider, SubscriptionState,
};
use crate::{is_member, key, plan, ControlPlaneState, Subscription};
use auth_service::AuthenticatedUser;
use axum::{
    body::Bytes,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Extension, Json,
};
use ed25519_dalek::{Signer, SigningKey, Verifier};
use serde::{Deserialize, Serialize};
use serde_json::json;

const VERIFIED_PREFIX: &[u8] = b"billing:verified:";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerifiedBillingState {
    pub organization_id: String,
    pub effective_plan_id: String,
    pub status: SubscriptionState,
    pub provider: String,
    pub external_customer_id: Option<String>,
    pub external_subscription_id: Option<String>,
    pub updated_at: u64,
}

fn verified_key(org_id: &str) -> Vec<u8> {
    key(VERIFIED_PREFIX, org_id)
}

fn json_error(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({ "error": message }))).into_response()
}

pub async fn verified_entitlements(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    if !is_member(&state.db, &id, &user.username).unwrap_or(false) {
        return json_error(StatusCode::FORBIDDEN, "Organization access denied.");
    }
    let Some(verified) = state
        .db
        .get(verified_key(&id))
        .ok()
        .flatten()
        .and_then(|v| serde_json::from_slice::<VerifiedBillingState>(&v).ok())
    else {
        return Json(json!({ "organization_id": id, "subscription_status": "unverified", "entitlements": [], "activation": "requires_verified_billing_event" })).into_response();
    };
    if !verified.status.allows_entitlements() {
        return Json(json!({ "organization_id": id, "subscription_status": verified.status, "entitlements": [], "activation": "suspended" })).into_response();
    }
    let Some(p) = plan(&verified.effective_plan_id) else {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, "Unknown verified plan.");
    };
    Json(json!({ "organization_id": id, "plan": p, "subscription_status": verified.status, "provider": verified.provider, "entitlements": p.entitlements, "activation": "verified" })).into_response()
}

pub async fn billing_webhook(
    State(state): State<ControlPlaneState>,
    headers: HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    let secret = match std::env::var("VARDHAN_BILLING_WEBHOOK_SECRET") {
        Ok(v) if v.len() >= 16 => v,
        _ => {
            return json_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "Billing webhook verification is not configured.",
            )
        }
    };
    let signature = match headers
        .get("x-vardhan-billing-signature")
        .and_then(|v| v.to_str().ok())
    {
        Some(v) => v,
        None => return json_error(StatusCode::UNAUTHORIZED, "Missing billing signature."),
    };
    let timestamp = match headers
        .get("x-vardhan-billing-timestamp")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok())
    {
        Some(v) => v,
        None => {
            return json_error(
                StatusCode::UNAUTHORIZED,
                "Missing or invalid billing timestamp.",
            )
        }
    };
    if !verify_timestamp(timestamp, now_secs()) {
        return json_error(
            StatusCode::UNAUTHORIZED,
            "Billing webhook timestamp outside replay window.",
        );
    }
    let adapter = HmacBillingProvider;
    if !adapter.verify_signature(&body, signature, secret.as_bytes()) {
        return json_error(
            StatusCode::UNAUTHORIZED,
            "Invalid billing webhook signature.",
        );
    }
    let event: BillingEvent = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => return json_error(StatusCode::BAD_REQUEST, "Invalid billing event payload."),
    };
    if event.timestamp != timestamp || !verify_timestamp(event.timestamp, now_secs()) {
        return json_error(
            StatusCode::UNAUTHORIZED,
            "Billing event timestamp mismatch.",
        );
    }
    if plan(event.plan_id.as_deref().unwrap_or("foundation")).is_none() {
        return json_error(
            StatusCode::BAD_REQUEST,
            "Billing event references an unknown plan.",
        );
    }
    if event.provider.trim().is_empty() || event.event_id.trim().is_empty() {
        return json_error(
            StatusCode::BAD_REQUEST,
            "Billing provider and event_id are required.",
        );
    }

    let current = state
        .db
        .get(key(b"sub:", &event.organization_id))
        .ok()
        .flatten()
        .and_then(|v| serde_json::from_slice::<Subscription>(&v).ok());
    if current.is_none() {
        return json_error(
            StatusCode::NOT_FOUND,
            "Organization subscription not found.",
        );
    }

    let effective_plan_id = event.plan_id.clone().unwrap_or_else(|| "foundation".into());
    let verified = VerifiedBillingState {
        organization_id: event.organization_id.clone(),
        effective_plan_id,
        status: event.status.clone(),
        provider: event.provider.clone(),
        external_customer_id: event.external_customer_id.clone(),
        external_subscription_id: event.external_subscription_id.clone(),
        updated_at: now_secs(),
    };
    let verified_bytes = match serde_json::to_vec(&verified) {
        Ok(v) => v,
        Err(_) => {
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Billing state serialization failed.",
            )
        }
    };
    let event_key = event_key(&event.event_id);
    let timestamp_bytes = event.timestamp.to_be_bytes();
    let verified_key = verified_key(&event.organization_id);
    let transaction = state.db.transaction(|tx| {
        if tx.get(&event_key)?.is_some() {
            return Ok::<bool, sled::transaction::ConflictableTransactionError>(false);
        }
        tx.insert(event_key.as_slice(), timestamp_bytes.as_slice())?;
        tx.insert(verified_key.as_slice(), verified_bytes.as_slice())?;
        Ok::<bool, sled::transaction::ConflictableTransactionError>(true)
    });
    match transaction {
        Ok(false) => (
            StatusCode::OK,
            Json(json!({ "accepted": true, "duplicate": true, "event_id": event.event_id })),
        )
            .into_response(),
        Ok(true) => {
            let _ = state.db.flush();
            (
                StatusCode::OK,
                Json(json!({ "accepted": true, "duplicate": false, "event_id": event.event_id })),
            )
                .into_response()
        }
        Err(_) => json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Billing state transaction failed.",
        ),
    }
}

fn get_license_signing_key(db: &sled::Db) -> SigningKey {
    const LIC_KEY_ID: &[u8] = b"system:license_signing_key";
    if let Ok(Some(bytes)) = db.get(LIC_KEY_ID) {
        if bytes.len() == 32 {
            let mut arr = [0u8; 32];
            arr.copy_from_slice(&bytes);
            return SigningKey::from_bytes(&arr);
        }
    }
    let mut secret = [0u8; 32];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut secret);
    let key = SigningKey::from_bytes(&secret);
    let _ = db.insert(LIC_KEY_ID, &secret);
    let _ = db.flush();
    key
}

#[derive(Debug, Deserialize)]
pub struct ActivateSubscriptionRequest {
    pub organization_id: String,
    pub plan_id: String,
    pub idempotency_key: Option<String>,
    pub provider: Option<String>,
}

pub async fn activate_subscription(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Json(req): Json<ActivateSubscriptionRequest>,
) -> impl IntoResponse {
    if user.role != auth_service::authorization::Role::Admin {
        return json_error(StatusCode::FORBIDDEN, "Platform admin role required.");
    }
    let _p = match plan(&req.plan_id) {
        Some(p) => p,
        None => return json_error(StatusCode::BAD_REQUEST, "Unknown plan specified."),
    };
    let now = now_secs();
    let provider = req.provider.unwrap_or_else(|| "manual_wire".into());
    let verified = VerifiedBillingState {
        organization_id: req.organization_id.clone(),
        effective_plan_id: req.plan_id.clone(),
        status: SubscriptionState::Active,
        provider: provider.clone(),
        external_customer_id: None,
        external_subscription_id: req.idempotency_key.clone(),
        updated_at: now,
    };
    let sub = Subscription {
        organization_id: req.organization_id.clone(),
        plan_id: req.plan_id.clone(),
        status: "active".into(),
        provider: provider.clone(),
        external_customer_id: None,
        external_subscription_id: req.idempotency_key.clone(),
    };
    let _ = state.db.insert(
        key(b"sub:", &req.organization_id),
        serde_json::to_vec(&sub).unwrap(),
    );
    let _ = state.db.insert(
        verified_key(&req.organization_id),
        serde_json::to_vec(&verified).unwrap(),
    );
    let _ = state.db.flush();
    (
        StatusCode::OK,
        Json(json!({ "activated": true, "subscription": sub, "verified": verified })),
    )
        .into_response()
}

#[derive(Debug, Deserialize)]
pub struct MintLicenseRequest {
    pub tenant_id: String,
    pub valid_days: u32,
    pub max_nodes: u32,
    pub package_tier: Option<String>,
}

pub async fn mint_license(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Json(req): Json<MintLicenseRequest>,
) -> impl IntoResponse {
    if user.role != auth_service::authorization::Role::Admin {
        return json_error(StatusCode::FORBIDDEN, "Platform admin role required.");
    }
    if req.tenant_id.trim().is_empty() || req.valid_days == 0 || req.max_nodes == 0 {
        return json_error(StatusCode::BAD_REQUEST, "Invalid license parameters.");
    }
    let now = now_secs();
    let valid_until = now + (req.valid_days as u64 * 86400);
    let payload = format!("{}:{}:{}", req.tenant_id.trim(), valid_until, req.max_nodes);

    let signing_key = get_license_signing_key(&state.db);
    let signature = signing_key.sign(payload.as_bytes());
    let sig_hex = hex::encode(signature.to_bytes());

    (
        StatusCode::OK,
        Json(json!({
            "tenant_id": req.tenant_id.trim(),
            "valid_until": valid_until,
            "max_nodes": req.max_nodes,
            "signature": sig_hex,
            "_package_tier": req.package_tier.unwrap_or_else(|| "foundation".into()),
            "_minted_by": format!("Platform Admin: {}", user.username),
            "_issued_at_epoch": now,
            "_verifying_key": hex::encode(signing_key.verifying_key().to_bytes())
        })),
    )
        .into_response()
}

#[derive(Debug, Deserialize, Serialize)]
pub struct InstallLicenseRequest {
    pub tenant_id: String,
    pub valid_until: u64,
    pub max_nodes: u32,
    pub signature: String,
}

pub async fn install_license(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Json(req): Json<InstallLicenseRequest>,
) -> impl IntoResponse {
    if !is_member(&state.db, &req.tenant_id, &user.username).unwrap_or(false)
        && user.role != auth_service::authorization::Role::Admin
    {
        return json_error(StatusCode::FORBIDDEN, "Organization access denied.");
    }
    let now = now_secs();
    if now > req.valid_until {
        return json_error(StatusCode::BAD_REQUEST, "License token has expired.");
    }
    let sig_bytes = match hex::decode(req.signature.trim()) {
        Ok(b) if b.len() == 64 => b,
        _ => {
            return json_error(
                StatusCode::BAD_REQUEST,
                "Invalid signature encoding or length.",
            )
        }
    };
    let payload = format!(
        "{}:{}:{}",
        req.tenant_id.trim(),
        req.valid_until,
        req.max_nodes
    );

    let signing_key = get_license_signing_key(&state.db);
    let verify_key = signing_key.verifying_key();
    let sig_arr: [u8; 64] = match sig_bytes.as_slice().try_into() {
        Ok(arr) => arr,
        Err(_) => return json_error(StatusCode::BAD_REQUEST, "Invalid signature length."),
    };
    let sig = ed25519_dalek::Signature::from_bytes(&sig_arr);
    if verify_key.verify(payload.as_bytes(), &sig).is_err() {
        return json_error(
            StatusCode::UNAUTHORIZED,
            "Cryptographic license signature verification failed.",
        );
    }

    let _ = state.db.insert(
        key(b"lic:", &req.tenant_id),
        serde_json::to_vec(&req).unwrap(),
    );
    let _ = state.db.flush();
    (
        StatusCode::OK,
        Json(json!({
            "installed": true,
            "tenant_id": req.tenant_id,
            "valid_until": req.valid_until,
            "max_nodes": req.max_nodes
        })),
    )
        .into_response()
}

#[derive(Debug, Deserialize)]
pub struct RenewLicenseRequest {
    pub organization_id: String,
    pub period_days: u32,
    pub notes: Option<String>,
}

pub async fn renew_license(
    State(state): State<ControlPlaneState>,
    Extension(user): Extension<AuthenticatedUser>,
    Json(req): Json<RenewLicenseRequest>,
) -> impl IntoResponse {
    if !is_member(&state.db, &req.organization_id, &user.username).unwrap_or(false)
        && user.role != auth_service::authorization::Role::Admin
    {
        return json_error(StatusCode::FORBIDDEN, "Organization access denied.");
    }
    let ref_id = format!(
        "LIC-REQ-{}",
        &uuid::Uuid::new_v4().simple().to_string()[..8].to_uppercase()
    );
    let renewal_record = json!({
        "reference_id": ref_id,
        "organization_id": req.organization_id,
        "requested_by": user.username,
        "period_days": req.period_days,
        "notes": req.notes,
        "created_at_ms": now_secs() * 1000,
        "status": "pending_approval"
    });
    let _ = state.db.insert(
        key(b"lic_renewal:", &ref_id),
        serde_json::to_vec(&renewal_record).unwrap(),
    );
    let _ = state.db.flush();
    (
        StatusCode::OK,
        Json(json!({
            "submitted": true,
            "reference_id": ref_id,
            "period_days": req.period_days
        })),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Organization, PLANS};
    use sled::Config;

    #[test]
    fn plan_catalog_is_not_an_entitlement_source() {
        assert!(plan("strategic").is_some());
        let db = Config::new().temporary(true).open().unwrap();
        db.insert(
            key(b"org:", "o1"),
            serde_json::to_vec(&Organization {
                id: "o1".into(),
                name: "O".into(),
                owner: "u".into(),
                created_at_ms: 0,
            })
            .unwrap(),
        )
        .unwrap();
        assert!(db.get(verified_key("o1")).unwrap().is_none());
        assert_eq!(PLANS.len(), 6);
    }

    #[test]
    fn plan_catalog_carries_single_priced_ladder() {
        // Fixed fees: discovery + PoV. Annual licenses: foundation, enterprise, advanced_resilience.
        // Strategic is the only scoped band. Any price drift fails here first.
        let priced = |id: &str| plan(id).unwrap_or_else(|| panic!("plan {id} missing"));
        assert_eq!(priced("qcore_architecture_evaluation").price_gbp, Some(15_000));
        assert_eq!(priced("qcore_proof_of_value").price_gbp, Some(60_000));
        assert_eq!(priced("foundation").price_gbp, Some(360_000));
        assert_eq!(priced("enterprise").price_gbp, Some(720_000));
        assert_eq!(priced("advanced_resilience").price_gbp, Some(1_200_000));
        let strategic = priced("strategic");
        assert_eq!(strategic.price_gbp, None);
        assert_eq!(strategic.price_min_gbp, Some(5_000_000));
        assert_eq!(strategic.price_max_gbp, Some(50_000_000));
        assert_eq!(strategic.billing_model, "scoped");
        assert_eq!(strategic.billing_type, "scoped_engagement");
        assert_eq!(strategic.billing_period, "custom");
        assert_eq!(
            strategic.price_display,
            "£5,000,000–£50,000,000 individually scoped"
        );

        // Serialized catalog shape stays contract-stable for the console + SDKs.
        let json = serde_json::to_value(crate::PLANS).unwrap();
        for entry in json.as_array().unwrap() {
            for field in [
                "id",
                "name",
                "tier",
                "product",
                "contact_sales",
                "entitlements",
                "price_gbp",
                "price_min_gbp",
                "price_max_gbp",
                "billing_model",
                "billing_type",
                "billing_period",
                "price_display",
            ] {
                assert!(entry.get(field).is_some(), "catalog plan missing {field}");
            }
        }
    }

    #[test]
    fn test_commercial_progression_foundation_enterprise_advanced_resilience() {
        // Commercial progression invariant:
        // Foundation is priced at £360,000 / year.
        // Enterprise is priced at £720,000 / year.
        // Advanced Resilience is priced at £1,200,000 / year.
        // The commercial progression is strictly monotonic with tier capability:
        // Foundation (£360K) < Enterprise (£720K) < Advanced Resilience (£1.2M) < Strategic (bespoke / £12M target).
        let foundation = plan("foundation").expect("foundation plan must exist");
        let enterprise = plan("enterprise").expect("enterprise plan must exist");
        let advanced = plan("advanced_resilience").expect("advanced_resilience plan must exist");

        assert_eq!(foundation.price_gbp, Some(360_000));
        assert_eq!(enterprise.price_gbp, Some(720_000));
        assert_eq!(advanced.price_gbp, Some(1_200_000));
        assert!(
            foundation.price_gbp.unwrap() < enterprise.price_gbp.unwrap(),
            "Foundation (£360K) must be priced below Enterprise (£720K)"
        );
        assert!(
            enterprise.price_gbp.unwrap() < advanced.price_gbp.unwrap(),
            "Enterprise (£720K) must be priced below Advanced Resilience (£1.2M)"
        );
        assert_eq!(foundation.price_display, "£360,000 / year");
        assert_eq!(enterprise.price_display, "£720,000 / year");
        assert_eq!(advanced.price_display, "£1,200,000 / year");

        // Verify entitlements are authentic and un-invented
        assert!(advanced.entitlements.contains(&"aer_kep_q"));
        assert!(advanced.entitlements.contains(&"ha"));
        assert!(advanced.entitlements.contains(&"dr"));
        assert!(advanced.entitlements.contains(&"hsm_kms"));
        assert!(!enterprise.entitlements.contains(&"aer_kep_q"));
    }

    #[test]
    fn test_billing_types_and_cadence_explicitly_modeled() {
        // Verify entry stages are fixed-fee one-off engagements
        for id in ["qcore_architecture_evaluation", "qcore_proof_of_value"] {
            let p = plan(id).unwrap();
            assert_eq!(p.billing_model, "fixed_fee");
            assert_eq!(p.billing_type, "fixed_fee");
            assert_eq!(p.billing_period, "one_off");
        }

        // Verify annual licenses are recurring subscriptions
        for id in ["foundation", "enterprise", "advanced_resilience"] {
            let p = plan(id).unwrap();
            assert_eq!(p.billing_model, "annual_license");
            assert_eq!(p.billing_type, "annual_license");
            assert_eq!(p.billing_period, "annual");
        }

        // Verify strategic is scoped engagement
        let strategic = plan("strategic").unwrap();
        assert_eq!(strategic.billing_model, "scoped");
        assert_eq!(strategic.billing_type, "scoped_engagement");
        assert_eq!(strategic.billing_period, "custom");
    }

    #[test]
    fn test_qcore_intelligence_product_separation() {
        // Enforce strict product separation:
        // All catalog plans are Q-Core substrate products, independently purchasable.
        // No Vardhan Intelligence capabilities (e.g. discovery, research crawler) are bundled.
        for p in crate::PLANS {
            assert_eq!(
                p.product, "q_core",
                "Plan {} must belong to product q_core",
                p.id
            );
            for ent in p.entitlements {
                assert!(
                    !ent.starts_with("intelligence_") && !ent.contains("discovery_crawler"),
                    "Q-Core plan {} must not bundle Vardhan Intelligence capabilities: {}",
                    p.id,
                    ent
                );
            }
        }
    }
}
