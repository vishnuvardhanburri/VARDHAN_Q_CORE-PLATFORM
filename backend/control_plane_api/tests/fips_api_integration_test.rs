//! Integration test for FIPS 140-3 status telemetry and control plane API endpoints.

use auth_service::{session::SessionStore, store::CredentialStore, AuthState};
use control_plane_api::{router, ControlPlaneState};
use core_crypto::fips140_3::{run_power_on_self_tests, TestVerdict};
use reqwest::StatusCode;
use sled::Config;
use std::sync::Arc;
use tokio::sync::Mutex;
use tower_http::cors::CorsLayer;
use uuid::Uuid;

static FIPS_TEST_MUTEX: Mutex<()> = Mutex::const_new(());

async fn spawn_test_server() -> String {
    let rand_id = Uuid::new_v4().to_string();
    let dir_path = format!("/tmp/vardhan_test_fips_{}", rand_id);
    std::fs::create_dir_all(&dir_path).unwrap();

    let creds = Arc::new(
        CredentialStore::open(std::path::Path::new(&format!("{}/auth.db", dir_path))).unwrap(),
    );
    let sessions = Arc::new(SessionStore::new());

    let auth_state = AuthState {
        credentials: creds,
        sessions,
        mfa: None,
        mfa_policy: Arc::new(auth_service::MfaPolicy::default()),
        rate_limiter: Arc::new(auth_service::rate_limit::RateLimiter::new()),
        ledger: None,
        identity: None,
        node_id: Some("test-fips-node".to_string()),
        admin_token: None,
    };

    let db = Config::new()
        .path(format!("{}/control_plane.db", dir_path))
        .open()
        .unwrap();

    let control_state = ControlPlaneState::new_with_sled(
        Arc::new(db),
        None,
        auth_state.clone(),
        Arc::new(ha_cluster::ClusterMembership::new()),
    );

    let app = router(control_state, auth_state, CorsLayer::permissive());

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let base_url = format!("http://127.0.0.1:{}", port);

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    base_url
}

#[tokio::test]
async fn test_fips_api_operational_status() {
    let _guard = FIPS_TEST_MUTEX.lock().await;
    let _ = run_power_on_self_tests(None);
    let base_url = spawn_test_server().await;
    let client = reqwest::Client::new();

    let resp = client
        .get(format!("{}/api/v1/crypto/fips-status", base_url))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
    let json: serde_json::Value = resp.json().await.unwrap();

    assert_eq!(json["status"], "OPERATIONAL");
    assert_eq!(
        json["security_level"],
        "LEVEL_1_SOFTWARE_LEVEL_3_HSM_HYBRID"
    );
    assert_eq!(json["self_tests"]["aes_256_gcm_kat"], "Pass");
    assert_eq!(json["self_tests"]["sha3_512_kat"], "Pass");
    assert_eq!(json["self_tests"]["blake3_kat"], "Pass");
    assert_eq!(json["self_tests"]["ed25519_kat"], "Pass");
    assert_eq!(json["self_tests"]["ml_dsa_87_kat"], "Pass");
    assert_eq!(json["self_tests"]["ml_kem_1024_kat"], "Pass");
    assert_eq!(json["self_tests"]["module_integrity_kat"], "Pass");
}

#[tokio::test]
async fn test_fips_health_telemetry_includes_fips_status() {
    let _guard = FIPS_TEST_MUTEX.lock().await;
    let _ = run_power_on_self_tests(None);
    let base_url = spawn_test_server().await;
    let client = reqwest::Client::new();

    let resp = client
        .get(format!("{}/api/v1/platform/health", base_url))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
    let json: serde_json::Value = resp.json().await.unwrap();

    assert_eq!(json["service"], "vardhan-control-plane");
    assert_eq!(json["status"], "operational");
    assert_eq!(json["crypto_self_tests"], "OPERATIONAL");
    assert_eq!(json["fips_140_3_validation"], "NOT_CERTIFIED");
    assert_eq!(json["fips_140_3"]["self_test_status"], "OPERATIONAL");
    assert_eq!(json["fips_140_3"]["cmvp_validation"], "NOT_CERTIFIED");
}

#[tokio::test]
async fn test_fips_error_state_returns_service_unavailable() {
    let _guard = FIPS_TEST_MUTEX.lock().await;
    // 1. Simulate fault injection into SHA3
    let _ = run_power_on_self_tests(Some("sha3"));

    let base_url = spawn_test_server().await;
    let client = reqwest::Client::new();

    let resp = client
        .get(format!("{}/api/v1/crypto/fips-status", base_url))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::SERVICE_UNAVAILABLE);
    let json: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(json["status"], "ERROR_STATE");
    assert_eq!(json["failure_detail"]["failed_test"], "SHA3-512");

    // 2. Recover module
    let rec = run_power_on_self_tests(None).unwrap();
    assert_eq!(rec.sha3_512_kat, TestVerdict::Pass);
}
