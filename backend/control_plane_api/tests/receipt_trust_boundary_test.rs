use control_plane_api::{ControlPlaneState, router};
use control_plane_api::receipt_key_registry::{ReceiptKeyRegistry, ReceiptIssuerKey, KeyState};
use auth_service::{AuthState, store::CredentialStore, session::SessionStore};
use sled::Config;
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use ed25519_dalek::{SigningKey, Signer};
use fips204::ml_dsa_87;
use fips204::traits::{Signer as PqSigner, SerDes};
use std::time::{SystemTime, UNIX_EPOCH};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use uuid::Uuid;
use reqwest::StatusCode;

async fn spawn_test_server() -> (String, ControlPlaneState) {
    let rand_id = Uuid::new_v4().to_string();
    let dir_path = format!("/tmp/vardhan_test_trust_{}", rand_id);
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

    let app = router(control_state.clone(), auth_state, CorsLayer::permissive());
    
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let base_url = format!("http://127.0.0.1:{}", port);
    
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    (base_url, control_state)
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64
}

fn sign_hmac(secret: &str, timestamp: u64, nonce: &str, body: &[u8]) -> String {
    let canonical = format!("{}.{}.{}", timestamp, nonce, String::from_utf8_lossy(body));
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).unwrap();
    mac.update(canonical.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

#[tokio::test]
async fn test_receipt_trust_boundary_rejections() {
    std::env::set_var("VARDHAN_QCORE_SERVICE_SECRET", "test-secret-123");
    let (base_url, state) = spawn_test_server().await;
    let client = reqwest::Client::new();
    let org_id = "org-1";
    let service_id = "qcore-1";

    let mut csprng = rand::rngs::OsRng;
    let ed_sk = SigningKey::generate(&mut csprng);
    let (pq_pk, pq_sk) = ml_dsa_87::try_keygen().unwrap();
    
    let issuer = ReceiptIssuerKey {
        organization_id: org_id.to_string(),
        service_id: service_id.to_string(),
        ed25519_key_id: "ed-1".into(),
        ed25519_public_key: ed_sk.verifying_key().to_bytes().to_vec(),
        ml_dsa_87_key_id: "pq-1".into(),
        ml_dsa_87_public_key: pq_pk.into_bytes().to_vec(),
        issuer_key_fingerprint: blake3::hash(ed_sk.verifying_key().as_bytes()).to_string(),
        state: KeyState::Active,
    };
    
    let registry = ReceiptKeyRegistry::new(state.db.clone());
    registry.register(issuer.clone()).unwrap();

    let make_receipt = |modifier: Box<dyn Fn(&mut vardhan_verifier::VerifiableReceipt, &SigningKey, &ml_dsa_87::PrivateKey)>| {
        let mut r = vardhan_verifier::VerifiableReceipt {
            receipt_id: format!("VQR-{}", Uuid::new_v4()),
            schema_version: "1.1".into(),
            transaction_id: "tx-1".into(),
            tenant_id: org_id.to_string(),
            subject_id: "s".into(),
            actor_identity: "a".into(),
            proposed_action: "SEAL".into(),
            policy_id: "p1".into(),
            policy_version: "1.0".into(),
            state_hash_at_decision: None,
            evidence_commitments: vec![],
            authority_reference: "gate".into(),
            decision: "AUTHORIZED".into(),
            outcome_code: "SUCCESS".into(),
            timestamp_ms: now_ms(),
            ledger_commit_index: 1,
            parent_receipt_id: None,
            correlation_id: None,
            payload_hash: String::new(),
            issuer_key_fingerprint: issuer.issuer_key_fingerprint.clone(),
            signatures: vardhan_verifier::VerifiableDualSignature {
                ed25519_sig: String::new(),
                ed25519_key_id: "ed-1".into(),
                ml_dsa_87_sig: String::new(),
                ml_dsa_87_key_id: "pq-1".into(),
            }
        };
        
        modifier(&mut r, &ed_sk, &pq_sk);

        r.payload_hash = blake3::hash(&vardhan_verifier::canonical_receipt_payload(&r)).to_string();
        
        // Auto-sign if not tampered in modifier
        if r.signatures.ed25519_sig.is_empty() {
            r.signatures.ed25519_sig = hex::encode(ed_sk.sign(r.payload_hash.as_bytes()).to_bytes());
        }
        if r.signatures.ml_dsa_87_sig.is_empty() {
            r.signatures.ml_dsa_87_sig = hex::encode(pq_sk.try_sign(r.payload_hash.as_bytes(), &[]).unwrap());
        }
        r
    };

    let send = |r: vardhan_verifier::VerifiableReceipt, target_org: String, sid: String| {
        let base_url = base_url.clone();
        let client = client.clone();
        async move {
            let body = serde_json::to_vec(&r).unwrap();
            let ts = now_ms();
            let nonce = Uuid::new_v4().to_string();
            let sig = sign_hmac("test-secret-123", ts, &nonce, &body);
            client.post(format!("{}/api/v1/organizations/{}/qcore/receipts", base_url, target_org))
                .header("x-vardhan-service-id", sid)
                .header("x-vardhan-timestamp", ts)
                .header("x-vardhan-nonce", nonce)
                .header("x-vardhan-signature", sig)
                .body(body)
                .send().await.unwrap()
        }
    };

    // 1. Valid receipt should be accepted
    let valid = make_receipt(Box::new(|_, _, _| {}));
    let res = send(valid.clone(), org_id.to_string(), service_id.to_string()).await;
    assert_eq!(res.status(), StatusCode::OK);

    // 2. Replay of exactly identical receipt (idempotent acceptance)
    let res = send(valid.clone(), org_id.to_string(), service_id.to_string()).await;
    assert_eq!(res.status(), StatusCode::OK);

    // 3. Replay with same receipt_id but conflicting payload
    let mut conflict = valid.clone();
    conflict.decision = "REJECTED".into();
    // Resign so signature passes but payload differs from recorded telemetry
    conflict.payload_hash = blake3::hash(&vardhan_verifier::canonical_receipt_payload(&conflict)).to_string();
    conflict.signatures.ed25519_sig = hex::encode(ed_sk.sign(conflict.payload_hash.as_bytes()).to_bytes());
    conflict.signatures.ml_dsa_87_sig = hex::encode(pq_sk.try_sign(conflict.payload_hash.as_bytes(), &[]).unwrap());
    
    let res = send(conflict, org_id.to_string(), service_id.to_string()).await;
    assert_eq!(res.status(), StatusCode::CONFLICT);

    // 4. Wrong tenant parameter in receipt
    let mut wrong_tenant = make_receipt(Box::new(|_, _, _| {}));
    wrong_tenant.tenant_id = "org-2".into();
    // Re-sign to avoid verification failure obscuring the tenant check
    wrong_tenant.payload_hash = blake3::hash(&vardhan_verifier::canonical_receipt_payload(&wrong_tenant)).to_string();
    wrong_tenant.signatures.ed25519_sig = hex::encode(ed_sk.sign(wrong_tenant.payload_hash.as_bytes()).to_bytes());
    wrong_tenant.signatures.ml_dsa_87_sig = hex::encode(pq_sk.try_sign(wrong_tenant.payload_hash.as_bytes(), &[]).unwrap());
    
    let res = send(wrong_tenant.clone(), org_id.to_string(), service_id.to_string()).await;
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    // 4. Unknown issuer
    let valid_unknown = make_receipt(Box::new(|_, _, _| {}));
    let res = send(valid_unknown.clone(), org_id.to_string(), "unknown-service".to_string()).await;
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

    // 5. Inactive/revoked key
    registry.set_state(org_id, service_id, KeyState::Revoked).unwrap();
    let valid_revoked = make_receipt(Box::new(|_, _, _| {}));
    let res = send(valid_revoked.clone(), org_id.to_string(), service_id.to_string()).await;
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    registry.set_state(org_id, service_id, KeyState::Active).unwrap();

    // 6. Fingerprint mismatch
    let bad_fingerprint = make_receipt(Box::new(|r, _, _| { r.issuer_key_fingerprint = "bad".into(); }));
    let res = send(bad_fingerprint.clone(), org_id.to_string(), service_id.to_string()).await;
    assert_eq!(res.status(), StatusCode::UNPROCESSABLE_ENTITY);

    // 7. Key ID mismatch
    let bad_key_id = make_receipt(Box::new(|r, _, _| { r.signatures.ed25519_key_id = "bad".into(); }));
    let res = send(bad_key_id.clone(), org_id.to_string(), service_id.to_string()).await;
    assert_eq!(res.status(), StatusCode::UNPROCESSABLE_ENTITY);

    // 8. Invalid Ed25519 signature
    let bad_ed_sig = make_receipt(Box::new(|r, _, _| { r.signatures.ed25519_sig = hex::encode([0u8; 64]); }));
    let res = send(bad_ed_sig.clone(), org_id.to_string(), service_id.to_string()).await;
    assert_eq!(res.status(), StatusCode::UNPROCESSABLE_ENTITY);

    // 9. Invalid ML-DSA-87 signature
    let bad_ml_sig = make_receipt(Box::new(|r, sk, pq| { 
        r.signatures.ed25519_sig = hex::encode(sk.sign(r.payload_hash.as_bytes()).to_bytes());
        r.signatures.ml_dsa_87_sig = hex::encode(pq.try_sign(b"wrong", &[]).unwrap()); 
    }));
    let res = send(bad_ml_sig.clone(), org_id.to_string(), service_id.to_string()).await;
    assert_eq!(res.status(), StatusCode::UNPROCESSABLE_ENTITY);

    // 10. Malformed canonical payload (tampered field after signing)
    let bad_payload = make_receipt(Box::new(|r, sk, pq| {
        r.signatures.ed25519_sig = hex::encode(sk.sign(r.payload_hash.as_bytes()).to_bytes());
        r.signatures.ml_dsa_87_sig = hex::encode(pq.try_sign(r.payload_hash.as_bytes(), &[]).unwrap());
        // tamper
        r.decision = "REJECTED".into();
    }));
    let res = send(bad_payload.clone(), org_id.to_string(), service_id.to_string()).await;
    assert_eq!(res.status(), StatusCode::UNPROCESSABLE_ENTITY);

    // 11. Lineage fields are part of the signed payload.  A valid signature over
    // an otherwise identical receipt must not let an attacker attach it to a
    // different parent/correlation chain.
    let mut tampered_lineage = make_receipt(Box::new(|_, _, _| {}));
    tampered_lineage.parent_receipt_id = Some("VQR-missing-parent".into());
    tampered_lineage.correlation_id = Some("corr-attacker".into());
    let res = send(tampered_lineage, org_id.to_string(), service_id.to_string()).await;
    assert_eq!(res.status(), StatusCode::UNPROCESSABLE_ENTITY);
}
