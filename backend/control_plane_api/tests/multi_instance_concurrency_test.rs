//! Multi-Instance Distributed Concurrency Integration Test
//!
//! Validates Step 1 implementation directive:
//! Proves that two independent control_plane_api HTTP instances sharing a PostgreSQL
//! database coordinate atomically via distributed idempotency:
//! 1. Concurrent identical submissions to distinct nodes converge to a single winner.
//! 2. The winning node returns SEALED; the losing node returns REJECTED_REPLAY.
//! 3. Repeated submissions to either node return cached SEALED receipts without re-execution.
//! 4. Submissions with identical idempotency key but altered payload return REJECTED_PAYLOAD_MISMATCH (HTTP 409).
//! 5. Tenant isolation: identical idempotency keys under distinct tenants succeed independently.
//! 6. Expired lease recovery: abandoned reservations are safely recovered and sealed.

use auth_service::{
    credentials::hash_password, session::SessionStore, store::CredentialStore, AuthState,
};
use control_plane_api::distributed_idempotency::{
    postgres_store::PostgresIdempotencyStore, IdempotencyStore,
};
use control_plane_api::{router, ControlPlaneState};
use sled::Config;
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use uuid::Uuid;

fn get_test_database_url() -> Option<String> {
    std::env::var("TEST_DATABASE_URL")
        .ok()
        .or_else(|| std::env::var("DATABASE_URL").ok())
}

struct ClusterFixture {
    node_a_url: String,
    node_b_url: String,
    auth_token: String,
    pg_store: Arc<PostgresIdempotencyStore>,
    _temp_dir: String,
}

async fn setup_two_node_cluster() -> Option<ClusterFixture> {
    let pg_url = match get_test_database_url() {
        Some(url) => url,
        None => {
            eprintln!("SKIPPING multi_instance_concurrency_test: Neither TEST_DATABASE_URL nor DATABASE_URL configured");
            return None;
        }
    };

    let temp_id = Uuid::new_v4().to_string();
    let temp_dir = format!("/tmp/qcore_cluster_test_{temp_id}");
    std::fs::create_dir_all(&temp_dir).unwrap();

    let creds = Arc::new(
        CredentialStore::open(std::path::Path::new(&format!("{temp_dir}/auth.db"))).unwrap(),
    );
    let sessions = Arc::new(SessionStore::new());

    let auth_state = AuthState {
        credentials: creds.clone(),
        sessions,
        mfa: None,
        mfa_policy: Arc::new(auth_service::MfaPolicy::default()),
        rate_limiter: Arc::new(auth_service::rate_limit::RateLimiter::new()),
        ledger: None,
        identity: None,
        node_id: Some("cluster-test".to_string()),
        admin_token: None,
    };

    // Pre-create test user
    let phc = hash_password("Password123!").unwrap();
    creds.set_phc_sync("cluster_admin", &phc).unwrap();
    let mut profile = creds.get_profile("cluster_admin").unwrap();
    profile.role = "admin".to_string();
    creds.save_profile(&profile).unwrap();

    // Create shared sled metadata database
    let db = Arc::new(
        Config::new()
            .path(format!("{temp_dir}/control_plane.db"))
            .open()
            .unwrap(),
    );

    // Initialize two distinct PostgresIdempotencyStore connections to the same database
    let store_a = match PostgresIdempotencyStore::from_database_url(&pg_url, 10).await {
        Ok(s) => Arc::new(s),
        Err(e) => {
            eprintln!(
                "SKIPPING multi_instance_concurrency_test: PostgreSQL connection failed: {e}"
            );
            return None;
        }
    };

    let store_b = match PostgresIdempotencyStore::from_database_url(&pg_url, 10).await {
        Ok(s) => Arc::new(s),
        Err(e) => {
            eprintln!("SKIPPING multi_instance_concurrency_test: Node B PostgreSQL connection failed: {e}");
            return None;
        }
    };

    let cluster_membership = Arc::new(ha_cluster::ClusterMembership::new());

    let state_a = ControlPlaneState::new_with_store(
        db.clone(),
        None,
        auth_state.clone(),
        cluster_membership.clone(),
        store_a.clone(),
    );

    let state_b = ControlPlaneState::new_with_store(
        db.clone(),
        None,
        auth_state.clone(),
        cluster_membership.clone(),
        store_b.clone(),
    );

    let app_a = router(state_a, auth_state.clone(), CorsLayer::permissive());
    let app_b = router(state_b, auth_state.clone(), CorsLayer::permissive());

    let listener_a = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let listener_b = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();

    let addr_a = listener_a.local_addr().unwrap();
    let addr_b = listener_b.local_addr().unwrap();

    let node_a_url = format!("http://{addr_a}");
    let node_b_url = format!("http://{addr_b}");

    tokio::spawn(async move {
        axum::serve(listener_a, app_a).await.unwrap();
    });

    tokio::spawn(async move {
        axum::serve(listener_b, app_b).await.unwrap();
    });

    // Authenticate client to get session token
    let http = reqwest::Client::new();
    let login_resp = http
        .post(format!("{node_a_url}/api/v1/auth/login"))
        .json(&serde_json::json!({
            "username": "cluster_admin",
            "password": "Password123!"
        }))
        .send()
        .await
        .unwrap();

    assert_eq!(login_resp.status(), 200, "Login must succeed");
    let login_body: serde_json::Value = login_resp.json().await.unwrap();
    let auth_token = login_body["token"].as_str().unwrap().to_string();

    Some(ClusterFixture {
        node_a_url,
        node_b_url,
        auth_token,
        pg_store: store_a,
        _temp_dir: temp_dir,
    })
}

fn build_contract_payload(tenant_id: &str, finding_id: &str, rule_id: &str) -> serde_json::Value {
    serde_json::json!({
        "contract": {
            "schema_version": "1.0",
            "finding_id": finding_id,
            "intelligence": { "engine_id": "e", "engine_version": "1", "run_id": "r" },
            "organization": { "organization_id": tenant_id, "canonical_domain": "vardhan.org" },
            "affected_resource": { "canonical_url": "https://api.vardhan.org/v1/settlement", "surface_type": "API_REST", "entry_point_id": "ep-settlement" },
            "technical_area": "STATIC_ANALYSIS",
            "technical_mechanism": rule_id,
            "expected_behavior": "safe",
            "observed_behavior": "vuln",
            "differential_state": "CONFIRMED_MISMATCH",
            "materiality": "HIGH",
            "evidence_refs": [{
                "evidence_id": "ev-01",
                "public_url": "https://evidence.vardhan.org/audit",
                "temporal_status": "CURRENT",
                "is_context_artifact": false,
                "evidence_origin": "scan",
                "content_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
            }],
            "provenance_chain": {
                "expectation_id": "exp-1",
                "observation_ids": ["obs-1"],
                "differential_id": "diff-1",
                "hypothesis_id": "hypo-1",
                "verification_contract_id": "vc-1"
            },
            "contradictory_evidence_ids": [],
            "uncertainty": [],
            "benign_explanation": "",
            "authorization_context": { "requires_authorized_assessment": false },
            "decision_candidate": "SEAL_VERIFIED_FINDING",
            "policy_reference": "VARDHAN_CORE_INTELLIGENCE_POLICY_V1",
            "created_at": "2026-10-13T10:00:00Z",
            "evidence_earliest_retrieved_at": "2026-10-13T09:00:00Z",
            "evidence_latest_retrieved_at": "2026-10-13T09:30:00Z"
        },
        "actor_workload_id": "svc:vardhan-intelligence:node-runner"
    })
}

#[tokio::test]
async fn test_multi_instance_concurrent_submissions_single_winner() {
    let fixture = match setup_two_node_cluster().await {
        Some(f) => f,
        None => return,
    };

    let tenant_id = "org-vardhan-intelligence";
    let finding_id = format!("finding-concurrent-{}", Uuid::new_v4());
    let payload = build_contract_payload(tenant_id, &finding_id, "SQLi");

    let client = reqwest::Client::new();

    // Submit identical payload concurrently to Node A and Node B
    let req_a = client
        .post(format!(
            "{}/api/v1/organizations/{}/security/validate",
            fixture.node_a_url, tenant_id
        ))
        .header("Authorization", format!("Bearer {}", fixture.auth_token))
        .json(&payload)
        .send();

    let req_b = client
        .post(format!(
            "{}/api/v1/organizations/{}/security/validate",
            fixture.node_b_url, tenant_id
        ))
        .header("Authorization", format!("Bearer {}", fixture.auth_token))
        .json(&payload)
        .send();

    let (res_a, res_b) = tokio::join!(req_a, req_b);
    let (resp_a, resp_b) = (res_a.unwrap(), res_b.unwrap());

    assert_eq!(resp_a.status(), 200, "Node A response must be 200");
    assert_eq!(resp_b.status(), 200, "Node B response must be 200");

    let body_a: serde_json::Value = resp_a.json().await.unwrap();
    let body_b: serde_json::Value = resp_b.json().await.unwrap();

    let status_a = body_a["status"].as_str().unwrap_or("");
    let status_b = body_b["status"].as_str().unwrap_or("");

    // Assert exactly one node sealed the transaction, and peer rejected replay
    let winner_count = (status_a == "SEALED") as u32 + (status_b == "SEALED") as u32;
    let replay_count =
        (status_a == "REJECTED_REPLAY") as u32 + (status_b == "REJECTED_REPLAY") as u32;

    assert_eq!(
        winner_count, 1,
        "Exactly one node must win and SEAL the finding"
    );
    assert_eq!(
        replay_count, 1,
        "The competing concurrent node must reject as REJECTED_REPLAY"
    );

    // The winner receipt must be a non-empty string
    let winning_receipt_id = if status_a == "SEALED" {
        body_a["receipt_id"].as_str().unwrap()
    } else {
        body_b["receipt_id"].as_str().unwrap()
    };
    assert!(
        !winning_receipt_id.is_empty(),
        "Winning receipt ID must be populated"
    );
}

#[tokio::test]
async fn test_multi_instance_repeated_retries_return_cached_receipt() {
    let fixture = match setup_two_node_cluster().await {
        Some(f) => f,
        None => return,
    };

    let tenant_id = "org-vardhan-intelligence";
    let finding_id = format!("finding-retry-{}", Uuid::new_v4());
    let payload = build_contract_payload(tenant_id, &finding_id, "SQLi");

    let client = reqwest::Client::new();

    // First submission to Node A -> SEALED
    let resp_init = client
        .post(format!(
            "{}/api/v1/organizations/{}/security/validate",
            fixture.node_a_url, tenant_id
        ))
        .header("Authorization", format!("Bearer {}", fixture.auth_token))
        .json(&payload)
        .send()
        .await
        .unwrap();

    assert_eq!(resp_init.status(), 200);
    let init_body: serde_json::Value = resp_init.json().await.unwrap();
    assert_eq!(init_body["status"], "SEALED");
    let sealed_receipt_id = init_body["receipt_id"].as_str().unwrap().to_string();

    // Subsequent retry to Node A -> REJECTED_REPLAY with same receipt
    let retry_a = client
        .post(format!(
            "{}/api/v1/organizations/{}/security/validate",
            fixture.node_a_url, tenant_id
        ))
        .header("Authorization", format!("Bearer {}", fixture.auth_token))
        .json(&payload)
        .send()
        .await
        .unwrap();
    assert_eq!(retry_a.status(), 200);
    let body_retry_a: serde_json::Value = retry_a.json().await.unwrap();
    assert_eq!(body_retry_a["status"], "REJECTED_REPLAY");
    assert_eq!(body_retry_a["receipt_id"], sealed_receipt_id);

    // Subsequent retry to Node B -> REJECTED_REPLAY with same receipt
    let retry_b = client
        .post(format!(
            "{}/api/v1/organizations/{}/security/validate",
            fixture.node_b_url, tenant_id
        ))
        .header("Authorization", format!("Bearer {}", fixture.auth_token))
        .json(&payload)
        .send()
        .await
        .unwrap();
    assert_eq!(retry_b.status(), 200);
    let body_retry_b: serde_json::Value = retry_b.json().await.unwrap();
    assert_eq!(body_retry_b["status"], "REJECTED_REPLAY");
    assert_eq!(body_retry_b["receipt_id"], sealed_receipt_id);
}

#[tokio::test]
async fn test_multi_instance_payload_mismatch_returns_conflict() {
    let fixture = match setup_two_node_cluster().await {
        Some(f) => f,
        None => return,
    };

    let tenant_id = "org-vardhan-intelligence";
    let finding_id = format!("finding-mismatch-{}", Uuid::new_v4());
    let payload_v1 = build_contract_payload(tenant_id, &finding_id, "SQLi");
    let payload_v2 = build_contract_payload(tenant_id, &finding_id, "XSS");

    let client = reqwest::Client::new();

    // 1. Submit payload v1 to Node A -> SEALED
    let resp1 = client
        .post(format!(
            "{}/api/v1/organizations/{}/security/validate",
            fixture.node_a_url, tenant_id
        ))
        .header("Authorization", format!("Bearer {}", fixture.auth_token))
        .json(&payload_v1)
        .send()
        .await
        .unwrap();
    assert_eq!(resp1.status(), 200);

    // 2. Submit payload v2 (altered payload with same finding_id) to Node B -> 409 CONFLICT
    let resp2 = client
        .post(format!(
            "{}/api/v1/organizations/{}/security/validate",
            fixture.node_b_url, tenant_id
        ))
        .header("Authorization", format!("Bearer {}", fixture.auth_token))
        .json(&payload_v2)
        .send()
        .await
        .unwrap();

    assert_eq!(
        resp2.status(),
        409,
        "Altered payload for same finding_id must return 409 Conflict"
    );
    let body2: serde_json::Value = resp2.json().await.unwrap();
    assert_eq!(body2["status"], "REJECTED_PAYLOAD_MISMATCH");
    assert!(body2["existing_payload_hash"].is_string());
    assert!(body2["submitted_payload_hash"].is_string());
    assert_ne!(
        body2["existing_payload_hash"],
        body2["submitted_payload_hash"]
    );
}

#[tokio::test]
async fn test_multi_instance_cross_tenant_isolation() {
    let fixture = match setup_two_node_cluster().await {
        Some(f) => f,
        None => return,
    };

    let tenant_1 = "org-vardhan-intelligence";
    let tenant_2 = "org-acme-bank-poc";

    // Use the EXACT SAME finding_id for both tenants
    let shared_finding_id = format!("shared-finding-{}", Uuid::new_v4());
    let payload_tenant_1 = build_contract_payload(tenant_1, &shared_finding_id, "SQLi");
    let payload_tenant_2 = build_contract_payload(tenant_2, &shared_finding_id, "SQLi");

    let client = reqwest::Client::new();

    // Node A processes Tenant 1
    let resp1 = client
        .post(format!(
            "{}/api/v1/organizations/{}/security/validate",
            fixture.node_a_url, tenant_1
        ))
        .header("Authorization", format!("Bearer {}", fixture.auth_token))
        .json(&payload_tenant_1)
        .send()
        .await
        .unwrap();
    assert_eq!(resp1.status(), 200);
    let body1: serde_json::Value = resp1.json().await.unwrap();
    assert_eq!(body1["status"], "SEALED");

    // Node B processes Tenant 2 with the SAME finding_id -> must also SUCCEED (tenant isolation)
    let resp2 = client
        .post(format!(
            "{}/api/v1/organizations/{}/security/validate",
            fixture.node_b_url, tenant_2
        ))
        .header("Authorization", format!("Bearer {}", fixture.auth_token))
        .json(&payload_tenant_2)
        .send()
        .await
        .unwrap();
    assert_eq!(resp2.status(), 200);
    let body2: serde_json::Value = resp2.json().await.unwrap();
    assert_eq!(
        body2["status"], "SEALED",
        "Same key under different tenant must be accepted independently"
    );

    // Both receipts must be distinct
    assert_ne!(body1["receipt_id"], body2["receipt_id"]);
}

#[tokio::test]
async fn test_multi_instance_expired_lease_takeover() {
    let fixture = match setup_two_node_cluster().await {
        Some(f) => f,
        None => return,
    };

    let tenant_id = "org-vardhan-intelligence";
    let finding_id = format!("finding-abandoned-{}", Uuid::new_v4());
    let payload = build_contract_payload(tenant_id, &finding_id, "SQLi");

    let canonical_json = serde_json::to_vec(&payload["contract"]).unwrap();
    let payload_hash = hex::encode(blake3::hash(&canonical_json).as_bytes());

    // Simulate Node A reserving the row with a lease that expires in 1ms (abandoned reservation)
    let res = fixture
        .pg_store
        .reserve(
            tenant_id,
            &finding_id,
            "tx-abandoned-node-a",
            &payload_hash,
            1, // 1 ms lease
            "node-a-crashed",
        )
        .await
        .unwrap();

    assert!(matches!(
        res,
        control_plane_api::distributed_idempotency::ReservationOutcome::Reserved { .. }
    ));

    // Wait 50ms for the lease to elapse
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    // Node B receives the request for the abandoned finding -> claims expired lease and seals
    let client = reqwest::Client::new();
    let resp = client
        .post(format!(
            "{}/api/v1/organizations/{}/security/validate",
            fixture.node_b_url, tenant_id
        ))
        .header("Authorization", format!("Bearer {}", fixture.auth_token))
        .json(&payload)
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(
        body["status"], "SEALED",
        "Node B must take over expired lease and seal successfully"
    );
}
