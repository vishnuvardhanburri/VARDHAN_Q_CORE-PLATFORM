//! Enterprise control-plane API for Vardhan Technologies.
//!
//! This service is intentionally fail-closed: browser/demo state is never treated
//! as authentication, tenant membership is server-side, and commercial entitlements
//! are resolved from verified billing state.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    middleware,
    response::IntoResponse,
    routing::{get, post},
    Extension, Json, Router,
};
use auth_service::{auth_router, middleware::AuthenticatedUser, AuthState};
use core_crypto::aer_kep_q_runtime::AerKepQRuntime;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sled::Db;
use std::{net::SocketAddr, sync::{Arc, Mutex}};
use tower_http::{cors::CorsLayer, request_id::MakeRequestUuid, trace::TraceLayer};
use uuid::Uuid;

pub mod billing;
pub mod billing_api;
pub mod operations_api;

const ORG_PREFIX: &[u8] = b"org:";
const MEMBER_PREFIX: &[u8] = b"member:";
const SUB_PREFIX: &[u8] = b"sub:";
const USAGE_PREFIX: &[u8] = b"usage:";

#[derive(Clone)]
pub struct ControlPlaneState {
    pub db: Arc<Db>,
    pub aer_kep_q: Option<Arc<Mutex<AerKepQRuntime>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Plan { pub id: &'static str, pub name: &'static str, pub tier: &'static str, pub contact_sales: bool, pub entitlements: &'static [&'static str] }

pub const PLANS: &[Plan] = &[
    Plan { id: "foundation", name: "Foundation", tier: "enterprise", contact_sales: true, entitlements: &["intelligence", "q_core", "audit", "api"] },
    Plan { id: "enterprise", name: "Enterprise", tier: "enterprise_plus", contact_sales: true, entitlements: &["intelligence", "q_core", "audit", "api", "rbac", "integrations", "compliance", "usage"] },
    Plan { id: "advanced_resilience", name: "Advanced Resilience", tier: "advanced_resilience", contact_sales: true, entitlements: &["intelligence", "q_core", "audit", "api", "rbac", "integrations", "compliance", "usage", "aer_kep_q", "ha", "dr", "hsm_kms"] },
    Plan { id: "strategic", name: "Strategic / Sovereign", tier: "strategic", contact_sales: true, entitlements: &["intelligence", "q_core", "audit", "api", "rbac", "integrations", "compliance", "usage", "aer_kep_q", "ha", "dr", "hsm_kms", "sovereign_deployment", "air_gapped", "dedicated_assurance"] },
];

#[derive(Debug, Clone, Serialize, Deserialize)]