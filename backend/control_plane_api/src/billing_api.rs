use crate::{is_member, key, plan, ControlPlaneState, Subscription};
use crate::billing::{event_key, now_secs, verify_timestamp, BillingEvent, BillingProviderAdapter, HmacBillingProvider, SubscriptionState};
use axum::{body::Bytes, extract::{Path, State}, http::{HeaderMap, StatusCode}, response::{IntoResponse, Response}, Extension, Json};
use auth_service::AuthenticatedUser;
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

fn verified_key(org_id: &str) -> Vec<u8> { key(VERIFIED_PREFIX, org_id) }

fn json_error(status: StatusCode, message: &str) -> Response { (status, Json(json!({ "error": message }))).into_response() }

pub async fn verified_entitlements(State(state): State<ControlPlaneState>, Extension(user): Extension<AuthenticatedUser>, Path(id): Path<String>) -> impl IntoResponse {
    if !is_member(&state.db, &id, &user.username).unwrap_or(false) {
        return json_error(StatusCode::FORBIDDEN, "Organization access denied.");
    }
    let Some(verified) = state.db.get(verified_key(&id)).ok().flatten().and_then(|v| serde_json::from_slice::<VerifiedBillingState>(&v).ok()) else {
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

pub async fn billing_webhook(State(state): State<ControlPlaneState>, headers: HeaderMap, body: Bytes) -> impl IntoResponse {
    let secret = match std::env::var("VARDHAN_BILLING_WEBHOOK_SECRET") {
        Ok(v) if v.len() >= 16 => v,
        _ => return json_error(StatusCode::SERVICE_UNAVAILABLE, "Billing webhook verification is not configured."),
    };
    let signature = match headers.get("x-vardhan-billing-signature").and_then(|v| v.to_str().ok()) {
        Some(v) => v,
        None => return json_error(StatusCode::UNAUTHORIZED, "Missing billing signature."),
    };
    let timestamp = match headers.get("x-vardhan-billing-timestamp").and_then(|v| v.to_str().ok()).and_then(|v| v.parse::<u64>().ok()) {
        Some(v) => v,
        None => return json_error(StatusCode::UNAUTHORIZED, "Missing or invalid billing timestamp."),
    };
    if !verify_timestamp(timestamp, now_secs()) { return json_error(StatusCode::UNAUTHORIZED, "Billing webhook timestamp outside replay window."); }
    let adapter = HmacBillingProvider;
    if !adapter.verify_signature(&body, signature, secret.as_bytes()) { return json_error(StatusCode::UNAUTHORIZED, "Invalid billing webhook signature."); }
    let event: BillingEvent = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => return json_error(StatusCode::BAD_REQUEST, "Invalid billing event payload."),
    };
    if event.timestamp != timestamp || !verify_timestamp(event.timestamp, now_secs()) { return json_error(StatusCode::UNAUTHORIZED, "Billing event timestamp mismatch."); }
    if plan(event.plan_id.as_deref().unwrap_or("foundation")).is_none() { return json_error(StatusCode::BAD_REQUEST, "Billing event references an unknown plan."); }
    if event.provider.trim().is_empty() || event.event_id.trim().is_empty() { return json_error(StatusCode::BAD_REQUEST, "Billing provider and event_id are required."); }

    let current = state.db.get(key(b"sub:", &event.organization_id)).ok().flatten().and_then(|v| serde_json::from_slice::<Subscription>(&v).ok());
    if current.is_none() { return json_error(StatusCode::NOT_FOUND, "Organization subscription not found."); }

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
        Err(_) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, "Billing state serialization failed."),
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
        Ok(false) => (StatusCode::OK, Json(json!({ "accepted": true, "duplicate": true, "event_id": event.event_id }))).into_response(),
        Ok(true) => {
            let _ = state.db.flush();
            (StatusCode::OK, Json(json!({ "accepted": true, "duplicate": false, "event_id": event.event_id }))).into_response()
        }
        Err(_) => json_error(StatusCode::INTERNAL_SERVER_ERROR, "Billing state transaction failed."),
    }
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
        db.insert(key(b"org:", "o1"), serde_json::to_vec(&Organization { id: "o1".into(), name: "O".into(), owner: "u".into(), created_at_ms: 0 }).unwrap()).unwrap();
        assert!(db.get(verified_key("o1")).unwrap().is_none());
        assert_eq!(PLANS.len(), 4);
    }
}
