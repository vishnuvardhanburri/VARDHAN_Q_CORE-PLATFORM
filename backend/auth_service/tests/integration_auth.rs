use std::sync::Arc;
use tempfile::tempdir;

use audit_ledger::LedgerWriter;
use auth_service::{
    auth_router, credentials, rate_limit::RateLimiter, session::SessionStore,
    store::CredentialStore, AuthState,
};
use core_crypto::QuantumNodeIdentity;

async fn spawn_test_server() -> (
    String,
    AuthState,
    tempfile::TempDir,
    Option<std::path::PathBuf>,
) {
    let dir = tempdir().unwrap();
    let db_path = dir.path().join("test_auth_db");
    let cred_store = CredentialStore::open(&db_path).unwrap();

    // Bootstrap user "admin" with password "super_secret_admin_pass_123"
    let phc = credentials::hash_password("super_secret_admin_pass_123").unwrap();
    cred_store.set_phc_sync("admin", &phc).unwrap();

    let sessions = Arc::new(SessionStore::new());
    let rate_limiter = Arc::new(RateLimiter::new());

    // Create durable audit ledger
    let identity = Arc::new(QuantumNodeIdentity::generate_node_identity().unwrap());
    let ledger_file = dir.path().join("audit_ledger.jsonl");
    let ledger_writer = Arc::new(LedgerWriter::open(&ledger_file, &identity).unwrap());

    let state = AuthState {
        credentials: Arc::new(cred_store),
        sessions,
        rate_limiter,
        ledger: Some(ledger_writer),
        identity: Some(identity),
        node_id: Some("node-test-1".to_string()),
        admin_token: Some("bootstrap_admin_token".to_string()),
    };

    let app = auth_router(state.clone());

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    (format!("http://{}", addr), state, dir, Some(ledger_file))
}

#[tokio::test]
async fn test_login_success_and_session_info() {
    let (base_url, _state, _dir, _ledger) = spawn_test_server().await;
    let client = reqwest::Client::new();

    // 1. Successful login
    let login_res = client
        .post(format!("{}/api/v1/auth/login", base_url))
        .json(&serde_json::json!({
            "username": "admin",
            "password": "super_secret_admin_pass_123"
        }))
        .send()
        .await
        .unwrap();

    assert_eq!(login_res.status(), reqwest::StatusCode::OK);
    let body: serde_json::Value = login_res.json().await.unwrap();
    let token = body["token"].as_str().expect("token must be a string");
    assert_eq!(token.len(), 64);
    assert_eq!(body["expires_in"], 28800);

    // 2. Query session info with valid token
    let session_res = client
        .get(format!("{}/api/v1/auth/session", base_url))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .unwrap();

    assert_eq!(session_res.status(), reqwest::StatusCode::OK);
    let session_body: serde_json::Value = session_res.json().await.unwrap();
    assert_eq!(session_body["username"], "admin");
    assert!(session_body["expires_in"].as_u64().unwrap() <= 28800);
}

#[tokio::test]
async fn test_login_wrong_password_rejected() {
    let (base_url, _state, _dir, _ledger) = spawn_test_server().await;
    let client = reqwest::Client::new();

    let res = client
        .post(format!("{}/api/v1/auth/login", base_url))
        .json(&serde_json::json!({
            "username": "admin",
            "password": "wrong_password_123"
        }))
        .send()
        .await
        .unwrap();

    assert_eq!(res.status(), reqwest::StatusCode::UNAUTHORIZED);
    let body: serde_json::Value = res.json().await.unwrap();
    assert_eq!(body["error"], "Invalid credentials");
}

#[tokio::test]
async fn test_login_unknown_user_rejected() {
    let (base_url, _state, _dir, _ledger) = spawn_test_server().await;
    let client = reqwest::Client::new();

    let res = client
        .post(format!("{}/api/v1/auth/login", base_url))
        .json(&serde_json::json!({
            "username": "non_existent_user",
            "password": "any_password_123"
        }))
        .send()
        .await
        .unwrap();

    assert_eq!(res.status(), reqwest::StatusCode::UNAUTHORIZED);
    let body: serde_json::Value = res.json().await.unwrap();
    assert_eq!(body["error"], "Invalid credentials");
}

#[tokio::test]
async fn test_rate_limiter_triggers_429_after_10_failures() {
    let (base_url, _state, _dir, _ledger) = spawn_test_server().await;
    let client = reqwest::Client::new();
    let attacking_ip = "198.51.100.42";

    // 10 failed login attempts
    for _ in 0..10 {
        let res = client
            .post(format!("{}/api/v1/auth/login", base_url))
            .header("X-Forwarded-For", attacking_ip)
            .json(&serde_json::json!({
                "username": "admin",
                "password": "bad_password"
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(res.status(), reqwest::StatusCode::UNAUTHORIZED);
    }

    // 11th attempt from same IP must return 429 Too Many Requests
    let blocked_res = client
        .post(format!("{}/api/v1/auth/login", base_url))
        .header("X-Forwarded-For", attacking_ip)
        .json(&serde_json::json!({
            "username": "admin",
            "password": "super_secret_admin_pass_123"
        }))
        .send()
        .await
        .unwrap();

    assert_eq!(blocked_res.status(), reqwest::StatusCode::TOO_MANY_REQUESTS);
    let body: serde_json::Value = blocked_res.json().await.unwrap();
    assert_eq!(body["error"], "Too many attempts. Try again later.");

    // A different IP is NOT blocked
    let innocent_ip = "198.51.100.43";
    let innocent_res = client
        .post(format!("{}/api/v1/auth/login", base_url))
        .header("X-Forwarded-For", innocent_ip)
        .json(&serde_json::json!({
            "username": "admin",
            "password": "super_secret_admin_pass_123"
        }))
        .send()
        .await
        .unwrap();

    assert_eq!(innocent_res.status(), reqwest::StatusCode::OK);
}

#[tokio::test]
async fn test_logout_revokes_session() {
    let (base_url, _state, _dir, _ledger) = spawn_test_server().await;
    let client = reqwest::Client::new();

    // 1. Login
    let login_res = client
        .post(format!("{}/api/v1/auth/login", base_url))
        .json(&serde_json::json!({
            "username": "admin",
            "password": "super_secret_admin_pass_123"
        }))
        .send()
        .await
        .unwrap();
    let body: serde_json::Value = login_res.json().await.unwrap();
    let token = body["token"].as_str().unwrap();

    // 2. Logout
    let logout_res = client
        .post(format!("{}/api/v1/auth/logout", base_url))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .unwrap();
    assert_eq!(logout_res.status(), reqwest::StatusCode::OK);
    let logout_body: serde_json::Value = logout_res.json().await.unwrap();
    assert_eq!(logout_body["status"], "logged_out");

    // 3. Subsequent session check must be rejected with 401
    let session_res = client
        .get(format!("{}/api/v1/auth/session", base_url))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .unwrap();
    assert_eq!(session_res.status(), reqwest::StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_audit_events_persisted_to_ledger() {
    let (base_url, _state, _dir, ledger_path) = spawn_test_server().await;
    let client = reqwest::Client::new();
    let ledger_file = ledger_path.unwrap();

    // Trigger LoginFailure
    let _ = client
        .post(format!("{}/api/v1/auth/login", base_url))
        .json(&serde_json::json!({
            "username": "admin",
            "password": "bad_password"
        }))
        .send()
        .await
        .unwrap();

    // Trigger LoginSuccess
    let login_res = client
        .post(format!("{}/api/v1/auth/login", base_url))
        .json(&serde_json::json!({
            "username": "admin",
            "password": "super_secret_admin_pass_123"
        }))
        .send()
        .await
        .unwrap();
    let body: serde_json::Value = login_res.json().await.unwrap();
    let token = body["token"].as_str().unwrap();

    // Trigger Logout
    let _ = client
        .post(format!("{}/api/v1/auth/logout", base_url))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .unwrap();

    // Read durable ledger content
    let content = std::fs::read_to_string(&ledger_file).unwrap();
    let lines: Vec<&str> = content.lines().filter(|l| !l.trim().is_empty()).collect();
    assert_eq!(lines.len(), 3, "Expected 3 audit events in ledger");

    let event1: serde_json::Value = serde_json::from_str(lines[0]).unwrap();
    let et1 = event1["event"]["event_type"].as_str().unwrap();
    assert!(et1 == "LoginFailure" || et1 == "LoginFailed");
    assert!(!event1["signature"].as_str().unwrap().is_empty());

    let event2: serde_json::Value = serde_json::from_str(lines[1]).unwrap();
    let et2 = event2["event"]["event_type"].as_str().unwrap();
    assert!(et2 == "LoginSuccess" || et2 == "LoginSucceeded");

    let event3: serde_json::Value = serde_json::from_str(lines[2]).unwrap();
    assert_eq!(event3["event"]["event_type"], "Logout");
}
