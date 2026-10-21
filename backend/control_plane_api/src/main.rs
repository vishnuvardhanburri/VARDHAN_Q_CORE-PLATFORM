use auth_service::{
    AuthState, CredentialStore, MfaChallengeStore, MfaPolicy, MfaService, MfaStore, RateLimiter,
    SessionStore,
};
use axum::http::{header, Method};
use control_plane_api::{receipt_key_registry::ReceiptKeyRegistry, serve, ControlPlaneState};
use core_crypto::{
    aer_kep_q_runtime::{AerKepQRuntime, RuntimeStateStore},
    QuantumNodeIdentity,
};
use ledger_persistence::HardenedLocalKeyProtector;
use std::{
    env,
    net::SocketAddr,
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tower_http::cors::CorsLayer;

/// Header carrying the rotated session token on every authenticated response.
/// Exposed via CORS so browser clients can adopt rotation transparently.
pub static ROTATION_HEADER: &str = "authorization-new-token";

/// CORS policy shared by every control-plane listener that serves browsers.
///
/// `CorsLayer::new()` sends *no* CORS headers by default (tower-http 0.6):
/// without explicit `allow_headers`, preflights for JSON + Bearer requests
/// fail, and without `expose_headers` the browser hides
/// `authorization-new-token` from JS — neutering rotation adoption and
/// turning every concurrent request burst into a session self-revocation.
pub fn build_cors(origins: Vec<axum::http::HeaderValue>) -> CorsLayer {
    CorsLayer::new()
        .allow_origin(origins)
        .allow_headers([
            header::AUTHORIZATION,
            header::CONTENT_TYPE,
            header::HeaderName::from_static("idempotency-key"),
            header::HeaderName::from_static("x-request-id"),
            header::HeaderName::from_static("x-vardhan-billing-signature"),
            header::HeaderName::from_static("x-vardhan-billing-timestamp"),
        ])
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .expose_headers([
            header::AUTHORIZATION,
            header::HeaderName::from_static("authorization-new-token"),
            header::HeaderName::from_static("x-request-id"),
        ])
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt().with_target(true).json().init();
    let data_dir = PathBuf::from(
        env::var("VARDHAN_CONTROL_PLANE_DATA_DIR")
            .unwrap_or_else(|_| "/var/lib/vardhan/control-plane".to_string()),
    );
    std::fs::create_dir_all(&data_dir)?;
    let db = Arc::new(sled::open(data_dir.join("control-plane.sled"))?);
    let credential_store = CredentialStore::open_or_bootstrap(&data_dir.join("auth.sled"))?;
    let sessions = Arc::new(
        SessionStore::open(&data_dir.join("sessions.sled")).map_err(std::io::Error::other)?,
    );

    let (idempotency, storage_name): (
        Arc<dyn control_plane_api::distributed_idempotency::IdempotencyStore>,
        &'static str,
    ) = match env::var("DATABASE_URL") {
        Ok(ref db_url) if !db_url.trim().is_empty() => {
            let redacted = if let Some(idx) = db_url.find('@') {
                format!("***@{}", &db_url[idx + 1..])
            } else {
                "***".to_string()
            };
            tracing::info!(
                database_target = %redacted,
                "Initializing PostgreSQL clustered idempotency backend"
            );
            let max_pool: usize = env::var("VARDHAN_DB_POOL_MAX")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(20);
            let store = control_plane_api::distributed_idempotency::PostgresIdempotencyStore::from_database_url(
                db_url,
                max_pool,
            )
            .await
            .map_err(|e| {
                tracing::error!(
                    error = %e,
                    "CRITICAL: PostgreSQL connection or migration failed during startup. Clustered mode cannot continue."
                );
                std::io::Error::new(std::io::ErrorKind::ConnectionRefused, e.to_string())
            })?;
            (Arc::new(store), "postgresql_cluster")
        }
        _ => {
            tracing::info!(
                "DATABASE_URL unset; operating with embedded single-node sled idempotency engine"
            );
            (
                Arc::new(
                    control_plane_api::distributed_idempotency::SledIdempotencyStore::new(
                        db.clone(),
                    ),
                ),
                "sled_embedded",
            )
        }
    };
    tracing::info!(
        storage_backend = storage_name,
        "Idempotency subsystem active"
    );

    let node_id_str =
        env::var("VARDHAN_NODE_ID").unwrap_or_else(|_| "control-plane-01".to_string());
    let cluster = Arc::new(ha_cluster::ClusterMembership::new());
    let self_node_id = ha_cluster::NodeId::new(node_id_str.clone());
    let self_addr: SocketAddr = env::var("VARDHAN_CONTROL_PLANE_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:8080".to_string())
        .parse()
        .unwrap_or_else(|_| "127.0.0.1:8080".parse().unwrap());
    cluster.register_self(self_node_id, self_addr, 8081).await;

    if let Ok(peers) = env::var("VARDHAN_CLUSTER_PEERS") {
        for peer_spec in peers.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()) {
            if let Some((p_id, p_addr)) = peer_spec.split_once('=') {
                if let Ok(addr) = p_addr.parse() {
                    cluster
                        .register_self(ha_cluster::NodeId::new(p_id), addr, 8081)
                        .await;
                    tracing::info!(peer_id = %p_id, peer_addr = %p_addr, "Registered HA cluster peer");
                }
            }
        }
    }

    let mfa = match env::var("VARDHAN_MFA_VAULT_PASS") {
        Ok(vault_pass) if !vault_pass.is_empty() => {
            let protector = Arc::new(HardenedLocalKeyProtector::new(vault_pass.as_bytes()));
            let mfa_store = MfaStore::open(db.clone());
            let challenges = MfaChallengeStore::open(db.clone());
            Some(Arc::new(MfaService::new(mfa_store, challenges, protector)))
        }
        _ => {
            tracing::warn!("MFA service not configured: set VARDHAN_MFA_VAULT_PASS through the deployment secret boundary");
            None
        }
    };

    let mfa_policy = Arc::new(MfaPolicy::new(
        env::var("VARDHAN_MFA_ENFORCE")
            .map(|v| v == "true" || v == "1")
            .unwrap_or_else(|_| env::var("VARDHAN_ENV").unwrap_or_default() == "production"),
    ));

    let auth = AuthState {
        credentials: Arc::new(credential_store),
        sessions,
        rate_limiter: Arc::new(RateLimiter::with_db(&db)),
        mfa,
        mfa_policy,
        ledger: None,
        identity: None,
        node_id: Some(env::var("VARDHAN_NODE_ID").unwrap_or_else(|_| "control-plane".to_string())),
        admin_token: None,
    };

    let registry = ReceiptKeyRegistry::new(db.clone());
    if let Ok(value) = env::var("VARDHAN_QCORE_ISSUER_REGISTRY_JSON") {
        let count = registry
            .bootstrap_json(&value)
            .map_err(|e| format!("Q-Core issuer registry bootstrap failed: {e}"))?;
        tracing::info!(
            issuer_keys = count,
            "Q-Core issuer key registry bootstrapped"
        );
    } else {
        tracing::warn!("Q-Core issuer registry not bootstrapped: set VARDHAN_QCORE_ISSUER_REGISTRY_JSON through deployment configuration");
    }
    if env::var("VARDHAN_QCORE_SERVICE_SECRET")
        .map(|v| v.is_empty())
        .unwrap_or(true)
    {
        tracing::warn!("Q-Core service transport disabled until VARDHAN_QCORE_SERVICE_SECRET is provided through the deployment secret boundary");
    }

    let aer_kep_q = match env::var("VARDHAN_AER_KEP_Q_VAULT_PASS") {
        Ok(vault_pass) if !vault_pass.is_empty() => {
            let protector = HardenedLocalKeyProtector::new(vault_pass.as_bytes());
            let identity_path = data_dir.join("aer_kep_q_identity.vault");
            let identity = Arc::new(
                QuantumNodeIdentity::load_or_generate(&identity_path, &protector)
                    .map_err(|e| format!("AER-KEP-Q identity load/gen failed: {e}"))?,
            );
            let store = RuntimeStateStore::new(
                data_dir.join("aer-kep-q-runtime.state"),
                Arc::new(protector),
            );
            let domain = env::var("VARDHAN_AER_KEP_Q_DOMAIN_ID")
                .unwrap_or_else(|_| "control-plane".to_string());
            let runtime = AerKepQRuntime::new_persistent(domain, 1, identity, &store)
                .map_err(|e| format!("AER-KEP-Q runtime initialization failed: {e}"))?;
            tracing::info!("AER-KEP-Q runtime attached to control plane");
            Some(Arc::new(Mutex::new(runtime)))
        }
        _ => {
            tracing::warn!("AER-KEP-Q runtime not attached: set VARDHAN_AER_KEP_Q_VAULT_PASS through the deployment secret boundary");
            None
        }
    };

    let cors = if let Ok(origins) = env::var("VARDHAN_ALLOWED_ORIGINS") {
        let origins: Vec<_> = origins
            .split(',')
            .filter_map(|v| {
                let s = v.trim();
                if s.is_empty() {
                    return None;
                }
                match s.parse() {
                    Ok(val) => Some(val),
                    Err(e) => {
                        tracing::warn!(origin = %s, error = %e, "Invalid CORS origin in VARDHAN_ALLOWED_ORIGINS, dropped");
                        None
                    }
                }
            })
            .collect();
        build_cors(origins)
    } else {
        if env::var("VARDHAN_ENV").as_deref() == Ok("production") {
            tracing::error!(
                "FATAL: VARDHAN_ALLOWED_ORIGINS must be explicitly configured in production."
            );
            return Err("VARDHAN_ALLOWED_ORIGINS must be set in production".into());
        }
        tracing::warn!(
            "VARDHAN_ALLOWED_ORIGINS unset in development; defaulting to localhost:3000/5173/8080"
        );
        build_cors(vec![
            "http://localhost:3000".parse()?,
            "http://127.0.0.1:3000".parse()?,
            "http://localhost:5173".parse()?,
            "http://127.0.0.1:5173".parse()?,
            "http://localhost:8080".parse()?,
            "http://127.0.0.1:8080".parse()?,
        ])
    };
    let addr: SocketAddr = env::var("VARDHAN_CONTROL_PLANE_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:8080".to_string())
        .parse()?;
    serve(
        ControlPlaneState {
            db,
            aer_kep_q,
            auth: auth.clone(),
            cluster,
            idempotency,
        },
        auth,
        addr,
        cors,
    )
    .await?;
    Ok(())
}
