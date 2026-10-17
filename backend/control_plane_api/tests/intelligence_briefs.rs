//! Stage 7 (part A) — integration tests for operator-reviewed briefs.
//!
//! Seeds a temp ranked-brief JSON file (Stage 5 output shape) and asserts:
//! list returns 2 briefs, company route 200, unknown company 404, and
//! missing-file fails closed with 503 + code BRIEFS_UNAVAILABLE.
//! Auth reuses the existing session flow (login → Bearer); unauthenticated
//! access must be rejected, preserving tenant isolation.

use auth_service::{session::SessionStore, store::CredentialStore, AuthState};
use control_plane_api::{router, ControlPlaneState};
use sled::Config;
use std::sync::Arc;
use tower_http::cors::CorsLayer;

/// Stage 8: all brief tests share the process-global `VARDHAN_BRIEFS_PATH`.
/// Tokio runs tests in one process on parallel threads, so each test holds
/// this mutex for its whole body to prevent env-var cross-talk flakes.
static TEST_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn lock_test_env() -> std::sync::MutexGuard<'static, ()> {
    TEST_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

/// Spawn an isolated control-plane on an ephemeral port.
async fn spawn_test_server() -> (String, ControlPlaneState, AuthState) {
    let rand_id = uuid::Uuid::new_v4().to_string();
    let dir_path = format!("/tmp/vardhan_test_briefs_{}", rand_id);
    std::fs::create_dir_all(&dir_path).unwrap();

    let creds = Arc::new(
        CredentialStore::open(std::path::Path::new(&format!("{}/auth.db", dir_path))).unwrap(),
    );
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

    let db = Config::new()
        .path(format!("{}/control_plane.db", dir_path))
        .open()
        .unwrap();
    let control_state = ControlPlaneState {
        db: Arc::new(db),
        aer_kep_q: None,
        auth: auth_state.clone(),
    };

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

/// Pick up the rotated session token, falling back to the current one.
fn rotated_token(resp: &reqwest::Response, current: &str) -> String {
    resp.headers()
        .get("authorization-new-token")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim_start_matches("Bearer ").to_string())
        .unwrap_or_else(|| current.to_string())
}

async fn login_token(
    client: &reqwest::Client,
    base: &str,
    auth: &AuthState,
) -> String {
    let phc = auth_service::credentials::hash_password("password123").unwrap();
    auth.credentials.set_phc_sync("alice", &phc).unwrap();
    let mut profile = auth.credentials.get_profile("alice").unwrap();
    profile.role = "user".to_string();
    auth.credentials.save_profile(&profile).unwrap();

    let login = client
        .post(format!("{}/api/v1/auth/login", base))
        .json(&serde_json::json!({"username": "alice", "password": "password123"}))
        .send()
        .await
        .unwrap();
    assert_eq!(login.status(), 200);
    login.json::<serde_json::Value>().await.unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string()
}

#[tokio::test]
async fn intelligence_briefs_flow() {
    let _env_guard = lock_test_env();
    let (base, _state, auth) = spawn_test_server().await;
    let client = reqwest::Client::new();
    let mut token = login_token(&client, &base, &auth).await;

    // Seed a temp ranked-brief JSON file with 2 briefs (GO + HOLD).
    let dir = format!("/tmp/vardhan_test_briefs_seed_{}", uuid::Uuid::new_v4());
    std::fs::create_dir_all(&dir).unwrap();
    let briefs_path = format!("{}/ranked.json", dir);
    std::fs::write(
        &briefs_path,
        serde_json::json!([
            {
                "company": "Acme",
                "verdict": "GO",
                "score": 87,
                "signal_url": "https://example.com/signals/acme",
                "why_now": "Renewal window opens next quarter.",
                "buyer_role": "CTO"
            },
            {
                "company": "Beta",
                "verdict": "HOLD",
                "score": 62,
                "signal_url": null,
                "why_now": null,
                "buyer_role": "VP Engineering"
            }
        ])
        .to_string(),
    )
    .unwrap();
    std::env::set_var("VARDHAN_BRIEFS_PATH", &briefs_path);

    // 1. List returns exactly the 2 seeded briefs.
    let list = client
        .get(format!("{}/v1/intelligence/briefs", base))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .unwrap();
    token = rotated_token(&list, &token);
    assert_eq!(list.status(), 200);
    let briefs = list.json::<serde_json::Value>().await.unwrap();
    assert!(briefs.is_array(), "list must be a JSON array");
    assert_eq!(briefs.as_array().unwrap().len(), 2);
    assert_eq!(briefs[0]["company"], "Acme");
    assert_eq!(briefs[0]["verdict"], "GO");
    assert_eq!(briefs[1]["verdict"], "HOLD");

    // 2. Single-company route returns 200 (case-insensitive match).
    let one = client
        .get(format!("{}/v1/intelligence/briefs/acme", base))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .unwrap();
    token = rotated_token(&one, &token);
    assert_eq!(one.status(), 200);
    let body = one.json::<serde_json::Value>().await.unwrap();
    assert_eq!(body["company"], "Acme");
    assert_eq!(body["score"], 87);

    // 3. Unknown company returns 404.
    let missing = client
        .get(format!("{}/v1/intelligence/briefs/UnknownCo", base))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .unwrap();
    token = rotated_token(&missing, &token);
    assert_eq!(missing.status(), 404);

    // 4. Unauthenticated access is rejected (existing auth reused).
    let unauth = client
        .get(format!("{}/v1/intelligence/briefs", base))
        .send()
        .await
        .unwrap();
    assert_eq!(unauth.status(), 401);

    // 5. Missing file fails closed with 503 + BRIEFS_UNAVAILABLE.
    std::env::set_var(
        "VARDHAN_BRIEFS_PATH",
        format!("{}/does-not-exist.json", dir),
    );
    let down = client
        .get(format!("{}/v1/intelligence/briefs", base))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .unwrap();
    assert_eq!(down.status(), 503);
    let body = down.json::<serde_json::Value>().await.unwrap();
    assert_eq!(body["code"], "BRIEFS_UNAVAILABLE");

    std::env::remove_var("VARDHAN_BRIEFS_PATH");
}

/// Stage 7 contract-defect regression — the REAL production ranked.json.
///
/// History: the sweep writer once emitted full-brief camelCase entries
/// (domain/runId/verdictReason/whyNow/...) without the snake_case keys
/// signal_url/why_now/buyer_role. BriefSummary has no #[serde(default)],
/// so every entry failed to parse and list_briefs returned 500
/// BRIEFS_INVALID on the real file while fixture-seeded tests stayed
/// green. This test loads the committed artifact via an absolute repo
/// path and asserts list returns 200 with 4 items, each carrying
/// company/verdict/score keys (no hardcoded verdict values — the engine
/// owns those; the contract owns the keys).
#[tokio::test]
async fn intelligence_briefs_real_ranked_json_contract() {
    let _env_guard = lock_test_env();
    let (base, _state, auth) = spawn_test_server().await;
    let client = reqwest::Client::new();
    let token = login_token(&client, &base, &auth).await;

    // Absolute repo-relative path: control_plane_api → repo root →
    // intelligence_plane/.research/briefs/ranked.json. The file is
    // committed, so a missing file is a hard failure (no graceful skip).
    let real_path = format!(
        "{}/../../intelligence_plane/.research/briefs/ranked.json",
        env!("CARGO_MANIFEST_DIR")
    );
    assert!(
        std::path::Path::new(&real_path).exists(),
        "committed ranked.json must exist at {}",
        real_path
    );
    std::env::set_var("VARDHAN_BRIEFS_PATH", &real_path);

    let list = client
        .get(format!("{}/v1/intelligence/briefs", base))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .unwrap();
    assert_eq!(list.status(), 200);
    let briefs = list.json::<serde_json::Value>().await.unwrap();
    assert!(briefs.is_array(), "list must be a JSON array");
    let items = briefs.as_array().unwrap();
    assert_eq!(items.len(), 4);
    for item in items {
        assert!(
            item.get("company").and_then(|v| v.as_str()).is_some(),
            "each brief must carry a company key: {}",
            item
        );
        assert!(
            item.get("verdict").and_then(|v| v.as_str()).is_some(),
            "each brief must carry a verdict key: {}",
            item
        );
        assert!(
            item.get("score").and_then(|v| v.as_u64()).is_some(),
            "each brief must carry a score key: {}",
            item
        );
    }

    std::env::remove_var("VARDHAN_BRIEFS_PATH");
}

/// Stage 8 helper — log in an arbitrary username (tenant-isolation coverage).
/// Mirrors `login_token` without touching its behaviour.
async fn login_user_token(
    client: &reqwest::Client,
    base: &str,
    auth: &AuthState,
    username: &str,
) -> String {
    let phc = auth_service::credentials::hash_password("password123").unwrap();
    auth.credentials.set_phc_sync(username, &phc).unwrap();
    let mut profile = auth.credentials.get_profile(username).unwrap();
    profile.role = "user".to_string();
    auth.credentials.save_profile(&profile).unwrap();

    let login = client
        .post(format!("{}/api/v1/auth/login", base))
        .json(&serde_json::json!({"username": username, "password": "password123"}))
        .send()
        .await
        .unwrap();
    assert_eq!(login.status(), 200);
    login.json::<serde_json::Value>().await.unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string()
}

/// Stage 8 (a) — tenant isolation on the shared operator-read brief store.
///
/// The ranked-brief file is operator-wide (file-backed, shared read), so user A
/// and user B legitimately see the SAME briefs. Isolation here means the auth
/// boundary: unauthenticated reads are 401, and each authenticated tenant gets
/// 200 on their own session with no cross-user credential/data leakage.
#[tokio::test]
async fn intelligence_briefs_stage8_tenant_isolation_shared_operator_read() {
    let _env_guard = lock_test_env();
    let (base, _state, auth) = spawn_test_server().await;
    let client = reqwest::Client::new();
    let mut token_a = login_user_token(&client, &base, &auth, "alice-a").await;
    let mut token_b = login_user_token(&client, &base, &auth, "bob-b").await;

    // Seed a temp ranked-brief JSON file with 2 briefs (GO + HOLD).
    let dir = format!("/tmp/vardhan_test_briefs_stage8_{}", uuid::Uuid::new_v4());
    std::fs::create_dir_all(&dir).unwrap();
    let briefs_path = format!("{}/ranked.json", dir);
    std::fs::write(
        &briefs_path,
        serde_json::json!([
            {
                "company": "Acme",
                "verdict": "GO",
                "score": 87,
                "signal_url": "https://example.com/signals/acme",
                "why_now": "Renewal window opens next quarter.",
                "buyer_role": "CTO"
            },
            {
                "company": "Beta",
                "verdict": "HOLD",
                "score": 62,
                "signal_url": null,
                "why_now": null,
                "buyer_role": "VP Engineering"
            }
        ])
        .to_string(),
    )
    .unwrap();
    std::env::set_var("VARDHAN_BRIEFS_PATH", &briefs_path);

    // 1. Unauthenticated list access is rejected (auth boundary holds).
    let unauth = client
        .get(format!("{}/v1/intelligence/briefs", base))
        .send()
        .await
        .unwrap();
    assert_eq!(unauth.status(), 401);

    // 2. Tenant A reads the shared store on its own session.
    let list_a = client
        .get(format!("{}/v1/intelligence/briefs", base))
        .header("Authorization", format!("Bearer {}", token_a))
        .send()
        .await
        .unwrap();
    let _ = rotated_token(&list_a, &token_a);
    assert_eq!(list_a.status(), 200);
    let briefs_a = list_a.json::<serde_json::Value>().await.unwrap();
    assert!(briefs_a.is_array(), "list must be a JSON array");
    assert_eq!(briefs_a.as_array().unwrap().len(), 2);

    // 3. Tenant B reads the same shared store on its own session.
    let list_b = client
        .get(format!("{}/v1/intelligence/briefs", base))
        .header("Authorization", format!("Bearer {}", token_b))
        .send()
        .await
        .unwrap();
    token_b = rotated_token(&list_b, &token_b);
    assert_eq!(list_b.status(), 200);
    let briefs_b = list_b.json::<serde_json::Value>().await.unwrap();
    assert_eq!(briefs_b.as_array().unwrap().len(), 2);

    // 4. Shared-operator-read model: both tenants see identical briefs, and
    //    neither response leaks the other's session or credentials.
    assert_eq!(briefs_a, briefs_b);
    let body_a = serde_json::to_string(&briefs_a).unwrap();
    let body_b = serde_json::to_string(&briefs_b).unwrap();
    assert!(!body_a.contains("bob-b"), "tenant A must not see tenant B data");
    assert!(!body_b.contains("alice-a"), "tenant B must not see tenant A data");
    assert!(!body_a.contains("password"), "no credential leakage");
    assert!(!body_b.contains("password"), "no credential leakage");

    // 5. Single-company route is likewise auth-gated but shared-read.
    let one_b = client
        .get(format!("{}/v1/intelligence/briefs/acme", base))
        .header("Authorization", format!("Bearer {}", token_b))
        .send()
        .await
        .unwrap();
    let _ = rotated_token(&one_b, &token_b);
    assert_eq!(one_b.status(), 200);

    std::env::remove_var("VARDHAN_BRIEFS_PATH");
}

/// Stage 8 (b) — path-traversal style `VARDHAN_BRIEFS_PATH` fails closed.
///
/// A traversal value must yield 503/500 with a machine-readable code — never
/// file contents. `root:` (the /etc/passwd marker) must not appear in the body.
#[tokio::test]
async fn intelligence_briefs_stage8_path_traversal_fails_closed() {
    let _env_guard = lock_test_env();
    let (base, _state, auth) = spawn_test_server().await;
    let client = reqwest::Client::new();
    let mut token = login_user_token(&client, &base, &auth, "alice-trav").await;

    // 1. Bare traversal to a nonexistent file → 503 BRIEFS_UNAVAILABLE.
    std::env::set_var(
        "VARDHAN_BRIEFS_PATH",
        "../../etc/passwd-stage8-does-not-exist",
    );
    let missing = client
        .get(format!("{}/v1/intelligence/briefs", base))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .unwrap();
    token = rotated_token(&missing, &token);
    assert!(
        missing.status() == 503 || missing.status() == 500,
        "traversal path must fail closed, got {}",
        missing.status()
    );
    let body = missing.text().await.unwrap();
    assert!(
        !body.contains("root:"),
        "response must never disclose file contents"
    );

    // 2. Traversal-shaped path (`sub/../`) to a REAL passwd-like decoy file:
    //    the file is read but is not JSON → 500 BRIEFS_INVALID, still no leak.
    let dir = format!("/tmp/vardhan_test_briefs_trav_{}", uuid::Uuid::new_v4());
    std::fs::create_dir_all(format!("{}/sub", dir)).unwrap();
    std::fs::write(
        format!("{}/shadow_decoy", dir),
        "root:x:0:0:System Administrator:/var/root:/bin/sh\n",
    )
    .unwrap();
    std::env::set_var(
        "VARDHAN_BRIEFS_PATH",
        format!("{}/sub/../shadow_decoy", dir),
    );
    let decoy = client
        .get(format!("{}/v1/intelligence/briefs", base))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .unwrap();
    token = rotated_token(&decoy, &token);
    assert_eq!(decoy.status(), 500);
    let body = decoy.json::<serde_json::Value>().await.unwrap();
    assert_eq!(body["code"], "BRIEFS_INVALID");
    assert!(
        !serde_json::to_string(&body).unwrap().contains("root:"),
        "passwd-like contents must not be echoed"
    );

    // 3. Absolute /etc/passwd (when present) is likewise never disclosed.
    if std::path::Path::new("/etc/passwd").exists() {
        std::env::set_var("VARDHAN_BRIEFS_PATH", "/etc/passwd");
        let passwd = client
            .get(format!("{}/v1/intelligence/briefs", base))
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await
            .unwrap();
        token = rotated_token(&passwd, &token);
        assert!(
            passwd.status() == 503 || passwd.status() == 500,
            "passwd path must fail closed, got {}",
            passwd.status()
        );
        let body = passwd.text().await.unwrap();
        assert!(
            !body.contains("root:"),
            "real /etc/passwd contents must not be disclosed"
        );
    }

    std::env::remove_var("VARDHAN_BRIEFS_PATH");
}

/// Stage 8 (c) — malformed JSON brief file fails closed with 500
/// BRIEFS_INVALID (not 200, no panic) on both list and single-company routes.
#[tokio::test]
async fn intelligence_briefs_stage8_malformed_json_fails_closed() {
    let _env_guard = lock_test_env();
    let (base, _state, auth) = spawn_test_server().await;
    let client = reqwest::Client::new();
    let mut token = login_user_token(&client, &base, &auth, "alice-mal").await;

    let dir = format!("/tmp/vardhan_test_briefs_mal_{}", uuid::Uuid::new_v4());
    std::fs::create_dir_all(&dir).unwrap();
    let bad_path = format!("{}/ranked.json", dir);
    std::fs::write(&bad_path, "{ this is not valid JSON [[[")
        .unwrap();
    std::env::set_var("VARDHAN_BRIEFS_PATH", &bad_path);

    // 1. List route: 500 + BRIEFS_INVALID (proves no panic, no 200).
    let list = client
        .get(format!("{}/v1/intelligence/briefs", base))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .unwrap();
    token = rotated_token(&list, &token);
    assert_ne!(list.status(), 200, "malformed store must not return 200");
    assert_eq!(list.status(), 500);
    let body = list.json::<serde_json::Value>().await.unwrap();
    assert_eq!(body["code"], "BRIEFS_INVALID");

    // 2. Single-company route fails closed identically.
    let one = client
        .get(format!("{}/v1/intelligence/briefs/acme", base))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .unwrap();
    token = rotated_token(&one, &token);
    assert_ne!(one.status(), 200, "malformed store must not return 200");
    assert_eq!(one.status(), 500);
    let body = one.json::<serde_json::Value>().await.unwrap();
    assert_eq!(body["code"], "BRIEFS_INVALID");

    std::env::remove_var("VARDHAN_BRIEFS_PATH");
}
