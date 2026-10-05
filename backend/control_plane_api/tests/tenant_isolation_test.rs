use auth_service::{AuthState, store::CredentialStore, session::SessionStore};
use control_plane_api::{router, ControlPlaneState};
use sled::Config;
use std::sync::Arc;
use tower_http::cors::CorsLayer;

async fn spawn_test_server() -> (String, ControlPlaneState, AuthState) {
    let rand_id = uuid::Uuid::new_v4().to_string();
    let dir_path = format!("/tmp/vardhan_test_cp_{}", rand_id);
    std::fs::create_dir_all(&dir_path).unwrap();

    let creds = Arc::new(CredentialStore::open(std::path::Path::new(&format!("{}/auth.db", dir_path))).unwrap());
    let sessions = Arc::new(SessionStore::new());
    
    let auth_state = AuthState {
        credentials: creds,
        sessions,
        mfa: None,
        rate_limiter: Arc::new(auth_service::rate_limit::RateLimiter::new()),
        ledger: None,
        identity: None,
        node_id: Some("test-node".to_string()),
        admin_token: None,
    };

    let db = Config::new().path(format!("{}/control_plane.db", dir_path)).open().unwrap();
    let control_state = ControlPlaneState { 
        db: Arc::new(db),
        aer_kep_q: None,
        auth: auth_state.clone(),
    };

    let app = router(control_state.clone(), auth_state.clone(), CorsLayer::permissive());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let base_url = format!("http://{}", addr);

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    (base_url, control_state, auth_state)
}

#[tokio::test]
async fn test_tenant_isolation_boundary() {
    let (base_url, _cp_state, auth_state) = spawn_test_server().await;
    let client = reqwest::Client::new();

    // Setup Users
    let phc = auth_service::credentials::hash_password("password123").unwrap();
    auth_state.credentials.set_phc_sync("alice", &phc).unwrap();
    auth_state.credentials.set_phc_sync("bob", &phc).unwrap();

    let mut p_alice = auth_state.credentials.get_profile("alice").unwrap();
    p_alice.role = "user".to_string();
    auth_state.credentials.save_profile(&p_alice).unwrap();

    let mut p_bob = auth_state.credentials.get_profile("bob").unwrap();
    p_bob.role = "user".to_string();
    auth_state.credentials.save_profile(&p_bob).unwrap();

    // Alice login
    let login_alice = client.post(format!("{}/api/v1/auth/login", base_url))
        .json(&serde_json::json!({"username":"alice","password":"password123"}))
        .send().await.unwrap();
    let mut alice_token = login_alice.json::<serde_json::Value>().await.unwrap()["token"].as_str().unwrap().to_string();

    // Bob login
    let login_bob = client.post(format!("{}/api/v1/auth/login", base_url))
        .json(&serde_json::json!({"username":"bob","password":"password123"}))
        .send().await.unwrap();
    let mut bob_token = login_bob.json::<serde_json::Value>().await.unwrap()["token"].as_str().unwrap().to_string();

    // Alice creates Org A
    let create_org_a = client.post(format!("{}/api/v1/organizations", base_url))
        .header("Authorization", format!("Bearer {}", alice_token))
        .json(&serde_json::json!({"name": "AliceCorp"}))
        .send().await.unwrap();
    alice_token = create_org_a.headers().get("authorization-new-token").unwrap().to_str().unwrap().replace("Bearer ", "");
    let org_a_id = create_org_a.json::<serde_json::Value>().await.unwrap()["organization"]["id"].as_str().unwrap().to_string();

    // Bob creates Org B
    let create_org_b = client.post(format!("{}/api/v1/organizations", base_url))
        .header("Authorization", format!("Bearer {}", bob_token))
        .json(&serde_json::json!({"name": "BobInc"}))
        .send().await.unwrap();
    bob_token = create_org_b.headers().get("authorization-new-token").unwrap().to_str().unwrap().replace("Bearer ", "");
    let org_b_id = create_org_b.json::<serde_json::Value>().await.unwrap()["organization"]["id"].as_str().unwrap().to_string();

    // TENANT ISOLATION: Alice attempts to access Bob's organization details
    let alice_reads_org_b = client.get(format!("{}/api/v1/organizations/{}", base_url, org_b_id))
        .header("Authorization", format!("Bearer {}", alice_token))
        .send().await.unwrap();
    alice_token = alice_reads_org_b.headers().get("authorization-new-token").unwrap().to_str().unwrap().replace("Bearer ", "");
    assert_eq!(alice_reads_org_b.status(), reqwest::StatusCode::FORBIDDEN, "Alice MUST NOT read Bob's Org");

    // TENANT ISOLATION: Alice attempts to access Bob's findings
    let alice_reads_findings_b = client.get(format!("{}/api/v1/organizations/{}/findings", base_url, org_b_id))
        .header("Authorization", format!("Bearer {}", alice_token))
        .send().await.unwrap();
    alice_token = alice_reads_findings_b.headers().get("authorization-new-token").unwrap().to_str().unwrap().replace("Bearer ", "");
    assert_eq!(alice_reads_findings_b.status(), reqwest::StatusCode::FORBIDDEN, "Alice MUST NOT read Bob's Findings");

    // TENANT ISOLATION: Bob attempts to read Alice's incidents
    let bob_reads_incidents_a = client.get(format!("{}/api/v1/organizations/{}/incidents", base_url, org_a_id))
        .header("Authorization", format!("Bearer {}", bob_token))
        .send().await.unwrap();
    bob_token = bob_reads_incidents_a.headers().get("authorization-new-token").unwrap().to_str().unwrap().replace("Bearer ", "");
    assert_eq!(bob_reads_incidents_a.status(), reqwest::StatusCode::FORBIDDEN, "Bob MUST NOT read Alice's Incidents");

    // TENANT ISOLATION: Alice attempts to get Bob's usage
    let alice_reads_usage_b = client.get(format!("{}/api/v1/organizations/{}/usage", base_url, org_b_id))
        .header("Authorization", format!("Bearer {}", alice_token))
        .send().await.unwrap();
    let _ = alice_reads_usage_b.headers().get("authorization-new-token").unwrap().to_str().unwrap().replace("Bearer ", "");
    assert_eq!(alice_reads_usage_b.status(), reqwest::StatusCode::FORBIDDEN, "Alice MUST NOT read Bob's Usage");

    // TENANT ISOLATION: Bob attempts to list Alice's members
    let bob_lists_members_a = client.get(format!("{}/api/v1/organizations/{}/members", base_url, org_a_id))
        .header("Authorization", format!("Bearer {}", bob_token))
        .send().await.unwrap();
    assert_eq!(bob_lists_members_a.status(), reqwest::StatusCode::FORBIDDEN, "Bob MUST NOT list Alice's members");

}
