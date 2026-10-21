//! G2 durable-idempotency acceptance tests.
//!
//! Proves the single durable path: [`DurableEventQueue`] backed directly by
//! the authoritative sled store (`state.db`). These tests exercise the queue
//! itself — not HTTP plumbing — so a green run proves durability,
//! idempotency, and single-winner CAS semantics of the store of record.

use auth_service::{session::SessionStore, store::CredentialStore, AuthState};
use control_plane_api::durable_event_queue::{DurableEventQueue, EventState};
use control_plane_api::{router, ControlPlaneState};
use sled::Config;
use std::sync::Arc;
use tower_http::cors::CorsLayer;

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

/// G2-1: 16 concurrent duplicate enqueues must converge on a single winner.
///
/// `enqueue` inserts with `compare_and_swap(key, None, Some(event))`: exactly
/// one task wins the CAS and creates the record; the other 15 observe the
/// existing key, find matching `payload_hash` + `kind`, and return
/// `Ok(same event_id)`. All 16 callers therefore see the same id.
#[tokio::test]
async fn g2_concurrent_duplicate_enqueue_single_winner() {
    let (_base, state, _auth) = spawn_test_server().await;
    let db = state.db.clone();

    let mut handles = Vec::new();
    for _ in 0..16 {
        let db = db.clone();
        handles.push(tokio::spawn(async move {
            DurableEventQueue::new(db).enqueue("org-g2", "receipt.verified", b"same".to_vec(), 1)
        }));
    }

    let mut ids = Vec::new();
    for handle in handles {
        let id = handle
            .await
            .unwrap()
            .expect("concurrent enqueue must succeed");
        ids.push(id);
    }

    assert_eq!(ids.len(), 16, "all 16 tasks must return Ok");
    let first = &ids[0];
    assert!(
        ids.iter().all(|id| id == first),
        "CAS single-winner violated: got distinct ids {:?}",
        ids
    );
}

/// G2-2: worker restart must preserve claim state.
///
/// Claims are persisted in sled before `claim_next` returns, so dropping the
/// queue handle and reopening it on the same `Arc<Db>` (simulating a worker
/// restart without losing the store) keeps the first event `InFlight` and
/// leaves the second event claimable.
#[tokio::test]
async fn g2_restart_preserves_claims() {
    let (_base, state, _auth) = spawn_test_server().await;
    let db = state.db.clone();

    let queue = DurableEventQueue::new(db.clone());
    let first = queue
        .enqueue("org-g2", "receipt.verified", b"first".to_vec(), 1)
        .unwrap();
    let second = queue
        .enqueue("org-g2", "receipt.verified", b"second".to_vec(), 2)
        .unwrap();
    assert_ne!(first, second);
    // Distinct `available_at_ms` values (1 < 2): `claim_next` orders by
    // `(available_at_ms, event_id)`, so the first event wins deterministically
    // (a tie on `available_at_ms` would fall back to lexicographic event_id
    // order, which is hash-based, not FIFO).

    let claimed = queue
        .claim_next("org-g2", 1_000)
        .unwrap()
        .expect("first event must be claimable");
    assert_eq!(claimed.event_id, first);

    // Simulate worker restart: drop the handle, reopen on the same store.
    drop(queue);
    let reopened = DurableEventQueue::new(db);

    assert_eq!(
        reopened.get("org-g2", &first).unwrap().state,
        EventState::InFlight,
        "restart must preserve the InFlight claim"
    );
    let next = reopened
        .claim_next("org-g2", 1_000)
        .unwrap()
        .expect("second event must still be claimable after restart");
    assert_eq!(next.event_id, second);
}

/// G2-3: duplicate-request semantics after ack.
///
/// Re-enqueueing the identical payload after `ack` is idempotent
/// (`Ok(same id)`, NOT a conflict); the same kind with a different payload
/// hashes to a different `deterministic_id` (`Ok(different id)`). An acked
/// event can never be re-claimed — `claim_next` only scans `Pending`.
#[tokio::test]
async fn g2_duplicate_replay_rejected_after_ack() {
    let (_base, state, _auth) = spawn_test_server().await;
    let queue = DurableEventQueue::new(state.db.clone());

    let id = queue
        .enqueue("org-g2", "receipt.verified", b"same".to_vec(), 1)
        .unwrap();
    let claimed = queue
        .claim_next("org-g2", 1_000)
        .unwrap()
        .expect("event must be claimable");
    assert_eq!(claimed.event_id, id);
    queue.ack("org-g2", &id).unwrap();
    assert_eq!(queue.get("org-g2", &id).unwrap().state, EventState::Acked);

    // Identical replay after ack: idempotent, same id — not a conflict.
    let replay = queue
        .enqueue("org-g2", "receipt.verified", b"same".to_vec(), 1)
        .unwrap();
    assert_eq!(
        replay, id,
        "identical payload must return the same event id (idempotent)"
    );

    // Same kind, different payload: deterministic_id differs → different id.
    let other = queue
        .enqueue("org-g2", "receipt.verified", b"different".to_vec(), 1)
        .unwrap();
    assert_ne!(
        other, id,
        "different payload must produce a different event id"
    );
    assert_ne!(
        DurableEventQueue::deterministic_id("org-g2", "receipt.verified", b"same"),
        DurableEventQueue::deterministic_id("org-g2", "receipt.verified", b"different"),
    );

    // The acked event can never be re-claimed: claim_next skips Acked and
    // returns only the still-pending different-payload event.
    let reclaimed = queue
        .claim_next("org-g2", 1_000)
        .unwrap()
        .expect("pending event must be claimable");
    assert_eq!(reclaimed.event_id, other);
    assert!(
        queue.claim_next("org-g2", 1_000).unwrap().is_none(),
        "acked event must never be re-claimed"
    );
}

/// G2-4: failover claim contention admits exactly one claimant.
///
/// Reasoning about the implementation (`claim_next` in
/// `durable_event_queue.rs`): it scans for `Pending` candidates, then
/// `compare_and_swap`s each candidate from its re-read bytes to the
/// `InFlight` encoding. A loser's CAS fails (`Ok(Err(_))`) and the loop
/// `continue`s to the next candidate; with only one event there are no more
/// candidates, so losers fall through to `Ok(None)`. There is deliberately no
/// Pending-retry path for losers, so the strict assertion — exactly one
/// `Some`, seven `None` — matches reality.
#[tokio::test]
async fn g2_failover_claim_contention_single_claimant() {
    let (_base, state, _auth) = spawn_test_server().await;
    let db = state.db.clone();

    DurableEventQueue::new(db.clone())
        .enqueue("org-g2", "receipt.verified", b"failover".to_vec(), 1)
        .unwrap();

    let mut handles = Vec::new();
    for _ in 0..8 {
        let db = db.clone();
        handles.push(tokio::spawn(async move {
            DurableEventQueue::new(db).claim_next("org-g2", 1_000)
        }));
    }

    let mut some_count = 0usize;
    let mut none_count = 0usize;
    let mut winner: Option<String> = None;
    for handle in handles {
        match handle.await.unwrap().expect("claim_next must not error") {
            Some(event) => {
                some_count += 1;
                assert!(
                    winner.replace(event.event_id.clone()).is_none(),
                    "at most one claimant may win"
                );
            }
            None => none_count += 1,
        }
    }

    assert_eq!(some_count, 1, "exactly one task must claim the event");
    assert_eq!(none_count, 7, "the other seven tasks must get None");
    assert!(winner.is_some());
}
