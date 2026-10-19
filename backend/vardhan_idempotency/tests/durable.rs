use std::time::{SystemTime, UNIX_EPOCH};
use vardhan_idempotency::IdempotencyKey;
use vardhan_idempotency::durable::DurableIdempotencyRegistry;

static DURABLE_TEST_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn temp_path() -> std::path::PathBuf {
    // Unique per call (nanos + atomic sequence + pid): parallel tests must
    // never share a registry file. Same-tick nanos collisions previously let
    // one test's records (e.g. tx-0) leak into another test's store.
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let seq = DURABLE_TEST_COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    std::env::temp_dir().join(format!(
        "vardhan-idempotency-{stamp}-{seq}-{}.json",
        std::process::id()
    ))
}

#[test]
fn durable_registry_rejects_duplicate_after_reopen() {
    let path = temp_path();
    let key = IdempotencyKey::new("request-1");
    let first = DurableIdempotencyRegistry::new(&path);
    first
        .check_and_register("tenant-a", &key, "tx-1", 60_000)
        .unwrap()
        .unwrap();
    drop(first);

    let reopened = DurableIdempotencyRegistry::new(&path);
    let duplicate = reopened
        .check_and_register("tenant-a", &key, "tx-2", 60_000)
        .unwrap()
        .unwrap_err();
    assert_eq!(duplicate.original_transaction_id, "tx-1");

    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_file(path.with_extension("lock"));
}

#[test]
fn durable_registry_is_tenant_isolated() {
    let path = temp_path();
    let key = IdempotencyKey::new("request-1");
    let registry = DurableIdempotencyRegistry::new(&path);
    registry
        .check_and_register("tenant-a", &key, "tx-a", 60_000)
        .unwrap()
        .unwrap();
    registry
        .check_and_register("tenant-b", &key, "tx-b", 60_000)
        .unwrap()
        .unwrap();

    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_file(path.with_extension("lock"));
}

#[test]
fn failed_record_can_be_reused() {
    let path = temp_path();
    let key = IdempotencyKey::new("request-1");
    let registry = DurableIdempotencyRegistry::new(&path);
    registry
        .check_and_register("tenant-a", &key, "tx-a", 60_000)
        .unwrap()
        .unwrap();
    registry.fail("tenant-a", &key).unwrap();
    registry
        .check_and_register("tenant-a", &key, "tx-b", 60_000)
        .unwrap()
        .unwrap();

    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_file(path.with_extension("lock"));
}

#[test]
fn durable_registry_persists_completion_status() {
    let path = temp_path();
    let key = IdempotencyKey::new("request-1");
    let registry = DurableIdempotencyRegistry::new(&path);
    registry
        .check_and_register("tenant-a", &key, "tx-1", 60_000)
        .unwrap()
        .unwrap();
    registry.complete("tenant-a", &key).unwrap();
    drop(registry);

    // Reopen and verify status is persisted
    let reopened = DurableIdempotencyRegistry::new(&path);
    // A completed record should still be treated as a duplicate
    let duplicate = reopened
        .check_and_register("tenant-a", &key, "tx-2", 60_000)
        .unwrap()
        .unwrap_err();
    assert_eq!(duplicate.original_transaction_id, "tx-1");

    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_file(path.with_extension("lock"));
}

#[test]
fn durable_registry_concurrent_duplicate_is_rejected() {
    use std::sync::Arc;
    use std::thread;
    let path = temp_path();
    let key = IdempotencyKey::new("request-1");
    let registry = Arc::new(DurableIdempotencyRegistry::new(&path));
    let handles: Vec<_> = (0..4)
        .map(|i| {
            let reg = Arc::clone(&registry);
            let key_clone = key.clone();
            let tx_id = format!("tx-{}", i);
            thread::spawn(move || {
                reg.check_and_register("tenant-a", &key_clone, &tx_id, 60_000)
                    .unwrap()
                    .map(|_| "registered".to_string())
                    .map_err(|_| "duplicate".to_string())
            })
        })
        .collect();

    let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
    let registered = results.iter().filter(|r| r.is_ok()).count();
    let duplicates = results.iter().filter(|r| r.is_err()).count();
    assert_eq!(registered, 1, "Exactly one thread should succeed");
    assert_eq!(duplicates, 3, "Three threads should see duplicate");

    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_file(path.with_extension("lock"));
}

#[test]
fn durable_registry_cross_node_persistence() {
    // Simulates two separate process nodes sharing the same storage path
    let path = temp_path();
    let key = IdempotencyKey::new("request-1");

    // Node A registers
    let node_a = DurableIdempotencyRegistry::new(&path);
    node_a
        .check_and_register("tenant-a", &key, "tx-a", 60_000)
        .unwrap()
        .unwrap();
    node_a.complete("tenant-a", &key).unwrap();
    drop(node_a);

    // Node B (simulating restart or different process) sees the completed record
    let node_b = DurableIdempotencyRegistry::new(&path);
    let result = node_b
        .check_and_register("tenant-a", &key, "tx-b", 60_000)
        .unwrap();
    assert!(result.is_err(), "Cross-node duplicate must be rejected");

    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_file(path.with_extension("lock"));
}
