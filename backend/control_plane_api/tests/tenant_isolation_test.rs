use auth_service::{session::SessionStore, store::CredentialStore, AuthState};
use control_plane_api::{router, ControlPlaneState};
use sled::Config;
use std::sync::Arc;
use tower_http::cors::CorsLayer;

static WEBAUTHN_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

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
    let login_alice = client
        .post(format!("{}/api/v1/auth/login", base_url))
        .json(&serde_json::json!({"username":"alice","password":"password123"}))
        .send()
        .await
        .unwrap();
    let mut alice_token = login_alice.json::<serde_json::Value>().await.unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string();

    // Bob login
    let login_bob = client
        .post(format!("{}/api/v1/auth/login", base_url))
        .json(&serde_json::json!({"username":"bob","password":"password123"}))
        .send()
        .await
        .unwrap();
    let mut bob_token = login_bob.json::<serde_json::Value>().await.unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string();

    // Alice creates Org A
    let create_org_a = client
        .post(format!("{}/api/v1/organizations", base_url))
        .header("Authorization", format!("Bearer {}", alice_token))
        .json(&serde_json::json!({"name": "AliceCorp"}))
        .send()
        .await
        .unwrap();
    alice_token = create_org_a
        .headers()
        .get("authorization-new-token")
        .unwrap()
        .to_str()
        .unwrap()
        .replace("Bearer ", "");
    let org_a_id = create_org_a.json::<serde_json::Value>().await.unwrap()["organization"]["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Bob creates Org B
    let create_org_b = client
        .post(format!("{}/api/v1/organizations", base_url))
        .header("Authorization", format!("Bearer {}", bob_token))
        .json(&serde_json::json!({"name": "BobInc"}))
        .send()
        .await
        .unwrap();
    bob_token = create_org_b
        .headers()
        .get("authorization-new-token")
        .unwrap()
        .to_str()
        .unwrap()
        .replace("Bearer ", "");
    let org_b_id = create_org_b.json::<serde_json::Value>().await.unwrap()["organization"]["id"]
        .as_str()
        .unwrap()
        .to_string();

    // TENANT ISOLATION: Alice attempts to access Bob's organization details
    let alice_reads_org_b = client
        .get(format!("{}/api/v1/organizations/{}", base_url, org_b_id))
        .header("Authorization", format!("Bearer {}", alice_token))
        .send()
        .await
        .unwrap();
    alice_token = alice_reads_org_b
        .headers()
        .get("authorization-new-token")
        .unwrap()
        .to_str()
        .unwrap()
        .replace("Bearer ", "");
    assert_eq!(
        alice_reads_org_b.status(),
        reqwest::StatusCode::FORBIDDEN,
        "Alice MUST NOT read Bob's Org"
    );

    // TENANT ISOLATION: Alice attempts to access Bob's findings
    let alice_reads_findings_b = client
        .get(format!(
            "{}/api/v1/organizations/{}/findings",
            base_url, org_b_id
        ))
        .header("Authorization", format!("Bearer {}", alice_token))
        .send()
        .await
        .unwrap();
    alice_token = alice_reads_findings_b
        .headers()
        .get("authorization-new-token")
        .unwrap()
        .to_str()
        .unwrap()
        .replace("Bearer ", "");
    assert_eq!(
        alice_reads_findings_b.status(),
        reqwest::StatusCode::FORBIDDEN,
        "Alice MUST NOT read Bob's Findings"
    );

    // TENANT ISOLATION: Bob attempts to read Alice's incidents
    let bob_reads_incidents_a = client
        .get(format!(
            "{}/api/v1/organizations/{}/incidents",
            base_url, org_a_id
        ))
        .header("Authorization", format!("Bearer {}", bob_token))
        .send()
        .await
        .unwrap();
    bob_token = bob_reads_incidents_a
        .headers()
        .get("authorization-new-token")
        .unwrap()
        .to_str()
        .unwrap()
        .replace("Bearer ", "");
    assert_eq!(
        bob_reads_incidents_a.status(),
        reqwest::StatusCode::FORBIDDEN,
        "Bob MUST NOT read Alice's Incidents"
    );

    // TENANT ISOLATION: Alice attempts to get Bob's usage
    let alice_reads_usage_b = client
        .get(format!(
            "{}/api/v1/organizations/{}/usage",
            base_url, org_b_id
        ))
        .header("Authorization", format!("Bearer {}", alice_token))
        .send()
        .await
        .unwrap();
    let _ = alice_reads_usage_b
        .headers()
        .get("authorization-new-token")
        .unwrap()
        .to_str()
        .unwrap()
        .replace("Bearer ", "");
    assert_eq!(
        alice_reads_usage_b.status(),
        reqwest::StatusCode::FORBIDDEN,
        "Alice MUST NOT read Bob's Usage"
    );

    // TENANT ISOLATION: Bob attempts to list Alice's members
    let bob_lists_members_a = client
        .get(format!(
            "{}/api/v1/organizations/{}/members",
            base_url, org_a_id
        ))
        .header("Authorization", format!("Bearer {}", bob_token))
        .send()
        .await
        .unwrap();
    assert_eq!(
        bob_lists_members_a.status(),
        reqwest::StatusCode::FORBIDDEN,
        "Bob MUST NOT list Alice's members"
    );
}

#[tokio::test]
async fn viewer_cannot_change_subscription_or_create_owner_invitation() {
    let (base_url, control, auth_state) = spawn_test_server().await;
    let client = reqwest::Client::new();
    let phc = auth_service::credentials::hash_password("password123").unwrap();
    auth_state.credentials.set_phc_sync("owner", &phc).unwrap();
    auth_state.credentials.set_phc_sync("viewer", &phc).unwrap();
    for username in ["owner", "viewer"] {
        let mut profile = auth_state.credentials.get_profile(username).unwrap();
        profile.role = "user".to_string();
        auth_state.credentials.save_profile(&profile).unwrap();
    }

    let owner_login = client
        .post(format!("{base_url}/api/v1/auth/login"))
        .json(&serde_json::json!({"username":"owner","password":"password123"}))
        .send()
        .await
        .unwrap();
    let owner_token = owner_login.json::<serde_json::Value>().await.unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string();
    let created = client
        .post(format!("{base_url}/api/v1/organizations"))
        .header("Authorization", format!("Bearer {owner_token}"))
        .json(&serde_json::json!({"name":"Owner Corp"}))
        .send()
        .await
        .unwrap();
    let org = created.json::<serde_json::Value>().await.unwrap()["organization"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    control
        .db
        .insert(format!("member:{org}:viewer"), b"viewer")
        .unwrap();

    let viewer_login = client
        .post(format!("{base_url}/api/v1/auth/login"))
        .json(&serde_json::json!({"username":"viewer","password":"password123"}))
        .send()
        .await
        .unwrap();
    let viewer_token = viewer_login.json::<serde_json::Value>().await.unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string();
    let change_plan = client
        .post(format!(
            "{base_url}/api/v1/organizations/{org}/subscription"
        ))
        .header("Authorization", format!("Bearer {viewer_token}"))
        .json(&serde_json::json!({"plan_id":"enterprise"}))
        .send()
        .await
        .unwrap();
    assert_eq!(change_plan.status(), reqwest::StatusCode::FORBIDDEN);

    let owner_login = client
        .post(format!("{base_url}/api/v1/auth/login"))
        .json(&serde_json::json!({"username":"owner","password":"password123"}))
        .send()
        .await
        .unwrap();
    let owner_token = owner_login.json::<serde_json::Value>().await.unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string();
    let owner_invitation = client
        .post(format!("{base_url}/api/v1/organizations/{org}/invitations"))
        .header("Authorization", format!("Bearer {owner_token}"))
        .json(&serde_json::json!({"email":"new-owner@example.com","role":"owner"}))
        .send()
        .await
        .unwrap();
    assert_eq!(owner_invitation.status(), reqwest::StatusCode::CONFLICT);
}

#[tokio::test]
async fn organization_invitation_lifecycle_enforces_identity_role_and_single_use() {
    let (base_url, control, auth_state) = spawn_test_server().await;
    let client = reqwest::Client::new();
    let phc = auth_service::credentials::hash_password("password123").unwrap();
    for username in [
        "owner@example.com",
        "member@example.com",
        "intruder@example.com",
    ] {
        auth_state.credentials.set_phc_sync(username, &phc).unwrap();
        let mut profile = auth_state.credentials.get_profile(username).unwrap();
        profile.role = "user".to_string();
        auth_state.credentials.save_profile(&profile).unwrap();
    }

    let owner_login = client
        .post(format!("{base_url}/api/v1/auth/login"))
        .json(&serde_json::json!({"username":"owner@example.com","password":"password123"}))
        .send()
        .await
        .unwrap();
    let mut owner_token = owner_login.json::<serde_json::Value>().await.unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string();
    let created = client
        .post(format!("{base_url}/api/v1/organizations"))
        .header("Authorization", format!("Bearer {owner_token}"))
        .json(&serde_json::json!({"name":"Lifecycle Corp"}))
        .send()
        .await
        .unwrap();
    owner_token = created
        .headers()
        .get("authorization-new-token")
        .unwrap()
        .to_str()
        .unwrap()
        .trim_start_matches("Bearer ")
        .to_string();
    let org = created.json::<serde_json::Value>().await.unwrap()["organization"]["id"]
        .as_str()
        .unwrap()
        .to_string();

    let invitation = client.post(format!("{base_url}/api/v1/organizations/{org}/invitations"))
        .header("Authorization", format!("Bearer {owner_token}"))
        .json(&serde_json::json!({"email":"member@example.com","role":"operator","expires_in_hours":1}))
        .send().await.unwrap();
    owner_token = invitation
        .headers()
        .get("authorization-new-token")
        .unwrap()
        .to_str()
        .unwrap()
        .trim_start_matches("Bearer ")
        .to_string();
    assert_eq!(invitation.status(), reqwest::StatusCode::OK);
    let invitation = invitation.json::<serde_json::Value>().await.unwrap();
    let token = invitation["token"].as_str().unwrap().to_string();
    let invitation_id = invitation["invitation_id"].as_str().unwrap().to_string();

    let duplicate = client
        .post(format!("{base_url}/api/v1/organizations/{org}/invitations"))
        .header("Authorization", format!("Bearer {owner_token}"))
        .json(&serde_json::json!({"email":"member@example.com","role":"operator"}))
        .send()
        .await
        .unwrap();
    owner_token = duplicate
        .headers()
        .get("authorization-new-token")
        .unwrap()
        .to_str()
        .unwrap()
        .trim_start_matches("Bearer ")
        .to_string();
    assert_eq!(duplicate.status(), reqwest::StatusCode::CONFLICT);

    let intruder_login = client
        .post(format!("{base_url}/api/v1/auth/login"))
        .json(&serde_json::json!({"username":"intruder@example.com","password":"password123"}))
        .send()
        .await
        .unwrap();
    let intruder_token = intruder_login.json::<serde_json::Value>().await.unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string();
    let wrong_identity = client
        .post(format!("{base_url}/api/v1/invitations/accept"))
        .header("Authorization", format!("Bearer {intruder_token}"))
        .json(&serde_json::json!({"token":token}))
        .send()
        .await
        .unwrap();
    assert_eq!(wrong_identity.status(), reqwest::StatusCode::FORBIDDEN);

    let member_login = client
        .post(format!("{base_url}/api/v1/auth/login"))
        .json(&serde_json::json!({"username":"member@example.com","password":"password123"}))
        .send()
        .await
        .unwrap();
    let member_token = member_login.json::<serde_json::Value>().await.unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string();
    let accepted = client
        .post(format!("{base_url}/api/v1/invitations/accept"))
        .header("Authorization", format!("Bearer {member_token}"))
        .json(&serde_json::json!({"token":token}))
        .send()
        .await
        .unwrap();
    assert_eq!(accepted.status(), reqwest::StatusCode::OK);
    let member_token = accepted
        .headers()
        .get("authorization-new-token")
        .unwrap()
        .to_str()
        .unwrap()
        .trim_start_matches("Bearer ")
        .to_string();
    assert_eq!(
        accepted.json::<serde_json::Value>().await.unwrap()["role"],
        "operator"
    );
    assert_eq!(
        control
            .db
            .get(format!("member:{org}:member@example.com"))
            .unwrap()
            .unwrap()
            .as_ref(),
        b"operator"
    );

    let replay = client
        .post(format!("{base_url}/api/v1/invitations/accept"))
        .header("Authorization", format!("Bearer {member_token}"))
        .json(&serde_json::json!({"token":token}))
        .send()
        .await
        .unwrap();
    assert_eq!(replay.status(), reqwest::StatusCode::CONFLICT);

    let change_role = client
        .post(format!(
            "{base_url}/api/v1/organizations/{org}/members/member@example.com/role"
        ))
        .header("Authorization", format!("Bearer {owner_token}"))
        .json(&serde_json::json!({"role":"security_admin"}))
        .send()
        .await
        .unwrap();
    owner_token = change_role
        .headers()
        .get("authorization-new-token")
        .unwrap()
        .to_str()
        .unwrap()
        .trim_start_matches("Bearer ")
        .to_string();
    assert_eq!(change_role.status(), reqwest::StatusCode::OK);

    let owner_escalation = client
        .post(format!(
            "{base_url}/api/v1/organizations/{org}/members/member@example.com/role"
        ))
        .header("Authorization", format!("Bearer {owner_token}"))
        .json(&serde_json::json!({"role":"owner"}))
        .send()
        .await
        .unwrap();
    assert_eq!(owner_escalation.status(), reqwest::StatusCode::CONFLICT);
    owner_token = owner_escalation
        .headers()
        .get("authorization-new-token")
        .unwrap()
        .to_str()
        .unwrap()
        .trim_start_matches("Bearer ")
        .to_string();

    let revoked = client
        .post(format!(
            "{base_url}/api/v1/organizations/{org}/invitations/{invitation_id}"
        ))
        .header("Authorization", format!("Bearer {owner_token}"))
        .send()
        .await
        .unwrap();
    assert_eq!(revoked.status(), reqwest::StatusCode::OK);
}

#[tokio::test]
async fn viewer_cannot_bypass_server_side_usage_or_telemetry_writes() {
    let (base_url, control, auth_state) = spawn_test_server().await;
    let client = reqwest::Client::new();
    let phc = auth_service::credentials::hash_password("password123").unwrap();
    for username in ["owner", "viewer", "operator"] {
        auth_state.credentials.set_phc_sync(username, &phc).unwrap();
        let mut profile = auth_state.credentials.get_profile(username).unwrap();
        profile.role = "user".to_string();
        auth_state.credentials.save_profile(&profile).unwrap();
    }
    let owner_login = client
        .post(format!("{base_url}/api/v1/auth/login"))
        .json(&serde_json::json!({"username":"owner","password":"password123"}))
        .send()
        .await
        .unwrap();
    let mut owner_token = owner_login.json::<serde_json::Value>().await.unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string();
    let created = client
        .post(format!("{base_url}/api/v1/organizations"))
        .header("Authorization", format!("Bearer {owner_token}"))
        .json(&serde_json::json!({"name":"Write Boundary Corp"}))
        .send()
        .await
        .unwrap();
    owner_token = created
        .headers()
        .get("authorization-new-token")
        .unwrap()
        .to_str()
        .unwrap()
        .trim_start_matches("Bearer ")
        .to_string();
    let org = created.json::<serde_json::Value>().await.unwrap()["organization"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    control
        .db
        .insert(format!("member:{org}:viewer"), b"viewer")
        .unwrap();
    control
        .db
        .insert(format!("member:{org}:operator"), b"operator")
        .unwrap();

    let viewer_login = client
        .post(format!("{base_url}/api/v1/auth/login"))
        .json(&serde_json::json!({"username":"viewer","password":"password123"}))
        .send()
        .await
        .unwrap();
    let viewer_token = viewer_login.json::<serde_json::Value>().await.unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string();
    let telemetry = serde_json::json!({"transaction_id":"tx-1","tenant_id":org,"state":"sealed","kind":"test","subject_id":"subject","proposed_action":"allow","policy_id":"p","policy_version":"1","created_at_ms":1,"updated_at_ms":1});
    let viewer_write = client
        .post(format!(
            "{base_url}/api/v1/organizations/{org}/transactions"
        ))
        .header("Authorization", format!("Bearer {viewer_token}"))
        .json(&telemetry)
        .send()
        .await
        .unwrap();
    assert_eq!(viewer_write.status(), reqwest::StatusCode::FORBIDDEN);

    let viewer_login = client
        .post(format!("{base_url}/api/v1/auth/login"))
        .json(&serde_json::json!({"username":"viewer","password":"password123"}))
        .send()
        .await
        .unwrap();
    let viewer_token = viewer_login.json::<serde_json::Value>().await.unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string();
    let viewer_usage = client
        .post(format!(
            "{base_url}/api/v1/organizations/{org}/usage/record"
        ))
        .header("Authorization", format!("Bearer {viewer_token}"))
        .json(&serde_json::json!({"transactions":1,"bytes_processed":1}))
        .send()
        .await
        .unwrap();
    assert_eq!(viewer_usage.status(), reqwest::StatusCode::FORBIDDEN);

    let operator_login = client
        .post(format!("{base_url}/api/v1/auth/login"))
        .json(&serde_json::json!({"username":"operator","password":"password123"}))
        .send()
        .await
        .unwrap();
    let operator_token = operator_login.json::<serde_json::Value>().await.unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string();
    let operator_write = client
        .post(format!(
            "{base_url}/api/v1/organizations/{org}/transactions"
        ))
        .header("Authorization", format!("Bearer {operator_token}"))
        .json(&telemetry)
        .send()
        .await
        .unwrap();
    assert_eq!(operator_write.status(), reqwest::StatusCode::OK);

    let owner_usage = client
        .post(format!(
            "{base_url}/api/v1/organizations/{org}/usage/record"
        ))
        .header("Authorization", format!("Bearer {owner_token}"))
        .json(&serde_json::json!({"transactions":1,"bytes_processed":1}))
        .send()
        .await
        .unwrap();
    assert_eq!(owner_usage.status(), reqwest::StatusCode::OK);
}

#[tokio::test]
async fn scim_token_is_organization_bound_and_lifecycle_is_idempotent() {
    let (base_url, control, auth_state) = spawn_test_server().await;
    let client = reqwest::Client::new();
    let phc = auth_service::credentials::hash_password("password123").unwrap();
    auth_state
        .credentials
        .set_phc_sync("scim-owner", &phc)
        .unwrap();
    let mut profile = auth_state.credentials.get_profile("scim-owner").unwrap();
    profile.role = "user".into();
    auth_state.credentials.save_profile(&profile).unwrap();
    let login = client
        .post(format!("{base_url}/api/v1/auth/login"))
        .json(&serde_json::json!({"username":"scim-owner","password":"password123"}))
        .send()
        .await
        .unwrap();
    let token = login.json::<serde_json::Value>().await.unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string();
    let create = client
        .post(format!("{base_url}/api/v1/organizations"))
        .header("Authorization", format!("Bearer {token}"))
        .json(&serde_json::json!({"name":"SCIM Tenant"}))
        .send()
        .await
        .unwrap();
    let org = create.json::<serde_json::Value>().await.unwrap()["organization"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let other = uuid::Uuid::new_v4().to_string();
    // Register a second real organization to distinguish cross-org denial from a
    // non-existent target.
    control
        .db
        .insert(
            format!("org:{other}"),
            serde_json::to_vec(
                &serde_json::json!({"id":other,"name":"Other","owner":"x","created_at_ms":0}),
            )
            .unwrap(),
        )
        .unwrap();
    let secret = "directory-secret";
    control_plane_api::enterprise_api::set_scim_token_hash(
        &control,
        &org,
        &blake3::hash(secret.as_bytes()).to_hex().to_string(),
    )
    .unwrap();

    let unauthorized = client.put(format!("{base_url}/scim/v2.0/organizations/{org}/Users/user-1"))
        .json(&serde_json::json!({"externalId":"user-1","userName":"member@example.com","active":true})).send().await.unwrap();
    assert_eq!(unauthorized.status(), reqwest::StatusCode::UNAUTHORIZED);
    let cross_org = client.put(format!("{base_url}/scim/v2.0/organizations/{other}/Users/user-1"))
        .header("Authorization", format!("Bearer {secret}")).json(&serde_json::json!({"externalId":"user-1","userName":"member@example.com","active":true})).send().await.unwrap();
    assert_eq!(cross_org.status(), reqwest::StatusCode::UNAUTHORIZED);

    let create = client.put(format!("{base_url}/scim/v2.0/organizations/{org}/Users/user-1"))
        .header("Authorization", format!("Bearer {secret}")).json(&serde_json::json!({"externalId":"user-1","userName":"member@example.com","displayName":"Member","active":true})).send().await.unwrap();
    assert_eq!(create.status(), reqwest::StatusCode::OK);
    let replay = client.put(format!("{base_url}/scim/v2.0/organizations/{org}/Users/user-1"))
        .header("Authorization", format!("Bearer {secret}")).json(&serde_json::json!({"externalId":"user-1","userName":"member@example.com","displayName":"Member","active":true})).send().await.unwrap();
    assert_eq!(replay.status(), reqwest::StatusCode::OK);
    assert_eq!(
        control
            .db
            .scan_prefix(format!("member:{org}:member@example.com"))
            .count(),
        1
    );
    let filtered = client.get(format!("{base_url}/scim/v2.0/organizations/{org}/Users?filter=userName%20eq%20%22member@example.com%22&start_index=1&count=1"))
        .header("Authorization", format!("Bearer {secret}")).send().await.unwrap();
    assert_eq!(filtered.status(), reqwest::StatusCode::OK);
    assert_eq!(
        filtered.json::<serde_json::Value>().await.unwrap()["totalResults"],
        1
    );
    let deactivate = client
        .patch(format!(
            "{base_url}/scim/v2.0/organizations/{org}/Users/user-1"
        ))
        .header("Authorization", format!("Bearer {secret}"))
        .json(&serde_json::json!({"active":false}))
        .send()
        .await
        .unwrap();
    assert_eq!(deactivate.status(), reqwest::StatusCode::OK);
    assert!(control
        .db
        .get(format!("member:{org}:member@example.com"))
        .unwrap()
        .is_none());
    let delete = client
        .delete(format!(
            "{base_url}/scim/v2.0/organizations/{org}/Users/user-1"
        ))
        .header("Authorization", format!("Bearer {secret}"))
        .send()
        .await
        .unwrap();
    assert_eq!(delete.status(), reqwest::StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn webauthn_http_routes_enforce_challenge_identity_expiry_and_single_use() {
    let _env_guard = WEBAUTHN_ENV_LOCK.lock().unwrap();
    std::env::set_var("VARDHAN_WEBAUTHN_RP_ID", "localhost");
    std::env::set_var("VARDHAN_WEBAUTHN_ORIGIN", "http://localhost");
    std::env::set_var("VARDHAN_WEBAUTHN_ALLOW_INSECURE_DEV", "true");
    let (base_url, control, auth_state) = spawn_test_server().await;
    let client = reqwest::Client::new();
    let phc = auth_service::credentials::hash_password("password123").unwrap();
    for username in ["passkey-owner", "passkey-intruder"] {
        auth_state.credentials.set_phc_sync(username, &phc).unwrap();
        let mut profile = auth_state.credentials.get_profile(username).unwrap();
        profile.role = "user".into();
        auth_state.credentials.save_profile(&profile).unwrap();
    }
    let owner_login = client
        .post(format!("{base_url}/api/v1/auth/login"))
        .json(&serde_json::json!({"username":"passkey-owner","password":"password123"}))
        .send()
        .await
        .unwrap();
    let mut owner_token = owner_login.json::<serde_json::Value>().await.unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string();
    let intruder_login = client
        .post(format!("{base_url}/api/v1/auth/login"))
        .json(&serde_json::json!({"username":"passkey-intruder","password":"password123"}))
        .send()
        .await
        .unwrap();
    let intruder_token = intruder_login.json::<serde_json::Value>().await.unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string();
    let start = client
        .post(format!("{base_url}/api/v1/auth/webauthn/register/start"))
        .header("Authorization", format!("Bearer {owner_token}"))
        .send()
        .await
        .unwrap();
    assert_eq!(start.status(), reqwest::StatusCode::OK);
    owner_token = start
        .headers()
        .get("authorization-new-token")
        .unwrap()
        .to_str()
        .unwrap()
        .trim_start_matches("Bearer ")
        .to_string();
    let id = start.json::<serde_json::Value>().await.unwrap()["challenge_id"]
        .as_str()
        .unwrap()
        .to_string();
    let cross_identity = client
        .post(format!("{base_url}/api/v1/auth/webauthn/register/finish"))
        .header("Authorization", format!("Bearer {intruder_token}"))
        .json(&serde_json::json!({"challenge_id":id,"credential":{}}))
        .send()
        .await
        .unwrap();
    assert_eq!(cross_identity.status(), reqwest::StatusCode::UNAUTHORIZED);
    let replay = client
        .post(format!("{base_url}/api/v1/auth/webauthn/register/finish"))
        .header("Authorization", format!("Bearer {owner_token}"))
        .json(&serde_json::json!({"challenge_id":id,"credential":{}}))
        .send()
        .await
        .unwrap();
    assert_eq!(replay.status(), reqwest::StatusCode::BAD_REQUEST);
    owner_token = replay
        .headers()
        .get("authorization-new-token")
        .unwrap()
        .to_str()
        .unwrap()
        .trim_start_matches("Bearer ")
        .to_string();

    let start = client
        .post(format!("{base_url}/api/v1/auth/webauthn/register/start"))
        .header("Authorization", format!("Bearer {owner_token}"))
        .send()
        .await
        .unwrap();
    let expired_id = start.json::<serde_json::Value>().await.unwrap()["challenge_id"]
        .as_str()
        .unwrap()
        .to_string();
    let key = format!("webauthn:registration:{expired_id}");
    let mut state: serde_json::Value =
        serde_json::from_slice(&control.db.get(&key).unwrap().unwrap()).unwrap();
    state["expires_at_ms"] = serde_json::json!(0);
    control
        .db
        .insert(key, serde_json::to_vec(&state).unwrap())
        .unwrap();
    let expired = client
        .post(format!("{base_url}/api/v1/auth/webauthn/register/finish"))
        .header("Authorization", format!("Bearer {owner_token}"))
        .json(&serde_json::json!({"challenge_id":expired_id,"credential":{}}))
        .send()
        .await
        .unwrap();
    assert_eq!(expired.status(), reqwest::StatusCode::UNAUTHORIZED);
    let unknown_auth = client
        .post(format!("{base_url}/api/v1/auth/webauthn/auth/finish"))
        .json(&serde_json::json!({"challenge_id":"unknown","credential":{}}))
        .send()
        .await
        .unwrap();
    assert_eq!(unknown_auth.status(), reqwest::StatusCode::BAD_REQUEST);
}
