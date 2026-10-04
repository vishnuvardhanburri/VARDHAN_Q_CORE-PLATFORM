use auth_service::{AuthState, CredentialStore, RateLimiter, SessionStore};
use control_plane_api::{serve, ControlPlaneState};
use std::{env, net::SocketAddr, path::PathBuf, sync::Arc};
use tower_http::cors::CorsLayer;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt().with_target(true).json().init();
    let data_dir = PathBuf::from(env::var("VARDHAN_CONTROL_PLANE_DATA_DIR").unwrap_or_else(|_| "/var/lib/vardhan/control-plane".to_string()));
    std::fs::create_dir_all(&data_dir)?;
    let db = sled::open(data_dir.join("control-plane.sled"))?;
    let credential_store = CredentialStore::open_or_bootstrap(&data_dir.join("auth.sled"))?;
    let sessions = Arc::new(SessionStore::open(&data_dir.join("sessions.sled")).map_err(std::io::Error::other)?);
    let auth = AuthState {
        credentials: Arc::new(credential_store), sessions, rate_limiter: Arc::new(RateLimiter::new()),
        ledger: None, identity: None,
        node_id: Some(env::var("VARDHAN_NODE_ID").unwrap_or_else(|_| "control-plane".to_string())), admin_token: None,
    };
    let cors = if let Ok(origins) = env::var("VARDHAN_ALLOWED_ORIGINS") {
        let origins: Vec<_> = origins.split(',').filter_map(|v| v.trim().parse().ok()).collect();
        CorsLayer::new().allow_origins(origins)
    } else { CorsLayer::new() };
    let addr: SocketAddr = env::var("VARDHAN_CONTROL_PLANE_ADDR").unwrap_or_else(|_| "127.0.0.1:8080".to_string()).parse()?;
    serve(ControlPlaneState { db: Arc::new(db) }, auth, addr, cors).await?;
    Ok(())
}
