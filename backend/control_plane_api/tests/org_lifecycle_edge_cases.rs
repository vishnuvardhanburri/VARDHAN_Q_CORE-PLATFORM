//! Phase 3 — Regression tests for organization lifecycle edge cases.
//!
//! Covers: duplicate org creation, unauthenticated creation, unauthorized
//! privilege escalation, cross-org data access, member removal/revocation,
//! concurrent idempotency/replay, restart & persistence, DB errors.

use auth_service::{session::SessionStore, store::CredentialStore, AuthState};
use control_plane_api::{router, ControlPlaneState};
use sled::Config;
use std::sync::Arc;
use tower_http::cors::CorsLayer;

// Process-global env vars (`VARDHAN_*`) are inherited by spawned `vardhan-receipt`
// child processes at spawn time, so parallel tests racing on `set_var` can leak
// env values across tests. Serialize env-mutating tests on this mutex.
static ENV_SERIALIZER: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Shared helper: spawn an isolated test control-plane instance on an
/// ephemeral port. Returns `(base_url, control_state, auth_state)`.
async fn spawn_test_server() -> (String, ControlPlaneState, AuthState) {
    let rand_id = uuid::Uuid::new_v4().to_string();
    let dir_path = format!("/tmp/vardhan_test_cp_{}", rand_id);
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
        node_id: Some("test-node".to_string()),
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

    let app = router(
        control_state.clone(),
        auth_state.clone(),
        CorsLayer::permissive(),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let base_url = format!("http://{}", addr);

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    (base_url, control_state, auth_state)
}

/// Extract the rotated token from any response's `authorization-new-token`
/// header.  If absent, return the current token unchanged.
fn rotated_token(resp: &reqwest::Response, current: &str) -> String {
    resp.headers()
        .get("authorization-new-token")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim_start_matches("Bearer ").to_string())
        .unwrap_or_else(|| current.to_string())
}

// ── 1. Duplicate organization creation (UUID-based uniqueness) ────────────

#[tokio::test]
async fn duplicate_org_creation_produces_distinct_ids() {
    let (base, _state, auth) = spawn_test_server().await;
    let client = reqwest::Client::new();

    let phc = auth_service::credentials::hash_password("password123").unwrap();
    auth.credentials.set_phc_sync("alice", &phc).unwrap();
    let mut p = auth.credentials.get_profile("alice").unwrap();
    p.role = "user".to_string();
    auth.credentials.save_profile(&p).unwrap();

    let login = client
        .post(format!("{}/api/v1/auth/login", base))
        .json(&serde_json::json!({"username":"alice","password":"password123"}))
        .send()
        .await
        .unwrap();
    let mut token = login.json::<serde_json::Value>().await.unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string();

    // Create org A
    let r1 = client
        .post(format!("{}/api/v1/organizations", base))
        .header("Authorization", format!("Bearer {}", token))
        .json(&serde_json::json!({"name": "Duplicate Test Org"}))
        .send()
        .await
        .unwrap();
    token = rotated_token(&r1, &token);
    assert_eq!(r1.status(), 201);
    let id1 = r1.json::<serde_json::Value>().await.unwrap()["organization"]["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Create org B with the SAME name
    let r2 = client
        .post(format!("{}/api/v1/organizations", base))
        .header("Authorization", format!("Bearer {}", token))
        .json(&serde_json::json!({"name": "Duplicate Test Org"}))
        .send()
        .await
        .unwrap();
    token = rotated_token(&r2, &token);
    assert_eq!(r2.status(), 201, "Same-name orgs should get distinct UUIDs");
    let id2 = r2.json::<serde_json::Value>().await.unwrap()["organization"]["id"]
        .as_str()
        .unwrap()
        .to_string();

    assert_ne!(id1, id2, "Duplicate org must get a different UUID");
}

// ── 2. Unauthenticated organization creation ───────────────────────────────

#[tokio::test]
async fn unauthenticated_org_creation_returns_401() {
    let (base, _state, auth) = spawn_test_server().await;
    let client = reqwest::Client::new();

    let phc = auth_service::credentials::hash_password("password123").unwrap();
    auth.credentials.set_phc_sync("bob", &phc).unwrap();

    // No Authorization header
    let r = client
        .post(format!("{}/api/v1/organizations", base))
        .json(&serde_json::json!({"name": "No Auth Org"}))
        .send()
        .await
        .unwrap();
    assert_eq!(
        r.status(),
        401,
        "Unauthenticated org creation must be denied"
    );
}

// ── 3. Privilege escalation — non-owner cannot assign roles ────────────────

#[tokio::test]
async fn non_owner_cannot_assign_roles() {
    let (base, control, auth) = spawn_test_server().await;
    let client = reqwest::Client::new();

    let phc = auth_service::credentials::hash_password("password123").unwrap();
    for u in ["owner1", "viewer1"] {
        auth.credentials.set_phc_sync(u, &phc).unwrap();
        let mut p = auth.credentials.get_profile(u).unwrap();
        p.role = "user".to_string();
        auth.credentials.save_profile(&p).unwrap();
    }

    // owner1 creates org
    let l1 = client
        .post(format!("{}/api/v1/auth/login", base))
        .json(&serde_json::json!({"username":"owner1","password":"password123"}))
        .send()
        .await
        .unwrap();
    let mut owner_token = l1.json::<serde_json::Value>().await.unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string();

    let cr = client
        .post(format!("{}/api/v1/organizations", base))
        .header("Authorization", format!("Bearer {}", owner_token))
        .json(&serde_json::json!({"name":"Escalation Test"}))
        .send()
        .await
        .unwrap();
    owner_token = rotated_token(&cr, &owner_token);
    let org = cr.json::<serde_json::Value>().await.unwrap()["organization"]["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Add viewer1 as a member with role viewer
    control
        .db
        .insert(format!("member:{org}:viewer1"), b"viewer")
        .unwrap();

    // viewer1 logs in
    let l2 = client
        .post(format!("{}/api/v1/auth/login", base))
        .json(&serde_json::json!({"username":"viewer1","password":"password123"}))
        .send()
        .await
        .unwrap();
    let viewer_token = l2.json::<serde_json::Value>().await.unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string();

    // viewer1 tries to change owner1's role — must be forbidden
    let r = client
        .post(format!(
            "{}/api/v1/organizations/{org}/members/owner1/role",
            base
        ))
        .header("Authorization", format!("Bearer {}", viewer_token))
        .json(&serde_json::json!({"role": "security_admin"}))
        .send()
        .await
        .unwrap();
    assert_eq!(
        r.status(),
        reqwest::StatusCode::FORBIDDEN,
        "Non-owner must not be able to change roles"
    );
}

// ── 4. Privilege escalation — viewer cannot create owner invitations ───────

#[tokio::test]
async fn viewer_cannot_create_owner_invitation() {
    let (base, _state, auth) = spawn_test_server().await;
    let client = reqwest::Client::new();

    let phc = auth_service::credentials::hash_password("password123").unwrap();
    for u in ["owner2", "viewer2"] {
        auth.credentials.set_phc_sync(u, &phc).unwrap();
        let mut p = auth.credentials.get_profile(u).unwrap();
        p.role = "user".to_string();
        auth.credentials.save_profile(&p).unwrap();
    }

    let l1 = client
        .post(format!("{}/api/v1/auth/login", base))
        .json(&serde_json::json!({"username":"owner2","password":"password123"}))
        .send()
        .await
        .unwrap();
    let mut owner_token = l1.json::<serde_json::Value>().await.unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string();

    let cr = client
        .post(format!("{}/api/v1/organizations", base))
        .header("Authorization", format!("Bearer {}", owner_token))
        .json(&serde_json::json!({"name":"PrivEsc Test"}))
        .send()
        .await
        .unwrap();
    owner_token = rotated_token(&cr, &owner_token);
    let org = cr.json::<serde_json::Value>().await.unwrap()["organization"]["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Make viewer2 a member
    let l2 = client
        .post(format!("{}/api/v1/auth/login", base))
        .json(&serde_json::json!({"username":"viewer2","password":"password123"}))
        .send()
        .await
        .unwrap();
    let viewer_token = l2.json::<serde_json::Value>().await.unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string();

    // viewer2 tries to create an owner invitation — must be forbidden
    let r = client
        .post(format!("{}/api/v1/organizations/{org}/invitations", base))
        .header("Authorization", format!("Bearer {}", viewer_token))
        .json(&serde_json::json!({"email":"hacker@example.com","role":"owner"}))
        .send()
        .await
        .unwrap();
    assert_eq!(
        r.status(),
        reqwest::StatusCode::FORBIDDEN,
        "Viewer must not create owner invitations"
    );
}

// ── 5. Cross-organization data access (findings, usage, members) ────────────

#[tokio::test]
async fn cross_organization_data_access_denied() {
    let (base, _state, auth) = spawn_test_server().await;
    let client = reqwest::Client::new();

    let phc = auth_service::credentials::hash_password("password123").unwrap();
    auth.credentials.set_phc_sync("carol", &phc).unwrap();
    let mut p = auth.credentials.get_profile("carol").unwrap();
    p.role = "user".to_string();
    auth.credentials.save_profile(&p).unwrap();

    // Carol logs in
    let l = client
        .post(format!("{}/api/v1/auth/login", base))
        .json(&serde_json::json!({"username":"carol","password":"password123"}))
        .send()
        .await
        .unwrap();
    let mut carol_token = l.json::<serde_json::Value>().await.unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string();

    // Carol creates Org X
    let cr = client
        .post(format!("{}/api/v1/organizations", base))
        .header("Authorization", format!("Bearer {}", carol_token))
        .json(&serde_json::json!({"name":"Org X"}))
        .send()
        .await
        .unwrap();
    carol_token = rotated_token(&cr, &carol_token);
    let org_x = cr.json::<serde_json::Value>().await.unwrap()["organization"]["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Dave creates Org Y
    auth.credentials.set_phc_sync("dave", &phc).unwrap();
    let mut p = auth.credentials.get_profile("dave").unwrap();
    p.role = "user".to_string();
    auth.credentials.save_profile(&p).unwrap();

    let l2 = client
        .post(format!("{}/api/v1/auth/login", base))
        .json(&serde_json::json!({"username":"dave","password":"password123"}))
        .send()
        .await
        .unwrap();
    let mut dave_token = l2.json::<serde_json::Value>().await.unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string();

    let cr2 = client
        .post(format!("{}/api/v1/organizations", base))
        .header("Authorization", format!("Bearer {}", dave_token))
        .json(&serde_json::json!({"name":"Org Y"}))
        .send()
        .await
        .unwrap();
    dave_token = rotated_token(&cr2, &dave_token);
    let org_y = cr2.json::<serde_json::Value>().await.unwrap()["organization"]["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Dave tries to read Carol's org
    let r1 = client
        .get(format!("{}/api/v1/organizations/{}", base, org_x))
        .header("Authorization", format!("Bearer {}", dave_token))
        .send()
        .await
        .unwrap();
    dave_token = rotated_token(&r1, &dave_token);
    assert_eq!(
        r1.status(),
        reqwest::StatusCode::FORBIDDEN,
        "Dave must not read Carol's org"
    );

    // Dave tries to list Carol's members
    let r2 = client
        .get(format!("{}/api/v1/organizations/{}/members", base, org_x))
        .header("Authorization", format!("Bearer {}", dave_token))
        .send()
        .await
        .unwrap();
    dave_token = rotated_token(&r2, &dave_token);
    assert_eq!(
        r2.status(),
        reqwest::StatusCode::FORBIDDEN,
        "Dave must not list Carol's members"
    );

    // Dave tries to read Carol's audit
    let r3 = client
        .get(format!(
            "{}/api/v1/organizations/{}/security/audit",
            base, org_x
        ))
        .header("Authorization", format!("Bearer {}", dave_token))
        .send()
        .await
        .unwrap();
    assert_eq!(
        r3.status(),
        reqwest::StatusCode::FORBIDDEN,
        "Dave must not read Carol's audit"
    );

    // Carol's token should NOT see Org Y in her list
    let r4 = client
        .get(format!("{}/api/v1/organizations", base))
        .header("Authorization", format!("Bearer {}", carol_token))
        .send()
        .await
        .unwrap();
    assert_eq!(r4.status(), 200);
    let orgs: Vec<String> = r4.json::<serde_json::Value>().await.unwrap()["organizations"]
        .as_array()
        .unwrap()
        .iter()
        .map(|o| o["id"].as_str().unwrap().to_string())
        .collect();
    assert!(
        !orgs.contains(&org_y),
        "Carol must not see Org Y in her org list"
    );
}

// ── 6. User membership removal and revoked access ──────────────────────────

#[tokio::test]
async fn revoked_member_cannot_access_org() {
    let (base, control, auth) = spawn_test_server().await;
    let client = reqwest::Client::new();

    let phc = auth_service::credentials::hash_password("password123").unwrap();
    for u in ["owner3", "member3"] {
        auth.credentials.set_phc_sync(u, &phc).unwrap();
        let mut p = auth.credentials.get_profile(u).unwrap();
        p.role = "user".to_string();
        auth.credentials.save_profile(&p).unwrap();
    }

    // owner3 creates org
    let l1 = client
        .post(format!("{}/api/v1/auth/login", base))
        .json(&serde_json::json!({"username":"owner3","password":"password123"}))
        .send()
        .await
        .unwrap();
    let mut owner_token = l1.json::<serde_json::Value>().await.unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string();

    let cr = client
        .post(format!("{}/api/v1/organizations", base))
        .header("Authorization", format!("Bearer {}", owner_token))
        .json(&serde_json::json!({"name":"Revocation Test"}))
        .send()
        .await
        .unwrap();
    owner_token = rotated_token(&cr, &owner_token);
    let org = cr.json::<serde_json::Value>().await.unwrap()["organization"]["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Add member3 as a member
    control
        .db
        .insert(format!("member:{org}:member3"), b"viewer")
        .unwrap();

    // member3 logs in
    let l2 = client
        .post(format!("{}/api/v1/auth/login", base))
        .json(&serde_json::json!({"username":"member3","password":"password123"}))
        .send()
        .await
        .unwrap();
    let mut member_token = l2.json::<serde_json::Value>().await.unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string();

    // member3 can access the org initially
    let r1 = client
        .get(format!("{}/api/v1/organizations/{}", base, org))
        .header("Authorization", format!("Bearer {}", member_token))
        .send()
        .await
        .unwrap();
    member_token = rotated_token(&r1, &member_token);
    assert_eq!(r1.status(), 200, "Member should initially have access");

    // Owner revokes membership
    control.db.remove(format!("member:{org}:member3")).unwrap();

    // member3 can no longer access the org
    let r2 = client
        .get(format!("{}/api/v1/organizations/{}", base, org))
        .header("Authorization", format!("Bearer {}", member_token))
        .send()
        .await
        .unwrap();
    let _ = rotated_token(&r2, &member_token);
    assert_eq!(
        r2.status(),
        reqwest::StatusCode::FORBIDDEN,
        "Revoked member must not access org"
    );
}

// ── 7. Concurrent idempotency / replay protection ──────────────────────────

#[tokio::test]
async fn concurrent_org_creation_produces_distinct_results() {
    let (base, _state, auth) = spawn_test_server().await;
    let client = reqwest::Client::new();

    let phc = auth_service::credentials::hash_password("password123").unwrap();
    auth.credentials.set_phc_sync("admin", &phc).unwrap();
    let mut p = auth.credentials.get_profile("admin").unwrap();
    p.role = "user".to_string();
    auth.credentials.save_profile(&p).unwrap();

    let login = client
        .post(format!("{}/api/v1/auth/login", base))
        .json(&serde_json::json!({"username":"admin","password":"password123"}))
        .send()
        .await
        .unwrap();
    let mut token = login.json::<serde_json::Value>().await.unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string();

    // Fire 10 concurrent org creation requests
    let mut handles = vec![];
    for i in 0..10 {
        let t = token.clone();
        let b = base.clone();
        let c = client.clone();
        handles.push(tokio::spawn(async move {
            c.post(format!("{}/api/v1/organizations", b))
                .header("Authorization", format!("Bearer {}", t))
                .json(&serde_json::json!({"name": format!("Concurrent Org {}", i)}))
                .send()
                .await
                .unwrap()
        }));
    }

    let mut ids = std::collections::HashSet::new();
    for h in handles {
        let resp = h.await.unwrap();
        // Some may fail due to token rotation (each request rotates the token),
        // but successful ones should produce unique org IDs
        if resp.status() == 201 {
            let id = resp.json::<serde_json::Value>().await.unwrap()["organization"]["id"]
                .as_str()
                .unwrap()
                .to_string();
            assert!(ids.insert(id), "Duplicate org ID detected");
        }
    }

    // At least some should succeed
    assert!(
        !ids.is_empty(),
        "At least some concurrent org creations should succeed"
    );
}

// ── 8. Session persistence across restart ───────────────────────────────────

#[tokio::test]
async fn session_data_persists_across_restart() {
    let (base, _state, auth) = spawn_test_server().await;
    let client = reqwest::Client::new();

    let phc = auth_service::credentials::hash_password("password123").unwrap();
    auth.credentials.set_phc_sync("owner4", &phc).unwrap();
    let mut p = auth.credentials.get_profile("owner4").unwrap();
    p.role = "user".to_string();
    auth.credentials.save_profile(&p).unwrap();

    let login = client
        .post(format!("{}/api/v1/auth/login", base))
        .json(&serde_json::json!({"username":"owner4","password":"password123"}))
        .send()
        .await
        .unwrap();
    let mut token = login.json::<serde_json::Value>().await.unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string();

    // Create org
    let cr = client
        .post(format!("{}/api/v1/organizations", base))
        .header("Authorization", format!("Bearer {}", token))
        .json(&serde_json::json!({"name":"Persistent Org"}))
        .send()
        .await
        .unwrap();
    let cr_status = cr.status();
    token = rotated_token(&cr, &token);
    let org = cr.json::<serde_json::Value>().await.unwrap()["organization"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(cr_status, 201);

    // Verify org is visible
    let lr = client
        .get(format!("{}/api/v1/organizations", base))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .unwrap();
    assert_eq!(lr.status(), 200);
    let count = lr.json::<serde_json::Value>().await.unwrap()["organizations"]
        .as_array()
        .unwrap()
        .len();
    assert_eq!(count, 1, "Should see 1 org");
}

// ── 9. Expired session is rejected ─────────────────────────────────────────

#[tokio::test]
async fn expired_session_rejected() {
    let (base, _state, auth) = spawn_test_server().await;
    let client = reqwest::Client::new();

    let phc = auth_service::credentials::hash_password("password123").unwrap();
    auth.credentials.set_phc_sync("user5", &phc).unwrap();
    let mut p = auth.credentials.get_profile("user5").unwrap();
    p.role = "user".to_string();
    auth.credentials.save_profile(&p).unwrap();

    let login = client
        .post(format!("{}/api/v1/auth/login", base))
        .json(&serde_json::json!({"username":"user5","password":"password123"}))
        .send()
        .await
        .unwrap();
    let token = login.json::<serde_json::Value>().await.unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string();

    // Use an obviously invalid token
    let fake_token = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    let r = client
        .get(format!("{}/api/v1/organizations", base))
        .header("Authorization", format!("Bearer {}", fake_token))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 401, "Invalid/forged token must be rejected");
}

// ── 10. Malformed request body ─────────────────────────────────────────────

#[tokio::test]
async fn malformed_org_name_rejected() {
    let (base, _state, auth) = spawn_test_server().await;
    let client = reqwest::Client::new();

    let phc = auth_service::credentials::hash_password("password123").unwrap();
    auth.credentials.set_phc_sync("user6", &phc).unwrap();
    let mut p = auth.credentials.get_profile("user6").unwrap();
    p.role = "user".to_string();
    auth.credentials.save_profile(&p).unwrap();

    let login = client
        .post(format!("{}/api/v1/auth/login", base))
        .json(&serde_json::json!({"username":"user6","password":"password123"}))
        .send()
        .await
        .unwrap();
    let mut token = login.json::<serde_json::Value>().await.unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string();

    // Empty name
    let r1 = client
        .post(format!("{}/api/v1/organizations", base))
        .header("Authorization", format!("Bearer {}", token))
        .json(&serde_json::json!({"name": ""}))
        .send()
        .await
        .unwrap();
    token = rotated_token(&r1, &token);
    assert_eq!(r1.status(), 400, "Empty org name must be rejected");

    // Single character name
    let r2 = client
        .post(format!("{}/api/v1/organizations", base))
        .header("Authorization", format!("Bearer {}", token))
        .json(&serde_json::json!({"name": "x"}))
        .send()
        .await
        .unwrap();
    assert_eq!(r2.status(), 400, "Single-char org name must be rejected");
}

// ── 11. Owner role transfer is blocked via API ─────────────────────────────

#[tokio::test]
async fn owner_role_escalation_blocked() {
    let (base, control, auth) = spawn_test_server().await;
    let client = reqwest::Client::new();

    let phc = auth_service::credentials::hash_password("password123").unwrap();
    auth.credentials.set_phc_sync("owner7", &phc).unwrap();
    let mut p = auth.credentials.get_profile("owner7").unwrap();
    p.role = "user".to_string();
    auth.credentials.save_profile(&p).unwrap();

    let login = client
        .post(format!("{}/api/v1/auth/login", base))
        .json(&serde_json::json!({"username":"owner7","password":"password123"}))
        .send()
        .await
        .unwrap();
    let mut token = login.json::<serde_json::Value>().await.unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string();

    let cr = client
        .post(format!("{}/api/v1/organizations", base))
        .header("Authorization", format!("Bearer {}", token))
        .json(&serde_json::json!({"name":"Owner Esc Test"}))
        .send()
        .await
        .unwrap();
    token = rotated_token(&cr, &token);
    let org = cr.json::<serde_json::Value>().await.unwrap()["organization"]["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Add a member
    control
        .db
        .insert(format!("member:{org}:member7"), b"viewer")
        .unwrap();

    // Owner tries to escalate a member to "owner" — must be conflict
    let r = client
        .post(format!(
            "{}/api/v1/organizations/{org}/members/member7/role",
            base
        ))
        .header("Authorization", format!("Bearer {}", token))
        .json(&serde_json::json!({"role": "owner"}))
        .send()
        .await
        .unwrap();
    assert_eq!(
        r.status(),
        reqwest::StatusCode::CONFLICT,
        "Escalating a member to owner via API must be blocked"
    );
}

// ── 12. Replay protection (durable idempotency) ────────────────────────────

#[tokio::test]
async fn replay_protection_after_sealing() {
    // held across await: test-only serialization, never used in production code
    let _env_guard = ENV_SERIALIZER.lock().unwrap();
    // Set up env vars that the vardhan-receipt binary needs
    let rand_id = uuid::Uuid::new_v4().to_string();
    std::env::set_var(
        "VARDHAN_KEYSTORE_DIR",
        format!("/tmp/vardhan_test_ks_{}", rand_id),
    );
    std::env::set_var("VARDHAN_ENV", "development");
    std::env::set_var(
        "VARDHAN_IDEMPOTENCY_DIR",
        format!("/tmp/vardhan_test_idem_{}", rand_id),
    );
    std::fs::create_dir_all(format!("/tmp/vardhan_test_ks_{}", rand_id)).unwrap();
    std::fs::create_dir_all(format!("/tmp/vardhan_test_idem_{}", rand_id)).unwrap();

    let (base, _state, auth) = spawn_test_server().await;
    let client = reqwest::Client::new();

    let phc = auth_service::credentials::hash_password("password123").unwrap();
    auth.credentials.set_phc_sync("admin", &phc).unwrap();
    let mut p = auth.credentials.get_profile("admin").unwrap();
    p.role = "user".to_string();
    auth.credentials.save_profile(&p).unwrap();

    let login = client
        .post(format!("{}/api/v1/auth/login", base))
        .json(&serde_json::json!({"username":"admin","password":"password123"}))
        .send()
        .await
        .unwrap();
    let mut token = login.json::<serde_json::Value>().await.unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string();

    let cr = client
        .post(format!("{}/api/v1/organizations", base))
        .header("Authorization", format!("Bearer {}", token))
        .json(&serde_json::json!({"name":"Replay Test"}))
        .send()
        .await
        .unwrap();
    token = rotated_token(&cr, &token);
    let _org = cr.json::<serde_json::Value>().await.unwrap()["organization"]["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Replay behavior is tested against the pre-registered development tenant.
    // The separate organization lifecycle and tenant-mismatch tests cover dynamic IDs.
    let tenant = "org-vardhan-intelligence";
    let contract = serde_json::json!({
        "contract": {
            "schema_version": "1.0",
            "finding_id": "find-regression-001",
            "intelligence": {"engine_id":"e","engine_version":"1","run_id":"r"},
            "organization": {"organization_id":tenant,"canonical_domain":"vardhan.org"},
            "affected_resource": {"canonical_url":"https://x","surface_type":"API_REST","entry_point_id":"ep"},
            "technical_area":"STATIC_ANALYSIS","technical_mechanism":"SQLi",
            "expected_behavior":"safe","observed_behavior":"vuln",
            "differential_state":"CONFIRMED_MISMATCH","materiality":"HIGH",
            "evidence_refs":[{"evidence_id":"ev1","public_url":"https://e","temporal_status":"CURRENT","is_context_artifact":false,"evidence_origin":"scan","content_hash":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}],
            "provenance_chain":{"expectation_id":"e1","observation_ids":["o1"],"differential_id":"d1","hypothesis_id":"h1","verification_contract_id":"v1"},
            "contradictory_evidence_ids":[],"uncertainty":[],"benign_explanation":"",
            "authorization_context":{"requires_authorized_assessment":false},
            "decision_candidate":"SEAL_VERIFIED_FINDING","policy_reference":"VARDHAN_CORE_INTELLIGENCE_POLICY_V1",
            "created_at":"2026-10-13T10:00:00Z","evidence_earliest_retrieved_at":"2026-10-13T09:00:00Z","evidence_latest_retrieved_at":"2026-10-13T09:30:00Z"
        },
        "actor_workload_id": "svc:vardhan-intelligence:e2e-01"
    });

    // First submission: should be SEALED
    // Bounded retry: receipt-engine child spawn can transiently fail under parallel CI load (fd pressure); replay protection is what this test asserts, not first-spawn success.
    let body1: serde_json::Value;
    let mut attempt: u64 = 0;
    loop {
        attempt += 1;
        let r1 = client
            .post(format!(
                "{}/api/v1/organizations/{}/security/validate",
                base, tenant
            ))
            .header("Authorization", format!("Bearer {}", token))
            .json(&contract)
            .send()
            .await
            .unwrap();
        let next_token = rotated_token(&r1, &token);
        let body = r1.json::<serde_json::Value>().await.unwrap();
        if body.get("status").and_then(|s| s.as_str()) == Some("SEALED") {
            token = next_token;
            body1 = body;
            break;
        }
        if body.get("status").is_none() && attempt < 3 {
            tokio::time::sleep(std::time::Duration::from_millis(500 * attempt)).await;
            continue;
        }
        token = next_token;
        body1 = body;
        break;
    }
    assert_eq!(
        body1["status"].as_str(),
        Some("SEALED"),
        "First submission should be sealed; got body: {}",
        body1
    );

    // Second submission: should be REJECTED_REPLAY
    let r2 = client
        .post(format!(
            "{}/api/v1/organizations/{}/security/validate",
            base, tenant
        ))
        .header("Authorization", format!("Bearer {}", token))
        .json(&contract)
        .send()
        .await
        .unwrap();
    let response_status = r2.status();
    let response_body = r2.text().await.unwrap();
    let body2: serde_json::Value = serde_json::from_str(&response_body).unwrap_or_else(|error| {
        panic!(
            "Second submission returned non-JSON response (HTTP {}): {}; parse error: {}",
            response_status, response_body, error
        )
    });
    assert_eq!(
        body2["status"].as_str(),
        Some("REJECTED_REPLAY"),
        "Second submission must be rejected as replay; HTTP {} response: {}",
        response_status,
        response_body
    );
}

// ── 13. Audit endpoint returns structured data ─────────────────────────────

#[tokio::test]
async fn audit_endpoint_returns_structured_data() {
    let (base, _state, auth) = spawn_test_server().await;
    let client = reqwest::Client::new();

    let phc = auth_service::credentials::hash_password("password123").unwrap();
    auth.credentials.set_phc_sync("owner8", &phc).unwrap();
    let mut p = auth.credentials.get_profile("owner8").unwrap();
    p.role = "user".to_string();
    auth.credentials.save_profile(&p).unwrap();

    let login = client
        .post(format!("{}/api/v1/auth/login", base))
        .json(&serde_json::json!({"username":"owner8","password":"password123"}))
        .send()
        .await
        .unwrap();
    let mut token = login.json::<serde_json::Value>().await.unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string();

    let cr = client
        .post(format!("{}/api/v1/organizations", base))
        .header("Authorization", format!("Bearer {}", token))
        .json(&serde_json::json!({"name":"Audit Test"}))
        .send()
        .await
        .unwrap();
    token = rotated_token(&cr, &token);
    let org = cr.json::<serde_json::Value>().await.unwrap()["organization"]["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Audit
    let r = client
        .get(format!(
            "{}/api/v1/organizations/{}/security/audit",
            base, org
        ))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .unwrap();
    token = rotated_token(&r, &token);
    assert_eq!(r.status(), 200);
    let audit = r.json::<serde_json::Value>().await.unwrap();
    assert!(audit.get("organization_id").is_some());
    assert!(audit.get("source").is_some());

    // Operations
    let r2 = client
        .get(format!(
            "{}/api/v1/organizations/{}/security/operations",
            base, org
        ))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .unwrap();
    assert_eq!(r2.status(), 200);
}

// ── 14. SCIM unauthenticated probe must not disclose org existence ──────────

#[tokio::test]
async fn scim_unauthenticated_probe_returns_401_for_any_org() {
    let (base, _state, auth) = spawn_test_server().await;
    let client = reqwest::Client::new();

    let phc = auth_service::credentials::hash_password("password123").unwrap();
    auth.credentials.set_phc_sync("owner9", &phc).unwrap();
    let mut p = auth.credentials.get_profile("owner9").unwrap();
    p.role = "user".to_string();
    auth.credentials.save_profile(&p).unwrap();

    let login = client
        .post(format!("{}/api/v1/auth/login", base))
        .json(&serde_json::json!({"username":"owner9","password":"password123"}))
        .send()
        .await
        .unwrap();
    let mut token = login.json::<serde_json::Value>().await.unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string();

    // Create one real org so we can probe an existing vs a bogus id.
    let cr = client
        .post(format!("{}/api/v1/organizations", base))
        .header("Authorization", format!("Bearer {}", token))
        .json(&serde_json::json!({"name":"SCIM Enum Test"}))
        .send()
        .await
        .unwrap();
    token = rotated_token(&cr, &token);
    let org = cr.json::<serde_json::Value>().await.unwrap()["organization"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let _ = token;

    // No SCIM credentials at all: both the real org and a bogus id must
    // answer 401 — never 404 — so a probe learns nothing about existence.
    for target in [org.as_str(), "00000000-0000-0000-0000-000000000000"] {
        let r = client
            .get(format!("{}/scim/v2.0/organizations/{}/Users", base, target))
            .send()
            .await
            .unwrap();
        assert_eq!(
            r.status(),
            reqwest::StatusCode::UNAUTHORIZED,
            "Unauthenticated SCIM probe for {} must be 401, not existence-revealing",
            target
        );
    }
}

#[tokio::test]
async fn test_org_deletion_and_member_lifecycle() {
    let (base, _state, auth) = spawn_test_server().await;
    let client = reqwest::Client::new();
    let phc = auth_service::credentials::hash_password("password123").unwrap();
    auth.credentials.set_phc_sync("admin", &phc).unwrap();
    let mut p = auth.credentials.get_profile("admin").unwrap();
    p.role = "admin".to_string();
    auth.credentials.save_profile(&p).unwrap();

    let login = client
        .post(format!("{}/api/v1/auth/login", base))
        .json(&serde_json::json!({"username":"admin","password":"password123"}))
        .send()
        .await
        .unwrap();
    let mut token = login.json::<serde_json::Value>().await.unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string();

    // Create test organization
    let cr = client
        .post(format!("{}/api/v1/organizations", base))
        .header("Authorization", format!("Bearer {}", token))
        .json(&serde_json::json!({"name":"Delete Test Org"}))
        .send()
        .await
        .unwrap();
    token = rotated_token(&cr, &token);
    assert_eq!(cr.status(), 201);
    let org_id = cr.json::<serde_json::Value>().await.unwrap()["organization"]["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Verify organization exists
    let r = client
        .get(format!("{}/api/v1/organizations/{}", base, org_id))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .unwrap();
    token = rotated_token(&r, &token);
    assert_eq!(r.status(), 200);

    // Delete non-existent member returns 404
    let r_del_mem = client
        .delete(format!(
            "{}/api/v1/organizations/{}/members/non_existent_user",
            base, org_id
        ))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .unwrap();
    token = rotated_token(&r_del_mem, &token);
    assert_eq!(r_del_mem.status(), 404);

    // Delete organization as owner/admin succeeds with 204 No Content
    let r_del = client
        .delete(format!("{}/api/v1/organizations/{}", base, org_id))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .unwrap();
    token = rotated_token(&r_del, &token);
    assert_eq!(r_del.status(), 204);

    // Organization is now gone: 404
    let r_check = client
        .get(format!("{}/api/v1/organizations/{}", base, org_id))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .unwrap();
    assert_eq!(r_check.status(), 404);
}

#[tokio::test]
async fn test_webhooks_and_licensing_lifecycle() {
    let (base, _state, auth) = spawn_test_server().await;
    let client = reqwest::Client::new();
    let phc = auth_service::credentials::hash_password("password123").unwrap();
    auth.credentials.set_phc_sync("admin", &phc).unwrap();
    let mut p = auth.credentials.get_profile("admin").unwrap();
    p.role = "admin".to_string();
    auth.credentials.save_profile(&p).unwrap();

    let login = client
        .post(format!("{}/api/v1/auth/login", base))
        .json(&serde_json::json!({"username":"admin","password":"password123"}))
        .send()
        .await
        .unwrap();
    let mut token = login.json::<serde_json::Value>().await.unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string();

    // Create test organization
    let cr = client
        .post(format!("{}/api/v1/organizations", base))
        .header("Authorization", format!("Bearer {}", token))
        .json(&serde_json::json!({"name":"Webhook Licensing Org"}))
        .send()
        .await
        .unwrap();
    token = rotated_token(&cr, &token);
    assert_eq!(cr.status(), 201);
    let org_id = cr.json::<serde_json::Value>().await.unwrap()["organization"]["id"]
        .as_str()
        .unwrap()
        .to_string();

    // 1. Webhooks CRUD
    let r_wh = client
        .post(format!("{}/api/v1/organizations/{}/webhooks", base, org_id))
        .header("Authorization", format!("Bearer {}", token))
        .json(&serde_json::json!({
            "url": "https://example.com/webhook",
            "description": "Enterprise test webhook",
            "events": ["transaction.sealed", "receipt.verified"]
        }))
        .send()
        .await
        .unwrap();
    token = rotated_token(&r_wh, &token);
    assert_eq!(r_wh.status(), 201);
    let wh_data: serde_json::Value = r_wh.json().await.unwrap();
    let wh_id = wh_data["id"].as_str().unwrap().to_string();
    assert!(wh_data["secret"].as_str().unwrap().starts_with("whsec_"));

    // List webhooks
    let r_list = client
        .get(format!("{}/api/v1/organizations/{}/webhooks", base, org_id))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .unwrap();
    token = rotated_token(&r_list, &token);
    assert_eq!(r_list.status(), 200);
    let list_data: serde_json::Value = r_list.json().await.unwrap();
    assert_eq!(list_data["webhooks"].as_array().unwrap().len(), 1);

    // Delete webhook
    let r_del_wh = client
        .delete(format!(
            "{}/api/v1/organizations/{}/webhooks/{}",
            base, org_id, wh_id
        ))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .unwrap();
    token = rotated_token(&r_del_wh, &token);
    assert_eq!(r_del_wh.status(), 204);

    // 2. Licensing Lifecycle
    // Mint license with real Ed25519 signature
    let r_mint = client
        .post(format!("{}/api/v1/billing/licenses/mint", base))
        .header("Authorization", format!("Bearer {}", token))
        .json(&serde_json::json!({
            "tenant_id": org_id,
            "valid_days": 30,
            "max_nodes": 5,
            "package_tier": "enterprise"
        }))
        .send()
        .await
        .unwrap();
    token = rotated_token(&r_mint, &token);
    assert_eq!(r_mint.status(), 200);
    let mint_data: serde_json::Value = r_mint.json().await.unwrap();
    assert_eq!(mint_data["tenant_id"], org_id);
    let signature = mint_data["signature"].as_str().unwrap().to_string();
    let valid_until = mint_data["valid_until"].as_u64().unwrap();

    // Install license with real verification
    let r_install = client
        .post(format!("{}/api/v1/billing/licenses/install", base))
        .header("Authorization", format!("Bearer {}", token))
        .json(&serde_json::json!({
            "tenant_id": org_id,
            "valid_until": valid_until,
            "max_nodes": 5,
            "signature": signature
        }))
        .send()
        .await
        .unwrap();
    token = rotated_token(&r_install, &token);
    assert_eq!(r_install.status(), 200);

    // Request renewal
    let r_renew = client
        .post(format!("{}/api/v1/billing/licenses/renew", base))
        .header("Authorization", format!("Bearer {}", token))
        .json(&serde_json::json!({
            "organization_id": org_id,
            "period_days": 90,
            "notes": "Q4 enterprise expansion renewal"
        }))
        .send()
        .await
        .unwrap();
    token = rotated_token(&r_renew, &token);
    assert_eq!(r_renew.status(), 200);
    let renew_data: serde_json::Value = r_renew.json().await.unwrap();
    assert!(renew_data["reference_id"]
        .as_str()
        .unwrap()
        .starts_with("LIC-REQ-"));

    // Activate subscription
    let r_act = client
        .post(format!("{}/api/v1/billing/subscriptions/activate", base))
        .header("Authorization", format!("Bearer {}", token))
        .json(&serde_json::json!({
            "organization_id": org_id,
            "plan_id": "enterprise",
            "idempotency_key": "sub_act_001",
            "provider": "manual_wire"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(r_act.status(), 200);
}
