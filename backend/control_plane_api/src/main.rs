use auth_service::{AuthState, CredentialStore, MfaChallengeStore, MfaService, MfaStore, RateLimiter, SessionStore};
use control_plane_api::{serve, ControlPlaneState};
use core_crypto::{aer_kep_q_runtime::{AerKepQRuntime, RuntimeStateStore}, QuantumNodeIdentity};
use ledger_persistence::HardenedLocalKeyProtector;
use std::{env, net::SocketAddr, path::PathBuf, sync::{Arc, Mutex}};
use tower_http::cors::CorsLayer;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt().with_target(true).json().init();
    let data_dir = PathBuf::from(env::var("VARDHAN_CONTROL_PLANE_DATA_DIR").unwrap_or_else(|_| "/var/lib/vardhan/control-plane".to_string()));
    std::fs::create_dir_all(&data_dir)?;
    let db = Arc::new(sled::open(data_dir.join("control-plane.sled"))?);
    let credential_store = CredentialStore::open_or_bootstrap(&data_dir.join("auth.sled"))?;
    let sessions = Arc::new(SessionStore::open(&data_dir.join("sessions.sled")).map_err(std::io::Error::other)?);

    let mfa = match env::var("VARDHAN_MFA_VAULT_PASS") {
        Ok(vault_pass) if !vault_pass.is_empty() => {
            let protector = Arc::new(HardenedLocalKeyProtector::new(vault_pass.as_bytes()));
            let mfa_store = MfaStore::open(db.clone());
            let challenges = MfaChallengeStore::open(db.clone());
            Some(Arc::new(MfaService::new(mfa_store, challenges, protector)))
        }
        _ => { tracing::warn!("MFA service not configured: set VARDHAN_MFA_VAULT_PASS through the deployment secret boundary"); None }
    };

    let auth = AuthState {
        credentials: Arc::new(credential_store), sessions, rate_limiter: Arc::new(RateLimiter::new()),
        mfa, ledger: None, identity: None,
        node_id: Some(env::var("VARDHAN_NODE_ID").unwrap_or_else(|_| "control-plane".to_string())), admin_token: None,
    };

    let aer_kep_q = match env::var("VARDHAN_AER_KEP_Q_VAULT_PASS") {
        Ok(vault_pass) if !vault_pass.is_empty() => {
            let protector = HardenedLocalKeyProtector::new(vault_pass.as_bytes());
            let identity_path = data_dir.join("aer_kep_q_identity.vault");
            let identity = Arc::new(QuantumNodeIdentity::load_or_generate(&identity_path, &protector).map_err(|e| format!("AER-KEP-Q identity load/gen failed: {e}"))?);
            let store = RuntimeStateStore::new(data_dir.join("aer-kep-q-runtime.state"), Arc::new(protector));
            let domain = env::var("VARDHAN_AER_KEP_Q_DOMAIN_ID").unwrap_or_else(|_| "control-plane".to_string());
            let runtime = AerKepQRuntime::new_persistent(domain, 1, identity, &store).map_err(|e| format!("AER-KEP-Q runtime initialization failed: {e}"))?;
            tracing::info!("AER-KEP-Q runtime attached to control plane");
            Some(Arc::new(Mutex::new(runtime)))
        }
        _ => { tracing::warn!("AER-KEP-Q runtime not attached: set VARDHAN_AER_KEP_Q_VAULT_PASS through the deployment secret boundary"); None }
    };

    let cors = if let Ok(origins) = env::var("VARDHAN_ALLOWED_ORIGINS") {
        let origins: Vec<_> = origins.split(',').filter_map(|v| v.trim().parse().ok()).collect();
        CorsLayer::new().allow_origins(origins)
    } else { CorsLayer::new() };
    let addr: SocketAddr = env::var("VARDHAN_CONTROL_PLANE_ADDR").unwrap_or_else(|_| "127.0.0.1:8080".to_string()).parse()?;
    serve(ControlPlaneState { db, aer_kep_q }, auth, addr, cors).await?;
    Ok(())
}
